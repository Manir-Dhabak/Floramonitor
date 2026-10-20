"use client";

import { Calculator, Cpu, FolderOpen, Plus, RefreshCw, ScanSearch, Sprout, Trash2, Upload } from "lucide-react";
import { useState } from "react";
import { MODEL_LABELS, weightedWoodDensity } from "@/lib/allometry";
import { ARR_SPECIES, MANGROVE_SPECIES } from "@/lib/defaults";
import type { AllometryModel, Species } from "@/lib/types";
import { useStore } from "@/store/useStore";
import { useAnalysis } from "./AnalysisContext";
import { Badge, Button, NumberField, Section, Select, TextField, Toggle, cx, fmt } from "@/components/ui";

export function Sidebar({ onAddSurvey, open, onClose }: { onAddSurvey: () => void; open: boolean; onClose: () => void }) {
  return (
    <>
    {open && <div className="no-print fixed inset-0 z-30 bg-black/50 lg:hidden" onClick={onClose} />}
    <aside
      className={cx(
        "no-print h-full w-[330px] shrink-0 flex-col overflow-y-auto border-r border-line bg-panel",
        open ? "fixed bottom-0 left-0 top-14 z-40 flex shadow-2xl lg:static lg:z-auto lg:shadow-none" : "hidden lg:flex",
      )}
    >
      <ProjectPanel onAddSurvey={onAddSurvey} />
      <DetectionPanel />
      <PlantingPanel />
      <CarbonPanel />
      <div className="px-4 py-5 text-[11px] leading-relaxed text-faint">
        All processing runs locally in your browser. Imagery never leaves this device.
      </div>
    </aside>
    </>
  );
}

