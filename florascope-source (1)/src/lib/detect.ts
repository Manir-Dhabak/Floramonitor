// FloraScope individual-tree detection pipeline (runs in a Web Worker).
//
//  1. vegetation index per pixel (ExG / ExG-ExR / VARI / NDVI)
//  2. smoothing + Otsu threshold  -> vegetation mask (optionally height-filtered)
//  3. water masking, morphological clean-up, small-object removal
//  4. tree-top markers: distance-transform peaks (RGB) or variable-window
//     filter on the canopy height model (Popescu & Wynne 2004)
//  5. marker-controlled watershed -> one crown segment per tree
//  6. per-crown metrics: area, crown diameter, height, VARI/NDVI, convex hull
//  7. within-block robust health scoring

import {
  closing,
  convexHull,
  distanceInside,
  findPeaks,
  gaussianBlur,
  labelComponents,
  opening,
  otsu,
  percentile,
  suppress,
  vwfTreeTops,
  watershed,
} from "./cv";
import type { Calibration, DetectParams, DetectResult, GeoInfo, HealthClass, Tree } from "./types";
import { segmentCrowns } from "./segments";
import { mapToLonLat, pixelToMap } from "./geo";

export interface DetectInput {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
  valid: Uint8Array;
  nir: Float32Array | null;
  redRaw: Float32Array | null;
  heightLayer: Float32Array | null;
  gsd: number;
  geo: GeoInfo | null;
  calib?: Calibration | null;
}

export type Progress = (stage: string, pct: number) => void;

export function computeIndex(kind: DetectParams["segIndex"], inp: DetectInput): Float32Array {
  const { width: w, height: h, rgba } = inp;
  const out = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = rgba[4 * i];
    const g = rgba[4 * i + 1];
    const b = rgba[4 * i + 2];
    const s = r + g + b;
    let v = 0;
    switch (kind) {
      case "exg":
        v = s > 0 ? (2 * g - r - b) / s : 0;
        break;
      case "exgr":
        v = s > 0 ? (2 * g - r - b) / s - (1.4 * r - g) / s : 0;
        break;
      case "vari": {
        const den = g + r - b;
        v = Math.abs(den) < 1 ? 0 : Math.max(-1, Math.min(1, (g - r) / den));
        break;
      }
      case "ndvi": {
        if (inp.nir && inp.redRaw) {
          const n = inp.nir[i];
          const rr = inp.redRaw[i];
          v = n + rr > 0 ? (n - rr) / (n + rr) : 0;
        } else v = s > 0 ? (2 * g - r - b) / s : 0;
        break;
      }
    }
    out[i] = v;
  }
  return out;
}

export function variIndex(inp: DetectInput): Float32Array {
  return computeIndex("vari", inp);
}

/** Simple water detector: dark, blue-dominant, non-vegetated pixels. */
export function detectWater(inp: DetectInput, exg: Float32Array): Uint8Array {
  const { width: w, height: h, rgba, valid } = inp;
  const m = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (!valid[i]) continue;
    const r = rgba[4 * i];
    const g = rgba[4 * i + 1];
    const b = rgba[4 * i + 2];
    const bright = (r + g + b) / 3;
    if (b > r * 1.12 && b >= g * 0.95 && bright < 150 && exg[i] < 0.12) m[i] = 1;
  }
  let any = 0;
  for (let i = 0; i < w * h; i++) any += m[i];
  if (any < 20) return new Uint8Array(w * h);
  // clean speckle and keep only sizeable water bodies (> ~4 m²)
  const minPx = Math.max(20, Math.round(4 / (inp.gsd * inp.gsd)));
  const cleaned = opening(m, w, h, Math.max(1, Math.round(0.1 / inp.gsd)));
  const { labels, areas } = labelComponents(cleaned, w, h);
  for (let i = 0; i < w * h; i++) if (cleaned[i] && areas[labels[i]] < minPx) cleaned[i] = 0;
  return cleaned;
}

