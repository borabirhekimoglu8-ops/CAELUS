//
//  EngineSnapshot.swift
//  CAELUSMobileCore
//
//  Codable DTOs for the versioned CAELUS_MOBILE_SNAPSHOT_V1 JSON produced by
//  caelus_mobile_snapshot_json_v1.  All fixed-point values arrive as Int64
//  integers at scale 1e6; conversion to Double exists ONLY for presentation
//  (see FixedPoint) and never feeds back into engine state.
//
import Foundation

// MARK: - Graph

/// Mirror of the C++ `NodeKind` enum (numeric wire encoding).
public enum NodeKind: UInt8, Codable, Sendable, CaseIterable {
    case service = 0
    case buffer = 1
    case queue = 2
    case perishable = 3
    case gate = 4
    case adversary = 5

    public init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(UInt8.self)
        // Unknown kinds (newer engine than app) degrade to .service for
        // display; the underlying engine semantics are unaffected.
        self = NodeKind(rawValue: raw) ?? .service
    }

    public var displayName: String {
        switch self {
        case .service: return "Service"
        case .buffer: return "Buffer"
        case .queue: return "Queue"
        case .perishable: return "Perishable"
        case .gate: return "Gate"
        case .adversary: return "Adversary"
        }
    }
}

/// Authoritative + reported + trust state of one causal node.
public struct GraphNode: Codable, Sendable, Equatable, Identifiable {
    public var id: String
    public var kind: NodeKind
    public var capacityFP: Int64
    public var stateFP: Int64
    public var reportedStateFP: Int64
    public var trustFP: Int64
    public var weightFP: Int64
    public var deadlineTick: Int32
    public var deadlineMissed: Bool
    public var irrecoverable: Bool

    enum CodingKeys: String, CodingKey {
        case id, kind
        case capacityFP = "capacity_fp"
        case stateFP = "state_fp"
        case reportedStateFP = "reported_state_fp"
        case trustFP = "trust_fp"
        case weightFP = "weight_fp"
        case deadlineTick = "deadline_tick"
        case deadlineMissed = "deadline_missed"
        case irrecoverable
    }

    /// Divergence between what the node reports and its authoritative state
    /// — the core observability-attack signal (fixed-point, scale 1e6).
    public var reportedDeviationFP: Int64 { reportedStateFP - stateFP }

    /// This node's friction contribution: state/capacity × weight
    /// (fixed-point, scale 1e6).  Overflow-safe for ABI v1 value ranges
    /// (state ≤ capacity ≤ 1e6 ⇒ product ≤ 1e12 « Int64.max).
    public var frictionContributionFP: Int64 {
        guard capacityFP > 0 else { return 0 }
        return (stateFP * weightFP) / capacityFP
    }
}

public struct GraphEdge: Codable, Sendable, Equatable {
    public var from: String
    public var to: String
    public var multiplierFP: Int64
    public var lagTicks: Int32
    public var active: Bool

    enum CodingKeys: String, CodingKey {
        case from, to
        case multiplierFP = "multiplier_fp"
        case lagTicks = "lag_ticks"
        case active
    }
}

public struct Lever: Codable, Sendable, Equatable, Identifiable {
    public var id: String
    public var target: String
    public var successProbabilityFP: Int64
    public var costTicks: Int32
    public var lockoutTicks: Int32
    public var remainingLockout: Int32
    public var available: Bool

    enum CodingKeys: String, CodingKey {
        case id, target
        case successProbabilityFP = "success_p_fp"
        case costTicks = "cost_ticks"
        case lockoutTicks = "lockout_ticks"
        case remainingLockout = "remaining_lockout"
        case available
    }

    public init(id: String, target: String, successProbabilityFP: Int64,
                costTicks: Int32, lockoutTicks: Int32,
                remainingLockout: Int32, available: Bool) {
        self.id = id
        self.target = target
        self.successProbabilityFP = successProbabilityFP
        self.costTicks = costTicks
        self.lockoutTicks = lockoutTicks
        self.remainingLockout = remainingLockout
        self.available = available
    }

