//
//  EngineControllerTests.swift
//  CAELUSMobileCoreTests
//
//  End-to-end tests of the Swift engine access layer against the REAL
//  native core: lifecycle, trust gates, ticks, levers, determinism,
//  checkpointing, audit, and typed error mapping.
//
import Foundation
import XCTest
@testable import CAELUSMobileCore

final class EngineControllerTests: XCTestCase {

    // MARK: Lifecycle

    func testCreateShutdownLifecycle() async throws {
        let controller = try makeEngine()
        let status = try await controller.auditStatus()
        XCTAssertTrue(status.open)
        XCTAssertGreaterThan(status.entries, 0) // SESSION_START at minimum
        XCTAssertEqual(status.sessionID, "1122334455667788")

        await controller.shutdown()
        do {
            _ = try await controller.snapshot()
            XCTFail("calls after shutdown must throw")
        } catch let error as CaelusMobileError {
            XCTAssertEqual(error, .engineUnavailable)
        }
        // Second shutdown is a safe no-op.
        await controller.shutdown()
    }

    func testTrustAnchorsExposeCompiledKeys() throws {
        let anchors = try EngineController.trustAnchors()
        XCTAssertEqual(anchors.type, "CAELUS_MOBILE_TRUST_ANCHORS_V1")
        XCTAssertEqual(anchors.abiVersion, 1)
        XCTAssertEqual(
            anchors.scenarioPublicKeyHex,
            "9bb1dbd039043670b7bf2c5d75337778"
                + "66135b92f9b38fe6cd8d9735a04fa802")
        XCTAssertEqual(
            anchors.neuralPublicKeyHex,
            "c8527f9105465967aea81d07514ea11f"
                + "597f32fedc7d6f8f9e7d182f999fc51f")
    }

    func testBlake3MatchesOfficialVector() throws {
        let digest = try EngineController.blake3(Data("abc".utf8))
        let hex = digest.map { String(format: "%02x", $0) }.joined()
        XCTAssertEqual(
            hex,
            "6437b3ac38465133ffb63b75273a8db5"
                + "48c558465d79db03fd359c6cd5bd9d85")
    }

    // MARK: Scenario gate

    func testSignedScenarioLoadsAndSnapshotDecodes() async throws {
        let controller = try makeEngine()
        defer { Task { await controller.shutdown() } }
        try await controller.loadScenario(Fixtures.scenarioBS01())

        let snapshot = try await controller.snapshot()
        XCTAssertEqual(snapshot.type, EngineSnapshot.expectedType)
        XCTAssertTrue(snapshot.scenario.loaded)
        XCTAssertEqual(snapshot.scenario.id, "BS-01_SAHTE_UFUK")
        XCTAssertTrue(snapshot.scenario.signatureVerified)
        XCTAssertEqual(snapshot.scenario.scenarioHash?.count, 64)
        XCTAssertEqual(snapshot.nodes.count, 7)
        XCTAssertEqual(snapshot.edges.count, 7)
        XCTAssertEqual(snapshot.levers.count, 4)
        XCTAssertEqual(snapshot.hysteresis.count, 1)
        XCTAssertEqual(snapshot.tick, 0)
        XCTAssertEqual(snapshot.neural.mode, .symbolicOnly)
    }

    func testTamperedScenarioIsRejectedWithTypedError() async throws {
        let controller = try makeEngine()
        defer { Task { await controller.shutdown() } }

        // Flip one digit INSIDE the signed critical region
        // (extended_causal_model): a lever success probability.  Fields
        // outside the canonical signed payload (e.g. meta.title) are not
        // signature-protected by design.
        let original = Data("\"success_p_fp\": 750000".utf8)
        let replacement = Data("\"success_p_fp\": 750001".utf8)
        var tampered = try Fixtures.scenarioBS01()
        guard let range = tampered.range(of: original) else {
            return XCTFail("fixture should contain the lever probability")
        }
        tampered.replaceSubrange(range, with: replacement)

        do {
            try await controller.loadScenario(tampered)
            XCTFail("tampered scenario must be rejected")
        } catch let error as CaelusMobileError {
            guard case .scenarioRejected(let detail) = error else {
                return XCTFail("expected scenarioRejected, got \(error)")
            }
            XCTAssertFalse(detail.isEmpty)
        }

        // Engine stays in blank pre-scenario state, then accepts the valid pack.
        try await controller.loadScenario(Fixtures.scenarioBS01())
    }

    func testTickBeforeScenarioIsALifecycleViolation() async throws {
        let controller = try makeEngine()
        defer { Task { await controller.shutdown() } }
        do {
            try await controller.tick()
            XCTFail("tick before scenario must fail")
        } catch let error as CaelusMobileError {
            guard case .lifecycleViolation = error else {
                return XCTFail("expected lifecycleViolation, got \(error)")
            }
        }
    }

    // MARK: Neural model gate

