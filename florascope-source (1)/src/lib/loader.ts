// Browser-side loading of user files and demo datasets into a WorkingRaster.

import { gaussianBlur, minFilter } from "./cv";
import { fetchProj4, gsdMetres, isGeographicEpsg, proj4ForEpsg } from "./geo";
import { alignHeight, dsmToChm, loadHeightTiff, loadOrthoTiff, parseWorldFile, type BandMap } from "./raster";
import type { GeoInfo, HeightMode, InputFileInfo, WorkingRaster } from "./types";


export async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  if (buf.byteLength > 1.5e9) return "";
  const d = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(d))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const isTiff = (name: string) => /\.(tif|tiff|gtiff)$/i.test(name);

export interface OrthoOptions {
  maxPixels: number;
  gsdFallback: number; // m/px when the image is not georeferenced
  epsgOverride: number | null;
  worldFile: File | null;
  bandMap: Partial<BandMap> | null;
}

export interface SourceFile {
  name: string;
  buffer: ArrayBuffer;
  type?: string;
}

export async function fileToSource(f: File): Promise<SourceFile> {
  return { name: f.name, buffer: await f.arrayBuffer(), type: f.type };
}

export async function fetchSource(url: string): Promise<SourceFile> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Could not load ${url} (${r.status})`);
  return { name: url.split("/").pop() ?? url, buffer: await r.arrayBuffer() };
}

async function decodeBitmapImage(src: SourceFile, maxPixels: number) {
  const blob = new Blob([src.buffer], { type: src.type || "image/*" });
  const probe = await createImageBitmap(blob);
  const W = probe.width;
  const H = probe.height;
  probe.close();
  const scale = Math.max(1, Math.sqrt((W * H) / maxPixels));
  const w = Math.round(W / scale);
  const h = Math.round(H / scale);
  const bmp = await createImageBitmap(blob, { resizeWidth: w, resizeHeight: h, resizeQuality: "high" });
  const canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(w, h) : Object.assign(document.createElement("canvas"), { width: w, height: h });
  const ctx = (canvas as HTMLCanvasElement).getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D;
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  const data = ctx.getImageData(0, 0, w, h).data;
  return { W, H, w, h, data, scale: W / w };
}

async function resolveProj(geo: GeoInfo | null, warnings: string[]) {
  if (geo && geo.epsg && !geo.proj4 && !geo.isGeographic) {
    const def = await fetchProj4(geo.epsg);
    if (def) {
      geo.proj4 = def;
      warnings.push(`Fetched CRS definition for EPSG:${geo.epsg} from epsg.io.`);
    } else warnings.push(`Could not resolve EPSG:${geo.epsg}; lat/lon unavailable.`);
  }
}

export async function loadOrtho(src: SourceFile, opt: OrthoOptions) {
  const warnings: string[] = [];
  const sha = await sha256Hex(src.buffer);
  let width: number;
  let height: number;
  let rgba: Uint8ClampedArray;
  let valid: Uint8Array;
  let nir: Float32Array | null = null;
  let redRaw: Float32Array | null = null;
  let geo: GeoInfo | null = null;
  let nativeW: number;
  let nativeH: number;
  let bands = 3;
  let dtype = "uint8";
  let epsg: number | null = null;
  let scale = 1;
  if (isTiff(src.name)) {
    const o = await loadOrthoTiff(src.buffer, opt.maxPixels, opt.bandMap);
    ({ width, height, rgba, valid, nir, redRaw, geo, scale } = o);
    nativeW = o.nativeWidth;
    nativeH = o.nativeHeight;
    bands = o.bands;
    dtype = o.dtype;
    epsg = o.epsg;
    warnings.push(...o.warnings);
  } else {
    const d = await decodeBitmapImage(src, opt.maxPixels);
    width = d.w;
    height = d.h;
    nativeW = d.W;
    nativeH = d.H;
    scale = d.scale;
    rgba = new Uint8ClampedArray(d.data);
    valid = new Uint8Array(width * height);
    for (let i = 0; i < width * height; i++) {
      const a = rgba[4 * i + 3];
      valid[i] = a > 0 && !(rgba[4 * i] === 0 && rgba[4 * i + 1] === 0 && rgba[4 * i + 2] === 0) ? 1 : 0;
      rgba[4 * i + 3] = valid[i] ? 255 : 0;
    }
    if (scale > 1.001) warnings.push(`Image downsampled ${scale.toFixed(2)}× for in-browser analysis.`);
    if (opt.worldFile) {
      const wf = parseWorldFile(await opt.worldFile.text());
      if (wf) {
        if (Math.abs(wf.d) > 1e-9 || Math.abs(wf.b) > 1e-9) warnings.push("World file contains rotation terms; they are ignored.");
        const e = opt.epsgOverride;
        geo = {
          epsg: e,
          proj4: proj4ForEpsg(e),
          originX: wf.c - wf.a / 2,
          originY: wf.f - wf.e / 2,
          resX: Math.abs(wf.a) * scale,
          resY: Math.abs(wf.e) * scale,
          isGeographic: isGeographicEpsg(e),
        };
        if (!e) warnings.push("World file loaded without an EPSG code — set the CRS to get lat/lon.");
      } else warnings.push("World file could not be parsed.");
    } else warnings.push("No georeferencing (use a GeoTIFF, or add a world file + EPSG). Pixel size taken from your GSD setting.");
  }
  if (geo && opt.epsgOverride && geo.epsg !== opt.epsgOverride) {
    geo.epsg = opt.epsgOverride;
    geo.proj4 = proj4ForEpsg(opt.epsgOverride);
    geo.isGeographic = isGeographicEpsg(opt.epsgOverride);
    epsg = opt.epsgOverride;
  }
  await resolveProj(geo, warnings);
  const gsd = geo ? gsdMetres(geo) : opt.gsdFallback * scale;
  const info: InputFileInfo = {
    role: "ortho",
    name: src.name,
    sizeBytes: src.buffer.byteLength,
    sha256: sha,
    nativeWidth: nativeW,
    nativeHeight: nativeH,
    bands,
    dtype,
    epsg,
  };
  return { width, height, rgba, valid, nir, redRaw, geo, gsd, nativeGsd: gsd / scale, scale, info, warnings };
}

export async function attachHeight(
  base: Awaited<ReturnType<typeof loadOrtho>>,
  src: SourceFile,
  mode: Exclude<HeightMode, "none">,
  groundWindowM: number,
) {
  const warnings: string[] = [];
  const sha = await sha256Hex(src.buffer);
  if (!isTiff(src.name)) throw new Error("Height layers must be GeoTIFFs (CHM or DSM).");
  const hl = await loadHeightTiff(src.buffer, Math.max(4e6, base.width * base.height));
  warnings.push(...hl.warnings);
  let layer = alignHeight(hl, base.width, base.height, base.geo, warnings);
  if (mode === "dsm") layer = dsmToChm(layer, base.width, base.height, base.gsd, groundWindowM, minFilter, gaussianBlur);
  // sanity: typical CHM values
  let mx = -Infinity;
  let cnt = 0;
  for (let i = 0; i < layer.length; i++)
    if (Number.isFinite(layer[i])) {
      cnt++;
      if (layer[i] > mx) mx = layer[i];
    }
  if (!cnt) warnings.push("Height layer does not overlap the orthomosaic.");
  else if (mode === "chm" && mx > 80) warnings.push("Height values above 80 m — is this a DSM rather than a CHM? Switch the height type to DSM.");
  const info: InputFileInfo = {
    role: "height",
    name: src.name,
    sizeBytes: src.buffer.byteLength,
    sha256: sha,
    nativeWidth: hl.nativeWidth,
    nativeHeight: hl.nativeHeight,
    bands: 1,
    dtype: "float32",
    epsg: hl.epsg,
  };
  return { layer, info, warnings };
}

export function toWorkingRaster(
  base: Awaited<ReturnType<typeof loadOrtho>>,
  height: { layer: Float32Array; info: InputFileInfo; warnings: string[] } | null,
  heightMode: HeightMode,
): WorkingRaster {
  return {
    width: base.width,
    height: base.height,
    rgba: base.rgba,
    valid: base.valid,
    nir: base.nir,
    redRaw: base.redRaw,
    heightLayer: height ? height.layer : null,
    heightMode: height ? heightMode : "none",
    gsd: base.gsd,
    nativeGsd: base.nativeGsd,
    scale: base.scale,
    geo: base.geo,
    files: height ? [base.info, height.info] : [base.info],
    warnings: [...base.warnings, ...(height ? height.warnings : [])],
  };
}