export function runDetection(inp: DetectInput, p: DetectParams, progress: Progress = () => {}): DetectResult {
  const t0 = performance.now();
  const { width: w, height: h, valid, gsd } = inp;
  const n = w * h;
  const chm = inp.heightLayer;
  const useHeight = !!chm && p.markerSource === "height";

  progress("Computing vegetation index", 5);
  const segRaw = computeIndex(p.segIndex, inp);
  const vari = p.segIndex === "vari" ? segRaw : computeIndex("vari", inp);
  const exg = p.segIndex === "exg" ? segRaw : computeIndex("exg", inp);
  const ndvi = inp.nir && inp.redRaw ? computeIndex("ndvi", inp) : null;
  const seg = gaussianBlur(segRaw, w, h, p.smoothingM / gsd);

  progress("Masking water and nodata", 15);
  const water = p.excludeWater ? detectWater(inp, exg) : new Uint8Array(n);
  const analysable = new Uint8Array(n);
  let validCount = 0;
  let waterCount = 0;
  for (let i = 0; i < n; i++) {
    if (valid[i]) validCount++;
    if (water[i]) waterCount++;
    analysable[i] = valid[i] && !water[i] ? 1 : 0;
  }

  progress("Thresholding vegetation", 22);
  let threshold: number;
  if (p.thresholdMode === "manual") threshold = p.manualThreshold;
  else {
    const lo = percentile(seg, analysable, 0.5, -1, 2);
    const hi = percentile(seg, analysable, 99.5, -1, 2);
    threshold = otsu(seg, analysable, lo, hi) + p.thresholdBias;
  }
  // Hysteresis: pixels above the low threshold are kept when their connected
  // region contains a confident (high-threshold) pixel, or — with a height
  // layer — when they stand above the minimum tree height. This recovers
  // sparse / stressed crowns without admitting soil.
  const low = threshold - Math.abs(threshold) * (1 - p.hysteresisLow);
  const cand = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (!analysable[i] || !(seg[i] > low)) continue;
    if (chm && p.heightFilter) {
      const hv = chm[i];
      if (Number.isFinite(hv) && hv < p.minHeightM * 0.5) continue;
    }
    cand[i] = 1;
  }
  let veg: Uint8Array = new Uint8Array(n);
  {
    const { labels, count } = labelComponents(cand, w, h);
    const strong = new Uint8Array(count + 1);
    for (let i = 0; i < n; i++) {
      const L = labels[i];
      if (!L || strong[L]) continue;
      if (seg[i] > threshold) strong[L] = 1;
      else if (chm && Number.isFinite(chm[i]) && chm[i] >= p.minHeightM) strong[L] = 1;
    }
    for (let i = 0; i < n; i++) if (labels[i] && strong[labels[i]]) veg[i] = 1;
  }

  progress("Cleaning mask", 30);
  const openR = Math.max(1, Math.round((p.minCrownDiameterM * 0.12) / gsd));
  const closeR = Math.max(1, Math.round(0.05 / gsd));
  veg = closing(opening(veg, w, h, openR), w, h, closeR);
  const minAreaPx = Math.max(4, (Math.PI * (p.minCrownDiameterM / 2) ** 2) / (gsd * gsd));
  {
    const { labels, areas } = labelComponents(veg, w, h);
    for (let i = 0; i < n; i++) if (veg[i] && areas[labels[i]] < minAreaPx) veg[i] = 0;
  }
  let vegCount = 0;
  for (let i = 0; i < n; i++) vegCount += veg[i];

  const segMode = p.markerSource === "segments";
  let labels: Int32Array;
  let M: number;
  let markers: number[] | null = null;
  let segInfo: DetectResult["stats"]["segInfo"];
  if (segMode) {
    // dense / mixed canopy: superpixel crowns calibrated on example crowns
    let exgThr = threshold;
    if (p.segIndex !== "exg") {
      const lo = percentile(exg, analysable, 0.5, -1, 2);
      const hi = percentile(exg, analysable, 99.5, -1, 2);
      exgThr = otsu(exg, analysable, lo, hi);
    }
    const so = segmentCrowns(
      { width: w, height: h, rgba: inp.rgba, valid, water, exg, vegThreshold: exgThr, heightLayer: chm, gsd, calib: inp.calib ?? null },
      p,
      progress,
    );
    labels = so.labels;
    M = so.count;
    segInfo = {
      superpixels: so.superpixels,
      regions: so.regions,
      shadows: so.shadowRegions,
      ground: so.rejectedGround,
      soil: so.rejectedSoil,
      small: so.rejectedSmall,
      short: so.rejectedShort,
      mergeT: so.mergeT,
    };
  } else {
  progress("Finding tree tops", 45);
  const dist = gaussianBlur(distanceInside(veg, w, h), w, h, 1);
  const minDistPx = Math.max(2, p.minTreeSpacingM / gsd);
  if (useHeight && chm) {
    const chmClean = new Float32Array(n);
    for (let i = 0; i < n; i++) chmClean[i] = Number.isFinite(chm[i]) ? chm[i] : 0;
    const chmS = gaussianBlur(chmClean, w, h, Math.max(1, 0.06 / gsd));
    // VWF tops, then the same minimum-spacing suppression as the RGB path
    markers = suppress(vwfTreeTops(chmS, veg, w, h, gsd, p.vwfA, p.vwfB, p.minHeightM), w, minDistPx);
    // every separate crown component needs a top: use its highest pixel when it is
    // tall enough (its VWF top may have been suppressed by a neighbour), otherwise
    // drop it as low vegetation (or fall back to its shape centre)
    const comp = labelComponents(veg, w, h);
    const has = new Uint8Array(comp.count + 1);
    for (const m of markers) has[comp.labels[m]] = 1;
    const topH = new Float32Array(comp.count + 1).fill(-Infinity);
    const topI = new Int32Array(comp.count + 1).fill(-1);
    const best = new Int32Array(comp.count + 1).fill(-1);
    for (let i = 0; i < n; i++) {
      const c = comp.labels[i];
      if (!c || has[c]) continue;
      if (chmS[i] > topH[c]) {
        topH[c] = chmS[i];
        topI[c] = i;
      }
      if (best[c] === -1 || dist[i] > dist[best[c]]) best[c] = i;
    }
    const drop = new Uint8Array(comp.count + 1);
    let anyDrop = false;
    for (let c = 1; c <= comp.count; c++) {
      if (has[c] || best[c] === -1) continue;
      if (topH[c] >= p.minHeightM) markers.push(topI[c]);
      else if (p.heightFilter) {
        drop[c] = 1;
        anyDrop = true;
      } else markers.push(best[c]);
    }
    if (anyDrop) for (let i = 0; i < n; i++) if (drop[comp.labels[i]]) veg[i] = 0;
  } else {
    const minPeak = Math.max(1, (p.minCrownDiameterM / 2 / gsd) * 0.5);
    markers = findPeaks(dist, veg, w, h, minDistPx, minPeak);
    // guarantee one marker per component
    const comp = labelComponents(veg, w, h);
    const has = new Uint8Array(comp.count + 1);
    for (const m of markers) has[comp.labels[m]] = 1;
    const best = new Int32Array(comp.count + 1).fill(-1);
    for (let i = 0; i < n; i++) {
      const c = comp.labels[i];
      if (!c || has[c]) continue;
      if (best[c] === -1 || dist[i] > dist[best[c]]) best[c] = i;
    }
    for (let c = 1; c <= comp.count; c++) if (!has[c] && best[c] !== -1) markers.push(best[c]);
  }

  progress("Delineating crowns (watershed)", 60);
  const elev = new Float32Array(n);
  if (useHeight && chm) for (let i = 0; i < n; i++) elev[i] = -(Number.isFinite(chm[i]) ? chm[i] : 0);
  else for (let i = 0; i < n; i++) elev[i] = -dist[i];
  labels = watershed(elev, veg, markers, w, h);
  M = markers.length;
  }

  progress("Measuring crowns", 85);
  const area = new Float64Array(M + 1);
  const sx = new Float64Array(M + 1);
  const sy = new Float64Array(M + 1);
  const sVari = new Float64Array(M + 1);
  const sSeg = new Float64Array(M + 1);
  const sNdvi = new Float64Array(M + 1);
  const maxH = new Float64Array(M + 1).fill(-Infinity);
  const maxHi = new Int32Array(M + 1).fill(-1);
  const bCount = new Int32Array(M + 2);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const L = labels[i];
      if (!L) continue;
      area[L]++;
      sx[L] += x;
      sy[L] += y;
      sVari[L] += vari[i];
      sSeg[L] += segRaw[i];
      if (ndvi) sNdvi[L] += ndvi[i];
      if (chm) {
        const hv = chm[i];
        if (Number.isFinite(hv) && hv > maxH[L]) {
          maxH[L] = hv;
          maxHi[L] = i;
        }
      }
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1 ||
        labels[i - 1] !== L || labels[i + 1] !== L || labels[i - w] !== L || labels[i + w] !== L) bCount[L]++;
    }
  }
  // CSR layout of boundary pixels per label
  const bStart = new Int32Array(M + 2);
  for (let L = 1; L <= M; L++) bStart[L + 1] = bStart[L] + bCount[L];
  const bPts = new Int32Array(bStart[M + 1] * 2);
  const bFill = bStart.slice();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const L = labels[i];
      if (!L) continue;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1 ||
        labels[i - 1] !== L || labels[i + 1] !== L || labels[i - w] !== L || labels[i + w] !== L) {
        const k = bFill[L]++;
        bPts[2 * k] = x;
        bPts[2 * k + 1] = y;
      }
    }
  }

  progress("Scoring tree health", 88);
  const keep = new Int32Array(M + 1); // old label -> new label
  const trees: Tree[] = [];
  let removedSmall = 0;
  let clusters = 0;
  const px2 = gsd * gsd;
  for (let L = 1; L <= M; L++) {
    const a = area[L];
    if (a < (segMode ? 1 : minAreaPx)) {
      if (a > 0) removedSmall++;
      continue;
    }
    const crownAreaM2 = a * px2;
    const crownDiameterM = 2 * Math.sqrt(crownAreaM2 / Math.PI);
    let x = sx[L] / a;
    let y = sy[L] / a;
    if (useHeight && markers) {
      const m = markers[L - 1];
      x = m % w;
      y = (m - x) / w;
    } else if (segMode && maxHi[L] >= 0) {
      x = maxHi[L] % w;
      y = (maxHi[L] - x) / w;
    }
    const pts: number[] = [];
    for (let k = bStart[L]; k < bStart[L + 1]; k++) pts.push(bPts[2 * k] + 0.5, bPts[2 * k + 1] + 0.5);
    const hull = convexHull(pts);
    const cluster = crownDiameterM > p.maxCrownDiameterM;
    if (cluster) clusters++;
    trees.push({
      id: trees.length + 1,
      x,
      y,
      mx: null,
      my: null,
      lon: null,
      lat: null,
      crownAreaM2,
      crownDiameterM,
      heightM: chm && Number.isFinite(maxH[L]) ? Math.max(0, maxH[L]) : null,
      vari: sVari[L] / a,
      ndvi: ndvi ? sNdvi[L] / a : null,
      segIndexMean: sSeg[L] / a,
      healthZ: 0,
      health: "healthy",
      hull,
      source: "auto",
      cluster,
    });
    keep[L] = trees.length;
  }
  for (let i = 0; i < n; i++) if (labels[i]) labels[i] = keep[labels[i]];

  scoreHealth(trees, p);

  if (inp.geo) georeference(trees, inp.geo);

  progress("Done", 100);
  return {
    trees,
    labels,
    water,
    vegMask: veg,
    stats: {
      threshold,
      vegFraction: validCount ? vegCount / validCount : 0,
      waterFraction: validCount ? waterCount / validCount : 0,
      validFraction: validCount / n,
      segments: M,
      removedSmall,
      clusters,
      runtimeMs: performance.now() - t0,
      markerSource: segMode ? "segments" : useHeight ? "height" : "rgb",
      segInfo,
    },
  };
}

