#!/usr/bin/env python3
"""Regression tests for neural audit cross-event verification."""

from __future__ import annotations

import copy
import unittest

from tools.verify_audit_log import NeuralSemanticVerifier, VerificationError


HASHES = {
    "scenario_hash": "10" * 32,
    "model_hash": "20" * 32,
    "manifest_hash": "30" * 32,
    "input_hash": "40" * 32,
    "output_hash": "50" * 32,
    "policy_hash": "3ba5fa3cea21e9b52e36944661e039765a559cc5e653847d788d7e60544641e2",
}


def scenario_event() -> dict[str, object]:
    return {
        "type": "SCENARIO_ACTIVATED",
        "scenario_id": "BS-01_SAHTE_UFUK",
        "signature_status": "VERIFIED",
        "signature_scheme": "ed25519+pinned",
        "neural_assurance_authorized": True,
        "scenario_hash": HASHES["scenario_hash"],
    }


def inference_event(tick: int = 8) -> dict[str, object]:
    return {
        "type": "NEURAL_INFERENCE_V1",
        "session_id": "0000000000000000",
        "tick": tick,
        "scenario_id": "BS-01_SAHTE_UFUK",
        "scenario_hash": HASHES["scenario_hash"],
        "engine_version": "2.0.0",
        "runtime_mode": "DETERMINISTIC_FIXED_POINT_ASSURANCE",
        "model_id": "caelus-bs01-synthetic-v1",
        "model_version": "1.0.0",
        "model_load_status": "LOADED",
        "model_trusted": True,
        "model_hash": HASHES["model_hash"],
        "manifest_hash": HASHES["manifest_hash"],
        "feature_schema_version": 1,
        "input_hash": HASHES["input_hash"],
        "output_hash": HASHES["output_hash"],
        "policy_hash": HASHES["policy_hash"],
        "evidence_id": HASHES["output_hash"],
        "runtime_status": "OK",
        "gate_decision": "ACCEPTED_BOUNDED",
        "rejection_reason": "validated bounded trust proposals",
        "confidence_min_fp": 700_000,
        "ood_max_fp": 200_000,
        "saturation_count": 0,
        "observed_history_ticks": 8,
        "inference_duration_us": 0,
        "duration_measured": False,
        "fallback": False,
        "authority_expected": True,
    }


def authority_event(
    tick: int = 8,
    trust_before: int = 700_000,
    delta: int = -10_000,
) -> dict[str, object]:
    return {
        "type": "NEURAL_AUTHORITY_V1",
        "session_id": "0000000000000000",
        "tick": tick,
        "evidence_id": HASHES["output_hash"],
        "model_hash": HASHES["model_hash"],
        "input_hash": HASHES["input_hash"],
        "output_hash": HASHES["output_hash"],
        "policy_hash": HASHES["policy_hash"],
        "gate_decision": "ACCEPTED_BOUNDED",
        "applied_proposals": [
            {
                "node_index": 1,
                "node_id": "GHOST_INVENTORY",
                "trust_before_fp": trust_before,
                "delta_fp": delta,
                "trust_after_fp": trust_before + delta,
            }
        ],
        "lever_candidates": [
            {
                "lever_index": 0,
                "lever_id": "RECOVER",
                "neural_score_fp": 800_000,
                "symbolic_score_fp": 600_000,
                "simulated_success": True,
                "baseline_outage": False,
                "candidate_outage": False,
                "selected": True,
            }
        ],
        "selected_lever_id": "RECOVER",
        "authority_committed": True,
        "symbolic_state_overwritten": False,
        "outage_latch_overridden": False,
    }


def verifier(model_reference: dict[str, object] | None = None) -> NeuralSemanticVerifier:
    if model_reference is None:
        model_reference = {
            "package_hash": HASHES["model_hash"],
            "manifest_hash": HASHES["manifest_hash"],
            "model_id": "caelus-bs01-synthetic-v1",
            "model_version": "1.0.0",
        }
    result = NeuralSemanticVerifier(model_reference)
    result.begin_session(0, "genesis", continuation=False)
    result.observe_event(scenario_event(), "scenario")
    return result


