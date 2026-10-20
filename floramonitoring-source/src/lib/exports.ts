// Export helpers: GeoJSON (WGS84), CSV, GPX and the FloraScope survey file.

import { pixelToLonLat, pixelToMap } from "./geo";
import type { CarbonResult, FieldPlot, GeoInfo, SurvivalResult, Survey, Tree } from "./types";

export const APP_VERSION = "0.9.0-mvp";

export function download(name: string, data: string | Blob, type = "application/octet-stream") {
  const blob = typeof data === "string" ? new Blob([data], { type }) : data;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const r6 = (x: number | null) => (x === null ? null : Math.round(x * 1e7) / 1e7);
const r3 = (x: number | null) => (x === null ? null : Math.round(x * 1000) / 1000);

export function treeId(survey: Survey, t: Tree) {
  const prefix = survey.meta.site.replace(/[^A-Za-z0-9]/g, "").slice(0, 6).toUpperCase() || "FS";
  return `${prefix}-${survey.meta.date.replace(/-/g, "")}-${t.source === "manual" ? "M" : "T"}${String(t.id).padStart(5, "0")}`;
}

/** Persistent IDs: a tree re-identified in an earlier survey keeps that survey's ID. */
export type IdLinks = Map<number, string>; // index in `trees` -> earlier tree_id

export function treesGeoJSON(survey: Survey, trees: Tree[], co2: Float32Array | null, links?: IdLinks | null): string {
  const features = trees
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => t.lon !== null && t.lat !== null)
    .map(({ t, i }) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [r6(t.lon), r6(t.lat)] },
      properties: {
        tree_id: treeId(survey, t),
        persistent_id: links?.get(i) ?? treeId(survey, t),
        source: t.source,
        map_x: r3(t.mx),
        map_y: r3(t.my),
        epsg: survey.raster.geo?.epsg ?? null,
        crown_diam_m: r3(t.crownDiameterM),
        crown_area_m2: r3(t.crownAreaM2),
        height_m: r3(t.heightM),
        vari: r3(t.vari),
        ndvi: r3(t.ndvi),
        health: t.health,
        health_z: r3(t.healthZ),
        co2e_kg: co2 ? r3(co2[i]) : null,
        survey_date: survey.meta.date,
      },
    }));
  return JSON.stringify({ type: "FeatureCollection", name: `${survey.meta.name} trees`, features });
}

export function crownsGeoJSON(survey: Survey, trees: Tree[]): string {
  const geo = survey.raster.geo;
  if (!geo) return JSON.stringify({ type: "FeatureCollection", features: [] });
  const features = trees
    .filter((t) => t.hull.length >= 6)
    .map((t) => {
      const ring: (number | null)[][] = [];
      for (let k = 0; k < t.hull.length; k += 2) {
        const ll = pixelToLonLat(geo, t.hull[k] - 0.5, t.hull[k + 1] - 0.5);
        if (ll) ring.push([r6(ll[0]), r6(ll[1])]);
      }
      if (ring.length) ring.push(ring[0]);
      return {
        type: "Feature",
        geometry: { type: "Polygon", coordinates: [ring] },
        properties: { tree_id: treeId(survey, t), crown_area_m2: r3(t.crownAreaM2), health: t.health },
      };
    });
  return JSON.stringify({ type: "FeatureCollection", name: `${survey.meta.name} crowns`, features });
}

export function treesCSV(survey: Survey, trees: Tree[], co2: Float32Array | null, links?: IdLinks | null): string {
  const head = [
    "tree_id", "persistent_id", "source", "lon", "lat", "map_x", "map_y", "epsg", "px", "py", "crown_diam_m", "crown_area_m2",
    "height_m", "vari", "ndvi", "health", "health_z", "co2e_kg", "survey_date",
  ];
  const rows = trees.map((t, i) =>
    [
      treeId(survey, t), links?.get(i) ?? treeId(survey, t), t.source, r6(t.lon), r6(t.lat), r3(t.mx), r3(t.my), survey.raster.geo?.epsg ?? "",
      t.x.toFixed(1), t.y.toFixed(1), r3(t.crownDiameterM), r3(t.crownAreaM2), r3(t.heightM), r3(t.vari), r3(t.ndvi),
      t.health, r3(t.healthZ), co2 ? r3(co2[i]) : "", survey.meta.date,
    ].map((v) => (v === null ? "" : String(v))).join(","),
  );
  return [head.join(","), ...rows].join("\n");
}

function cellPolygon(geo: GeoInfo, x0: number, y0: number, x1: number, y1: number) {
  const pts = [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
    [x0, y0],
  ].map(([x, y]) => pixelToLonLat(geo, x - 0.5, y - 0.5));
  if (pts.some((p) => !p)) return null;
  return [pts.map((p) => [r6(p![0]), r6(p![1])])];
}

