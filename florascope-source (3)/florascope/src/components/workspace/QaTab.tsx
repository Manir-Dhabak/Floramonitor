"use client";

import { Crosshair, Download, FlaskConical, MapPin, Shuffle, Square, Trash2 } from "lucide-react";
import { useState } from "react";
import { download, plotsCSV, plotsGeoJSON, plotsGPX } from "@/lib/exports";
import { planFieldPlots, recountPlots } from "@/lib/plots";
import { Rng } from "@/lib/rng";
import { useStore } from "@/store/useStore";
import { useAnalysis } from "./AnalysisContext";
import { ImageViewer } from "./ImageViewer";
import { Badge, Button, Card, NumberField, Stat, fmt } from "@/components/ui";

export function QaTab() {
  const an = useAnalysis();
  const a = an.active;
  const setMode = useStore((s) => s.setMode);
  const removeQaPlot = useStore((s) => s.removeQaPlot);
  const addQaPlot = useStore((s) => s.addQaPlot);
  const focusOn = useStore((s) => s.focusOn);
  const setFieldPlots = useStore((s) => s.setFieldPlots);
  const updateFieldPlot = useStore((s) => s.updateFieldPlot);
  const clearEdits = useStore((s) => s.clearEdits);
  const [nPlots, setNPlots] = useState(8);
  const [radius, setRadius] = useState(5.64);
  if (!a?.survey.detection || !a.survival) return null;
  const sv = a.survey;
  const qa = a.qa;
  const gsd = sv.raster.gsd;
  const reviewed = qa ? qa.tp + qa.fp + qa.fn : 0;
  const fm = a.field;
  const b = a.bench;

  const suggestQa = () => {
    const rng = new Rng(Date.now() % 100000);
    const side = Math.max(8, Math.min(20, 15)) / gsd;
    const plantable = a.survival!.plantableMask;
    const W = sv.raster.width;
    const H = sv.raster.height;
    let added = 0;
    for (let tries = 0; tries < 400 && added < 3; tries++) {
      const x = rng.uniform() * (W - side);
      const y = rng.uniform() * (H - side);
      const cx = Math.round(x + side / 2);
      const cy = Math.round(y + side / 2);
      if (!plantable[cy * W + cx] || !plantable[Math.round(y) * W + Math.round(x)] || !plantable[Math.round(y + side - 1) * W + Math.round(x + side - 1)]) continue;
      if (sv.qaPlots.some((p) => Math.abs(p.x0 - x) < side && Math.abs(p.y0 - y) < side)) continue;
      addQaPlot({ x0: x, y0: y, x1: x + side, y1: y + side });
      added++;
    }
    setMode("qa");
  };

  return (
    <div className="grid h-full gap-3 lg:grid-cols-[420px_1fr]">
      <div className="space-y-3 overflow-y-auto pb-6 pr-1">
        <Card title="Photo-interpretation QA" right={<Badge tone={qa && qa.plots >= 3 && reviewed >= 100 ? "good" : "warn"}>{qa?.plots ?? 0} plots</Badge>}>
          <ol className="mb-3 list-decimal space-y-1 pl-4 text-[12px] leading-relaxed text-ink2">
            <li>Switch the viewer to <b>QA plot</b> mode and drag rectangles (or auto-suggest them).</li>
            <li>Inside each plot, click every false detection to flag it and click every missed tree to add it.</li>
            <li>Precision, recall and the count-correction factor update live and flow into survival and carbon.</li>
          </ol>
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant="primary" icon={<Square size={12} />} onClick={() => setMode("qa")}>
              Draw QA plots
            </Button>
            <Button size="sm" variant="outline" icon={<Shuffle size={12} />} onClick={suggestQa}>
              Suggest 3 random plots
            </Button>
            <Button size="sm" variant="ghost" onClick={clearEdits}>
              Reset edits
            </Button>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <Stat label="Precision" value={qa?.precision !== null && qa?.precision !== undefined ? fmt.pct(qa.precision * 100) : "—"} tone={qa?.precision && qa.precision >= 0.9 ? "good" : "neutral"} />
            <Stat label="Recall" value={qa?.recall !== null && qa?.recall !== undefined ? fmt.pct(qa.recall * 100) : "—"} tone={qa?.recall && qa.recall >= 0.9 ? "good" : "neutral"} />
            <Stat label="F1" value={qa?.f1 !== null && qa?.f1 !== undefined ? fmt.pct(qa.f1 * 100) : "—"} />
          </div>
          <div className="mt-2 text-[11.5px] text-muted tabular">
            {reviewed} trees reviewed · TP {qa?.tp ?? 0} · FP {qa?.fp ?? 0} · FN {qa?.fn ?? 0} · correction ×{(qa?.correction ?? 1).toFixed(3)}
          </div>
          {sv.qaPlots.length > 0 && (
            <div className="mt-3 divide-y divide-line rounded-lg border border-line">
              {sv.qaPlots.map((p) => {
                const w = Math.abs(p.x1 - p.x0) * gsd;
                const h = Math.abs(p.y1 - p.y0) * gsd;
                return (
                  <div key={p.id} className="flex items-center justify-between px-3 py-1.5 text-[12px]">
                    <span className="text-ink2">
                      QA {p.id} · <span className="tabular text-muted">{w.toFixed(1)} × {h.toFixed(1)} m</span>
                    </span>
                    <span className="flex gap-1">
                      <Button size="sm" variant="ghost" icon={<Crosshair size={12} />} onClick={() => focusOn((p.x0 + p.x1) / 2, (p.y0 + p.y1) / 2, Math.min(8, 500 / Math.max(Math.abs(p.x1 - p.x0), 1)))} />
                      <Button size="sm" variant="ghost" icon={<Trash2 size={12} />} onClick={() => removeQaPlot(p.id)} />
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        {b && (
          <Card title={<span className="inline-flex items-center gap-2"><FlaskConical size={14} className="text-sky" />Benchmark vs synthetic ground truth</span>} right={<Badge tone="info">demo only</Badge>}>
            <div className="grid grid-cols-3 gap-2">
              <Stat label="Precision" value={fmt.pct(b.precision * 100)} />
              <Stat label="Recall" value={fmt.pct(b.recall * 100)} />
              <Stat label="F1" value={fmt.pct(b.f1 * 100)} tone="good" />
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[12px] tabular">
              <dt className="text-muted">Truth (live trees)</dt>
              <dd className="text-right text-ink">{fmt.int(b.truthAlive)}</dd>
              <dt className="text-muted">Detected (after edits)</dt>
              <dd className="text-right text-ink">{fmt.int(b.detected)}</dd>
              <dt className="text-muted">Count error</dt>
              <dd className="text-right text-ink">{b.countErrorPct >= 0 ? "+" : ""}{b.countErrorPct.toFixed(2)}%</dd>
              <dt className="text-muted">Crown Ø RMSE</dt>
              <dd className="text-right text-ink">{b.crownRmseM !== null ? `${b.crownRmseM.toFixed(3)} m` : "—"}</dd>
              <dt className="text-muted">Height RMSE / bias</dt>
              <dd className="text-right text-ink">{b.heightRmseM !== null ? `${b.heightRmseM.toFixed(3)} / ${b.heightBiasM?.toFixed(3)} m` : "—"}</dd>
            </dl>
            <p className="mt-2 text-[11.5px] leading-relaxed text-muted">
              The demo imagery is procedurally generated, so this is an upper bound. On real flights, accuracy must be established with QA and field plots — which is exactly what the tools above produce.
            </p>
          </Card>
        )}

        <Card title={<span className="inline-flex items-center gap-2"><MapPin size={14} className="text-sky" />Field verification plots</span>} right={<Badge tone={fm && fm.plotsWithCounts >= 5 ? "good" : "neutral"}>{fm?.plotsWithCounts ?? 0} counted</Badge>}>
          <div className="grid grid-cols-3 gap-2">
            <NumberField label="Plots" value={nPlots} step={1} min={1} max={60} onChange={(v) => setNPlots(Math.round(v))} />
            <NumberField label="Radius" unit="m" value={radius} step={0.5} min={1} onChange={setRadius} hint="5.64 m = 100 m² circular plot" />
            <div className="flex items-end">
              <Button
                variant="primary"
                className="w-full"
                onClick={() =>
                  setFieldPlots(
                    planFieldPlots({
                      n: nPlots,
                      radiusM: radius,
                      plantable: a.survival!.plantableMask,
                      width: sv.raster.width,
                      height: sv.raster.height,
                      gsd,
                      trees: a.trees,
                      geo: sv.raster.geo,
                      seed: Date.now() % 1000,
                    }),
                  )
                }
              >
                Generate
              </Button>
            </div>
          </div>
          {sv.fieldPlots.length > 0 && (
            <>
              <div className="mt-3 overflow-hidden rounded-lg border border-line">
                <table className="w-full text-[11.5px] tabular">
                  <thead className="bg-panel2 text-[10.5px] uppercase tracking-wide text-muted">
                    <tr>
                      <th className="px-2 py-1.5 text-left">Plot</th>
                      <th className="px-2 text-left">Lat, lon</th>
                      <th className="px-2 text-right">Det.</th>
                      <th className="px-2 text-right">Field n</th>
                      <th className="px-2 text-right">Field H̄</th>
                      <th className="px-2 text-right">DBH̄ cm</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recountPlots(sv.fieldPlots, a.trees, gsd).map((p) => (
                      <tr key={p.id} className="border-t border-line">
                        <td className="px-2 py-1">
                          <button className="font-medium text-sky hover:underline" onClick={() => focusOn(p.x, p.y, 3)}>
                            {p.id}
                          </button>
                        </td>
                        <td className="px-2 text-muted">{p.lat !== null ? `${p.lat.toFixed(5)}, ${p.lon?.toFixed(5)}` : "—"}</td>
                        <td className="px-2 text-right text-ink">{p.detected}</td>
                        <td className="px-1 text-right">
                          <input
                            type="number"
                            value={p.fieldCount ?? ""}
                            placeholder="—"
                            onChange={(e) => updateFieldPlot(p.id, { fieldCount: e.target.value === "" ? null : Number(e.target.value), detected: p.detected })}
                            className="h-6 w-14 rounded border border-line2 bg-panel px-1 text-right text-ink outline-none focus:border-leaf/60"
                          />
                        </td>
                        <td className="px-1 text-right">
                          <input
                            type="number"
                            step={0.1}
                            value={p.fieldMeanHeight ?? ""}
                            placeholder="m"
                            onChange={(e) => updateFieldPlot(p.id, { fieldMeanHeight: e.target.value === "" ? null : Number(e.target.value) })}
                            className="h-6 w-14 rounded border border-line2 bg-panel px-1 text-right text-ink outline-none focus:border-leaf/60"
                          />
                        </td>
                        <td className="px-1 text-right">
                          <input
                            type="number"
                            step={0.1}
                            value={p.fieldMeanDbh ?? ""}
                            placeholder="cm"
                            onChange={(e) => updateFieldPlot(p.id, { fieldMeanDbh: e.target.value === "" ? null : Number(e.target.value) })}
                            className="h-6 w-14 rounded border border-line2 bg-panel px-1 text-right text-ink outline-none focus:border-leaf/60"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Button size="sm" variant="outline" icon={<Download size={12} />} onClick={() => download(`${sv.meta.name}-field-plots.gpx`, plotsGPX(sv, sv.fieldPlots), "application/gpx+xml")}>
                  GPX
                </Button>
                <Button size="sm" variant="outline" icon={<Download size={12} />} onClick={() => download(`${sv.meta.name}-field-plots.csv`, plotsCSV(sv.fieldPlots), "text/csv")}>
                  CSV
                </Button>
                <Button size="sm" variant="outline" icon={<Download size={12} />} onClick={() => download(`${sv.meta.name}-field-plots.geojson`, plotsGeoJSON(sv, sv.fieldPlots), "application/geo+json")}>
                  GeoJSON
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    // demo helper: simulate a field team's counts (±1 tree noise) to show the workflow end-to-end
                    const rng = new Rng(99);
                    for (const p of recountPlots(sv.fieldPlots, a.trees, gsd)) {
                      const r = p.radiusM / gsd;
                      const inPlot = a.trees.filter((t) => (t.x - p.x) ** 2 + (t.y - p.y) ** 2 <= r * r && t.heightM !== null);
                      const mh = inPlot.length ? inPlot.reduce((s, t) => s + (t.heightM as number), 0) / inPlot.length : null;
                      // simulated stem diameters: young dryland trees are stouter than the global H×CD model predicts
                      const dPred = inPlot.length ? inPlot.reduce((s, t) => s + 0.557 * Math.pow((t.heightM as number) * t.crownDiameterM, 0.809), 0) / inPlot.length : null;
                      updateFieldPlot(p.id, {
                        detected: p.detected,
                        fieldCount: Math.max(0, p.detected + Math.round(rng.normal() * 0.8)),
                        fieldMeanHeight: mh !== null ? Number((mh * (1.07 + 0.03 * rng.normal())).toFixed(2)) : null,
                        fieldMeanDbh: dPred !== null ? Number((dPred * (1.8 + 0.12 * rng.normal())).toFixed(1)) : null,
                      });
                    }
                  }}
                  title="Fills the table with simulated field data so you can see how field verification feeds the analysis"
                >
                  Simulate field entry
                </Button>
              </div>
              {fm && fm.plotsWithCounts > 0 && (
                <div className="mt-3 rounded-lg bg-panel2 p-2.5 text-[12px] text-ink2 tabular">
                  Field / detected ratio <b className="text-ink">{fm.meanRatio?.toFixed(3)}</b>
                  {fm.ratioCi && (
                    <span className="text-muted">
                      {" "}
                      (90% CI {fm.ratioCi[0].toFixed(3)}–{fm.ratioCi[1].toFixed(3)})
                    </span>
                  )}
                  {fm.dbhCalibA !== null && (
                    <div className="mt-1.5">
                      DBH-calibrated D model: <b className="text-ink">a = {fm.dbhCalibA.toFixed(3)}</b>
                      <span className="text-muted"> (from {fm.dbhPlots} plot{fm.dbhPlots === 1 ? "" : "s"}, b fixed)</span>
                      <Button size="sm" variant="ghost" className="ml-1" onClick={() => useStore.getState().setCarbon({ dModelA: Number((fm.dbhCalibA as number).toFixed(3)) })}>
                        apply to carbon
                      </Button>
                    </div>
                  )}
                  {fm.heightBias !== null && (
                    <>
                      {" "}
                      · CHM height bias <b className="text-ink">{(fm.heightBias * 100).toFixed(1)}%</b>
                      <Button size="sm" variant="ghost" className="ml-1" onClick={() => useStore.getState().setCarbon({ heightBias: Number((fm.heightBias as number).toFixed(3)) })}>
                        apply to carbon
                      </Button>
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </Card>
      </div>
      <div className="min-h-[420px]">
        <ImageViewer />
      </div>
    </div>
  );
}
