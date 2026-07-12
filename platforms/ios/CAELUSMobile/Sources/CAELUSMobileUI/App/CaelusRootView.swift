//
//  CaelusRootView.swift
//  CAELUSMobileUI
//
//  Adaptive shell: compact width (iPhone, iPad Split View) uses a TabView;
//  regular width (iPad full screen) uses a three-column
//  NavigationSplitView.  Scene-phase transitions are audited and trigger
//  background checkpoints so iOS process termination can never lose the
//  session.
//
#if os(iOS) && canImport(SwiftUI)
import CAELUSMobileCore
import SwiftUI

/// Root view the app target embeds in its WindowGroup.
public struct CaelusRootView: View {
    @StateObject private var app = AppModel()
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.horizontalSizeClass) private var sizeClass

    public init() {}

    public var body: some View {
        Group {
            switch app.phase {
            case .launching:
                VStack(spacing: 12) {
                    ProgressView()
                    Text("CAELUS Mobile")
                        .font(.headline)
                    Text("Deterministic causal engine — offline")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            case .failed(let message):
                VStack(spacing: 12) {
                    Image(systemName: "xmark.octagon.fill")
                        .font(.largeTitle)
                        .foregroundStyle(.red)
                    Text("Startup failed").font(.headline)
                    Text(message)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal)
                }
            case .library:
                NavigationStack {
                    ScenarioLibraryView(app: app)
                }
            case .active:
                if let session = app.session {
                    if sizeClass == .regular {
                        RegularWidthShell(app: app, session: session)
                    } else {
                        CompactWidthShell(app: app, session: session)
                    }
                }
            }
        }
        .task { await app.boot() }
        .onChange(of: scenePhase) { newPhase in
            guard let session = app.session else { return }
            switch newPhase {
            case .background:
                Task { await session.handleBackground() }
            case .active:
                Task { await session.handleForeground() }
            default:
                break
            }
        }
    }
}

// MARK: - Compact shell (iPhone)

struct CompactWidthShell: View {
    @ObservedObject var app: AppModel
    @ObservedObject var session: SessionViewModel

    var body: some View {
        TabView {
            NavigationStack { CommandCenterView(session: session) }
                .tabItem { Label("Command", systemImage: "gauge.with.needle") }
            NavigationStack { CausalMapView(session: session) }
                .tabItem { Label("Map", systemImage: "point.3.connected.trianglepath.dotted") }
            NavigationStack { LeverCenterView(session: session) }
                .tabItem { Label("Levers", systemImage: "slider.horizontal.3") }
            NavigationStack { NeuralObserverView(session: session) }
                .tabItem { Label("Neural", systemImage: "brain") }
            NavigationStack { MoreView(app: app, session: session) }
                .tabItem { Label("More", systemImage: "ellipsis.circle") }
        }
    }
}

/// Fifth tab: audit, history, reports, settings, diagnostics, session end.
struct MoreView: View {
    @ObservedObject var app: AppModel
    @ObservedObject var session: SessionViewModel
    @State private var confirmEnd = false

    var body: some View {
        List {
            Section {
                NavigationLink {
                    AuditView(session: session)
                } label: {
                    Label("Audit & Integrity", systemImage: "checkmark.seal")
                }
                NavigationLink {
                    SessionHistoryView(app: app, session: session)
                } label: {
                    Label("Session History", systemImage: "clock.arrow.circlepath")
                }
                NavigationLink {
                    ReportsView(session: session)
                } label: {
                    Label("Reports & Export", systemImage: "square.and.arrow.up")
                }
            }
            Section {
                NavigationLink {
                    SettingsView(app: app)
                } label: {
                    Label("Security & Trust", systemImage: "lock.shield")
                }
                NavigationLink {
                    DiagnosticsView(app: app, session: session)
                } label: {
                    Label("Diagnostics", systemImage: "stethoscope")
                }
            }
            Section {
                Button(role: .destructive) {
                    confirmEnd = true
                } label: {
                    Label("Seal & end session", systemImage: "stop.circle")
                }
            }
        }
        .navigationTitle("More")
        .confirmationDialog(
            "Seal the audit chain and end this session?",
            isPresented: $confirmEnd, titleVisibility: .visible
        ) {
            Button("Seal & end", role: .destructive) {
                Task { await app.endSession(seal: true) }
            }
        }
    }
}

// MARK: - Regular shell (iPad)

/// iPad three-column command interface: sidebar (sections), content
/// (selected feature), detail (causal map stays visible for spatial
/// context).  Portrait/landscape and Split View resize automatically; the
/// map column collapses when width is constrained.
struct RegularWidthShell: View {
    @ObservedObject var app: AppModel
    @ObservedObject var session: SessionViewModel
    @State private var selection: PadSection? = .command
    @State private var confirmEnd = false

    enum PadSection: String, CaseIterable, Identifiable {
        case command = "Command Center"
        case levers = "Lever Center"
        case neural = "Neural Observer"
        case audit = "Audit & Integrity"
        case history = "Session History"
        case reports = "Reports & Export"
        case settings = "Security & Trust"
        case diagnostics = "Diagnostics"
        var id: String { rawValue }

        var icon: String {
            switch self {
            case .command: return "gauge.with.needle"
            case .levers: return "slider.horizontal.3"
            case .neural: return "brain"
            case .audit: return "checkmark.seal"
            case .history: return "clock.arrow.circlepath"
            case .reports: return "square.and.arrow.up"
            case .settings: return "lock.shield"
            case .diagnostics: return "stethoscope"
            }
        }
    }

    var body: some View {
        NavigationSplitView {
            List(PadSection.allCases, selection: $selection) { section in
                Label(section.rawValue, systemImage: section.icon)
                    .tag(section)
            }
            .navigationTitle("CAELUS")
            .safeAreaInset(edge: .bottom) {
                Button(role: .destructive) {
                    confirmEnd = true
                } label: {
                    Label("Seal & end session", systemImage: "stop.circle")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .padding()
            }
        } content: {
            switch selection ?? .command {
            case .command: CommandCenterView(session: session)
            case .levers: LeverCenterView(session: session)
            case .neural: NeuralObserverView(session: session)
            case .audit: AuditView(session: session)
            case .history: SessionHistoryView(app: app, session: session)
            case .reports: ReportsView(session: session)
            case .settings: SettingsView(app: app)
            case .diagnostics: DiagnosticsView(app: app, session: session)
            }
        } detail: {
            CausalMapView(session: session)
        }
        .confirmationDialog(
            "Seal the audit chain and end this session?",
            isPresented: $confirmEnd, titleVisibility: .visible
        ) {
            Button("Seal & end", role: .destructive) {
                Task { await app.endSession(seal: true) }
            }
        }
    }
}
#endif