class NeuralAuditSemanticTests(unittest.TestCase):
    def test_valid_inference_and_authority_are_linked(self) -> None:
        check = verifier()
        check.observe_event(inference_event(), "inference")
        check.observe_event(authority_event(), "authority")
        check.finish_session("seal")
        self.assertEqual(check.inference_count, 1)
        self.assertEqual(check.authority_count, 1)

    def test_authority_without_inference_is_rejected(self) -> None:
        check = verifier()
        with self.assertRaisesRegex(VerificationError, "no inference evidence"):
            check.observe_event(authority_event(), "authority")

    def test_missing_authority_resolution_is_rejected_at_session_end(self) -> None:
        check = verifier()
        check.observe_event(inference_event(), "inference")
        with self.assertRaisesRegex(VerificationError, "missing neural authority"):
            check.finish_session("seal")

    def test_evidence_id_and_model_reference_mismatches_are_rejected(self) -> None:
        bad_evidence = inference_event()
        bad_evidence["evidence_id"] = "ff" * 32
        with self.assertRaisesRegex(VerificationError, "evidence_id"):
            verifier().observe_event(bad_evidence, "inference")

        model_reference = {
            "package_hash": "aa" * 32,
            "manifest_hash": HASHES["manifest_hash"],
            "model_id": "caelus-bs01-synthetic-v1",
            "model_version": "1.0.0",
        }
        with self.assertRaisesRegex(VerificationError, "pinned model package"):
            verifier(model_reference).observe_event(inference_event(), "inference")

    def test_trust_transitions_must_continue_from_prior_authority(self) -> None:
        check = verifier()
        check.observe_event(inference_event(8), "inference-8")
        check.observe_event(authority_event(8), "authority-8")

        next_inference = inference_event(9)
        next_inference["input_hash"] = "41" * 32
        next_inference["output_hash"] = "51" * 32
        next_inference["evidence_id"] = "51" * 32
        check.observe_event(next_inference, "inference-9")

        next_authority = authority_event(9, trust_before=700_000)
        next_authority["input_hash"] = "41" * 32
        next_authority["output_hash"] = "51" * 32
        next_authority["evidence_id"] = "51" * 32
        with self.assertRaisesRegex(VerificationError, "trust pre-state"):
            check.observe_event(next_authority, "authority-9")

    def test_rejected_inference_needs_no_authority(self) -> None:
        rejected = copy.deepcopy(inference_event())
        rejected.update(
            {
                "input_hash": "00" * 32,
                "runtime_status": "MALFORMED_INPUT",
                "gate_decision": "REJECTED_SCHEMA",
                "confidence_min_fp": 0,
                "ood_max_fp": 0,
                "fallback": True,
                "authority_expected": False,
            }
        )
        check = verifier()
        check.observe_event(rejected, "rejected")
        check.finish_session("seal")
        self.assertEqual(check.authority_count, 0)

    def test_accepted_inference_requires_scenario_authorization_and_policy(self) -> None:
        unauthorized = verifier()
        unauthorized.scenario_authorized = False
        with self.assertRaisesRegex(VerificationError, "not authorized"):
            unauthorized.observe_event(inference_event(), "inference")

        low_confidence = inference_event()
        low_confidence["confidence_min_fp"] = 649_999
        with self.assertRaisesRegex(VerificationError, "Policy V1 thresholds"):
            verifier().observe_event(low_confidence, "inference")

        high_ood = inference_event()
        high_ood["ood_max_fp"] = 500_001
        with self.assertRaisesRegex(VerificationError, "Policy V1 thresholds"):
            verifier().observe_event(high_ood, "inference")

        wrong_policy = inference_event()
        wrong_policy["policy_hash"] = "60" * 32
        with self.assertRaisesRegex(VerificationError, "untrusted Neural Policy"):
            verifier().observe_event(wrong_policy, "inference")

    def test_scenario_activation_is_pinned_and_not_replayable(self) -> None:
        unpinned = scenario_event()
        unpinned["signature_scheme"] = "ed25519"
        check = NeuralSemanticVerifier(require_model_reference=False)
        check.begin_session(0, "genesis", continuation=False)
        with self.assertRaisesRegex(VerificationError, "pinned verified scenario"):
            check.observe_event(unpinned, "scenario")

        duplicate = verifier()
        with self.assertRaisesRegex(VerificationError, "duplicate SCENARIO_ACTIVATED"):
            duplicate.observe_event(scenario_event(), "scenario-replay")

    def test_replayed_tick_and_evidence_are_rejected(self) -> None:
        check = verifier()
        rejected = inference_event(8)
        rejected.update(
            {
                "runtime_status": "MALFORMED_INPUT",
                "gate_decision": "REJECTED_SCHEMA",
                "fallback": True,
                "authority_expected": False,
            }
        )
        check.observe_event(rejected, "first")
        replay = copy.deepcopy(rejected)
        with self.assertRaisesRegex(
            VerificationError, "ticks must be strictly increasing"
        ):
            check.observe_event(replay, "replay")

    def test_rollback_resolution_closes_pending_evidence(self) -> None:
        check = verifier()
        check.observe_event(inference_event(), "inference")
        rollback = {
            "type": "NEURAL_AUTHORITY_ROLLBACK_V1",
            "session_id": "0000000000000000",
            "tick": 8,
            "scenario_id": "BS-01_SAHTE_UFUK",
            "evidence_id": HASHES["output_hash"],
            "model_hash": HASHES["model_hash"],
            "input_hash": HASHES["input_hash"],
            "output_hash": HASHES["output_hash"],
            "policy_hash": HASHES["policy_hash"],
            "gate_decision": "SYMBOLIC_FALLBACK",
            "reason": "authority audit failed; bounded transaction rolled back",
            "authority_committed": False,
            "rollback_applied": True,
            "rollback_failed": False,
            "symbolic_state_overwritten": False,
            "outage_latch_overridden": False,
        }
        check.observe_event(rollback, "rollback")
        check.finish_session("seal")

        advisory = verifier()
        advisory_inference = inference_event()
        advisory_inference["gate_decision"] = "ACCEPTED_ADVISORY"
        advisory.observe_event(advisory_inference, "advisory-inference")
        advisory_rollback = copy.deepcopy(rollback)
        advisory_rollback["rollback_applied"] = False
        advisory.observe_event(advisory_rollback, "advisory-noop-rollback")
        advisory.finish_session("seal")

        wrong_decision = verifier()
        wrong_decision.observe_event(inference_event(), "inference")
        invalid = copy.deepcopy(rollback)
        invalid["gate_decision"] = "ACCEPTED_BOUNDED"
        with self.assertRaisesRegex(VerificationError, "invalid gate_decision"):
            wrong_decision.observe_event(invalid, "rollback-invalid")

        failed = verifier()
        failed.observe_event(inference_event(), "inference")
        unsafe = copy.deepcopy(rollback)
        unsafe["rollback_applied"] = False
        unsafe["rollback_failed"] = True
        with self.assertRaisesRegex(VerificationError, "session is unsafe"):
            failed.observe_event(unsafe, "rollback-failed")


if __name__ == "__main__":
    unittest.main()