export function gapsGeoJSON(survey: Survey, s: SurvivalResult): string {
  const geo = survey.raster.geo;
  if (!geo) return JSON.stringify({ type: "FeatureCollection", features: [] });
  const features = s.cells
    .filter((c) => c.plantableHa > 0)
    .map((c) => ({
      type: "Feature",
      geometry: { type: "Polygon", coordinates: cellPolygon(geo, c.x0, c.y0, c.x1, c.y1) },
      properties: {
        cell: `${c.i}-${c.j}`,
        plantable_ha: r3(c.plantableHa),
        expected: r3(c.expected),
        observed: c.observed,
        stocking_ratio: r3(c.ratio),
        gap: c.gap,
        replant: c.gap ? Math.max(0, Math.round(c.expected - c.observed)) : 0,
      },
    }));
  return JSON.stringify({ type: "FeatureCollection", name: `${survey.meta.name} stocking grid`, features });
}

export function plotsGeoJSON(survey: Survey, plots: FieldPlot[]): string {
  const features = plots
    .filter((p) => p.lon !== null)
    .map((p) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [r6(p.lon), r6(p.lat)] },
      properties: {
        plot_id: p.id,
        radius_m: p.radiusM,
        map_x: r3(p.mx),
        map_y: r3(p.my),
        detected_trees: p.detected,
        field_count: p.fieldCount,
        field_mean_height_m: p.fieldMeanHeight,
        field_mean_dbh_cm: p.fieldMeanDbh,
      },
    }));
  return JSON.stringify({ type: "FeatureCollection", name: `${survey.meta.name} field plots`, features });
}

export function plotsCSV(plots: FieldPlot[]): string {
  const head = "plot_id,lat,lon,map_x,map_y,radius_m,detected_trees,field_count,field_mean_height_m,field_mean_dbh_cm";
  return [
    head,
    ...plots.map((p) =>
      [p.id, r6(p.lat), r6(p.lon), r3(p.mx), r3(p.my), p.radiusM, p.detected, p.fieldCount ?? "", p.fieldMeanHeight ?? "", p.fieldMeanDbh ?? ""].join(","),
    ),
  ].join("\n");
}

export function plotsGPX(survey: Survey, plots: FieldPlot[]): string {
  const wpts = plots
    .filter((p) => p.lat !== null)
    .map(
      (p) =>
        `  <wpt lat="${r6(p.lat)}" lon="${r6(p.lon)}"><name>${p.id}</name><desc>Radius ${p.radiusM} m · ${p.detected} trees detected</desc></wpt>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="FloraScope ${APP_VERSION}" xmlns="http://www.topografix.com/GPX/1/1">\n  <metadata><name>${escapeXml(survey.meta.name)} — field plots</name></metadata>\n${wpts}\n</gpx>\n`;
}

function escapeXml(s: string) {
  return s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c] as string);
}

export interface SurveyFile {
  format: "florascope-survey";
  version: string;
  exportedAt: string;
  meta: Survey["meta"];
  raster: { width: number; height: number; gsd: number; geo: GeoInfo | null; files: Survey["raster"]["files"]; heightMode: string };
  detectParams: Survey["detectParams"];
  trees: Tree[];
  removed: number[];
  added: Tree[];
  qaPlots: Survey["qaPlots"];
  fieldPlots: FieldPlot[];
  editLog: Survey["editLog"];
  summary?: Record<string, unknown>;
}

export function surveyFile(survey: Survey, extra?: { survival?: SurvivalResult | null; carbon?: CarbonResult | null }): string {
  const f: SurveyFile = {
    format: "florascope-survey",
    version: APP_VERSION,
    exportedAt: new Date().toISOString(),
    meta: survey.meta,
    raster: {
      width: survey.raster.width,
      height: survey.raster.height,
      gsd: survey.raster.gsd,
      geo: survey.raster.geo,
      files: survey.raster.files,
      heightMode: survey.raster.heightMode,
    },
    detectParams: survey.detectParams,
    trees: survey.detection?.trees ?? [],
    removed: survey.removed,
    added: survey.added,
    qaPlots: survey.qaPlots,
    fieldPlots: survey.fieldPlots,
    editLog: survey.editLog,
    summary: extra
      ? {
          survival: extra.survival
            ? {
                plantedAreaHa: extra.survival.plantedAreaHa,
                expected: extra.survival.expected,
                observed: extra.survival.observed,
                survivalPct: extra.survival.survivalPctCorrected,
                replantNeeded: extra.survival.replantNeeded,
              }
            : null,
          carbon: extra.carbon
            ? {
                co2eT: extra.carbon.co2eT,
                mean: extra.carbon.mc.mean,
                p5: extra.carbon.mc.p5,
                p95: extra.carbon.mc.p95,
                uncertaintyPct: extra.carbon.mc.uncertaintyPct,
                discountPct: extra.carbon.mc.discountPct,
                conservative: extra.carbon.mc.conservative,
              }
            : null,
        }
      : undefined,
  };
  return JSON.stringify(f);
}

export function pixelMap(geo: GeoInfo | null, x: number, y: number) {
  return geo ? pixelToMap(geo, x, y) : null;
}
