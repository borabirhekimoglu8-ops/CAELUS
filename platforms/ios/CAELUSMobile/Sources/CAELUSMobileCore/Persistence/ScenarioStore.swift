//
//  ScenarioStore.swift
//  CAELUSMobileCore
//
//  Local library of imported scenario packages and signed neural model
//  packages.  This store manages FILES ONLY — every imported byte is
//  untrusted data until the native core verifies its ed25519 signature at
//  load time.  Deleting or editing files here can never bypass a trust
//  gate, and nothing in this store is executable.
//
//  Layout under the store directory:
//    scenarios/<name>.json                       (scenario package bytes)
//    models/<name>/manifest.json                 (model package triplet)
//    models/<name>/weights.bin
//    models/<name>/model.sig
//
// (@preconcurrency: swift-corelibs URL is not yet Sendable-annotated; the
// type is a value type and safe to send.)
@preconcurrency import Foundation

public enum ScenarioStoreError: Error, Equatable {
    case invalidName(detail: String)
    case tooLarge(detail: String)
    case notFound(name: String)
    case ioFailure(detail: String)
}

/// One stored scenario file (unverified bytes; the engine verifies on load).
public struct StoredScenario: Sendable, Equatable, Identifiable {
    /// Sanitized file stem, unique within the store.
    public var id: String
    public var url: URL
    public var byteCount: Int
}

/// One stored neural model package (manifest + weights + signature files).
public struct StoredModelPackage: Sendable, Equatable, Identifiable {
    public var id: String
    public var directory: URL
    public var manifestBytes: Int
    public var weightsBytes: Int
}

public struct ScenarioStore: Sendable {
    public let directory: URL
    private var scenariosDirectory: URL {
        directory.appendingPathComponent("scenarios")
    }
    private var modelsDirectory: URL {
        directory.appendingPathComponent("models")
    }

    public init(directory: URL) throws {
        self.directory = directory
        for sub in [directory,
                    directory.appendingPathComponent("scenarios"),
                    directory.appendingPathComponent("models")] {
            do {
                try FileManager.default.createDirectory(
                    at: sub, withIntermediateDirectories: true,
                    attributes: Self.protectionAttributes())
            } catch {
                throw ScenarioStoreError.ioFailure(
                    detail: "cannot create \(sub.path): \(error)")
            }
        }
    }

    /// iOS: imported packages rest encrypted until first unlock.
    private static func protectionAttributes() -> [FileAttributeKey: Any]? {
        #if os(iOS)
        return [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication]
        #else
        return nil
        #endif
    }

    // MARK: Scenarios

    /// All stored scenarios, sorted by name (deterministic listing).
    public func scenarios() -> [StoredScenario] {
        let fm = FileManager.default
        let entries = (try? fm.contentsOfDirectory(
            at: scenariosDirectory, includingPropertiesForKeys: nil)) ?? []
        return entries
            .filter { $0.pathExtension == "json" }
            .compactMap { url -> StoredScenario? in
                guard let size = try? fm.attributesOfItem(
                    atPath: url.path)[.size] as? Int else { return nil }
                return StoredScenario(
                    id: url.deletingPathExtension().lastPathComponent,
                    url: url, byteCount: size)
            }
            .sorted { $0.id < $1.id }
    }

    /// Import scenario bytes under a sanitized name.  The bytes are only
    /// size-checked here — signature verification happens in the engine.
    @discardableResult
    public func importScenario(data: Data,
                               preferredName: String) throws -> StoredScenario {
        guard data.count <= EngineLimits.maxScenarioBytes else {
            throw ScenarioStoreError.tooLarge(
                detail: "scenario is \(data.count) bytes")
        }
        let name = try Self.sanitize(preferredName)
        let url = scenariosDirectory.appendingPathComponent("\(name).json")
        try atomicWrite(data, to: url)
        return StoredScenario(id: name, url: url, byteCount: data.count)
    }

    public func readScenario(named name: String) throws -> Data {
        let url = scenariosDirectory
            .appendingPathComponent("\(try Self.sanitize(name)).json")
        guard FileManager.default.fileExists(atPath: url.path) else {
            throw ScenarioStoreError.notFound(name: name)
        }
        do { return try Data(contentsOf: url) } catch {
            throw ScenarioStoreError.ioFailure(
                detail: "cannot read \(url.path): \(error)")
        }
    }

    public func deleteScenario(named name: String) throws {
        let url = scenariosDirectory
            .appendingPathComponent("\(try Self.sanitize(name)).json")
        try? FileManager.default.removeItem(at: url)
    }

    // MARK: Neural model packages

