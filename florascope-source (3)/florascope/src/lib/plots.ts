// Field verification plot planner: spatially balanced random circular plots
// inside the planted area, for ground-truthing counts and heights.

import { pixelToLonLat, pixelToMap } from "./geo";
import { Rng } from "./rng";
import type { FieldPlot, GeoInfo, Tree } from "./types";

export function planFieldPlots(opts: {
  n: number;
  radiusM: number;
  plantable: Uint8Array;
  width: number;
  height: number;
  gsd: number;
  trees: Tree[];
  geo: GeoInfo | null;
  seed?: number;
}): FieldPlot[] {
  const { n, radiusM, plantable, width: w, height: h, gsd, trees, geo } = opts;
  const rng = new Rng(opts.seed ?? 7);
  const r = radiusM / gsd;
  const inside = (x: number, y: number) => {
    // centre + 8 points on the circle must be plantable
    for (let k = 0; k <= 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const xx = Math.round(k === 8 ? x : x + Math.cos(a) * r);
      const yy = Math.round(k === 8 ? y : y + Math.sin(a) * r);
      if (xx < 0 || yy < 0 || xx >= w || yy >= h || !plantable[yy * w + xx]) return false;
    }
    return true;
  };
  // spatial balance: stratify the bounding box of the plantable area into ~n strata
  let minX = w;
  let minY = h;
  let maxX = 0;
  let maxY = 0;
  for (let y = 0; y < h; y += 4)
    for (let x = 0; x < w; x += 4)
      if (plantable[y * w + x]) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
  if (maxX <= minX || maxY <= minY) return [];
  const cols = Math.max(1, Math.round(Math.sqrt((n * (maxX - minX)) / (maxY - minY))));
  const rows = Math.max(1, Math.ceil(n / cols));
  const sw = (maxX - minX) / cols;
  const sh = (maxY - minY) / rows;
  const out: FieldPlot[] = [];
  const minSep = 2.2 * r;
  const strata: [number, number][] = [];
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) strata.push([i, j]);
  // shuffle strata so that when n < rows*cols the selection stays balanced
  for (let k = strata.length - 1; k > 0; k--) {
    const q = rng.int(k + 1);
    [strata[k], strata[q]] = [strata[q], strata[k]];
  }
  const tryPlace = (x0: number, y0: number, ww: number, hh: number) => {
    for (let attempt = 0; attempt < 60; attempt++) {
      const x = x0 + rng.uniform() * ww;
      const y = y0 + rng.uniform() * hh;
      if (!inside(x, y)) continue;
      if (out.some((p) => (p.x - x) ** 2 + (p.y - y) ** 2 < minSep * minSep)) continue;
      return [x, y] as [number, number];
    }
    return null;
  };
  for (const [i, j] of strata) {
    if (out.length >= n) break;
    const pos = tryPlace(minX + j * sw, minY + i * sh, sw, sh);
    if (pos) out.push(makePlot(out.length + 1, pos[0], pos[1]));
  }
  // top up anywhere if some strata failed
  let guard = 0;
  while (out.length < n && guard++ < 50) {
    const pos = tryPlace(minX, minY, maxX - minX, maxY - minY);
    if (pos) out.push(makePlot(out.length + 1, pos[0], pos[1]));
  }
  return out;

  function makePlot(k: number, x: number, y: number): FieldPlot {
    const detected = trees.filter((t) => (t.x - x) ** 2 + (t.y - y) ** 2 <= r * r).length;
    const ll = pixelToLonLat(geo, x, y);
    const m = geo ? pixelToMap(geo, x, y) : null;
    return {
      id: `P${String(k).padStart(2, "0")}`,
      x,
      y,
      radiusM,
      lon: ll ? ll[0] : null,
      lat: ll ? ll[1] : null,
      mx: m ? m[0] : null,
      my: m ? m[1] : null,
      detected,
      fieldCount: null,
      fieldMeanHeight: null,
      fieldMeanDbh: null,
    };
  }
}

export function recountPlots(plots: FieldPlot[], trees: Tree[], gsd: number): FieldPlot[] {
  return plots.map((p) => {
    const r = p.radiusM / gsd;
    return { ...p, detected: trees.filter((t) => (t.x - p.x) ** 2 + (t.y - p.y) ** 2 <= r * r).length };
  });
}
