//
//  ScenarioLibraryView.swift
//  CAELUSMobileUI
//
//  Local library of imported signed scenario packages and neural model
//  packages.  Session start = pick scenario (+ optional model) → the native
//  core verifies both signatures against the compiled-in anchors.  Import
//  uses the iOS document picker with security-scoped access; imported bytes
//  stay untrusted data until verified at load.
//
#if os(iOS) && canImport(SwiftUI)
import CAELUSMobileCore
import SwiftUI
import UniformTypeIdentifiers

struct ScenarioLibraryView: View {
    @ObservedObject var app: AppModel
    @State private var selectedScenario: String?
    @State private var selectedModel: String?
    @State private var detailScenario: StoredScenario?
    @State private var importingScenario = false
    @State private var importingModel = false
    @State private var starting = false

    var body: some View {
        List {
            if let message = app.bootMessage {
                Section {
                    Text(message)
                        .font(.footnote)
                        .foregroundStyle(.red)
                }
            }
            scenarioSection
            modelSection
            startSection
        }
        .navigationTitle("Scenario Library")
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                Menu {
                    Button("Import scenario package…") {
                        importingScenario = true
                    }
                    Button("Import neural model package…") {
                        importingModel = true
                    }
                } label: {
                    Image(systemName: "square.and.arrow.down")
                }
                .accessibilityLabel(Text("Import packages"))
            }
        }
        .fileImporter(isPresented: $importingScenario,
                      allowedContentTypes: [UTType.json],
                      allowsMultipleSelection: false) { result in
            if case .success(let urls) = result, let url = urls.first {
                app.importScenario(from: url)
            }
        }
        .fileImporter(isPresented: $importingModel,
                      allowedContentTypes: [UTType.json, UTType.data],
                      allowsMultipleSelection: true) { result in
            if case .success(let urls) = result, !urls.isEmpty {
                app.importModelPackage(from: urls,
                                       preferredName: "imported_model")
            }
        }
        .sheet(item: $detailScenario) { scenario in
            NavigationStack {
                ScenarioDetailView(scenario: scenario, app: app)
            }
        }
    }

    private var scenarioSection: some View {
        Section("Signed scenarios") {
            if app.scenarios.isEmpty {
                Text("No scenarios in the library. Import a signed "
                    + "scenario package to begin.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            ForEach(app.scenarios) { scenario in
                Button {
                    selectedScenario =
                        selectedScenario == scenario.id ? nil : scenario.id
                } label: {
                    HStack {
                        Image(systemName: "doc.badge.gearshape")
                            .foregroundStyle(.blue)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(scenario.id)
                                .font(.callout.monospaced())
                                .foregroundStyle(.primary)
                            Text("\(scenario.byteCount) bytes — verified at load")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        if selectedScenario == scenario.id {
                            Image(systemName: "checkmark.circle.fill")
                                .foregroundStyle(.green)
                        }
                        Button {
                            detailScenario = scenario
                        } label: {
                            Image(systemName: "info.circle")
                                .foregroundStyle(.secondary)
                        }
                        .buttonStyle(.borderless)
                        .accessibilityLabel(Text("Details for \(scenario.id)"))
                    }
                }
                .accessibilityLabel(Text("Scenario \(scenario.id)"))
            }
        }
    }

    private var modelSection: some View {
        Section("Signed neural models (optional)") {
            if app.models.isEmpty {
                Text("No model packages. Sessions run symbolic-only.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            ForEach(app.models) { model in
                Button {
                    selectedModel = selectedModel == model.id ? nil : model.id
                } label: {
                    HStack {
                        Image(systemName: "brain")
                            .foregroundStyle(.purple)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(model.id)
                                .font(.callout.monospaced())
                                .foregroundStyle(.primary)
                            Text("weights \(model.weightsBytes) B — "
                                + "deterministic assurance")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        if selectedModel == model.id {
                            Image(systemName: "checkmark.circle.fill")
                                .foregroundStyle(.green)
                        }
                    }
                }
                .accessibilityLabel(Text("Model \(model.id)"))
            }
        }
    }

    private var startSection: some View {
        Section {
            Button {
                guard let scenario = selectedScenario else { return }
                starting = true
                Task {
                    await app.startSession(scenarioName: scenario,
                                           modelName: selectedModel)
                    starting = false
                }
            } label: {
                if starting {
                    ProgressView().frame(maxWidth: .infinity)
                } else {
                    Text(selectedModel == nil
                        ? "Start symbolic-only session"
                        : "Start neural assurance session")
                        .frame(maxWidth: .infinity)
                        .fontWeight(.semibold)
                }
            }
            .disabled(selectedScenario == nil || starting)
        } footer: {
            Text("Scenario and model signatures are verified by the "
                + "embedded engine against compiled-in ed25519 anchors "
                + "before any state is created. Rejected packages never "
                + "load and every decision is audited.")
        }
    }
}
#endif
