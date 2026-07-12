//
//  LeverCenterView.swift
//  CAELUSMobileUI
//
//  Every scenario lever with its live state (availability, lockout,
//  deterministic what-if outcome, neural vs symbolic ranking) and the
//  authorization-gated apply flow.  High-impact levers require user-intent
//  confirmation (Face ID / Touch ID / passcode) per the security policy —
//  confirmation proves intent, the engine itself validates everything else.
//
#if os(iOS) && canImport(SwiftUI)
import CAELUSMobileCore
import SwiftUI

struct LeverCenterView: View {
    @ObservedObject var session: SessionViewModel
    @State private var lastOutcome: (lever: String, success: Bool)?

    private var evaluations: [String: LeverEvaluation] {
        Dictionary(uniqueKeysWithValues:
            (session.snapshot?.neural.leverEvaluations ?? [])
                .map { ($0.leverID, $0) })
    }

    var body: some View {
        List {
            if let message = session.lastError {
                Section {
                    ErrorBanner(message: message) { session.clearError() }
                        .listRowInsets(EdgeInsets())
                }
            }
            if let outcome = lastOutcome {
                Section {
                    HStack {
                        Image(systemName: outcome.success
                            ? "checkmark.circle.fill" : "xmark.circle.fill")
                            .foregroundStyle(outcome.success ? .green : .orange)
                        Text(outcome.success
                            ? "\(outcome.lever): deterministic roll SUCCEEDED"
                            : "\(outcome.lever): deterministic roll failed "
                                + "(failure branch applied)")
                            .font(.footnote)
                    }
                }
            }
            Section("Levers") {
                if session.snapshot?.levers.isEmpty ?? true {
                    Text("The active scenario defines no levers.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                ForEach(session.snapshot?.levers ?? []) { lever in
                    leverRow(lever)
                }
            } footer: {
                Text("What-if columns come from the engine's deterministic "
                    + "candidate simulation of the most recent neural tick. "
                    + "Applying a lever consumes its lockout and is audited.")
            }
        }
        .navigationTitle("Lever Center")
        .refreshable { await session.refresh() }
    }

    private func leverRow(_ lever: Lever) -> some View {
        let evaluation = evaluations[lever.id]
        let highImpact = session.gate.policy.requiresConfirmation(for: lever)
        return VStack(alignment: .leading, spacing: 8) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Text(lever.id).font(.callout.monospaced())
                        if evaluation?.selected == true {
                            StatusBadge(text: "GATE PICK", color: .purple)
                        }
                        if highImpact {
                            Image(systemName: "faceid")
                                .font(.caption)
                                .foregroundStyle(.blue)
                                .accessibilityLabel(
                                    Text("Requires biometric confirmation"))
                        }
                    }
                    Text("target \(lever.target)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Button {
                    Task {
                        if let success = await session.applyLever(lever) {
                            lastOutcome = (lever.id, success)
                        }
                    }
                } label: {
                    Text(lever.remainingLockout > 0
                        ? "Locked \(lever.remainingLockout)t"
                        : "Apply")
                        .font(.callout.weight(.semibold))
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.small)
                .disabled(!lever.applicable || session.runState == .sealed)
            }
            HStack(spacing: 10) {
                MetricTile(caption: "Success p",
                           value: lever.successProbabilityFP.fpPercent)
                MetricTile(caption: "Cost",
                           value: "\(lever.costTicks)t")
                MetricTile(caption: "Symbolic score",
                           value: evaluation.map {
                               $0.symbolicScoreFP.fpDecimal
                           } ?? "—")
                MetricTile(caption: "Neural score",
                           value: evaluation.map {
                               $0.neuralScoreFP.fpDecimal
                           } ?? "—",
                           accent: .purple)
            }
            if let evaluation {
                HStack(spacing: 8) {
                    StatusBadge(
                        text: evaluation.baselineOutage
                            ? "BASELINE → OUTAGE" : "BASELINE STABLE",
                        color: evaluation.baselineOutage ? .red : .green)
                    Image(systemName: "arrow.right")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                    StatusBadge(
                        text: evaluation.candidateOutage
                            ? "WITH LEVER → OUTAGE" : "WITH LEVER STABLE",
                        color: evaluation.candidateOutage ? .red : .green)
                }
            }
        }
        .padding(.vertical, 4)
    }
}
#endif
