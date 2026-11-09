//
//  ExecutiveReport.swift
//  CAELUSMobileCore
//
//  Deterministic executive report rendered from a snapshot + audit status.
//  Content is a pure function of its inputs (no clocks, no locale
//  dependence) so the same session state always exports byte-identical
//  reports — reports themselves are audit-friendly artefacts.
//
import Foundation

public struct ExecutiveReport: Sendable, Equatable {
    public var markdown: String
    public var suggestedFileName: String

    public var utf8Data: Data { Data(markdown.utf8) }
}

public enum ExecutiveReportBuilder {
    public static func build(snapshot: EngineSnapshot,
                             auditStatus: AuditChainStatus,
                             anchors: TrustAnchors?) -> ExecutiveReport {
        let summary = CommandCenterBuilder.summarize(snapshot)
        var lines: [String] = []

        lines.append("# CAELUS Mobile — Executive Report")
        lines.append("")
        lines.append("## Session")
        lines.append("| Field | Value |")
        lines.append("| --- | --- |")
        lines.append("| Session | `\(snapshot.sessionID)` |")
        lines.append("| Engine version | \(snapshot.engineVersion) |")
        lines.append("| Snapshot ABI | v\(snapshot.abiVersion) |")
        lines.append("| Tick | \(snapshot.tick) |")
        if let minutes = snapshot.scenario.tickMinutes {
            lines.append("| Virtual time | \(summary.virtualMinutes) min "
                + "(\(minutes) min/tick) |")
        }
        lines.append("")

        lines.append("## Scenario")
        if snapshot.scenario.loaded {
            lines.append("| Field | Value |")
            lines.append("| --- | --- |")
            lines.append("| ID | \(snapshot.scenario.id ?? "—") |")
            lines.append("| Title | \(snapshot.scenario.title ?? "—") |")
            lines.append("| Sector | \(snapshot.scenario.sector ?? "—") |")
            lines.append("| Class | \(snapshot.scenario.blackswanClass ?? "—") |")
            lines.append("| Signature | \(snapshot.scenario.signatureStatus ?? "—") |")
            lines.append("| Scenario hash | `\(snapshot.scenario.scenarioHash ?? "")` |")
        } else {
            lines.append("No scenario loaded.")
        }
        lines.append("")

        lines.append("## Operational state")
        lines.append("| Field | Value |")
        lines.append("| --- | --- |")
        lines.append("| Regime | \(summary.regime.rawValue) |")
        lines.append("| Outage latch | \(summary.outageLatched ? "ACTIVE" : "clear") |")
        lines.append("| Friction (clamped) | "
            + "\(FixedPoint.decimalString(snapshot.frictionClampedFP)) |")
        lines.append("| Pending intel events | \(snapshot.pendingIntelEvents) |")
        lines.append("")

        if !summary.topFrictionSources.isEmpty {
            lines.append("### Top friction sources")
            lines.append("| Node | Kind | Contribution | Trust | Reported deviation |")
            lines.append("| --- | --- | --- | --- | --- |")
            for source in summary.topFrictionSources {
                lines.append("| \(source.id) | \(source.kind.displayName) "
                    + "| \(FixedPoint.decimalString(source.contributionFP)) "
                    + "| \(FixedPoint.decimalString(source.trustFP)) "
                    + "| \(FixedPoint.decimalString(source.deviationFP)) |")
            }
            lines.append("")
        }

        lines.append("## Neural layer")
        lines.append("| Field | Value |")
        lines.append("| --- | --- |")
        lines.append("| Mode | \(snapshot.neural.mode.displayName) |")
        lines.append("| Model loaded | \(snapshot.neural.modelLoaded ? "yes" : "no") |")
        if let modelID = snapshot.neural.modelID {
            lines.append("| Model | \(modelID) \(snapshot.neural.modelVersion ?? "") |")
        }
        if let hash = snapshot.neural.modelHash {
            lines.append("| Model hash | `\(hash)` |")
        }
        if let decision = snapshot.neural.lastGateDecision {
            lines.append("| Last gate decision | \(decision.rawValue) |")
        }
        if let confidence = snapshot.neural.confidenceMinFP {
            lines.append("| Confidence (min) | "
                + "\(FixedPoint.percentString(confidence)) |")
        }
        if let ood = snapshot.neural.oodMaxFP {
            lines.append("| OOD (max) | \(FixedPoint.percentString(ood)) |")
        }
        if let risk = summary.outageRisk {
            lines.append("| Outage risk S/M/L | "
                + "\(FixedPoint.percentString(risk.shortFP)) / "
                + "\(FixedPoint.percentString(risk.mediumFP)) / "
                + "\(FixedPoint.percentString(risk.longFP)) |")
        }
        lines.append("")
        lines.append("State classes: *reported* = node telemetry as received; "
            + "*estimated* = gated neural estimate (advisory); "
            + "*authoritative* = deterministic symbolic engine state. "
            + "Only authoritative state drives decisions.")
        lines.append("")

        if let evaluations = snapshot.neural.leverEvaluations,
           !evaluations.isEmpty {
            lines.append("## Lever evaluations (deterministic what-if)")
            lines.append("| Lever | Symbolic score | Neural score | Simulated success | Prevents outage | Selected |")
            lines.append("| --- | --- | --- | --- | --- | --- |")
            for evaluation in evaluations {
                let prevents = evaluation.baselineOutage && !evaluation.candidateOutage
                lines.append("| \(evaluation.leverID) "
                    + "| \(FixedPoint.decimalString(evaluation.symbolicScoreFP)) "
                    + "| \(FixedPoint.decimalString(evaluation.neuralScoreFP)) "
                    + "| \(evaluation.simulatedSuccess ? "yes" : "no") "
                    + "| \(prevents ? "yes" : "no") "
                    + "| \(evaluation.selected ? "yes" : "no") |")
            }
            lines.append("")
        }

        lines.append("## Audit integrity")
        lines.append("| Field | Value |")
        lines.append("| --- | --- |")
        lines.append("| Chain open | \(auditStatus.open ? "yes" : "sealed") |")
        lines.append("| Entries | \(auditStatus.entries) |")
        lines.append("| Chain head | `\(auditStatus.chainHead)` |")
        lines.append("| Session | `\(auditStatus.sessionID)` |")
        if let anchors {
            lines.append("| Scenario anchor | `\(anchors.scenarioPublicKeyHex)` |")
            lines.append("| Neural anchor | `\(anchors.neuralPublicKeyHex)` |")
        }
        lines.append("")
        lines.append("The audit chain is Blake3-linked and ed25519-sealed: "
            + "tampering with recorded events is detectable by any verifier "
            + "holding the seal public key.  A local file is NOT deletion-proof "
            + "— absence of a chain is itself the signal.")
        lines.append("")

        let scenario = snapshot.scenario.id ?? "no-scenario"
        return ExecutiveReport(
            markdown: lines.joined(separator: "\n"),
            suggestedFileName: "caelus_report_\(scenario)_t\(snapshot.tick).md")
    }
}
