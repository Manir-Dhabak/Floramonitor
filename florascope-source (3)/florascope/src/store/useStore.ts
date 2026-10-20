"use client";

import { create } from "zustand";
import { defaultCarbonParams, defaultDetectParams, defaultPlanting } from "@/lib/defaults";
import { DEMOS } from "@/lib/demos";
import { detectAsync } from "@/lib/engine";
import { georeference, scoreHealth } from "@/lib/detect";
import { convexHull } from "@/lib/cv";
import { attachHeight, fetchSource, loadOrtho, toWorkingRaster, type OrthoOptions, type SourceFile } from "@/lib/loader";
import type { TruthFile } from "@/lib/benchmark";
import type {
  Calibration,
  CalibCircle,
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
export type ViewMode = "inspect" | "edit" | "qa" | "merge" | "calibrate";
export type WizardStep = 1 | 2 | 3 | 4;

export type SnapKind = "edit" | "calib";
interface Snap {
  surveyId: string;
  kind: SnapKind;
  label: string;
  removed: number[];
  added: Tree[];
  qaPlots: QaPlot[];
  merges: [number, number][];
  calibration: Calibration;
}

export interface Wizard {
  step: WizardStep;
  prevParams: DetectParams;
  prevCount: number;
  applied: boolean;
  restoreFocus: boolean;
}
export type CalibKind = "crowns" | "ground";
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
  focusMode: boolean;
  sidebarOpen: boolean;
  undoStack: Snap[];
  wizard: Wizard | null;
  // actions
  setFocusMode: (v: boolean) => void;
  toggleSidebar: () => void;
  undo: (kind?: SnapKind) => void;
  canUndo: (kind?: SnapKind) => boolean;
  startCalibration: () => void;
  setWizardStep: (s: WizardStep) => void;
  finishCalibration: () => void;
  revertCalibration: () => Promise<void>;
  nudgeMerge: (dir: 1 | -1) => Promise<void>;
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
  calibKind: CalibKind;
  setCalibKind: (k: CalibKind) => void;
  addCalib: (kind: CalibKind, c: CalibCircle) => void;
  removeCalib: (kind: CalibKind, index: number) => void;
  clearCalib: () => void;
  applyCalibration: () => Promise<void>;
  mergeTrees: (keepId: number, absorbId: number) => void;
  undoMerge: () => void;
  setFieldPlots: (plots: FieldPlot[]) => void;
  updateFieldPlot: (id: string, patch: Partial<FieldPlot>) => void;
  select: (s: State["selectedTree"]) => void;
  focusOn: (x: number, y: number, zoom?: number) => void;
  reset: () => void;
}

const uid = () => Math.random().toString(36).slice(2, 10);

