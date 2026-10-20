// Image-processing primitives used by the detection pipeline.
// Everything works on flat typed arrays (row-major, width w, height h) so it
// runs fast inside a Web Worker without any dependencies.

const INF = 1e20;

/** 1-D squared Euclidean distance transform (Felzenszwalb & Huttenlocher 2012). */
function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array) {
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const dq = q - v[k];
    d[q] = dq * dq + f[v[k]];
  }
}

/**
 * Exact Euclidean distance (in pixels) from every pixel to the nearest seed
 * pixel, where seeds are pixels with (mask[i] !== 0) === seedIsForeground.
 */
export function distanceTransformMask(mask: Uint8Array, w: number, h: number, seedIsForeground: boolean): Float32Array {
  const n = Math.max(w, h);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  const grid = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) grid[i] = (mask[i] !== 0) === seedIsForeground ? 0 : INF;
  // columns
  for (let x = 0; x < w; x++) {
    let any = false;
    for (let y = 0; y < h; y++) {
      const g = grid[y * w + x];
      f[y] = g;
      if (g === 0) any = true;
    }
    if (!any) continue; // column stays INF; row pass will fill it
    edt1d(f, h, d, v, z);
    for (let y = 0; y < h; y++) grid[y * w + x] = d[y];
  }
  // rows
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const o = y * w;
    let allZero = true;
    for (let x = 0; x < w; x++) {
      const g = grid[o + x];
      f[x] = g;
      if (g !== 0) allZero = false;
    }
    if (allZero) continue; // out already 0
    edt1d(f, w, d, v, z);
    for (let x = 0; x < w; x++) out[o + x] = Math.sqrt(d[x]);
  }
  return out;
}

/** Generic variant with a predicate (slower; kept for flexibility). */
export function distanceTransform(w: number, h: number, isSeed: (i: number) => boolean): Float32Array {
  const m = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) m[i] = isSeed(i) ? 1 : 0;
  return distanceTransformMask(m, w, h, true);
}

/** Distance from each foreground pixel to the nearest background pixel. */
export function distanceInside(mask: Uint8Array, w: number, h: number): Float32Array {
  return distanceTransformMask(mask, w, h, false);
}

/** Distance from each pixel to the nearest foreground pixel. */
export function distanceOutside(mask: Uint8Array, w: number, h: number): Float32Array {
  return distanceTransformMask(mask, w, h, true);
}

/** Integral image of a binary mask. */
function integral(mask: Uint8Array, w: number, h: number): Int32Array {
  const I = new Int32Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += mask[y * w + x] ? 1 : 0;
      I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + row;
    }
  }
  return I;
}

function boxCount(I: Int32Array, w: number, h: number, x: number, y: number, r: number): number {
  const x0 = Math.max(0, x - r);
  const y0 = Math.max(0, y - r);
  const x1 = Math.min(w, x + r + 1);
  const y1 = Math.min(h, y + r + 1);
  const W = w + 1;
  return I[y1 * W + x1] - I[y0 * W + x1] - I[y1 * W + x0] + I[y0 * W + x0];
}

/** Binary erosion. Small radii use a square element (integral image); larger use an exact disk (EDT). */
export function erode(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  if (r <= 0) return mask.slice();
  const out = new Uint8Array(w * h);
  if (r <= 3) {
    const I = integral(mask, w, h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!mask[i]) continue;
        const x0 = Math.max(0, x - r);
        const y0 = Math.max(0, y - r);
        const x1 = Math.min(w, x + r + 1);
        const y1 = Math.min(h, y + r + 1);
        if (boxCount(I, w, h, x, y, r) === (x1 - x0) * (y1 - y0)) out[i] = 1;
      }
    return out;
  }
  const d = distanceInside(mask, w, h);
  for (let i = 0; i < w * h; i++) out[i] = mask[i] && d[i] > r ? 1 : 0;
  return out;
}

