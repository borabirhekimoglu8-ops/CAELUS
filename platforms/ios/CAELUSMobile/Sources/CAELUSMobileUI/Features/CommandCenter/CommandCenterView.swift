//
//  CommandCenterView.swift
//  CAELUSMobileUI
//
//  iPhone-first at-a-glance operational screen: regime, outage latch, top
//  friction sources, multi-horizon outage risk, neural gate state, and the
//  primary actions (advance, pause/resume, apply top lever, save, export).
//
#if os(iOS) && canImport(SwiftUI)
import CAELUSMobileCore
import SwiftUI
import UIKit

struct CommandCenterView: View {
    @ObservedObject var session: SessionViewModel
    @State private var showReportSheet = false
    @State private var reportFileURL: URL?

    var body: some View {
        ScrollView {
            VStack(spacing: 12) {
                if let message = session.lastError {
                    ErrorBanner(message: message) { session.clearError() }
                }
                if let summary = session.summary {
                    headline(summary)
                    frictionCard(summary)
                    riskCard(summary)
                    neuralCard(summary)
                    leverCard(summary)
                    integrityCard(summary)
                } else {
                    ProgressView("Reading engine state…")
                        .frame(maxWidth: .infinity, minHeight: 200)
                }
            }
            .padding(.horizontal)
            .padding(.bottom, 90)
        }
        .background(Color(uiColor: .systemGroupedBackground))
        .navigationTitle("Command Center")
        .navigationBarTitleDisplayMode(.inline)
        .safeAreaInset(edge: .bottom) { actionBar }
        .sheet(isPresented: $showReportSheet) { reportSheet }
        .refreshable { await session.refresh() }
    }

    // MARK: Headline

