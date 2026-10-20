// Pre-audit checks: flags the things a VVB is likely to query before they
// become findings. These are internal-QA heuristics, not a substitute for the
// applicable methodology's requirements.

import type { ChangeResult } from "./change";
import type { AuditCheck, CarbonParams, CarbonResult, FieldMetrics, PlantingParams, QaMetrics, Survey, SurvivalResult } from "./types";

export interface AuditInput {
  survey: Survey;
  survival: SurvivalResult | null;
  carbon: CarbonResult | null;
  qa: QaMetrics | null;
  field: FieldMetrics | null;
  change: ChangeResult | null;
  planting: PlantingParams;
  carbonParams: CarbonParams;
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

export function runPreAudit(a: AuditInput): AuditCheck[] {
  const c: AuditCheck[] = [];
  const r = a.survey.raster;
  const det = a.survey.detection;

  // --- Data & traceability
  const hashed = r.files.every((f) => f.sha256 && f.sha256.length === 64);
  c.push({
    id: "hash",
    group: "Data & traceability",
    title: "Input files fingerprinted (SHA-256)",
    status: hashed ? "pass" : "warn",
    detail: hashed
      ? r.files.map((f) => `${f.name}: ${f.sha256.slice(0, 16)}…`).join(" · ")
      : "One or more inputs were too large to hash in the browser; record checksums externally.",
  });
  c.push({
    id: "date",
    group: "Data & traceability",
    title: "Acquisition date recorded",
    status: /^\d{4}-\d{2}-\d{2}$/.test(a.survey.meta.date) ? "pass" : "warn",
    detail: a.survey.meta.date ? `Flight date ${a.survey.meta.date}.` : "Enter the flight date — monitoring reports must tie each measurement to a date.",
  });
  const geo = r.geo;
  c.push({
    id: "georef",
    group: "Data & traceability",
    title: "Georeferenced tree positions",
    status: geo && geo.proj4 ? "pass" : geo ? "warn" : "fail",
    detail:
      geo && geo.proj4
        ? `EPSG:${geo.epsg ?? "?"} — every tree carries map and WGS84 coordinates (usable as GPS tree IDs).`
        : geo
          ? "Geotransform found but CRS unknown — set the EPSG code so trees get lat/lon."
          : "No georeferencing. VM0047 census-based projects identify trees by GPS coordinates or physical markers.",
    ref: "VM0047 v1.1 (census-based approach)",
  });
  if (geo) {
    c.push({
      id: "crs",
      group: "Data & traceability",
      title: "Projected (metric) CRS",
      status: geo.isGeographic ? "warn" : "pass",
      detail: geo.isGeographic
        ? "Imagery is in geographic degrees; crown areas use an approximate metre conversion. Export in UTM for measurement."
        : `Pixel size ${(r.gsd * 100).toFixed(1)} cm in a metric CRS.`,
    });
  }
  const validPct = det ? det.stats.validFraction : 1;
  c.push({
    id: "coverage",
    group: "Data & traceability",
    title: "Image coverage (nodata)",
    status: validPct > 0.95 ? "pass" : validPct > 0.8 ? "warn" : "fail",
    detail: `${pct(validPct)} of the image area contains data.`,
  });

  // --- Measurement adequacy
  const minCrownPx = (a.survey.detectParams.minCrownDiameterM / r.gsd);
  c.push({
    id: "gsd",
    group: "Measurement adequacy",
    title: "Resolution vs smallest crown",
    status: minCrownPx >= 8 ? "pass" : minCrownPx >= 4 ? "warn" : "fail",
    detail: `Smallest crown (${a.survey.detectParams.minCrownDiameterM} m) spans ${minCrownPx.toFixed(1)} px at ${(r.gsd * 100).toFixed(1)} cm GSD. Aim for ≥ 8 px (fly lower for young saplings).`,
  });
  const hasH = !!r.heightLayer;
  c.push({
    id: "height",
    group: "Measurement adequacy",
    title: "Tree height measured",
    status: hasH && a.carbonParams.heightSource === "layer" ? "pass" : "warn",
    detail: hasH
      ? `Height from ${r.heightMode === "dsm" ? "DSM (ground estimated by moving minimum)" : "canopy height model"}.`
      : `No height layer — biomass uses an assumed ${a.carbonParams.assumedHeightM} m height (±${Math.round(a.carbonParams.assumedHeightCv * 100)}%). Export a DSM/CHM from photogrammetry.`,
  });
  if (det && det.stats.vegFraction > 0.45 && det.stats.markerSource === "rgb") {
    c.push({
      id: "dense",
      group: "Measurement adequacy",
      title: "Dense canopy handled",
      status: "warn",
      detail: `${Math.round(det.stats.vegFraction * 100)}% continuous green cover with the crown-shape detector — touching crowns are likely split into several trees. Calibrate crowns (Imagery → Calibrate) or load a height model.`,
    });
  } else if (det && det.stats.markerSource === "segments") {
    const cal = a.survey.calibration;
    c.push({
      id: "dense",
      group: "Measurement adequacy",
      title: "Crown segmentation calibrated",
      status: cal.crowns.length >= 2 ? "pass" : "warn",
      detail: cal.crowns.length >= 2
        ? `${cal.crowns.length} example crowns and ${cal.ground.length} not-tree samples define crown size and appearance.`
        : "Crown-segments mode without at least two calibration crowns (smallest and largest) — draw them in Imagery → Calibrate.",
    });
  }
  if (det && det.stats.clusters > 0) {
    c.push({
      id: "clusters",
      group: "Measurement adequacy",
      title: "Merged crowns",
      status: det.stats.clusters / Math.max(1, det.trees.length) > 0.05 ? "warn" : "info",
      detail: `${det.stats.clusters} segment(s) exceed the maximum crown size and may contain several trees — review or switch to canopy-cover mode for closed stands.`,
    });
  }

  // --- Detection accuracy
  const qa = a.qa;
  const reviewed = qa ? qa.tp + qa.fp + qa.fn : 0;
  c.push({
    id: "qa-effort",
    group: "Detection accuracy",
    title: "Detection validated on reviewed plots",
    status: qa && qa.plots >= 3 && reviewed >= 100 ? "pass" : qa && qa.plots > 0 ? "warn" : "fail",
    detail: qa && qa.plots
      ? `${qa.plots} QA plot(s), ${reviewed} trees reviewed (${qa.reviewedAreaHa.toFixed(3)} ha). Target ≥ 3 plots and ≥ 100 trees.`
      : "No QA plots yet. In the QA tab, draw plots, fix every miss/false detection inside them.",
  });
  if (qa && qa.precision !== null && qa.recall !== null) {
    const ok = qa.precision >= 0.9 && qa.recall >= 0.9;
    const mid = qa.precision >= 0.8 && qa.recall >= 0.8;
    c.push({
      id: "qa-acc",
      group: "Detection accuracy",
      title: "Precision & recall ≥ 90%",
      status: ok ? "pass" : mid ? "warn" : "fail",
      detail: `Precision ${pct(qa.precision)}, recall ${pct(qa.recall)}, F1 ${pct(qa.f1 ?? 0)}. Count correction factor ${(qa.correction ?? 1).toFixed(3)}.`,
    });
  }
  const fm = a.field;
  c.push({
    id: "field",
    group: "Detection accuracy",
    title: "Field verification plots",
    status: fm && fm.plotsWithCounts >= 5 ? "pass" : fm && fm.plotsWithCounts > 0 ? "warn" : "info",
    detail: fm && fm.plotsWithCounts
      ? `${fm.plotsWithCounts} plot(s) with field counts; field/detected ratio ${fm.meanRatio?.toFixed(3)}${fm.ratioCi ? ` (90% CI ${fm.ratioCi[0].toFixed(2)}–${fm.ratioCi[1].toFixed(2)})` : ""}${fm.heightBias !== null ? `; height bias ${(fm.heightBias * 100).toFixed(1)}%` : ""}.`
      : "Generate field plots (QA tab), have the team count and measure them, and enter the results.",
  });

  // --- Survival & stocking
  const s = a.survival;
  if (s) {
    const target = a.planting.survivalTarget;
    c.push({
      id: "survival",
      group: "Survival & stocking",
      title: `Survival ≥ project target (${target}%)`,
      status: s.survivalPctCorrected >= target ? "pass" : s.survivalPctCorrected >= target - 10 ? "warn" : "fail",
      detail: `${s.survivalPctCorrected.toFixed(1)}% (${Math.round(s.observedCorrected)} of ${Math.round(s.expected)} expected at ${Math.round(s.designDensity)} trees/ha over ${s.plantedAreaHa.toFixed(2)} ha).`,
    });
    const gapShare = s.plantedAreaHa ? s.gapAreaHa / s.plantedAreaHa : 0;
    c.push({
      id: "gaps",
      group: "Survival & stocking",
      title: "Stocking gaps",
      status: gapShare < 0.05 ? "pass" : gapShare < 0.15 ? "warn" : "fail",
      detail: `${s.gapCells} gap cell(s) = ${s.gapAreaHa.toFixed(3)} ha (${pct(gapShare)} of planted area); ~${s.replantNeeded} seedlings to replant.`,
    });
    if (a.planting.plantedAreaMode === "auto")
      c.push({
        id: "area",
        group: "Survival & stocking",
        title: "Planted area source",
        status: "warn",
        detail: "Planted area is estimated from the detected trees' extent. Enter the surveyed project-boundary area for reporting.",
      });
  }

  // --- Carbon & uncertainty
  const cr = a.carbon;
  if (cr) {
    const u = cr.mc.uncertaintyPct;
    c.push({
      id: "uncertainty",
      group: "Carbon & uncertainty",
      title: "Uncertainty (90% CI half-width ≤ 10%)",
      status: u <= 10 ? "pass" : u <= 100 ? "warn" : "fail",
      detail:
        u <= 10
          ? `±${u.toFixed(1)}% — no conservativeness deduction required.`
          : u <= 100
            ? `±${u.toFixed(1)}% → deduction ${cr.mc.discountPct.toFixed(1)}% (U/1.6449×0.4307). Largest levers: QA plots, field heights, species wood densities.`
            : `±${u.toFixed(1)}% exceeds 100% — removals would be excluded from crediting.`,
      ref: "VCS Methodology Requirements v5.0 §2.4",
    });
    const placeholder = a.carbonParams.species.some((sp) => sp.share > 0 && /placeholder|verify/i.test(sp.note ?? ""));
    c.push({
      id: "wd",
      group: "Carbon & uncertainty",
      title: "Species wood densities sourced",
      status: placeholder ? "warn" : "pass",
      detail: placeholder
        ? "Some species use placeholder wood densities. Replace with GWDD or site-measured values and cite the source."
        : `Weighted wood density ${cr.weightedDensity.toFixed(3)} g/cm³.`,
    });
    const calibrated = a.carbonParams.dModelA !== 0.557 || a.carbonParams.dModelB !== 0.809;
    c.push({
      id: "allometry",
      group: "Carbon & uncertainty",
      title: "Stem-diameter model calibrated with field DBH",
      status: calibrated ? "pass" : "warn",
      detail: calibrated
        ? `Site-calibrated D = ${a.carbonParams.dModelA}·(H·CD)^${a.carbonParams.dModelB}${a.field?.dbhPlots ? ` (field DBH from ${a.field.dbhPlots} plots)` : ""}.`
        : a.carbonParams.model === "komiyama"
          ? "D is predicted with Jucker's global (terrestrial) H×CD model. Enter mean DBH for field plots (QA tab) to calibrate it for mangroves."
          : "D is predicted with Jucker's global H×CD model, which is fitted on larger trees and can under-predict young plantation stems. Enter mean DBH for field plots (QA tab) to calibrate.",
    });
  }

  // --- Monitoring continuity
  c.push({
    id: "change",
    group: "Monitoring continuity",
    title: "Linked to a previous survey",
    status: a.change ? "pass" : "info",
    detail: a.change
      ? `${a.change.survived} trees re-identified (${a.change.survivalPct.toFixed(1)}% survival over ${a.change.years.toFixed(2)} yr, matched on ${a.change.coordBasis} coordinates within ${a.change.tolM} m).`
      : "Load the previous flight in the Change tab to track individual-tree survival and growth.",
  });
  const edits = a.survey.editLog.length;
  c.push({
    id: "audit-trail",
    group: "Monitoring continuity",
    title: "Analyst edits logged",
    status: "info",
    detail: `${edits} timestamped edit(s) recorded and exported with the survey file.`,
  });
  return c;
}

export function auditScore(checks: AuditCheck[]): { score: number; pass: number; warn: number; fail: number } {
  const scored = checks.filter((c) => c.status !== "info");
  const pass = scored.filter((c) => c.status === "pass").length;
  const warn = scored.filter((c) => c.status === "warn").length;
  const fail = scored.filter((c) => c.status === "fail").length;
  const score = scored.length ? Math.round(((pass + warn * 0.5) / scored.length) * 100) : 0;
  return { score, pass, warn, fail };
}
