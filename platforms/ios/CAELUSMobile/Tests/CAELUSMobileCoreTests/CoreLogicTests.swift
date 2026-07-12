//
//  CoreLogicTests.swift
//  CAELUSMobileCoreTests
//
//  Pure-logic tests: fixed-point presentation, command-center derivation,
//  security policy gating, checkpoint store persistence, and executive
//  report determinism.  The snapshot-driven cases pull REAL snapshots from
//  the native core rather than hand-written JSON.
//
import Foundation
import XCTest
@testable import CAELUSMobileCore

final class FixedPointTests: XCTestCase {
    func testDecimalString() {
        XCTAssertEqual(FixedPoint.decimalString(1_000_000), "1.000")
        XCTAssertEqual(FixedPoint.decimalString(1_234_567), "1.234")
        XCTAssertEqual(FixedPoint.decimalString(-2_500_000), "-2.500")
        XCTAssertEqual(FixedPoint.decimalString(0), "0.000")
        XCTAssertEqual(FixedPoint.decimalString(999_999, fractionDigits: 6),
                       "0.999999")
        XCTAssertEqual(FixedPoint.decimalString(3_000_000, fractionDigits: 0),
                       "3")
    }

    func testPercentString() {
        XCTAssertEqual(FixedPoint.percentString(500_000), "50.0%")
        XCTAssertEqual(FixedPoint.percentString(1_000_000), "100.0%")
        XCTAssertEqual(FixedPoint.percentString(12_345, fractionDigits: 2),
                       "1.23%")
    }
}

final class SecurityPolicyTests: XCTestCase {
    struct RecordingAuthorizer: UserIntentAuthorizer {
        let answer: Bool
        func confirmIntent(for action: CriticalAction,
                           reason: String) async -> Bool { answer }
    }

    func testDefaultPolicyRequiresConfirmationEverywhere() {
        let policy = SecurityPolicy.default
        for action in CriticalAction.allCases {
            XCTAssertTrue(policy.requiresConfirmation(action))
        }
    }

    func testDenyAllAuthorizerFailsClosed() async {
        let gate = CriticalActionGate() // default: DenyAllAuthorizer
        let allowed = await gate.authorize(.exportReport, reason: "test")
        XCTAssertFalse(allowed)
    }

    func testUnrestrictedActionSkipsConfirmation() async {
        let policy = SecurityPolicy(actionsRequiringConfirmation: [])
        let gate = CriticalActionGate(policy: policy,
                                      authorizer: RecordingAuthorizer(answer: false))
        let allowed = await gate.authorize(.resetSession, reason: "test")
        XCTAssertTrue(allowed, "no confirmation required ⇒ allowed")
    }

    func testHighImpactLeverThresholdGatesConfirmation() async {
        let policy = SecurityPolicy(
            actionsRequiringConfirmation: [.applyHighImpactLever],
            highImpactLeverThresholdFP: 600_000)
        let lowImpact = Lever(id: "L1", target: "N", successProbabilityFP: 300_000,
                              costTicks: 1, lockoutTicks: 0, remainingLockout: 0,
                              available: true)
        let highImpact = Lever(id: "L2", target: "N", successProbabilityFP: 800_000,
                               costTicks: 1, lockoutTicks: 0, remainingLockout: 0,
                               available: true)
        XCTAssertFalse(policy.requiresConfirmation(for: lowImpact))
        XCTAssertTrue(policy.requiresConfirmation(for: highImpact))

        let denyGate = CriticalActionGate(policy: policy,
                                          authorizer: RecordingAuthorizer(answer: false))
        let confirmGate = CriticalActionGate(policy: policy,
                                             authorizer: RecordingAuthorizer(answer: true))
        let lowAllowed = await denyGate.authorizeLever(lowImpact)
        let highDenied = await denyGate.authorizeLever(highImpact)
        let highAllowed = await confirmGate.authorizeLever(highImpact)
        XCTAssertTrue(lowAllowed)
        XCTAssertFalse(highDenied)
        XCTAssertTrue(highAllowed)
    }

