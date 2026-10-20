/// <reference lib="webworker" />
// FloraScope compute worker: tree detection + carbon Monte Carlo off the UI thread.

import { runDetection, type DetectInput } from "../lib/detect";
import { runCarbon, type CarbonInput } from "../lib/carbon";
import type { DetectParams } from "../lib/types";

type Msg =
  | { type: "detect"; id: number; input: DetectInput; params: DetectParams }
  | { type: "carbon"; id: number; input: CarbonInput };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (e: MessageEvent<Msg>) => {
  const msg = e.data;
  try {
    if (msg.type === "detect") {
      const res = runDetection(msg.input, msg.params, (stage, pct) =>
        ctx.postMessage({ type: "progress", id: msg.id, stage, pct }),
      );
      ctx.postMessage({ type: "detect-done", id: msg.id, result: res }, [res.labels.buffer, res.water.buffer, res.vegMask.buffer]);
    } else if (msg.type === "carbon") {
      const out = runCarbon(msg.input);
      ctx.postMessage({ type: "carbon-done", id: msg.id, result: out.result, samples: out.samples }, [out.samples.buffer]);
    }
  } catch (err) {
    ctx.postMessage({ type: "error", id: msg.id, message: err instanceof Error ? err.message : String(err) });
  }
};
