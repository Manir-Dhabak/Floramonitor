"use client";

import { AlertTriangle, ArrowLeft, ArrowRight, Check, Loader2, Minus, Plus, Sparkles, Undo2, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { CalibCircle } from "@/lib/types";
import { effectiveTrees, useStore, type WizardStep } from "@/store/useStore";
import { useAnalysis } from "./AnalysisContext";
import { Button, Progress, cx } from "@/components/ui";

/** Colours shared with the canvas so the card and the drawn circles match. */
export const CALIB_COLORS = { small: "#3ddc97", large: "#5cc8f2", ground: "#f2685c" } as const;

const STEPS: { n: WizardStep; short: string }[] = [
  { n: 1, short: "Small trees" },
  { n: 2, short: "Big trees" },
  { n: 3, short: "Not trees" },
  { n: 4, short: "Result" },
];

/** Which drawn crowns belong to step 1 (small) vs step 2 (large). Untagged crowns count as small. */
export function crownsFor(crowns: CalibCircle[], tag: "small" | "large") {
  return crowns.map((c, i) => ({ c, i })).filter(({ c }) => (tag === "small" ? c.tag !== "large" : c.tag === "large"));
}

function DragHint({ color, ground }: { color: string; ground?: boolean }) {
  return (
    <svg width="52" height="52" viewBox="0 0 52 52" className="shrink-0" aria-hidden>
      <circle cx="26" cy="26" r="21" fill={`${color}1f`} stroke={color} strokeWidth="2" strokeDasharray={ground ? "4 3" : undefined} />
      {ground ? (
        <>
          <path d="M14 33c4-6 8-6 12 0s8 6 12 0" stroke={color} strokeWidth="1.6" fill="none" opacity=".8" />
          <path d="M14 24c4-6 8-6 12 0s8 6 12 0" stroke={color} strokeWidth="1.6" fill="none" opacity=".5" />
        </>
      ) : (
        <>
          <circle cx="26" cy="26" r="2.6" fill={color} />
          <path d="M26 26 L44 18" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M44 18 l-6 -0.5 M44 18 l-3.5 5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}

/** Bottom-centre guided calibration: small crowns → big crowns → not-tree areas → result. */
export function CalibrationWizard({ nudge }: { nudge: number }) {
  const an = useAnalysis();
  const sv = an.active?.survey;
  const wizard = useStore((s) => s.wizard);
  const setStep = useStore((s) => s.setWizardStep);
  const finish = useStore((s) => s.finishCalibration);
  const revert = useStore((s) => s.revertCalibration);
  const apply = useStore((s) => s.applyCalibration);
  const nudgeMerge = useStore((s) => s.nudgeMerge);
  const removeCalib = useStore((s) => s.removeCalib);
  const clearCalib = useStore((s) => s.clearCalib);
  const undo = useStore((s) => s.undo);
  const busy = useStore((s) => s.busy);
  const canUndo = useStore((s) => s.undoStack.some((u) => u.surveyId === s.activeId && u.kind === "calib"));
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    if (!nudge) return;
    setFlash(true);
    const t = setTimeout(() => setFlash(false), 900);
    return () => clearTimeout(t);
  }, [nudge]);

  if (!sv || !wizard) return null;
  const step = wizard.step;
  const gsd = sv.raster.gsd;
  const small = crownsFor(sv.calibration.crowns, "small");
  const large = crownsFor(sv.calibration.crowns, "large");
  const ground = sv.calibration.ground;
  const diam = (c: CalibCircle) => 2 * c.r * gsd;
  const maxSmall = small.length ? Math.max(...small.map(({ c }) => diam(c))) : 0;
  const minLarge = large.length ? Math.min(...large.map(({ c }) => diam(c))) : 0;
  const sizeWarning = small.length > 0 && large.length > 0 && minLarge <= maxSmall;
  const now = effectiveTrees(sv).length;
  const canReach = (n: WizardStep) => (n === 1 ? true : n === 2 ? small.length > 0 : n === 3 ? small.length > 0 && large.length > 0 : wizard.applied);

  const chips = (items: { c: CalibCircle; i: number }[], kind: "crowns" | "ground", color: string) =>
    items.length ? (
      <div className="mt-2 flex flex-wrap gap-1.5">
        {items.map(({ c, i }, k) => (
          <span
            key={i}
            className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11.5px] tabular text-ink"
            style={{ borderColor: `${color}66`, background: `${color}14` }}
          >
            {kind === "ground" ? `Area ${k + 1}` : `Ø ${diam(c).toFixed(1)} m`}
            <button onClick={() => removeCalib(kind, i)} className="text-muted hover:text-bad" title="Remove">
              <X size={11} />
            </button>
          </span>
        ))}
      </div>
    ) : (
      <div className="mt-2 text-[11.5px] text-faint">Nothing drawn yet</div>
    );

  const body =
    step === 1 ? (
      <div className="flex gap-3">
        <DragHint color={CALIB_COLORS.small} />
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold text-ink">Draw 2–3 of the smallest trees</div>
          <p className={cx("text-[12.5px] leading-snug text-ink2 transition-colors", flash && "text-warn")}>
            Press on the <b>centre</b> of a small crown and <b>drag to its edge</b>.
          </p>
          {chips(small, "crowns", CALIB_COLORS.small)}
        </div>
      </div>
    ) : step === 2 ? (
      <div className="flex gap-3">
        <DragHint color={CALIB_COLORS.large} />
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold text-ink">Now draw 1–3 of the biggest trees</div>
          <p className={cx("text-[12.5px] leading-snug text-ink2 transition-colors", flash && "text-warn")}>
            Same way: centre of the crown, <b>drag to its edge</b>. Pick the widest single tree you can see.
          </p>
          {chips(large, "crowns", CALIB_COLORS.large)}
          {sizeWarning && (
            <div className="mt-1.5 flex items-center gap-1 text-[11.5px] text-warn">
              <AlertTriangle size={12} /> This is not bigger than your small trees (Ø {maxSmall.toFixed(1)} m). Draw a larger crown.
            </div>
          )}
        </div>
      </div>
    ) : step === 3 ? (
      <div className="flex gap-3">
        <DragHint color={CALIB_COLORS.ground} ground />
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold text-ink">
            Mark 1–3 areas that are <span className="text-bad">not trees</span>
          </div>
          <p className={cx("text-[12.5px] leading-snug text-ink2 transition-colors", flash && "text-warn")}>
            Drag over grass, low bushes, bare soil or shadow. Optional, but it stops ground cover being counted.
          </p>
          {chips(
            ground.map((c, i) => ({ c, i })),
            "ground",
            CALIB_COLORS.ground,
          )}
        </div>
      </div>
    ) : (
      <div>
        <div className="flex items-end gap-4">
          <div>
            <div className="text-[11px] uppercase tracking-[0.12em] text-muted">Before</div>
            <div className="text-[22px] font-semibold tabular text-ink2 line-through decoration-faint/70">{wizard.prevCount}</div>
          </div>
          <ArrowRight size={18} className="mb-2 text-faint" />
          <div>
            <div className="text-[11px] uppercase tracking-[0.12em] text-leaf">Now</div>
            <div className="text-[28px] font-semibold leading-none tabular text-ink">
              {now} <span className="text-[13px] font-normal text-muted">trees</span>
            </div>
          </div>
          <p className="mb-1 ml-1 hidden flex-1 text-[12px] leading-snug text-muted sm:block">
            Zoom into a few spots. Each crown should carry <b className="text-ink2">one dot</b>.
          </p>
        </div>
        <div className="mt-3 grid gap-1.5 sm:grid-cols-2">
          <button
            disabled={!!busy}
            onClick={() => void nudgeMerge(1)}
            className="flex items-center gap-2 rounded-lg border border-line2 bg-panel2 px-2.5 py-2 text-left hover:border-leaf/50 disabled:opacity-50"
          >
            <Minus size={15} className="shrink-0 text-leaf" />
            <span className="text-[12px] leading-tight">
              <b className="text-ink">Fewer trees</b>
              <span className="block text-muted">one tree is still split into pieces</span>
            </span>
          </button>
          <button
            disabled={!!busy}
            onClick={() => void nudgeMerge(-1)}
            className="flex items-center gap-2 rounded-lg border border-line2 bg-panel2 px-2.5 py-2 text-left hover:border-leaf/50 disabled:opacity-50"
          >
            <Plus size={15} className="shrink-0 text-leaf" />
            <span className="text-[12px] leading-tight">
              <b className="text-ink">More trees</b>
              <span className="block text-muted">separate trees are joined together</span>
            </span>
          </button>
        </div>
      </div>
    );

  const working = !!busy;

  return (
    <div
      className="no-print absolute bottom-3 left-1/2 z-20 w-[min(600px,calc(100%-24px))] -translate-x-1/2 rounded-2xl border border-leaf/30 bg-panel/95 shadow-2xl backdrop-blur"
      data-testid="calib-wizard"
    >
      {/* step rail */}
      <div className="flex items-center gap-1 border-b border-line px-3 py-2">
        <Sparkles size={14} className="mr-1 shrink-0 text-leaf" />
        {STEPS.map((s, k) => {
          const done = s.n < step || (s.n === 4 && wizard.applied);
          const on = s.n === step;
          return (
            <div key={s.n} className="flex min-w-0 items-center gap-1">
              {k > 0 && <span className="h-px w-2 shrink-0 bg-line2 sm:w-4" />}
              <button
                disabled={!canReach(s.n) || working}
                onClick={() => setStep(s.n)}
                className={cx(
                  "inline-flex min-w-0 items-center gap-1.5 rounded-full px-1.5 py-0.5 text-[11.5px] disabled:cursor-default",
                  on ? "bg-leaf/15 text-ink" : done ? "text-ink2 hover:text-ink" : "text-faint",
                )}
              >
                <span
                  className={cx(
                    "grid h-4 w-4 shrink-0 place-items-center rounded-full text-[10px] font-semibold",
                    on ? "bg-leaf text-bg" : done ? "bg-leaf/25 text-leaf" : "bg-panel3 text-muted",
                  )}
                >
                  {done && !on ? <Check size={10} /> : s.n}
                </span>
                <span className={cx("truncate", !on && "hidden sm:inline")}>{s.short}</span>
              </button>
            </div>
          );
        })}
        <button onClick={finish} className="ml-auto shrink-0 rounded p-1 text-muted hover:bg-panel3 hover:text-ink" title="Close (your samples are kept)">
          <X size={15} />
        </button>
      </div>

      {/* body */}
      <div className="relative px-4 py-3">
        {body}
        {working && (
          <div className="absolute inset-0 flex flex-col justify-center gap-2 rounded-b-2xl bg-panel/95 px-5">
            <div className="flex items-center gap-2 text-[12.5px] text-ink2">
              <Loader2 size={14} className="animate-spin text-leaf" />
              {busy?.label?.split(": ").pop() ?? "Working"}…
            </div>
            <Progress pct={busy?.pct ?? 0} />
          </div>
        )}
      </div>

      {/* actions */}
      <div className="flex items-center gap-1.5 border-t border-line px-3 py-2">
        {step < 4 ? (
          <>
            <Button size="sm" variant="ghost" icon={<Undo2 size={13} />} disabled={!canUndo || working} onClick={() => undo("calib")} title="Undo last sample (Ctrl/⌘ Z)">
              Undo
            </Button>
            {step > 1 && (
              <Button size="sm" variant="ghost" icon={<ArrowLeft size={13} />} disabled={working} onClick={() => setStep((step - 1) as WizardStep)}>
                Back
              </Button>
            )}
            {step === 1 && (small.length > 0 || large.length > 0 || ground.length > 0) && (
              <button onClick={clearCalib} className="px-1.5 text-[11.5px] text-muted hover:text-bad" disabled={working}>
                Start over
              </button>
            )}
            <span className="ml-auto hidden text-[11px] text-faint md:inline">Scroll to zoom · right-drag to move</span>
            {step === 1 && (
              <Button size="sm" variant="primary" className="ml-auto md:ml-2" disabled={!small.length} onClick={() => setStep(2)}>
                Next: big trees <ArrowRight size={13} />
              </Button>
            )}
            {step === 2 && (
              <Button size="sm" variant="primary" className="ml-auto md:ml-2" disabled={!large.length} onClick={() => setStep(3)}>
                Next: not trees <ArrowRight size={13} />
              </Button>
            )}
            {step === 3 && (
              <Button size="sm" variant="primary" className="ml-auto md:ml-2" icon={<Sparkles size={13} />} disabled={working || !small.length || !large.length} onClick={() => void apply()}>
                {ground.length ? "Show result" : "Skip & show result"}
              </Button>
            )}
          </>
        ) : (
          <>
            <Button size="sm" variant="ghost" icon={<ArrowLeft size={13} />} disabled={working} onClick={() => setStep(1)}>
              Edit samples
            </Button>
            <Button size="sm" variant="ghost" disabled={working} onClick={() => void revert()} title="Go back to the detection you had before calibrating">
              Discard
            </Button>
            <Button size="sm" variant="primary" className="ml-auto" icon={<Check size={13} />} disabled={working} onClick={finish}>
              Done
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

/** Suggests calibration when a continuous canopy is being split by the shape-based detector. */
export function DenseCanopyBanner() {
  const an = useAnalysis();
  const start = useStore((s) => s.startCalibration);
  const [hidden, setHidden] = useState<string | null>(null);
  const sv = an.active?.survey;
  const det = sv?.detection;
  if (!sv || !det) return null;
  const st = det.stats;
  const dense = st.vegFraction > 0.45 && st.markerSource === "rgb";
  if (!dense || hidden === sv.meta.id) return null;
  return (
    <div className="pointer-events-auto inline-flex max-w-full flex-wrap items-center gap-2 rounded-xl border border-warn/40 bg-panel/95 px-3 py-1.5 text-[12px] shadow-xl backdrop-blur">
      <AlertTriangle size={14} className="shrink-0 text-warn" />
      <span className="text-ink2">
        <b className="text-ink">Dense canopy</b> — touching crowns may be counted as several trees.
      </span>
      <Button size="sm" variant="primary" icon={<Sparkles size={13} />} onClick={start}>
        Calibrate crowns
      </Button>
      <button onClick={() => setHidden(sv.meta.id)} className="text-muted hover:text-ink" title="Dismiss">
        <X size={13} />
      </button>
    </div>
  );
}
