//
//  Demo.swift — caelus-mobile-demo
//
//  Headless BS-01 SAHTE UFUK end-to-end demonstration through the EXACT
//  mobile stack: Swift EngineController → stable C ABI → shared C++ causal
//  engine + Rust security/audit core.  This is the Linux-runnable
//  equivalent of the Phase-17 iPhone demo flow; the SwiftUI app drives the
//  same EngineController API.
//
//  Steps (mirrors the product demonstration script):
//    offline launch → verify+load signed scenario → verify+load signed
//    neural model → observe reported state → deterministic ticks →
//    telemetry inconsistency → neural estimate + confidence/OOD → Neural
//    Gate → symbolic authority → outage risk → lever ranking →
//    deterministic what-if → authorization gate → apply lever → resulting
//    transition → checkpoint → terminate → restore exact session →
//    audit-verifiable export.  Negative paths (tampered scenario, tampered
//    model, corrupt checkpoint) must fail closed.
//
//  Exit code 0 = every step passed; any failure aborts with code 1.
//
import CAELUSMobileCore
import Foundation

// MARK: Harness plumbing

private var stepCounter = 0
private func step(_ title: String) {
    stepCounter += 1
    print(String(format: "[%02d] %@", stepCounter, title))
}

private func fail(_ message: String) -> Never {
    print("[DEMO FAIL] \(message)")
    exit(1)
}

private func require(_ condition: Bool, _ message: String) {
    if !condition { fail(message) }
}

