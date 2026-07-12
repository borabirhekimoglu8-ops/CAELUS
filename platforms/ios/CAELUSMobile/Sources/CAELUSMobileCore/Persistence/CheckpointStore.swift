//
//  CheckpointStore.swift
//  CAELUSMobileCore
//
//  Crash-safe local persistence for engine checkpoints.
//
//  The checkpoint ENVELOPE (integrity hash, format/engine/scenario/model
//  binding) is produced and validated by the native core; this store only
//  guarantees durable, atomic placement on disk plus versioned metadata so
//  a mobile session survives suspension, termination, and relaunch.
//
//  Write protocol: serialize to `<name>.tmp`, then atomically replace the
//  destination.  A torn write can therefore never destroy the previous
//  good checkpoint — worst case the .tmp is abandoned and cleaned later.
//
// (@preconcurrency: swift-corelibs URL is not yet Sendable-annotated; the
// type is a value type and safe to send.)
@preconcurrency import Foundation

/// Why a checkpoint was created — persisted for the session history UI.
public enum CheckpointTrigger: String, Codable, Sendable {
    case sessionStart = "session_start"
    case scenarioLoaded = "scenario_loaded"
    case leverApplied = "lever_applied"
    case tickInterval = "tick_interval"
    case background = "background"
    case beforeExport = "before_export"
    case modelChanged = "model_changed"
    case manual = "manual"
}

/// Versioned sidecar metadata for one stored checkpoint.
public struct CheckpointRecord: Codable, Sendable, Equatable, Identifiable {
    public var formatVersion: Int
    public var id: String
    public var createdAtEpochSeconds: Int64
    public var trigger: CheckpointTrigger
    public var tick: UInt64
    public var scenarioID: String
    public var byteCount: Int

    enum CodingKeys: String, CodingKey {
        case formatVersion = "format_version"
        case id
        case createdAtEpochSeconds = "created_at_epoch_seconds"
        case trigger, tick
        case scenarioID = "scenario_id"
        case byteCount = "byte_count"
    }
}

public enum CheckpointStoreError: Error, Equatable {
    case notFound(id: String)
    case corruptIndex(detail: String)
    case ioFailure(detail: String)
}

/// Directory-backed checkpoint store.  All operations are synchronous file
/// I/O; call from a background task in UI contexts.
public struct CheckpointStore: Sendable {
    public let directory: URL
    /// Rolling retention (oldest pruned first).  The latest checkpoint is
    /// never pruned.
    public let retentionLimit: Int

    private var indexURL: URL { directory.appendingPathComponent("index.json") }

    public init(directory: URL, retentionLimit: Int = 8) throws {
        precondition(retentionLimit >= 1)
        self.directory = directory
        self.retentionLimit = retentionLimit
        do {
            try FileManager.default.createDirectory(
                at: directory, withIntermediateDirectories: true,
                attributes: Self.directoryProtectionAttributes())
        } catch {
            throw CheckpointStoreError.ioFailure(
                detail: "cannot create \(directory.path): \(error)")
        }
    }

    /// iOS: protect checkpoints at rest until first unlock (engine restore
    /// can then run immediately after a reboot once the user has unlocked
    /// the device at least once).  No-op off-platform.
    private static func directoryProtectionAttributes() -> [FileAttributeKey: Any]? {
        #if os(iOS)
        return [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication]
        #else
        return nil
        #endif
    }

    // MARK: Save / load

    /// Atomically persist a checkpoint envelope and update the index.
    /// Returns the stored record.
    @discardableResult
    public func save(envelope: Data, trigger: CheckpointTrigger, tick: UInt64,
                     scenarioID: String,
                     now: Date = Date()) throws -> CheckpointRecord {
        let record = CheckpointRecord(
            formatVersion: 1,
            id: Self.makeIdentifier(tick: tick, now: now),
            createdAtEpochSeconds: Int64(now.timeIntervalSince1970),
            trigger: trigger,
            tick: tick,
            scenarioID: scenarioID,
            byteCount: envelope.count)

        try atomicWrite(envelope, to: payloadURL(for: record.id))

        var index = (try? loadIndex()) ?? []
        index.append(record)
        index.sort { $0.createdAtEpochSeconds < $1.createdAtEpochSeconds }
        while index.count > retentionLimit {
            let evicted = index.removeFirst()
            try? FileManager.default.removeItem(at: payloadURL(for: evicted.id))
        }
        try saveIndex(index)
        return record
    }

    /// All stored records, oldest first.
    public func records() throws -> [CheckpointRecord] { try loadIndex() }

    /// The most recent record, if any.
    public func latest() throws -> CheckpointRecord? { try loadIndex().last }

    /// Load a checkpoint envelope by record id.
    public func load(id: String) throws -> Data {
        let url = payloadURL(for: id)
        guard FileManager.default.fileExists(atPath: url.path) else {
            throw CheckpointStoreError.notFound(id: id)
        }
        do {
            return try Data(contentsOf: url)
        } catch {
            throw CheckpointStoreError.ioFailure(
                detail: "cannot read \(url.path): \(error)")
        }
    }

    /// Remove every stored checkpoint and the index.
    public func reset() throws {
        for record in (try? loadIndex()) ?? [] {
            try? FileManager.default.removeItem(at: payloadURL(for: record.id))
        }
        try? FileManager.default.removeItem(at: indexURL)
    }

    // MARK: Internals

    static func makeIdentifier(tick: UInt64, now: Date) -> String {
        // Milliseconds + tick keeps ids unique and human-sortable without
        // requiring a global counter file.
        let ms = Int64((now.timeIntervalSince1970 * 1000).rounded())
        return "cp_\(ms)_t\(tick)"
    }

    private func payloadURL(for id: String) -> URL {
        directory.appendingPathComponent("\(id).ckpt.json")
    }

    private func atomicWrite(_ data: Data, to destination: URL) throws {
        let temp = destination.appendingPathExtension("tmp")
        do {
            try data.write(to: temp)
        } catch {
            try? FileManager.default.removeItem(at: temp)
            throw CheckpointStoreError.ioFailure(
                detail: "atomic write to \(destination.path) failed: \(error)")
        }
        // POSIX rename(2): atomic replace on Linux AND Darwin/iOS (APFS),
        // with or without an existing destination.  Foundation's
        // replaceItemAt/moveItem cannot express "atomic overwrite" portably.
        let renamed = temp.path.withCString { source in
            destination.path.withCString { target in
                rename(source, target)
            }
        }
        guard renamed == 0 else {
            let code = errno
            try? FileManager.default.removeItem(at: temp)
            throw CheckpointStoreError.ioFailure(
                detail: "rename to \(destination.path) failed (errno \(code))")
        }
        #if os(iOS)
        try? FileManager.default.setAttributes(
            [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
            ofItemAtPath: destination.path)
        #endif
    }

    private func loadIndex() throws -> [CheckpointRecord] {
        guard FileManager.default.fileExists(atPath: indexURL.path) else {
            return []
        }
        do {
            let data = try Data(contentsOf: indexURL)
            return try JSONDecoder().decode([CheckpointRecord].self, from: data)
        } catch {
            throw CheckpointStoreError.corruptIndex(detail: String(describing: error))
        }
    }

    private func saveIndex(_ index: [CheckpointRecord]) throws {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        do {
            try atomicWrite(try encoder.encode(index), to: indexURL)
        } catch let error as CheckpointStoreError {
            throw error
        } catch {
            throw CheckpointStoreError.ioFailure(detail: String(describing: error))
        }
    }
}
