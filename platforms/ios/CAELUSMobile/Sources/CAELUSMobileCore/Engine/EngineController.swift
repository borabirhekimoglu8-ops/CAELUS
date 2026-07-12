//
//  EngineController.swift
//  CAELUSMobileCore
//
//  The ONLY owner of a native CAELUS engine session.  An actor, so every
//  native call is serialised — the C ABI handle contract ("host must
//  serialise all calls on one handle") is enforced by the type system
//  instead of by discipline.
//
//  No SwiftUI, no platform branching here: this file builds and is tested
//  on Linux against the identical native core the iOS app embeds.
//
import CaelusBridgeC
import Foundation

public actor EngineController {
    private var handle: OpaquePointer?
    public let configuration: EngineConfiguration

    // MARK: Lifecycle

    /// Opens a native engine session: opens the audit chain (SESSION_START
    /// first event) and loads/creates the platform-protected device
    /// identity.  A KeyProtectionProvider MUST be installed first
    /// (`KeyProtectionRegistry.install`); without one the native layer
    /// refuses plaintext identity persistence and creation fails closed.
    public init(configuration: EngineConfiguration) throws {
        let runtimeABI = caelus_mobile_abi_version_v1()
        guard runtimeABI == 1 else {
            throw CaelusMobileError.abiMismatch(
                detail: "bridge reports ABI \(runtimeABI), app built for 1")
        }
        self.configuration = configuration

        let auditPath = Array(configuration.auditDirectory.path.utf8)
        let identityPath = Array(configuration.identityFile.path.utf8)
        var status: Int32 = CaelusStatusCode.internalFailure.rawValue
        let created: OpaquePointer? = auditPath.withUnsafeBufferPointer { audit in
            identityPath.withUnsafeBufferPointer { identity in
                var config = CaelusMobileEngineConfigV1()
                config.struct_size = UInt32(MemoryLayout<CaelusMobileEngineConfigV1>.size)
                config.abi_version = 1
                config.flags = configuration.flags.rawValue
                config.reserved = 0
                config.deterministic_seed = configuration.deterministicSeed
                config.session_id = configuration.sessionID
                config.audit_directory_utf8 = audit.baseAddress
                config.audit_directory_len = audit.count
                config.identity_path_utf8 = identity.baseAddress
                config.identity_path_len = identity.count
                return caelus_mobile_engine_create_v1(&config, &status)
            }
        }
        guard let created, status == CaelusStatusCode.ok.rawValue else {
            throw CaelusMobileError(
                status: status,
                detail: "engine session could not be created "
                    + "(audit dir: \(configuration.auditDirectory.path))")
        }
        self.handle = created
    }

    /// Seals the audit chain (SESSION_END + ed25519 seal) and frees the
    /// native session.  Idempotent.  After shutdown every call throws
    /// `.engineUnavailable`.
    public func shutdown() {
        if let handle {
            caelus_mobile_engine_destroy_v1(handle)
        }
        handle = nil
    }

    deinit {
        // Backstop for abandoned controllers.  Destroy is NULL-safe and
        // registry-checked, so a prior explicit shutdown makes this a no-op.
        if let handle {
            caelus_mobile_engine_destroy_v1(handle)
        }
    }

    // MARK: Scenario / model loading

    /// Verify + load a signed scenario package (UTF-8 JSON bytes).  Allowed
    /// exactly once per session, before any tick.  Rejection is audited and
    /// leaves the engine in the blank pre-scenario state.
    public func loadScenario(_ scenarioJSON: Data) throws {
        let handle = try liveHandle()
        guard scenarioJSON.count <= EngineLimits.maxScenarioBytes else {
            throw CaelusMobileError.inputTooLarge(
                detail: "scenario is \(scenarioJSON.count) bytes")
        }
        let status = scenarioJSON.withUnsafeBytes { raw in
            caelus_mobile_load_scenario_v1(
                handle, raw.bindMemory(to: UInt8.self).baseAddress,
                raw.count)
        }
        try check(status, operation: "load scenario")
    }

    /// Verify + load a signed deterministic neural model package.  Requires
    /// the `.neuralAssurance` flag, a production-verified scenario, and no
    /// executed ticks.  Rejection is audited; the engine continues
    /// symbolic-only (fail-closed).
    public func loadNeuralModel(manifest: Data, weights: Data,
                                signature: Data) throws {
        let handle = try liveHandle()
        let status = manifest.withUnsafeBytes { manifestRaw in
            weights.withUnsafeBytes { weightsRaw in
                signature.withUnsafeBytes { signatureRaw in
                    caelus_mobile_load_neural_model_v1(
                        handle,
                        manifestRaw.bindMemory(to: UInt8.self).baseAddress,
                        manifestRaw.count,
                        weightsRaw.bindMemory(to: UInt8.self).baseAddress,
                        weightsRaw.count,
                        signatureRaw.bindMemory(to: UInt8.self).baseAddress,
                        signatureRaw.count)
                }
            }
        }
        try check(status, operation: "load neural model")
    }

    // MARK: Simulation

    /// Advance `count` deterministic ticks (scheduled intel injection,
    /// symbolic propagation, audited neural sequence when a trusted model
    /// is active — identical ordering to the desktop host).
    public func tick(_ count: UInt32 = 1) throws {
        let handle = try liveHandle()
        try check(caelus_mobile_tick_v1(handle, count), operation: "tick")
    }

    /// Apply a scenario lever.  Returns true when the deterministic success
    /// roll passed, false when the failure outcome was applied.  Unknown
    /// levers throw `.leverUnknown`; locked-out/disabled levers throw
    /// `.leverUnavailable`.
    @discardableResult
    public func applyLever(id: String) throws -> Bool {
        let handle = try liveHandle()
        let identifier = Array(id.utf8)
        guard identifier.count <= EngineLimits.maxLeverIDBytes else {
            throw CaelusMobileError.inputTooLarge(
                detail: "lever id is \(identifier.count) bytes")
        }
        var success: UInt8 = 0
        let status = identifier.withUnsafeBufferPointer { buffer in
            caelus_mobile_apply_lever_v1(handle, buffer.baseAddress,
                                         buffer.count, &success)
        }
        try check(status, operation: "apply lever \(id)")
        return success == 1
    }

    // MARK: State export

    /// Decoded full-state snapshot.
    public func snapshot() throws -> EngineSnapshot {
        try EngineSnapshot.decode(from: snapshotData())
    }

    /// Raw CAELUS_MOBILE_SNAPSHOT_V1 JSON (for export / diffing).
    public func snapshotData() throws -> Data {
        let handle = try liveHandle()
        return try fetchBuffer(operation: "snapshot") { output, capacity, written in
            caelus_mobile_snapshot_json_v1(handle, output, capacity, written)
        }
    }

    /// Serialized resumable checkpoint (opaque, integrity-hashed envelope).
    public func checkpoint() throws -> Data {
        let handle = try liveHandle()
        return try fetchBuffer(operation: "checkpoint") { output, capacity, written in
            caelus_mobile_checkpoint_v1(handle, output, capacity, written)
        }
    }

    /// Restore a checkpoint.  The SAME verified scenario must already be
    /// loaded on this session and no ticks may have executed yet.
    public func restoreCheckpoint(_ envelope: Data) throws {
        let handle = try liveHandle()
        guard envelope.count <= EngineLimits.maxCheckpointBytes else {
            throw CaelusMobileError.inputTooLarge(
                detail: "checkpoint is \(envelope.count) bytes")
        }
        let status = envelope.withUnsafeBytes { raw in
            caelus_mobile_restore_checkpoint_v1(
                handle, raw.bindMemory(to: UInt8.self).baseAddress, raw.count)
        }
        try check(status, operation: "restore checkpoint")
    }

    // MARK: Audit

    /// Filesystem path of the active audit segment.
    public func auditPath() throws -> String {
        let handle = try liveHandle()
        let data = try fetchBuffer(operation: "audit path") { output, capacity, written in
            caelus_mobile_audit_path_v1(handle, output, capacity, written)
        }
        guard let path = String(data: data, encoding: .utf8) else {
            throw CaelusMobileError.payloadDecoding(detail: "audit path is not UTF-8")
        }
        return path
    }

    /// Decoded audit chain status.
    public func auditStatus() throws -> AuditChainStatus {
        let handle = try liveHandle()
        let data = try fetchBuffer(operation: "audit status") { output, capacity, written in
            caelus_mobile_audit_status_json_v1(handle, output, capacity, written)
        }
        return try AuditChainStatus.decode(from: data)
    }

    /// Full audit NDJSON for export.  REPORT_EXPORTED is audited after the
    /// read, so the exported bytes verify cleanly up to their own last line.
    public func exportAudit() throws -> Data {
        let handle = try liveHandle()
        return try fetchBuffer(operation: "export audit") { output, capacity, written in
            caelus_mobile_export_audit_v1(handle, output, capacity, written)
        }
    }

    /// Append an APP_LIFECYCLE audit event.
    public func noteLifecycle(_ phase: LifecyclePhase) throws {
        let handle = try liveHandle()
        try check(caelus_mobile_note_lifecycle_v1(handle, phase.rawValue),
                  operation: "lifecycle note")
    }

    /// Seal the audit chain now (idempotent).  Afterwards audited
    /// operations fail with `.auditFailure`; use before final export.
    public func sealSession() throws {
        let handle = try liveHandle()
        try check(caelus_mobile_seal_session_v1(handle), operation: "seal session")
    }

    // MARK: Diagnostics

    /// Human-readable description of the most recent native failure.
    public func lastErrorDetail() -> String {
        guard let handle else { return "" }
        var needed = 0
        let probe = caelus_mobile_last_error_v1(handle, nil, 0, &needed)
        if probe == CaelusStatusCode.ok.rawValue && needed == 0 { return "" }
        guard probe == CaelusStatusCode.bufferTooSmall.rawValue, needed > 0 else {
            return ""
        }
        var buffer = [UInt8](repeating: 0, count: needed)
        var written = 0
        let status = buffer.withUnsafeMutableBufferPointer { raw in
            caelus_mobile_last_error_v1(handle, raw.baseAddress, raw.count,
                                        &written)
        }
        guard status == CaelusStatusCode.ok.rawValue else { return "" }
        return String(decoding: buffer[0..<written], as: UTF8.self)
    }

    /// Compiled-in PUBLIC trust anchors of the linked native core.
    /// Stateless — usable before any session exists.
    public static func trustAnchors() throws -> TrustAnchors {
        var needed = 0
        let probe = caelus_mobile_trusted_anchors_json_v1(nil, 0, &needed)
        guard probe == CaelusStatusCode.bufferTooSmall.rawValue, needed > 0 else {
            throw CaelusMobileError(status: probe, detail: "trust anchor probe")
        }
        var buffer = [UInt8](repeating: 0, count: needed)
        var written = 0
        let status = buffer.withUnsafeMutableBufferPointer { raw in
            caelus_mobile_trusted_anchors_json_v1(raw.baseAddress, raw.count,
                                                  &written)
        }
        guard status == CaelusStatusCode.ok.rawValue else {
            throw CaelusMobileError(status: status, detail: "trust anchor fetch")
        }
        return try TrustAnchors.decode(from: Data(buffer[0..<written]))
    }

    /// Blake3 hash (32 bytes) through the shared native implementation.
    /// Stateless helper for verifying imported package blobs.
    public static func blake3(_ data: Data) throws -> [UInt8] {
        guard !data.isEmpty else {
            throw CaelusMobileError.invalidArgument(detail: "empty hash input")
        }
        var digest = [UInt8](repeating: 0, count: 32)
        let status = data.withUnsafeBytes { raw in
            digest.withUnsafeMutableBufferPointer { out in
                caelus_mobile_blake3_v1(
                    raw.bindMemory(to: UInt8.self).baseAddress, raw.count,
                    out.baseAddress)
            }
        }
        guard status == CaelusStatusCode.ok.rawValue else {
            throw CaelusMobileError(status: status, detail: "blake3")
        }
        return digest
    }

    // MARK: Private plumbing

    private func liveHandle() throws -> OpaquePointer {
        guard let handle else { throw CaelusMobileError.engineUnavailable }
        return handle
    }

    private func check(_ status: Int32, operation: String) throws {
        guard status != CaelusStatusCode.ok.rawValue else { return }
        var detail = lastErrorDetail()
        if detail.isEmpty { detail = operation }
        throw CaelusMobileError(status: status, detail: detail)
    }

    /// Two-call buffer pattern: probe for the exact size, then fetch.
    private func fetchBuffer(
        operation: String,
        _ call: (UnsafeMutablePointer<UInt8>?, Int, UnsafeMutablePointer<Int>?) -> Int32
    ) throws -> Data {
        var needed = 0
        let probe = call(nil, 0, &needed)
        if probe == CaelusStatusCode.ok.rawValue && needed == 0 {
            return Data()
        }
        guard probe == CaelusStatusCode.bufferTooSmall.rawValue else {
            var detail = lastErrorDetail()
            if detail.isEmpty { detail = operation }
            throw CaelusMobileError(status: probe, detail: detail)
        }
        var buffer = [UInt8](repeating: 0, count: needed)
        var written = 0
        let status = buffer.withUnsafeMutableBufferPointer { raw in
            call(raw.baseAddress, raw.count, &written)
        }
        try check(status, operation: operation)
        guard written <= buffer.count else {
            throw CaelusMobileError.internalFailure(
                detail: "\(operation): bridge wrote \(written) of \(buffer.count)")
        }
        return Data(buffer[0..<written])
    }
}
