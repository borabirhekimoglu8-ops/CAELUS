//
//  DiagnosticsView.swift
//  CAELUSMobileUI
//
//  Application diagnostics: versions, ABI limits, session configuration,
//  storage paths, and the most recent native error — everything needed to
//  file an actionable problem report without attaching operational data.
//
#if os(iOS) && canImport(SwiftUI)
import CAELUSMobileCore
import SwiftUI

struct DiagnosticsView: View {
    @ObservedObject var app: AppModel
    var session: SessionViewModel?
    @State private var nativeError: String = ""

    var body: some View {
        List {
            versionSection
            if let session {
                sessionSection(session)
            }
            limitsSection
            storageSection
        }
        .navigationTitle("Diagnostics")
        .task {
            if let session {
                nativeError = await session.controller.lastErrorDetail()
            }
        }
    }

    private var versionSection: some View {
        Section("Versions") {
            KeyValueRow(key: "Engine",
                        value: app.trustAnchors?.engineVersion ?? "—")
            KeyValueRow(key: "Mobile ABI",
                        value: "v\(app.trustAnchors?.abiVersion ?? 0)")
            KeyValueRow(key: "Snapshot format",
                        value: EngineSnapshot.expectedType, monospaced: true)
        }
    }

    private func sessionSection(_ session: SessionViewModel) -> some View {
        Section("Active session") {
            KeyValueRow(key: "Scenario file",
                        value: session.scenarioName, monospaced: true)
            KeyValueRow(key: "Model file",
                        value: session.modelName ?? "none", monospaced: true)
            KeyValueRow(key: "Run state",
                        value: runStateText(session.runState))
            KeyValueRow(key: "Tick",
                        value: "\(session.snapshot?.tick ?? 0)")
            KeyValueRow(key: "Nodes / edges",
                        value: "\(session.snapshot?.nodes.count ?? 0) / "
                            + "\(session.snapshot?.edges.count ?? 0)")
            KeyValueRow(key: "Checkpoints stored",
                        value: "\(session.checkpoints.count)")
            if !nativeError.isEmpty {
                VStack(alignment: .leading, spacing: 3) {
                    Text("Last native error")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    Text(nativeError)
                        .font(.caption.monospaced())
                        .foregroundStyle(.red)
                        .textSelection(.enabled)
                }
            }
        }
    }

    private var limitsSection: some View {
        Section("ABI v1 input limits") {
            KeyValueRow(key: "Scenario",
                        value: "\(EngineLimits.maxScenarioBytes / 1024) KiB")
            KeyValueRow(key: "Model manifest",
                        value: "\(EngineLimits.maxManifestBytes / 1024) KiB")
            KeyValueRow(key: "Model weights",
                        value: "\(EngineLimits.maxWeightsBytes / (1024 * 1024)) MiB")
            KeyValueRow(key: "Checkpoint",
                        value: "\(EngineLimits.maxCheckpointBytes / (1024 * 1024)) MiB")
            KeyValueRow(key: "Ticks per call",
                        value: "\(EngineLimits.maxTicksPerCall)")
        }
    }

    private var storageSection: some View {
        Section("Storage") {
            KeyValueRow(key: "Audit directory",
                        value: app.auditDirectory.lastPathComponent,
                        monospaced: true)
            Text("All storage lives inside the app sandbox with iOS file "
                + "protection (complete-until-first-unlock). The identity "
                + "seed is wrapped by a Keychain-held key and never stored "
                + "in plaintext.")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
    }

    private func runStateText(_ state: SessionRunState) -> String {
        switch state {
        case .paused: return "Paused"
        case .running: return "Auto-advancing"
        case .busy(let what): return what
        case .sealed: return "Sealed"
        }
    }
}
#endif