    /// A lever can be applied right now (known + enabled + not locked out).
    public var applicable: Bool { available && remainingLockout == 0 }
}

public struct HysteresisState: Codable, Sendable, Equatable, Identifiable {
    public var id: String
    public var thresholdTick: Int32
    public var reversible: Bool
    public var permanentLossFP: Int64
    public var flipped: Bool

    enum CodingKeys: String, CodingKey {
        case id
        case thresholdTick = "threshold_tick"
        case reversible
        case permanentLossFP = "permanent_loss_fp"
        case flipped
    }
}

public struct FeedbackLoop: Codable, Sendable, Equatable, Identifiable {
    public var id: String
    public var gainFP: Int64
    public var path: [String]

    enum CodingKeys: String, CodingKey {
        case id
        case gainFP = "gain_fp"
        case path
    }
}

// MARK: - Scenario / neural / audit sections

public struct ScenarioInfo: Codable, Sendable, Equatable {
    public var loaded: Bool
    public var id: String?
    public var title: String?
    public var sector: String?
    public var blackswanClass: String?
    public var signatureStatus: String?
    public var signatureScheme: String?
    public var tickMinutes: Int?
    public var horizonHours: Int?
    public var scenarioHash: String?

    enum CodingKeys: String, CodingKey {
        case loaded, id, title, sector
        case blackswanClass = "blackswan_class"
        case signatureStatus = "signature_status"
        case signatureScheme = "signature_scheme"
        case tickMinutes = "tick_minutes"
        case horizonHours = "horizon_hours"
        case scenarioHash = "scenario_hash"
    }

    /// True only for the pinned production anchor — dev bypass statuses
    /// (DEV_TRUST_BYPASS / SELF_SIGNED_DEV) are deliberately NOT verified.
    public var signatureVerified: Bool { signatureStatus == "VERIFIED" }
}

/// Execution mode of the neural layer.  User-visible state must always
/// distinguish these — see `displayName`.
public enum NeuralMode: String, Codable, Sendable {
    case symbolicOnly = "SYMBOLIC_ONLY"
    case advisory = "ADVISORY"
    case assurance = "ASSURANCE"
    case unknown = "UNKNOWN"

    public init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = NeuralMode(rawValue: raw) ?? .unknown
    }

    public var displayName: String {
        switch self {
        case .symbolicOnly: return "Symbolic Only"
        case .advisory: return "Neural Advisory"
        case .assurance: return "Deterministic Neural Assurance"
        case .unknown: return "Unknown Mode"
        }
    }
}

/// Neural Gate decision taxonomy (wire strings from the shared core).
public enum GateDecision: String, Codable, Sendable {
    case acceptedAdvisory = "ACCEPTED_ADVISORY"
    case acceptedBounded = "ACCEPTED_BOUNDED"
    case rejectedLowConfidence = "REJECTED_LOW_CONFIDENCE"
    case rejectedOOD = "REJECTED_OOD"
    case rejectedRange = "REJECTED_RANGE"
    case rejectedInvariant = "REJECTED_INVARIANT"
    case rejectedTimeout = "REJECTED_TIMEOUT"
    case rejectedModelTrust = "REJECTED_MODEL_TRUST"
    case rejectedSchema = "REJECTED_SCHEMA"
    case rejectedRuntime = "REJECTED_RUNTIME"
    case symbolicFallback = "SYMBOLIC_FALLBACK"
    case unknown = "UNKNOWN"

    public init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = GateDecision(rawValue: raw) ?? .unknown
    }

    public var accepted: Bool {
        self == .acceptedAdvisory || self == .acceptedBounded
    }
}

/// Per-node neural estimate of the most recent gated tick.
public struct NeuralNodeEstimate: Codable, Sendable, Equatable {
    public var nodeID: String
    public var estimatedTrueStateFP: Int64
    public var telemetryAnomalyScoreFP: Int64
    public var confidenceFP: Int64
    public var oodFP: Int64
    public var outageShortFP: Int64
    public var outageMediumFP: Int64
    public var outageLongFP: Int64

