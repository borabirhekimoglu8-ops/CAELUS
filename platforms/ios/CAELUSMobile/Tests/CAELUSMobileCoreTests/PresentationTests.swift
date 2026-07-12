//
//  PresentationTests.swift
//  CAELUSMobileCoreTests
//
//  Linux-run tests for the presentation-support components added for the
//  UI layer: scenario/model library store, deterministic causal-map
//  layout, and the audit NDJSON browser.
//
import Foundation
import XCTest
@testable import CAELUSMobileCore

// MARK: - ScenarioStore

final class ScenarioStoreTests: XCTestCase {
    private func makeStore() throws -> ScenarioStore {
        try ScenarioStore(directory: try makeScratchDirectory())
    }

    func testScenarioImportListReadDelete() throws {
        let store = try makeStore()
        XCTAssertTrue(store.scenarios().isEmpty)

        let payload = try Fixtures.scenarioBS01()
        let stored = try store.importScenario(data: payload,
                                              preferredName: "BS-01_SAHTE_UFUK")
        XCTAssertEqual(stored.id, "BS-01_SAHTE_UFUK")
        XCTAssertEqual(stored.byteCount, payload.count)

        let listed = store.scenarios()
        XCTAssertEqual(listed.map(\.id), ["BS-01_SAHTE_UFUK"])
        XCTAssertEqual(try store.readScenario(named: "BS-01_SAHTE_UFUK"),
                       payload)

        try store.deleteScenario(named: "BS-01_SAHTE_UFUK")
        XCTAssertTrue(store.scenarios().isEmpty)
    }

    func testNameSanitizationBlocksTraversal() throws {
        let store = try makeStore()
        let stored = try store.importScenario(
            data: Data("{}".utf8), preferredName: "../../etc/passwd")
        // Path separators are neutralised; the file stays inside the store.
        XCTAssertFalse(stored.id.contains("/"))
        XCTAssertFalse(stored.id.contains(".."))
        XCTAssertTrue(stored.url.path.hasPrefix(store.directory.path))

        XCTAssertThrowsError(try store.importScenario(
            data: Data("{}".utf8), preferredName: "..")) { error in
            guard case ScenarioStoreError.invalidName = error else {
                return XCTFail("expected invalidName, got \(error)")
            }
        }
    }

    func testOversizedScenarioIsRejected() throws {
        let store = try makeStore()
        let oversized = Data(count: EngineLimits.maxScenarioBytes + 1)
        XCTAssertThrowsError(try store.importScenario(
            data: oversized, preferredName: "big")) { error in
            guard case ScenarioStoreError.tooLarge = error else {
                return XCTFail("expected tooLarge, got \(error)")
            }
        }
    }

    func testModelPackageRoundTrip() throws {
        let store = try makeStore()
        XCTAssertTrue(store.models().isEmpty)

        let manifest = try Fixtures.modelManifest()
        let weights = try Fixtures.modelWeights()
        let signature = try Fixtures.modelSignature()
        let stored = try store.importModel(manifest: manifest,
                                           weights: weights,
                                           signature: signature,
                                           preferredName: "assurance_v1")
        XCTAssertEqual(stored.id, "assurance_v1")
        XCTAssertEqual(store.models().map(\.id), ["assurance_v1"])

        let package = try store.readModel(named: "assurance_v1")
        XCTAssertEqual(package.manifest, manifest)
        XCTAssertEqual(package.weights, weights)
        XCTAssertEqual(package.signature, signature)

        try store.deleteModel(named: "assurance_v1")
        XCTAssertTrue(store.models().isEmpty)
        XCTAssertThrowsError(try store.readModel(named: "assurance_v1"))
    }
}

// MARK: - Causal map layout

final class CausalMapLayoutTests: XCTestCase {
    private func node(_ id: String, kind: NodeKind = .service) -> GraphNode {
        GraphNode(id: id, kind: kind, capacityFP: 1_000_000,
                  stateFP: 500_000, reportedStateFP: 500_000,
                  trustFP: 1_000_000, weightFP: 1_000_000,
                  deadlineTick: -1, deadlineMissed: false,
                  irrecoverable: false)
    }

    private func edge(_ from: String, _ to: String) -> GraphEdge {
        GraphEdge(from: from, to: to, multiplierFP: 1_000_000,
                  lagTicks: 0, active: true)
    }

    func testLayeringFollowsCausality() {
        // A → B → C plus A → C: C must sit on the LONGEST path layer (2).
        let layout = CausalMapLayoutBuilder.layout(
            nodes: [node("A"), node("B"), node("C")],
            edges: [edge("A", "B"), edge("B", "C"), edge("A", "C")])
        XCTAssertEqual(layout.layerCount, 3)
        XCTAssertEqual(layout.placement(of: "A")?.layer, 0)
        XCTAssertEqual(layout.placement(of: "B")?.layer, 1)
        XCTAssertEqual(layout.placement(of: "C")?.layer, 2)
        // Left-to-right causality in unit space.
        XCTAssertEqual(layout.placement(of: "A")?.unitX, 0.0)
        XCTAssertEqual(layout.placement(of: "C")?.unitX, 1.0)
    }