/** Binary dilation (square element for small radii, exact disk otherwise). */
export function dilate(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  if (r <= 0) return mask.slice();
  const out = new Uint8Array(w * h);
  if (r <= 3) {
    const I = integral(mask, w, h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) if (boxCount(I, w, h, x, y, r) > 0) out[y * w + x] = 1;
    return out;
  }
  const d = distanceOutside(mask, w, h);
  for (let i = 0; i < w * h; i++) out[i] = d[i] <= r ? 1 : 0;
  return out;
}

export function opening(mask: Uint8Array, w: number, h: number, r: number) {
  return dilate(erode(mask, w, h, r), w, h, r);
}

export function closing(mask: Uint8Array, w: number, h: number, r: number) {
  return erode(dilate(mask, w, h, r), w, h, r);
}

/** Separable box blur with clamped edges (running sums, O(n)). */
export function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  if (r < 1) return src.slice();
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const win = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    const o = y * w;
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += src[o + Math.min(w - 1, Math.max(0, k))];
    for (let x = 0; x < w; x++) {
      tmp[o + x] = acc / win;
      const add = src[o + Math.min(w - 1, x + r + 1)];
      const sub = src[o + Math.max(0, x - r)];
      acc += add - sub;
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += tmp[Math.min(h - 1, Math.max(0, k)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / win;
      const add = tmp[Math.min(h - 1, y + r + 1) * w + x];
      const sub = tmp[Math.max(0, y - r) * w + x];
      acc += add - sub;
    }
  }
  return out;
}

/** Approximate gaussian blur (3 box passes). sigma in px. */
export function gaussianBlur(src: Float32Array, w: number, h: number, sigma: number): Float32Array {
  if (sigma < 0.5) return src.slice();
  // box radius for 3 passes ≈ sigma*sqrt(12/3 ... ) simplified
  const r = Math.max(1, Math.round(Math.sqrt((12 * sigma * sigma) / 3 + 1) / 2));
  return boxBlur(boxBlur(boxBlur(src, w, h, r), w, h, r), w, h, r);
}

/** Otsu threshold over values where valid[i]===1, within [lo, hi]. */
export function otsu(values: Float32Array, valid: Uint8Array, lo: number, hi: number, bins = 256): number {
  const hist = new Float64Array(bins);
  const span = hi - lo || 1;
  let total = 0;
  for (let i = 0; i < values.length; i++) {
    if (!valid[i]) continue;
    const v = values[i];
    if (!(v >= lo && v <= hi)) continue;
    const b = Math.min(bins - 1, Math.floor(((v - lo) / span) * bins));
    hist[b]++;
    total++;
  }
  if (total === 0) return (lo + hi) / 2;
  let sumAll = 0;
  for (let b = 0; b < bins; b++) sumAll += b * hist[b];
  let wB = 0;
  let sumB = 0;
  let best = 0;
  let bestT = 0;
  for (let b = 0; b < bins; b++) {
    wB += hist[b];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += b * hist[b];
    const mB = sumB / wB;
    const mF = (sumAll - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) {
      best = between;
      bestT = b;
    }
  }
  return lo + ((bestT + 1) / bins) * span;
}

/** Approximate percentile of valid values via a histogram. */
export function percentile(values: Float32Array, valid: Uint8Array | null, p: number, lo = -1, hi = 2): number {
  const bins = 2048;
  const hist = new Float64Array(bins);
  const span = hi - lo;
  let total = 0;
  for (let i = 0; i < values.length; i++) {
    if (valid && !valid[i]) continue;
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    const b = Math.min(bins - 1, Math.max(0, Math.floor(((v - lo) / span) * bins)));
    hist[b]++;
    total++;
  }
  const target = (p / 100) * total;
  let acc = 0;
  for (let b = 0; b < bins; b++) {
    acc += hist[b];
    if (acc >= target) return lo + ((b + 0.5) / bins) * span;
  }
  return hi;
}

