//
//  AppModel.swift
//  CAELUSMobileUI
//
//  Application-level state: sandbox layout, key-protection installation,
//  the scenario/model library, the persisted security policy, session
//  creation, and restore-on-launch.  One AppModel per process, owned by the
//  App scene.
//
#if os(iOS) && canImport(SwiftUI)
import CAELUSMobileCore
import Combine
import Foundation
import SwiftUI

/// What the app is currently showing.
public enum AppPhase: Equatable {
    case launching
    case library          // no live session; pick/import a scenario
    case active           // session running (SessionViewModel present)
    case failed(String)   // unrecoverable boot problem
}

/// Persisted pointer to the material needed to restore the last session.
/// Contains NAMES ONLY — all bytes are re-read and re-verified on restore.
struct SessionManifest: Codable, Equatable {
    var formatVersion: Int
    var scenarioName: String
    var modelName: String?
    var neuralAssurance: Bool

    enum CodingKeys: String, CodingKey {
        case formatVersion = "format_version"
        case scenarioName = "scenario_name"
        case modelName = "model_name"
        case neuralAssurance = "neural_assurance"
    }
}

@MainActor
public final class AppModel: ObservableObject {
    @Published public private(set) var phase: AppPhase = .launching
    @Published public private(set) var session: SessionViewModel?
    @Published public private(set) var bootMessage: String?
    @Published public private(set) var scenarios: [StoredScenario] = []
    @Published public private(set) var models: [StoredModelPackage] = []
    @Published public var securityPolicy: SecurityPolicy = .default {
        didSet { persistPolicy() }
    }

    public private(set) var scenarioStore: ScenarioStore?
    public private(set) var trustAnchors: TrustAnchors?

    // MARK: Sandbox layout

    /// Application Support/CAELUS — excluded from ordinary user file
    /// browsing, backed up by iOS, protected by file-protection classes.
    static func baseDirectory() throws -> URL {
        let base = try FileManager.default.url(
            for: .applicationSupportDirectory, in: .userDomainMask,
            appropriateFor: nil, create: true)
            .appendingPathComponent("CAELUS", isDirectory: true)
        try FileManager.default.createDirectory(
            at: base, withIntermediateDirectories: true)
        return base
    }

    var auditDirectory: URL { urls.audit }
    private struct SandboxURLs {
        var base: URL
        var audit: URL
        var identity: URL
        var checkpoints: URL
        var library: URL
        var policy: URL
        var manifest: URL
    }
    private lazy var urls: SandboxURLs = {
        let base = (try? Self.baseDirectory())
            ?? FileManager.default.temporaryDirectory
                .appendingPathComponent("CAELUS")
        return SandboxURLs(
            base: base,
            audit: base.appendingPathComponent("audit", isDirectory: true),
            identity: base.appendingPathComponent("identity.key"),
            checkpoints: base.appendingPathComponent("checkpoints",
                                                     isDirectory: true),
            library: base.appendingPathComponent("library", isDirectory: true),
            policy: base.appendingPathComponent("security_policy.json"),
            manifest: base.appendingPathComponent("session_manifest.json"))
    }()

    public init() {}

    // MARK: Boot

    /// Launch sequence: install Keychain key protection, load the trust
    /// anchors and policy, seed the library from bundled fixtures, then try
    /// to restore the previous session (checkpoint + manifest).  Fully
    /// offline; never blocks on the network.
    public func boot() async {
        do {
            try FileManager.default.createDirectory(
                at: urls.audit, withIntermediateDirectories: true)
            if !KeyProtectionRegistry.isInstalled {
                try KeyProtectionRegistry.install(KeychainKeyProtection())
            }
            trustAnchors = try? EngineController.trustAnchors()
            loadPolicy()
            let store = try ScenarioStore(directory: urls.library)
            scenarioStore = store
            seedLibraryFromBundle(into: store)
            refreshLibrary()
        } catch {
            phase = .failed("Startup failed: \(error)")
            return
        }

        if let restored = await tryRestorePreviousSession() {
            session = restored
            phase = .active
            bootMessage = "Previous session restored from checkpoint."
        } else {
            phase = .library
        }
    }

    public func refreshLibrary() {
        guard let store = scenarioStore else { return }
        scenarios = store.scenarios()
        models = store.models()
    }