    func testLayoutIsDeterministicRegardlessOfInputOrder(){
        let nodes = [node("N3"), node("N1"), node("N2")]
        let edges = [edge("N1", "N2"), edge("N2", "N3")]
        let first = CausalMapLayoutBuilder.layout(nodes: nodes, edges: edges)
        let second = CausalMapLayoutBuilder.layout(nodes: nodes.reversed(),
                                                   edges: edges.reversed())
        XCTAssertEqual(first, second)
    }

    func testCycleMembersLandInFinalLayer() {
        // A → B → C → B  (B,C cycle) — the cycle must not hang the builder.
        let layout = CausalMapLayoutBuilder.layout(
            nodes: [node("A"), node("B"), node("C")],
            edges: [edge("A", "B"), edge("B", "C"), edge("C", "B")])
        XCTAssertEqual(layout.placement(of: "A")?.layer, 0)
        let bLayer = layout.placement(of: "B")?.layer ?? -1
        let cLayer = layout.placement(of: "C")?.layer ?? -1
        XCTAssertEqual(bLayer, cLayer, "cycle members share the final layer")
        XCTAssertGreaterThan(bLayer, 0)
    }

    func testUpstreamPathAndDetailLevels() {
        let edges = [edge("A", "B"), edge("B", "C"), edge("X", "C")]
        let upstream = CausalMapLayoutBuilder.upstreamNodeIDs(of: "C",
                                                              edges: edges)
        XCTAssertEqual(upstream, ["A", "B", "X"])
        XCTAssertEqual(CausalMapLayoutBuilder.upstreamNodeIDs(of: "A",
                                                              edges: edges),
                       [])
        XCTAssertEqual(MapDetailLevel.forNodeCount(7), .full)
        XCTAssertEqual(MapDetailLevel.forNodeCount(40), .reduced)
        XCTAssertEqual(MapDetailLevel.forNodeCount(200), .minimal)
    }

    func testRealScenarioTopologyLaysOutEveryNode() async throws {
        let controller = try makeEngine()
        defer { Task { await controller.shutdown() } }
        try await controller.loadScenario(Fixtures.scenarioBS01())
        let snapshot = try await controller.snapshot()
        let layout = CausalMapLayoutBuilder.layout(nodes: snapshot.nodes,
                                                   edges: snapshot.edges)
        XCTAssertEqual(layout.placements.count, snapshot.nodes.count)
        for placement in layout.placements {
            XCTAssertGreaterThanOrEqual(placement.unitX, 0)
            XCTAssertLessThanOrEqual(placement.unitX, 1)
            XCTAssertGreaterThanOrEqual(placement.unitY, 0)
            XCTAssertLessThanOrEqual(placement.unitY, 1)
        }
    }
}

// MARK: - Audit browser

final class AuditBrowserTests: XCTestCase {
    func testParsesRealExportedChain() async throws {
        let controller = try makeEngine()
        try await controller.loadScenario(Fixtures.scenarioBS01())
        try await controller.tick(2)
        let ndjson = try await controller.exportAudit()
        await controller.shutdown()

        let records = AuditBrowser.parse(ndjson: ndjson)
        XCTAssertGreaterThanOrEqual(records.count, 3)
        XCTAssertEqual(records.first?.kind, "GENESIS")
        XCTAssertEqual(records.first?.seq, 0)
        // Chain sequence must be strictly increasing.
        let seqs = records.map(\.seq)
        XCTAssertEqual(seqs, seqs.sorted())
        // The scenario activation event is present with its type surfaced.
        XCTAssertTrue(records.contains {
            $0.eventType == "SCENARIO_ACTIVATED"
        })
        // Every parsed record carries the chain hash.
        for record in records where record.kind != "UNPARSEABLE" {
            XCTAssertEqual(record.hashHex.count, 64)
        }
    }

    func testMalformedLinesSurfaceAsUnparseable() {
        let mixed = Data("""
        {"seq":0,"ts":1,"type":"GENESIS","session_id":"ab","hash":"00"}
        this is not json
        {"seq":1,"ts":2,"type":"EVENT","hash":"11","event":{"type":"X","k":"v"}}
        """.utf8)
        let records = AuditBrowser.parse(ndjson: mixed)
        XCTAssertEqual(records.count, 3)
        XCTAssertEqual(records[0].kind, "GENESIS")
        XCTAssertEqual(records[1].kind, "UNPARSEABLE")
        XCTAssertTrue(records[1].detail.contains("not json"))
        XCTAssertEqual(records[2].eventType, "X")
        XCTAssertEqual(records[2].detail, "k=v")
    }
}
