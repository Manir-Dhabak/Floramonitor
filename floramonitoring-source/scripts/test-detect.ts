// Node harness: run the detection pipeline on the demo data and benchmark it.
// Usage: npx tsx scripts/test-detect.ts [arr-y2|arr-y1|mangrove] [rgb|height]
import { readFileSync } from "node:fs";
import { loadOrthoTiff, loadHeightTiff, alignHeight, geoGsd } from "../src/lib/raster";
import { runDetection } from "../src/lib/detect";
import { benchmarkAgainstTruth, matchPoints, type TruthFile } from "../src/lib/benchmark";
import { defaultDetectParams } from "../src/lib/defaults";

const which = process.argv[2] ?? "arr-y2";
const marker = (process.argv[3] ?? "height") as "rgb" | "height";
const files: Record<string, [string, string, string, "arr" | "mangrove"]> = {
  "arr-y1": ["arr-thar-y1-rgb.tif", "arr-thar-y1-chm.tif", "arr-thar-y1-truth.json", "arr"],
  "arr-y2": ["arr-thar-y2-rgb.tif", "arr-thar-y2-chm.tif", "arr-thar-y2-truth.json", "arr"],
  mangrove: ["mangrove-sundarbans-rgb.tif", "mangrove-sundarbans-chm.tif", "mangrove-sundarbans-truth.json", "mangrove"],
};
const [rgbF, chmF, truthF, eco] = files[which];
const toAB = (b: Buffer) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

(async () => {
  const t0 = Date.now();
  const o = await loadOrthoTiff(toAB(readFileSync(`public/demo/${rgbF}`)), 16e6);
  const hl = await loadHeightTiff(toAB(readFileSync(`public/demo/${chmF}`)), 16e6);
  const warnings: string[] = [];
  const chm = alignHeight(hl, o.width, o.height, o.geo, warnings);
  const gsd = geoGsd(o.geo, 0.05);
  console.log("loaded", o.width, o.height, "gsd", gsd, "epsg", o.epsg, o.warnings, warnings, Date.now() - t0, "ms");
  const truth = JSON.parse(readFileSync(`public/demo/${truthF}`, "utf8")) as TruthFile;
  const p = { ...defaultDetectParams(eco, truth.planting_spacing_m[0]), markerSource: marker };
  const tt = Date.now();
  const res = runDetection(
    { width: o.width, height: o.height, rgba: o.rgba, valid: o.valid, nir: o.nir, redRaw: o.redRaw, heightLayer: chm, gsd, geo: o.geo },
    p,
    (stage, pct) => console.log(`  [${Date.now() - tt}ms] ${pct}% ${stage}`),
  );
  console.log("stats", res.stats);
  console.log("trees", res.trees.length, "truth alive", truth.alive, "health", {
    healthy: res.trees.filter((t) => t.health === "healthy").length,
    watch: res.trees.filter((t) => t.health === "watch").length,
    weak: res.trees.filter((t) => t.health === "weak").length,
  });
  console.log("first tree", res.trees[0]);
  console.log("bench", benchmarkAgainstTruth(res.trees, truth, gsd, o.scale));
  // which truth trees were missed?
  const alive = truth.trees.filter((t) => t.alive);
  const pairs = matchPoints(res.trees.map((t) => [t.x * gsd, t.y * gsd] as [number, number]), alive.map((t) => [t.px * gsd, t.py * gsd] as [number, number]), truth.planting_spacing_m[0] * 0.45);
  const hit = new Set(pairs.map((p) => p[1]));
  const missed = alive.filter((_, j) => !hit.has(j));
  const byH: Record<string, number> = {};
  missed.forEach((t) => (byH[t.health] = (byH[t.health] ?? 0) + 1));
  console.log("missed by health", byH, "missed crown/height sample", missed.slice(0, 8).map((t) => [t.crown_d_m, t.height_m, t.health]));
  const fpTrees = res.trees.filter((_, i) => !pairs.some((p) => p[0] === i));
  console.log("FP sample", fpTrees.slice(0, 8).map((t) => [Math.round(t.x), Math.round(t.y), t.crownDiameterM.toFixed(2), t.heightM?.toFixed(2)]));
  // health confusion for matched
  const conf: Record<string, number> = {};
  pairs.forEach(([i, j]) => { const k = alive[j].health + "->" + res.trees[i].health; conf[k] = (conf[k] ?? 0) + 1; });
  console.log("health confusion", conf);
})();
