"use client";

import { useMemo, useState } from "react";

export const HEALTH_COLORS = { healthy: "#3ddc97", watch: "#f5b942", weak: "#f2685c" } as const;

/** Histogram from raw values or pre-binned data, with optional vertical markers. */
export function Histogram({
  values,
  bins: binsIn,
  nBins = 24,
  color = "#3ddc97",
  markers = [],
  height = 140,
  unit = "",
  format = (v: number) => v.toFixed(2),
}: {
  values?: number[];
  bins?: { x0: number; x1: number; n: number }[];
  nBins?: number;
  color?: string;
  markers?: { x: number; label: string; color?: string; dash?: boolean }[];
  height?: number;
  unit?: string;
  format?: (v: number) => string;
}) {
  const bins = useMemo(() => {
    if (binsIn) return binsIn;
    const v = (values ?? []).filter(Number.isFinite);
    if (!v.length) return [];
    let lo = Math.min(...v);
    let hi = Math.max(...v);
    if (hi === lo) {
      lo -= 0.5;
      hi += 0.5;
    }
    const span = hi - lo;
    const b = Array.from({ length: nBins }, (_, i) => ({ x0: lo + (i * span) / nBins, x1: lo + ((i + 1) * span) / nBins, n: 0 }));
    for (const x of v) b[Math.min(nBins - 1, Math.floor(((x - lo) / span) * nBins))].n++;
    return b;
  }, [values, binsIn, nBins]);
  const [hover, setHover] = useState<number | null>(null);
  if (!bins.length) return <div className="text-xs text-muted">No data</div>;
  const W = 600;
  const H = height;
  const padB = 22;
  const padT = 14;
  const lo = bins[0].x0;
  const hi = bins[bins.length - 1].x1;
  const maxN = Math.max(...bins.map((b) => b.n), 1);
  const sx = (x: number) => ((x - lo) / (hi - lo || 1)) * W;
  const sy = (n: number) => H - padB - (n / maxN) * (H - padB - padT);
  const ticks = [lo, lo + (hi - lo) / 2, hi];
  return (
    <div className="relative w-full">
      <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="none" style={{ height }}>
        {bins.map((b, i) => (
          <rect
            key={i}
            x={sx(b.x0) + 0.5}
            y={sy(b.n)}
            width={Math.max(0.5, sx(b.x1) - sx(b.x0) - 1.5)}
            height={H - padB - sy(b.n)}
            fill={color}
            opacity={hover === null || hover === i ? 0.85 : 0.45}
            rx={1.5}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          />
        ))}
        <line x1={0} x2={W} y1={H - padB} y2={H - padB} stroke="#2a3a32" />
        {markers.map((m, i) => (
          <g key={i}>
            <line x1={sx(m.x)} x2={sx(m.x)} y1={padT - 6} y2={H - padB} stroke={m.color ?? "#e8f1ec"} strokeDasharray={m.dash ? "4 3" : undefined} strokeWidth={1.5} />
          </g>
        ))}
      </svg>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-between text-[10.5px] text-muted tabular">
        {ticks.map((t, i) => (
          <span key={i}>
            {format(t)}
            {unit}
          </span>
        ))}
      </div>
      </div>
      {markers.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[10.5px] text-muted">
          {markers.map((m, i) => (
            <span key={i} className="inline-flex items-center gap-1">
              <span className="inline-block h-2.5 w-0.5" style={{ background: m.color ?? "#e8f1ec" }} />
              {m.label}
            </span>
          ))}
        </div>
      )}
      {hover !== null && bins[hover] && (
        <div className="pointer-events-none absolute right-1 top-0 rounded-md border border-line2 bg-panel2 px-2 py-1 text-[11px] text-ink2 tabular">
          {format(bins[hover].x0)}–{format(bins[hover].x1)}
          {unit}: <b className="text-ink">{bins[hover].n}</b>
        </div>
      )}
    </div>
  );
}

export function BarList({ items, unit = "", format = (v: number) => v.toFixed(1), color = "#3ddc97" }: { items: { label: string; value: number; sub?: string; color?: string }[]; unit?: string; format?: (v: number) => string; color?: string }) {
  const max = Math.max(...items.map((i) => Math.abs(i.value)), 1e-9);
  return (
    <div className="space-y-2">
      {items.map((it) => (
        <div key={it.label}>
          <div className="mb-1 flex items-baseline justify-between gap-2 text-[12px]">
            <span className="text-ink2">{it.label}</span>
            <span className="tabular text-ink">
              {format(it.value)}
              <span className="text-muted">{unit}</span>
              {it.sub && <span className="ml-1.5 text-[11px] text-muted">{it.sub}</span>}
            </span>
          </div>
          <div className="h-2 rounded-full bg-line">
            <div className="h-2 rounded-full" style={{ width: `${(Math.abs(it.value) / max) * 100}%`, background: it.color ?? color }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function StackBar({ parts, height = 10 }: { parts: { label: string; value: number; color: string }[]; height?: number }) {
  const tot = parts.reduce((a, p) => a + p.value, 0) || 1;
  return (
    <div>
      <div className="flex w-full overflow-hidden rounded-full bg-line" style={{ height }}>
        {parts.map((p) => (
          <div key={p.label} style={{ width: `${(p.value / tot) * 100}%`, background: p.color }} title={`${p.label}: ${p.value}`} />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px]">
        {parts.map((p) => (
          <span key={p.label} className="inline-flex items-center gap-1.5 text-ink2">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: p.color }} />
            {p.label}
            <span className="tabular text-muted">
              {p.value.toLocaleString("en-IN")} · {((p.value / tot) * 100).toFixed(1)}%
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

export function Gauge({ value, label, size = 120, color = "#3ddc97" }: { value: number; label?: string; size?: number; color?: string }) {
  const r = 46;
  const c = Math.PI * r;
  const v = Math.max(0, Math.min(100, value));
  return (
    <svg width={size} height={size * 0.62} viewBox="0 0 120 74">
      <path d="M14 64 A46 46 0 0 1 106 64" fill="none" stroke="#1e2b25" strokeWidth="10" strokeLinecap="round" />
      <path d="M14 64 A46 46 0 0 1 106 64" fill="none" stroke={color} strokeWidth="10" strokeLinecap="round" strokeDasharray={`${(v / 100) * c} ${c}`} />
      <text x="60" y="58" textAnchor="middle" fill="#e8f1ec" fontSize="22" fontWeight="600">
        {Math.round(v)}
      </text>
      {label && (
        <text x="60" y="72" textAnchor="middle" fill="#7f978c" fontSize="9">
          {label}
        </text>
      )}
    </svg>
  );
}
