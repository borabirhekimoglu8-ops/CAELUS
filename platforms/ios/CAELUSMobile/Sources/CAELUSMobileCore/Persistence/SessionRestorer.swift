//
//  SessionRestorer.swift
//  CAELUSMobileCore
//
//  Relaunch flow: iOS terminates processes at will, so "resume" means
//  rebuilding a NATIVE session from durable artefacts:
//
//    1. fresh engine session (new audit segment, SESSION_START)
//    2. re-verify + load the SAME signed scenario bytes
//    3. re-verify + load the SAME signed neural model (when the checkpoint
//       was taken with one — the envelope binds the model hash)
//    4. restore the checkpoint envelope (native side validates format,
//       engine version, integrity hash, scenario binding, model binding,
//       topology)
//
//  Every step is fail-closed: any mismatch throws a typed error and no
//  partially restored session is returned.
//
import Foundation

/// Signed neural model package as raw buffers.
public struct NeuralModelPackage: Sendable {
    public var manifest: Data
    public var weights: Data
    public var signature: Data

    public init(manifest: Data, weights: Data, signature: Data) {
        self.manifest = manifest
        self.weights = weights
        self.signature = signature
    }
}

public enum SessionRestorer {
    /// Rebuild a live engine session from persisted scenario bytes, the
    /// optional neural model the checkpoint is bound to, and a checkpoint
    /// envelope.  On success the returned controller is ticking from
    /// exactly the checkpointed state (CHECKPOINT_RESTORED audited).
    public static func restore(configuration: EngineConfiguration,
                               scenarioJSON: Data,
                               neuralModel: NeuralModelPackage? = nil,
                               checkpointEnvelope: Data) async throws -> EngineController {
        let controller = try EngineController(configuration: configuration)
        do {
            try await controller.loadScenario(scenarioJSON)
            if let model = neuralModel {
                try await controller.loadNeuralModel(manifest: model.manifest,
                                                     weights: model.weights,
                                                     signature: model.signature)
            }
            try await controller.restoreCheckpoint(checkpointEnvelope)
        } catch {
            await controller.shutdown()
            throw error
        }
        return controller
    }
}