    enum CodingKeys: String, CodingKey {
        case nodeID = "node_id"
        case estimatedTrueStateFP = "estimated_true_state_fp"
        case telemetryAnomalyScoreFP = "telemetry_anomaly_score_fp"
        case confidenceFP = "confidence_fp"
        case oodFP = "ood_fp"
        case outageShortFP = "outage_short_fp"
        case outageMediumFP = "outage_medium_fp"
        case outageLongFP = "outage_long_fp"
    }
}

/// A bounded trust adjustment the symbolic authority actually committed.
public struct AppliedProposal: Codable, Sendable, Equatable {
    public var nodeID: String
    public var trustBeforeFP: Int64
    public var deltaFP: Int64
    public var trustAfterFP: Int64

    enum CodingKeys: String, CodingKey {
        case nodeID = "node_id"
        case trustBeforeFP = "trust_before_fp"
        case deltaFP = "delta_fp"
        case trustAfterFP = "trust_after_fp"
    }
}

/// Neural-vs-symbolic scoring of one candidate lever, including the
/// deterministic what-if simulation outcome.
public struct LeverEvaluation: Codable, Sendable, Equatable {
    public var leverID: String
    public var neuralScoreFP: Int64
    public var symbolicScoreFP: Int64
    public var simulatedSuccess: Bool
    public var baselineOutage: Bool
    public var candidateOutage: Bool
    public var selected: Bool

    enum CodingKeys: String, CodingKey {
        case leverID = "lever_id"
        case neuralScoreFP = "neural_score_fp"
        case symbolicScoreFP = "symbolic_score_fp"
        case simulatedSuccess = "simulated_success"
        case baselineOutage = "baseline_outage"
        case candidateOutage = "candidate_outage"
        case selected
    }
}

public struct NeuralInfo: Codable, Sendable, Equatable {
    public var mode: NeuralMode
    public var modelLoaded: Bool
    public var modelStatus: String
    public var modelID: String?
    public var modelVersion: String?
    public var modelHash: String?
    public var lastGateDecision: GateDecision?
    public var lastRuntimeStatus: String?
    public var lastRejectionReason: String?
    public var lastTick: UInt64?
    public var observedHistoryTicks: UInt32?
    public var authorityCommitted: Bool?
    public var confidenceMinFP: Int64?
    public var oodMaxFP: Int64?
    public var selectedLeverID: String?
    public var nodes: [NeuralNodeEstimate]?
    public var appliedProposals: [AppliedProposal]?
    public var leverEvaluations: [LeverEvaluation]?

    enum CodingKeys: String, CodingKey {
        case mode
        case modelLoaded = "model_loaded"
        case modelStatus = "model_status"
        case modelID = "model_id"
        case modelVersion = "model_version"
        case modelHash = "model_hash"
        case lastGateDecision = "last_gate_decision"
        case lastRuntimeStatus = "last_runtime_status"
        case lastRejectionReason = "last_rejection_reason"
        case lastTick = "last_tick"
        case observedHistoryTicks = "observed_history_ticks"
        case authorityCommitted = "authority_committed"
        case confidenceMinFP = "confidence_min_fp"
        case oodMaxFP = "ood_max_fp"
        case selectedLeverID = "selected_lever_id"
        case nodes
        case appliedProposals = "applied_proposals"
        case leverEvaluations = "lever_evaluations"
    }
}

public struct AuditSection: Codable, Sendable, Equatable {
    public var open: Bool
    public var entries: UInt64
    public var chainHead: String
    public var path: String

    enum CodingKeys: String, CodingKey {
        case open, entries
        case chainHead = "chain_head"
        case path
    }

    public init(open: Bool, entries: UInt64, chainHead: String, path: String) {
        self.open = open
        self.entries = entries
        self.chainHead = chainHead
        self.path = path
    }
}

