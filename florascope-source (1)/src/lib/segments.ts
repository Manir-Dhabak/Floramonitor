// Dense / mixed-canopy crown segmentation.
//
// When crowns touch (agroforestry, natural regeneration, palms among shrubs),
// distance-transform peaks split one big vegetation blob into many fake trees.
// This mode instead:
//   1. over-segments the image into colour-coherent superpixels (SLIC, Achanta et al. 2012)
//      sized from the analyst's smallest calibration crown
//   2. merges neighbouring superpixels when their colour / texture is similar and
//      the boundary between them is not a shadow seam, never growing a region beyond
//      the largest calibration crown ("structure and colour change" define crowns)
//   3. absorbs fragments smaller than a plausible crown and shadow holes inside crowns
//   4. drops shadows, bare soil and — when "not a tree" samples were drawn — regions
//      that look like the analyst's ground samples (pixel LDA averaged per region)
// Each surviving region is one tree.

import { boxBlur } from "./cv";
import type { Calibration, DetectParams } from "./types";

export interface SegmentInput {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
  valid: Uint8Array;
  water: Uint8Array;
  exg: Float32Array;
  vegThreshold: number;
  heightLayer: Float32Array | null;
  gsd: number;
  calib: Calibration | null;
}

export interface SegmentOutput {
  labels: Int32Array; // 1..count per tree region, 0 = not a tree
  count: number;
  superpixels: number;
  regions: number;
  shadowRegions: number;
  rejectedGround: number;
  rejectedSoil: number;
  rejectedSmall: number;
  rejectedShort: number;
}

// ---------------------------------------------------------------- colour

const SRGB_LIN = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  SRGB_LIN[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
const fLab = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);

export function rgbaToLab(rgba: Uint8ClampedArray, n: number) {
  const L = new Float32Array(n);
  const A = new Float32Array(n);
  const B = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const r = SRGB_LIN[rgba[4 * i]];
    const g = SRGB_LIN[rgba[4 * i + 1]];
    const b = SRGB_LIN[rgba[4 * i + 2]];
    const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
    const fx = fLab(x);
    const fy = fLab(y);
    const fz = fLab(z);
    L[i] = 116 * fy - 16;
    A[i] = 500 * (fx - fy);
    B[i] = 200 * (fy - fz);
  }
  return { L, A, B };
}

// ---------------------------------------------------------------- SLIC

