// Promise wrapper around the compute worker (with a main-thread fallback).

import type { CarbonInput } from "./carbon";
import type { DetectInput } from "./detect";
import type { CarbonResult, DetectParams, DetectResult } from "./types";

type Pending = {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  onProgress?: (stage: string, pct: number) => void;
};

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, Pending>();

function getWorker(): Worker | null {
  if (typeof window === "undefined") return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL("../workers/engine.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent) => {
      const m = e.data;
      const p = pending.get(m.id);
      if (!p) return;
      if (m.type === "progress") p.onProgress?.(m.stage, m.pct);
      else if (m.type === "error") {
        pending.delete(m.id);
        p.reject(new Error(m.message));
      } else if (m.type === "detect-done") {
        pending.delete(m.id);
        p.resolve(m.result);
      } else if (m.type === "carbon-done") {
        pending.delete(m.id);
        p.resolve({ result: m.result, samples: m.samples });
      }
    };
    worker.onerror = (e) => {
      for (const [, p] of pending) p.reject(new Error(e.message || "Worker error"));
      pending.clear();
    };
  } catch {
    worker = null;
  }
  return worker;
}

export async function detectAsync(
  input: DetectInput,
  params: DetectParams,
  onProgress?: (stage: string, pct: number) => void,
): Promise<DetectResult> {
  const w = getWorker();
  if (!w) {
    const { runDetection } = await import("./detect");
    return runDetection(input, params, onProgress);
  }
  const id = ++seq;
  return new Promise<DetectResult>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject, onProgress });
    // copy typed arrays (the survey keeps its own raster)
    w.postMessage({ type: "detect", id, input, params });
  });
}

export async function carbonAsync(input: CarbonInput): Promise<{ result: CarbonResult; samples: Float64Array }> {
  const w = getWorker();
  if (!w) {
    const { runCarbon } = await import("./carbon");
    return runCarbon(input);
  }
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    w.postMessage({ type: "carbon", id, input });
  });
}