    /// Copy signed fixtures shipped in the app bundle into the library on
    /// first launch (idempotent; existing names are not overwritten).  The
    /// bundle folders mirror the repository layout: `scenarios/` and
    /// `models/assurance_v1/` are folder references in the Xcode project.
    private func seedLibraryFromBundle(into store: ScenarioStore) {
        let existing = Set(store.scenarios().map(\.id))
        for url in Bundle.main.urls(forResourcesWithExtension: "json",
                                    subdirectory: "scenarios") ?? [] {
            let name = url.deletingPathExtension().lastPathComponent
            guard !existing.contains(name),
                  let data = try? Data(contentsOf: url) else { continue }
            _ = try? store.importScenario(data: data, preferredName: name)
        }
        // Bundled model package (single assurance model directory).
        if store.models().isEmpty,
           let manifest = Bundle.main.url(forResource: "manifest",
                                          withExtension: "json",
                                          subdirectory: "models/assurance_v1"),
           let weights = Bundle.main.url(forResource: "weights",
                                         withExtension: "bin",
                                         subdirectory: "models/assurance_v1"),
           let signature = Bundle.main.url(forResource: "model",
                                           withExtension: "sig",
                                           subdirectory: "models/assurance_v1") {
            if let m = try? Data(contentsOf: manifest),
               let w = try? Data(contentsOf: weights),
               let s = try? Data(contentsOf: signature) {
                _ = try? store.importModel(manifest: m, weights: w,
                                           signature: s,
                                           preferredName: "assurance_v1")
            }
        }
    }

    // MARK: Session lifecycle

    /// Start a fresh session for a stored scenario (+ optional model).
    /// Signature verification happens inside the native core; a rejection
    /// surfaces as a thrown typed error and no session is created.
    public func startSession(scenarioName: String,
                             modelName: String?) async {
        guard let store = scenarioStore else { return }
        phase = .launching
        do {
            let scenarioJSON = try store.readScenario(named: scenarioName)
            let model = try modelName.map { try store.readModel(named: $0) }
            let configuration = EngineConfiguration(
                flags: model != nil ? [.neuralAssurance] : [],
                deterministicSeed: 0,   // production: time/tick derived
                sessionID: 0,           // unique wall-clock session id
                auditDirectory: urls.audit,
                identityFile: urls.identity)
            let controller = try EngineController(configuration: configuration)
            do {
                try await controller.loadScenario(scenarioJSON)
                if let model {
                    try await controller.loadNeuralModel(
                        manifest: model.manifest,
                        weights: model.weights,
                        signature: model.signature)
                }
            } catch {
                await controller.shutdown()
                throw error
            }
            let checkpointStore = try CheckpointStore(directory: urls.checkpoints)
            let viewModel = SessionViewModel(
                controller: controller,
                scenarioName: scenarioName,
                modelName: modelName,
                checkpointStore: checkpointStore,
                gate: makeGate())
            persistManifest(SessionManifest(
                formatVersion: 1,
                scenarioName: scenarioName,
                modelName: modelName,
                neuralAssurance: modelName != nil))
            await viewModel.saveCheckpoint(trigger: .scenarioLoaded)
            await viewModel.refresh()
            session = viewModel
            phase = .active
            bootMessage = nil
        } catch {
            phase = .library
            bootMessage = "Could not start session: \(error)"
        }
    }

    /// End the active session (seal + free) and return to the library.
    public func endSession(seal: Bool) async {
        guard let session else { return }
        if seal { await session.sealSession() }
        await session.shutdown()
        self.session = nil
        clearManifest()
        phase = .library
    }

    /// Replace the live session with one restored from a specific stored
    /// checkpoint.  The current session is sealed first; the replacement
    /// re-verifies scenario + model signatures and the checkpoint binding
    /// through the fail-closed native path.  On failure the app returns to
    /// the library with the error surfaced (never a partial restore).
    public func restoreCheckpoint(_ record: CheckpointRecord) async {
        guard let store = scenarioStore, let current = session else { return }
        let scenarioName = current.scenarioName
        let modelName = current.modelName
        do {
            let envelope = try current.checkpointStore.load(id: record.id)
            let scenarioJSON = try store.readScenario(named: scenarioName)
            let model = try modelName.map { try store.readModel(named: $0) }

            await current.sealSession()
            await current.shutdown()
            session = nil

            let configuration = EngineConfiguration(
                flags: model != nil ? [.neuralAssurance] : [],
                deterministicSeed: 0,
                sessionID: 0,
                auditDirectory: urls.audit,
                identityFile: urls.identity)
            let controller = try await SessionRestorer.restore(
                configuration: configuration,
                scenarioJSON: scenarioJSON,
                neuralModel: model,
                checkpointEnvelope: envelope)
            let viewModel = SessionViewModel(
                controller: controller,
                scenarioName: scenarioName,
                modelName: modelName,
                checkpointStore: current.checkpointStore,
                gate: makeGate())
            await viewModel.refresh()
            session = viewModel
            phase = .active
            bootMessage = nil
        } catch {
            phase = .library
            bootMessage = "Checkpoint restore failed: \(error)"
        }
    }