export function slic(
  L: Float32Array,
  A: Float32Array,
  B: Float32Array,
  valid: Uint8Array,
  w: number,
  h: number,
  step: number,
  compactness: number,
  iters: number,
): { labels: Int32Array; count: number } {
  const n = w * h;
  const cx: number[] = [];
  const cy: number[] = [];
  const cl: number[] = [];
  const ca: number[] = [];
  const cb: number[] = [];
  const half = step / 2;
  for (let y = half; y < h; y += step)
    for (let x = half; x < w; x += step) {
      const i = Math.min(h - 1, Math.round(y)) * w + Math.min(w - 1, Math.round(x));
      if (!valid[i]) continue;
      cx.push(x);
      cy.push(y);
      cl.push(L[i]);
      ca.push(A[i]);
      cb.push(B[i]);
    }
  const K = cx.length;
  const labels = new Int32Array(n).fill(-1);
  const dist = new Float32Array(n);
  const wS = (compactness / step) ** 2;
  const sums = new Float64Array(K * 6);
  for (let it = 0; it < iters; it++) {
    dist.fill(Infinity);
    for (let k = 0; k < K; k++) {
      const x0 = Math.max(0, Math.floor(cx[k] - step));
      const x1 = Math.min(w - 1, Math.ceil(cx[k] + step));
      const y0 = Math.max(0, Math.floor(cy[k] - step));
      const y1 = Math.min(h - 1, Math.ceil(cy[k] + step));
      const kl = cl[k];
      const ka = ca[k];
      const kb = cb[k];
      const kx = cx[k];
      const ky = cy[k];
      for (let y = y0; y <= y1; y++) {
        const dy = (y - ky) * (y - ky);
        let i = y * w + x0;
        for (let x = x0; x <= x1; x++, i++) {
          if (!valid[i]) continue;
          const dl = L[i] - kl;
          const da = A[i] - ka;
          const db = B[i] - kb;
          const dx = x - kx;
          const D = dl * dl + da * da + db * db + wS * (dx * dx + dy);
          if (D < dist[i]) {
            dist[i] = D;
            labels[i] = k;
          }
        }
      }
    }
    sums.fill(0);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const k = labels[i];
        if (k < 0) continue;
        const o = k * 6;
        sums[o] += x;
        sums[o + 1] += y;
        sums[o + 2] += L[i];
        sums[o + 3] += A[i];
        sums[o + 4] += B[i];
        sums[o + 5]++;
      }
    for (let k = 0; k < K; k++) {
      const o = k * 6;
      const c = sums[o + 5];
      if (!c) continue;
      cx[k] = sums[o] / c;
      cy[k] = sums[o + 1] / c;
      cl[k] = sums[o + 2] / c;
      ca[k] = sums[o + 3] / c;
      cb[k] = sums[o + 4] / c;
    }
  }
  // enforce connectivity: relabel 4-connected components, absorb tiny ones
  const out = new Int32Array(n).fill(-1);
  const stack = new Int32Array(n);
  const comp: number[] = [];
  const minSize = Math.max(4, Math.floor((step * step) / 4));
  let next = 0;
  for (let s = 0; s < n; s++) {
    if (out[s] !== -1 || labels[s] < 0) continue;
    const lab = labels[s];
    let sp = 0;
    stack[sp++] = s;
    out[s] = next;
    comp.length = 0;
    let adjLabel = -1;
    while (sp) {
      const p = stack[--sp];
      comp.push(p);
      const px = p % w;
      const py = (p - px) / w;
      const nbrs = [px > 0 ? p - 1 : -1, px < w - 1 ? p + 1 : -1, py > 0 ? p - w : -1, py < h - 1 ? p + w : -1];
      for (const q of nbrs) {
        if (q < 0) continue;
        if (labels[q] === lab && out[q] === -1) {
          out[q] = next;
          stack[sp++] = q;
        } else if (out[q] !== -1 && out[q] !== next && adjLabel === -1) adjLabel = out[q];
      }
    }
    if (comp.length < minSize && adjLabel !== -1) {
      for (const p of comp) out[p] = adjLabel;
    } else next++;
  }
  return { labels: out, count: next };
}

// ---------------------------------------------------------------- LDA

/** Two-class Fisher LDA. Returns projection w and midpoint/scale for a logistic score. */
export function fitLda(pos: number[][], neg: number[][]): { w: number[]; mid: number; scale: number } | null {
  const d = pos[0]?.length ?? 0;
  if (pos.length < 8 || neg.length < 8 || !d) return null;
  const mean = (X: number[][]) => X[0].map((_, j) => X.reduce((s, r) => s + r[j], 0) / X.length);
  const mp = mean(pos);
  const mn = mean(neg);
  const S = Array.from({ length: d }, () => new Array(d).fill(0));
  for (const [X, m] of [
    [pos, mp],
    [neg, mn],
  ] as const)
    for (const r of X)
      for (let i = 0; i < d; i++) for (let j = 0; j < d; j++) S[i][j] += (r[i] - m[i]) * (r[j] - m[j]);
  const dof = pos.length + neg.length - 2;
  let tr = 0;
  for (let i = 0; i < d; i++) tr += S[i][i] / dof;
  for (let i = 0; i < d; i++) for (let j = 0; j < d; j++) S[i][j] = S[i][j] / dof + (i === j ? 1e-3 * tr : 0);
  const rhs = mp.map((v, i) => v - mn[i]);
  const w = solve(S, rhs);
  if (!w) return null;
  const proj = (r: number[]) => r.reduce((s, v, i) => s + v * w[i], 0);
  const med = (a: number[]) => {
    const s = a.slice().sort((x, y) => x - y);
    return s[s.length >> 1];
  };
  const pm = med(pos.map(proj));
  const nm = med(neg.map(proj));
  if (!(pm > nm)) return null;
  return { w, mid: (pm + nm) / 2, scale: (pm - nm) / 4 };
}

