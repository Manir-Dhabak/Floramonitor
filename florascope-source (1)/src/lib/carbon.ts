// Carbon stock estimation with Monte Carlo uncertainty propagation.
//
// Per tree: CD (from crown segment) + H (from CHM or an assumed value)
//   -> stem diameter D (Jucker 2017) -> AGB (Chave 2014 / Jucker direct / Komiyama 2005)
//   -> BGB (root:shoot ratio or Komiyama root equation) -> C (× carbon fraction) -> CO2e (× 44/12)
//
// Uncertainty sources propagated (all editable):
//   systematic: wood density, CHM height bias/precision, allometric model error,
//               root:shoot ratio, detection count correction (from QA / field plots),
//               sampling error when extrapolating to a larger project area (cell bootstrap)
//   random:     per-tree allometric residuals (aggregated analytically via the CLT
//               for large n, simulated exactly for small n)
// The 90% CI half-width is reported as % of the mean and converted into the
// VCS Methodology Requirements v5.0 §2.4 conservativeness deduction:
//   discount = U / 1.6449 × 0.4307   (applied only when U > 10%; excluded when U > 100%)

import { BREAST_HEIGHT_M, CHAVE14, JUCKER_AGB_ANGIO, JUCKER_D, KOMIYAMA, treeBiomass, weightedWoodDensity } from "./allometry";
import { Rng } from "./rng";
import type { CarbonParams, CarbonResult, CellStat, FieldMetrics, HealthClass, McSummary, QaMetrics, Tree } from "./types";

const CO2_PER_C = 44 / 12;

export interface CarbonInput {
  trees: Tree[];
  params: CarbonParams;
  plantedAreaHa: number;
  cells: CellStat[];
  cellSizePx: number;
  hasHeightLayer: boolean;
  qa: QaMetrics | null;
  field: FieldMetrics | null;
  seed?: number;
}

export interface CarbonOutput {
  result: CarbonResult;
  samples: Float64Array;
}

