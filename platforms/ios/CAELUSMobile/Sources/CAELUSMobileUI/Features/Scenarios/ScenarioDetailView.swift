//
//  ScenarioDetailView.swift
//  CAELUSMobileUI
//
//  Pre-load inspection of a stored scenario package: declared metadata,
//  size, and the local Blake3 digest of the exact bytes on disk.  Shown
//  values are DECLARED (unverified) until the engine's signature check
//  passes at session start — the screen says so explicitly.
//
#if os(iOS) && canImport(SwiftUI)
import CAELUSMobileCore
import SwiftUI

struct ScenarioDetailView: View {
    let scenario: StoredScenario
    @ObservedObject var app: AppModel

    @State private var meta: [String: String] = [:]
    @State private var digestHex: String = ""
    @State private var loadFailure: String?

    var body: some View {
        List {
            Section("Package") {
                KeyValueRow(key: "File", value: scenario.id, monospaced: true)
                KeyValueRow(key: "Size", value: "\(scenario.byteCount) bytes")
                KeyValueRow(key: "Blake3 (local bytes)",
                            value: digestHex.isEmpty ? "…" : digestHex,
                            monospaced: true)
            }
            Section("Declared metadata (unverified until load)") {
                if let loadFailure {
                    Text(loadFailure)
                        .font(.footnote)
                        .foregroundStyle(.red)
                }
                ForEach(meta.keys.sorted(), id: \.self) { key in
                    KeyValueRow(key: key, value: meta[key] ?? "")
                }
            } footer: {
                Text("Metadata above is read from the package for preview "
                    + "only. The ed25519 signature over the canonical "
                    + "critical fields is verified by the embedded engine "
                    + "when a session starts; a tampered package will be "
                    + "rejected and audited at that point.")
            }
        }
        .navigationTitle(scenario.id)
        .navigationBarTitleDisplayMode(.inline)
        .task { load() }
    }

    private func load() {
        guard let store = app.scenarioStore else { return }
        do {
            let data = try store.readScenario(named: scenario.id)
            digestHex = (try? EngineController.blake3(data))
                .map { $0.map { String(format: "%02x", $0) }.joined() } ?? "—"
            parseMeta(data)
        } catch {
            loadFailure = "Cannot read package: \(error)"
        }
    }

    private func parseMeta(_ data: Data) {
        guard let object = try? JSONSerialization.jsonObject(with: data),
              let root = object as? [String: Any] else {
            loadFailure = "Package is not valid JSON."
            return
        }
        var result: [String: String] = [:]
        for key in ["id", "schema_version", "sector", "blackswan_class",
                    "min_caelus_engine"] {
            if let value = root[key] as? String {
                result[key] = value
            } else if let value = root[key] as? NSNumber {
                result[key] = value.stringValue
            }
        }
        if let metaDict = root["meta"] as? [String: Any] {
            for key in ["title", "region", "tick_minutes", "horizon_hours"] {
                if let value = metaDict[key] as? String {
                    result["meta.\(key)"] = value
                } else if let value = metaDict[key] as? NSNumber {
                    result["meta.\(key)"] = value.stringValue
                }
            }
            if let synopsis = metaDict["synopsis"] as? String {
                result["meta.synopsis"] = String(synopsis.prefix(280))
            }
        }
        result["signature.present"] =
            root["signature"] != nil ? "yes" : "NO — will be rejected"
        meta = result
    }
}
#endif