    private func headline(_ summary: CommandCenterSummary) -> some View {
        SectionCard(title: summary.scenarioTitle ?? "No scenario") {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 8) {
                        StatusBadge(text: summary.regime.rawValue,
                                    color: Theme.color(for: summary.regime))
                        if summary.outageLatched {
                            StatusBadge(text: "OUTAGE LATCHED", color: .red)
                        }
                        if !summary.scenarioSignatureVerified {
                            StatusBadge(text: "UNVERIFIED", color: .red)
                        }
                    }
                    Text(summary.scenarioID ?? "—")
                        .font(.caption.monospaced())
                        .foregroundStyle(.secondary)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 2) {
                    Text("Tick \(summary.tick)")
                        .font(.title3.weight(.bold).monospacedDigit())
                    Text("T+\(summary.virtualMinutes.virtualDuration)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            HStack(spacing: 10) {
                MetricTile(caption: "System friction",
                           value: summary.frictionFP.fpDecimal,
                           accent: Theme.color(for: summary.regime))
                MetricTile(caption: "Regime headroom",
                           value: CausalMapLayoutBuilder
                            .regimeHeadroomFP(frictionClampedFP: summary.frictionFP)
                            .fpDecimal)
                MetricTile(caption: "Pending intel",
                           value: "\(summary.pendingIntelEvents)")
            }
        }
    }

    // MARK: Cards

    private func frictionCard(_ summary: CommandCenterSummary) -> some View {
        SectionCard(title: "Top friction sources") {
            if summary.topFrictionSources.isEmpty {
                Text("No friction contributors")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            ForEach(summary.topFrictionSources) { source in
                HStack {
                    Circle()
                        .fill(Theme.color(for: source.kind))
                        .frame(width: 8, height: 8)
                    Text(source.id)
                        .font(.callout.monospaced())
                        .lineLimit(1)
                    Spacer()
                    if source.deviationFP != 0 {
                        StatusBadge(
                            text: "Δ \(source.deviationFP.fpDecimal)",
                            color: .orange)
                    }
                    Text(source.contributionFP.fpDecimal)
                        .font(.callout.monospacedDigit().weight(.semibold))
                }
                .accessibilityElement(children: .combine)
            }
        }
    }

    private func riskCard(_ summary: CommandCenterSummary) -> some View {
        SectionCard(title: "Outage risk (neural estimate)") {
            if let risk = summary.outageRisk {
                ProbabilityBar(labelText: "Short horizon", valueFP: risk.shortFP)
                ProbabilityBar(labelText: "Medium horizon", valueFP: risk.mediumFP)
                ProbabilityBar(labelText: "Long horizon", valueFP: risk.longFP)
                Text("Estimated state — the deterministic symbolic engine "
                    + "remains authoritative.")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            } else {
                Text("No accepted neural evidence — symbolic-only operation.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func neuralCard(_ summary: CommandCenterSummary) -> some View {
        SectionCard(title: "Neural layer") {
            HStack(spacing: 8) {
                StatusBadge(text: summary.neuralMode.displayName,
                            color: Theme.color(for: summary.neuralMode))
                if let decision = summary.lastGateDecision {
                    StatusBadge(text: decision.rawValue,
                                color: Theme.color(for: decision))
                }
            }
            HStack(spacing: 10) {
                MetricTile(caption: "Confidence (min)",
                           value: summary.neuralConfidenceFP?.fpPercent ?? "—")
                MetricTile(caption: "OOD (max)",
                           value: summary.neuralOODFP?.fpPercent ?? "—",
                           accent: summary.neuralOODFP.map {
                               Theme.riskColor(fp: $0)
                           } ?? .primary)
            }
        }
    }

    private func leverCard(_ summary: CommandCenterSummary) -> some View {
        SectionCard(title: "Highest-priority lever") {
            if let leverID = summary.recommendedLeverID,
               let lever = session.snapshot?.levers.first(where: { $0.id == leverID }) {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(lever.id).font(.callout.monospaced())
                        Text("→ \(lever.target)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    Text("p=\(lever.successProbabilityFP.fpPercent)")
                        .font(.caption.monospacedDigit())
                    Button("Apply") {
                        Task { await session.applyLever(lever) }
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.small)
                    .disabled(session.runState == .sealed)
                }
            } else {
                Text("No applicable lever right now.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func integrityCard(_ summary: CommandCenterSummary) -> some View {
        SectionCard(title: "Audit integrity") {
            HStack(spacing: 8) {
                Image(systemName: summary.auditChainIntact
                    ? "checkmark.seal.fill" : "xmark.seal.fill")
                    .foregroundStyle(summary.auditChainIntact ? .green : .red)
                Text(summary.auditChainIntact
                    ? "Chain open, \(session.auditStatus?.entries ?? 0) hash-chained events"
                    : "Chain unavailable")
                    .font(.footnote)
                Spacer()
                if session.auditStatus?.sealed == true {
                    StatusBadge(text: "SEALED", color: .blue)
                }
            }
        }
    }

    // MARK: Action bar

    private var actionBar: some View {
        HStack(spacing: 10) {
            Button {
                Task { await session.advance(1) }
            } label: {
                Label("Tick", systemImage: "forward.frame.fill")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)

            Button {
                Task { await session.advance(10) }
            } label: {
                Label("×10", systemImage: "forward.fill")
            }
            .buttonStyle(.bordered)

            Button {
                if session.runState == .running {
                    session.pauseAutoAdvance()
                } else {
                    session.resumeAutoAdvance()
                }
            } label: {
                Image(systemName: session.runState == .running
                    ? "pause.fill" : "play.fill")
            }
            .buttonStyle(.bordered)
            .accessibilityLabel(Text(session.runState == .running
                ? "Pause simulation" : "Resume simulation"))

            Button {
                Task { await session.saveCheckpoint(trigger: .manual) }
            } label: {
                Image(systemName: "externaldrive.fill.badge.checkmark")
            }
            .buttonStyle(.bordered)
            .accessibilityLabel(Text("Save session checkpoint"))

            Button {
                Task {
                    if let report = await session.buildReport() {
                        reportFileURL = writeTemporary(report: report)
                        showReportSheet = reportFileURL != nil
                    }
                }
            } label: {
                Image(systemName: "square.and.arrow.up")
            }
            .buttonStyle(.bordered)
            .accessibilityLabel(Text("Export report"))
        }
        .disabled(session.runState == .sealed)
        .padding(.horizontal)
        .padding(.vertical, 8)
        .background(.thinMaterial)
    }

    private var reportSheet: some View {
        Group {
            if let url = reportFileURL {
                ShareLink(item: url) {
                    Label("Share \(url.lastPathComponent)",
                          systemImage: "square.and.arrow.up")
                        .padding()
                }
                .presentationDetents([.medium])
            }
        }
    }

    private func writeTemporary(report: ExecutiveReport) -> URL? {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent(report.suggestedFileName)
        do {
            try report.utf8Data.write(to: url, options: .atomic)
            return url
        } catch {
            return nil
        }
    }
}
#endif