/** 8-connected component labelling. Returns labels (0 = background) and areas. */
export function labelComponents(mask: Uint8Array, w: number, h: number) {
  const labels = new Int32Array(w * h);
  const stack = new Int32Array(w * h);
  const areas: number[] = [0];
  let next = 0;
  for (let i = 0; i < w * h; i++) {
    if (!mask[i] || labels[i]) continue;
    next++;
    let sp = 0;
    stack[sp++] = i;
    labels[i] = next;
    let area = 0;
    while (sp > 0) {
      const p = stack[--sp];
      area++;
      const px = p % w;
      const py = (p - px) / w;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = py + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const xx = px + dx;
          if (xx < 0 || xx >= w) continue;
          const q = yy * w + xx;
          if (mask[q] && !labels[q]) {
            labels[q] = next;
            stack[sp++] = q;
          }
        }
      }
    }
    areas.push(area);
  }
  return { labels, count: next, areas };
}

/**
 * Peak finding with greedy non-maximum suppression.
 * Candidates are 8-neighbourhood maxima (>=) of f inside mask with f >= minValue.
 * Peaks are accepted in descending order of f and must be >= minDist apart.
 */
export function findPeaks(
  f: Float32Array,
  mask: Uint8Array,
  w: number,
  h: number,
  minDist: number,
  minValue: number,
): number[] {
  const cand: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!mask[i]) continue;
      const v = f[i];
      if (v < minValue) continue;
      let isMax = true;
      for (let dy = -1; dy <= 1 && isMax; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          if (f[yy * w + xx] > v) {
            isMax = false;
            break;
          }
        }
      }
      if (isMax) cand.push(i);
    }
  }
  cand.sort((a, b) => f[b] - f[a]);
  return suppress(cand, w, minDist);
}

/** Greedy NMS on an ordered list of pixel indices using a spatial hash. */
export function suppress(ordered: number[], w: number, minDist: number): number[] {
  const cell = Math.max(1, minDist);
  const grid = new Map<number, number[]>();
  const keep: number[] = [];
  const md2 = minDist * minDist;
  for (const i of ordered) {
    const x = i % w;
    const y = (i - x) / w;
    const cx = Math.floor(x / cell);
    const cy = Math.floor(y / cell);
    let ok = true;
    for (let gy = cy - 1; gy <= cy + 1 && ok; gy++) {
      for (let gx = cx - 1; gx <= cx + 1 && ok; gx++) {
        const bucket = grid.get(gy * 100003 + gx);
        if (!bucket) continue;
        for (const j of bucket) {
          const jx = j % w;
          const jy = (j - jx) / w;
          const dx = jx - x;
          const dy = jy - y;
          if (dx * dx + dy * dy < md2) {
            ok = false;
            break;
          }
        }
      }
    }
    if (ok) {
      keep.push(i);
      const key = cy * 100003 + cx;
      const b = grid.get(key);
      if (b) b.push(i);
      else grid.set(key, [i]);
    }
  }
  return keep;
}

/**
 * Variable-window-filter tree-top detection on a canopy height model
 * (Popescu & Wynne 2004). Window radius (m) = a*h + b, converted to px.
 */
export function vwfTreeTops(
  chm: Float32Array,
  mask: Uint8Array,
  w: number,
  h: number,
  gsd: number,
  a: number,
  b: number,
  minH: number,
): number[] {
  const cand: number[] = [];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const v = chm[i];
      if (!mask[i] || !(v >= minH)) continue;
      if (
        v >= chm[i - 1] && v >= chm[i + 1] && v >= chm[i - w] && v >= chm[i + w] &&
        v >= chm[i - w - 1] && v >= chm[i - w + 1] && v >= chm[i + w - 1] && v >= chm[i + w + 1]
      ) cand.push(i);
    }
  }
  cand.sort((p, q) => chm[q] - chm[p]);
  const accepted = new Uint8Array(w * h);
  const out: number[] = [];
  for (const i of cand) {
    const v = chm[i];
    const r = Math.max(1, (a * v + b) / gsd);
    const ri = Math.ceil(r);
    const r2 = r * r;
    const x = i % w;
    const y = (i - x) / w;
    let ok = true;
    for (let dy = -ri; dy <= ri && ok; dy++) {
      const yy = y + dy;
      if (yy < 0 || yy >= h) continue;
      for (let dx = -ri; dx <= ri; dx++) {
        if (dx * dx + dy * dy > r2) continue;
        const xx = x + dx;
        if (xx < 0 || xx >= w) continue;
        const j = yy * w + xx;
        if (j === i) continue;
        if (chm[j] > v || accepted[j]) {
          ok = false;
          break;
        }
      }
    }
    if (ok) {
      accepted[i] = 1;
      out.push(i);
    }
  }
  return out;
}