function ProjectPanel({ onAddSurvey }: { onAddSurvey: () => void }) {
  const project = useStore((s) => s.project);
  const setProject = useStore((s) => s.setProject);
  const surveys = useStore((s) => s.surveys);
  const activeId = useStore((s) => s.activeId);
  const baselineId = useStore((s) => s.baselineId);
  const setActive = useStore((s) => s.setActive);
  const setBaseline = useStore((s) => s.setBaseline);
  const removeSurvey = useStore((s) => s.removeSurvey);
  return (
    <Section title="Project & surveys" icon={<FolderOpen size={15} />}>
      <TextField label="Project name" value={project.name} onChange={(v) => setProject({ name: v })} />
      <div className="grid grid-cols-2 gap-2">
        <Select
          label="Ecosystem"
          value={project.ecosystem}
          onChange={(v) => setProject({ ecosystem: v })}
          options={[
            { value: "arr", label: "ARR" },
            { value: "mangrove", label: "Mangrove" },
          ]}
        />
        <TextField label="Developer" value={project.developer} onChange={(v) => setProject({ developer: v })} />
      </div>
      <TextField label="Standard / methodology" value={project.standard} onChange={(v) => setProject({ standard: v })} />
      <div className="space-y-1.5">
        {surveys.map((s) => (
          <div
            key={s.meta.id}
            className={cx(
              "group flex items-center gap-2 rounded-lg border px-2.5 py-2",
              s.meta.id === activeId ? "border-leaf/50 bg-leaf/5" : "border-line2 bg-panel2 hover:border-line2",
            )}
          >
            <button className="min-w-0 flex-1 text-left" onClick={() => setActive(s.meta.id)}>
              <div className="flex items-center gap-1.5">
                <span className={cx("h-1.5 w-1.5 rounded-full", s.meta.id === activeId ? "bg-leaf" : "bg-faint")} />
                <span className="truncate text-[12.5px] font-medium text-ink">{s.meta.name}</span>
              </div>
              <div className="mt-0.5 truncate pl-3 text-[11px] text-muted tabular">
                {s.meta.date} · {s.detection ? `${fmt.int(s.detection.trees.length - s.removed.length + s.added.length)} trees` : "not analysed"} · {(s.raster.gsd * 100).toFixed(1)} cm
              </div>
            </button>
            {surveys.length > 1 && (
              <button
                onClick={() => setBaseline(baselineId === s.meta.id ? null : s.meta.id)}
                title="Use as baseline for change analysis"
                className={cx("rounded px-1.5 py-0.5 text-[10px] font-medium", baselineId === s.meta.id ? "bg-sky/15 text-sky" : "text-faint hover:text-ink2")}
              >
                {baselineId === s.meta.id ? "baseline" : "set base"}
              </button>
            )}
            <button onClick={() => removeSurvey(s.meta.id)} className="text-faint opacity-0 hover:text-bad group-hover:opacity-100" title="Remove survey">
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>
      <Button variant="outline" className="w-full" icon={<Upload size={14} />} onClick={onAddSurvey}>
        Add drone survey
      </Button>
    </Section>
  );
}

function DetectionPanel() {
  const an = useAnalysis();
  const sv = an.active?.survey;
  const setDetectParams = useStore((s) => s.setDetectParams);
  const run = useStore((s) => s.runDetection);
  const busy = useStore((s) => s.busy);
  if (!sv) return null;
  const p = sv.detectParams;
  const set = (patch: Partial<typeof p>) => setDetectParams(sv.meta.id, patch);
  const st = sv.detection?.stats;
  const hasH = !!sv.raster.heightLayer;
  return (
    <Section
      title="Tree detection"
      icon={<ScanSearch size={15} />}
      right={st ? <Badge tone="good">{fmt.int(sv.detection!.trees.length)}</Badge> : null}
      hint="Vegetation index → Otsu/hysteresis mask → tree tops (distance-transform peaks or variable-window filter on height) → marker-controlled watershed crowns."
    >
      <div className="grid grid-cols-2 gap-2">
        <Select
          label="Vegetation index"
          value={p.segIndex}
          onChange={(v) => set({ segIndex: v })}
          options={[
            { value: "exg", label: "ExG" },
            { value: "exgr", label: "ExG − ExR" },
            { value: "vari", label: "VARI" },
            { value: "ndvi", label: sv.raster.nir ? "NDVI" : "NDVI (no NIR)" },
          ]}
          hint="ExG is robust on bare soil / mudflat backgrounds. NDVI requires a NIR band."
        />
        <Select
          label="Tree tops from"
          value={hasH ? p.markerSource : "rgb"}
          onChange={(v) => set({ markerSource: v })}
          options={[
            { value: "height", label: hasH ? "Height (VWF)" : "Height (none)" },
            { value: "rgb", label: "Crown shape" },
          ]}
          hint="Variable-window filter on the CHM (Popescu & Wynne 2004) or distance-transform peaks of the crown mask."
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Select
          label="Threshold"
          value={p.thresholdMode}
          onChange={(v) => set({ thresholdMode: v })}
          options={[
            { value: "otsu", label: "Otsu (auto)" },
            { value: "manual", label: "Manual" },
          ]}
        />
        {p.thresholdMode === "manual" ? (
          <NumberField label="Index threshold" value={p.manualThreshold} step={0.01} onChange={(v) => set({ manualThreshold: v })} />
        ) : (
          <NumberField label="Otsu offset" value={p.thresholdBias} step={0.01} onChange={(v) => set({ thresholdBias: v })} hint="Raise to drop pale ground vegetation, lower to keep sparse crowns." />
        )}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <NumberField label="Min crown" unit="m" value={p.minCrownDiameterM} step={0.05} min={0.05} onChange={(v) => set({ minCrownDiameterM: v })} />
        <NumberField label="Max crown" unit="m" value={p.maxCrownDiameterM} step={0.25} min={0.5} onChange={(v) => set({ maxCrownDiameterM: v })} />
        <NumberField label="Min spacing" unit="m" value={p.minTreeSpacingM} step={0.1} min={0.2} onChange={(v) => set({ minTreeSpacingM: v })} hint="Minimum distance between two tree tops." />
      </div>
      {hasH && (
        <div className="grid grid-cols-3 gap-2">
          <NumberField label="Min height" unit="m" value={p.minHeightM} step={0.05} min={0} onChange={(v) => set({ minHeightM: v })} />
          <NumberField label="VWF a" value={p.vwfA} step={0.01} onChange={(v) => set({ vwfA: v })} hint="Window radius (m) = a·height + b" />
          <NumberField label="VWF b" unit="m" value={p.vwfB} step={0.05} onChange={(v) => set({ vwfB: v })} />
        </div>
      )}
      <div className="space-y-1.5 pt-1">
        {hasH && <Toggle label="Ignore vegetation below min height" checked={p.heightFilter} onChange={(v) => set({ heightFilter: v })} />}
        <Toggle label="Mask water / tidal channels" checked={p.excludeWater} onChange={(v) => set({ excludeWater: v })} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <NumberField label="Watch below z" value={p.healthWatchZ} step={0.25} onChange={(v) => set({ healthWatchZ: v })} hint="Robust z-score of crown greenness within the block." />
        <NumberField label="Weak below z" value={p.healthWeakZ} step={0.25} onChange={(v) => set({ healthWeakZ: v })} />
      </div>
      <Button variant="primary" className="w-full" disabled={!!busy} icon={<RefreshCw size={14} />} onClick={() => run(sv.meta.id)}>
        Re-run detection
      </Button>
      {st && (
        <div className="grid grid-cols-3 gap-1.5 text-center text-[10.5px] text-muted">
          <div className="rounded-md bg-panel2 py-1.5">
            <div className="tabular text-[12px] text-ink">{st.threshold.toFixed(3)}</div>threshold
          </div>
          <div className="rounded-md bg-panel2 py-1.5">
            <div className="tabular text-[12px] text-ink">{(st.vegFraction * 100).toFixed(1)}%</div>canopy
          </div>
          <div className="rounded-md bg-panel2 py-1.5">
            <div className="tabular text-[12px] text-ink">{(st.runtimeMs / 1000).toFixed(1)} s</div>
            {st.markerSource === "height" ? "VWF" : "RGB"} run
          </div>
        </div>
      )}
    </Section>
  );
}

function PlantingPanel() {
  const p = useStore((s) => s.planting);
  const set = useStore((s) => s.setPlanting);
  const an = useAnalysis();
  const s = an.active?.survival;
  return (
    <Section title="Planting design" icon={<Sprout size={15} />} defaultOpen={false} hint="Used to compute expected stock, survival and gaps.">
      <div className="grid grid-cols-2 gap-2">
        <NumberField label="Spacing (row)" unit="m" value={p.spacingX} step={0.25} min={0.3} onChange={(v) => set({ spacingX: v })} />
        <NumberField label="Spacing (plant)" unit="m" value={p.spacingY} step={0.25} min={0.3} onChange={(v) => set({ spacingY: v })} />
      </div>
      <div className="text-[11px] text-muted">Design density {fmt.int(10000 / (p.spacingX * p.spacingY))} trees/ha</div>
      <div className="grid grid-cols-2 gap-2">
        <Select
          label="Planted area"
          value={p.plantedAreaMode}
          onChange={(v) => set({ plantedAreaMode: v })}
          options={[
            { value: "auto", label: "Auto (tree extent)" },
            { value: "manual", label: "Enter area" },
          ]}
        />
        {p.plantedAreaMode === "manual" ? (
          <NumberField label="Area" unit="ha" value={p.plantedAreaHa} step={0.01} min={0.0001} onChange={(v) => set({ plantedAreaHa: v })} />
        ) : (
          <div>
            <div className="mb-1 text-[11.5px] font-medium text-ink2">Estimated</div>
            <div className="flex h-8 items-center rounded-md border border-line bg-panel2 px-2.5 text-[13px] tabular text-ink2">{s ? `${s.plantedAreaHa.toFixed(3)} ha` : "—"}</div>
          </div>
        )}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <NumberField label="Grid cell" unit="m" value={p.gridCellM} step={1} min={2} onChange={(v) => set({ gridCellM: v })} />
        <NumberField label="Gap below" unit="×" value={p.gapThreshold} step={0.05} min={0} max={1} onChange={(v) => set({ gapThreshold: v })} hint="Stocking ratio (observed / expected) below which a cell is a gap." />
        <NumberField label="Target" unit="%" value={p.survivalTarget} step={1} min={0} max={100} onChange={(v) => set({ survivalTarget: v })} />
      </div>
      <TextField label="Planting date" type="date" value={p.plantingDate} onChange={(v) => set({ plantingDate: v })} />
    </Section>
  );
}

function CarbonPanel() {
  const p = useStore((s) => s.carbon);
  const set = useStore((s) => s.setCarbon);
  const eco = useStore((s) => s.project.ecosystem);
  const an = useAnalysis();
  const [adv, setAdv] = useState(false);
  const updSp = (i: number, patch: Partial<Species>) => set({ species: p.species.map((s, k) => (k === i ? { ...s, ...patch } : s)) });
  const share = p.species.reduce((a, s) => a + s.share, 0);
  return (
    <Section title="Carbon model" icon={<Calculator size={15} />} defaultOpen={false} hint="Crown + height → stem diameter → biomass → CO₂e, with Monte Carlo uncertainty and the VCS §2.4 deduction.">
      <Select
        label="Allometry"
        value={p.model}
        onChange={(v) => set({ model: v as AllometryModel })}
        options={(Object.keys(MODEL_LABELS) as AllometryModel[]).map((k) => ({ value: k, label: MODEL_LABELS[k] }))}
      />
      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[11.5px] font-medium text-ink2">Species mix</span>
          <span className={cx("text-[11px] tabular", Math.abs(share - 100) > 0.5 ? "text-warn" : "text-muted")}>
            Σ {share}% · ρ̄ {weightedWoodDensity(p.species).toFixed(3)}
          </span>
        </div>
        <div className="space-y-1">
          <div className="grid grid-cols-[1fr_52px_58px_18px] gap-1 px-0.5 text-[10px] uppercase tracking-wide text-faint">
            <span>Species</span>
            <span>Share %</span>
            <span>ρ g/cm³</span>
            <span />
          </div>
          {p.species.map((s, i) => (
            <div key={s.id} className="grid grid-cols-[1fr_52px_58px_18px] items-center gap-1" title={s.note}>
              <input
                value={s.name}
                onChange={(e) => updSp(i, { name: e.target.value })}
                className="h-7 min-w-0 rounded border border-line2 bg-panel px-1.5 text-[11.5px] italic text-ink outline-none focus:border-leaf/60"
              />
              <input
                type="number"
                value={s.share}
                onChange={(e) => updSp(i, { share: Number(e.target.value) || 0 })}
                className="h-7 rounded border border-line2 bg-panel px-1.5 text-[11.5px] tabular text-ink outline-none focus:border-leaf/60"
              />
              <input
                type="number"
                step={0.01}
                value={s.woodDensity}
                onChange={(e) => updSp(i, { woodDensity: Number(e.target.value) || 0, note: "user value" })}
                className={cx(
                  "h-7 rounded border bg-panel px-1.5 text-[11.5px] tabular text-ink outline-none focus:border-leaf/60",
                  /placeholder|verify/i.test(s.note ?? "") ? "border-warn/40" : "border-line2",
                )}
              />
              <button onClick={() => set({ species: p.species.filter((_, k) => k !== i) })} className="text-faint hover:text-bad">
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
        <div className="mt-1.5 flex gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            icon={<Plus size={12} />}
            onClick={() => set({ species: [...p.species, { id: Math.random().toString(36).slice(2, 7), name: "New species", share: 0, woodDensity: 0.6, note: "user value" }] })}
          >
            Add
          </Button>
          <Button size="sm" variant="ghost" onClick={() => set({ species: (eco === "mangrove" ? MANGROVE_SPECIES : ARR_SPECIES).map((s) => ({ ...s })) })}>
            Reset presets
          </Button>
        </div>
        <p className="mt-1 text-[10.5px] leading-snug text-faint">Amber densities are placeholders — replace with GWDD or site values before reporting.</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <NumberField label="Root:shoot" value={p.rootShoot} step={0.01} min={0} onChange={(v) => set({ rootShoot: v })} hint="IPCC 2006 Table 4.4: tropical dry forest 0.56 (AGB < 20 t/ha). Ignored by Komiyama (own root equation)." />
        <NumberField label="Carbon fraction" value={p.carbonFraction} step={0.01} min={0.3} max={0.6} onChange={(v) => set({ carbonFraction: v })} hint="IPCC default 0.47" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Select
          label="Height source"
          value={p.heightSource}
          onChange={(v) => set({ heightSource: v })}
          options={[
            { value: "layer", label: an.active?.survey.raster.heightLayer ? "Height model" : "Height model (none)" },
            { value: "assumed", label: "Assumed mean" },
          ]}
        />
        {p.heightSource === "assumed" || !an.active?.survey.raster.heightLayer ? (
          <NumberField label="Assumed height" unit="m" value={p.assumedHeightM} step={0.1} min={0.1} onChange={(v) => set({ assumedHeightM: v })} />
        ) : (
          <NumberField label="CHM bias corr." unit="×" value={p.heightBias} step={0.01} onChange={(v) => set({ heightBias: v })} hint="Photogrammetric CHMs usually under-estimate sapling height; +0.05 adds 5%. Calibrate with field heights." />
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Select
          label="Count correction"
          value={p.correction}
          onChange={(v) => set({ correction: v })}
          options={[
            { value: "qa", label: "From QA plots" },
            { value: "field", label: "From field counts" },
            { value: "none", label: "None" },
          ]}
        />
        <NumberField
          label="Project area"
          unit="ha"
          value={p.projectAreaHa ?? 0}
          step={0.1}
          min={0}
          onChange={(v) => set({ projectAreaHa: v > 0 ? v : null })}
          hint="0 = report for the surveyed planted area only. Larger values extrapolate per-ha density with sampling error."
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <NumberField label="Buffer" unit="%" value={p.bufferPct} step={1} min={0} max={60} onChange={(v) => set({ bufferPct: v })} hint="AFOLU non-permanence buffer from your risk assessment." />
        <NumberField label="Leakage" unit="%" value={p.leakagePct} step={1} min={0} max={100} onChange={(v) => set({ leakagePct: v })} />
      </div>
      <button onClick={() => setAdv(!adv)} className="flex items-center gap-1.5 text-[11.5px] font-medium text-leaf hover:underline">
        <Cpu size={12} /> {adv ? "Hide" : "Show"} uncertainty settings
      </button>
      {adv && (
        <div className="grid grid-cols-2 gap-2 rounded-lg border border-line bg-panel2 p-2.5">
          <NumberField label="Wood density CV" value={p.woodDensityCv} step={0.01} min={0} onChange={(v) => set({ woodDensityCv: v })} />
          <NumberField label="Height CV" value={p.heightCv} step={0.01} min={0} onChange={(v) => set({ heightCv: v })} />
          <NumberField label="Allom. residual σ" value={p.allometryResidualSigma} step={0.05} min={0} onChange={(v) => set({ allometryResidualSigma: v })} hint="Per-tree log-scale residual (random)" />
          <NumberField label="Allom. systematic CV" value={p.allometrySystematicCv} step={0.01} min={0} onChange={(v) => set({ allometrySystematicCv: v })} />
          <NumberField label="Root:shoot CV" value={p.rootShootCv} step={0.01} min={0} onChange={(v) => set({ rootShootCv: v })} />
          <NumberField label="Unvalidated count CV" value={p.detectionCvUnvalidated} step={0.01} min={0} onChange={(v) => set({ detectionCvUnvalidated: v })} />
          <NumberField label="Assumed-height CV" value={p.assumedHeightCv} step={0.05} min={0} onChange={(v) => set({ assumedHeightCv: v })} />
          <NumberField label="Iterations" value={p.iterations} step={500} min={200} max={20000} onChange={(v) => set({ iterations: Math.round(v) })} />
          <NumberField label="D model a" value={p.dModelA} step={0.01} min={0.01} onChange={(v) => set({ dModelA: v })} hint="Stem diameter D (cm) = a·(H·CD)^b. Jucker 2017 global: a=0.557. Replace with a fit to your field DBH." />
          <NumberField label="D model b" value={p.dModelB} step={0.01} min={0.1} onChange={(v) => set({ dModelB: v })} hint="Jucker 2017 global: b=0.809" />
        </div>
      )}
    </Section>
  );
}
