// Run detection on a raw RGB dump:
//   npx tsx scripts/test-image.ts file.rgb W H gsd [mode] [calib.json] [mergeStrength]
import { readFileSync, writeFileSync } from "node:fs";
import { runDetection } from "../src/lib/detect";
import { defaultDetectParams } from "../src/lib/defaults";
import type { Calibration } from "../src/lib/types";
const [file, W, H, gsdS, mode = "rgb", calibF, ms] = process.argv.slice(2);
const w = Number(W), h = Number(H), gsd = Number(gsdS);
const rgb = readFileSync(file);
const rgba = new Uint8ClampedArray(w * h * 4);
for (let i = 0; i < w * h; i++) { rgba[4*i]=rgb[3*i]; rgba[4*i+1]=rgb[3*i+1]; rgba[4*i+2]=rgb[3*i+2]; rgba[4*i+3]=255; }
const valid = new Uint8Array(w * h).fill(1);
const calib: Calibration | null = calibF ? JSON.parse(readFileSync(calibF, "utf8")) : null;
const p = { ...defaultDetectParams("arr"), markerSource: mode as "rgb" | "segments" };
if (calib) {
  const ds = calib.crowns.map((c) => 2 * c.r * gsd);
  p.minCrownDiameterM = Math.min(...ds) * 0.85;
  p.maxCrownDiameterM = Math.max(...ds) * 1.2;
  p.minTreeSpacingM = Math.min(...ds) * 0.7;
}
if (ms) p.mergeStrength = Number(ms);
const t = Date.now();
const res = runDetection({ width: w, height: h, rgba, valid, nir: null, redRaw: null, heightLayer: null, gsd, geo: null, calib }, p);
console.log("trees", res.trees.length, Date.now() - t, "ms", res.stats.segInfo ?? "", "veg", res.stats.vegFraction.toFixed(2));
writeFileSync(file + ".trees.json", JSON.stringify(res.trees.map((t) => [t.x, t.y, t.crownDiameterM / gsd / 2])));
writeFileSync(file + ".labels.bin", Buffer.from(res.labels.buffer));