/**
 * Marker-controlled watershed by priority flooding (Meyer). `elev` is flooded
 * from low to high; markers are pixel indices that seed labels 1..n.
 * Pixels outside mask stay 0. Uses a bucket queue over quantised elevation.
 */
export function watershed(elev: Float32Array, mask: Uint8Array, markers: number[], w: number, h: number): Int32Array {
  const n = w * h;
  const labels = new Int32Array(n);
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < n; i++) {
    if (!mask[i]) continue;
    const e = elev[i];
    if (e < lo) lo = e;
    if (e > hi) hi = e;
  }
  if (!Number.isFinite(lo)) return labels;
  const L = 2048;
  const span = hi - lo || 1;
  const level = (i: number) => Math.min(L - 1, Math.max(0, Math.floor(((elev[i] - lo) / span) * (L - 1))));
  const head = new Int32Array(L).fill(-1);
  const tail = new Int32Array(L).fill(-1);
  const next = new Int32Array(n).fill(-1);
  const queued = new Uint8Array(n);
  const push = (i: number, lv: number) => {
    queued[i] = 1;
    next[i] = -1;
    if (tail[lv] === -1) {
      head[lv] = i;
      tail[lv] = i;
    } else {
      next[tail[lv]] = i;
      tail[lv] = i;
    }
  };
  markers.forEach((m, k) => {
    if (!mask[m] || labels[m]) return;
    labels[m] = k + 1;
    push(m, level(m));
  });
  let cur = 0;
  while (cur < L) {
    const i = head[cur];
    if (i === -1) {
      cur++;
      continue;
    }
    head[cur] = next[i];
    if (head[cur] === -1) tail[cur] = -1;
    const x = i % w;
    const y = (i - x) / w;
    const lab = labels[i];
    // 8-neighbourhood
    for (let dy = -1; dy <= 1; dy++) {
      const yy = y + dy;
      if (yy < 0 || yy >= h) continue;
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const xx = x + dx;
        if (xx < 0 || xx >= w) continue;
        const q = yy * w + xx;
        if (!mask[q] || queued[q]) continue;
        labels[q] = lab;
        const lv = Math.max(cur, level(q));
        push(q, lv);
        if (lv < cur) cur = lv;
      }
    }
  }
  return labels;
}

/** Andrew's monotone chain convex hull. pts = flat [x0,y0,x1,y1,...]. */
export function convexHull(pts: number[]): number[] {
  const n = pts.length / 2;
  if (n < 3) return pts.slice();
  const idx = Array.from({ length: n }, (_, i) => i);
  idx.sort((a, b) => pts[2 * a] - pts[2 * b] || pts[2 * a + 1] - pts[2 * b + 1]);
  const cross = (o: number, a: number, b: number) =>
    (pts[2 * a] - pts[2 * o]) * (pts[2 * b + 1] - pts[2 * o + 1]) -
    (pts[2 * a + 1] - pts[2 * o + 1]) * (pts[2 * b] - pts[2 * o]);
  const lower: number[] = [];
  for (const i of idx) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], i) <= 0) lower.pop();
    lower.push(i);
  }
  const upper: number[] = [];
  for (let k = idx.length - 1; k >= 0; k--) {
    const i = idx[k];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], i) <= 0) upper.pop();
    upper.push(i);
  }
  upper.pop();
  lower.pop();
  const hull = lower.concat(upper);
  const out: number[] = [];
  for (const i of hull) out.push(pts[2 * i], pts[2 * i + 1]);
  return out;
}

