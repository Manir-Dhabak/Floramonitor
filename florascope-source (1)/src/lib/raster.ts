// Raster loading: GeoTIFF orthomosaics / height models (environment-agnostic),
// plus helpers to align a height layer to the working grid.

import { fromArrayBuffer } from "geotiff";
import type { GeoInfo } from "./types";
import { gsdMetres, isGeographicEpsg, mapToPixel, pixelToMap, proj4ForEpsg } from "./geo";

export interface BandMap {
  r: number;
  g: number;
  b: number;
  nir: number | null;
  alpha: number | null;
}

export interface LoadedOrtho {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
  valid: Uint8Array;
  nir: Float32Array | null;
  redRaw: Float32Array | null;
  geo: GeoInfo | null;
  nativeWidth: number;
  nativeHeight: number;
  bands: number;
  dtype: string;
  epsg: number | null;
  scale: number;
  bandMap: BandMap;
  warnings: string[];
}

export interface LoadedHeight {
  width: number;
  height: number;
  data: Float32Array; // NaN = nodata
  geo: GeoInfo | null;
  nativeWidth: number;
  nativeHeight: number;
  epsg: number | null;
  warnings: string[];
}

type AnyArray = ArrayLike<number>;

type TiffLike = Awaited<ReturnType<typeof fromArrayBuffer>>;
type ImageLike = Awaited<ReturnType<TiffLike["getImage"]>>;

/** Read (and resample) rasters, using overviews when the file is georeferenced. */
async function readResampled(
  tiff: TiffLike,
  img: ImageLike,
  opts: { width: number; height: number; samples?: number[] },
): Promise<AnyArray[]> {
  const o = { ...opts, resampleMethod: "bilinear", interleave: false as const };
  try {
    return (await tiff.readRasters(o)) as unknown as AnyArray[];
  } catch {
    return (await img.readRasters(o)) as unknown as AnyArray[];
  }
}

function epsgFromKeys(keys: Record<string, unknown> | null): { epsg: number | null; geographic: boolean } {
  if (!keys) return { epsg: null, geographic: false };
  const proj = keys.ProjectedCSTypeGeoKey as number | undefined;
  const geog = keys.GeographicTypeGeoKey as number | undefined;
  const model = keys.GTModelTypeGeoKey as number | undefined;
  if (proj && proj !== 32767) return { epsg: proj, geographic: false };
  if (model === 2 && geog && geog !== 32767) return { epsg: geog, geographic: true };
  if (geog && geog !== 32767 && !proj) return { epsg: geog, geographic: true };
  return { epsg: null, geographic: model === 2 };
}

function dtypeName(bits: number, fmt: number) {
  const kind = fmt === 3 ? "float" : fmt === 2 ? "int" : "uint";
  return `${kind}${bits}`;
}

/** Robust 0-255 stretch of a band (2nd-98th percentile) for display/analysis. */
function stretchBand(src: AnyArray, valid: Uint8Array, n: number): { lo: number; hi: number } {
  const sample: number[] = [];
  const step = Math.max(1, Math.floor(n / 200000));
  for (let i = 0; i < n; i += step) {
    if (!valid[i]) continue;
    const v = src[i];
    if (Number.isFinite(v)) sample.push(v);
  }
  if (!sample.length) return { lo: 0, hi: 1 };
  sample.sort((a, b) => a - b);
  const lo = sample[Math.floor(sample.length * 0.01)];
  const hi = sample[Math.min(sample.length - 1, Math.floor(sample.length * 0.995))];
  return { lo, hi: hi > lo ? hi : lo + 1 };
}

export function guessBandMap(spp: number, extraSamples: number[] | undefined, alphaLooksBinary: boolean): BandMap {
  if (spp >= 5) return { r: 0, g: 1, b: 2, nir: 3, alpha: spp >= 5 && alphaLooksBinary ? 4 : null };
  if (spp === 4) {
    const declaredAlpha = extraSamples && (extraSamples[0] === 1 || extraSamples[0] === 2);
    if (declaredAlpha || alphaLooksBinary) return { r: 0, g: 1, b: 2, nir: null, alpha: 3 };
    return { r: 0, g: 1, b: 2, nir: 3, alpha: null };
  }
  return { r: 0, g: 1, b: 2, nir: null, alpha: null };
}

