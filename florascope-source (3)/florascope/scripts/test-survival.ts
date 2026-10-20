import { readFileSync } from "node:fs";
import { loadOrthoTiff, loadHeightTiff, alignHeight, geoGsd } from "../src/lib/raster";
import { runDetection } from "../src/lib/detect";
import { computeSurvival } from "../src/lib/survival";
import { defaultDetectParams, defaultPlanting } from "../src/lib/defaults";
const toAB = (b: Buffer) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
(async () => {
  const which = process.argv[2] ?? "arr-thar-y2";
  const eco = which.startsWith("arr") ? "arr" : "mangrove";
  const o = await loadOrthoTiff(toAB(readFileSync(`public/demo/${which}-rgb.tif`)), 16e6);
  const hl = await loadHeightTiff(toAB(readFileSync(`public/demo/${which}-chm.tif`)), 16e6);
  const chm = alignHeight(hl, o.width, o.height, o.geo, []);
  const gsd = geoGsd(o.geo, 0.05);
  const truth = JSON.parse(readFileSync(`public/demo/${which}-truth.json`, "utf8"));
  const res = runDetection({ width: o.width, height: o.height, rgba: o.rgba, valid: o.valid, nir: null, redRaw: null, heightLayer: chm, gsd, geo: o.geo }, defaultDetectParams(eco));
  const dead = truth.trees.filter((t: { alive: boolean }) => !t.alive).length;
  console.log("truth dead", dead);
  for (const cell of [6, 9, 12]) for (const thr of [0.5, 0.7]) {
    const sp = truth.planting_spacing_m;
    const p = { ...defaultPlanting(eco), gridCellM: cell, gapThreshold: thr, plantedAreaMode: "manual" as const, plantedAreaHa: (truth.planted * sp[0] * sp[1]) / 1e4 };
    const s = computeSurvival({ trees: res.trees, width: o.width, height: o.height, gsd, valid: o.valid, water: res.water, params: p, correction: 1 });
    console.log(`cell ${cell} thr ${thr}: gaps ${s.gapCells} area ${s.gapAreaHa.toFixed(3)} replant ${s.replantNeeded} surv ${s.survivalPct.toFixed(1)}`);
  }
})();
