// Detection validation: photo-interpretation QA plots and field plot counts.

import type { FieldMetrics, FieldPlot, QaMetrics, QaPlot, Tree } from "./types";

const inRect = (t: { x: number; y: number }, p: QaPlot) =>
  t.x >= Math.min(p.x0, p.x1) && t.x <= Math.max(p.x0, p.x1) && t.y >= Math.min(p.y0, p.y1) && t.y <= Math.max(p.y0, p.y1);

/**
 * Within reviewed plots: auto detections kept = TP, auto detections removed by
 * the analyst = FP, manual additions = FN (missed trees).
 */
export function computeQa(autoTrees: Tree[], removed: Set<number>, added: Tree[], plots: QaPlot[], gsd: number): QaMetrics {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let areaPx = 0;
  for (const p of plots) areaPx += Math.abs(p.x1 - p.x0) * Math.abs(p.y1 - p.y0);
  for (const t of autoTrees) {
    if (!plots.some((p) => inRect(t, p))) continue;
    if (removed.has(t.id)) fp++;
    else tp++;
  }
  for (const t of added) if (plots.some((p) => inRect(t, p))) fn++;
  const precision = tp + fp ? tp / (tp + fp) : null;
  const recall = tp + fn ? tp / (tp + fn) : null;
  const f1 = precision !== null && recall !== null && precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : null;
  return {
    plots: plots.length,
    reviewedAreaHa: (areaPx * gsd * gsd) / 10000,
    tp,
    fp,
    fn,
    precision,
    recall,
    f1,
    correction: precision !== null && recall ? precision / recall : null,
  };
}

const T90: Record<number, number> = { 1: 6.314, 2: 2.92, 3: 2.353, 4: 2.132, 5: 2.015, 6: 1.943, 7: 1.895, 8: 1.86, 9: 1.833, 10: 1.812, 15: 1.753, 20: 1.725, 30: 1.697 };
export function t90(df: number): number {
  if (df <= 0) return NaN;
  if (T90[df]) return T90[df];
  if (df > 30) return 1.645;
  const keys = Object.keys(T90).map(Number).sort((a, b) => a - b);
  for (let i = 0; i < keys.length - 1; i++) if (df > keys[i] && df < keys[i + 1]) return T90[keys[i + 1]];
  return 1.645;
}

export function computeFieldMetrics(plots: FieldPlot[], trees: Tree[], gsd: number, dModelB = 0.809, heightMult = 1): FieldMetrics {
  // DBH calibration of the stem-diameter model: a = mean over plots of DBH_field / mean((H·CD)^b)
  const ratios: number[] = [];
  for (const p of plots) {
    if (p.fieldMeanDbh === null || p.fieldMeanDbh === undefined || !(p.fieldMeanDbh > 0)) continue;
    const r = p.radiusM / gsd;
    const inPlot = trees.filter((t) => t.heightM !== null && (t.x - p.x) ** 2 + (t.y - p.y) ** 2 <= r * r);
    if (!inPlot.length) continue;
    const pred = inPlot.reduce((s, t) => s + Math.pow((t.heightM as number) * heightMult * t.crownDiameterM, dModelB), 0) / inPlot.length;
    if (pred > 0) ratios.push(p.fieldMeanDbh / pred);
  }
  const dbhCalibA = ratios.length ? ratios.reduce((a, b) => a + b, 0) / ratios.length : null;
  const withCounts = plots.filter((p) => p.fieldCount !== null && p.fieldCount !== undefined);
  if (!withCounts.length) return { plotsWithCounts: 0, meanRatio: null, ratioCi: null, heightBias: null, dbhCalibA, dbhPlots: ratios.length };
  // ratio-of-sums estimator with plot-level variance
  const det = withCounts.map((p) => Math.max(0, p.detected));
  const fld = withCounts.map((p) => p.fieldCount as number);
  const sd = det.reduce((a, b) => a + b, 0);
  const sf = fld.reduce((a, b) => a + b, 0);
  const ratio = sd > 0 ? sf / sd : null;
  let ci: [number, number] | null = null;
  if (ratio !== null && withCounts.length >= 2) {
    const nn = withCounts.length;
    const mDet = sd / nn;
    let ss = 0;
    for (let i = 0; i < nn; i++) ss += (fld[i] - ratio * det[i]) ** 2;
    const se = Math.sqrt(ss / (nn - 1) / nn) / Math.max(1e-6, mDet);
    const t = t90(nn - 1);
    ci = [ratio - t * se, ratio + t * se];
  }
  // height bias: field mean height vs detected mean height within each plot
  const biases: number[] = [];
  for (const p of withCounts) {
    if (p.fieldMeanHeight === null || p.fieldMeanHeight === undefined) continue;
    const r = p.radiusM / gsd;
    const inPlot = trees.filter((t) => t.heightM !== null && (t.x - p.x) ** 2 + (t.y - p.y) ** 2 <= r * r);
    if (!inPlot.length) continue;
    const mh = inPlot.reduce((a, t) => a + (t.heightM as number), 0) / inPlot.length;
    if (mh > 0) biases.push((p.fieldMeanHeight - mh) / mh);
  }
  return {
    plotsWithCounts: withCounts.length,
    meanRatio: ratio,
    ratioCi: ci,
    heightBias: biases.length ? biases.reduce((a, b) => a + b, 0) / biases.length : null,
    dbhCalibA,
    dbhPlots: ratios.length,
  };
}
