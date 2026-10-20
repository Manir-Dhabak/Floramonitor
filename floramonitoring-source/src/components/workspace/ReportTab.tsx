"use client";

import { Download, Printer } from "lucide-react";
import { useMemo } from "react";
import { MODEL_LABELS } from "@/lib/allometry";
import { APP_VERSION, download, surveyFile } from "@/lib/exports";
import { niceScale, rgbCanvas, HEALTH_RGB } from "@/lib/render";
import type { CheckStatus } from "@/lib/types";
import { useStore } from "@/store/useStore";
import { useAnalysis, type SurveyAnalysis } from "./AnalysisContext";
import { indicativeCredits } from "./CarbonTab";
import { Button, Empty, fmt } from "@/components/ui";

function snapshot(a: SurveyAnalysis, showGaps: boolean): string | null {
  if (typeof document === "undefined") return null;
  const r = a.survey.raster;
  const k = Math.min(1, 1400 / Math.max(r.width, r.height));
  const c = document.createElement("canvas");
  c.width = Math.round(r.width * k);
  c.height = Math.round(r.height * k);
  const ctx = c.getContext("2d")!;
  ctx.drawImage(rgbCanvas(r), 0, 0, c.width, c.height);
  ctx.scale(k, k);
  if (showGaps && a.survival) {
    for (const cell of a.survival.cells) {
      if (!cell.gap) continue;
      ctx.fillStyle = "rgba(242,104,92,.35)";
      ctx.fillRect(cell.x0, cell.y0, cell.x1 - cell.x0, cell.y1 - cell.y0);
      ctx.strokeStyle = "rgba(242,104,92,.95)";
      ctx.lineWidth = 2 / k;
      ctx.strokeRect(cell.x0, cell.y0, cell.x1 - cell.x0, cell.y1 - cell.y0);
    }
  }
  if (a.survival && a.survival.plantedHull.length >= 6) {
    ctx.beginPath();
    const h = a.survival.plantedHull;
    for (let i = 0; i < h.length; i += 2) (i ? ctx.lineTo : ctx.moveTo).call(ctx, h[i], h[i + 1]);
    ctx.closePath();
    ctx.strokeStyle = "rgba(92,200,242,.95)";
    ctx.setLineDash([8 / k, 6 / k]);
    ctx.lineWidth = 2 / k;
    ctx.stroke();
    ctx.setLineDash([]);
  }
  for (const t of a.trees) {
    const col = t.source === "manual" ? HEALTH_RGB.manual : HEALTH_RGB[t.health];
    ctx.beginPath();
    ctx.arc(t.x, t.y, 3.2 / k, 0, Math.PI * 2);
    ctx.fillStyle = `rgb(${col.join(",")})`;
    ctx.fill();
    ctx.lineWidth = 1 / k;
    ctx.strokeStyle = "rgba(0,0,0,.7)";
    ctx.stroke();
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  // scale bar + north arrow
  const sb = niceScale(r.gsd / k, 160);
  ctx.fillStyle = "rgba(255,255,255,.88)";
  ctx.fillRect(14, c.height - 46, sb.px + 24, 34);
  ctx.fillStyle = "#111";
  ctx.fillRect(26, c.height - 26, sb.px, 5);
  ctx.font = "600 13px sans-serif";
  ctx.fillText(sb.label, 26, c.height - 31);
  ctx.fillStyle = "rgba(255,255,255,.88)";
  ctx.beginPath();
  ctx.arc(c.width - 34, 34, 20, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#111";
  ctx.beginPath();
  ctx.moveTo(c.width - 34, 18);
  ctx.lineTo(c.width - 41, 40);
  ctx.lineTo(c.width - 27, 40);
  ctx.closePath();
  ctx.fill();
  ctx.font = "700 11px sans-serif";
  ctx.fillText("N", c.width - 38, 50);
  return c.toDataURL("image/jpeg", 0.9);
}

const STATUS_LABEL: Record<CheckStatus, string> = { pass: "PASS", warn: "WARN", fail: "FAIL", info: "INFO" };
const STATUS_COLOR: Record<CheckStatus, string> = { pass: "#0f8a57", warn: "#b7791f", fail: "#c53030", info: "#2b6cb0" };

export function ReportTab() {
  const an = useAnalysis();
  const a = an.active;
  const project = useStore((s) => s.project);
  const planting = useStore((s) => s.planting);
  const cp = useStore((s) => s.carbon);
  const img = useMemo(() => (a ? snapshot(a, true) : null), [a]);
  if (!a?.survival || !a.survey.detection) return <Empty title="Run an analysis to generate the report" />;
  const sv = a.survey;
  const s = a.survival;
  const c = a.carbon;
  const qa = a.qa;
  const det = sv.detection!;
  const dp = sv.detectParams;
  const geo = sv.raster.geo;
  const health = { healthy: 0, watch: 0, weak: 0 };
  for (const t of a.trees) health[t.health]++;
  const credit = c ? indicativeCredits(c.mc.conservative, cp.leakagePct, cp.bufferPct) : null;
  const generated = new Date();

  return (
    <div className="print-root h-full overflow-y-auto pb-10">
      <div className="no-print mx-auto mb-3 flex max-w-[860px] items-center justify-between">
        <div className="text-[12px] text-muted">Printable monitoring report · use “Save as PDF” in the print dialog</div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            icon={<Download size={14} />}
            onClick={() => download(`${sv.meta.name.replace(/\s+/g, "-")}.florascope.json`, surveyFile(sv, { survival: s, carbon: c }), "application/json")}
          >
            Survey file
          </Button>
          <Button variant="primary" icon={<Printer size={14} />} onClick={() => window.print()}>
            Print / Save PDF
          </Button>
        </div>
      </div>
      <article className="report-paper mx-auto max-w-[860px] rounded-xl bg-white px-12 py-10 text-[12.5px] leading-relaxed text-[#1a1f1c] shadow-2xl">
        <header className="report-section flex items-start justify-between border-b-2 border-[#0f8a57] pb-4">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#0f8a57]">FloraScope drone monitoring report</div>
            <h1 className="mt-1 text-[24px] font-bold leading-tight tracking-tight">{project.name}</h1>
            <div className="mt-1 text-[13px] text-[#4a5550]">
              {sv.meta.name} · flight {sv.meta.date} · {sv.meta.site}
            </div>
          </div>
          <div className="text-right text-[11px] text-[#4a5550]">
            <div>{project.developer}</div>
            <div>{project.standard}</div>
            <div>Generated {generated.toISOString().slice(0, 16).replace("T", " ")} UTC</div>
            <div>FloraScope v{APP_VERSION}</div>
          </div>
        </header>

        {sv.meta.demo && (
          <div className="report-section mt-4 rounded-md border border-[#b7791f]/40 bg-[#fff8e6] px-3 py-2 text-[11.5px] text-[#7a5212]">
            Demonstration dataset: imagery and height model are synthetic. Figures illustrate the workflow and must not be used for reporting.
          </div>
        )}

        <section className="report-section mt-5">
          <h2 className="mb-2 text-[15px] font-bold">1. Summary</h2>
          <table className="w-full border-collapse text-[12px]">
            <tbody className="[&_td]:border [&_td]:border-[#dfe5e1] [&_td]:px-2.5 [&_td]:py-1.5">
              <tr>
                <td className="w-1/2 bg-[#f4f7f5]">Live trees (detected → corrected)</td>
                <td>
                  {fmt.int(a.trees.length)} → {fmt.int(s.observedCorrected)} (×{a.correction.toFixed(3)})
                </td>
              </tr>
              <tr>
                <td className="bg-[#f4f7f5]">Planted area · design density</td>
                <td>
                  {s.plantedAreaHa.toFixed(3)} ha ({planting.plantedAreaMode === "auto" ? "estimated from tree extent" : "entered"}) · {fmt.int(s.designDensity)} trees/ha ({planting.spacingX} × {planting.spacingY} m)
                </td>
              </tr>
              <tr>
                <td className="bg-[#f4f7f5]">Survival · stocking</td>
                <td>
                  {s.survivalPctCorrected.toFixed(1)}% of {fmt.int(s.expected)} expected · {fmt.int(s.stockingPerHa)} trees/ha (target {planting.survivalTarget}%)
                </td>
              </tr>
              <tr>
                <td className="bg-[#f4f7f5]">Stocking gaps · replanting</td>
                <td>
                  {s.gapCells} cells / {s.gapAreaHa.toFixed(3)} ha · ≈ {fmt.int(s.replantNeeded)} seedlings
                </td>
              </tr>
              <tr>
                <td className="bg-[#f4f7f5]">Health (within-block greenness)</td>
                <td>
                  healthy {health.healthy} · watch {health.watch} · weak {health.weak}
                </td>
              </tr>
              {c && (
                <>
                  <tr>
                    <td className="bg-[#f4f7f5]">Carbon stock in live trees</td>
                    <td>
                      <b>{fmt.n(c.co2eT, 2)} tCO₂e</b> ({fmt.n(c.co2ePerHa, 2)} t/ha over {c.areaBasisHa.toFixed(2)} ha)
                    </td>
                  </tr>
                  <tr>
                    <td className="bg-[#f4f7f5]">90% CI · uncertainty · deduction</td>
                    <td>
                      {fmt.n(c.mc.p5, 2)}–{fmt.n(c.mc.p95, 2)} t · ±{c.mc.uncertaintyPct.toFixed(1)}% · {c.mc.discountPct.toFixed(1)}% → conservative <b>{fmt.n(c.mc.conservative, 2)} tCO₂e</b>
                    </td>
                  </tr>
                  {credit && (
                    <tr>
                      <td className="bg-[#f4f7f5]">Indicative net (vs zero baseline)</td>
                      <td>
                        {fmt.n(credit.net, 2)} tCO₂e after {cp.leakagePct}% leakage and {cp.bufferPct}% buffer (illustrative only)
                      </td>
                    </tr>
                  )}
                </>
              )}
              {an.change && an.stockChange && (
                <tr>
                  <td className="bg-[#f4f7f5]">Change vs {an.baseline?.survey.meta.date}</td>
                  <td>
                    {an.change.survived} trees re-identified ({an.change.survivalPct.toFixed(1)}%), {an.change.lost} lost, {an.change.recruited} new · ΔCO₂e {fmt.n(an.stockChange.mean, 2)} t (conservative {fmt.n(an.stockChange.conservative, 2)} t)
                  </td>
                </tr>
              )}
              <tr>
                <td className="bg-[#f4f7f5]">Pre-audit readiness</td>
                <td>
                  {an.score.score}/100 — {an.score.pass} pass, {an.score.warn} warn, {an.score.fail} fail
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        {img && (
          <figure className="report-section mt-5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={img} alt="Orthomosaic with detected trees" className="w-full rounded border border-[#dfe5e1]" />
            <figcaption className="mt-1.5 text-[11px] text-[#4a5550]">
              Figure 1. Orthomosaic with detected trees coloured by health (green healthy, amber watch, red weak, violet analyst-added), stocking gaps (red cells) and planted extent (dashed blue).
            </figcaption>
          </figure>
        )}

        <section className="report-section page-break mt-6">
          <h2 className="mb-2 text-[15px] font-bold">2. Inputs and chain of custody</h2>
          <table className="w-full border-collapse text-[11px]">
            <thead>
              <tr className="bg-[#f4f7f5] text-left [&_th]:border [&_th]:border-[#dfe5e1] [&_th]:px-2 [&_th]:py-1">
                <th>Role</th>
                <th>File</th>
                <th>Size</th>
                <th>Raster</th>
                <th>SHA-256</th>
              </tr>
            </thead>
            <tbody className="[&_td]:border [&_td]:border-[#dfe5e1] [&_td]:px-2 [&_td]:py-1">
              {sv.raster.files.map((f) => (
                <tr key={f.name}>
                  <td>{f.role === "ortho" ? "Orthomosaic" : "Height model"}</td>
                  <td className="break-all">{f.name}</td>
                  <td>{(f.sizeBytes / 1e6).toFixed(2)} MB</td>
                  <td>
                    {f.nativeWidth}×{f.nativeHeight}, {f.bands} band, {f.dtype}
                    {f.epsg ? `, EPSG:${f.epsg}` : ""}
                  </td>
                  <td className="break-all font-mono text-[9.5px]">{f.sha256 || "not computed"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[11.5px]">
            Working resolution {sv.raster.width}×{sv.raster.height} px at {(sv.raster.gsd * 100).toFixed(2)} cm/px (native {(sv.raster.nativeGsd * 100).toFixed(2)} cm/px).
            {geo ? ` CRS EPSG:${geo.epsg ?? "unknown"}; tree coordinates reported in this CRS and WGS84.` : " Not georeferenced."} Analyst edits logged: {sv.editLog.length}.
          </p>
        </section>

        <section className="report-section mt-6">
          <h2 className="mb-2 text-[15px] font-bold">3. Methods</h2>
          <p>
            <b>Tree detection.</b> A {dp.segIndex.toUpperCase()} vegetation index was smoothed ({dp.smoothingM} m) and thresholded with Otsu&apos;s method (threshold {det.stats.threshold.toFixed(3)}, hysteresis {Math.round(dp.hysteresisLow * 100)}%)
            {dp.excludeWater ? ", water masked" : ""}. Tree tops were located with{" "}
            {det.stats.markerSource === "height"
              ? `a variable-window filter on the canopy height model (radius = ${dp.vwfA}·H + ${dp.vwfB} m, minimum height ${dp.minHeightM} m; Popescu & Wynne 2004)`
              : "distance-transform peaks of the crown mask"}{" "}
            and crowns delineated by marker-controlled watershed. Crowns smaller than {dp.minCrownDiameterM} m were discarded; crowns larger than {dp.maxCrownDiameterM} m are flagged as possible clusters ({det.stats.clusters}).
            Health is the crown&apos;s mean VARI expressed as a robust z-score within the block (watch &lt; {dp.healthWatchZ}, weak &lt; {dp.healthWeakZ}).
          </p>
          <p className="mt-2">
            <b>Validation.</b> {qa && qa.plots ? `${qa.plots} QA plot(s) covering ${qa.reviewedAreaHa.toFixed(3)} ha were fully reviewed by an analyst: TP ${qa.tp}, FP ${qa.fp}, FN ${qa.fn}; precision ${(100 * (qa.precision ?? 0)).toFixed(1)}%, recall ${(100 * (qa.recall ?? 0)).toFixed(1)}%.` : "No QA plots were reviewed."}{" "}
            {a.field && a.field.plotsWithCounts ? `${a.field.plotsWithCounts} field plot(s) were counted (field/detected ratio ${a.field.meanRatio?.toFixed(3)}).` : ""} Count correction factor applied: ×{a.correction.toFixed(3)}.
          </p>
          <p className="mt-2">
            <b>Survival and stocking.</b> Expected stock = design density × planted area. Stocking was assessed in {planting.gridCellM} m cells over the plantable area (planted extent less water and nodata); cells below {Math.round(planting.gapThreshold * 100)}% of design stocking are reported as gaps.
          </p>
          <p className="mt-2">
            <b>Biomass and carbon.</b> {MODEL_LABELS[cp.model]}. Stem diameter D = {cp.dModelA}·(H·CD)<sup>{cp.dModelB}</sup> ({cp.dModelA === 0.557 && cp.dModelB === 0.809 ? "Jucker et al. 2017 global model" : "site-calibrated"});{" "}
            {cp.model === "komiyama" ? "AGB = 0.251·ρ·D^2.46 and root biomass = 0.199·ρ^0.899·D^2.22 (Komiyama et al. 2005)" : "AGB = 0.0673·(ρD²H)^0.976 (Chave et al. 2014), trees below 1.3 m via Jucker's direct H×CD model; BGB = R·AGB"}
            ; weighted wood density {c?.weightedDensity.toFixed(3) ?? "—"} g/cm³{cp.model !== "komiyama" ? `, R = ${cp.rootShoot}` : ""}, carbon fraction {cp.carbonFraction}, CO₂ = C × 44/12. Heights{" "}
            {cp.heightSource === "layer" && sv.raster.heightLayer ? `from the height model with a +${(cp.heightBias * 100).toFixed(0)}% bias correction` : `assumed at ${cp.assumedHeightM} m`}.
          </p>
          <p className="mt-2">
            <b>Uncertainty.</b> Monte Carlo ({cp.iterations} iterations, fixed seed) propagating wood density (CV {cp.woodDensityCv}), height (CV {cp.heightCv}), allometric systematic (CV {cp.allometrySystematicCv}) and per-tree residual (σ {cp.allometryResidualSigma}) error,
            root:shoot (CV {cp.rootShootCv}) and detection count error. Uncertainty is the 90% CI half-width as % of the mean; where it exceeds 10% the estimate is discounted by U/1.6449×0.4307 (VCS Methodology Requirements v5.0 §2.4).
          </p>
        </section>

        {c && (
          <section className="report-section mt-6">
            <h2 className="mb-2 text-[15px] font-bold">4. Carbon results</h2>
            <table className="w-full border-collapse text-[12px]">
              <tbody className="[&_td]:border [&_td]:border-[#dfe5e1] [&_td]:px-2.5 [&_td]:py-1.5">
                <tr><td className="w-1/2 bg-[#f4f7f5]">Above-ground biomass</td><td>{fmt.n(c.agbT, 3)} t dry matter</td></tr>
                <tr><td className="bg-[#f4f7f5]">Below-ground biomass</td><td>{fmt.n(c.bgbT, 3)} t dry matter</td></tr>
                <tr><td className="bg-[#f4f7f5]">Carbon</td><td>{fmt.n(c.carbonT, 3)} tC</td></tr>
                <tr><td className="bg-[#f4f7f5]">CO₂e (point estimate)</td><td>{fmt.n(c.co2eT, 3)} tCO₂e</td></tr>
                <tr><td className="bg-[#f4f7f5]">Monte Carlo mean · median</td><td>{fmt.n(c.mc.mean, 3)} · {fmt.n(c.mc.median, 3)} tCO₂e</td></tr>
                <tr><td className="bg-[#f4f7f5]">90% CI (P5–P95)</td><td>{fmt.n(c.mc.p5, 3)} – {fmt.n(c.mc.p95, 3)} tCO₂e</td></tr>
                <tr><td className="bg-[#f4f7f5]">Uncertainty · discount</td><td>±{c.mc.uncertaintyPct.toFixed(2)}% · {c.mc.discountPct.toFixed(2)}%</td></tr>
                <tr><td className="bg-[#f4f7f5]">Conservative estimate</td><td><b>{fmt.n(c.mc.conservative, 3)} tCO₂e</b></td></tr>
              </tbody>
            </table>
            {c.notes.length > 0 && (
              <ul className="mt-2 list-disc pl-5 text-[11.5px] text-[#7a5212]">
                {c.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            )}
          </section>
        )}

        <section className="report-section mt-6">
          <h2 className="mb-2 text-[15px] font-bold">5. Pre-audit checklist</h2>
          <table className="w-full border-collapse text-[11px]">
            <tbody className="[&_td]:border [&_td]:border-[#dfe5e1] [&_td]:px-2 [&_td]:py-1 [&_td]:align-top">
              {an.checks.map((ch) => (
                <tr key={ch.id}>
                  <td className="w-14 text-center font-bold" style={{ color: STATUS_COLOR[ch.status] }}>
                    {STATUS_LABEL[ch.status]}
                  </td>
                  <td className="w-52 font-medium">{ch.title}</td>
                  <td className="break-words">
                    {ch.detail}
                    {ch.ref ? <span className="text-[#4a5550]"> [{ch.ref}]</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="report-section mt-6">
          <h2 className="mb-2 text-[15px] font-bold">6. Limitations</h2>
          <ul className="list-disc space-y-1 pl-5">
            <li>RGB crown detection can merge touching crowns and miss suppressed or very small saplings; accuracy must be established per site with QA and field plots.</li>
            <li>Stem diameter is predicted from crown size and height with a global allometry; species- and site-specific equations should be used where the methodology requires them.</li>
            <li>Photogrammetric canopy height models typically under-estimate sapling height; calibrate with field height measurements.</li>
            <li>Health classes are a relative greenness screen within the block, not a diagnosis.</li>
            <li>Indicative removals are illustrative and do not represent verified or issuable credits.</li>
          </ul>
        </section>

        <section className="report-section mt-6 text-[10.5px] text-[#4a5550]">
          <h2 className="mb-1 text-[13px] font-bold text-[#1a1f1c]">References</h2>
          <ol className="list-decimal space-y-0.5 pl-5">
            <li>Chave J. et al. (2014) Improved allometric models to estimate the aboveground biomass of tropical trees. Global Change Biology 20: 3177–3190.</li>
            <li>Jucker T. et al. (2017) Allometric equations for integrating remote sensing imagery into forest monitoring programmes. Global Change Biology 23: 177–190.</li>
            <li>Komiyama A., Poungparn S., Kato S. (2005) Common allometric equations for estimating the tree weight of mangroves. Journal of Tropical Ecology 21: 471–477.</li>
            <li>Popescu S.C., Wynne R.H. (2004) Seeing the trees in the forest: using lidar and multispectral data fusion with local filtering and variable window size for estimating tree height. PE&amp;RS 70: 589–604.</li>
            <li>Otsu N. (1979) A threshold selection method from gray-level histograms. IEEE Trans. SMC 9: 62–66.</li>
            <li>Gitelson A.A. et al. (2002) Novel algorithms for remote estimation of vegetation fraction (VARI). Remote Sensing of Environment 80: 76–87.</li>
            <li>IPCC (2006) Guidelines for National Greenhouse Gas Inventories, Vol. 4, Ch. 4 (Tables 4.3, 4.4).</li>
            <li>Verra. VCS Methodology Requirements v5.0, §2.4; VM0047 Afforestation, Reforestation and Revegetation v1.1.</li>
          </ol>
        </section>
      </article>
    </div>
  );
}
