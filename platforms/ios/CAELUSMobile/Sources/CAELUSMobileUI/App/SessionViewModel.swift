//
//  SessionViewModel.swift
//  CAELUSMobileUI
//
//  MainActor view model for ONE live engine session.  All mutation goes
//  through the EngineController actor (which serialises native calls); this
//  type owns UI-facing state: the latest snapshot, audit status, derived
//  command-center summary, auto-advance control, and the critical-action
//  gate for user-intent confirmation.
//
#if os(iOS) && canImport(SwiftUI)
import CAELUSMobileCore
import Combine
import Foundation
import SwiftUI

/// User-visible session activity state.
public enum SessionRunState: Equatable {
    case paused
    case running
    case busy(String)
    case sealed
}

@MainActor
public final class SessionViewModel: ObservableObject, Identifiable {
    public let id = UUID()
    public let controller: EngineController
    public let scenarioName: String
    public let modelName: String?
    public let checkpointStore: CheckpointStore
    public let gate: CriticalActionGate

    @Published public private(set) var snapshot: EngineSnapshot?
    @Published public private(set) var summary: CommandCenterSummary?
    @Published public private(set) var auditStatus: AuditChainStatus?
    @Published public private(set) var runState: SessionRunState = .paused
    @Published public private(set) var lastError: String?
    @Published public private(set) var checkpoints: [CheckpointRecord] = []
    /// Cached layout, recomputed only when the topology changes.
    @Published public private(set) var mapLayout: CausalMapLayout?
    /// Ticks automatically advanced per second while running.
    @Published public var autoAdvanceInterval: TimeInterval = 2.0
    /// Ticks between automatic checkpoints (0 disables interval saves).
    @Published public var checkpointEveryTicks: UInt64 = 25

    private var autoAdvanceTask: Task<Void, Never>?
    private var lastCheckpointTick: UInt64 = 0
    private var topologyKey: String = ""

    public init(controller: EngineController,
                scenarioName: String,
                modelName: String?,
                checkpointStore: CheckpointStore,
                gate: CriticalActionGate) {
        self.controller = controller
        self.scenarioName = scenarioName
        self.modelName = modelName
        self.checkpointStore = checkpointStore
        self.gate = gate
    }

    // No deinit needed: the auto-advance task holds `self` weakly and exits
    // on its own once the model is gone or the state leaves `.running`.

    // MARK: State refresh

    /// Pull snapshot + audit status from the engine and refresh derived UI
    /// state.  Called after every mutating operation.
    public func refresh() async {
        do {
            let snapshot = try await controller.snapshot()
            let audit = try await controller.auditStatus()
            self.snapshot = snapshot
            self.summary = CommandCenterBuilder.summarize(snapshot)
            self.auditStatus = audit
            if audit.sealed { runState = .sealed }
            refreshLayoutIfTopologyChanged(snapshot)
            lastError = nil
        } catch {
            report(error)
        }
        checkpoints = (try? checkpointStore.records()) ?? []
    }

    private func refreshLayoutIfTopologyChanged(_ snapshot: EngineSnapshot) {
        let key = snapshot.nodes.map(\.id).joined(separator: "|") + "#"
            + snapshot.edges.map { "\($0.from)>\($0.to)" }.joined(separator: "|")
        guard key != topologyKey else { return }
        topologyKey = key
        mapLayout = CausalMapLayoutBuilder.layout(nodes: snapshot.nodes,
                                                  edges: snapshot.edges)
    }

    // MARK: Simulation control

    /// Advance `count` deterministic ticks.
    public func advance(_ count: UInt32 = 1) async {
        guard runState != .sealed else { return }
        let previous = runState
        runState = .busy("Advancing \(count) tick\(count == 1 ? "" : "s")")
        do {
            try await controller.tick(count)
            await refresh()
            await maybeIntervalCheckpoint()
        } catch {
            report(error)
        }
        if runState != .sealed {
            runState = previous == .running ? .running : .paused
        }
    }