export async function loadOrthoTiff(
  buf: ArrayBuffer,
  maxPixels: number,
  forcedMap?: Partial<BandMap> | null,
): Promise<LoadedOrtho> {
  const warnings: string[] = [];
  const tiff = await fromArrayBuffer(buf);
  const img = await tiff.getImage();
  const W = img.getWidth();
  const H = img.getHeight();
  const spp = img.getSamplesPerPixel();
  const bits = img.getBitsPerSample(0);
  const fmt = img.getSampleFormat(0);
  if (spp < 3) throw new Error(`This GeoTIFF has ${spp} band(s). FloraScope needs an RGB (or RGB+NIR) orthomosaic.`);
  const scale = Math.max(1, Math.sqrt((W * H) / maxPixels));
  const w = Math.max(1, Math.round(W / scale));
  const h = Math.max(1, Math.round(H / scale));
  if (scale > 1.001)
    warnings.push(
      `Image downsampled ${scale.toFixed(2)}× for in-browser analysis (${W}×${H} → ${w}×${h}). Increase the working-resolution limit for full detail.`,
    );

  const rasters = await readResampled(tiff, img, { width: w, height: h });
  const n = w * h;

  // alpha / band-role detection
  const fd = img.getFileDirectory();
  let extra: number[] | undefined;
  try {
    const v = fd.getValue("ExtraSamples") as unknown;
    extra =
      v === undefined || v === null
        ? undefined
        : typeof v === "number"
          ? [v]
          : Array.from(v as ArrayLike<number>);
  } catch {
    extra = undefined;
  }
  let alphaLooksBinary = false;
  if (spp >= 4) {
    const cand = rasters[spp - 1];
    alphaLooksBinary = true;
    const step = Math.max(1, Math.floor(n / 50000));
    for (let i = 0; i < n; i += step) {
      const v = cand[i];
      if (!(v === 0 || v === 255 || v === 65535 || v === 1)) {
        alphaLooksBinary = false;
        break;
      }
    }
  }
  const bandMap: BandMap = { ...guessBandMap(spp, extra, alphaLooksBinary), ...(forcedMap ?? {}) } as BandMap;

  const noData = img.getGDALNoData();
  const valid = new Uint8Array(n).fill(1);
  const R = rasters[bandMap.r];
  const G = rasters[bandMap.g];
  const B = rasters[bandMap.b];
  if (bandMap.alpha !== null && rasters[bandMap.alpha]) {
    const A = rasters[bandMap.alpha];
    for (let i = 0; i < n; i++) if (A[i] === 0) valid[i] = 0;
  }
  if (noData !== null && Number.isFinite(noData)) {
    for (let i = 0; i < n; i++) if (R[i] === noData && G[i] === noData && B[i] === noData) valid[i] = 0;
  } else if (bandMap.alpha === null) {
    // treat pure black collars as nodata (common in orthomosaic exports)
    for (let i = 0; i < n; i++) if (R[i] === 0 && G[i] === 0 && B[i] === 0) valid[i] = 0;
  }

  const rgba = new Uint8ClampedArray(n * 4);
  const is8 = bits === 8 && fmt !== 3;
  if (is8) {
    for (let i = 0; i < n; i++) {
      rgba[4 * i] = R[i];
      rgba[4 * i + 1] = G[i];
      rgba[4 * i + 2] = B[i];
      rgba[4 * i + 3] = valid[i] ? 255 : 0;
    }
  } else {
    // 16-bit or float imagery: common stretch for all three bands keeps colour balance
    const sR = stretchBand(R, valid, n);
    const sG = stretchBand(G, valid, n);
    const sB = stretchBand(B, valid, n);
    const lo = Math.min(sR.lo, sG.lo, sB.lo);
    const hi = Math.max(sR.hi, sG.hi, sB.hi);
    const k = 255 / (hi - lo);
    for (let i = 0; i < n; i++) {
      rgba[4 * i] = (R[i] - lo) * k;
      rgba[4 * i + 1] = (G[i] - lo) * k;
      rgba[4 * i + 2] = (B[i] - lo) * k;
      rgba[4 * i + 3] = valid[i] ? 255 : 0;
    }
    warnings.push(`${dtypeName(bits, fmt)} imagery was linearly stretched to 8-bit for analysis.`);
  }

  let nir: Float32Array | null = null;
  let redRaw: Float32Array | null = null;
  if (bandMap.nir !== null && rasters[bandMap.nir]) {
    nir = Float32Array.from(rasters[bandMap.nir]);
    redRaw = Float32Array.from(R);
  }

  // georeferencing
  let geo: GeoInfo | null = null;
  const { epsg, geographic } = epsgFromKeys(img.getGeoKeys() as Record<string, unknown> | null);
  try {
    const origin = img.getOrigin();
    const res = img.getResolution();
    const rx = Math.abs(res[0]) * (W / w);
    const ry = Math.abs(res[1]) * (H / h);
    const isGeo = geographic || isGeographicEpsg(epsg);
    geo = {
      epsg,
      proj4: proj4ForEpsg(epsg) ?? (isGeo ? proj4ForEpsg(4326) : null),
      originX: origin[0],
      originY: origin[1],
      resX: rx,
      resY: ry,
      isGeographic: isGeo,
    };
    if (!epsg) warnings.push("GeoTIFF has a geotransform but no EPSG code — map coordinates cannot be converted to lat/lon.");
    else if (!geo.proj4) warnings.push(`EPSG:${epsg} is not built in; FloraScope will try to fetch its definition.`);
  } catch {
    warnings.push("No georeferencing found in this GeoTIFF. Tree GPS coordinates will not be available.");
  }

  return {
    width: w,
    height: h,
    rgba,
    valid,
    nir,
    redRaw,
    geo,
    nativeWidth: W,
    nativeHeight: H,
    bands: spp,
    dtype: dtypeName(bits, fmt),
    epsg,
    scale: W / w,
    bandMap,
    warnings,
  };
}