    func testPolicyRoundTripsThroughJSON() throws {
        let policy = SecurityPolicy(
            actionsRequiringConfirmation: [.exportReport, .resetSession],
            highImpactLeverThresholdFP: 750_000)
        let data = try JSONEncoder().encode(policy)
        let decoded = try JSONDecoder().decode(SecurityPolicy.self, from: data)
        XCTAssertEqual(policy, decoded)
    }
}

final class CheckpointStoreTests: XCTestCase {
    func testSaveLoadLatestRoundTrip() throws {
        let store = try CheckpointStore(directory: try makeScratchDirectory())
        let payload = Data("checkpoint-payload".utf8)
        let record = try store.save(envelope: payload, trigger: .manual,
                                    tick: 42, scenarioID: "BS-01")
        XCTAssertEqual(record.tick, 42)
        XCTAssertEqual(record.byteCount, payload.count)
        XCTAssertEqual(try store.latest()?.id, record.id)
        XCTAssertEqual(try store.load(id: record.id), payload)
    }

    func testRetentionPrunesOldestButKeepsLatest() throws {
        let store = try CheckpointStore(directory: try makeScratchDirectory(),
                                        retentionLimit: 3)
        var identifiers: [String] = []
        for index in 0..<5 {
            let record = try store.save(
                envelope: Data("payload-\(index)".utf8),
                trigger: .tickInterval, tick: UInt64(index),
                scenarioID: "BS-01",
                now: Date(timeIntervalSince1970: Double(1000 + index)))
            identifiers.append(record.id)
        }
        let kept = try store.records().map(\.id)
        XCTAssertEqual(kept.count, 3)
        XCTAssertEqual(kept, Array(identifiers.suffix(3)))
        // Pruned payloads are gone from disk.
        XCTAssertThrowsError(try store.load(id: identifiers[0]))
        // Latest is intact.
        XCTAssertEqual(try store.load(id: identifiers[4]),
                       Data("payload-4".utf8))
    }

    func testMissingCheckpointThrowsNotFound() throws {
        let store = try CheckpointStore(directory: try makeScratchDirectory())
        XCTAssertThrowsError(try store.load(id: "cp_none")) { error in
            XCTAssertEqual(error as? CheckpointStoreError,
                           .notFound(id: "cp_none"))
        }
    }

    func testResetRemovesEverything() throws {
        let store = try CheckpointStore(directory: try makeScratchDirectory())
        _ = try store.save(envelope: Data([1, 2, 3]), trigger: .manual,
                           tick: 1, scenarioID: "BS-01")
        try store.reset()
        XCTAssertNil(try store.latest())
    }
}

final class CommandCenterSummaryTests: XCTestCase {
    func testSummaryFromLiveSymbolicSnapshot() async throws {
        let controller = try makeEngine()
        defer { Task { await controller.shutdown() } }
        try await controller.loadScenario(Fixtures.scenarioBS01())
        try await controller.tick(6)
        let snapshot = try await controller.snapshot()

        let summary = CommandCenterBuilder.summarize(snapshot)
        XCTAssertEqual(summary.scenarioID, "BS-01_SAHTE_UFUK")
        XCTAssertTrue(summary.scenarioSignatureVerified)
        XCTAssertEqual(summary.tick, 6)
        XCTAssertEqual(
            summary.virtualMinutes,
            6 * UInt64(snapshot.scenario.tickMinutes ?? 0))
        XCTAssertEqual(summary.topFrictionSources.count, 3)
        // Sources are ranked by contribution, descending.
        let contributions = summary.topFrictionSources.map(\.contributionFP)
        XCTAssertEqual(contributions, contributions.sorted(by: >))
        XCTAssertEqual(summary.neuralMode, .symbolicOnly)
        XCTAssertNil(summary.outageRisk)
        XCTAssertTrue(summary.auditChainIntact)
    }