/** Point-in-polygon (ray casting). poly flat [x0,y0,...]. */
export function pointInPolygon(x: number, y: number, poly: number[]): boolean {
  let inside = false;
  const n = poly.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[2 * i];
    const yi = poly[2 * i + 1];
    const xj = poly[2 * j];
    const yj = poly[2 * j + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Rasterise a polygon (working px) into a mask using scanline fill. */
export function rasterizePolygon(poly: number[], w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  const n = poly.length / 2;
  if (n < 3) return out;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    minY = Math.min(minY, poly[2 * i + 1]);
    maxY = Math.max(maxY, poly[2 * i + 1]);
  }
  const y0 = Math.max(0, Math.floor(minY));
  const y1 = Math.min(h - 1, Math.ceil(maxY));
  const xs: number[] = [];
  for (let y = y0; y <= y1; y++) {
    const sy = y + 0.5;
    xs.length = 0;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const yi = poly[2 * i + 1];
      const yj = poly[2 * j + 1];
      if (yi > sy !== yj > sy) {
        const xi = poly[2 * i];
        const xj = poly[2 * j];
        xs.push(xi + ((sy - yi) * (xj - xi)) / (yj - yi));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.max(0, Math.ceil(xs[k] - 0.5));
      const xb = Math.min(w - 1, Math.floor(xs[k + 1] - 0.5));
      for (let x = xa; x <= xb; x++) out[y * w + x] = 1;
    }
  }
  return out;
}

/** Offset a convex polygon outward by d (approximation via vertex normals). */
export function bufferConvex(poly: number[], d: number): number[] {
  const n = poly.length / 2;
  if (n < 3 || d === 0) return poly.slice();
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < n; i++) {
    cx += poly[2 * i];
    cy += poly[2 * i + 1];
  }
  cx /= n;
  cy /= n;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const x = poly[2 * i];
    const y = poly[2 * i + 1];
    const dx = x - cx;
    const dy = y - cy;
    const L = Math.hypot(dx, dy) || 1;
    out.push(x + (dx / L) * d, y + (dy / L) * d);
  }
  return out;
}

/** Sliding-window minimum over a square window (van Herk / Gil-Werman, separable). */
export function minFilter(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const run = (get: (k: number) => number, set: (k: number, v: number) => void, len: number) => {
    const win = 2 * r + 1;
    const g = new Float32Array(len + win);
    const hh = new Float32Array(len + win);
    const val = (k: number) => {
      const kk = k - r;
      if (kk < 0 || kk >= len) return Infinity;
      const v = get(kk);
      return Number.isFinite(v) ? v : Infinity;
    };
    const total = len + 2 * r;
    for (let s = 0; s < total; s += win) {
      const e = Math.min(total, s + win);
      g[s] = val(s);
      for (let k = s + 1; k < e; k++) g[k] = Math.min(g[k - 1], val(k));
      hh[e - 1] = val(e - 1);
      for (let k = e - 2; k >= s; k--) hh[k] = Math.min(hh[k + 1], val(k));
    }
    for (let k = 0; k < len; k++) {
      // window over padded indices [k, k+2r]
      const a = hh[k];
      const b = g[Math.min(total - 1, k + 2 * r)];
      set(k, Math.min(a, b));
    }
  };
  for (let y = 0; y < h; y++) {
    const o = y * w;
    run((k) => src[o + k], (k, v) => (tmp[o + k] = v), w);
  }
  for (let x = 0; x < w; x++) {
    run((k) => tmp[k * w + x], (k, v) => (out[k * w + x] = v), h);
  }
  return out;
}
