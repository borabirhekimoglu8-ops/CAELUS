//
//  CausalMapModel.swift
//  CAELUSMobileCore
//
//  Deterministic causal-graph layout, computed ONCE per topology (never per
//  tick) and consumed by the SwiftUI Canvas renderer.  Pure integer/index
//  math on snapshot data — no floating-point feedback into the engine, no
//  randomness, no platform dependency — so layouts are unit-tested on Linux
//  and identical on every device.
//
import Foundation

/// Position of one node in unit space (0…1 on both axes; the renderer
/// scales to the actual canvas).
public struct MapNodePlacement: Sendable, Equatable, Identifiable {
    public var id: String
    public var kind: NodeKind
    /// Causal depth (0 = source layer).
    public var layer: Int
    public var unitX: Double
    public var unitY: Double
}

/// Rendering density recommendation (level-of-detail).
public enum MapDetailLevel: Sendable, Equatable {
    /// Every node/edge label drawn.
    case full
    /// Node labels only for selected/critical nodes; no edge labels.
    case reduced
    /// Dots and edges only; inspector supplies details.
    case minimal

    public static func forNodeCount(_ count: Int) -> MapDetailLevel {
        switch count {
        case ..<25: return .full
        case ..<61: return .reduced
        default: return .minimal
        }
    }
}

/// Layout of the whole graph.
public struct CausalMapLayout: Sendable, Equatable {
    public var placements: [MapNodePlacement]
    public var layerCount: Int
    public var detailLevel: MapDetailLevel

    public func placement(of nodeID: String) -> MapNodePlacement? {
        placements.first { $0.id == nodeID }
    }
}

public enum CausalMapLayoutBuilder {
    /// Layered longest-path layout:
    ///  • layer(node) = longest incoming chain (Kahn peeling; edges point
    ///    from cause to effect, so causality flows left → right),
    ///  • nodes that survive peeling (cycles) drop into a final layer,
    ///  • within a layer nodes sort by id (deterministic),
    ///  • positions spread evenly in unit space.
    public static func layout(nodes: [GraphNode],
                              edges: [GraphEdge]) -> CausalMapLayout {
        let ids = nodes.map(\.id)
        let idSet = Set(ids)
        guard !nodes.isEmpty else {
            return CausalMapLayout(placements: [], layerCount: 0,
                                   detailLevel: .full)
        }

        // Adjacency restricted to known endpoints; parallel edges collapse.
        var outgoing: [String: Set<String>] = [:]
        var indegree: [String: Int] = Dictionary(
            uniqueKeysWithValues: ids.map { ($0, 0) })
        for edge in edges
        where idSet.contains(edge.from) && idSet.contains(edge.to)
            && edge.from != edge.to {
            if outgoing[edge.from, default: []].insert(edge.to).inserted {
                indegree[edge.to, default: 0] += 1
            }
        }

        // Kahn peeling with longest-path layering; ties broken by id so the
        // result never depends on hash ordering.  A node's layer is FINAL
        // only once it is dequeued (all causes placed).
        var layerOf: [String: Int] = [:]
        var placed: Set<String> = []
        let ready = ids.filter { indegree[$0] == 0 }.sorted()
        for id in ready { layerOf[id] = 0 }
        var queue = ready
        while !queue.isEmpty {
            let current = queue.removeFirst()
            placed.insert(current)
            let currentLayer = layerOf[current] ?? 0
            for next in (outgoing[current] ?? []).sorted() {
                layerOf[next] = max(layerOf[next] ?? 0, currentLayer + 1)
                indegree[next, default: 0] -= 1
                if indegree[next] == 0 { queue.append(next) }
            }
        }
        // Cycle members never finish peeling: mutually dependent nodes have
        // no well-defined order, so they all share one final layer (partial
        // relaxation values are discarded).
        let unplaced = ids.filter { !placed.contains($0) }.sorted()
        if !unplaced.isEmpty {
            let cycleLayer = (placed.compactMap { layerOf[$0] }.max() ?? -1) + 1
            for id in unplaced { layerOf[id] = cycleLayer }
        }

        let layerCount = (layerOf.values.max() ?? 0) + 1
        var byLayer: [[GraphNode]] = Array(repeating: [], count: layerCount)
        let kindOf = Dictionary(uniqueKeysWithValues: nodes.map { ($0.id, $0) })
        for id in ids.sorted() {
            byLayer[layerOf[id] ?? 0].append(kindOf[id]!)
        }

        var placements: [MapNodePlacement] = []
        for (layerIndex, layerNodes) in byLayer.enumerated() {
            let x = layerCount == 1
                ? 0.5
                : Double(layerIndex) / Double(layerCount - 1)
            for (rowIndex, node) in layerNodes.enumerated() {
                // Even vertical spread with half-step margins.
                let y = (Double(rowIndex) + 0.5) / Double(layerNodes.count)
                placements.append(MapNodePlacement(
                    id: node.id, kind: node.kind, layer: layerIndex,
                    unitX: x, unitY: y))
            }
        }
        placements.sort { $0.id < $1.id }
        return CausalMapLayout(placements: placements,
                               layerCount: layerCount,
                               detailLevel: .forNodeCount(nodes.count))
    }

    /// Upstream causal set of `nodeID` (everything that can influence it),
    /// bounded by `maxDepth`.  Used to highlight the selected causal path.
    public static func upstreamNodeIDs(of nodeID: String,
                                       edges: [GraphEdge],
                                       maxDepth: Int = 8) -> Set<String> {
        var incoming: [String: [String]] = [:]
        for edge in edges where edge.from != edge.to {
            incoming[edge.to, default: []].append(edge.from)
        }
        var visited: Set<String> = []
        var frontier = [nodeID]
        var depth = 0
        while !frontier.isEmpty && depth < maxDepth {
            var next: [String] = []
            for id in frontier {
                for parent in (incoming[id] ?? []).sorted()
                where !visited.contains(parent) && parent != nodeID {
                    visited.insert(parent)
                    next.append(parent)
                }
            }
            frontier = next
            depth += 1
        }
        return visited
    }

    /// Remaining friction headroom before the outage regime characteristic
    /// (3.0) is crossed — the "critical threshold distance" shown on the
    /// map (fixed-point 1e6; negative = already beyond the threshold).
    public static func regimeHeadroomFP(frictionClampedFP: Int64) -> Int64 {
        3_000_000 - frictionClampedFP
    }
}
