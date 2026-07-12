//
//  CommandCenterSummary.swift
//  CAELUSMobileCore
//
//  Pure derivation of the iPhone Command Center at-a-glance state from an
//  EngineSnapshot.  Lives in Core (not UI) so the exact numbers and labels
//  the operator sees are unit-tested on Linux against the real engine.
//
import Foundation

/// Operational regime shown as the headline state.
public enum OperationalRegime: String, Sendable, Equatable {
    case nominal = "NOMINAL"
    case strained = "STRAINED"
    case regimeExceeded = "REGIME EXCEEDED"
    case outage = "OUTAGE"
}

/// One ranked friction source.
public struct FrictionSource: Sendable, Equatable, Identifiable {
    public var id: String
    public var kind: NodeKind
    public var contributionFP: Int64
    public var trustFP: Int64
    public var deviationFP: Int64
}

/// Multi-horizon outage risk (neural estimate; fixed-point probabilities).
public struct OutageRisk: Sendable, Equatable {
    public var shortFP: Int64
    public var mediumFP: Int64
    public var longFP: Int64

    public static let zero = OutageRisk(shortFP: 0, mediumFP: 0, longFP: 0)
}

/// Everything the iPhone home screen shows at a glance.
public struct CommandCenterSummary: Sendable, Equatable {
    public var scenarioID: String?
    public var scenarioTitle: String?
    public var scenarioSignatureVerified: Bool
    public var tick: UInt64
    /// Virtual elapsed minutes = tick × scenario tick_minutes.
    public var virtualMinutes: UInt64
    public var regime: OperationalRegime
    public var outageLatched: Bool
    public var frictionFP: Int64
    public var topFrictionSources: [FrictionSource]
    /// Neural outage risk; nil when the neural layer has produced no
    /// accepted evidence (symbolic-only operation).
    public var outageRisk: OutageRisk?
    public var neuralMode: NeuralMode
    /// Minimum node confidence of the last gated inference (fp), if any.
    public var neuralConfidenceFP: Int64?
    /// Maximum node OOD score of the last gated inference (fp), if any.
    public var neuralOODFP: Int64?
    public var lastGateDecision: GateDecision?
    /// Highest-priority applicable lever (id), if any.
    public var recommendedLeverID: String?
    public var auditChainIntact: Bool
    public var pendingIntelEvents: UInt64
}

public enum CommandCenterBuilder {
    /// Threshold above which clamped friction counts as "strained"
    /// (halfway between nominal 1.0 and the 3.0 regime characteristic).
    static let strainedThresholdFP: Int64 = 2_000_000

    public static func summarize(_ snapshot: EngineSnapshot) -> CommandCenterSummary {
        let regime: OperationalRegime
        if snapshot.outageActive {
            regime = .outage
        } else if snapshot.regimeExceeded {
            regime = .regimeExceeded
        } else if snapshot.frictionClampedFP >= strainedThresholdFP {
            regime = .strained
        } else {
            regime = .nominal
        }

        let sources = snapshot.nodes
            .map { node in
                FrictionSource(id: node.id,
                               kind: node.kind,
                               contributionFP: node.frictionContributionFP,
                               trustFP: node.trustFP,
                               deviationFP: node.reportedDeviationFP)
            }
            .sorted { lhs, rhs in
                lhs.contributionFP != rhs.contributionFP
                    ? lhs.contributionFP > rhs.contributionFP
                    : lhs.id < rhs.id // deterministic tie-break
            }

        var risk: OutageRisk?
        if let estimates = snapshot.neural.nodes, !estimates.isEmpty {
            risk = OutageRisk(
                shortFP: estimates.map(\.outageShortFP).max() ?? 0,
                mediumFP: estimates.map(\.outageMediumFP).max() ?? 0,
                longFP: estimates.map(\.outageLongFP).max() ?? 0)
        }

        let tickMinutes = UInt64(max(snapshot.scenario.tickMinutes ?? 0, 0))

        return CommandCenterSummary(
            scenarioID: snapshot.scenario.id,
            scenarioTitle: snapshot.scenario.title,
            scenarioSignatureVerified: snapshot.scenario.signatureVerified,
            tick: snapshot.tick,
            virtualMinutes: snapshot.tick * tickMinutes,
            regime: regime,
            outageLatched: snapshot.outageActive,
            frictionFP: snapshot.frictionClampedFP,
            topFrictionSources: Array(sources.prefix(3)),
            outageRisk: risk,
            neuralMode: snapshot.neural.mode,
            neuralConfidenceFP: snapshot.neural.confidenceMinFP,
            neuralOODFP: snapshot.neural.oodMaxFP,
            lastGateDecision: snapshot.neural.lastGateDecision,
            recommendedLeverID: recommendedLever(snapshot),
            auditChainIntact: snapshot.audit.open && snapshot.audit.entries > 0,
            pendingIntelEvents: snapshot.pendingIntelEvents)
    }

    /// Highest-priority lever: the gate-selected lever when the last
    /// neural evaluation chose one that is still applicable, otherwise the
    /// applicable lever whose deterministic what-if evaluation scored best,
    /// otherwise the applicable lever with the highest success probability.
    public static func recommendedLever(_ snapshot: EngineSnapshot) -> String? {
        let applicable = snapshot.levers.filter(\.applicable)
        guard !applicable.isEmpty else { return nil }
        let applicableIDs = Set(applicable.map(\.id))

        if let selected = snapshot.neural.selectedLeverID,
           applicableIDs.contains(selected) {
            return selected
        }
        if let evaluations = snapshot.neural.leverEvaluations {
            let best = evaluations
                .filter { applicableIDs.contains($0.leverID) }
                .sorted { lhs, rhs in
                    lhs.symbolicScoreFP != rhs.symbolicScoreFP
                        ? lhs.symbolicScoreFP > rhs.symbolicScoreFP
                        : lhs.leverID < rhs.leverID
                }
                .first
            if let best { return best.leverID }
        }
        return applicable
            .sorted { lhs, rhs in
                lhs.successProbabilityFP != rhs.successProbabilityFP
                    ? lhs.successProbabilityFP > rhs.successProbabilityFP
                    : lhs.id < rhs.id
            }
            .first?.id
    }
}
