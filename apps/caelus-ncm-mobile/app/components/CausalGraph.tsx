import type { EngineSnapshot } from "../../lib/caelus-wasm";

type PackNode = { id: string; label: string };
type CausalGraphProps = {
  snapshot: EngineSnapshot;
  nodes: PackNode[];
};

const POSITIONS = [
  { x: 180, y: 48 },
  { x: 302, y: 115 },
  { x: 302, y: 245 },
  { x: 180, y: 312 },
  { x: 58, y: 245 },
  { x: 58, y: 115 },
];

function shortLabel(label: string): string {
  const concept = label.split("·")[0]?.trim() || label;
  return concept.length > 16 ? `${concept.slice(0, 15)}…` : concept;
}

export function CausalGraph({ snapshot, nodes }: CausalGraphProps) {
  const labels = new Map(nodes.map((node) => [node.id, node.label]));
  const positions = new Map(snapshot.nodes.slice(0, 6).map((node, index) => [node.id, POSITIONS[index]]));
  const visibleEdges = snapshot.edges.filter((edge) => edge.to && positions.has(edge.from) && positions.has(edge.to));

  return (
    <div className="graph-stage" aria-label="Canlı nedensel ilişki grafiği">
      <svg viewBox="0 0 360 360" role="img">
        <defs>
          <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
            <path d="M0,0 L0,6 L7,3 z" className="graph-arrow" />
          </marker>
          <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        <circle cx="180" cy="180" r="118" className="graph-orbit" />
        {visibleEdges.map((edge) => {
          const start = positions.get(edge.from)!;
          const end = positions.get(edge.to)!;
          const weight = Number(edge.weight ?? edge.multiplier_fp ?? 0);
          return (
            <line
              key={`${edge.from}-${edge.to}`}
              x1={start.x}
              y1={start.y}
              x2={end.x}
              y2={end.y}
              className="graph-edge"
              markerEnd="url(#arrow)"
              style={{ opacity: Math.max(0.35, Math.min(1, weight / 1.6)) }}
            />
          );
        })}
        {snapshot.nodes.slice(0, 6).map((node, index) => {
          const position = POSITIONS[index];
          const pressure = Math.max(0, Math.min(1, Number(node.state ?? node.state_fp ?? 0)));
          const trust = Math.max(0, Math.min(1, Number(node.trust ?? node.trust_fp ?? 1)));
          const critical = pressure > 0.72 || trust < 0.75;
          return (
            <g key={node.id} transform={`translate(${position.x} ${position.y})`} filter={critical ? "url(#glow)" : undefined}>
              <circle r="28" className={critical ? "graph-node graph-node--critical" : "graph-node"} />
              <circle r={22 * pressure} className="graph-node__pressure" />
              <text textAnchor="middle" y="3" className="graph-node__value">{Math.round(pressure * 100)}</text>
              <text textAnchor="middle" y="43" className="graph-node__label">{shortLabel(labels.get(node.id) || node.id)}</text>
            </g>
          );
        })}
        <g transform="translate(180 180)">
          <circle r="44" className="graph-core" />
          <text textAnchor="middle" y="-4" className="graph-core__brand">CAELUS</text>
          <text textAnchor="middle" y="13" className="graph-core__tick">TICK {snapshot.tick}</text>
        </g>
      </svg>
    </div>
  );
}
