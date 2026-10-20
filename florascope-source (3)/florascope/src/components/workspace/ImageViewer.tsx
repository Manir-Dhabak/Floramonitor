"use client";

import {
  Check,
  Combine,
  Crosshair,
  Eye,
  Layers,
  Maximize,
  Maximize2,
  Minimize2,
  MousePointer2,
  PenLine,
  Sparkles,
  Square,
  Trees,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { pixelToLonLat } from "@/lib/geo";
import { crownCanvas, heightCanvas, indexCanvas, niceScale, rgbCanvas } from "@/lib/render";
import { treeId } from "@/lib/exports";
import type { Tree } from "@/lib/types";
import { mergeRoots, useStore } from "@/store/useStore";
import { CALIB_COLORS, CalibrationWizard, DenseCanopyBanner } from "./Calibration";
import { useAnalysis } from "./AnalysisContext";
import { Badge, Button, Segmented, cx, fmt } from "@/components/ui";
import { HEALTH_COLORS } from "@/components/ui/charts";

interface ViewT {
  s: number;
  tx: number;
  ty: number;
}

const HEALTH = HEALTH_COLORS;

export function ImageViewer({ variant = "full" }: { variant?: "full" | "change" | "qa" }) {
  const an = useAnalysis();
  const active = an.active;
  const sv = active?.survey ?? null;
  const mode = useStore((s) => s.mode);
  const setMode = useStore((s) => s.setMode);
  const base = useStore((s) => s.base);
  const setBase = useStore((s) => s.setBase);
  const overlays = useStore((s) => s.overlays);
  const toggleOverlay = useStore((s) => s.toggleOverlay);
  const toggleRemove = useStore((s) => s.toggleRemove);
  const addManualTree = useStore((s) => s.addManualTree);
  const deleteManual = useStore((s) => s.deleteManual);
  const addQaPlot = useStore((s) => s.addQaPlot);
  const select = useStore((s) => s.select);
  const selected = useStore((s) => s.selectedTree);
  const focus = useStore((s) => s.focus);
  const calibKind = useStore((s) => s.calibKind);
  const addCalib = useStore((s) => s.addCalib);
  const mergeTrees = useStore((s) => s.mergeTrees);
  const wizard = useStore((s) => s.wizard);
  const focusMode = useStore((s) => s.focusMode);
  const setFocusMode = useStore((s) => s.setFocusMode);
  const startCalibration = useStore((s) => s.startCalibration);
  const undo = useStore((s) => s.undo);
  const canUndo = useStore((s) => s.undoStack.some((u) => u.surveyId === s.activeId && u.kind === "edit"));
  const [mergeSource, setMergeSource] = useState<number | null>(null);
  const [layersOpen, setLayersOpen] = useState(false);
  const [nudge, setNudge] = useState(0);
  const drawing = mode === "calibrate" && variant !== "change";
  const wizStep = variant === "full" ? (wizard?.step ?? null) : null;

  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const miniRef = useRef<HTMLCanvasElement>(null);
  const view = useRef<ViewT>({ s: 1, tx: 0, ty: 0 });
  const size = useRef({ w: 800, h: 600 });
  const dirty = useRef(true);
  const drag = useRef<{
    x: number;
    y: number;
    tx: number;
    ty: number;
    moved: boolean;
    button: number;
    rect?: [number, number, number, number];
    circle?: [number, number, number];
  } | null>(null);
  const [hover, setHover] = useState<{ sx: number; sy: number; tree: Tree | null; ix: number; iy: number } | null>(null);
  const [zoomLabel, setZoomLabel] = useState(1);
  const space = useRef(false);
  const userMoved = useRef(false); // false while the view is still "fit to screen"

  const removedSet = useMemo(() => new Set(sv?.removed ?? []), [sv?.removed]);
  const rgb = useMemo(() => (sv ? rgbCanvas(sv.raster) : null), [sv?.raster]); // eslint-disable-line react-hooks/exhaustive-deps
  const hgt = useMemo(() => (sv && base === "height" ? heightCanvas(sv.raster) : null), [sv?.raster, base]); // eslint-disable-line react-hooks/exhaustive-deps
  const idx = useMemo(() => (sv && base === "index" ? indexCanvas(sv.raster) : null), [sv?.raster, base]); // eslint-disable-line react-hooks/exhaustive-deps
  const roots = useMemo(() => (sv ? mergeRoots(sv) : new Map<number, number>()), [sv?.merges]); // eslint-disable-line react-hooks/exhaustive-deps
  const crowns = useMemo(
    () => (sv?.detection ? crownCanvas(sv.raster, sv.detection, removedSet, roots) : null),
    [sv?.raster, sv?.detection, removedSet, roots], // eslint-disable-line react-hooks/exhaustive-deps
  );
  useEffect(() => {
    if (mode !== "merge") setMergeSource(null);
  }, [mode]);

  const co2ByTree = useMemo(() => {
    const m = new Map<string, number>();
    const c = active?.carbon;
    if (!c || !active) return m;
    active.trees.forEach((t, i) => m.set(`${t.source}-${t.id}`, c.perTreeKgCo2e[i]));
    return m;
  }, [active]);

  // change overlay data (current survey is "active")
  const changeMarks = useMemo(() => {
    if (variant !== "change" || !an.change || !an.baseline || !sv) return null;
    const ch = an.change;
    const activeIsLater = Date.parse(sv.meta.date) >= Date.parse(an.baseline.survey.meta.date);
    const baseTrees = an.baseline.trees;
    const curTrees = active!.trees;
    const lost: [number, number][] = [];
    const recruited: [number, number][] = [];
    const survived: [number, number][] = [];
    // map baseline trees into active image coordinates via map coords when available
    const g = sv.raster.geo;
    const toActive = (t: Tree): [number, number] => {
      if (g && t.mx !== null && t.my !== null && ch.coordBasis === "map")
        return [(t.mx - g.originX) / g.resX - 0.5, (g.originY - t.my) / g.resY - 0.5];
      const k = an.baseline!.survey.raster.gsd / sv.raster.gsd;
      return [t.x * k, t.y * k];
    };
    const firstTrees = activeIsLater ? baseTrees : curTrees;
    const secondTrees = activeIsLater ? curTrees : baseTrees;
    for (const i of ch.lostIdx) lost.push(activeIsLater ? toActive(firstTrees[i]) : [firstTrees[i].x, firstTrees[i].y]);
    for (const j of ch.newIdx) recruited.push(activeIsLater ? [secondTrees[j].x, secondTrees[j].y] : toActive(secondTrees[j]));
    for (const [, j] of ch.pairs) survived.push(activeIsLater ? [secondTrees[j].x, secondTrees[j].y] : toActive(secondTrees[j]));
    return { lost, recruited, survived };
  }, [variant, an.change, an.baseline, sv, active]);

  const W = sv?.raster.width ?? 1;
  const H = sv?.raster.height ?? 1;

  const fit = useCallback(() => {
    const { w, h } = size.current;
    const s = Math.min(w / W, h / H) * 0.96;
    view.current = { s, tx: (w - W * s) / 2, ty: (h - H * s) / 2 };
    userMoved.current = false;
    setZoomLabel(s);
    dirty.current = true;
  }, [W, H]);

  // resize
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      const c = canvasRef.current!;
      const dpr = window.devicePixelRatio || 1;
      c.width = Math.max(1, Math.round(r.width * dpr));
      c.height = Math.max(1, Math.round(r.height * dpr));
      c.style.width = `${r.width}px`;
      c.style.height = `${r.height}px`;
      const first = size.current.w === 800 && size.current.h === 600;
      const prev = size.current;
      size.current = { w: r.width, h: r.height };
      if (first || !userMoved.current) fit();
      else {
        // panels opened/closed: keep the same spot in the middle of the view
        const v = view.current;
        view.current = { ...v, tx: v.tx + (r.width - prev.w) / 2, ty: v.ty + (r.height - prev.h) / 2 };
      }
      dirty.current = true;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit]);

  useEffect(() => {
    fit();
  }, [sv?.meta.id, fit]);

  useEffect(() => {
    if (!focus) return;
    const { w, h } = size.current;
    const s = focus.zoom ?? Math.max(view.current.s, 3);
    view.current = { s, tx: w / 2 - focus.x * s, ty: h / 2 - focus.y * s };
    userMoved.current = true;
    setZoomLabel(s);
    dirty.current = true;
  }, [focus]);

  useEffect(() => {
    dirty.current = true;
  }, [rgb, hgt, idx, crowns, overlays, base, sv, active, hover, selected, changeMarks, mode, mergeSource, wizStep]);

  // render loop
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      if (!dirty.current) return;
      dirty.current = false;
      const c = canvasRef.current;
      if (!c || !sv) return;
      const ctx = c.getContext("2d")!;
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = "#070b09";
      ctx.fillRect(0, 0, c.width, c.height);
      const { s, tx, ty } = view.current;
      ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * tx, dpr * ty);
      ctx.imageSmoothingEnabled = s < 2.5;
      const baseCanvas = base === "height" && hgt ? hgt.canvas : base === "index" && idx ? idx : rgb;
      if (baseCanvas) ctx.drawImage(baseCanvas, 0, 0);
      if (overlays.crowns && crowns && variant !== "change" && !drawing) ctx.drawImage(crowns, 0, 0);

      const lw = 1 / s; // 1 screen px
      const surv = active?.survival;
      if (overlays.hull && !drawing && surv && surv.plantedHull.length >= 6) {
        ctx.beginPath();
        for (let k = 0; k < surv.plantedHull.length; k += 2) {
          if (k === 0) ctx.moveTo(surv.plantedHull[k], surv.plantedHull[k + 1]);
          else ctx.lineTo(surv.plantedHull[k], surv.plantedHull[k + 1]);
        }
        ctx.closePath();
        ctx.setLineDash([6 * lw, 4 * lw]);
        ctx.strokeStyle = "rgba(92,200,242,.9)";
        ctx.lineWidth = 1.5 * lw;
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (overlays.gaps && !drawing && surv) {
        for (const cell of surv.cells) {
          if (cell.plantableHa <= 0) continue;
          const r = Math.min(1.5, cell.ratio);
          if (cell.gap) ctx.fillStyle = "rgba(242,104,92,.38)";
          else ctx.fillStyle = `rgba(61,220,151,${0.05 + 0.12 * Math.min(1, r)})`;
          ctx.fillRect(cell.x0, cell.y0, cell.x1 - cell.x0, cell.y1 - cell.y0);
          ctx.strokeStyle = cell.gap ? "rgba(242,104,92,.9)" : "rgba(232,241,236,.12)";
          ctx.lineWidth = lw;
          ctx.strokeRect(cell.x0, cell.y0, cell.x1 - cell.x0, cell.y1 - cell.y0);
          if (s * (cell.x1 - cell.x0) > 60) {
            ctx.fillStyle = cell.gap ? "#ffd2cc" : "rgba(232,241,236,.75)";
            ctx.font = `${11 * lw}px var(--font-geist-sans), sans-serif`;
            ctx.fillText(`${Math.round(cell.ratio * 100)}%`, cell.x0 + 4 * lw, cell.y0 + 13 * lw);
          }
        }
      }
      if (overlays.qa && variant !== "change" && !drawing) {
        for (const p of sv.qaPlots) {
          ctx.setLineDash([5 * lw, 3 * lw]);
          ctx.strokeStyle = "#b39bff";
          ctx.lineWidth = 2 * lw;
          ctx.strokeRect(Math.min(p.x0, p.x1), Math.min(p.y0, p.y1), Math.abs(p.x1 - p.x0), Math.abs(p.y1 - p.y0));
          ctx.setLineDash([]);
          ctx.fillStyle = "#b39bff";
          ctx.font = `600 ${11 * lw}px var(--font-geist-sans), sans-serif`;
          ctx.fillText(`QA ${p.id}`, Math.min(p.x0, p.x1) + 3 * lw, Math.min(p.y0, p.y1) - 4 * lw);
        }
      }
      if (overlays.plots && variant !== "change" && !drawing) {
        for (const p of sv.fieldPlots) {
          const r = p.radiusM / sv.raster.gsd;
          ctx.beginPath();
          ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
          ctx.strokeStyle = "#5cc8f2";
          ctx.lineWidth = 2 * lw;
          ctx.stroke();
          ctx.fillStyle = "rgba(92,200,242,.08)";
          ctx.fill();
          ctx.fillStyle = "#5cc8f2";
          ctx.font = `600 ${11 * lw}px var(--font-geist-sans), sans-serif`;
          ctx.fillText(p.id, p.x + r + 3 * lw, p.y + 4 * lw);
        }
      }
      // trees
      if (variant !== "change" && active && overlays.points && !drawing) {
        const x0 = -tx / s - 10;
        const y0 = -ty / s - 10;
        const x1 = (size.current.w - tx) / s + 10;
        const y1 = (size.current.h - ty) / s + 10;
        const rr = Math.max(4, Math.min(6, s * 1.6)) * lw;
        const det = sv.detection;
        if (det) {
          ctx.strokeStyle = "#b0bab5";
          ctx.lineWidth = 1.6 * lw;
          for (const t of det.trees) {
            if (!removedSet.has(t.id) || t.x < x0 || t.y < y0 || t.x > x1 || t.y > y1) continue;
            const d = 4 * lw;
            ctx.beginPath();
            ctx.moveTo(t.x - d, t.y - d);
            ctx.lineTo(t.x + d, t.y + d);
            ctx.moveTo(t.x + d, t.y - d);
            ctx.lineTo(t.x - d, t.y + d);
            ctx.stroke();
          }
          for (const t of active.trees) {
            if (t.source !== "auto" || t.x < x0 || t.y < y0 || t.x > x1 || t.y > y1) continue;
            ctx.beginPath();
            ctx.arc(t.x, t.y, rr + 1.6 * lw, 0, Math.PI * 2);
            ctx.fillStyle = "rgba(4,12,8,.75)";
            ctx.fill();
            ctx.beginPath();
            ctx.arc(t.x, t.y, rr, 0, Math.PI * 2);
            ctx.fillStyle = HEALTH[t.health];
            ctx.fill();
            ctx.strokeStyle = "#ffffff";
            ctx.lineWidth = 1.4 * lw;
            ctx.stroke();
          }
        }
        for (const t of sv.added) {
          ctx.beginPath();
          ctx.arc(t.x, t.y, 5 * lw, 0, Math.PI * 2);
          ctx.strokeStyle = "#b39bff";
          ctx.lineWidth = 2 * lw;
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(t.x, t.y, 1.8 * lw, 0, Math.PI * 2);
          ctx.fillStyle = "#b39bff";
          ctx.fill();
        }
      }
      if (changeMarks) {
        const rr = Math.max(1.8, Math.min(4, s * 1.2)) * lw;
        ctx.fillStyle = "rgba(61,220,151,.85)";
        for (const [x, y] of changeMarks.survived) {
          ctx.beginPath();
          ctx.arc(x, y, rr, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.strokeStyle = "#f2685c";
        ctx.lineWidth = 2 * lw;
        for (const [x, y] of changeMarks.lost) {
          const d = 5 * lw;
          ctx.beginPath();
          ctx.moveTo(x - d, y - d);
          ctx.lineTo(x + d, y + d);
          ctx.moveTo(x + d, y - d);
          ctx.lineTo(x - d, y + d);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(x, y, 7 * lw, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.strokeStyle = "#5cc8f2";
        for (const [x, y] of changeMarks.recruited) {
          const d = 5 * lw;
          ctx.beginPath();
          ctx.moveTo(x - d, y);
          ctx.lineTo(x + d, y);
          ctx.moveTo(x, y - d);
          ctx.lineTo(x, y + d);
          ctx.stroke();
        }
      }
      // selection
      if (selected && selected.surveyId === sv.meta.id && !drawing) {
        const t =
          selected.source === "manual"
            ? sv.added.find((q) => q.id === selected.treeId)
            : sv.detection?.trees.find((q) => q.id === selected.treeId);
        if (t) {
          const r = Math.max(8 * lw, (t.crownDiameterM / sv.raster.gsd) * 0.6);
          ctx.beginPath();
          ctx.arc(t.x, t.y, r, 0, Math.PI * 2);
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 2 * lw;
          ctx.setLineDash([4 * lw, 3 * lw]);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
      // calibration samples (only while drawing them — the image stays clean otherwise)
      if (drawing) {
        const drawC = (c: { x: number; y: number; r: number }, col: string, label: string, strong: boolean) => {
          ctx.globalAlpha = strong ? 1 : 0.45;
          ctx.beginPath();
          ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
          ctx.fillStyle = col + "22";
          ctx.fill();
          ctx.strokeStyle = col;
          ctx.lineWidth = (strong ? 2.5 : 1.5) * lw;
          ctx.setLineDash(strong ? [] : [5 * lw, 4 * lw]);
          ctx.stroke();
          ctx.setLineDash([]);
          if (strong) {
            ctx.beginPath();
            ctx.arc(c.x, c.y, 2.2 * lw, 0, Math.PI * 2);
            ctx.fillStyle = col;
            ctx.fill();
            ctx.font = `600 ${13 * lw}px system-ui, sans-serif`;
            ctx.lineWidth = 3 * lw;
            ctx.strokeStyle = "rgba(4,10,7,.85)";
            ctx.strokeText(label, c.x - c.r, c.y - c.r - 5 * lw);
            ctx.fillText(label, c.x - c.r, c.y - c.r - 5 * lw);
          }
          ctx.globalAlpha = 1;
        };
        sv.calibration.crowns.forEach((c) => {
          const big = c.tag === "large";
          drawC(c, big ? CALIB_COLORS.large : CALIB_COLORS.small, `${big ? "big" : "small"} · Ø ${(2 * c.r * sv.raster.gsd).toFixed(1)} m`, wizStep === null || wizStep === (big ? 2 : 1));
        });
        sv.calibration.ground.forEach((c, i) => drawC(c, CALIB_COLORS.ground, `not a tree ${i + 1}`, wizStep === null || wizStep === 3));
        const dc = drag.current?.circle;
        if (dc) {
          const col = wizStep === 3 || (wizStep === null && calibKind === "ground") ? CALIB_COLORS.ground : wizStep === 2 ? CALIB_COLORS.large : CALIB_COLORS.small;
          ctx.beginPath();
          ctx.arc(dc[0], dc[1], dc[2], 0, Math.PI * 2);
          ctx.fillStyle = col + "22";
          ctx.fill();
          ctx.strokeStyle = col;
          ctx.lineWidth = 2.5 * lw;
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(dc[0], dc[1]);
          ctx.lineTo(dc[0] + dc[2], dc[1]);
          ctx.setLineDash([3 * lw, 3 * lw]);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.font = `600 ${14 * lw}px system-ui, sans-serif`;
          ctx.lineWidth = 3 * lw;
          ctx.strokeStyle = "rgba(4,10,7,.85)";
          const txt = `Ø ${(2 * dc[2] * sv.raster.gsd).toFixed(1)} m`;
          ctx.strokeText(txt, dc[0] + dc[2] + 6 * lw, dc[1] + 4 * lw);
          ctx.fillStyle = "#ffffff";
          ctx.fillText(txt, dc[0] + dc[2] + 6 * lw, dc[1] + 4 * lw);
        }
      }
      // merge source highlight
      if (mode === "merge" && mergeSource !== null) {
        const t = active?.trees.find((q) => q.id === mergeSource && q.source === "auto");
        if (t) {
          ctx.beginPath();
          ctx.arc(t.x, t.y, Math.max(10 * lw, (t.crownDiameterM / sv.raster.gsd) * 0.55), 0, Math.PI * 2);
          ctx.strokeStyle = "#5cc8f2";
          ctx.lineWidth = 3 * lw;
          ctx.stroke();
        }
      }
      // in-progress QA rectangle
      const dr = drag.current?.rect;
      if (dr) {
        ctx.fillStyle = "rgba(179,155,255,.12)";
        ctx.strokeStyle = "#b39bff";
        ctx.lineWidth = 2 * lw;
        const rx = Math.min(dr[0], dr[2]);
        const ry = Math.min(dr[1], dr[3]);
        ctx.fillRect(rx, ry, Math.abs(dr[2] - dr[0]), Math.abs(dr[3] - dr[1]));
        ctx.strokeRect(rx, ry, Math.abs(dr[2] - dr[0]), Math.abs(dr[3] - dr[1]));
      }
      // minimap
      const m = miniRef.current;
      if (m && rgb) {
        const mctx = m.getContext("2d")!;
        const k = Math.min(m.width / W, m.height / H);
        mctx.setTransform(1, 0, 0, 1, 0, 0);
        mctx.clearRect(0, 0, m.width, m.height);
        mctx.drawImage(baseCanvas ?? rgb, 0, 0, W * k, H * k);
        mctx.strokeStyle = "#3ddc97";
        mctx.lineWidth = 2;
        mctx.strokeRect((-tx / s) * k, (-ty / s) * k, (size.current.w / s) * k, (size.current.h / s) * k);
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [sv, active, rgb, hgt, idx, crowns, overlays, base, removedSet, selected, changeMarks, variant, W, H, mode, mergeSource, calibKind, drawing, wizStep]);

  const toImage = (sx: number, sy: number): [number, number] => {
    const { s, tx, ty } = view.current;
    return [(sx - tx) / s, (sy - ty) / s];
  };

  const hitTree = useCallback(
    (ix: number, iy: number): Tree | null => {
      if (!sv?.detection) return null;
      const { s } = view.current;
      const tol = 9 / s;
      for (const t of sv.added) if ((t.x - ix) ** 2 + (t.y - iy) ** 2 < tol * tol) return t;
      const x = Math.floor(ix);
      const y = Math.floor(iy);
      if (x >= 0 && y >= 0 && x < W && y < H) {
        const L = sv.detection.labels[y * W + x];
        if (L) return sv.detection.trees[L - 1] ?? null;
      }
      let best: Tree | null = null;
      let bd = tol * tol;
      for (const t of sv.detection.trees) {
        const d = (t.x - ix) ** 2 + (t.y - iy) ** 2;
        if (d < bd) {
          bd = d;
          best = t;
        }
      }
      return best;
    },
    [sv, W, H],
  );

  const zoomAt = (sx: number, sy: number, factor: number) => {
    const v = view.current;
    const ns = Math.max(0.05, Math.min(40, v.s * factor));
    const k = ns / v.s;
    view.current = { s: ns, tx: sx - (sx - v.tx) * k, ty: sy - (sy - v.ty) * k };
    userMoved.current = true;
    setZoomLabel(ns);
    dirty.current = true;
  };

  // wheel (non-passive)
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = c.getBoundingClientRect();
      zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015));
    };
    c.addEventListener("wheel", onWheel, { passive: false });
    const kd = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
      if (e.code === "Space") space.current = true;
      if (variant === "change") return;
      const st = useStore.getState();
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "z") {
        e.preventDefault();
        st.undo(st.wizard && st.wizard.step < 4 ? "calib" : "edit");
      } else if (variant === "full" && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === "f") {
        st.setFocusMode(!st.focusMode);
      } else if (e.key === "Escape") {
        setMergeSource(null);
        setLayersOpen(false);
        if (!st.wizard && st.focusMode && variant === "full") st.setFocusMode(false);
      }
    };
    const ku = (e: KeyboardEvent) => {
      if (e.code === "Space") space.current = false;
    };
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    return () => {
      c.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
    };
  }, []);

  const onDown = (e: React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    const sx = e.clientX - r.left;
    const sy = e.clientY - r.top;
    (e.target as Element).setPointerCapture(e.pointerId);
    drag.current = { x: sx, y: sy, tx: view.current.tx, ty: view.current.ty, moved: false, button: e.button };
    if (mode === "qa" && e.button === 0 && !space.current && variant !== "change") {
      const [ix, iy] = toImage(sx, sy);
      drag.current.rect = [ix, iy, ix, iy];
    }
    if (mode === "calibrate" && e.button === 0 && !space.current && variant !== "change") {
      const [ix, iy] = toImage(sx, sy);
      drag.current.circle = [ix, iy, 0];
    }
  };
  const onMove = (e: React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    const sx = e.clientX - r.left;
    const sy = e.clientY - r.top;
    const d = drag.current;
    if (d) {
      const dx = sx - d.x;
      const dy = sy - d.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
      if (d.rect) {
        const [ix, iy] = toImage(sx, sy);
        d.rect = [d.rect[0], d.rect[1], ix, iy];
      } else if (d.circle) {
        const [ix, iy] = toImage(sx, sy);
        d.circle = [d.circle[0], d.circle[1], Math.hypot(ix - d.circle[0], iy - d.circle[1])];
      } else {
        view.current = { ...view.current, tx: d.tx + dx, ty: d.ty + dy };
        userMoved.current = true;
      }
      dirty.current = true;
      return;
    }
    const [ix, iy] = toImage(sx, sy);
    const t = hitTree(ix, iy);
    setHover({ sx, sy, tree: t, ix, iy });
  };
  const onUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d || !sv) return;
    const r = canvasRef.current!.getBoundingClientRect();
    const sx = e.clientX - r.left;
    const sy = e.clientY - r.top;
    if (d.rect && d.moved) {
      const [x0, y0, x1, y1] = d.rect;
      if (Math.abs(x1 - x0) * view.current.s > 12 && Math.abs(y1 - y0) * view.current.s > 12)
        addQaPlot({ x0: Math.max(0, Math.min(x0, x1)), y0: Math.max(0, Math.min(y0, y1)), x1: Math.min(W, Math.max(x0, x1)), y1: Math.min(H, Math.max(y0, y1)) });
      dirty.current = true;
      return;
    }
    if (d.circle) {
      const [cx0, cy0, rad] = d.circle;
      if (d.moved && rad * view.current.s > 6) {
        const kind = wizStep === 3 ? "ground" : wizStep ? "crowns" : calibKind;
        const tag = wizStep === 1 ? "small" : wizStep === 2 ? "large" : undefined;
        addCalib(kind, tag ? { x: cx0, y: cy0, r: rad, tag } : { x: cx0, y: cy0, r: rad });
      } else setNudge(Date.now()); // a click instead of a drag: remind how to draw
      dirty.current = true;
      return;
    }
    dirty.current = true;
    if (d.moved || variant === "change") return;
    const [ix, iy] = toImage(sx, sy);
    const t = hitTree(ix, iy);
    if (mode === "merge") {
      if (!t || t.source !== "auto") {
        setMergeSource(null);
        return;
      }
      const rootId = roots.get(t.id) ?? t.id;
      if (mergeSource === null) setMergeSource(rootId);
      else if (rootId !== mergeSource) mergeTrees(mergeSource, rootId);
      return;
    }
    if (mode === "calibrate") return;
    if (mode === "edit" || (mode === "qa" && e.button === 0)) {
      if (t && t.source === "manual") deleteManual(t.id);
      else if (t) toggleRemove(t.id);
      else if (ix >= 0 && iy >= 0 && ix < W && iy < H) addManualTree(ix, iy);
    } else {
      select(t ? { surveyId: sv.meta.id, treeId: t.id, source: t.source } : null);
    }
  };

  if (!sv) return null;
  const geo = sv.raster.geo;
  const sb = niceScale(sv.raster.gsd / view.current.s);
  const ll = hover ? pixelToLonLat(geo, hover.ix, hover.iy) : null;
  const selTree =
    selected && selected.surveyId === sv.meta.id
      ? selected.source === "manual"
        ? sv.added.find((q) => q.id === selected.treeId)
        : sv.detection?.trees.find((q) => q.id === selected.treeId)
      : null;

  return (
    <div className="relative h-full w-full overflow-hidden rounded-xl border border-line bg-[#070b09]">
      <div ref={wrapRef} className="absolute inset-0">
        <canvas
          ref={canvasRef}
          className={cx(
            "block touch-none",
            mode === "edit" || mode === "calibrate" ? "cursor-crosshair" : mode === "qa" ? "cursor-cell" : mode === "merge" ? "cursor-pointer" : "cursor-grab active:cursor-grabbing",
          )}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerLeave={() => setHover(null)}
          onDoubleClick={(e) => {
            const r = canvasRef.current!.getBoundingClientRect();
            zoomAt(e.clientX - r.left, e.clientY - r.top, 2);
          }}
          onContextMenu={(e) => e.preventDefault()}
        />
      </div>

      {/* toolbar */}
      <div className="no-print pointer-events-none absolute left-3 right-3 top-3 z-10 flex flex-wrap items-start gap-2">
        {variant !== "change" && !(variant === "full" && wizard) && (
          <div className="pointer-events-auto flex flex-wrap items-center gap-1.5">
            <Segmented
              value={mode === "calibrate" ? "inspect" : mode}
              onChange={setMode}
              options={[
                { value: "inspect", label: <><MousePointer2 size={13} /><span className="hidden sm:inline">Inspect</span></>, title: "Click a tree for details; drag to move" },
                { value: "edit", label: <><PenLine size={13} /><span className="hidden sm:inline">Edit</span></>, title: "Click a detection to flag it as not a tree; click empty ground to add a missed tree" },
                { value: "merge", label: <><Combine size={13} /><span className="hidden sm:inline">Merge</span></>, title: "Click a crown, then the other pieces of the same tree to join them" },
                { value: "qa", label: <><Square size={13} /><span className="hidden sm:inline">QA plot</span></>, title: "Drag to draw a QA plot; inside it, fix every error so precision/recall can be measured" },
              ]}
            />
            <Button size="sm" variant="subtle" icon={<Undo2 size={13} />} disabled={!canUndo} onClick={() => undo("edit")} title="Undo last edit (Ctrl/⌘ Z)">
              <span className="hidden sm:inline">Undo</span>
            </Button>
            {variant === "full" && (
              <Button size="sm" variant="outline" icon={<Sparkles size={13} className="text-leaf" />} onClick={startCalibration} title="Show FloraScope your smallest and biggest trees so each crown counts as one tree">
                <span className="hidden sm:inline">Calibrate crowns</span>
              </Button>
            )}
          </div>
        )}
        <div className="pointer-events-auto ml-auto flex items-center gap-1.5">
          <div className="relative">
            <Button size="sm" variant={layersOpen ? "outline" : "subtle"} icon={<Layers size={13} />} onClick={() => setLayersOpen(!layersOpen)} title="Background image and what to show on it">
              <span className="hidden sm:inline">Layers</span>
            </Button>
            {layersOpen && (
              <>
                <div className="fixed inset-0 z-20" onClick={() => setLayersOpen(false)} />
                <div className="absolute right-0 top-9 z-30 w-60 rounded-xl border border-line2 bg-panel p-2.5 shadow-2xl">
                  <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-faint">Background</div>
                  <Segmented
                    size="sm"
                    value={base}
                    onChange={setBase}
                    options={[
                      { value: "rgb", label: <><Eye size={12} />Photo</> },
                      { value: "height", label: <><Trees size={12} />Height</>, title: sv.raster.heightLayer ? "Canopy height model" : "No height layer loaded" },
                      { value: "index", label: <><Layers size={12} />Green</>, title: "Excess-green vegetation index" },
                    ]}
                  />
                  {variant !== "change" && (
                    <>
                      <div className="mb-1 mt-3 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-faint">Show on image</div>
                      {(
                        [
                          ["crowns", "Crown outlines"],
                          ["points", "Tree dots"],
                          ["gaps", "Stocking gaps"],
                          ["hull", "Planted area"],
                          ["plots", "Field plots"],
                          ["qa", "QA plots"],
                        ] as const
                      ).map(([k, l]) => (
                        <button
                          key={k}
                          onClick={() => toggleOverlay(k)}
                          className="flex w-full items-center justify-between rounded-md px-1.5 py-1.5 text-left text-[12px] text-ink2 hover:bg-panel3"
                        >
                          {l}
                          <span className={cx("grid h-4 w-4 place-items-center rounded border", overlays[k] ? "border-leaf bg-leaf text-bg" : "border-line2")}>
                            {overlays[k] && <Check size={11} />}
                          </span>
                        </button>
                      ))}
                    </>
                  )}
                </div>
              </>
            )}
          </div>
          {variant === "full" && (
            <Button
              size="sm"
              variant={focusMode ? "primary" : "subtle"}
              icon={focusMode ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
              onClick={() => setFocusMode(!focusMode)}
              title={focusMode ? "Show panels again (F)" : "Hide panels and give the image the whole screen (F)"}
            >
              <span className="hidden sm:inline">{focusMode ? "Exit focus" : "Focus"}</span>
            </Button>
          )}
        </div>
        {variant !== "change" && !wizard && (mode === "edit" || mode === "merge" || mode === "qa") && (
          <div className="w-full">
            <span className="inline-block rounded-full border border-manual/40 bg-panel/90 px-3 py-1 text-[11.5px] text-manual backdrop-blur">
              {mode === "edit"
                ? "Click a dot to flag it as not a tree · click bare ground to add a missed tree"
                : mode === "merge"
                  ? mergeSource === null
                    ? "Click the main crown of a tree, then each other piece of that same tree"
                    : "Now click the other pieces of this tree · click empty ground to finish"
                  : "Drag to draw a QA plot, then click inside it to fix errors"}
            </span>
          </div>
        )}
        {variant === "full" && !wizard && (
          <div className="w-full">
            <DenseCanopyBanner />
          </div>
        )}
      </div>

      {/* zoom controls */}
      <div className={cx("no-print absolute right-3 flex flex-col items-end gap-2", wizStep ? "top-1/2 -translate-y-1/2" : "bottom-3")}>
        {!wizStep && <canvas
          ref={miniRef}
          width={150}
          height={Math.round((150 * H) / W)}
          className="hidden rounded-md border border-line2 bg-panel/80 sm:block"
          onClick={(e) => {
            const r = (e.target as HTMLCanvasElement).getBoundingClientRect();
            const k = Math.min(150 / W, ((150 * H) / W) / H);
            const ix = (e.clientX - r.left) / k;
            const iy = (e.clientY - r.top) / k;
            const { s } = view.current;
            view.current = { s, tx: size.current.w / 2 - ix * s, ty: size.current.h / 2 - iy * s };
            userMoved.current = true;
            dirty.current = true;
          }}
        />}
        <div className={cx("flex gap-1", wizStep && "flex-col")}>
          <Button size="sm" variant="subtle" onClick={() => zoomAt(size.current.w / 2, size.current.h / 2, 1.5)} title="Zoom in">
            <ZoomIn size={14} />
          </Button>
          <Button size="sm" variant="subtle" onClick={() => zoomAt(size.current.w / 2, size.current.h / 2, 1 / 1.5)} title="Zoom out">
            <ZoomOut size={14} />
          </Button>
          <Button size="sm" variant="subtle" onClick={fit} title="Fit to view">
            <Maximize size={14} />
          </Button>
        </div>
      </div>

      {/* scale + coords + legend */}
      {!wizStep && <div className="no-print pointer-events-none absolute bottom-3 left-3 hidden space-y-2 sm:block">
        <div className="rounded-lg border border-line2 bg-panel/85 px-2.5 py-2 backdrop-blur">
          {variant === "change" ? (
            <div className="flex gap-3 text-[11px] text-ink2">
              <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-leaf" />Survived</span>
              <span className="inline-flex items-center gap-1 text-bad">✕ Lost</span>
              <span className="inline-flex items-center gap-1 text-sky">＋ New</span>
            </div>
          ) : base === "height" && hgt ? (
            <div className="text-[11px] text-ink2">
              <div className="mb-1">Canopy height (m)</div>
              <div className="h-2 w-40 rounded-full" style={{ background: "linear-gradient(90deg,#0c120f,#18343c,#1c6862,#3daa6e,#a3e635,#faf08c)" }} />
              <div className="mt-0.5 flex justify-between tabular text-muted">
                <span>0</span>
                <span>{hgt.max.toFixed(1)}</span>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink2">
              <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: HEALTH.healthy }} />Healthy</span>
              <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: HEALTH.watch }} />Watch</span>
              <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: HEALTH.weak }} />Weak</span>
              <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full border border-manual" />Added</span>
              <span className="inline-flex items-center gap-1 text-muted">✕ Flagged false</span>
            </div>
          )}
          <div className="mt-2 flex items-center gap-3">
            <div>
              <div className="h-1.5 border-x border-b border-ink2" style={{ width: sb.px }} />
              <div className="text-[10.5px] text-ink2 tabular">{sb.label}</div>
            </div>
            <div className="text-[10.5px] text-muted tabular">
              {ll ? `${ll[1].toFixed(6)}°, ${ll[0].toFixed(6)}°` : hover ? `px ${hover.ix.toFixed(0)}, ${hover.iy.toFixed(0)}` : `${(sv.raster.gsd * 100).toFixed(1)} cm/px`} · {zoomLabel >= 1 ? `${zoomLabel.toFixed(1)}×` : `${(zoomLabel * 100).toFixed(0)}%`}
            </div>
          </div>
        </div>
      </div>}

      {variant === "full" && wizard && <CalibrationWizard nudge={nudge} />}

      {/* hover tooltip */}
      {hover?.tree && !drag.current && !drawing && (
        <div
          className="no-print pointer-events-none absolute z-10 rounded-lg border border-line2 bg-panel/95 px-2.5 py-1.5 text-[11.5px] shadow-xl backdrop-blur"
          style={{ left: Math.min(hover.sx + 14, size.current.w - 200), top: Math.max(8, hover.sy - 10) }}
        >
          <div className="font-semibold text-ink">{treeId(sv, hover.tree)}</div>
          <div className="tabular text-ink2">
            Crown {hover.tree.crownDiameterM.toFixed(2)} m · {hover.tree.heightM !== null ? `H ${hover.tree.heightM.toFixed(2)} m` : "no height"}
          </div>
          <div className="tabular text-muted">
            {removedSet.has(hover.tree.id) && hover.tree.source === "auto" ? (
              <span className="text-ink2">flagged false positive</span>
            ) : (
              <>
                <span style={{ color: HEALTH[hover.tree.health] }}>{hover.tree.health}</span>
                {co2ByTree.has(`${hover.tree.source}-${hover.tree.id}`) && <> · {fmt.n(co2ByTree.get(`${hover.tree.source}-${hover.tree.id}`) as number, 2)} kg CO₂e</>}
              </>
            )}
          </div>
        </div>
      )}

      {/* selected tree card */}
      {selTree && mode === "inspect" && variant !== "change" && (
        <div className="no-print absolute right-3 top-14 z-10 w-64 rounded-xl border border-line2 bg-panel/95 p-3 text-[12px] shadow-2xl backdrop-blur">
          <div className="mb-2 flex items-center justify-between">
            <div className="font-semibold text-ink">{treeId(sv, selTree)}</div>
            <button onClick={() => select(null)} className="text-muted hover:text-ink">
              <X size={14} />
            </button>
          </div>
          <div className="mb-2 flex gap-1.5">
            {selTree.source === "manual" ? <Badge tone="manual">manual</Badge> : removedSet.has(selTree.id) ? <Badge>flagged false</Badge> : <Badge tone={selTree.health === "healthy" ? "good" : selTree.health === "watch" ? "warn" : "bad"}>{selTree.health}</Badge>}
            {selTree.cluster && <Badge tone="warn">possible cluster</Badge>}
          </div>
          <dl className="grid grid-cols-2 gap-x-2 gap-y-1 tabular">
            <dt className="text-muted">Crown Ø</dt>
            <dd className="text-right text-ink">{selTree.crownDiameterM.toFixed(2)} m</dd>
            <dt className="text-muted">Crown area</dt>
            <dd className="text-right text-ink">{selTree.crownAreaM2.toFixed(2)} m²</dd>
            <dt className="text-muted">Height</dt>
            <dd className="text-right text-ink">{selTree.heightM !== null ? `${selTree.heightM.toFixed(2)} m` : "—"}</dd>
            <dt className="text-muted">VARI</dt>
            <dd className="text-right text-ink">{selTree.vari.toFixed(3)}</dd>
            <dt className="text-muted">Health z</dt>
            <dd className="text-right text-ink">{selTree.healthZ.toFixed(2)}</dd>
            <dt className="text-muted">CO₂e</dt>
            <dd className="text-right text-ink">
              {co2ByTree.has(`${selTree.source}-${selTree.id}`) ? `${fmt.n(co2ByTree.get(`${selTree.source}-${selTree.id}`) as number, 2)} kg` : "—"}
            </dd>
            <dt className="text-muted">Lat, lon</dt>
            <dd className="text-right text-ink">{selTree.lat !== null ? `${selTree.lat.toFixed(6)}, ${selTree.lon?.toFixed(6)}` : "—"}</dd>
            {selTree.mx !== null && (
              <>
                <dt className="text-muted">EPSG:{geo?.epsg}</dt>
                <dd className="text-right text-ink">
                  {selTree.mx.toFixed(2)}, {selTree.my?.toFixed(2)}
                </dd>
              </>
            )}
          </dl>
          <div className="mt-3 flex gap-1.5">
            {selTree.source === "auto" ? (
              <Button size="sm" variant={removedSet.has(selTree.id) ? "outline" : "danger"} onClick={() => toggleRemove(selTree.id)}>
                {removedSet.has(selTree.id) ? "Restore detection" : "Flag as false"}
              </Button>
            ) : (
              <Button size="sm" variant="danger" onClick={() => { deleteManual(selTree.id); select(null); }}>
                Delete manual tree
              </Button>
            )}
            <Button size="sm" variant="subtle" icon={<Crosshair size={12} />} onClick={() => useStore.getState().focusOn(selTree.x, selTree.y, Math.max(view.current.s, 4))}>
              Zoom
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
