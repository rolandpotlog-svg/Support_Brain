// Mini-Trendlinie (pures SVG) für KPI-Karten. Server-renderbar.
export function Sparkline({
  data,
  color = "var(--accent)",
  width = 150,
  height = 34,
}: {
  data: number[];
  color?: string;
  width?: number;
  height?: number;
}) {
  const pts = data.filter((n) => Number.isFinite(n));
  if (pts.length < 2) return <div style={{ height }} />;
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const range = max - min || 1;
  const pad = 3;
  const x = (i: number) => (i / (pts.length - 1)) * width;
  const y = (v: number) => height - pad - ((v - min) / range) * (height - pad * 2);
  const line = pts.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const area = `0,${height} ${line} ${width},${height}`;
  const gid = `sg-${color.replace(/[^a-z]/gi, "")}-${Math.round(pts[pts.length - 1])}`;
  const lastX = x(pts.length - 1);
  const lastY = y(pts[pts.length - 1]);

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ display: "block", width: "100%" }}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#${gid})`} />
      <polyline points={line} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lastX} cy={lastY} r="2.6" fill={color} />
    </svg>
  );
}