export async function loadHeightTiff(buf: ArrayBuffer, maxPixels: number): Promise<LoadedHeight> {
  const warnings: string[] = [];
  const tiff = await fromArrayBuffer(buf);
  const img = await tiff.getImage();
  const W = img.getWidth();
  const H = img.getHeight();
  const scale = Math.max(1, Math.sqrt((W * H) / maxPixels));
  const w = Math.max(1, Math.round(W / scale));
  const h = Math.max(1, Math.round(H / scale));
  const rasters = await readResampled(tiff, img, { width: w, height: h, samples: [0] });
  const src = rasters[0];
  const noData = img.getGDALNoData();
  const data = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const v = src[i];
    data[i] = (noData !== null && v === noData) || !Number.isFinite(v) || v < -1000 ? NaN : v;
  }
  let geo: GeoInfo | null = null;
  const { epsg, geographic } = epsgFromKeys(img.getGeoKeys() as Record<string, unknown> | null);
  try {
    const origin = img.getOrigin();
    const res = img.getResolution();
    const isGeo = geographic || isGeographicEpsg(epsg);
    geo = {
      epsg,
      proj4: proj4ForEpsg(epsg),
      originX: origin[0],
      originY: origin[1],
      resX: Math.abs(res[0]) * (W / w),
      resY: Math.abs(res[1]) * (H / h),
      isGeographic: isGeo,
    };
  } catch {
    warnings.push("Height layer has no georeferencing; it is assumed to cover exactly the same extent as the orthomosaic.");
  }
  return { width: w, height: h, data, geo, nativeWidth: W, nativeHeight: H, epsg, warnings };
}

