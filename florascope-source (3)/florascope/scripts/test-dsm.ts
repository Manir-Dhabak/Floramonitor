// Profile the DSM -> CHM path and an RGBA16 orthomosaic in Node.
import { readFileSync } from "node:fs";
import { loadOrthoTiff, loadHeightTiff, alignHeight, dsmToChm, geoGsd } from "../src/lib/raster";
import { gaussianBlur, minFilter } from "../src/lib/cv";
import { runDetection } from "../src/lib/detect";
import { benchmarkAgainstTruth, type TruthFile } from "../src/lib/benchmark";
import { defaultDetectParams } from "../src/lib/defaults";

const T = process.argv[2];
const toAB = (b: Buffer) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
(async () => {
  let t = Date.now();
  const o = await loadOrthoTiff(toAB(readFileSync(`${T}/mangrove-rgba16.tif`)), 16e6);
  console.log("ortho", o.width, o.height, o.bandMap, o.warnings, Date.now() - t, "ms");
  let valid = 0;
  for (let i = 0; i < o.valid.length; i++) valid += o.valid[i];
  console.log("valid fraction", (valid / o.valid.length).toFixed(3), "rgba sample", Array.from(o.rgba.slice(4 * 900000, 4 * 900000 + 4)));
  t = Date.now();
  const hl = await loadHeightTiff(toAB(readFileSync(`${T}/mangrove-dsm.tif`)), 16e6);
  const w: string[] = [];
  const gsd = geoGsd(o.geo, 0.04);
  let layer = alignHeight(hl, o.width, o.height, o.geo, w);
  layer = dsmToChm(layer, o.width, o.height, gsd, 8, minFilter, gaussianBlur);
  console.log("dsm->chm", Date.now() - t, "ms", w);
  const truth = JSON.parse(readFileSync("public/demo/mangrove-sundarbans-truth.json", "utf8")) as TruthFile;
  for (const spacing of [3, 1.5]) {
    const p = defaultDetectParams("mangrove", spacing);
    const tt = Date.now();
    const res = runDetection(
      { width: o.width, height: o.height, rgba: o.rgba, valid: o.valid, nir: o.nir, redRaw: o.redRaw, heightLayer: layer, gsd, geo: o.geo },
      p,
      (stage, pct) => console.log(`  [${Date.now() - tt}ms] ${pct}% ${stage}`),
    );
    const bm = benchmarkAgainstTruth(res.trees, truth, gsd, o.scale);
    console.log("spacing", spacing, "trees", res.trees.length, "P", bm.precision.toFixed(3), "R", bm.recall.toFixed(3), "hRMSE", bm.heightRmseM?.toFixed(3));
  }
})();
