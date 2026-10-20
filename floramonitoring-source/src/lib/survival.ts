// Survival, stocking and gap analysis against the planting design.

import { bufferConvex, convexHull, rasterizePolygon } from "./cv";
import type { CellStat, PlantingParams, SurvivalResult, Tree } from "./types";

export interface SurvivalInput {
  trees: Tree[];
  width: number;
  height: number;
  gsd: number;
  valid: Uint8Array;
  water: Uint8Array | null;
  params: PlantingParams;
  correction: number; // estimated true / detected
}

export function computeSurvival(inp: SurvivalInput): SurvivalResult {
  const { trees, width: w, height: h, gsd, params: p } = inp;
  const n = w * h;
  const pxHa = (gsd * gsd) / 10000;
  const designDensity = 10000 / Math.max(0.01, p.spacingX * p.spacingY);

  // planted extent: convex hull of trees, buffered by half a spacing
  const pts: number[] = [];
  for (const t of trees) pts.push(t.x, t.y);
  let hull = trees.length >= 3 ? convexHull(pts) : [];
  if (hull.length >= 6) hull = bufferConvex(hull, (Math.max(p.spacingX, p.spacingY) / 2) / gsd);
  let plantable: Uint8Array;
  if (hull.length >= 6) {
    plantable = rasterizePolygon(hull, w, h);
    for (let i = 0; i < n; i++) if (!inp.valid[i] || (inp.water && inp.water[i])) plantable[i] = 0;
  } else {
    plantable = new Uint8Array(n);
    for (let i = 0; i < n; i++) plantable[i] = inp.valid[i] && !(inp.water && inp.water[i]) ? 1 : 0;
  }
  let plantPx = 0;
  let validPx = 0;
  for (let i = 0; i < n; i++) {
    plantPx += plantable[i];
    validPx += inp.valid[i];
  }
  const autoArea = plantPx * pxHa;
  const plantedAreaHa = p.plantedAreaMode === "manual" ? Math.max(0.0001, p.plantedAreaHa) : autoArea;
  const expected = designDensity * plantedAreaHa;
  const observed = trees.length;
  const observedCorrected = observed * inp.correction;

  // stocking grid
  const cs = Math.max(4, Math.round(p.gridCellM / gsd));
  const ni = Math.ceil(h / cs);
  const nj = Math.ceil(w / cs);
  const plantCount = new Float64Array(ni * nj);
  for (let y = 0; y < h; y++) {
    const ci = Math.floor(y / cs);
    for (let x = 0; x < w; x++) if (plantable[y * w + x]) plantCount[ci * nj + Math.floor(x / cs)]++;
  }
  const obs = new Float64Array(ni * nj);
  for (const t of trees) {
    const ci = Math.min(ni - 1, Math.max(0, Math.floor(t.y / cs)));
    const cj = Math.min(nj - 1, Math.max(0, Math.floor(t.x / cs)));
    obs[ci * nj + cj]++;
  }
  // when the planted area is given manually, scale cell expectations to match it
  const areaScale = p.plantedAreaMode === "manual" && autoArea > 0 ? plantedAreaHa / autoArea : 1;
  const cells: CellStat[] = [];
  const cellHa = cs * cs * pxHa;
  let gapCells = 0;
  let gapAreaHa = 0;
  let replant = 0;
  for (let i = 0; i < ni; i++) {
    for (let j = 0; j < nj; j++) {
      const k = i * nj + j;
      const plantableHa = plantCount[k] * pxHa * areaScale;
      if (plantableHa <= 0 && obs[k] === 0) continue;
      const exp = designDensity * plantableHa;
      const ob = obs[k] * inp.correction;
      const ratio = exp > 0 ? ob / exp : 0;
      const gap = plantableHa >= 0.4 * cellHa && ratio < p.gapThreshold;
      if (gap) {
        gapCells++;
        gapAreaHa += plantableHa;
        replant += Math.max(0, Math.round(exp - ob));
      }
      cells.push({
        i,
        j,
        x0: j * cs,
        y0: i * cs,
        x1: Math.min(w, (j + 1) * cs),
        y1: Math.min(h, (i + 1) * cs),
        plantableHa,
        expected: exp,
        observed: obs[k],
        ratio,
        gap,
      });
    }
  }

  return {
    plantedAreaHa,
    surveyedAreaHa: validPx * pxHa,
    designDensity,
    expected,
    observed,
    observedCorrected,
    survivalPct: expected > 0 ? (observed / expected) * 100 : 0,
    survivalPctCorrected: expected > 0 ? (observedCorrected / expected) * 100 : 0,
    stockingPerHa: plantedAreaHa > 0 ? observedCorrected / plantedAreaHa : 0,
    gapCells,
    gapAreaHa,
    replantNeeded: replant,
    cells,
    cellSizePx: cs,
    plantedHull: hull,
    plantableMask: plantable,
  };
}