/** Bilinear sample with NaN awareness. */
function sampleBilinear(src: Float32Array, w: number, h: number, fx: number, fy: number): number {
  if (fx < -0.5 || fy < -0.5 || fx > w - 0.5 || fy > h - 0.5) return NaN;
  const x0 = Math.max(0, Math.min(w - 1, Math.floor(fx)));
  const y0 = Math.max(0, Math.min(h - 1, Math.floor(fy)));
  const x1 = Math.min(w - 1, x0 + 1);
  const y1 = Math.min(h - 1, y0 + 1);
  const tx = Math.max(0, Math.min(1, fx - x0));
  const ty = Math.max(0, Math.min(1, fy - y0));
  const a = src[y0 * w + x0];
  const b = src[y0 * w + x1];
  const c = src[y1 * w + x0];
  const d = src[y1 * w + x1];
  if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c) || !Number.isFinite(d)) {
    const nx = tx < 0.5 ? (ty < 0.5 ? a : c) : ty < 0.5 ? b : d;
    return nx;
  }
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}

/**
 * Resample a height layer onto the ortho working grid. Uses the geotransforms
 * when both rasters are georeferenced in the same CRS, otherwise stretches
 * the height layer over the full ortho extent.
 */
export function alignHeight(
  hl: LoadedHeight,
  w: number,
  h: number,
  geo: GeoInfo | null,
  warnings: string[],
): Float32Array {
  const out = new Float32Array(w * h);
  const sameCrs = geo && hl.geo && (geo.epsg === hl.geo.epsg || !geo.epsg || !hl.geo.epsg);
  if (geo && hl.geo && sameCrs) {
    const hg = hl.geo;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const [mx, my] = pixelToMap(geo, x, y);
        const [fx, fy] = mapToPixel(hg, mx, my);
        out[y * w + x] = sampleBilinear(hl.data, hl.width, hl.height, fx, fy);
      }
    }
  } else {
    if (geo && hl.geo && !sameCrs)
      warnings.push(`Height layer CRS (EPSG:${hl.geo.epsg}) differs from the orthomosaic (EPSG:${geo.epsg}); aligned by extent only.`);
    const kx = hl.width / w;
    const ky = hl.height / h;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) out[y * w + x] = sampleBilinear(hl.data, hl.width, hl.height, (x + 0.5) * kx - 0.5, (y + 0.5) * ky - 0.5);
  }
  return out;
}

/** Convert a DSM to a canopy height model: CHM = DSM − ground (moving minimum, smoothed). */
export function dsmToChm(dsm: Float32Array, w: number, h: number, gsd: number, windowM: number, minFilter: (s: Float32Array, w: number, h: number, r: number) => Float32Array, blur: (s: Float32Array, w: number, h: number, sigma: number) => Float32Array): Float32Array {
  const r = Math.max(2, Math.round(windowM / 2 / gsd));
  const filled = new Float32Array(w * h);
  let mean = 0;
  let cnt = 0;
  for (let i = 0; i < w * h; i++) if (Number.isFinite(dsm[i])) {
    mean += dsm[i];
    cnt++;
  }
  mean = cnt ? mean / cnt : 0;
  for (let i = 0; i < w * h; i++) filled[i] = Number.isFinite(dsm[i]) ? dsm[i] : mean;
  const ground = blur(minFilter(filled, w, h, r), w, h, r / 2);
  const chm = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) chm[i] = Number.isFinite(dsm[i]) ? Math.max(0, dsm[i] - ground[i]) : NaN;
  return chm;
}

export function geoGsd(geo: GeoInfo | null, fallback: number): number {
  if (!geo) return fallback;
  const g = gsdMetres(geo);
  return Number.isFinite(g) && g > 0 ? g : fallback;
}

/** Parse an ESRI world file (.jgw/.pgw/.tfw/.wld). */
export function parseWorldFile(text: string): { a: number; d: number; b: number; e: number; c: number; f: number } | null {
  const v = text
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number);
  if (v.length < 6 || v.some((x) => !Number.isFinite(x))) return null;
  return { a: v[0], d: v[1], b: v[2], e: v[3], c: v[4], f: v[5] };
}
