// Multi-date change analysis: match trees between two surveys to measure
// survival, mortality, recruitment (or replanting) and growth per tree.

import { matchPoints } from "./benchmark";
import type { Tree } from "./types";

export interface SurveyPoints {
  trees: Tree[];
  gsd: number;
  date: string;
  epsg: number | null;
  georef: boolean;
}

export interface ChangeResult {
  tolM: number;
  coordBasis: "map" | "image";
  baseCount: number;
  curCount: number;
  survived: number;
  lost: number;
  recruited: number;
  survivalPct: number;
  years: number;
  pairs: [number, number][]; // [baseIndex, curIndex]
  lostIdx: number[];
  newIdx: number[];
  dCrown: { mean: number; median: number; values: number[] };
  dHeight: { mean: number; median: number; values: number[] } | null;
  annualMortalityPct: number;
}

function med(a: number[]) {
  if (!a.length) return 0;
  const s = a.slice().sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function compareSurveys(base: SurveyPoints, cur: SurveyPoints, tolM: number): ChangeResult {
  const useMap = base.georef && cur.georef && base.epsg !== null && base.epsg === cur.epsg;
  const pt = (t: Tree, gsd: number): [number, number] =>
    useMap && t.mx !== null && t.my !== null ? [t.mx, t.my] : [t.x * gsd, t.y * gsd];
  const a = base.trees.map((t) => pt(t, base.gsd));
  const b = cur.trees.map((t) => pt(t, cur.gsd));
  const pairs = matchPoints(a, b, tolM);
  const ma = new Uint8Array(a.length);
  const mb = new Uint8Array(b.length);
  for (const [i, j] of pairs) {
    ma[i] = 1;
    mb[j] = 1;
  }
  const lostIdx: number[] = [];
  const newIdx: number[] = [];
  ma.forEach((v, i) => !v && lostIdx.push(i));
  mb.forEach((v, j) => !v && newIdx.push(j));
  const dC = pairs.map(([i, j]) => cur.trees[j].crownDiameterM - base.trees[i].crownDiameterM);
  const hp = pairs.filter(([i, j]) => base.trees[i].heightM !== null && cur.trees[j].heightM !== null);
  const dH = hp.map(([i, j]) => (cur.trees[j].heightM as number) - (base.trees[i].heightM as number));
  const years = Math.max(1 / 365, (Date.parse(cur.date) - Date.parse(base.date)) / (365.25 * 86400000)) || 1;
  const surv = base.trees.length ? pairs.length / base.trees.length : 0;
  return {
    tolM,
    coordBasis: useMap ? "map" : "image",
    baseCount: base.trees.length,
    curCount: cur.trees.length,
    survived: pairs.length,
    lost: lostIdx.length,
    recruited: newIdx.length,
    survivalPct: surv * 100,
    years,
    pairs,
    lostIdx,
    newIdx,
    dCrown: { mean: dC.length ? dC.reduce((x, y) => x + y, 0) / dC.length : 0, median: med(dC), values: dC },
    dHeight: dH.length ? { mean: dH.reduce((x, y) => x + y, 0) / dH.length, median: med(dH), values: dH } : null,
    annualMortalityPct: (1 - Math.pow(Math.max(1e-9, surv), 1 / years)) * 100,
  };
}
