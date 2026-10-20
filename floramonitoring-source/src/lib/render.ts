// Bitmap builders for the image viewer (base layers + crown overlay).

import type { DetectResult, Tree, WorkingRaster } from "./types";

export const HEALTH_RGB: Record<string, [number, number, number]> = {
  healthy: [61, 220, 151],
  watch: [245, 185, 66],
  weak: [242, 104, 92],
  removed: [140, 150, 145],
  manual: [179, 155, 255],
};

function toCanvas(data: Uint8ClampedArray, w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  const img = new ImageData(new Uint8ClampedArray(data.buffer.slice(0)) as Uint8ClampedArray<ArrayBuffer>, w, h);
  ctx.putImageData(img, 0, 0);
  return c;
}

export function rgbCanvas(r: WorkingRaster): HTMLCanvasElement {
  return toCanvas(r.rgba, r.width, r.height);
}

// perceptual green ramp for heights / indices
const RAMP: [number, [number, number, number]][] = [
  [0, [12, 18, 15]],
  [0.15, [24, 52, 60]],
  [0.35, [28, 104, 98]],
  [0.55, [61, 170, 110]],
  [0.75, [163, 230, 53]],
  [1, [250, 240, 140]],
];
export function ramp(t: number): [number, number, number] {
  const x = Math.max(0, Math.min(1, t));
  for (let i = 1; i < RAMP.length; i++) {
    if (x <= RAMP[i][0]) {
      const [x0, c0] = RAMP[i - 1];
      const [x1, c1] = RAMP[i];
      const k = (x - x0) / (x1 - x0);
      return [c0[0] + (c1[0] - c0[0]) * k, c0[1] + (c1[1] - c0[1]) * k, c0[2] + (c1[2] - c0[2]) * k];
    }
  }
  return RAMP[RAMP.length - 1][1];
}

export function heightCanvas(r: WorkingRaster): { canvas: HTMLCanvasElement; max: number } | null {
  const H = r.heightLayer;
  if (!H) return null;
  const n = r.width * r.height;
  // robust max (99.5th percentile)
  const sample: number[] = [];
  const step = Math.max(1, Math.floor(n / 100000));
  for (let i = 0; i < n; i += step) if (Number.isFinite(H[i])) sample.push(H[i]);
  sample.sort((a, b) => a - b);
  const max = Math.max(0.5, sample[Math.floor(sample.length * 0.995)] ?? 1);
  const out = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const v = H[i];
    if (!Number.isFinite(v) || !r.valid[i]) continue;
    const [a, b, c] = ramp(v / max);
    out[4 * i] = a;
    out[4 * i + 1] = b;
    out[4 * i + 2] = c;
    out[4 * i + 3] = 255;
  }
  return { canvas: toCanvas(out, r.width, r.height), max };
}

export function indexCanvas(r: WorkingRaster): HTMLCanvasElement {
  const n = r.width * r.height;
  const out = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    if (!r.valid[i]) continue;
    const R = r.rgba[4 * i];
    const G = r.rgba[4 * i + 1];
    const B = r.rgba[4 * i + 2];
    const s = R + G + B || 1;
    const exg = (2 * G - R - B) / s; // ~[-0.3, 0.8]
    const [a, b, c] = ramp((exg + 0.1) / 0.7);
    out[4 * i] = a;
    out[4 * i + 1] = b;
    out[4 * i + 2] = c;
    out[4 * i + 3] = 255;
  }
  return toCanvas(out, r.width, r.height);
}

/** Crown overlay: translucent fill + solid outline, coloured by health (grey when removed). */
export function crownCanvas(r: WorkingRaster, det: DetectResult, removed: Set<number>): HTMLCanvasElement {
  const { width: w, height: h } = r;
  const L = det.labels;
  const trees: Tree[] = det.trees;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const l = L[i];
      if (!l) continue;
      const t = trees[l - 1];
      if (!t) continue;
      const key = removed.has(t.id) ? "removed" : t.health;
      const c = HEALTH_RGB[key];
      const edge =
        x === 0 || y === 0 || x === w - 1 || y === h - 1 || L[i - 1] !== l || L[i + 1] !== l || L[i - w] !== l || L[i + w] !== l;
      out[4 * i] = c[0];
      out[4 * i + 1] = c[1];
      out[4 * i + 2] = c[2];
      out[4 * i + 3] = edge ? 235 : removed.has(t.id) ? 70 : 38;
    }
  }
  return toCanvas(out, w, h);
}

export function niceScale(metresPerPx: number, targetPx = 110): { m: number; px: number; label: string } {
  const raw = metresPerPx * targetPx;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const steps = [1, 2, 5, 10];
  let m = pow;
  for (const s of steps) if (s * pow <= raw) m = s * pow;
  const label = m >= 1000 ? `${m / 1000} km` : m >= 1 ? `${m} m` : `${Math.round(m * 100)} cm`;
  return { m, px: m / metresPerPx, label };
}
