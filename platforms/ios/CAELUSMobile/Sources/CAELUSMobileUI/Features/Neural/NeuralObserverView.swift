//
//  NeuralObserverView.swift
//  CAELUSMobileUI
//
//  The neural layer's full evidence surface: execution mode, model
//  identity, last Neural Gate decision, per-node REPORTED vs ESTIMATED vs
//  AUTHORITATIVE state, and the bounded trust adjustments the symbolic
//  authority actually committed.  Estimates are always labelled as such —
//  the deterministic engine remains the single source of truth.
//
#if os(iOS) && canImport(SwiftUI)
import CAELUSMobileCore
import SwiftUI

struct NeuralObserverView: View {
    @ObservedObject var session: SessionViewModel

    private var neural: NeuralInfo? { session.snapshot?.neural }

    var body: some View {
        List {
            modeSection
            if let neural, neural.modelLoaded {
                modelSection(neural)
                gateSection(neural)
                estimatesSection(neural)
                proposalsSection(neural)
            } else {
                Section {
                    Text("No neural model active — the session runs "
                        + "symbolic-only. Load a signed model package when "
                        + "starting a session to enable deterministic "
                        + "neural assurance.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .navigationTitle("Neural Observer")
        .refreshable { await session.refresh() }
    }

    private var modeSection: some View {
        Section("Execution mode") {
            HStack {
                StatusBadge(text: neural?.mode.displayName ?? "Unknown",
                            color: Theme.color(for: neural?.mode ?? .unknown))
                Spacer()
                if let ticks = neural?.observedHistoryTicks {
                    Text("\(ticks) observed history ticks")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            Text("Neural output NEVER mutates state directly. Every "
                + "proposal passes the Neural Gate and only bounded trust "
                + "adjustments the symbolic authority re-validates are "
                + "committed — all of it audited.")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
    }

    private func modelSection(_ neural: NeuralInfo) -> some View {
        Section("Signed model") {
            KeyValueRow(key: "Model", value: neural.modelID ?? "—",
                        monospaced: true)
            KeyValueRow(key: "Version", value: neural.modelVersion ?? "—")
            KeyValueRow(key: "Status", value: neural.modelStatus)
            if let hash = neural.modelHash {
                KeyValueRow(key: "Package hash",
                            value: String(hash.prefix(16)) + "…",
                            monospaced: true)
            }
        }
    }

    private func gateSection(_ neural: NeuralInfo) -> some View {
        Section("Neural Gate — last decision") {
            HStack {
                StatusBadge(text: neural.lastGateDecision?.rawValue ?? "NONE",
                            color: Theme.color(for: neural.lastGateDecision))
                Spacer()
                if let tick = neural.lastTick {
                    Text("tick \(tick)")
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(.secondary)
                }
            }
            if let reason = neural.lastRejectionReason, !reason.isEmpty {
                Text(reason)
                    .font(.footnote)
                    .foregroundStyle(.red)
            }
            HStack(spacing: 10) {
                MetricTile(caption: "Confidence (min)",
                           value: neural.confidenceMinFP?.fpPercent ?? "—")
                MetricTile(caption: "OOD (max)",
                           value: neural.oodMaxFP?.fpPercent ?? "—",
                           accent: neural.oodMaxFP.map {
                               Theme.riskColor(fp: $0)
                           } ?? .primary)
                MetricTile(caption: "Authority",
                           value: neural.authorityCommitted == true
                               ? "COMMITTED" : "—",
                           accent: neural.authorityCommitted == true
                               ? .green : .secondary)
            }
        }
    }

    private func estimatesSection(_ neural: NeuralInfo) -> some View {
        Section("Per-node state (reported / estimated / authoritative)") {
            if (neural.nodes ?? []).isEmpty {
                Text("No gated estimates yet — advance the simulation.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            ForEach(neural.nodes ?? [], id: \.nodeID) { estimate in
                estimateRow(estimate)
            }
        }
    }

    private func estimateRow(_ estimate: NeuralNodeEstimate) -> some View {
        let authoritative = session.snapshot?.nodes
            .first { $0.id == estimate.nodeID }
        return VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(estimate.nodeID).font(.callout.monospaced())
                Spacer()
                if estimate.telemetryAnomalyScoreFP >= 500_000 {
                    StatusBadge(text: "ANOMALY", color: .orange)
                }
            }
            HStack(spacing: 10) {
                MetricTile(caption: "Reported",
                           value: authoritative?.reportedStateFP.fpDecimal ?? "—",
                           accent: .orange)
                MetricTile(caption: "Estimated",
                           value: estimate.estimatedTrueStateFP.fpDecimal,
                           accent: .purple)
                MetricTile(caption: "Authoritative",
                           value: authoritative?.stateFP.fpDecimal ?? "—",
                           accent: .blue)
            }
            HStack(spacing: 10) {
                ProbabilityBar(labelText: "Outage short",
                               valueFP: estimate.outageShortFP)
                ProbabilityBar(labelText: "medium",
                               valueFP: estimate.outageMediumFP)
                ProbabilityBar(labelText: "long",
                               valueFP: estimate.outageLongFP)
            }
        }
        .padding(.vertical, 2)
    }

    private func proposalsSection(_ neural: NeuralInfo) -> some View {
        Section("Committed trust adjustments (bounded)") {
            if (neural.appliedProposals ?? []).isEmpty {
                Text("The authority committed no adjustments on the last "
                    + "gated tick.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            ForEach(neural.appliedProposals ?? [], id: \.nodeID) { proposal in
                HStack {
                    Text(proposal.nodeID).font(.callout.monospaced())
                    Spacer()
                    Text("\(proposal.trustBeforeFP.fpPercent) → "
                        + "\(proposal.trustAfterFP.fpPercent)")
                        .font(.callout.monospacedDigit())
                        .foregroundStyle(
                            proposal.deltaFP < 0 ? .orange : .green)
                }
                .accessibilityLabel(Text(
                    "Node \(proposal.nodeID) trust adjusted from "
                    + "\(proposal.trustBeforeFP.fpPercent) to "
                    + "\(proposal.trustAfterFP.fpPercent)"))
            }
        }
    }
}
#endif