function solve(M: number[][], b: number[]): number[] | null {
  const n = b.length;
  const a = M.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    if (Math.abs(a[p][c]) < 1e-12) return null;
    [a[c], a[p]] = [a[p], a[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = a[r][c] / a[c][c];
      for (let k = c; k <= n; k++) a[r][k] -= f * a[c][k];
    }
  }
  return a.map((r, i) => r[n] / r[i]);
}

// ---------------------------------------------------------------- heap

class MinHeap {
  private d: number[] = [];
  private a: number[] = [];
  private b: number[] = [];
  private va: number[] = [];
  private vb: number[] = [];
  get size() {
    return this.d.length;
  }
  push(d: number, a: number, b: number, va: number, vb: number) {
    const arr = [this.d, this.a, this.b, this.va, this.vb];
    const vals = [d, a, b, va, vb];
    for (let k = 0; k < 5; k++) arr[k].push(vals[k]);
    let i = this.d.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.d[p] <= this.d[i]) break;
      this.swap(i, p);
      i = p;
    }
  }
  pop(): [number, number, number, number, number] | null {
    if (!this.d.length) return null;
    const top: [number, number, number, number, number] = [this.d[0], this.a[0], this.b[0], this.va[0], this.vb[0]];
    const last = this.d.length - 1;
    this.swap(0, last);
    for (const arr of [this.d, this.a, this.b, this.va, this.vb]) arr.pop();
    let i = 0;
    const n = this.d.length;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      if (l < n && this.d[l] < this.d[m]) m = l;
      if (r < n && this.d[r] < this.d[m]) m = r;
      if (m === i) break;
      this.swap(i, m);
      i = m;
    }
    return top;
  }
  private swap(i: number, j: number) {
    for (const arr of [this.d, this.a, this.b, this.va, this.vb]) {
      const t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
  }
}

// ---------------------------------------------------------------- main

const F = 5; // L, a, b, texture, chroma

interface Base {
  K: number;
  cnt: Float64Array;
  sum: Float64Array;
  sExg: Float64Array;
  maxH: Float64Array;
  nb: Map<number, [number, number]>[];
  probSum: Float64Array | null; // per superpixel, LDA "tree" probability sum
  probCnt: Float64Array | null;
  coverCrown: Map<number, number>[]; // per crown sample: superpixel -> pixels inside sample
  coverGround: Map<number, number>[];
  sampleArea: { crowns: number[]; ground: number[] };
}

interface Solution {
  T: number;
  treeLabel: Int32Array; // per superpixel root
  parent: Int32Array;
  count: number;
  regions: number;
  shadowRegions: number;
  rejectedGround: number;
  rejectedSoil: number;
  rejectedSmall: number;
  rejectedShort: number;
  meanTreeArea: number;
}

