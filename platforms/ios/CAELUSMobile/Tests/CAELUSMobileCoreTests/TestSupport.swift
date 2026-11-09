//
//  TestSupport.swift
//  CAELUSMobileCoreTests
//
//  Shared fixtures and helpers.  These tests run against the REAL native
//  core (dist/host archives built by tools/build_host_bridge.sh) — the
//  signed BS-01/BS-02 scenarios and the committed signed neural package
//  are the same fixtures the desktop CI uses.
//
import Foundation
import XCTest
@testable import CAELUSMobileCore

// MARK: Repository fixtures

enum Fixtures {
    static let repoRoot: URL = {
        if let env = ProcessInfo.processInfo.environment["CAELUS_REPO_ROOT"],
           !env.isEmpty {
            return URL(fileURLWithPath: env)
        }
        // …/platforms/ios/CAELUSMobile/Tests/CAELUSMobileCoreTests/TestSupport.swift
        return URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent() // CAELUSMobileCoreTests
            .deletingLastPathComponent() // Tests
            .deletingLastPathComponent() // CAELUSMobile
            .deletingLastPathComponent() // ios
            .deletingLastPathComponent() // platforms
            .deletingLastPathComponent() // repo root
    }()

    static func data(_ relativePath: String) throws -> Data {
        let url = repoRoot.appendingPathComponent(relativePath)
        return try Data(contentsOf: url)
    }

    static func scenarioBS01() throws -> Data {
        try data("scenarios/BS-01_SAHTE_UFUK.json")
    }
    static func scenarioBS02() throws -> Data {
        try data("scenarios/BS-02_GOLGE_ARSIV.json")
    }
    static func modelManifest() throws -> Data {
        try data("models/assurance_v1/manifest.json")
    }
    static func modelWeights() throws -> Data {
        try data("models/assurance_v1/weights.bin")
    }
    static func modelSignature() throws -> Data {
        try data("models/assurance_v1/model.sig")
    }
}

// MARK: Key protection (test provider)

/// XOR-masking stand-in for the iOS Keychain provider.  Validates the
/// registration/round-trip plumbing only — real protection exists solely on
/// the device and is exercised there.
struct XORTestKeyProtection: KeyProtectionProvider {
    static let mask: UInt8 = 0x5A
    static let format: UInt32 = 0x0000_0004 // PROTECTED_PLUGIN

    func protect(rawSeed: [UInt8]) -> ProtectedKeyMaterial? {
        guard rawSeed.count == 32 else { return nil }
        return ProtectedKeyMaterial(bytes: rawSeed.map { $0 ^ Self.mask },
                                    format: Self.format)
    }

    func unprotect(material: ProtectedKeyMaterial) -> [UInt8]? {
        guard material.format == Self.format,
              material.bytes.count == 32 else { return nil }
        return material.bytes.map { $0 ^ Self.mask }
    }
}

/// Idempotent per-process installation.
func installTestKeyProtection() throws {
    if !KeyProtectionRegistry.isInstalled {
        try KeyProtectionRegistry.install(XORTestKeyProtection())
    }
}

// MARK: Engine factory

/// Fresh scratch directory per call.
func makeScratchDirectory() throws -> URL {
    let url = FileManager.default.temporaryDirectory
        .appendingPathComponent("caelus_swift_\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: url,
                                            withIntermediateDirectories: true)
    return url
}

func makeConfiguration(directory: URL,
                       flags: EngineFlags = [],
                       seed: UInt64 = 0xCAE1_0500_0000_AAAA,
                       sessionID: UInt64 = 0x1122_3344_5566_7788) -> EngineConfiguration {
    EngineConfiguration(
        flags: flags,
        deterministicSeed: seed,
        sessionID: sessionID,
        auditDirectory: directory,
        identityFile: directory.appendingPathComponent("identity.key"))
}

func makeEngine(flags: EngineFlags = [],
                seed: UInt64 = 0xCAE1_0500_0000_AAAA,
                sessionID: UInt64 = 0x1122_3344_5566_7788) throws -> EngineController {
    try installTestKeyProtection()
    let directory = try makeScratchDirectory()
    return try EngineController(
        configuration: makeConfiguration(directory: directory, flags: flags,
                                         seed: seed, sessionID: sessionID))
}

// MARK: Determinism comparison

/// Snapshot with the audit section neutralised: two engines writing to
/// different scratch directories legitimately differ in audit path and
/// chain head, everything else must be bit-identical for the same inputs.
func normalizedForDeterminism(_ snapshot: EngineSnapshot) -> EngineSnapshot {
    var copy = snapshot
    copy.audit = AuditSection(open: true, entries: 0, chainHead: "", path: "")
    return copy
}
