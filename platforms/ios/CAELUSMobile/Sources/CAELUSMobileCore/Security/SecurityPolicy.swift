//
//  SecurityPolicy.swift
//  CAELUSMobileCore
//
//  Which operations require explicit user-intent confirmation (Face ID /
//  Touch ID / passcode on iOS).  Biometrics confirm INTENT — they never
//  replace cryptographic validation, which the native core performs
//  unconditionally regardless of this policy.
//
import Foundation

/// Sensitive operations the app can gate behind user confirmation.
public enum CriticalAction: String, Codable, Sendable, CaseIterable {
    case applyHighImpactLever = "apply_high_impact_lever"
    case exportReport = "export_report"
    case resetSession = "reset_session"
    case restoreCheckpoint = "restore_checkpoint"
    case disableAssuranceMode = "disable_assurance_mode"
    case importScenario = "import_scenario"
    case importNeuralModel = "import_neural_model"

    public var displayName: String {
        switch self {
        case .applyHighImpactLever: return "Apply high-impact lever"
        case .exportReport: return "Export report"
        case .resetSession: return "Reset session"
        case .restoreCheckpoint: return "Restore checkpoint"
        case .disableAssuranceMode: return "Disable assurance mode"
        case .importScenario: return "Import scenario"
        case .importNeuralModel: return "Import neural model"
        }
    }
}

/// Versioned, persistable confirmation policy.
public struct SecurityPolicy: Codable, Sendable, Equatable {
    public var formatVersion: Int
    public var actionsRequiringConfirmation: Set<CriticalAction>
    /// Success-probability threshold above which a lever counts as
    /// high-impact for the `.applyHighImpactLever` gate (fixed-point 1e6;
    /// levers at or above this success probability are the consequential,
    /// state-changing interventions).
    public var highImpactLeverThresholdFP: Int64

    enum CodingKeys: String, CodingKey {
        case formatVersion = "format_version"
        case actionsRequiringConfirmation = "actions_requiring_confirmation"
        case highImpactLeverThresholdFP = "high_impact_lever_threshold_fp"
    }

    public init(formatVersion: Int = 1,
                actionsRequiringConfirmation: Set<CriticalAction>,
                highImpactLeverThresholdFP: Int64 = 600_000) {
        self.formatVersion = formatVersion
        self.actionsRequiringConfirmation = actionsRequiringConfirmation
        self.highImpactLeverThresholdFP = highImpactLeverThresholdFP
    }

    /// Conservative default: every critical action needs confirmation.
    public static let `default` = SecurityPolicy(
        actionsRequiringConfirmation: Set(CriticalAction.allCases))

    public func requiresConfirmation(_ action: CriticalAction) -> Bool {
        actionsRequiringConfirmation.contains(action)
    }

    /// Whether applying this lever must be confirmed under this policy.
    public func requiresConfirmation(for lever: Lever) -> Bool {
        requiresConfirmation(.applyHighImpactLever)
            && lever.successProbabilityFP >= highImpactLeverThresholdFP
    }
}

/// Confirms user intent for a critical action.  The iOS implementation
/// wraps LocalAuthentication; tests use deterministic fakes.
public protocol UserIntentAuthorizer: Sendable {
    func confirmIntent(for action: CriticalAction, reason: String) async -> Bool
}

/// Fail-closed default: every confirmation request is denied.  Used when no
/// platform authorizer has been provided so a wiring mistake can never skip
/// a required confirmation.
public struct DenyAllAuthorizer: UserIntentAuthorizer {
    public init() {}
    public func confirmIntent(for action: CriticalAction,
                              reason: String) async -> Bool { false }
}

/// Central decision point used by feature flows before critical actions.
public struct CriticalActionGate: Sendable {
    public var policy: SecurityPolicy
    public var authorizer: UserIntentAuthorizer

    public init(policy: SecurityPolicy = .default,
                authorizer: UserIntentAuthorizer = DenyAllAuthorizer()) {
        self.policy = policy
        self.authorizer = authorizer
    }

    /// True when the action may proceed (either no confirmation required,
    /// or the user explicitly confirmed).
    public func authorize(_ action: CriticalAction,
                          reason: String) async -> Bool {
        guard policy.requiresConfirmation(action) else { return true }
        return await authorizer.confirmIntent(for: action, reason: reason)
    }

    /// Lever-specific gate combining the policy threshold with intent
    /// confirmation.
    public func authorizeLever(_ lever: Lever) async -> Bool {
        guard policy.requiresConfirmation(for: lever) else { return true }
        return await authorizer.confirmIntent(
            for: .applyHighImpactLever,
            reason: "Apply lever \(lever.id) targeting \(lever.target)")
    }
}