    /// All stored model packages, sorted by name.
    public func models() -> [StoredModelPackage] {
        let fm = FileManager.default
        let entries = (try? fm.contentsOfDirectory(
            at: modelsDirectory, includingPropertiesForKeys: nil)) ?? []
        return entries
            .compactMap { dir -> StoredModelPackage? in
                var isDirectory = ObjCBool(false)
                guard fm.fileExists(atPath: dir.path,
                                    isDirectory: &isDirectory),
                      isDirectory.boolValue else { return nil }
                let manifest = dir.appendingPathComponent("manifest.json")
                let weights = dir.appendingPathComponent("weights.bin")
                let signature = dir.appendingPathComponent("model.sig")
                guard let manifestSize = try? fm.attributesOfItem(
                        atPath: manifest.path)[.size] as? Int,
                      let weightsSize = try? fm.attributesOfItem(
                        atPath: weights.path)[.size] as? Int,
                      fm.fileExists(atPath: signature.path) else { return nil }
                return StoredModelPackage(id: dir.lastPathComponent,
                                          directory: dir,
                                          manifestBytes: manifestSize,
                                          weightsBytes: weightsSize)
            }
            .sorted { $0.id < $1.id }
    }

    /// Import a model package triplet under a sanitized name.
    @discardableResult
    public func importModel(manifest: Data, weights: Data, signature: Data,
                            preferredName: String) throws -> StoredModelPackage {
        guard manifest.count <= EngineLimits.maxManifestBytes else {
            throw ScenarioStoreError.tooLarge(
                detail: "manifest is \(manifest.count) bytes")
        }
        guard weights.count <= EngineLimits.maxWeightsBytes else {
            throw ScenarioStoreError.tooLarge(
                detail: "weights are \(weights.count) bytes")
        }
        guard signature.count <= EngineLimits.maxSignatureBytes else {
            throw ScenarioStoreError.tooLarge(
                detail: "signature is \(signature.count) bytes")
        }
        let name = try Self.sanitize(preferredName)
        let dir = modelsDirectory.appendingPathComponent(name)
        do {
            try FileManager.default.createDirectory(
                at: dir, withIntermediateDirectories: true,
                attributes: Self.protectionAttributes())
        } catch {
            throw ScenarioStoreError.ioFailure(
                detail: "cannot create \(dir.path): \(error)")
        }
        try atomicWrite(manifest, to: dir.appendingPathComponent("manifest.json"))
        try atomicWrite(weights, to: dir.appendingPathComponent("weights.bin"))
        try atomicWrite(signature, to: dir.appendingPathComponent("model.sig"))
        return StoredModelPackage(id: name, directory: dir,
                                  manifestBytes: manifest.count,
                                  weightsBytes: weights.count)
    }

    /// Read a stored package back as loadable buffers.
    public func readModel(named name: String) throws -> NeuralModelPackage {
        let dir = modelsDirectory.appendingPathComponent(try Self.sanitize(name))
        guard FileManager.default.fileExists(atPath: dir.path) else {
            throw ScenarioStoreError.notFound(name: name)
        }
        do {
            return NeuralModelPackage(
                manifest: try Data(contentsOf: dir.appendingPathComponent("manifest.json")),
                weights: try Data(contentsOf: dir.appendingPathComponent("weights.bin")),
                signature: try Data(contentsOf: dir.appendingPathComponent("model.sig")))
        } catch {
            throw ScenarioStoreError.ioFailure(
                detail: "cannot read package \(name): \(error)")
        }
    }

    public func deleteModel(named name: String) throws {
        let dir = modelsDirectory.appendingPathComponent(try Self.sanitize(name))
        try? FileManager.default.removeItem(at: dir)
    }

    // MARK: Internals

    /// Restrict names to a filesystem-safe, traversal-proof alphabet.
    /// Dots are excluded entirely — no hidden files, no ".." components,
    /// no surprise double extensions.
    static func sanitize(_ name: String) throws -> String {
        let allowed = Set("abcdefghijklmnopqrstuvwxyz"
            + "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-")
        let stem = name.hasSuffix(".json") ? String(name.dropLast(5)) : name
        let cleaned = String(stem.unicodeScalars
            .map { allowed.contains(Character($0)) ? Character($0) : "_" }
            .prefix(80))
        guard !cleaned.isEmpty, !cleaned.allSatisfy({ $0 == "_" }) else {
            throw ScenarioStoreError.invalidName(detail: "unusable name '\(name)'")
        }
        return cleaned
    }

    private func atomicWrite(_ data: Data, to destination: URL) throws {
        let temp = destination.appendingPathExtension("tmp")
        do {
            try data.write(to: temp)
        } catch {
            try? FileManager.default.removeItem(at: temp)
            throw ScenarioStoreError.ioFailure(
                detail: "write to \(destination.path) failed: \(error)")
        }
        let renamed = temp.path.withCString { source in
            destination.path.withCString { target in
                rename(source, target)
            }
        }
        guard renamed == 0 else {
            let code = errno
            try? FileManager.default.removeItem(at: temp)
            throw ScenarioStoreError.ioFailure(
                detail: "rename to \(destination.path) failed (errno \(code))")
        }
    }
}