    func testSummaryFromLiveNeuralSnapshotCarriesRiskAndConfidence() async throws {
        let controller = try makeEngine(flags: [.neuralAssurance])
        defer { Task { await controller.shutdown() } }
        try await controller.loadScenario(Fixtures.scenarioBS01())
        try await controller.loadNeuralModel(
            manifest: Fixtures.modelManifest(),
            weights: Fixtures.modelWeights(),
            signature: Fixtures.modelSignature())
        try await controller.tick(9)
        let snapshot = try await controller.snapshot()

        let summary = CommandCenterBuilder.summarize(snapshot)
        XCTAssertEqual(summary.neuralMode, .assurance)
        XCTAssertNotNil(summary.outageRisk)
        XCTAssertNotNil(summary.neuralConfidenceFP)
        XCTAssertNotNil(summary.neuralOODFP)
        XCTAssertNotNil(summary.lastGateDecision)
    }

    func testRecommendedLeverPrefersGateSelection() throws {
        var snapshot = try minimalSnapshot()
        snapshot.levers = [
            Lever(id: "A", target: "N1", successProbabilityFP: 900_000,
                  costTicks: 1, lockoutTicks: 0, remainingLockout: 0,
                  available: true),
            Lever(id: "B", target: "N2", successProbabilityFP: 100_000,
                  costTicks: 1, lockoutTicks: 0, remainingLockout: 0,
                  available: true),
        ]
        snapshot.neural.selectedLeverID = "B"
        XCTAssertEqual(CommandCenterBuilder.recommendedLever(snapshot), "B")

        // Gate-selected lever in lockout ⇒ falls back to best applicable.
        snapshot.levers[1].remainingLockout = 3
        XCTAssertEqual(CommandCenterBuilder.recommendedLever(snapshot), "A")

        // No applicable levers ⇒ none.
        snapshot.levers[0].available = false
        XCTAssertNil(CommandCenterBuilder.recommendedLever(snapshot))
    }

    /// Decoded minimal snapshot used for pure ranking tests.
    private func minimalSnapshot() throws -> EngineSnapshot {
        let json = """
        {"type":"CAELUS_MOBILE_SNAPSHOT_V1","abi_version":1,
         "engine_version":"2.0.0","session_id":"0000000000000000","tick":0,
         "friction_fp":1000000,"friction_clamped_fp":1000000,
         "regime_exceeded":false,"outage_active":false,
         "has_intel_risk":false,"last_intel_risk_fp":0,
         "pending_intel_events":0,
         "scenario":{"loaded":false},
         "neural":{"mode":"SYMBOLIC_ONLY","model_loaded":false,
                   "model_status":"NOT_LOADED"},
         "nodes":[],"edges":[],"levers":[],"hysteresis":[],
         "feedback_loops":[],
         "audit":{"open":true,"entries":1,"chain_head":"00","path":"/tmp/a"}}
        """
        return try EngineSnapshot.decode(from: Data(json.utf8))
    }
}

final class ExecutiveReportTests: XCTestCase {
    func testReportIsDeterministicAndCarriesCoreSections() async throws {
        let controller = try makeEngine()
        defer { Task { await controller.shutdown() } }
        try await controller.loadScenario(Fixtures.scenarioBS01())
        try await controller.tick(5)
        let snapshot = try await controller.snapshot()
        let audit = try await controller.auditStatus()
        let anchors = try EngineController.trustAnchors()

        let first = ExecutiveReportBuilder.build(snapshot: snapshot,
                                                 auditStatus: audit,
                                                 anchors: anchors)
        let second = ExecutiveReportBuilder.build(snapshot: snapshot,
                                                  auditStatus: audit,
                                                  anchors: anchors)
        XCTAssertEqual(first, second, "report must be a pure function")

        XCTAssertTrue(first.markdown.contains("# CAELUS Mobile — Executive Report"))
        XCTAssertTrue(first.markdown.contains("BS-01_SAHTE_UFUK"))
        XCTAssertTrue(first.markdown.contains("## Operational state"))
        XCTAssertTrue(first.markdown.contains("## Audit integrity"))
        XCTAssertTrue(first.markdown.contains(audit.chainHead))
        XCTAssertTrue(first.markdown.contains(anchors.scenarioPublicKeyHex))
        XCTAssertTrue(first.markdown.contains("Only authoritative state drives decisions"))
        XCTAssertEqual(first.suggestedFileName,
                       "caelus_report_BS-01_SAHTE_UFUK_t5.md")
    }
}
