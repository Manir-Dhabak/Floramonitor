"use client";

import { create } from "zustand";
import { defaultCarbonParams, defaultDetectParams, defaultPlanting } from "@/lib/defaults";
import { DEMOS } from "@/lib/demos";
import { detectAsync } from "@/lib/engine";
import { georeference, scoreHealth } from "@/lib/detect";
import { attachHeight, fetchSource, loadOrtho, toWorkingRaster, type OrthoOptions, type SourceFile } from "@/lib/loader";
import type { TruthFile } from "@/lib/benchmark";
import type {
  CarbonParams,
  DetectParams,
  Ecosystem,
  FieldPlot,
  HeightMode,
  PlantingParams,
  QaPlot,
  Survey,
  Tree,
} from "@/lib/types";

export type TabKey = "imagery" | "map" | "survival" | "carbon" | "qa" | "change" | "audit" | "report";
export type ViewMode = "inspect" | "edit" | "qa";
export type BaseLayer = "rgb" | "height" | "index";

export interface Overlays {
  crowns: boolean;
  points: boolean;
  gaps: boolean;
  plots: boolean;
  qa: boolean;
  hull: boolean;
  change: boolean;
}

export interface ProjectInfo {
  name: string;
  developer: string;
  standard: string;
  ecosystem: Ecosystem;
}

interface Busy {
  label: string;
  pct: number;
}

interface State {
  project: ProjectInfo;
  surveys: Survey[];
  activeId: string | null;
  baselineId: string | null;
  planting: PlantingParams;
  carbon: CarbonParams;
  truth: Record<string, TruthFile>;
  busy: Busy | null;
  error: string | null;
  tab: TabKey;
  mode: ViewMode;
  base: BaseLayer;
  overlays: Overlays;
  selectedTree: { surveyId: string; treeId: number; source: "auto" | "manual" } | null;
  focus: { x: number; y: number; zoom?: number; t: number } | null;
  // actions
  setTab: (t: TabKey) => void;
  setMode: (m: ViewMode) => void;
  setBase: (b: BaseLayer) => void;
  toggleOverlay: (k: keyof Overlays) => void;
  setProject: (p: Partial<ProjectInfo>) => void;
  setPlanting: (p: Partial<PlantingParams>) => void;
  setCarbon: (p: Partial<CarbonParams>) => void;
  setDetectParams: (id: string, p: Partial<DetectParams>) => void;
  setActive: (id: string) => void;
  setBaseline: (id: string | null) => void;
  setError: (e: string | null) => void;
  loadDemo: (key: "arr" | "mangrove") => Promise<void>;
  addSurvey: (args: {
    ortho: SourceFile;
    height: SourceFile | null;
    heightMode: HeightMode;
    options: OrthoOptions;
    name: string;
    date: string;
    site: string;
  }) => Promise<void>;
  removeSurvey: (id: string) => void;
  runDetection: (id: string) => Promise<void>;
  toggleRemove: (treeId: number) => void;
  addManualTree: (x: number, y: number) => void;
  deleteManual: (treeId: number) => void;
  addQaPlot: (p: Omit<QaPlot, "id">) => void;
  removeQaPlot: (id: number) => void;
  clearEdits: () => void;
  setFieldPlots: (plots: FieldPlot[]) => void;
  updateFieldPlot: (id: string, patch: Partial<FieldPlot>) => void;
  select: (s: State["selectedTree"]) => void;
  focusOn: (x: number, y: number, zoom?: number) => void;
  reset: () => void;
}

const uid = () => Math.random().toString(36).slice(2, 10);
const now = () => new Date().toISOString();

const initialProject: ProjectInfo = {
  name: "New FloraScope project",
  developer: "Flora Carbon AI",
  standard: "Verra VCS — VM0047 v1.1 (census-based)",
  ecosystem: "arr",
};

