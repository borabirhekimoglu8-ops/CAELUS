/**
 * CAELUS OS — Shared neural tick runner  (include/neural_tick_runner.h)
 *
 * Single implementation of the audit-disciplined neural tick sequence used by
 * every host (desktop core_engine.cpp, mobile bridge).  Hosts must not
 * re-implement this flow: the ordering of audit appends, authority commit,
 * rollback, and fallback is a security contract, and duplicating it is how
 * platform-specific behaviour divergence would start.
 *
 * Sequence (identical to the desktop ProcessNeuralTick this was extracted
 * from):
 *   1. evaluate()                       — inference + Neural Gate
 *   2. append NEURAL_INFERENCE_V1       — evidence must be durable first
 *   3. commit_authority()               — only when the gate accepted
 *   4. append NEURAL_AUTHORITY_V1       — or rejection/rollback resolution
 *   5. emit war-room event              — exactly once, all outcomes
 *
 * Fail-closed rules:
 *   • If the inference evidence cannot be audited, no authority runs and the
 *     controller drops to symbolic-only.
 *   • If the authority audit fails after a committed mutation, the mutation
 *     is rolled back; if rollback itself fails, the host receives
 *     FatalRollbackFailed and MUST fail-stop the engine (desktop aborts the
 *     process; the mobile bridge latches the handle poisoned).
 */
#pragma once

#include <string>
#include <utility>

#include "audit_log.h"
#include "neural_host.h"

namespace caelus::neural {

enum class NeuralTickOutcome : uint8_t {
    /// Controller disabled (symbolic-only) — nothing ran.
    Skipped = 0,
    /// Inference ran; any required authority committed and audited.
    Committed,
    /// Neural path failed closed; symbolic-only fallback is now active.
    Fallback,
    /// Unaudited mutation could not be rolled back. Host MUST fail-stop.
    FatalRollbackFailed,
};

/**
 * run_neural_tick — execute one audited neural tick.
 *
 * @param emit       war-room/UI JSON sink, called exactly once per attempt.
 * @param log_error  host error channel (stderr on desktop, ring on mobile).
 * @param out_evidence  optional copy of the final evidence for host display.
 */
template <typename EmitFn, typename LogFn>
NeuralTickOutcome run_neural_tick(
    NeuralControllerV1& controller,
    causal::CausalEngine& engine,
    AuditLog& audit,
    uint64_t audit_session_id,
    bool measure_wall_duration,
    EmitFn&& emit,
    LogFn&& log_error,
    NeuralTickEvidenceV1* out_evidence = nullptr) {
    if (!controller.enabled()) return NeuralTickOutcome::Skipped;

    auto evidence = controller.evaluate(engine, measure_wall_duration);
    const auto finish = [&](NeuralTickOutcome outcome) {
        emit(neural_war_room_event(controller, evidence));
        if (out_evidence != nullptr) *out_evidence = evidence;
        return outcome;
    };

    const std::string inference_event =
        neural_inference_audit_event(controller, evidence, audit_session_id);
    if (!audit.is_open() || !audit.append(inference_event)) {
        log_error(
            "AUDIT_FAILURE: inference evidence could not be committed; "
            "switching to symbolic-only fallback.");
        controller.mark_symbolic_fallback(
            evidence, "inference audit event could not be committed");
        controller.force_symbolic_fallback();
        return finish(NeuralTickOutcome::Fallback);
    }

    if (evidence.authority_record_required) {
        if (!controller.commit_authority(engine, evidence)) {
            log_error(
                "Symbolic authority rejected the bounded transaction; "
                "neural changes were not applied.");
            const std::string rejected_event =
                neural_authority_resolution_audit_event(
                    controller, evidence, audit_session_id,
                    "NEURAL_AUTHORITY_REJECTED_V1");
            if (rejected_event.empty() || !audit.append(rejected_event)) {
                log_error(
                    "AUDIT_FAILURE: authority rejection resolution could "
                    "not be committed.");
            }
            controller.force_symbolic_fallback();
            return finish(NeuralTickOutcome::Fallback);
        }
        const std::string authority_event =
            neural_authority_audit_event(controller, evidence, audit_session_id);
        if (authority_event.empty() || !audit.append(authority_event)) {
            const bool rolled_back =
                controller.rollback_authority(engine, evidence);
            controller.mark_symbolic_fallback(
                evidence,
                rolled_back
                    ? "authority audit failed; bounded transaction rolled back"
                    : "authority audit failed and symbolic rollback failed");
            const std::string rollback_event =
                neural_authority_resolution_audit_event(
                    controller, evidence, audit_session_id,
                    "NEURAL_AUTHORITY_ROLLBACK_V1");
            const bool rollback_audited =
                !rollback_event.empty() && audit.append(rollback_event);
            log_error(
                std::string(
                    "AUDIT_FAILURE: authority event could not be committed; "
                    "bounded trust transaction ") +
                (rolled_back ? "rolled back" : "ROLLBACK FAILED") +
                "; rollback evidence " +
                (rollback_audited ? "committed" : "NOT COMMITTED") +
                ". Symbolic-only fallback is now active.");
            controller.force_symbolic_fallback();
            return finish(
                rolled_back ? NeuralTickOutcome::Fallback
                            : NeuralTickOutcome::FatalRollbackFailed);
        }
    }

    return finish(NeuralTickOutcome::Committed);
}

} // namespace caelus::neural