function snapOf(s: { surveys: Survey[]; activeId: string | null; undoStack: Snap[] }, kind: SnapKind, label: string): Snap[] {
  const v = s.surveys.find((x) => x.meta.id === s.activeId);
  if (!v) return s.undoStack;
  return [
    ...s.undoStack.slice(-79),
    { surveyId: v.meta.id, kind, label, removed: v.removed, added: v.added, qaPlots: v.qaPlots, merges: v.merges, calibration: v.calibration },
  ];
}
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
  focusMode: false,
  sidebarOpen: true,
  undoStack: [],
  wizard: null,

  setFocusMode: (v) => set({ focusMode: v }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  canUndo: (kind) => get().undoStack.some((u) => u.surveyId === get().activeId && (!kind || u.kind === kind)),
  undo: (kind) =>
    set((s) => {
      const stack = s.undoStack.slice();
      // only undo steps that belong to the active survey (and the requested kind)
      let idx = -1;
      for (let i = stack.length - 1; i >= 0; i--)
        if (stack[i].surveyId === s.activeId && (!kind || stack[i].kind === kind)) {
          idx = i;
          break;
        }
      if (idx < 0) return {};
      const snap = stack[idx];
      stack.splice(idx, 1);
      return {
        undoStack: stack,
        surveys: s.surveys.map((v) =>
          v.meta.id !== snap.surveyId
            ? v
            : snap.kind === "calib"
              ? { ...v, calibration: snap.calibration }
              : { ...v, removed: snap.removed, added: snap.added, qaPlots: snap.qaPlots, merges: snap.merges, calibration: snap.calibration },
        ),
      };
    }),
  startCalibration: () => {
    const s = get();
    const sv = s.surveys.find((v) => v.meta.id === s.activeId);
    if (!sv) return;
    set({
      wizard: {
        step: 1,
        prevParams: { ...sv.detectParams },
        prevCount: effectiveTrees(sv).length,
        applied: false,
        restoreFocus: s.focusMode,
      },
      mode: "calibrate",
      calibKind: "crowns",
      focusMode: true,
      tab: "imagery",
      selectedTree: null,
    });
  },
  setWizardStep: (step) =>
    set((s) =>
      s.wizard
        ? { wizard: { ...s.wizard, step }, mode: step === 4 ? "inspect" : "calibrate", calibKind: step === 3 ? "ground" : "crowns", selectedTree: null }
        : {},
    ),
  finishCalibration: () =>
    set((s) => ({ wizard: null, mode: "inspect", focusMode: s.wizard ? s.wizard.restoreFocus : s.focusMode })),
  revertCalibration: async () => {
    const s = get();
    const w = s.wizard;
    if (!w || !s.activeId) return;
    const id = s.activeId;
    set((st) => ({
      surveys: st.surveys.map((v) => (v.meta.id === id ? { ...v, detectParams: { ...w.prevParams } } : v)),
      wizard: null,
      mode: "inspect",
      focusMode: w.restoreFocus,
    }));
    await get().runDetection(id);
  },
  nudgeMerge: async (dir) => {
    const s = get();
    const sv = s.surveys.find((v) => v.meta.id === s.activeId);
    if (!sv) return;
    const cur = sv.detectParams.mergeStrength > 0 ? sv.detectParams.mergeStrength : (sv.detection?.stats.segInfo?.mergeT ?? 10);
    // one notch at a time: crown merging changes abruptly, so small steps keep control
    const next = Math.max(3, Math.min(40, dir > 0 ? Math.max(cur + 1, Math.round(cur * 1.12)) : Math.min(cur - 1, Math.round(cur / 1.12))));
    set((st) => ({
      surveys: st.surveys.map((v) => (v.meta.id === sv.meta.id ? { ...v, detectParams: { ...v.detectParams, mergeStrength: next } } : v)),
    }));
    await get().runDetection(sv.meta.id);
  },

  setTab: (t) =>
    set((s) => (s.wizard && t !== "imagery" ? { tab: t, wizard: null, mode: "inspect", focusMode: s.wizard.restoreFocus } : { tab: t })),
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
  setActive: (id) =>
    set((s) => ({
      activeId: id,
      selectedTree: null,
      ...(s.wizard && id !== s.activeId ? { wizard: null, mode: "inspect" as const, focusMode: s.wizard.restoreFocus } : {}),
    })),
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
          calibration: { crowns: [], ground: [] },
          merges: [],
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
        calibration: { crowns: [], ground: [] },
        merges: [],
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
          calib: sv.calibration.crowns.length ? sv.calibration : null,
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
                merges: [],
                qaPlots: v.qaPlots,
                editLog: v.removed.length ? [...v.editLog, { t: now(), action: "restore" as const }] : v.editLog,
              }
            : v,
        ),
        busy: null,
        selectedTree: null,
        undoStack: s.undoStack.filter((u) => u.surveyId !== id || u.kind === "calib"),
      }));
    } catch (e) {
      set({ busy: null, error: e instanceof Error ? e.message : String(e) });
    }
  },

  toggleRemove: (treeId) =>
    set((s) => ({
      undoStack: snapOf(s, "edit", "flag"),
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
      undoStack: snapOf(s, "edit", "add tree"),
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
      undoStack: snapOf(s, "edit", "delete tree"),
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
      undoStack: snapOf(s, "edit", "QA plot"),
      surveys: s.surveys.map((v) => {
        if (v.meta.id !== s.activeId) return v;
        const id = (v.qaPlots.reduce((m, q) => Math.max(m, q.id), 0) || 0) + 1;
        return { ...v, qaPlots: [...v.qaPlots, { ...p, id }], editLog: [...v.editLog, { t: now(), action: "qa-plot" }] };
      }),
    })),

  removeQaPlot: (id) =>
    set((s) => ({
      undoStack: snapOf(s, "edit", "remove QA plot"),
      surveys: s.surveys.map((v) => (v.meta.id !== s.activeId ? v : { ...v, qaPlots: v.qaPlots.filter((q) => q.id !== id) })),
    })),

  clearEdits: () =>
    set((s) => ({
      undoStack: snapOf(s, "edit", "reset edits"),
      surveys: s.surveys.map((v) => (v.meta.id !== s.activeId ? v : { ...v, removed: [], added: [], qaPlots: [], merges: [] })),
    })),

  calibKind: "crowns",
  setCalibKind: (k) => set({ calibKind: k }),
  addCalib: (kind, c) =>
    set((s) => ({
      undoStack: snapOf(s, "calib", "sample"),
      surveys: s.surveys.map((v) =>
        v.meta.id !== s.activeId ? v : { ...v, calibration: { ...v.calibration, [kind]: [...v.calibration[kind], c] } },
      ),
    })),
  removeCalib: (kind, index) =>
    set((s) => ({
      undoStack: snapOf(s, "calib", "remove sample"),
      surveys: s.surveys.map((v) =>
        v.meta.id !== s.activeId
          ? v
          : { ...v, calibration: { ...v.calibration, [kind]: v.calibration[kind].filter((_, i) => i !== index) } },
      ),
    })),
  clearCalib: () =>
    set((s) => ({
      undoStack: snapOf(s, "calib", "clear samples"),
      surveys: s.surveys.map((v) => (v.meta.id !== s.activeId ? v : { ...v, calibration: { crowns: [], ground: [] } })),
    })),
  applyCalibration: async () => {
    const st = get();
    const sv = st.surveys.find((v) => v.meta.id === st.activeId);
    if (!sv || !sv.calibration.crowns.length) return;
    const ds = sv.calibration.crowns.map((c) => 2 * c.r * sv.raster.gsd);
    let dMin = Math.min(...ds);
    let dMax = Math.max(...ds);
    if (ds.length === 1) {
      dMin *= 0.6;
      dMax *= 1.6;
    }
    const patch: Partial<DetectParams> = {
      markerSource: "segments",
      minCrownDiameterM: Number((dMin * 0.85).toFixed(2)),
      maxCrownDiameterM: Number((dMax * 1.2).toFixed(2)),
      minTreeSpacingM: Number((dMin * 0.7).toFixed(2)),
    };
    set((st) => ({
      surveys: st.surveys.map((v) =>
        v.meta.id !== sv.meta.id
          ? v
          : { ...v, detectParams: { ...v.detectParams, ...patch }, editLog: [...v.editLog, { t: now(), action: "calibrate" as const }] },
      ),
      mode: "inspect",
      selectedTree: null,
      wizard: st.wizard ? { ...st.wizard, applied: true, step: 4 } : null,
    }));
    await get().runDetection(sv.meta.id);
  },
  mergeTrees: (keepId, absorbId) =>
    set((s) => ({
      undoStack: snapOf(s, "edit", "merge"),
      surveys: s.surveys.map((v) =>
        v.meta.id !== s.activeId || keepId === absorbId
          ? v
          : {
              ...v,
              merges: [...v.merges, [keepId, absorbId] as [number, number]],
              editLog: [...v.editLog, { t: now(), action: "merge" as const, treeId: absorbId }],
            },
      ),
    })),
  undoMerge: () =>
    set((s) => ({
      surveys: s.surveys.map((v) => (v.meta.id !== s.activeId ? v : { ...v, merges: v.merges.slice(0, -1) })),
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
/** Union-find over analyst merges: absorbed tree id -> id of the tree it was merged into. */
export function mergeRoots(sv: Survey): Map<number, number> {
  const parent = new Map<number, number>();
  const find = (a: number): number => {
    let r = a;
    while (parent.has(r) && parent.get(r) !== r) r = parent.get(r) as number;
    return r;
  };
  for (const [keep, absorb] of sv.merges) {
    const rk = find(keep);
    const ra = find(absorb);
    if (rk !== ra) parent.set(ra, rk);
  }
  const out = new Map<number, number>();
  for (const id of parent.keys()) out.set(id, find(id));
  return out;
}

/** Trees used for all downstream analysis: auto detections not flagged (merged groups combined) + manual additions. */
export function effectiveTrees(sv: Survey | undefined | null): Tree[] {
  if (!sv || !sv.detection) return [];
  const rm = new Set(sv.removed);
  const roots = mergeRoots(sv);
  if (!roots.size) return [...sv.detection.trees.filter((t) => !rm.has(t.id)), ...sv.added];
  const byId = new Map(sv.detection.trees.map((t) => [t.id, t]));
  const groups = new Map<number, Tree[]>();
  for (const t of sv.detection.trees) {
    const r = roots.get(t.id) ?? t.id;
    if (rm.has(r)) continue;
    const g = groups.get(r);
    if (g) g.push(t);
    else groups.set(r, [t]);
  }
  const out: Tree[] = [];
  for (const [rootId, members] of groups) {
    const root = byId.get(rootId) as Tree;
    if (members.length === 1) {
      out.push(root);
      continue;
    }
    const A = members.reduce((s, t) => s + t.crownAreaM2, 0);
    const wavg = (f: (t: Tree) => number) => members.reduce((s, t) => s + f(t) * t.crownAreaM2, 0) / A;
    const pts: number[] = [];
    for (const t of members) pts.push(...t.hull);
    const hs = members.map((t) => t.heightM).filter((v): v is number => v !== null);
    const nd = members.every((t) => t.ndvi !== null) ? wavg((t) => t.ndvi as number) : null;
    const m: Tree = {
      ...root,
      x: wavg((t) => t.x),
      y: wavg((t) => t.y),
      crownAreaM2: A,
      crownDiameterM: 2 * Math.sqrt(A / Math.PI),
      heightM: hs.length ? Math.max(...hs) : null,
      vari: wavg((t) => t.vari),
      ndvi: nd,
      segIndexMean: wavg((t) => t.segIndexMean),
      hull: convexHull(pts),
      cluster: false,
    };
    if (sv.raster.geo) georeference([m], sv.raster.geo);
    out.push(m);
  }
  return [...out, ...sv.added];
}

export function rescoreManual(sv: Survey) {
  scoreHealth(sv.added, sv.detectParams);
}