export function segmentCrowns(inp: SegmentInput, p: DetectParams, progress: (s: string, pct: number) => void): SegmentOutput & { mergeT: number } {
  const { width: w, height: h, gsd } = inp;
  const n = w * h;
  const rMinPx = Math.max(3, p.minCrownDiameterM / 2 / gsd);
  const rMaxPx = Math.max(rMinPx * 1.5, p.maxCrownDiameterM / 2 / gsd);
  const amin = Math.PI * (0.7 * rMinPx) ** 2;
  const amax = Math.PI * rMaxPx ** 2;
  const step = Math.max(5, Math.round(0.7 * rMinPx));
  const calib = inp.calib;

  progress("Colour space & texture", 32);
  const { L, A, B } = rgbaToLab(inp.rgba, n);
  const tr = Math.max(2, Math.round(0.06 * rMinPx));
  const mL = boxBlur(L, w, h, tr);
  const L2 = new Float32Array(n);
  for (let i = 0; i < n; i++) L2[i] = L[i] * L[i];
  const mL2 = boxBlur(L2, w, h, tr);
  const T = new Float32Array(n);
  const C = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    T[i] = Math.sqrt(Math.max(0, mL2[i] - mL[i] * mL[i]));
    C[i] = Math.sqrt(A[i] * A[i] + B[i] * B[i]);
  }
  const usable = new Uint8Array(n);
  for (let i = 0; i < n; i++) usable[i] = inp.valid[i] && !inp.water[i] ? 1 : 0;

  progress("Superpixels (SLIC)", 42);
  const sp = slic(L, A, B, usable, w, h, step, 10, 6);
  const K = sp.count;

  progress("Region statistics", 52);
  const base: Base = {
    K,
    cnt: new Float64Array(K),
    sum: new Float64Array(K * F),
    sExg: new Float64Array(K),
    maxH: new Float64Array(K).fill(-Infinity),
    nb: Array.from({ length: K }, () => new Map()),
    probSum: null,
    probCnt: null,
    coverCrown: [],
    coverGround: [],
    sampleArea: { crowns: [], ground: [] },
  };
  for (let i = 0; i < n; i++) {
    const k = sp.labels[i];
    if (k < 0) continue;
    base.cnt[k]++;
    const o = k * F;
    base.sum[o] += L[i];
    base.sum[o + 1] += A[i];
    base.sum[o + 2] += B[i];
    base.sum[o + 3] += T[i];
    base.sum[o + 4] += C[i];
    base.sExg[k] += inp.exg[i];
    const hv = inp.heightLayer ? inp.heightLayer[i] : NaN;
    if (Number.isFinite(hv) && hv > base.maxH[k]) base.maxH[k] = hv;
  }
  const addEdge = (a: number, b: number, v: number) => {
    if (a < 0 || b < 0 || a === b) return;
    const e = base.nb[a].get(b);
    if (e) {
      e[0] += v;
      e[1]++;
    } else {
      const ne: [number, number] = [v, 1];
      base.nb[a].set(b, ne);
      base.nb[b].set(a, ne);
    }
  };
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const a = sp.labels[i];
      if (a < 0) continue;
      if (x < w - 1) {
        const b = sp.labels[i + 1];
        if (b !== a) addEdge(a, b, Math.min(L[i], L[i + 1]));
      }
      if (y < h - 1) {
        const b = sp.labels[i + w];
        if (b !== a) addEdge(a, b, Math.min(L[i], L[i + w]));
      }
    }

  // shadow cut-offs adapt to the darkest crown the analyst drew (crowns in shade)
  const circleMean = (c: { x: number; y: number; r: number }, arr: Float32Array) => {
    let s = 0;
    let k = 0;
    for (let y = Math.max(0, Math.floor(c.y - c.r)); y <= Math.min(h - 1, Math.ceil(c.y + c.r)); y += 2)
      for (let x = Math.max(0, Math.floor(c.x - c.r)); x <= Math.min(w - 1, Math.ceil(c.x + c.r)); x += 2)
        if ((x - c.x) ** 2 + (y - c.y) ** 2 <= c.r * c.r) {
          s += arr[y * w + x];
          k++;
        }
    return k ? s / k : NaN;
  };
  let shadowL = 30;
  if (calib && calib.crowns.length) {
    const minL = Math.min(...calib.crowns.map((c) => circleMean(c, L)).filter(Number.isFinite));
    if (Number.isFinite(minL)) shadowL = Math.max(8, Math.min(30, 0.6 * minL));
  }
  const deepL = Math.min(14, shadowL);
  const pixShadow = (i: number) => L[i] < deepL || (L[i] < shadowL && C[i] < 12);

  // calibration samples: coverage per superpixel and the colour/texture discriminant
  if (calib) {
    const cover = (c: { x: number; y: number; r: number }) => {
      const m = new Map<number, number>();
      let tot = 0;
      for (let y = Math.max(0, Math.floor(c.y - c.r)); y <= Math.min(h - 1, Math.ceil(c.y + c.r)); y++)
        for (let x = Math.max(0, Math.floor(c.x - c.r)); x <= Math.min(w - 1, Math.ceil(c.x + c.r)); x++) {
          if ((x - c.x) ** 2 + (y - c.y) ** 2 > c.r * c.r) continue;
          const k = sp.labels[y * w + x];
          if (k < 0) continue;
          m.set(k, (m.get(k) ?? 0) + 1);
          tot++;
        }
      return { m, tot };
    };
    for (const c of calib.crowns) {
      const r = cover(c);
      base.coverCrown.push(r.m);
      base.sampleArea.crowns.push(r.tot);
    }
    for (const c of calib.ground) {
      const r = cover(c);
      base.coverGround.push(r.m);
      base.sampleArea.ground.push(r.tot);
    }
    if (calib.crowns.length && calib.ground.length) {
      const sample = (circles: Calibration["crowns"]) => {
        const out: number[][] = [];
        for (const c of circles) {
          const stepS = Math.max(1, Math.floor(c.r / 25));
          for (let y = Math.max(0, Math.floor(c.y - c.r)); y <= Math.min(h - 1, Math.ceil(c.y + c.r)); y += stepS)
            for (let x = Math.max(0, Math.floor(c.x - c.r)); x <= Math.min(w - 1, Math.ceil(c.x + c.r)); x += stepS) {
              if ((x - c.x) ** 2 + (y - c.y) ** 2 > c.r * c.r) continue;
              const i = y * w + x;
              if (!usable[i] || pixShadow(i)) continue;
              out.push([L[i], A[i], B[i], T[i], C[i]]);
            }
        }
        return out;
      };
      const lda = fitLda(sample(calib.crowns), sample(calib.ground));
      if (lda) {
        base.probSum = new Float64Array(K);
        base.probCnt = new Float64Array(K);
        for (let i = 0; i < n; i++) {
          const k = sp.labels[i];
          if (k < 0) continue;
          const z = (L[i] * lda.w[0] + A[i] * lda.w[1] + B[i] * lda.w[2] + T[i] * lda.w[3] + C[i] * lda.w[4] - lda.mid) / lda.scale;
          base.probSum[k] += 1 / (1 + Math.exp(-z));
          base.probCnt[k]++;
        }
      }
    }
  }

  // target crown size for automatic merge strength: geometric mean of drawn extremes
  let targetArea = Math.PI * Math.sqrt(rMinPx * rMaxPx) ** 2;
  if (calib && calib.crowns.length) {
    const rs = calib.crowns.map((c) => c.r);
    const rg = Math.sqrt(Math.min(...rs) * Math.max(...rs));
    targetArea = Math.PI * rg * rg;
  }

  const solve = (T0: number): Solution => {
    const parent = new Int32Array(K);
    for (let k = 0; k < K; k++) parent[k] = k;
    const ver = new Int32Array(K);
    const cnt = base.cnt.slice();
    const sum = base.sum.slice();
    const sExg = base.sExg.slice();
    const maxH = base.maxH.slice();
    const nb: Map<number, [number, number]>[] = Array.from({ length: K }, () => new Map());
    for (let a = 0; a < K; a++)
      for (const [b, e] of base.nb[a])
        if (a < b) {
          const ne: [number, number] = [e[0], e[1]];
          nb[a].set(b, ne);
          nb[b].set(a, ne);
        }
    const find = (a: number) => {
      while (parent[a] !== a) {
        parent[a] = parent[parent[a]];
        a = parent[a];
      }
      return a;
    };
    const mean = (a: number, j: number) => sum[a * F + j] / cnt[a];
    const isShadow = (a: number) => {
      const l = mean(a, 0);
      return l < deepL || (l < shadowL && mean(a, 4) < 12);
    };
    const dist = (a: number, b: number) => {
      const e = nb[a].get(b);
      if (!e) return Infinity;
      const dL = mean(a, 0) - mean(b, 0);
      const dA = mean(a, 1) - mean(b, 1);
      const dB = mean(a, 2) - mean(b, 2);
      const dT = mean(a, 3) - mean(b, 3);
      const d = Math.sqrt(0.35 * dL * dL + 1.5 * dA * dA + dB * dB + dT * dT);
      const seam = Math.max(0, Math.min(mean(a, 0), mean(b, 0)) - e[0] / e[1] - 3);
      return d + 0.5 * seam;
    };
    const merge = (a: number, b: number) => {
      parent[b] = a;
      cnt[a] += cnt[b];
      for (let j = 0; j < F; j++) sum[a * F + j] += sum[b * F + j];
      sExg[a] += sExg[b];
      if (maxH[b] > maxH[a]) maxH[a] = maxH[b];
      for (const [c, e] of nb[b]) {
        if (c === a) continue;
        const ea = nb[a].get(c);
        if (ea) {
          ea[0] += e[0];
          ea[1] += e[1];
        } else {
          nb[a].set(c, e);
          nb[c].set(a, e);
        }
        nb[c].delete(b);
      }
      nb[a].delete(b);
      nb[b] = new Map();
      ver[a]++;
      ver[b]++;
    };
    const heap = new MinHeap();
    for (let a = 0; a < K; a++) {
      if (isShadow(a)) continue;
      for (const b of nb[a].keys()) if (a < b && !isShadow(b)) heap.push(dist(a, b), a, b, 0, 0);
    }
    for (;;) {
      const top = heap.pop();
      if (!top) break;
      const [d, a0, b0, va, vb] = top;
      if (d > T0) break;
      if (parent[a0] !== a0 || parent[b0] !== b0 || ver[a0] !== va || ver[b0] !== vb) continue;
      if (cnt[a0] + cnt[b0] > amax) continue;
      let a = a0;
      let b = b0;
      if (cnt[b] > cnt[a]) [a, b] = [b, a];
      merge(a, b);
      if (isShadow(a)) continue;
      for (const c of nb[a].keys()) if (!isShadow(c)) heap.push(dist(a, c), a, c, ver[a], ver[c]);
    }
    for (let pass = 0; pass < 4; pass++) {
      const small: number[] = [];
      for (let a = 0; a < K; a++) if (parent[a] === a && cnt[a] > 0 && !isShadow(a) && cnt[a] < amin) small.push(a);
      small.sort((x, y) => cnt[x] - cnt[y]);
      let changed = 0;
      for (const a of small) {
        if (parent[a] !== a) continue;
        let best = -1;
        let bd = Infinity;
        for (const c of nb[a].keys()) {
          if (isShadow(c) || cnt[a] + cnt[c] > amax) continue;
          const d = dist(a, c);
          if (d < bd) {
            bd = d;
            best = c;
          }
        }
        if (best >= 0 && bd < T0 * 2.2) {
          merge(best, a);
          changed++;
        }
      }
      if (!changed) break;
    }
    for (let a = 0; a < K; a++) {
      if (parent[a] !== a || !isShadow(a) || cnt[a] >= amin) continue;
      if (nb[a].size === 1) {
        const c = nb[a].keys().next().value as number;
        if (!isShadow(c)) merge(c, a);
      }
    }
    // region-level aggregates of sample coverage and discriminant
    const forced = new Int8Array(K);
    const agg = (covers: Map<number, number>[], areas: number[], sign: 1 | -1) =>
      covers.forEach((m, si) => {
        const per = new Map<number, number>();
        for (const [k, v] of m) {
          const r = find(k);
          per.set(r, (per.get(r) ?? 0) + v);
        }
        for (const [r, v] of per) if (v / Math.max(1, areas[si]) > 0.25 || v / cnt[r] > 0.5) forced[r] = sign;
      });
    agg(base.coverGround, base.sampleArea.ground, -1);
    agg(base.coverCrown, base.sampleArea.crowns, 1);
    let prob: Float64Array | null = null;
    if (base.probSum && base.probCnt) {
      prob = new Float64Array(K);
      const pc = new Float64Array(K);
      for (let k = 0; k < K; k++) {
        const r = find(k);
        prob[r] += base.probSum[k];
        pc[r] += base.probCnt[k];
      }
      for (let k = 0; k < K; k++) if (pc[k]) prob[k] /= pc[k];
    }
    const treeLabel = new Int32Array(K);
    const out: Solution = {
      T: T0,
      treeLabel,
      parent,
      count: 0,
      regions: 0,
      shadowRegions: 0,
      rejectedGround: 0,
      rejectedSoil: 0,
      rejectedSmall: 0,
      rejectedShort: 0,
      meanTreeArea: 0,
    };
    let areaSum = 0;
    for (let a = 0; a < K; a++) {
      if (parent[a] !== a || !cnt[a]) continue;
      out.regions++;
      let tree = false;
      if (forced[a] === 1) tree = true;
      else if (forced[a] === -1) out.rejectedGround++;
      else if (isShadow(a)) out.shadowRegions++;
      else if (cnt[a] < amin) out.rejectedSmall++;
      else if (sExg[a] / cnt[a] < Math.min(0.06, inp.vegThreshold * 0.5)) out.rejectedSoil++;
      else if (prob && prob[a] < 0.4) out.rejectedGround++;
      else if (inp.heightLayer && p.heightFilter && Number.isFinite(maxH[a]) && maxH[a] < p.minHeightM) out.rejectedShort++;
      else tree = true;
      if (tree) {
        treeLabel[a] = ++out.count;
        areaSum += cnt[a];
      }
    }
    out.meanTreeArea = out.count ? areaSum / out.count : 0;
    // make parent fully compressed for the caller
    for (let k = 0; k < K; k++) parent[k] = find(k);
    return out;
  };

  progress("Merging into crowns", 62);
  let sol: Solution;
  if (p.mergeStrength > 0) sol = solve(p.mergeStrength);
  else {
    // automatic: pick the merge strength whose average crown matches the calibration crowns
    const cands = [6, 8, 10, 12, 14, 17, 20, 24];
    let best: Solution | null = null;
    let bestErr = Infinity;
    cands.forEach((t, i) => {
      progress(`Merging into crowns (auto ${i + 1}/${cands.length})`, 62 + i * 3);
      const s = solve(t);
      if (!s.count) return;
      const err = Math.abs(Math.log(s.meanTreeArea / targetArea));
      if (err < bestErr) {
        bestErr = err;
        best = s;
      }
    });
    sol = best ?? solve(10);
  }

  progress("Labelling crowns", 80);
  const labels = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const k = sp.labels[i];
    if (k >= 0) labels[i] = sol.treeLabel[sol.parent[k]];
  }
  return {
    labels,
    count: sol.count,
    superpixels: K,
    regions: sol.regions,
    shadowRegions: sol.shadowRegions,
    rejectedGround: sol.rejectedGround,
    rejectedSoil: sol.rejectedSoil,
    rejectedSmall: sol.rejectedSmall,
    rejectedShort: sol.rejectedShort,
    mergeT: sol.T,
  };
}