export function summarise(samples: Float64Array, pointForDiscount?: number): McSummary {
  const s = Array.from(samples).sort((a, b) => a - b);
  const n = s.length;
  const q = (p: number) => {
    if (!n) return 0;
    const idx = (n - 1) * p;
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    return s[lo] + (s[hi] - s[lo]) * (idx - lo);
  };
  const mean = n ? s.reduce((a, b) => a + b, 0) / n : 0;
  const sd = n > 1 ? Math.sqrt(s.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : 0;
  const p5 = q(0.05);
  const p95 = q(0.95);
  const base = Math.abs(mean) > 1e-12 ? Math.abs(mean) : 1;
  const uncertaintyPct = n ? ((p95 - p5) / 2 / base) * 100 : 0;
  const excluded = uncertaintyPct > 100;
  const discountPct = uncertaintyPct > 10 ? (uncertaintyPct / 1.6449) * 0.4307 : 0;
  const ref = pointForDiscount ?? mean;
  const conservative = excluded ? 0 : ref * (1 - discountPct / 100);
  // histogram
  const bins = 32;
  const lo = s[0] ?? 0;
  const hi = s[n - 1] ?? 1;
  const span = hi - lo || 1;
  const hist = Array.from({ length: bins }, (_, i) => ({ x0: lo + (i * span) / bins, x1: lo + ((i + 1) * span) / bins, n: 0 }));
  for (const v of s) hist[Math.min(bins - 1, Math.floor(((v - lo) / span) * bins))].n++;
  return { mean, median: q(0.5), p5, p95, sd, uncertaintyPct, discountPct, conservative, excluded, hist };
}

interface Group {
  s1: number; // Σ exp(base_i)
  s2: number; // Σ exp(2·base_i)
  bases: number[]; // kept for exact simulation of small n
  expH: number; // exponent on the height multiplier
  expRho: number; // exponent on the wood-density multiplier
  root: "ratio" | "none"; // add BGB through root:shoot ratio
  sigma: number;
}

export function runCarbon(inp: CarbonInput): CarbonOutput {
  const p = inp.params;
  const notes: string[] = [];
  const rho = weightedWoodDensity(p.species);
  const useLayer = p.heightSource === "layer" && inp.hasHeightLayer;
  if (p.heightSource === "layer" && !inp.hasHeightLayer) notes.push("No height layer loaded — assumed height used instead.");
  const R = p.rootShoot;

  const groups: Record<string, Group> = {};
  const mk = (key: string, expH: number, expRho: number, root: Group["root"], sigma: number) =>
    (groups[key] ??= { s1: 0, s2: 0, bases: [], expH, expRho, root, sigma });

  const treeCellTreeHeightCv = useLayer ? 0 : 0.3; // per-tree spread when one height is assumed
  const perTree = new Float32Array(inp.trees.length);
  let agbT = 0;
  let bgbT = 0;
  const byHealth: Record<HealthClass, { n: number; co2eT: number }> = {
    healthy: { n: 0, co2eT: 0 },
    watch: { n: 0, co2eT: 0 },
    weak: { n: 0, co2eT: 0 },
  };
  const sizeBins = [
    { label: "< 0.5 m", lo: 0, hi: 0.5 },
    { label: "0.5–1 m", lo: 0.5, hi: 1 },
    { label: "1–2 m", lo: 1, hi: 2 },
    { label: "2–4 m", lo: 2, hi: 4 },
    { label: "≥ 4 m", lo: 4, hi: Infinity },
  ].map((b) => ({ ...b, n: 0, co2eT: 0 }));

  const dA = p.dModelA > 0 ? p.dModelA : JUCKER_D.a;
  const dB = p.dModelB > 0 ? p.dModelB : JUCKER_D.b;
  const lnDA = Math.log(dA) + (JUCKER_D.rse ** 2) / 2;
  let saplings = 0;
  inp.trees.forEach((t, i) => {
    const H = useLayer && t.heightM !== null ? Math.max(0.05, t.heightM * (1 + p.heightBias)) : p.assumedHeightM;
    const CD = Math.max(0.05, t.crownDiameterM);
    const tb = treeBiomass(p.model, H, CD, rho, R, dA, dB);
    const co2Kg = (tb.agbKg + tb.bgbKg) * p.carbonFraction * CO2_PER_C;
    perTree[i] = co2Kg;
    agbT += tb.agbKg / 1000;
    bgbT += tb.bgbKg / 1000;
    byHealth[t.health].n++;
    byHealth[t.health].co2eT += co2Kg / 1000;
    const sb = sizeBins.find((b) => CD >= b.lo && CD < b.hi);
    if (sb) {
      sb.n++;
      sb.co2eT += co2Kg / 1000;
    }
    // log-space bases for the Monte Carlo
    const lnH = Math.log(H);
    const lnCD = Math.log(CD);
    const lnD = lnDA + dB * (lnH + lnCD);
    if (tb.branch === "chave") {
      const eH = CHAVE14.b * (2 * dB + 1);
      const sig = Math.hypot(p.allometryResidualSigma, eH * treeCellTreeHeightCv);
      const g = mk("chave", eH, CHAVE14.b, "ratio", sig);
      const base = Math.log(CHAVE14.a) + CHAVE14.b * (Math.log(rho) + 2 * lnD + lnH);
      push(g, base);
    } else if (tb.branch === "jucker-direct") {
      saplings += H < BREAST_HEIGHT_M ? 1 : 0;
      const eH = JUCKER_AGB_ANGIO.b;
      const sig = Math.hypot(p.allometryResidualSigma, eH * treeCellTreeHeightCv);
      const g = mk("direct", eH, 0, "ratio", sig);
      push(g, Math.log(JUCKER_AGB_ANGIO.a) + JUCKER_AGB_ANGIO.b * (lnH + lnCD) + (JUCKER_AGB_ANGIO.rse ** 2) / 2);
    } else {
      const eHa = KOMIYAMA.agbB * dB;
      const eHb = KOMIYAMA.bgbB * dB;
      const ga = mk("komiA", eHa, 1, "none", Math.hypot(p.allometryResidualSigma, eHa * treeCellTreeHeightCv));
      const gb = mk("komiB", eHb, KOMIYAMA.bgbRho, "none", Math.hypot(p.allometryResidualSigma, eHb * treeCellTreeHeightCv));
      push(ga, Math.log(KOMIYAMA.agbA) + Math.log(rho) + KOMIYAMA.agbB * lnD);
      push(gb, Math.log(KOMIYAMA.bgbA) + KOMIYAMA.bgbRho * Math.log(rho) + KOMIYAMA.bgbB * lnD);
    }
  });
  function push(g: Group, base: number) {
    const e = Math.exp(base);
    g.s1 += e;
    g.s2 += e * e;
    g.bases.push(base);
  }
  if (saplings && p.model === "jucker-chave")
    notes.push(`${saplings} tree(s) below breast height (1.3 m) use Jucker's direct H×CD biomass model.`);
  if (p.model === "komiyama")
    notes.push("Stem diameter is predicted from H×CD with Jucker's global model, which was not fitted on mangroves — validate with field DBH.");

  // count correction factor (detected -> estimated true number of trees)
  let kPoint = 1;
  let kLabel = "none (no validation)";
  const qa = inp.qa;
  const field = inp.field;
  let drawK: (r: Rng) => number = (r) => Math.max(0.05, 1 + p.detectionCvUnvalidated * r.normal());
  if (p.correction === "qa" && qa && qa.tp > 0 && qa.precision !== null && qa.recall !== null) {
    kPoint = qa.precision / Math.max(1e-6, qa.recall);
    kLabel = `QA plots (P=${(qa.precision * 100).toFixed(1)}%, R=${(qa.recall * 100).toFixed(1)}%)`;
    drawK = (r) => r.beta(qa.tp + 1, qa.fp + 1) / Math.max(1e-6, r.beta(qa.tp + 1, qa.fn + 1));
  } else if (p.correction === "field" && field && field.meanRatio !== null && field.ratioCi) {
    kPoint = field.meanRatio;
    const se = (field.ratioCi[1] - field.ratioCi[0]) / 2 / 1.6449;
    kLabel = `Field plot counts (ratio ${field.meanRatio.toFixed(3)})`;
    drawK = (r) => Math.max(0.05, kPoint + se * r.normal());
  } else if (p.correction !== "none") {
    notes.push(`Detection not validated — a ±${Math.round(p.detectionCvUnvalidated * 100)}% (1σ) count uncertainty is assumed.`);
  }

  // area basis and extrapolation
  const planted = Math.max(1e-6, inp.plantedAreaHa);
  const extrapolate = p.projectAreaHa !== null && p.projectAreaHa > planted * 1.001;
  const areaScale = extrapolate ? (p.projectAreaHa as number) / planted : 1;
  // per-cell carbon for the sampling bootstrap
  const cellC: number[] = [];
  const cellA: number[] = [];
  if (extrapolate && inp.cells.length) {
    const idx = new Map<string, number>();
    inp.cells.forEach((c, k) => {
      if (c.plantableHa > 0) {
        idx.set(`${c.i},${c.j}`, cellC.length);
        cellC.push(0);
        cellA.push(c.plantableHa);
      }
      void k;
    });
    inp.trees.forEach((t, i) => {
      const key = `${Math.floor(t.y / inp.cellSizePx)},${Math.floor(t.x / inp.cellSizePx)}`;
      const j = idx.get(key);
      if (j !== undefined) cellC[j] += perTree[i];
    });
    notes.push(`Per-hectare density extrapolated from ${planted.toFixed(2)} ha surveyed to ${(p.projectAreaHa as number).toFixed(2)} ha (cell bootstrap for sampling error).`);
  }
  const sumC = cellC.reduce((a, b) => a + b, 0);
  const sumA = cellA.reduce((a, b) => a + b, 0);

  const toT = (p.carbonFraction * CO2_PER_C) / 1000;
  const groupList = Object.values(groups);
  const pointTotal = (k: number) => {
    let t = 0;
    for (const g of groupList) t += g.s1 * (g.root === "ratio" ? 1 + R : 1);
    return t * toT * k * areaScale;
  };

  // Monte Carlo
  const nTrees = inp.trees.length;
  const iters = Math.max(200, Math.min(p.iterations, 20000));
  const rng = new Rng(inp.seed ?? 20261020);
  const samples = new Float64Array(iters);
  const exact = nTrees < 60;
  const hCv = useLayer ? p.heightCv : p.assumedHeightCv;
  for (let s = 0; s < iters; s++) {
    // fixed draw order keeps surveys paired when the same seed is used
    const mRho = Math.max(0.2, 1 + p.woodDensityCv * rng.normal());
    const mH = Math.max(0.2, 1 + hCv * rng.normal());
    const zm = rng.normal();
    const mModel = Math.exp(p.allometrySystematicCv * zm - (p.allometrySystematicCv ** 2) / 2);
    const mR = Math.max(0, 1 + p.rootShootCv * rng.normal());
    const zRes = rng.normal(); // shared CLT draw (keeps AGB/BGB residual sums coherent)
    let total = 0;
    for (const g of groupList) {
      let A: number;
      if (exact) {
        A = 0;
        for (const b of g.bases) A += Math.exp(b + g.sigma * rng.normal() - (g.sigma * g.sigma) / 2);
      } else {
        const sd = Math.sqrt(g.s2 * (Math.exp(g.sigma * g.sigma) - 1));
        A = Math.max(0, g.s1 + sd * zRes);
      }
      const mult = Math.pow(mH, g.expH) * Math.pow(mRho, g.expRho);
      total += A * mult * (g.root === "ratio" ? 1 + R * mR : 1);
    }
    let boot = 1;
    if (extrapolate && cellC.length >= 5 && sumC > 0) {
      let bc = 0;
      let ba = 0;
      for (let k = 0; k < cellC.length; k++) {
        const j = rng.int(cellC.length);
        bc += cellC[j];
        ba += cellA[j];
      }
      boot = ba > 0 ? bc / ba / (sumC / sumA) : 1;
    }
    const k = drawK(rng);
    samples[s] = total * mModel * toT * k * areaScale * boot;
  }

  const point = pointTotal(kPoint);
  const mc = summarise(samples, point);
  const result: CarbonResult = {
    trees: nTrees,
    agbT: agbT * kPoint * areaScale,
    bgbT: bgbT * kPoint * areaScale,
    carbonT: (agbT + bgbT) * p.carbonFraction * kPoint * areaScale,
    co2eT: point,
    co2ePerHa: point / (extrapolate ? (p.projectAreaHa as number) : planted),
    areaBasisHa: extrapolate ? (p.projectAreaHa as number) : planted,
    extrapolated: extrapolate,
    mc,
    perTreeKgCo2e: perTree,
    byHealth,
    bySize: sizeBins.map((b) => ({ label: b.label, n: b.n, co2eT: b.co2eT })),
    weightedDensity: rho,
    notes,
    correctionFactor: kPoint,
    correctionLabel: kLabel,
  };
  return { result, samples };
}
