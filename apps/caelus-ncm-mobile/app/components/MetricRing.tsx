type MetricRingProps = {
  label: string;
  value: number;
  display: string;
  tone?: "cyan" | "amber" | "green" | "red";
};

export function MetricRing({ label, value, display, tone = "cyan" }: MetricRingProps) {
  const bounded = Math.max(0, Math.min(1, value));
  const degrees = Math.round(bounded * 360);

  return (
    <div className={`metric-ring metric-ring--${tone}`} style={{ "--metric-angle": `${degrees}deg` } as React.CSSProperties}>
      <div className="metric-ring__inner">
        <strong>{display}</strong>
        <span>{label}</span>
      </div>
    </div>
  );
}