    func testSignedNeuralModelLoadsAndProducesGatedEvidence() async throws {
        let controller = try makeEngine(flags: [.neuralAssurance])
        defer { Task { await controller.shutdown() } }
        try await controller.loadScenario(Fixtures.scenarioBS01())
        try await controller.loadNeuralModel(
            manifest: Fixtures.modelManifest(),
            weights: Fixtures.modelWeights(),
            signature: Fixtures.modelSignature())

        // Temporal window: ≥ 8 observed ticks before inference can gate.
        try await controller.tick(9)
        let snapshot = try await controller.snapshot()
        XCTAssertEqual(snapshot.neural.mode, .assurance)
        XCTAssertTrue(snapshot.neural.modelLoaded)
        XCTAssertEqual(snapshot.neural.modelHash?.count, 64)
        XCTAssertNotNil(snapshot.neural.lastGateDecision)
        XCTAssertNotNil(snapshot.neural.nodes)
        XCTAssertEqual(snapshot.neural.nodes?.count, snapshot.nodes.count)
    }

    func testTamperedModelWeightsAreRejectedFailClosed() async throws {
        let controller = try makeEngine(flags: [.neuralAssurance])
        defer { Task { await controller.shutdown() } }
        try await controller.loadScenario(Fixtures.scenarioBS01())

        var weights = try Fixtures.modelWeights()
        weights[weights.count / 2] ^= 0x01
        do {
            try await controller.loadNeuralModel(
                manifest: Fixtures.modelManifest(),
                weights: weights,
                signature: Fixtures.modelSignature())
            XCTFail("tampered weights must be rejected")
        } catch let error as CaelusMobileError {
            guard case .modelRejected = error else {
                return XCTFail("expected modelRejected, got \(error)")
            }
        }

        // Fail-closed: engine continues symbolic-only.
        try await controller.tick(2)
        let snapshot = try await controller.snapshot()
        XCTAssertEqual(snapshot.neural.mode, .symbolicOnly)
        XCTAssertFalse(snapshot.neural.modelLoaded)
    }

    func testModelWithoutAssuranceFlagIsALifecycleViolation() async throws {
        let controller = try makeEngine() // no neuralAssurance flag
        defer { Task { await controller.shutdown() } }
        try await controller.loadScenario(Fixtures.scenarioBS01())
        do {
            try await controller.loadNeuralModel(
                manifest: Fixtures.modelManifest(),
                weights: Fixtures.modelWeights(),
                signature: Fixtures.modelSignature())
            XCTFail("model load without the assurance flag must fail")
        } catch let error as CaelusMobileError {
            guard case .lifecycleViolation = error else {
                return XCTFail("expected lifecycleViolation, got \(error)")
            }
        }
    }

    // MARK: Simulation + levers

    func testDeterministicReplayProducesIdenticalState() async throws {
        let first = try makeEngine()
        let second = try makeEngine()
        defer {
            Task {
                await first.shutdown()
                await second.shutdown()
            }
        }
        for controller in [first, second] {
            try await controller.loadScenario(Fixtures.scenarioBS01())
            try await controller.tick(12)
        }
        let snapshotA = normalizedForDeterminism(try await first.snapshot())
        let snapshotB = normalizedForDeterminism(try await second.snapshot())
        XCTAssertEqual(snapshotA, snapshotB)
        XCTAssertEqual(snapshotA.tick, 12)
    }

    func testApplyLeverMutatesStateAndUnknownLeverThrows() async throws {
        let controller = try makeEngine()
        defer { Task { await controller.shutdown() } }
        try await controller.loadScenario(Fixtures.scenarioBS01())
        try await controller.tick(3)

        let before = try await controller.snapshot()
        guard let lever = before.levers.first(where: \.applicable) else {
            return XCTFail("BS-01 must expose an applicable lever")
        }
        _ = try await controller.applyLever(id: lever.id)
        let after = try await controller.snapshot()
        let leverAfter = after.levers.first { $0.id == lever.id }
        XCTAssertNotNil(leverAfter)
        if lever.lockoutTicks > 0 {
            XCTAssertGreaterThan(leverAfter!.remainingLockout, 0)
        }

        do {
            _ = try await controller.applyLever(id: "NO_SUCH_LEVER")
            XCTFail("unknown lever must throw")
        } catch let error as CaelusMobileError {
            guard case .leverUnknown = error else {
                return XCTFail("expected leverUnknown, got \(error)")
            }
        }
    }

    // MARK: Checkpoint / restore

