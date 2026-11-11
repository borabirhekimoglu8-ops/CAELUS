//
//  AuditView.swift
//  CAELUSMobileUI
//
//  Chain status, seal state, session identity, scenario/model binding, and
//  a browsable view of the exported hash-chained events.  The screen is
//  explicit about the guarantee: a local append-only file is TAMPER-EVIDENT
//  (any modification breaks the Blake3 chain / ed25519 seal) but not
//  deletion-proof — deletion resistance requires exporting to independent
//  custody.
//
#if os(iOS) && canImport(SwiftUI)
import CAELUSMobileCore
import SwiftUI

struct AuditView: View {
    @ObservedObject var session: SessionViewModel
    @State private var records: [AuditDisplayRecord] = []
    @State private var loadingChain = false
    @State private var confirmSeal = false

    var body: some View {
        List {
            statusSection
            bindingSection
            eventsSection
        }
        .navigationTitle("Audit & Integrity")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button("Seal session", role: .destructive) {
                    confirmSeal = true
                }
                .disabled(session.auditStatus?.sealed == true)
            }
        }
        .confirmationDialog(
            "Seal the audit chain? No further events can ever be appended "
            + "to this session.",
            isPresented: $confirmSeal, titleVisibility: .visible
        ) {
            Button("Seal permanently", role: .destructive) {
                Task {
                    await session.sealSession()
                    await loadChain()
                }
            }
        }
        .task { await loadChain() }
        .refreshable {
            await session.refresh()
            await loadChain()
        }
    }

    private var statusSection: some View {
        Section("Chain status") {
            HStack {
                Image(systemName: chainIconName)
                    .foregroundStyle(chainIconColor)
                Text(chainStatusText)
                Spacer()
                if session.auditStatus?.sealed == true {
                    StatusBadge(text: "SEALED", color: .blue)
                }
            }
            KeyValueRow(key: "Hash-chained events",
                        value: "\(session.auditStatus?.entries ?? 0)")
            KeyValueRow(key: "Chain head",
                        value: abbreviatedHash(session.auditStatus?.chainHead),
                        monospaced: true)
            KeyValueRow(key: "Session",
                        value: session.auditStatus?.sessionID ?? "—",
                        monospaced: true)
            Text("Tamper-evident, not deletion-proof: any edit breaks the "
                + "Blake3 chain and the ed25519 seal, but only exported "
                + "copies survive local deletion. Export regularly.")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
    }

    private var bindingSection: some View {
        Section("Session binding") {
            KeyValueRow(key: "Scenario",
                        value: session.snapshot?.scenario.id ?? "—",
                        monospaced: true)
            KeyValueRow(key: "Scenario hash",
                        value: abbreviatedHash(
                            session.snapshot?.scenario.scenarioHash),
                        monospaced: true)
            KeyValueRow(key: "Model",
                        value: session.snapshot?.neural.modelID ?? "none",
                        monospaced: true)
            KeyValueRow(key: "Model hash",
                        value: abbreviatedHash(
                            session.snapshot?.neural.modelHash),
                        monospaced: true)
            KeyValueRow(key: "Engine",
                        value: session.snapshot?.engineVersion ?? "—")
        }
    }

    private var eventsSection: some View {
        Section("Chained events (newest first)") {
            if loadingChain {
                ProgressView()
            } else if records.isEmpty {
                Text("Chain export unavailable.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            ForEach(records.reversed()) { record in
                VStack(alignment: .leading, spacing: 3) {
                    HStack {
                        Text("#\(record.seq)")
                            .font(.caption2.monospacedDigit())
                            .foregroundStyle(.secondary)
                        StatusBadge(text: record.eventType ?? record.kind,
                                    color: badgeColor(record))
                        Spacer()
                        Text(abbreviatedHash(record.hashHex))
                            .font(.caption2.monospaced())
                            .foregroundStyle(.secondary)
                    }
                    if !record.detail.isEmpty {
                        Text(record.detail)
                            .font(.caption.monospaced())
                            .foregroundStyle(.secondary)
                            .lineLimit(3)
                    }
                }
                .padding(.vertical, 1)
            }
        }
    }

    // MARK: Helpers

    private var chainStatusText: String {
        guard let status = session.auditStatus else { return "Unknown" }
        if status.sealed { return "Chain sealed and readable" }
        return status.open ? "Chain open and appending" : "Chain unavailable"
    }

    private var chainIconName: String {
        guard let status = session.auditStatus else { return "questionmark.circle" }
        if status.sealed { return "checkmark.seal.fill" }
        return status.open ? "link.circle.fill" : "xmark.circle.fill"
    }

    private var chainIconColor: Color {
        guard let status = session.auditStatus else { return .gray }
        if status.sealed { return .blue }
        return status.open ? .green : .red
    }

    private func badgeColor(_ record: AuditDisplayRecord) -> Color {
        switch record.kind {
        case "GENESIS": return .blue
        case "SEAL": return .purple
        case "UNPARSEABLE": return .red
        default:
            let type = record.eventType ?? ""
            if type.contains("REJECT") || type.contains("FALLBACK") {
                return .orange
            }
            return .teal
        }
    }

    private func abbreviatedHash(_ hex: String?) -> String {
        guard let hex, hex.count > 16 else { return hex ?? "—" }
        return "\(hex.prefix(8))…\(hex.suffix(8))"
    }

    private func loadChain() async {
        loadingChain = true
        if let ndjson = await session.exportAuditChain() {
            records = AuditBrowser.parse(ndjson: ndjson)
        }
        loadingChain = false
    }
}
#endif
