//
//  EngineConfiguration.swift
//  CAELUSMobileCore
//
//  Swift-side session configuration marshalled into
//  CaelusMobileEngineConfigV1 by the EngineController.
//
// (@preconcurrency: swift-corelibs URL is not yet Sendable-annotated; the
// type is a value type and safe to send.)
@preconcurrency import Foundation

/// Mirrors the `CAELUS_MOBILE_FLAG_*` bits of the C header.  Values are
/// fixed by ABI v1 and behaviourally verified by the Linux tests.
public struct EngineFlags: OptionSet, Sendable, Equatable {
    public let rawValue: UInt32
    public init(rawValue: UInt32) { self.rawValue = rawValue }

    /// Deterministic fixed-point neural assurance (requires a verified
    /// scenario, a signed model package, and an open audit chain).
    public static let neuralAssurance = EngineFlags(rawValue: 1 << 0)
    /// Wall-clock inference timing telemetry — never part of deterministic
    /// output; keep disabled for bit-exact replay comparisons.
    public static let measureTiming = EngineFlags(rawValue: 1 << 1)
}

/// App lifecycle phases audited through `caelus_mobile_note_lifecycle_v1`.
public enum LifecyclePhase: UInt32, Sendable {
    case background = 1
    case foreground = 2
    case terminating = 3
}

/// Everything needed to open one native engine session.
public struct EngineConfiguration: Sendable {
    /// Feature flags for the session.
    public var flags: EngineFlags
    /// Engine PRNG seed for deterministic lever evaluation.
    /// 0 = time/tick derived (production non-replayable).
    public var deterministicSeed: UInt64
    /// Audit session identity. 0 = derive from wall clock (unique, not
    /// deterministic). Deterministic tests must pass an explicit value.
    public var sessionID: UInt64
    /// Directory for the append-only audit chain. Must exist and be
    /// writable; on iOS pass an app-sandbox path.
    public var auditDirectory: URL
    /// Persistent device identity file (created on first use). On iOS keep
    /// it inside the sandbox with
    /// NSFileProtectionCompleteUntilFirstUserAuthentication.
    public var identityFile: URL

    public init(flags: EngineFlags = [],
                deterministicSeed: UInt64 = 0,
                sessionID: UInt64 = 0,
                auditDirectory: URL,
                identityFile: URL) {
        self.flags = flags
        self.deterministicSeed = deterministicSeed
        self.sessionID = sessionID
        self.auditDirectory = auditDirectory
        self.identityFile = identityFile
    }
}

/// Input size limits of ABI v1 (mirror of `CAELUS_MOBILE_MAX_*`).  The
/// native bridge enforces these authoritatively; the Swift layer pre-checks
/// them only to produce friendlier errors before crossing the boundary.
public enum EngineLimits {
    public static let maxScenarioBytes = 4 * 1024 * 1024
    public static let maxManifestBytes = 64 * 1024
    public static let maxWeightsBytes = 16 * 1024 * 1024
    public static let maxSignatureBytes = 512
    public static let maxCheckpointBytes = 16 * 1024 * 1024
    public static let maxLeverIDBytes = 256
    public static let maxTicksPerCall: UInt32 = 10_000
}