private struct DemoKeyProtection: KeyProtectionProvider {
    // XOR masking: registration/round-trip plumbing only.  On device the
    // KeychainKeyProtection provider wraps with a Keychain-guarded key.
    static let mask: UInt8 = 0xA5
    static let format: UInt32 = 0x0000_0004

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

private let repoRoot: URL = {
    if let env = ProcessInfo.processInfo.environment["CAELUS_REPO_ROOT"],
       !env.isEmpty {
        return URL(fileURLWithPath: env)
    }
    return URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent() // CaelusMobileDemo
        .deletingLastPathComponent() // Sources
        .deletingLastPathComponent() // CAELUSMobile
        .deletingLastPathComponent() // ios
        .deletingLastPathComponent() // platforms
        .deletingLastPathComponent() // repo root
}()

private func fixture(_ relative: String) -> Data {
    guard let data = try? Data(contentsOf: repoRoot.appendingPathComponent(relative)) else {
        fail("fixture missing: \(relative)")
    }
    return data
}

private func scratchDirectory(_ label: String) -> URL {
    let url = FileManager.default.temporaryDirectory
        .appendingPathComponent("caelus_demo_\(label)_\(UUID().uuidString)")
    do {
        try FileManager.default.createDirectory(
            at: url, withIntermediateDirectories: true)
    } catch {
        fail("cannot create scratch directory: \(error)")
    }
    return url
}

private struct AutoConfirmAuthorizer: UserIntentAuthorizer {
    func confirmIntent(for action: CriticalAction,
                       reason: String) async -> Bool {
        print("     [AUTH] confirmed: \(action.rawValue) — \(reason)")
        return true
    }
}

// MARK: Demo body

@main
struct Demo {
    static func main() async {
        let scenarioBytes = fixture("scenarios/BS-01_SAHTE_UFUK.json")
        let manifestBytes = fixture("models/assurance_v1/manifest.json")
        let weightsBytes = fixture("models/assurance_v1/weights.bin")
        let signatureBytes = fixture("models/assurance_v1/model.sig")

        step("Offline launch: platform key protection installed, no network APIs linked")
        do { try KeyProtectionRegistry.install(DemoKeyProtection()) } catch {
            fail("key protection registration failed: \(error)")
        }

        let sessionDirectory = scratchDirectory("session")
        let identityFile = sessionDirectory.appendingPathComponent("identity.key")
        let controller: EngineController
        do {
            controller = try EngineController(configuration: EngineConfiguration(
                flags: [.neuralAssurance],
                deterministicSeed: 0xB501_DE30_0000_0001,
                sessionID: 0x2025_0712_0000_0001,
                auditDirectory: sessionDirectory,
                identityFile: identityFile))
        } catch {
            fail("engine creation failed: \(error)")
        }

        step("Verify + load the SIGNED BS-01 scenario")
        do { try await controller.loadScenario(scenarioBytes) } catch {
            fail("signed scenario rejected: \(error)")
        }

        step("Reject a TAMPERED scenario byte (fail-closed check)")
        do {
            let rejector = try EngineController(configuration: EngineConfiguration(
                flags: [],
                deterministicSeed: 1,
                sessionID: 0x2025_0712_0000_0002,
                auditDirectory: scratchDirectory("tamper"),
                identityFile: identityFile))
            // Tamper INSIDE the signed critical region
            // (extended_causal_model): one digit of a lever probability.
            var tampered = scenarioBytes
            let original = Data("\"success_p_fp\": 750000".utf8)
            guard let range = tampered.range(of: original) else {
                fail("scenario fixture missing the lever probability marker")
            }
            tampered.replaceSubrange(
                range, with: Data("\"success_p_fp\": 750001".utf8))
            do {
                try await rejector.loadScenario(tampered)
                fail("tampered scenario was ACCEPTED")
            } catch CaelusMobileError.scenarioRejected {
                await rejector.shutdown()
            }
        } catch { fail("tamper harness setup failed: \(error)") }

        step("Verify + load the SIGNED deterministic neural model")
        do {
            try await controller.loadNeuralModel(manifest: manifestBytes,
                                                 weights: weightsBytes,
                                                 signature: signatureBytes)
        } catch {
            fail("signed model rejected: \(error)")
        }

        step("Reject TAMPERED model weights (fail-closed check)")
        do {
            let rejector = try EngineController(configuration: EngineConfiguration(
                flags: [.neuralAssurance],
                deterministicSeed: 1,
                sessionID: 0x2025_0712_0000_0003,
                auditDirectory: scratchDirectory("model_tamper"),
                identityFile: identityFile))
            try await rejector.loadScenario(scenarioBytes)
            var badWeights = weightsBytes
            badWeights[badWeights.count / 2] ^= 0x01
            do {
                try await rejector.loadNeuralModel(manifest: manifestBytes,
                                                   weights: badWeights,
                                                   signature: signatureBytes)
                fail("tampered model was ACCEPTED")
            } catch CaelusMobileError.modelRejected {
                let snapshot = try await rejector.snapshot()
                require(snapshot.neural.mode == .symbolicOnly,
                        "rejection must leave engine symbolic-only")
                await rejector.shutdown()
            }
        } catch { fail("model tamper harness failed: \(error)") }

        step("Show REPORTED operational state (pre-tick snapshot)")
        var snapshot: EngineSnapshot
        do { snapshot = try await controller.snapshot() } catch {
            fail("snapshot failed: \(error)")
        }
        require(snapshot.scenario.signatureVerified, "scenario must be VERIFIED")
        require(snapshot.neural.modelLoaded, "model must be loaded")
        print("     scenario=\(snapshot.scenario.id ?? "?") nodes=\(snapshot.nodes.count) levers=\(snapshot.levers.count)")

        step("Advance deterministic ticks (observation window)")
        do { try await controller.tick(9) } catch {
            fail("tick failed: \(error)")
        }
        do { snapshot = try await controller.snapshot() } catch {
            fail("snapshot failed: \(error)")
        }
        require(snapshot.tick == 9, "tick counter must be 9")

        step("Detect telemetry inconsistency (reported vs authoritative)")
        let summary = CommandCenterBuilder.summarize(snapshot)
        let deviated = snapshot.nodes.filter { $0.reportedDeviationFP != 0 }
        print("     nodes with reported/authoritative deviation: \(deviated.count)")

        step("Display NEURAL ESTIMATED state (advisory evidence)")
        guard let estimates = snapshot.neural.nodes, !estimates.isEmpty else {
            fail("neural evidence missing after observation window")
        }
        print("     estimates=\(estimates.count) nodes")

        step("Display confidence and OOD score")
        guard let confidence = snapshot.neural.confidenceMinFP,
              let ood = snapshot.neural.oodMaxFP else {
            fail("confidence/OOD missing from gated evidence")
        }
        print("     confidence(min)=\(FixedPoint.percentString(confidence)) ood(max)=\(FixedPoint.percentString(ood))")

        step("Neural Gate decision recorded and audited")
        guard let decision = snapshot.neural.lastGateDecision else {
            fail("gate decision missing")
        }
        print("     decision=\(decision.rawValue)")

        step("Symbolic state remains AUTHORITATIVE")
        guard let committed = snapshot.neural.authorityCommitted else {
            fail("authority commitment must be reported")
        }
        print("     authority_committed=\(committed)")

        step("Display multi-horizon outage risk")
        guard let risk = summary.outageRisk else { fail("outage risk missing") }
        print("     S=\(FixedPoint.percentString(risk.shortFP)) M=\(FixedPoint.percentString(risk.mediumFP)) L=\(FixedPoint.percentString(risk.longFP))")

        step("Rank candidate levers (neural + symbolic what-if)")
        guard let evaluations = snapshot.neural.leverEvaluations,
              !evaluations.isEmpty else {
            fail("lever evaluations missing")
        }
        for evaluation in evaluations {
            print("     \(evaluation.selected ? "→" : " ") \(evaluation.leverID) symbolic=\(FixedPoint.decimalString(evaluation.symbolicScoreFP)) neural=\(FixedPoint.decimalString(evaluation.neuralScoreFP))")
        }

        step("Deterministic what-if per lever (baseline vs candidate outage)")
        let preventing = evaluations.filter { $0.baselineOutage && !$0.candidateOutage }
        print("     levers preventing baseline outage: \(preventing.count)")

        step("Require authorization for the critical lever (policy gate)")
        guard let recommended = CommandCenterBuilder.recommendedLever(snapshot),
              let lever = snapshot.levers.first(where: { $0.id == recommended }) else {
            fail("no applicable recommended lever")
        }
        let denyGate = CriticalActionGate(policy: .default)
        let denied = await denyGate.authorizeLever(lever)
        require(lever.successProbabilityFP < 600_000 || !denied,
                "deny-all authorizer must block high-impact levers")
        let gate = CriticalActionGate(policy: .default,
                                      authorizer: AutoConfirmAuthorizer())
        let authorized = await gate.authorizeLever(lever)
        require(authorized, "authorization flow failed")

        step("Apply the lever through the deterministic engine")
        let success: Bool
        do { success = try await controller.applyLever(id: lever.id) } catch {
            fail("lever application failed: \(error)")
        }
        print("     lever=\(lever.id) deterministic_roll_success=\(success)")

        step("Show resulting state transition")
        let afterLever: EngineSnapshot
        do { afterLever = try await controller.snapshot() } catch {
            fail("snapshot failed: \(error)")
        }
        guard let applied = afterLever.levers.first(where: { $0.id == lever.id }) else {
            fail("applied lever missing from snapshot")
        }
        print("     friction \(FixedPoint.decimalString(snapshot.frictionClampedFP)) → \(FixedPoint.decimalString(afterLever.frictionClampedFP)); lockout=\(applied.remainingLockout)")

        step("Create a checkpoint (atomic, integrity-hashed)")
        let checkpointStore: CheckpointStore
        do {
            checkpointStore = try CheckpointStore(
                directory: sessionDirectory.appendingPathComponent("checkpoints"))
        } catch { fail("checkpoint store: \(error)") }
        let envelope: Data
        do { envelope = try await controller.checkpoint() } catch {
            fail("checkpoint failed: \(error)")
        }
        let record: CheckpointRecord
        do {
            record = try checkpointStore.save(
                envelope: envelope, trigger: .manual, tick: afterLever.tick,
                scenarioID: afterLever.scenario.id ?? "?")
        } catch { fail("checkpoint save failed: \(error)") }
        print("     checkpoint id=\(record.id) bytes=\(record.byteCount)")
        let atCheckpoint: EngineSnapshot
        do { atCheckpoint = try await controller.snapshot() } catch {
            fail("snapshot failed: \(error)")
        }

        step("Advance further, then TERMINATE the session (app kill)")
        do { try await controller.tick(3) } catch { fail("tick failed: \(error)") }
        await controller.shutdown()

        step("Reopen and RESTORE the exact session from the checkpoint")
        let restoredEnvelope: Data
        do {
            guard let latest = try checkpointStore.latest() else {
                fail("no checkpoint recorded")
            }
            restoredEnvelope = try checkpointStore.load(id: latest.id)
        } catch { fail("checkpoint reload failed: \(error)") }
        let restored: EngineController
        do {
            restored = try await SessionRestorer.restore(
                configuration: EngineConfiguration(
                    flags: [.neuralAssurance],
                    deterministicSeed: 0xB501_DE30_0000_0001,
                    sessionID: 0x2025_0712_0000_0001,
                    auditDirectory: scratchDirectory("restored"),
                    identityFile: identityFile),
                scenarioJSON: scenarioBytes,
                neuralModel: NeuralModelPackage(manifest: manifestBytes,
                                                weights: weightsBytes,
                                                signature: signatureBytes),
                checkpointEnvelope: restoredEnvelope)
        } catch {
            fail("session restore failed: \(error)")
        }
        let postRestore: EngineSnapshot
        do { postRestore = try await restored.snapshot() } catch {
            fail("snapshot failed: \(error)")
        }
        require(symbolicCoreMatches(atCheckpoint, postRestore),
                "restored symbolic state must equal the checkpointed state")
        require(postRestore.tick == atCheckpoint.tick,
                "restored tick must equal the checkpoint tick")
        // Neural temporal history restarts with explicit missing-data masks
        // (re-observed, never fabricated) — that is a designed property, so
        // no evidence-equality claim is made here.
        do { try await restored.tick(3) } catch { fail("restored tick failed: \(error)") }
        let continued: EngineSnapshot
        do { continued = try await restored.snapshot() } catch {
            fail("snapshot failed: \(error)")
        }
        require(continued.tick == atCheckpoint.tick + 3,
                "restored session must keep ticking deterministically")
        print("     restored at tick \(postRestore.tick) (symbolic state bit-exact), continued to \(continued.tick)")

        step("Reject a CORRUPTED checkpoint (fail-closed check)")
        do {
            let corruptTarget = try EngineController(configuration: EngineConfiguration(
                flags: [],
                deterministicSeed: 1,
                sessionID: 0x2025_0712_0000_0004,
                auditDirectory: scratchDirectory("corrupt"),
                identityFile: identityFile))
            try await corruptTarget.loadScenario(scenarioBytes)
            var corrupt = restoredEnvelope
            corrupt[corrupt.count / 2] ^= 0x01
            do {
                try await corruptTarget.restoreCheckpoint(corrupt)
                fail("corrupt checkpoint was ACCEPTED")
            } catch CaelusMobileError.checkpointInvalid {
                await corruptTarget.shutdown()
            } catch CaelusMobileError.checkpointIncompatible {
                await corruptTarget.shutdown()
            }
        } catch { fail("corrupt-checkpoint harness failed: \(error)") }

        step("Seal the session (ed25519 SEAL over the chain head)")
        do { try await restored.sealSession() } catch {
            fail("seal failed: \(error)")
        }

        step("Export an audit-verifiable report (chain + SEAL included)")
        do {
            let auditStatus = try await restored.auditStatus()
            require(auditStatus.sealed, "status must report the sealed latch")
            let anchors = try EngineController.trustAnchors()
            let finalSnapshot = try await restored.snapshot()
            let report = ExecutiveReportBuilder.build(snapshot: finalSnapshot,
                                                      auditStatus: auditStatus,
                                                      anchors: anchors)
            let auditNDJSON = try await restored.exportAudit()
            let exportText = String(decoding: auditNDJSON, as: UTF8.self)
            require(exportText.contains("SEAL"),
                    "export must contain the SEAL line")
            // Fixed export directory for CI verification, temp otherwise.
            let exportDirectory: URL
            if let overrideDir = ProcessInfo.processInfo
                .environment["CAELUS_DEMO_EXPORT_DIR"], !overrideDir.isEmpty {
                exportDirectory = URL(fileURLWithPath: overrideDir)
                try FileManager.default.createDirectory(
                    at: exportDirectory, withIntermediateDirectories: true)
            } else {
                exportDirectory = sessionDirectory
            }
            let reportURL = exportDirectory.appendingPathComponent(report.suggestedFileName)
            try report.utf8Data.write(to: reportURL)
            let auditURL = exportDirectory.appendingPathComponent("audit_export.ndjson")
            try auditNDJSON.write(to: auditURL)
            print("     report=\(reportURL.path)")
            print("     audit =\(auditURL.path) entries=\(auditStatus.entries)")
        } catch { fail("export failed: \(error)") }

        step("Close the session")
        await restored.shutdown()

        print("")
        print("[DEMO PASS] \(stepCounter) steps — CAELUS Mobile stack verified end-to-end (Swift → C ABI → shared core)")
        exit(0)
    }

    /// Symbolic-core equality: authoritative graph state, scenario binding,
    /// and runtime scalars.  Audit sections legitimately differ (separate
    /// segment files) and neural temporal evidence legitimately restarts
    /// after restore (history is re-observed with missing-data masks, never
    /// fabricated), so neither participates in the comparison.
    private static func symbolicCoreMatches(_ lhs: EngineSnapshot,
                                            _ rhs: EngineSnapshot) -> Bool {
        lhs.tick == rhs.tick
            && lhs.frictionFP == rhs.frictionFP
            && lhs.frictionClampedFP == rhs.frictionClampedFP
            && lhs.regimeExceeded == rhs.regimeExceeded
            && lhs.outageActive == rhs.outageActive
            && lhs.hasIntelRisk == rhs.hasIntelRisk
            && lhs.lastIntelRiskFP == rhs.lastIntelRiskFP
            && lhs.pendingIntelEvents == rhs.pendingIntelEvents
            && lhs.scenario == rhs.scenario
            && lhs.nodes == rhs.nodes
            && lhs.edges == rhs.edges
            && lhs.levers == rhs.levers
            && lhs.hysteresis == rhs.hysteresis
            && lhs.feedbackLoops == rhs.feedbackLoops
    }
}
