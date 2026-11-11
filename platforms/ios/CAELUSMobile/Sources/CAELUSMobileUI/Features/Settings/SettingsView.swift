//
//  SettingsView.swift
//  CAELUSMobileUI
//
//  Security & trust: which critical actions require biometric intent
//  confirmation, the compiled-in PUBLIC trust anchors the binary enforces
//  (read-only — changing them requires shipping a new signed build), and
//  the offline guarantee statement.
//
#if os(iOS) && canImport(SwiftUI)
import CAELUSMobileCore
import SwiftUI

struct SettingsView: View {
    @ObservedObject var app: AppModel

    var body: some View {
        List {
            confirmationSection
            thresholdSection
            trustAnchorSection
            offlineSection
        }
        .navigationTitle("Security & Trust")
    }

    // MARK: Critical-action confirmations

    private var confirmationSection: some View {
        Section("Require Face ID / Touch ID for") {
            ForEach(CriticalAction.allCases, id: \.rawValue) { action in
                Toggle(action.displayName, isOn: binding(for: action))
            }
        } footer: {
            Text("Biometric confirmation proves user INTENT. It never "
                + "replaces cryptographic validation — the engine verifies "
                + "signatures unconditionally regardless of these switches.")
        }
    }

    private func binding(for action: CriticalAction) -> Binding<Bool> {
        Binding(
            get: { app.securityPolicy.requiresConfirmation(action) },
            set: { enabled in
                var policy = app.securityPolicy
                if enabled {
                    policy.actionsRequiringConfirmation.insert(action)
                } else {
                    policy.actionsRequiringConfirmation.remove(action)
                }
                app.securityPolicy = policy
            })
    }

    private var thresholdSection: some View {
        Section("High-impact lever threshold") {
            VStack(alignment: .leading, spacing: 6) {
                Text("Levers with success probability ≥ "
                    + app.securityPolicy.highImpactLeverThresholdFP.fpPercent
                    + " require confirmation")
                    .font(.footnote)
                Slider(
                    value: Binding(
                        get: {
                            Double(app.securityPolicy.highImpactLeverThresholdFP)
                                / 1_000_000
                        },
                        set: { newValue in
                            var policy = app.securityPolicy
                            policy.highImpactLeverThresholdFP =
                                Int64((newValue * 1_000_000).rounded())
                            app.securityPolicy = policy
                        }),
                    in: 0...1,
                    step: 0.05)
                    .accessibilityLabel(Text("High-impact lever threshold"))
            }
        }
    }

    // MARK: Trust anchors (read-only)

    private var trustAnchorSection: some View {
        Section("Compiled-in trust anchors (public keys)") {
            if let anchors = app.trustAnchors {
                KeyValueRow(key: "Engine",
                            value: anchors.engineVersion)
                KeyValueRow(key: "ABI", value: "v\(anchors.abiVersion)")
                anchorRow(label: "Scenario signing",
                          hex: anchors.scenarioPublicKeyHex)
                anchorRow(label: "Neural model signing",
                          hex: anchors.neuralPublicKeyHex)
            } else {
                Text("Trust anchors unavailable.")
                    .font(.footnote)
                    .foregroundStyle(.red)
            }
        } footer: {
            Text("These ed25519 PUBLIC keys are compiled into the native "
                + "core. Every scenario and neural model must verify "
                + "against them; they cannot be changed at runtime — key "
                + "rotation ships as a new app build. Separate keys per "
                + "trust domain (scenario / neural / audit identity).")
        }
    }

    private func anchorRow(label: String, hex: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label).font(.footnote).foregroundStyle(.secondary)
            Text(hex)
                .font(.caption2.monospaced())
                .textSelection(.enabled)
                .lineLimit(2)
        }
        .padding(.vertical, 2)
    }

    // MARK: Offline guarantee

    private var offlineSection: some View {
        Section("Offline operation") {
            HStack {
                Image(systemName: "airplane.circle.fill")
                    .foregroundStyle(.green)
                Text("Fully offline by design")
            }
            Text("The engine, signature verification, neural inference, "
                + "audit chain, persistence, and reports all run on this "
                + "device. The app opens no network connections; airplane "
                + "mode changes nothing. Data leaves the device only "
                + "through the share sheet, by your explicit action.")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
    }
}
#endif