export const useStore = create<State>((set, get) => ({
  project: initialProject,
  surveys: [],
  activeId: null,
  baselineId: null,
  planting: defaultPlanting("arr"),
  carbon: defaultCarbonParams("arr"),
  truth: {},
  busy: null,
  error: null,
  tab: "imagery",
  mode: "inspect",
  base: "rgb",
  overlays: { crowns: true, points: true, gaps: false, plots: true, qa: true, hull: false, change: true },
  selectedTree: null,
  focus: null,

  setTab: (t) => set({ tab: t }),
  setMode: (m) => set({ mode: m }),
  setBase: (b) => set({ base: b }),
  toggleOverlay: (k) => set((s) => ({ overlays: { ...s.overlays, [k]: !s.overlays[k] } })),
  setProject: (p) =>
    set((s) => {
      const project = { ...s.project, ...p };
      if (p.ecosystem && p.ecosystem !== s.project.ecosystem)
        return { project, planting: defaultPlanting(p.ecosystem), carbon: defaultCarbonParams(p.ecosystem) };
      return { project };
    }),
  setPlanting: (p) => set((s) => ({ planting: { ...s.planting, ...p } })),
  setCarbon: (p) => set((s) => ({ carbon: { ...s.carbon, ...p } })),
  setDetectParams: (id, p) =>
    set((s) => ({ surveys: s.surveys.map((v) => (v.meta.id === id ? { ...v, detectParams: { ...v.detectParams, ...p } } : v)) })),
  setActive: (id) => set({ activeId: id, selectedTree: null }),
  setBaseline: (id) => set({ baselineId: id }),
  setError: (e) => set({ error: e }),
  select: (sel) => set({ selectedTree: sel }),
  focusOn: (x, y, zoom) => set({ focus: { x, y, zoom, t: Date.now() } }),

  reset: () =>
    set({
      project: initialProject,
      surveys: [],
      activeId: null,
      baselineId: null,
      truth: {},
      planting: defaultPlanting("arr"),
      carbon: defaultCarbonParams("arr"),
      selectedTree: null,
      error: null,
    }),

  loadDemo: async (key) => {
    const demo = DEMOS[key];
    set({
      busy: { label: "Downloading demo imagery", pct: 2 },
      error: null,
      surveys: [],
      activeId: null,
      baselineId: null,
      truth: {},
      project: {
        name: `${demo.title} — demo`,
        developer: "Flora Carbon AI",
        standard: demo.ecosystem === "mangrove" ? "Verra VCS — VM0033 v2.1 / blue carbon (demo)" : "Verra VCS — VM0047 v1.1 (census-based)",
        ecosystem: demo.ecosystem,
      },
      planting: defaultPlanting(demo.ecosystem),
      carbon: defaultCarbonParams(demo.ecosystem),
      tab: "imagery",
      selectedTree: null,
    });
    try {
      const created: Survey[] = [];
      for (let k = 0; k < demo.surveys.length; k++) {
        const ds = demo.surveys[k];
        set({ busy: { label: `Loading ${ds.name}`, pct: 5 + (k * 90) / demo.surveys.length } });
        const [rgb, chm, truth] = await Promise.all([
          fetchSource(ds.rgb),
          fetchSource(ds.chm),
          fetch(ds.truth).then((r) => r.json() as Promise<TruthFile>),
        ]);
        const base = await loadOrtho(rgb, { maxPixels: 16e6, gsdFallback: 0.05, epsgOverride: null, worldFile: null, bandMap: null });
        const h = await attachHeight(base, chm, "chm", 8);
        const raster = toWorkingRaster(base, h, "chm");
        const survey: Survey = {
          meta: {
            id: uid(),
            name: ds.name,
            site: demo.site,
            date: ds.date,
            ecosystem: demo.ecosystem,
            demo: ds.key,
            truthUrl: ds.truth,
            createdAt: now(),
          },
          raster,
          detectParams: defaultDetectParams(demo.ecosystem, truth.planting_spacing_m[0]),
          detection: null,
          removed: [],
          added: [],
          qaPlots: [],
          editLog: [],
          fieldPlots: [],
        };
        created.push(survey);
        set((s) => ({ truth: { ...s.truth, [survey.meta.id]: truth } }));
      }
      const latest = created[created.length - 1];
      // demo planting records: planted count / design density gives the planted area
      const lt = get().truth[latest.meta.id];
      if (lt) {
        const sp = lt.planting_spacing_m;
        set((s) => ({
          planting: {
            ...s.planting,
            spacingX: sp[0],
            spacingY: sp[1],
            plantedAreaMode: "manual",
            plantedAreaHa: Number(((lt.planted * sp[0] * sp[1]) / 10000).toFixed(4)),
          },
        }));
      }
      set({
        surveys: created,
        activeId: latest.meta.id,
        baselineId: created.length > 1 ? created[0].meta.id : null,
      });
      for (const sv of created) await get().runDetection(sv.meta.id);
      set({ busy: null, activeId: latest.meta.id });
    } catch (e) {
      set({ busy: null, error: e instanceof Error ? e.message : String(e) });
    }
  },

  addSurvey: async ({ ortho, height, heightMode, options, name, date, site }) => {
    set({ busy: { label: "Reading orthomosaic", pct: 5 }, error: null });
    try {
      const eco = get().project.ecosystem;
      const base = await loadOrtho(ortho, options);
      set({ busy: { label: height ? "Aligning height layer" : "Preparing image", pct: 25 } });
      const h = height && heightMode !== "none" ? await attachHeight(base, height, heightMode, 8) : null;
      const raster = toWorkingRaster(base, h, h ? heightMode : "none");
      const dp = defaultDetectParams(eco, get().planting.spacingX);
      if (!h) dp.markerSource = "rgb";
      const survey: Survey = {
        meta: { id: uid(), name, site, date, ecosystem: eco, demo: null, truthUrl: null, createdAt: now() },
        raster,
        detectParams: dp,
        detection: null,
        removed: [],
        added: [],
        qaPlots: [],
        editLog: [],
        fieldPlots: [],
      };
      set((s) => ({
        surveys: [...s.surveys, survey],
        activeId: survey.meta.id,
        baselineId: s.baselineId ?? (s.surveys.length ? s.surveys[s.surveys.length - 1].meta.id : null),
      }));
      await get().runDetection(survey.meta.id);
      set({ busy: null, tab: "imagery" });
    } catch (e) {
      set({ busy: null, error: e instanceof Error ? e.message : String(e) });
    }
  },

  removeSurvey: (id) =>
    set((s) => {
      const surveys = s.surveys.filter((v) => v.meta.id !== id);
      return {
        surveys,
        activeId: s.activeId === id ? (surveys[surveys.length - 1]?.meta.id ?? null) : s.activeId,
        baselineId: s.baselineId === id ? null : s.baselineId,
      };
    }),

  runDetection: async (id) => {
    const sv = get().surveys.find((v) => v.meta.id === id);
    if (!sv) return;
    const r = sv.raster;
    set({ busy: { label: `Detecting trees — ${sv.meta.name}`, pct: 0 } });
    try {
      const res = await detectAsync(
        {
          width: r.width,
          height: r.height,
          rgba: r.rgba,
          valid: r.valid,
          nir: r.nir,
          redRaw: r.redRaw,
          heightLayer: r.heightLayer,
          gsd: r.gsd,
          geo: r.geo,
        },
        sv.detectParams,
        (stage, pct) => set({ busy: { label: `${sv.meta.name}: ${stage}`, pct } }),
      );
      set((s) => ({
        surveys: s.surveys.map((v) =>
          v.meta.id === id
            ? {
                ...v,
                detection: res,
                // re-running detection invalidates edits tied to old ids
                removed: [],
                qaPlots: v.qaPlots,
                editLog: v.removed.length ? [...v.editLog, { t: now(), action: "restore" as const }] : v.editLog,
              }
            : v,
        ),
        busy: null,
        selectedTree: null,
      }));
    } catch (e) {
      set({ busy: null, error: e instanceof Error ? e.message : String(e) });
    }
  },

  toggleRemove: (treeId) =>
    set((s) => ({
      surveys: s.surveys.map((v) => {
        if (v.meta.id !== s.activeId) return v;
        const has = v.removed.includes(treeId);
        return {
          ...v,
          removed: has ? v.removed.filter((x) => x !== treeId) : [...v.removed, treeId],
          editLog: [...v.editLog, { t: now(), action: has ? "restore" : "remove", treeId }],
        };
      }),
    })),

  addManualTree: (x, y) =>
    set((s) => ({
      surveys: s.surveys.map((v) => {
        if (v.meta.id !== s.activeId || !v.detection) return v;
        const r = v.raster;
        const auto = v.detection.trees;
        const cds = auto.map((t) => t.crownDiameterM).sort((a, b) => a - b);
        const medCd = cds.length ? cds[cds.length >> 1] : 1;
        // height: max of the height layer within ~0.4 m
        let hgt: number | null = null;
        if (r.heightLayer) {
          const rr = Math.max(1, Math.round(0.4 / r.gsd));
          let m = -Infinity;
          for (let dy = -rr; dy <= rr; dy++)
            for (let dx = -rr; dx <= rr; dx++) {
              const xx = Math.round(x) + dx;
              const yy = Math.round(y) + dy;
              if (xx < 0 || yy < 0 || xx >= r.width || yy >= r.height) continue;
              const hv = r.heightLayer[yy * r.width + xx];
              if (Number.isFinite(hv) && hv > m) m = hv;
            }
          hgt = Number.isFinite(m) ? m : null;
        }
        const i = Math.round(y) * r.width + Math.round(x);
        const R = r.rgba[4 * i];
        const G = r.rgba[4 * i + 1];
        const B = r.rgba[4 * i + 2];
        const den = G + R - B;
        const nextId = (v.added.reduce((m, t) => Math.max(m, t.id), 0) || 0) + 1;
        const t: Tree = {
          id: nextId,
          x,
          y,
          mx: null,
          my: null,
          lon: null,
          lat: null,
          crownAreaM2: Math.PI * (medCd / 2) ** 2,
          crownDiameterM: medCd,
          heightM: hgt,
          vari: Math.abs(den) < 1 ? 0 : (G - R) / den,
          ndvi: null,
          segIndexMean: 0,
          healthZ: 0,
          health: "watch",
          hull: [],
          source: "manual",
          cluster: false,
        };
        if (r.geo) georeference([t], r.geo);
        return { ...v, added: [...v.added, t], editLog: [...v.editLog, { t: now(), action: "add", treeId: nextId, x, y }] };
      }),
    })),

  deleteManual: (treeId) =>
    set((s) => ({
      surveys: s.surveys.map((v) =>
        v.meta.id !== s.activeId
          ? v
          : {
              ...v,
              added: v.added.filter((t) => t.id !== treeId),
              editLog: [...v.editLog, { t: now(), action: "delete-manual", treeId }],
            },
      ),
    })),

  addQaPlot: (p) =>
    set((s) => ({
      surveys: s.surveys.map((v) => {
        if (v.meta.id !== s.activeId) return v;
        const id = (v.qaPlots.reduce((m, q) => Math.max(m, q.id), 0) || 0) + 1;
        return { ...v, qaPlots: [...v.qaPlots, { ...p, id }], editLog: [...v.editLog, { t: now(), action: "qa-plot" }] };
      }),
    })),

  removeQaPlot: (id) =>
    set((s) => ({
      surveys: s.surveys.map((v) => (v.meta.id !== s.activeId ? v : { ...v, qaPlots: v.qaPlots.filter((q) => q.id !== id) })),
    })),

  clearEdits: () =>
    set((s) => ({
      surveys: s.surveys.map((v) => (v.meta.id !== s.activeId ? v : { ...v, removed: [], added: [], qaPlots: [] })),
    })),

  setFieldPlots: (plots) =>
    set((s) => ({ surveys: s.surveys.map((v) => (v.meta.id !== s.activeId ? v : { ...v, fieldPlots: plots })) })),

  updateFieldPlot: (id, patch) =>
    set((s) => ({
      surveys: s.surveys.map((v) =>
        v.meta.id !== s.activeId ? v : { ...v, fieldPlots: v.fieldPlots.map((p) => (p.id === id ? { ...p, ...patch } : p)) },
      ),
    })),
}));

/** Trees used for all downstream analysis: auto detections not flagged + manual additions. */
export function effectiveTrees(sv: Survey | undefined | null): Tree[] {
  if (!sv || !sv.detection) return [];
  const rm = new Set(sv.removed);
  return [...sv.detection.trees.filter((t) => !rm.has(t.id)), ...sv.added];
}

export function rescoreManual(sv: Survey) {
  scoreHealth(sv.added, sv.detectParams);
}