function median(a: number[]): number {
  if (!a.length) return 0;
  const s = a.slice().sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Within-block robust z-score of greenness (VARI), or absolute NDVI classes. */
export function scoreHealth(trees: Tree[], p: DetectParams) {
  const auto = trees.filter((t) => t.source === "auto");
  if (!auto.length) return;
  const useNdvi = auto.every((t) => t.ndvi !== null);
  const vals = auto.map((t) => (useNdvi ? (t.ndvi as number) : t.vari));
  const med = median(vals);
  // MAD floor stops homogeneous blocks from flagging trivial differences
  const mad = Math.max(useNdvi ? 0.03 : 0.04, median(vals.map((v) => Math.abs(v - med))) * 1.4826);
  const medArea = median(auto.map((t) => t.crownAreaM2));
  for (const t of trees) {
    if (t.source !== "auto") continue;
    const v = useNdvi ? (t.ndvi as number) : t.vari;
    t.healthZ = (v - med) / mad;
    let cls: HealthClass = "healthy";
    if (useNdvi) {
      if (v < p.ndviWeak) cls = "weak";
      else if (v < p.ndviWatch) cls = "watch";
    } else {
      if (t.healthZ < p.healthWeakZ) cls = "weak";
      else if (t.healthZ < p.healthWatchZ) cls = "watch";
    }
    if (cls === "healthy" && t.crownAreaM2 < 0.3 * medArea && t.healthZ < -0.5) cls = "watch";
    t.health = cls;
  }
}

export function georeference(trees: Tree[], geo: GeoInfo) {
  for (const t of trees) {
    const [mx, my] = pixelToMap(geo, t.x, t.y);
    t.mx = mx;
    t.my = my;
    const ll = mapToLonLat(geo, mx, my);
    if (ll) {
      t.lon = ll[0];
      t.lat = ll[1];
    }
  }
}
