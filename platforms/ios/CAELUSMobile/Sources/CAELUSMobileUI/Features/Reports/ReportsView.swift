//
//  ReportsView.swift
//  CAELUSMobileUI
//
//  Export surface: deterministic executive report (Markdown), full-state
//  snapshot JSON, and the audit NDJSON — all through the native share
//  sheet, never through any automatic upload.
//
#if os(iOS) && canImport(SwiftUI)
import CAELUSMobileCore
import SwiftUI

struct ReportsView: View {
    @ObservedObject var session: SessionViewModel
    @State private var exports: [ExportItem] = []
    @State private var working = false

    struct ExportItem: Identifiable {
        let id = UUID()
        let title: String
        let subtitle: String
        let url: URL
    }

    var body: some View {
        List {
            if let message = session.lastError {
                Section {
                    ErrorBanner(message: message) { session.clearError() }
                        .listRowInsets(EdgeInsets())
                }
            }
            Section("Generate") {
                exportButton(
                    "Executive report (Markdown)",
                    icon: "doc.richtext",
                    detail: "Deterministic function of the current state — "
                        + "same state, same bytes.") {
                    await generateExecutiveReport()
                }
                exportButton(
                    "State snapshot (JSON)",
                    icon: "curlybraces.square",
                    detail: "Full CAELUS_MOBILE_SNAPSHOT_V1 payload.") {
                    await generateSnapshotExport()
                }
                exportButton(
                    "Audit chain (NDJSON)",
                    icon: "link",
                    detail: "Hash-chained events + seal; verifiable with "
                        + "tools/verify_audit_log.py.") {
                    await generateAuditExport()
                }
            }
            Section("Ready to share") {
                if exports.isEmpty {
                    Text("Generated files appear here for sharing.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                ForEach(exports) { item in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(item.title).font(.callout)
                            Text(item.subtitle)
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        ShareLink(item: item.url) {
                            Image(systemName: "square.and.arrow.up")
                        }
                        .accessibilityLabel(Text("Share \(item.title)"))
                    }
                }
            } footer: {
                Text("Nothing leaves this device unless you share it. "
                    + "Files are written to the app's sandbox and removed "
                    + "with the app.")
            }
        }
        .navigationTitle("Reports & Export")
        .overlay {
            if working { ProgressView() }
        }
    }

    private func exportButton(_ title: String, icon: String, detail: String,
                              action: @escaping () async -> Void) -> some View {
        Button {
            working = true
            Task {
                await action()
                working = false
            }
        } label: {
            HStack {
                Image(systemName: icon)
                    .frame(width: 28)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).foregroundStyle(.primary)
                    Text(detail)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .disabled(working)
    }

    // MARK: Generators

    private func generateExecutiveReport() async {
        guard let report = await session.buildReport() else { return }
        if let url = write(report.utf8Data, name: report.suggestedFileName) {
            exports.insert(ExportItem(
                title: report.suggestedFileName,
                subtitle: "\(report.utf8Data.count) bytes — Markdown",
                url: url), at: 0)
        }
    }

    private func generateSnapshotExport() async {
        do {
            let data = try await session.controller.snapshotData()
            let tick = session.snapshot?.tick ?? 0
            let name = "caelus_snapshot_t\(tick).json"
            if let url = write(data, name: name) {
                exports.insert(ExportItem(
                    title: name,
                    subtitle: "\(data.count) bytes — snapshot JSON",
                    url: url), at: 0)
            }
        } catch {
            // Error already surfaced through the controller's last-error path
            // on the next refresh; nothing to add here.
        }
    }

    private func generateAuditExport() async {
        guard let data = await session.exportAuditChain() else { return }
        let name = "caelus_audit_\(session.auditStatus?.sessionID ?? "session").ndjson"
        if let url = write(data, name: name) {
            exports.insert(ExportItem(
                title: name,
                subtitle: "\(data.count) bytes — hash-chained NDJSON",
                url: url), at: 0)
        }
    }

    private func write(_ data: Data, name: String) -> URL? {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("exports", isDirectory: true)
        try? FileManager.default.createDirectory(
            at: directory, withIntermediateDirectories: true)
        let url = directory.appendingPathComponent(name)
        do {
            try data.write(to: url, options: .atomic)
            return url
        } catch {
            return nil
        }
    }
}
#endif
