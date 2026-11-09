//
//  CausalMapView.swift
//  CAELUSMobileUI
//
//  Native causal graph rendering on SwiftUI Canvas.  The layout comes from
//  CausalMapLayoutBuilder (deterministic, computed once per topology, never
//  per tick); this view only paints the CURRENT node/edge state onto the
//  frozen layout, so rendering stays cheap while the simulation runs.
//
#if os(iOS) && canImport(SwiftUI)
import CAELUSMobileCore
import SwiftUI
import UIKit

struct CausalMapView: View {
    @ObservedObject var session: SessionViewModel
    @State private var selectedNodeID: String?
    @State private var kindFilter: NodeKind?
    @State private var showLabels = true

    var body: some View {
        VStack(spacing: 0) {
            filterBar
            GeometryReader { proxy in
                canvas(size: proxy.size)
                    .contentShape(Rectangle())
                    .onTapGesture { location in
                        select(at: location, in: proxy.size)
                    }
            }
            if let nodeID = selectedNodeID,
               let node = session.snapshot?.nodes.first(where: { $0.id == nodeID }) {
                NodeInspectorPanel(node: node,
                                   snapshot: session.snapshot,
                                   close: { selectedNodeID = nil })
                    .transition(.move(edge: .bottom))
            }
        }
        .navigationTitle("Causal Map")
        .navigationBarTitleDisplayMode(.inline)
        .background(Color(uiColor: .systemBackground))
    }

    // MARK: Filter bar

    private var filterBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                Toggle(isOn: $showLabels) {
                    Image(systemName: "textformat")
                }
                .toggleStyle(.button)
                .controlSize(.small)
                .accessibilityLabel(Text("Show node labels"))

                Button {
                    kindFilter = nil
                } label: {
                    StatusBadge(text: "All",
                                color: kindFilter == nil ? .blue : .secondary)
                }
                ForEach(NodeKind.allCases, id: \.rawValue) { kind in
                    Button {
                        kindFilter = kindFilter == kind ? nil : kind
                    } label: {
                        StatusBadge(text: kind.displayName,
                                    color: kindFilter == kind
                                        ? Theme.color(for: kind)
                                        : .secondary)
                    }
                }
            }
            .padding(.horizontal)
            .padding(.vertical, 6)
        }
    }

    // MARK: Canvas

    private var visibleNodeIDs: Set<String> {
        guard let snapshot = session.snapshot else { return [] }
        guard let kindFilter else { return Set(snapshot.nodes.map(\.id)) }
        return Set(snapshot.nodes.filter { $0.kind == kindFilter }.map(\.id))
    }

    private var highlightedPath: Set<String> {
        guard let selectedNodeID, let snapshot = session.snapshot else {
            return []
        }
        var path = CausalMapLayoutBuilder.upstreamNodeIDs(
            of: selectedNodeID, edges: snapshot.edges)
        path.insert(selectedNodeID)
        return path
    }

    private func canvas(size: CGSize) -> some View {
        Canvas { context, canvasSize in
            guard let snapshot = session.snapshot,
                  let layout = session.mapLayout else { return }
            let inset: CGFloat = 42
            let nodesByID = Dictionary(
                uniqueKeysWithValues: snapshot.nodes.map { ($0.id, $0) })
            let visible = visibleNodeIDs
            let highlight = highlightedPath
            let drawLabels = showLabels && layout.detailLevel != .minimal

            func point(_ placement: MapNodePlacement) -> CGPoint {
                CGPoint(
                    x: inset + CGFloat(placement.unitX)
                        * (canvasSize.width - 2 * inset),
                    y: inset + CGFloat(placement.unitY)
                        * (canvasSize.height - 2 * inset))
            }
            let positions = Dictionary(uniqueKeysWithValues:
                layout.placements.map { ($0.id, point($0)) })

            // Edges (direction arrows + lag annotation at full detail).
            for edge in snapshot.edges {
                guard let from = positions[edge.from],
                      let to = positions[edge.to],
                      visible.contains(edge.from) || visible.contains(edge.to)
                else { continue }
                let onPath = highlight.contains(edge.from)
                    && highlight.contains(edge.to)
                var line = Path()
                line.move(to: from)
                line.addLine(to: to)
                let strokeColor: Color = onPath
                    ? .blue
                    : edge.active ? .secondary : .secondary.opacity(0.25)
                context.stroke(line,
                               with: .color(strokeColor),
                               style: StrokeStyle(
                                   lineWidth: onPath ? 2.4 : 1.2,
                                   dash: edge.lagTicks > 0 ? [5, 4] : []))
                drawArrowhead(context: &context, from: from, to: to,
                              color: strokeColor)
                if drawLabels, layout.detailLevel == .full,
                   edge.lagTicks > 0 || edge.multiplierFP != 1_000_000 {
                    let mid = CGPoint(x: (from.x + to.x) / 2,
                                      y: (from.y + to.y) / 2 - 8)
                    var label = ""
                    if edge.multiplierFP != 1_000_000 {
                        label += "×\(FixedPoint.decimalString(edge.multiplierFP, fractionDigits: 2))"
                    }
                    if edge.lagTicks > 0 { label += " +\(edge.lagTicks)t" }
                    context.draw(
                        Text(label.trimmingCharacters(in: .whitespaces))
                            .font(.system(size: 9))
                            .foregroundColor(.secondary),
                        at: mid)
                }
            }

            // Nodes.
            for placement in layout.placements {
                guard let node = nodesByID[placement.id],
                      let center = positions[placement.id] else { continue }
                let isVisible = visible.contains(node.id)
                let isSelected = node.id == selectedNodeID
                let onPath = highlight.contains(node.id)
                let radius: CGFloat = isSelected ? 16 : 12
                let rect = CGRect(x: center.x - radius, y: center.y - radius,
                                  width: radius * 2, height: radius * 2)

                var fill = Theme.color(for: node.kind)
                if node.deadlineMissed || node.irrecoverable { fill = .red }
                if !isVisible { fill = fill.opacity(0.15) }

                context.fill(Path(ellipseIn: rect), with: .color(fill))

                // Trust ring: degraded trust shows as an orange/red halo.
                if node.trustFP < 900_000 {
                    context.stroke(
                        Path(ellipseIn: rect.insetBy(dx: -3.5, dy: -3.5)),
                        with: .color(Theme.trustColor(fp: node.trustFP)),
                        lineWidth: 2)
                }
                // Reported/authoritative divergence marker.
                if node.reportedDeviationFP != 0 {
                    context.draw(
                        Text("Δ").font(.system(size: 9, weight: .bold))
                            .foregroundColor(.white),
                        at: center)
                }
                if isSelected || onPath {
                    context.stroke(
                        Path(ellipseIn: rect.insetBy(dx: -6, dy: -6)),
                        with: .color(.blue),
                        style: StrokeStyle(lineWidth: 1.6,
                                           dash: isSelected ? [] : [3, 3]))
                }
                if drawLabels && (isVisible || isSelected) {
                    context.draw(
                        Text(node.id)
                            .font(.system(size: 10, design: .monospaced))
                            .foregroundColor(.primary),
                        at: CGPoint(x: center.x, y: center.y + radius + 10))
                }
            }
        }
        .accessibilityLabel(Text(mapAccessibilitySummary))
    }

    private func drawArrowhead(context: inout GraphicsContext,
                               from: CGPoint, to: CGPoint, color: Color) {
        let angle = atan2(to.y - from.y, to.x - from.x)
        // Pull the tip back so it sits outside the node circle.
        let tip = CGPoint(x: to.x - 16 * cos(angle), y: to.y - 16 * sin(angle))
        let length: CGFloat = 7
        var arrow = Path()
        arrow.move(to: tip)
        arrow.addLine(to: CGPoint(
            x: tip.x - length * cos(angle - 0.45),
            y: tip.y - length * sin(angle - 0.45)))
        arrow.move(to: tip)
        arrow.addLine(to: CGPoint(
            x: tip.x - length * cos(angle + 0.45),
            y: tip.y - length * sin(angle + 0.45)))
        context.stroke(arrow, with: .color(color), lineWidth: 1.4)
    }

    private var mapAccessibilitySummary: String {
        guard let snapshot = session.snapshot else { return "Causal map empty" }
        return "Causal map with \(snapshot.nodes.count) nodes and "
            + "\(snapshot.edges.count) edges. "
            + (selectedNodeID.map { "Selected node \($0)." } ?? "")
    }

    // MARK: Hit testing

    private func select(at location: CGPoint, in size: CGSize) {
        guard let layout = session.mapLayout else { return }
        let inset: CGFloat = 42
        var best: (id: String, distance: CGFloat)?
        for placement in layout.placements {
            let point = CGPoint(
                x: inset + CGFloat(placement.unitX) * (size.width - 2 * inset),
                y: inset + CGFloat(placement.unitY) * (size.height - 2 * inset))
            let distance = hypot(point.x - location.x, point.y - location.y)
            if distance < 30, distance < (best?.distance ?? .infinity) {
                best = (placement.id, distance)
            }
        }
        withAnimation(.easeInOut(duration: 0.15)) {
            selectedNodeID = best?.id == selectedNodeID ? nil : best?.id
        }
    }
}

