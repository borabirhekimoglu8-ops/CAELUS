//
//  SessionHistoryView.swift
//  CAELUSMobileUI
//
//  Stored checkpoints of the active scenario: what was saved, when, why,
//  and at which tick.  Restoring is a full session rebuild (scenario and
//  model signatures re-verified, checkpoint binding + integrity validated
//  by the native core) — never a silent in-place mutation.
//
#if os(iOS) && canImport(SwiftUI)
import CAELUSMobileCore
import SwiftUI

struct SessionHistoryView: View {
    @ObservedObject var app: AppModel
    @ObservedObject var session: SessionViewModel
    @State private var restoreCandidate: CheckpointRecord?

    var body: some View {
        List {
            Section("Checkpoints (newest last)") {
                if session.checkpoints.isEmpty {
                    Text("No checkpoints stored yet.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                ForEach(session.checkpoints) { record in
                    checkpointRow(record)
                }
            } footer: {
                Text("Checkpoints are written atomically with an integrity "
                    + "hash and bound to the exact scenario, model, and "
                    + "engine version. Restore rebuilds the whole session "
                    + "and is audited as CHECKPOINT_RESTORED.")
            }
        }
        .navigationTitle("Session History")
        .refreshable { await session.refresh() }
        .confirmationDialog(
            "Restore this checkpoint? The current live session will be "
            + "sealed and replaced.",
            isPresented: Binding(
                get: { restoreCandidate != nil },
                set: { if !$0 { restoreCandidate = nil } }),
            titleVisibility: .visible
        ) {
            Button("Seal current & restore", role: .destructive) {
                if let record = restoreCandidate {
                    Task { await restore(record) }
                }
            }
        }
    }

    private func checkpointRow(_ record: CheckpointRecord) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text("Tick \(record.tick)")
                        .font(.callout.weight(.semibold).monospacedDigit())
                    StatusBadge(text: record.trigger.rawValue,
                                color: triggerColor(record.trigger))
                }
                Text(Date(timeIntervalSince1970:
                        TimeInterval(record.createdAtEpochSeconds)),
                     style: .relative)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                Text("\(record.scenarioID) — \(record.byteCount) bytes")
                    .font(.caption2.monospaced())
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Button("Restore") { restoreCandidate = record }
                .buttonStyle(.bordered)
                .controlSize(.small)
        }
        .padding(.vertical, 2)
    }

    private func triggerColor(_ trigger: CheckpointTrigger) -> Color {
        switch trigger {
        case .manual: return .blue
        case .background: return .indigo
        case .leverApplied: return .orange
        case .beforeExport: return .teal
        default: return .secondary
        }
    }

    /// Gate + rebuild: user intent is confirmed, then the AppModel replays
    /// the stored scenario/model into a fresh engine and restores the
    /// selected envelope through the fail-closed native path.
    private func restore(_ record: CheckpointRecord) async {
        guard await session.gate.authorize(
            .restoreCheckpoint,
            reason: "Restore checkpoint at tick \(record.tick)") else {
            return
        }
        await app.restoreCheckpoint(record)
    }
}
#endif
