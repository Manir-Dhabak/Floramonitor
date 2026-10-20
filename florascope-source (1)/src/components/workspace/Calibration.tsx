"use client";

import { AlertTriangle, CheckCircle2, Circle, Sparkles, Trash2, X } from "lucide-react";
import { useState } from "react";
import { useStore } from "@/store/useStore";
import { useAnalysis } from "./AnalysisContext";
import { Button, Segmented, cx } from "@/components/ui";

/** Floating panel shown while the viewer is in "calibrate" mode. */
export function CalibrationPanel() {
  const an = useAnalysis();
  const sv = an.active?.survey;
  const kind = useStore((s) => s.calibKind);
  const setKind = useStore((s) => s.setCalibKind);
  const removeCalib = useStore((s) => s.removeCalib);
  const clearCalib = useStore((s) => s.clearCalib);
  const apply = useStore((s) => s.applyCalibration);
  const setMode = useStore((s) => s.setMode);
  const busy = useStore((s) => s.busy);
  if (!sv) return null;
  const gsd = sv.raster.gsd;
  const crowns = sv.calibration.crowns;
  const ground = sv.calibration.ground;
  const ds = crowns.map((c) => 2 * c.r * gsd);
  const sorted = crowns.map((c, i) => ({ c, i, d: ds[i] })).sort((a, b) => a.d - b.d);
  const steps = [
    { done: crowns.length >= 1, text: "Draw the smallest tree crown" },
    { done: crowns.length >= 2, text: "Draw the largest tree crown" },
    { done: ground.length >= 1, text: "Mark 1–3 areas that are not trees (grass, ground cover, soil)", optional: true },
  ];
  return (
    <div className="no-print absolute right-3 top-14 z-20 w-[300px] rounded-xl border border-leaf/30 bg-panel/95 p-3.5 text-[12px] shadow-2xl backdrop-blur">
      <div className="mb-1 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
          <Sparkles size={14} className="text-leaf" /> Calibrate crown detection
        </div>
        <button onClick={() => setMode("inspect")} className="text-muted hover:text-ink" title="Close">
          <X size={14} />
        </button>
      </div>
      <p className="mb-2.5 leading-relaxed text-muted">
        Show FloraScope what one tree looks like here. It learns the crown size range and colour, then treats each crown as a single tree instead of splitting
        touching crowns.
      </p>
      <ol className="mb-3 space-y-1.5">
        {steps.map((s, i) => (
          <li key={i} className="flex items-start gap-2">
            {s.done ? <CheckCircle2 size={14} className="mt-px shrink-0 text-leaf" /> : <Circle size={14} className="mt-px shrink-0 text-faint" />}
            <span className={s.done ? "text-ink2" : "text-ink"}>
              {s.text}
              {s.optional && <span className="text-faint"> (recommended)</span>}
            </span>
          </li>
        ))}
      </ol>
      <div className="mb-2 flex items-center justify-between gap-2">
        <Segmented
          size="sm"
          value={kind}
          onChange={setKind}
          options={[
            { value: "crowns", label: <span className="text-leaf">● Tree crown</span> },
            { value: "ground", label: <span className="text-bad">● Not a tree</span> },
          ]}
        />
      </div>
      <div className="mb-3 rounded-lg bg-panel2 px-2.5 py-2 text-[11.5px] text-ink2">
        Drag from the <b>centre</b> of a {kind === "crowns" ? "crown to its outer edge" : "non-tree area outward"}. Scroll to zoom, Space+drag to pan.
      </div>
      {(crowns.length > 0 || ground.length > 0) && (
        <div className="mb-3 max-h-40 space-y-1 overflow-y-auto">
          {sorted.map(({ c, i, d }, k) => (
            <div key={`c${i}`} className="flex items-center justify-between rounded-md border border-leaf/20 px-2 py-1">
              <span className="text-ink2">
                <span className="text-leaf">●</span> Crown {i + 1}
                {crowns.length > 1 && k === 0 && <span className="text-muted"> · smallest</span>}
                {crowns.length > 1 && k === sorted.length - 1 && <span className="text-muted"> · largest</span>}
              </span>
              <span className="flex items-center gap-2 tabular text-ink">
                Ø {d.toFixed(1)} m
                <button onClick={() => removeCalib("crowns", i)} className="text-faint hover:text-bad">
                  <Trash2 size={12} />
                </button>
              </span>
              <span className="hidden">{c.r}</span>
            </div>
          ))}
          {ground.map((_, i) => (
            <div key={`g${i}`} className="flex items-center justify-between rounded-md border border-bad/20 px-2 py-1">
              <span className="text-ink2">
                <span className="text-bad">●</span> Not a tree {i + 1}
              </span>
              <button onClick={() => removeCalib("ground", i)} className="text-faint hover:text-bad">
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
      {crowns.length >= 1 && (
        <div className="mb-3 text-[11.5px] leading-relaxed text-muted">
          Crowns from <b className="text-ink">{(Math.min(...ds) * (crowns.length > 1 ? 0.85 : 0.51)).toFixed(1)} m</b> to{" "}
          <b className="text-ink">{(Math.max(...ds) * (crowns.length > 1 ? 1.2 : 1.92)).toFixed(1)} m</b> will count as one tree each.
          {crowns.length === 1 && " Add the largest crown too for a tighter range."}
        </div>
      )}
      <div className="flex gap-1.5">
        <Button variant="primary" size="sm" className="flex-1" disabled={!crowns.length || !!busy} onClick={() => void apply()}>
          Apply &amp; re-detect
        </Button>
        <Button variant="ghost" size="sm" disabled={!crowns.length && !ground.length} onClick={clearCalib}>
          Clear
        </Button>
      </div>
    </div>
  );
}

/** Suggests calibration when a continuous canopy is being split by the shape-based detector. */
export function DenseCanopyBanner() {
  const an = useAnalysis();
  const setMode = useStore((s) => s.setMode);
  const setKind = useStore((s) => s.setCalibKind);
  const [hidden, setHidden] = useState<string | null>(null);
  const sv = an.active?.survey;
  const det = sv?.detection;
  if (!sv || !det) return null;
  const st = det.stats;
  const dense = st.vegFraction > 0.45 && st.markerSource === "rgb";
  if (!dense || hidden === sv.meta.id) return null;
  return (
    <div className="pointer-events-auto w-full">
      <div className={cx("inline-flex max-w-full flex-wrap items-center gap-2 rounded-xl border border-warn/40 bg-panel/95 px-3 py-2 text-[12px] shadow-xl backdrop-blur")}>
        <AlertTriangle size={14} className="shrink-0 text-warn" />
        <span className="text-ink2">
          <b className="text-ink">{Math.round(st.vegFraction * 100)}% continuous green cover</b>
          {sv.raster.heightLayer ? "" : " and no height model"} — touching crowns are probably being split into several trees.
        </span>
        <Button
          size="sm"
          variant="primary"
          onClick={() => {
            setKind("crowns");
            setMode("calibrate");
          }}
        >
          Calibrate crowns
        </Button>
        <button onClick={() => setHidden(sv.meta.id)} className="text-muted hover:text-ink" title="Dismiss">
          <X size={13} />
        </button>
      </div>
    </div>
  );
}
