import type { TruthBenchmark, Tree } from "./types";

export interface TruthTree {
  id: number;
  x_m: number;
  y_m: number;
  px: number;
  py: number;
  alive: boolean;
  crown_d_m: number;
  height_m: number;
  health: string;
}

export interface TruthFile {
  epsg: number;
  gsd: number;
  date: string;
  planting_spacing_m: [number, number];
  planted: number;
  alive: number;
  trees: TruthTree[];
}

/**
 * Greedy one-to-one matching of points by distance (closest pairs first).
 * a, b: arrays of [x, y] in metres. Returns matched index pairs.
 */
export function matchPoints(a: [number, number][], b: [number, number][], tol: number): [number, number][] {
  const cell = tol;
  const grid = new Map<string, number[]>();
  b.forEach(([x, y], j) => {
    const k = `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
    const arr = grid.get(k);
    if (arr) arr.push(j);
    else grid.set(k, [j]);
  });
  const pairs: { i: number; j: number; d: number }[] = [];
  a.forEach(([x, y], i) => {
    const cx = Math.floor(x / cell);
    const cy = Math.floor(y / cell);
    for (let gy = cy - 1; gy <= cy + 1; gy++)
      for (let gx = cx - 1; gx <= cx + 1; gx++) {
        const arr = grid.get(`${gx},${gy}`);
        if (!arr) continue;
        for (const j of arr) {
          const d = Math.hypot(b[j][0] - x, b[j][1] - y);
          if (d <= tol) pairs.push({ i, j, d });
        }
      }
  });
  pairs.sort((p, q) => p.d - q.d);
  const ua = new Uint8Array(a.length);
  const ub = new Uint8Array(b.length);
  const out: [number, number][] = [];
  for (const p of pairs) {
    if (ua[p.i] || ub[p.j]) continue;
    ua[p.i] = 1;
    ub[p.j] = 1;
    out.push([p.i, p.j]);
  }
  return out;
}

/** Compare detections with synthetic ground truth (demo datasets only). */
export function benchmarkAgainstTruth(trees: Tree[], truth: TruthFile, gsd: number, workingScale: number): TruthBenchmark {
  const alive = truth.trees.filter((t) => t.alive);
  // truth px are in native pixels; convert to metres in the working frame
  const tPts: [number, number][] = alive.map((t) => [(t.px / workingScale) * gsd, (t.py / workingScale) * gsd]);
  const dPts: [number, number][] = trees.map((t) => [t.x * gsd, t.y * gsd]);
  const tol = Math.min(truth.planting_spacing_m[0], truth.planting_spacing_m[1]) * 0.45;
  const pairs = matchPoints(dPts, tPts, tol);
  const tp = pairs.length;
  const fp = trees.length - tp;
  const fn = alive.length - tp;
  let se = 0;
  let sh = 0;
  let bh = 0;
  let nh = 0;
  for (const [i, j] of pairs) {
    se += (trees[i].crownDiameterM - alive[j].crown_d_m) ** 2;
    const hgt = trees[i].heightM;
    if (hgt !== null) {
      sh += (hgt - alive[j].height_m) ** 2;
      bh += hgt - alive[j].height_m;
      nh++;
    }
  }
  const precision = trees.length ? tp / trees.length : 0;
  const recall = alive.length ? tp / alive.length : 0;
  return {
    truthAlive: alive.length,
    detected: trees.length,
    tp,
    fp,
    fn,
    precision,
    recall,
    f1: precision + recall ? (2 * precision * recall) / (precision + recall) : 0,
    countErrorPct: alive.length ? ((trees.length - alive.length) / alive.length) * 100 : 0,
    crownRmseM: tp ? Math.sqrt(se / tp) : null,
    heightRmseM: nh ? Math.sqrt(sh / nh) : null,
    heightBiasM: nh ? bh / nh : null,
  };
}