// MARK: - Node inspector

struct NodeInspectorPanel: View {
    let node: GraphNode
    let snapshot: EngineSnapshot?
    let close: () -> Void

    private var estimate: NeuralNodeEstimate? {
        snapshot?.neural.nodes?.first { $0.nodeID == node.id }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Circle().fill(Theme.color(for: node.kind))
                    .frame(width: 10, height: 10)
                Text(node.id).font(.headline.monospaced())
                StatusBadge(text: node.kind.displayName,
                            color: Theme.color(for: node.kind))
                Spacer()
                Button { close() } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(.secondary)
                }
                .accessibilityLabel(Text("Close inspector"))
            }
            HStack(spacing: 10) {
                MetricTile(caption: "Authoritative",
                           value: node.stateFP.fpDecimal)
                MetricTile(caption: "Reported",
                           value: node.reportedStateFP.fpDecimal,
                           accent: node.reportedDeviationFP == 0
                               ? .primary : .orange)
                MetricTile(caption: "Estimated (neural)",
                           value: estimate?.estimatedTrueStateFP.fpDecimal ?? "—",
                           accent: .purple)
            }
            HStack(spacing: 10) {
                MetricTile(caption: "Trust",
                           value: node.trustFP.fpPercent,
                           accent: Theme.trustColor(fp: node.trustFP))
                MetricTile(caption: "Capacity",
                           value: node.capacityFP.fpDecimal)
                MetricTile(caption: "Deadline",
                           value: node.deadlineTick >= 0
                               ? "t\(node.deadlineTick)" : "—",
                           accent: node.deadlineMissed ? .red : .primary)
            }
            if node.irrecoverable {
                StatusBadge(text: "IRRECOVERABLE", color: .red)
            }
            if let estimate {
                ProbabilityBar(labelText: "Anomaly score",
                               valueFP: estimate.telemetryAnomalyScoreFP)
            }
        }
        .padding()
        .background(.thinMaterial)
    }
}
#endif