    /// Continuous advance: one tick per `autoAdvanceInterval` seconds until
    /// paused, sealed, or an error occurs.
    public func resumeAutoAdvance() {
        guard runState == .paused else { return }
        runState = .running
        autoAdvanceTask?.cancel()
        // Task {} inherits the MainActor context, so state reads below are
        // ordinary synchronous accesses.
        autoAdvanceTask = Task { [weak self] in
            while !Task.isCancelled {
                guard let self, self.runState == .running else { return }
                await self.advance(1)
                let nanos = UInt64(self.autoAdvanceInterval * 1_000_000_000)
                try? await Task.sleep(nanoseconds: max(nanos, 250_000_000))
            }
        }
    }

    public func pauseAutoAdvance() {
        autoAdvanceTask?.cancel()
        autoAdvanceTask = nil
        if runState == .running { runState = .paused }
    }

    // MARK: Levers

    /// Apply a lever, requesting user-intent confirmation when the security
    /// policy marks it high-impact.  Returns the deterministic roll outcome
    /// or nil when the action was blocked/failed.
    public func applyLever(_ lever: Lever) async -> Bool? {
        guard runState != .sealed else { return nil }
        guard await gate.authorizeLever(lever) else {
            lastError = "Lever \(lever.id) not confirmed — action cancelled."
            return nil
        }
        runState = .busy("Applying \(lever.id)")
        defer { if runState != .sealed { runState = .paused } }
        do {
            let success = try await controller.applyLever(id: lever.id)
            await saveCheckpoint(trigger: .leverApplied)
            await refresh()
            return success
        } catch {
            report(error)
            return nil
        }
    }

    // MARK: Checkpoints

    /// Persist the current engine state.  Never throws into the UI: failure
    /// is surfaced through `lastError`.
    public func saveCheckpoint(trigger: CheckpointTrigger) async {
        do {
            let envelope = try await controller.checkpoint()
            let snapshot = try await controller.snapshot()
            try checkpointStore.save(envelope: envelope,
                                     trigger: trigger,
                                     tick: snapshot.tick,
                                     scenarioID: snapshot.scenario.id ?? "?")
            lastCheckpointTick = snapshot.tick
            checkpoints = (try? checkpointStore.records()) ?? []
        } catch {
            report(error)
        }
    }

    private func maybeIntervalCheckpoint() async {
        guard checkpointEveryTicks > 0, let tick = snapshot?.tick,
              tick >= lastCheckpointTick + checkpointEveryTicks else { return }
        await saveCheckpoint(trigger: .tickInterval)
    }

    // MARK: Lifecycle (scenePhase hooks)

    /// App moved to background: audit the transition and secure a restart
    /// point.  iOS may terminate the process at any moment afterwards.
    public func handleBackground() async {
        pauseAutoAdvance()
        try? await controller.noteLifecycle(.background)
        await saveCheckpoint(trigger: .background)
    }

    public func handleForeground() async {
        try? await controller.noteLifecycle(.foreground)
        await refresh()
    }

    // MARK: Export / seal

    /// Deterministic executive report for the current state.
    public func buildReport() async -> ExecutiveReport? {
        guard await gate.authorize(.exportReport,
                                   reason: "Export executive report") else {
            lastError = "Report export not confirmed — action cancelled."
            return nil
        }
        do {
            let snapshot = try await controller.snapshot()
            let audit = try await controller.auditStatus()
            let anchors = try? EngineController.trustAnchors()
            await saveCheckpoint(trigger: .beforeExport)
            return ExecutiveReportBuilder.build(snapshot: snapshot,
                                                auditStatus: audit,
                                                anchors: anchors)
        } catch {
            report(error)
            return nil
        }
    }

    /// Full audit NDJSON export (REPORT_EXPORTED is audited by the core).
    public func exportAuditChain() async -> Data? {
        do {
            return try await controller.exportAudit()
        } catch {
            report(error)
            return nil
        }
    }

    /// Seal the session: SEAL line written, no further audited operations.
    public func sealSession() async {
        pauseAutoAdvance()
        do {
            try await controller.sealSession()
            runState = .sealed
            await refresh()
        } catch {
            report(error)
        }
    }

    /// Shut the native session down (idempotent).
    public func shutdown() async {
        pauseAutoAdvance()
        await controller.shutdown()
    }

    // MARK: Error surface

    private func report(_ error: Error) {
        if let known = error as? CaelusMobileError {
            lastError = String(describing: known)
        } else {
            lastError = error.localizedDescription
        }
    }

    public func clearError() { lastError = nil }
}
#endif