    /// Restore-on-launch: manifest + latest checkpoint must both exist and
    /// the full trust chain re-verifies (scenario signature, model
    /// signature, checkpoint binding + integrity).  Any failure falls back
    /// to the library — no silent partial restore.
    private func tryRestorePreviousSession() async -> SessionViewModel? {
        guard let store = scenarioStore,
              let manifest = loadManifest(),
              let checkpointStore = try? CheckpointStore(
                directory: urls.checkpoints),
              let latest = try? checkpointStore.latest(),
              let envelope = try? checkpointStore.load(id: latest.id) else {
            return nil
        }
        do {
            let scenarioJSON = try store.readScenario(
                named: manifest.scenarioName)
            let model = try manifest.modelName.map { try store.readModel(named: $0) }
            let configuration = EngineConfiguration(
                flags: manifest.neuralAssurance ? [.neuralAssurance] : [],
                deterministicSeed: 0,
                sessionID: 0,
                auditDirectory: urls.audit,
                identityFile: urls.identity)
            let controller = try await SessionRestorer.restore(
                configuration: configuration,
                scenarioJSON: scenarioJSON,
                neuralModel: model,
                checkpointEnvelope: envelope)
            let viewModel = SessionViewModel(
                controller: controller,
                scenarioName: manifest.scenarioName,
                modelName: manifest.modelName,
                checkpointStore: checkpointStore,
                gate: makeGate())
            await viewModel.refresh()
            return viewModel
        } catch {
            bootMessage = "Previous session could not be restored: \(error)"
            return nil
        }
    }

    private func makeGate() -> CriticalActionGate {
        CriticalActionGate(policy: securityPolicy,
                           authorizer: BiometricAuthorizer())
    }

    // MARK: Imports (document picker results)

    public func importScenario(from url: URL) {
        guard let store = scenarioStore else { return }
        do {
            let data = try readSecurityScoped(url)
            _ = try store.importScenario(
                data: data,
                preferredName: url.deletingPathExtension().lastPathComponent)
            refreshLibrary()
            bootMessage = nil
        } catch {
            bootMessage = "Scenario import failed: \(error)"
        }
    }

    /// Import a model package from picked files (manifest.json,
    /// weights.bin, model.sig — classified by name/extension).
    public func importModelPackage(from urls: [URL], preferredName: String) {
        guard let store = scenarioStore else { return }
        var manifest: Data?
        var weights: Data?
        var signature: Data?
        do {
            for url in urls {
                let data = try readSecurityScoped(url)
                switch url.lastPathComponent.lowercased() {
                case let name where name.hasSuffix(".json"): manifest = data
                case let name where name.hasSuffix(".bin"): weights = data
                case let name where name.hasSuffix(".sig"): signature = data
                default: break
                }
            }
            guard let manifest, let weights, let signature else {
                bootMessage = "Model import needs manifest.json, weights.bin "
                    + "and model.sig."
                return
            }
            _ = try store.importModel(manifest: manifest, weights: weights,
                                      signature: signature,
                                      preferredName: preferredName)
            refreshLibrary()
            bootMessage = nil
        } catch {
            bootMessage = "Model import failed: \(error)"
        }
    }

    private func readSecurityScoped(_ url: URL) throws -> Data {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        return try Data(contentsOf: url)
    }

    // MARK: Persistence of policy + manifest

    private func loadPolicy() {
        guard let data = try? Data(contentsOf: urls.policy),
              let policy = try? JSONDecoder().decode(SecurityPolicy.self,
                                                     from: data),
              policy.formatVersion == 1 else { return }
        securityPolicy = policy
    }

    private func persistPolicy() {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        if let data = try? encoder.encode(securityPolicy) {
            try? data.write(to: urls.policy, options: .atomic)
        }
    }

    private func loadManifest() -> SessionManifest? {
        guard let data = try? Data(contentsOf: urls.manifest),
              let manifest = try? JSONDecoder().decode(SessionManifest.self,
                                                       from: data),
              manifest.formatVersion == 1 else { return nil }
        return manifest
    }

    private func persistManifest(_ manifest: SessionManifest) {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        if let data = try? encoder.encode(manifest) {
            try? data.write(to: urls.manifest, options: .atomic)
        }
    }

    private func clearManifest() {
        try? FileManager.default.removeItem(at: urls.manifest)
    }
}
#endif