    func testCheckpointRestoreIsBitExactResume() async throws {
        let original = try makeEngine()
        defer { Task { await original.shutdown() } }
        try await original.loadScenario(Fixtures.scenarioBS01())
        try await original.tick(4)
        let envelope = try await original.checkpoint()
        try await original.tick(3)
        let target = normalizedForDeterminism(try await original.snapshot())

        let restored = try await SessionRestorer.restore(
            configuration: makeConfiguration(
                directory: try makeScratchDirectory()),
            scenarioJSON: Fixtures.scenarioBS01(),
            checkpointEnvelope: envelope)
        defer { Task { await restored.shutdown() } }
        try await restored.tick(3)
        let resumedSnapshot = normalizedForDeterminism(try await restored.snapshot())

        XCTAssertEqual(target, resumedSnapshot)
        XCTAssertEqual(resumedSnapshot.tick, 7)
    }

    func testCorruptCheckpointIsRejected() async throws {
        let original = try makeEngine()
        defer { Task { await original.shutdown() } }
        try await original.loadScenario(Fixtures.scenarioBS01())
        try await original.tick(2)
        var envelope = try await original.checkpoint()

        // Flip a byte in the middle of the payload (state region).
        envelope[envelope.count / 2] ^= 0x01

        let fresh = try makeEngine()
        defer { Task { await fresh.shutdown() } }
        try await fresh.loadScenario(Fixtures.scenarioBS01())
        do {
            try await fresh.restoreCheckpoint(envelope)
            XCTFail("corrupt checkpoint must be rejected")
        } catch let error as CaelusMobileError {
            switch error {
            case .checkpointInvalid, .checkpointIncompatible:
                break
            default:
                XCTFail("expected checkpoint rejection, got \(error)")
            }
        }
    }

    func testCheckpointRejectedAgainstDifferentScenario() async throws {
        let original = try makeEngine()
        defer { Task { await original.shutdown() } }
        try await original.loadScenario(Fixtures.scenarioBS01())
        try await original.tick(2)
        let envelope = try await original.checkpoint()

        let other = try makeEngine()
        defer { Task { await other.shutdown() } }
        try await other.loadScenario(Fixtures.scenarioBS02())
        do {
            try await other.restoreCheckpoint(envelope)
            XCTFail("checkpoint bound to BS-01 must not restore into BS-02")
        } catch let error as CaelusMobileError {
            guard case .checkpointIncompatible = error else {
                return XCTFail("expected checkpointIncompatible, got \(error)")
            }
        }
    }

    // MARK: Audit

    func testAuditSurfaceAndLifecycleNotes() async throws {
        let controller = try makeEngine()
        defer { Task { await controller.shutdown() } }
        try await controller.loadScenario(Fixtures.scenarioBS01())
        try await controller.tick(1)

        try await controller.noteLifecycle(.background)
        try await controller.noteLifecycle(.foreground)

        let path = try await controller.auditPath()
        XCTAssertTrue(FileManager.default.fileExists(atPath: path))

        let before = try await controller.auditStatus()
        let export = try await controller.exportAudit()
        XCTAssertGreaterThan(export.count, 0)
        let text = String(decoding: export, as: UTF8.self)
        XCTAssertTrue(text.contains("APP_LIFECYCLE"))
        XCTAssertTrue(text.contains("SCENARIO_ACTIVATED"))
        XCTAssertTrue(text.contains("MOBILE_TICK"))

        let after = try await controller.auditStatus()
        XCTAssertEqual(after.entries, before.entries + 1) // REPORT_EXPORTED
        XCTAssertNotEqual(after.chainHead, before.chainHead)

        try await controller.sealSession()
        let sealed = try await controller.auditStatus()
        XCTAssertTrue(sealed.sealed)
        XCTAssertTrue(sealed.open, "chain stays readable for export after seal")
        // Audited operations now fail closed: lifecycle notes hit the audit
        // gate, ticks are refused at the lifecycle gate.
        do {
            try await controller.noteLifecycle(.foreground)
            XCTFail("lifecycle note after seal must fail")
        } catch let error as CaelusMobileError {
            guard case .auditFailure = error else {
                return XCTFail("expected auditFailure, got \(error)")
            }
        }
        do {
            try await controller.tick(1)
            XCTFail("tick after seal must fail")
        } catch let error as CaelusMobileError {
            guard case .lifecycleViolation = error else {
                return XCTFail("expected lifecycleViolation, got \(error)")
            }
        }
    }

    // MARK: Input limit mapping

    func testOversizedInputsFailFastWithTypedErrors() async throws {
        let controller = try makeEngine()
        defer { Task { await controller.shutdown() } }
        do {
            try await controller.loadScenario(
                Data(count: EngineLimits.maxScenarioBytes + 1))
            XCTFail("oversized scenario must fail")
        } catch let error as CaelusMobileError {
            guard case .inputTooLarge = error else {
                return XCTFail("expected inputTooLarge, got \(error)")
            }
        }
        do {
            _ = try await controller.applyLever(
                id: String(repeating: "x", count: EngineLimits.maxLeverIDBytes + 1))
            XCTFail("oversized lever id must fail")
        } catch let error as CaelusMobileError {
            guard case .inputTooLarge = error else {
                return XCTFail("expected inputTooLarge, got \(error)")
            }
        }
    }
}