// MARK: - Snapshot root

/// Versioned full-state snapshot (`CAELUS_MOBILE_SNAPSHOT_V1`).
public struct EngineSnapshot: Codable, Sendable, Equatable {
    public var type: String
    public var abiVersion: UInt32
    public var engineVersion: String
    public var sessionID: String
    public var tick: UInt64
    public var frictionFP: Int64
    public var frictionClampedFP: Int64
    public var regimeExceeded: Bool
    public var outageActive: Bool
    public var hasIntelRisk: Bool
    public var lastIntelRiskFP: Int64
    public var pendingIntelEvents: UInt64
    public var scenario: ScenarioInfo
    public var neural: NeuralInfo
    public var nodes: [GraphNode]
    public var edges: [GraphEdge]
    public var levers: [Lever]
    public var hysteresis: [HysteresisState]
    public var feedbackLoops: [FeedbackLoop]
    public var audit: AuditSection

    enum CodingKeys: String, CodingKey {
        case type
        case abiVersion = "abi_version"
        case engineVersion = "engine_version"
        case sessionID = "session_id"
        case tick
        case frictionFP = "friction_fp"
        case frictionClampedFP = "friction_clamped_fp"
        case regimeExceeded = "regime_exceeded"
        case outageActive = "outage_active"
        case hasIntelRisk = "has_intel_risk"
        case lastIntelRiskFP = "last_intel_risk_fp"
        case pendingIntelEvents = "pending_intel_events"
        case scenario, neural, nodes, edges, levers, hysteresis
        case feedbackLoops = "feedback_loops"
        case audit
    }

    public static let expectedType = "CAELUS_MOBILE_SNAPSHOT_V1"

    public static func decode(from data: Data) throws -> EngineSnapshot {
        let snapshot: EngineSnapshot
        do {
            snapshot = try JSONDecoder().decode(EngineSnapshot.self, from: data)
        } catch {
            throw CaelusMobileError.payloadDecoding(detail: String(describing: error))
        }
        guard snapshot.type == expectedType else {
            throw CaelusMobileError.payloadDecoding(
                detail: "unexpected snapshot type \(snapshot.type)")
        }
        return snapshot
    }
}

// MARK: - Audit chain status

/// Compact status JSON of `caelus_mobile_audit_status_json_v1`.
/// `open` = chain context live (export/read possible); `sealed` = the SEAL
/// line has been written and no further events are accepted.
public struct AuditChainStatus: Codable, Sendable, Equatable {
    public var open: Bool
    public var sealed: Bool
    public var entries: UInt64
    public var chainHead: String
    public var sessionID: String

    enum CodingKeys: String, CodingKey {
        case open, sealed, entries
        case chainHead = "chain_head"
        case sessionID = "session_id"
    }

    public static func decode(from data: Data) throws -> AuditChainStatus {
        do {
            return try JSONDecoder().decode(AuditChainStatus.self, from: data)
        } catch {
            throw CaelusMobileError.payloadDecoding(detail: String(describing: error))
        }
    }
}

// MARK: - Trust anchors

/// Compiled-in PUBLIC trust anchors (`CAELUS_MOBILE_TRUST_ANCHORS_V1`).
public struct TrustAnchors: Codable, Sendable, Equatable {
    public var type: String
    public var abiVersion: UInt32
    public var engineVersion: String
    public var scenarioPublicKeyHex: String
    public var neuralPublicKeyHex: String

    enum CodingKeys: String, CodingKey {
        case type
        case abiVersion = "abi_version"
        case engineVersion = "engine_version"
        case scenarioPublicKeyHex = "scenario_pubkey"
        case neuralPublicKeyHex = "neural_pubkey"
    }

    public static func decode(from data: Data) throws -> TrustAnchors {
        do {
            return try JSONDecoder().decode(TrustAnchors.self, from: data)
        } catch {
            throw CaelusMobileError.payloadDecoding(detail: String(describing: error))
        }
    }
}
