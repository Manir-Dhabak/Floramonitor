"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { benchmarkAgainstTruth } from "@/lib/benchmark";
import { compareSurveys, type ChangeResult } from "@/lib/change";
import { carbonAsync } from "@/lib/engine";
import { auditScore, runPreAudit } from "@/lib/preaudit";
import { computeFieldMetrics, computeQa } from "@/lib/qa";
import { recountPlots } from "@/lib/plots";
import { computeSurvival } from "@/lib/survival";
import { summarise } from "@/lib/carbon";
import type {
  AuditCheck,
  CarbonResult,
  FieldMetrics,
  McSummary,
  QaMetrics,
  Survey,
  SurvivalResult,
  Tree,
  TruthBenchmark,
} from "@/lib/types";
import { effectiveTrees, useStore } from "@/store/useStore";

export interface SurveyAnalysis {
  survey: Survey;
  trees: Tree[];
  qa: QaMetrics | null;
  field: FieldMetrics | null;
  correction: number;
  survival: SurvivalResult | null;
  carbon: CarbonResult | null;
  samples: Float64Array | null;
  carbonPending: boolean;
  bench: TruthBenchmark | null;
}

export interface Analysis {
  active: SurveyAnalysis | null;
  baseline: SurveyAnalysis | null;
  change: ChangeResult | null;
  stockChange: McSummary | null;
  checks: AuditCheck[];
  score: ReturnType<typeof auditScore>;
}

const Ctx = createContext<Analysis | null>(null);

export function useAnalysis(): Analysis {
  const a = useContext(Ctx);
  if (!a) throw new Error("useAnalysis outside provider");
  return a;
}

function useSurveyAnalysis(sv: Survey | null): SurveyAnalysis | null {
  const planting = useStore((s) => s.planting);
  const carbonParams = useStore((s) => s.carbon);
  const truth = useStore((s) => (sv ? s.truth[sv.meta.id] : undefined));
  const trees = useMemo(() => effectiveTrees(sv), [sv]);
  const gsd = sv?.raster.gsd ?? 0.05;

  const qa = useMemo(() => {
    if (!sv?.detection) return null;
    return computeQa(sv.detection.trees, new Set(sv.removed), sv.added, sv.qaPlots, gsd);
  }, [sv, gsd]);
  const field = useMemo(
    () => (sv ? computeFieldMetrics(recountPlots(sv.fieldPlots, trees, gsd), trees, gsd, carbonParams.dModelB, 1 + carbonParams.heightBias) : null),
    [sv, trees, gsd, carbonParams.dModelB, carbonParams.heightBias],
  );

  const correction = useMemo(() => {
    if (carbonParams.correction === "qa" && qa && qa.correction && qa.tp > 0) return qa.correction;
    if (carbonParams.correction === "field" && field && field.meanRatio) return field.meanRatio;
    return 1;
  }, [carbonParams.correction, qa, field]);

  const survival = useMemo(() => {
    if (!sv?.detection) return null;
    return computeSurvival({
      trees,
      width: sv.raster.width,
      height: sv.raster.height,
      gsd,
      valid: sv.raster.valid,
      water: sv.detection.water,
      params: planting,
      correction,
    });
  }, [sv, trees, gsd, planting, correction]);

  const bench = useMemo(() => {
    if (!sv?.detection || !truth) return null;
    return benchmarkAgainstTruth(trees, truth, gsd, sv.raster.scale);
  }, [sv, trees, truth, gsd]);

  const [carbon, setCarbon] = useState<{ key: string; result: CarbonResult; samples: Float64Array } | null>(null);
  const [pending, setPending] = useState(false);
  const key = useMemo(
    () =>
      sv && survival
        ? `${sv.meta.id}|${trees.length}|${sv.removed.length}|${sv.added.length}|${survival.plantedAreaHa.toFixed(5)}|${JSON.stringify(carbonParams)}|${qa?.tp}-${qa?.fp}-${qa?.fn}|${field?.meanRatio}|${sv.detection?.stats.runtimeMs}`
        : "",
    [sv, trees, survival, carbonParams, qa, field],
  );
  useEffect(() => {
    if (!sv || !survival || !key) return;
    let cancelled = false;
    setPending(true);
    const t = setTimeout(() => {
      carbonAsync({
        trees,
        params: carbonParams,
        plantedAreaHa: survival.plantedAreaHa,
        cells: survival.cells,
        cellSizePx: survival.cellSizePx,
        hasHeightLayer: !!sv.raster.heightLayer,
        qa,
        field,
        seed: 20261020,
      })
        .then((out) => {
          if (!cancelled) setCarbon({ key, ...out });
        })
        .catch(() => {})
        .finally(() => !cancelled && setPending(false));
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const fresh = carbon && sv && carbon.key.split("|")[0] === sv.meta.id ? carbon : null;
  const carbonPending = pending || (!!key && carbon?.key !== key);
  return useMemo(
    () =>
      sv
        ? {
            survey: sv,
            trees,
            qa,
            field,
            correction,
            survival,
            carbon: fresh?.result ?? null,
            samples: fresh?.samples ?? null,
            carbonPending,
            bench,
          }
        : null,
    [sv, trees, qa, field, correction, survival, fresh, carbonPending, bench],
  );
}

export function AnalysisProvider({ children }: { children: ReactNode }) {
  const surveys = useStore((s) => s.surveys);
  const activeId = useStore((s) => s.activeId);
  const baselineId = useStore((s) => s.baselineId);
  const planting = useStore((s) => s.planting);
  const carbonParams = useStore((s) => s.carbon);
  const active = surveys.find((s) => s.meta.id === activeId) ?? null;
  const baseRaw = surveys.find((s) => s.meta.id === baselineId && s.meta.id !== activeId) ?? null;
  const a = useSurveyAnalysis(active);
  const b = useSurveyAnalysis(baseRaw);

  const change = useMemo(() => {
    if (!a || !b || !a.survey.detection || !b.survey.detection) return null;
    const [first, second] = Date.parse(b.survey.meta.date) <= Date.parse(a.survey.meta.date) ? [b, a] : [a, b];
    const tol = Math.max(0.3, Math.min(planting.spacingX, planting.spacingY) * 0.4);
    return compareSurveys(
      { trees: first.trees, gsd: first.survey.raster.gsd, date: first.survey.meta.date, epsg: first.survey.raster.geo?.epsg ?? null, georef: !!first.survey.raster.geo },
      { trees: second.trees, gsd: second.survey.raster.gsd, date: second.survey.meta.date, epsg: second.survey.raster.geo?.epsg ?? null, georef: !!second.survey.raster.geo },
      Number(tol.toFixed(2)),
    );
  }, [a, b, planting.spacingX, planting.spacingY]);

  const stockChange = useMemo(() => {
    if (!a?.samples || !b?.samples || a.samples.length !== b.samples.length) return null;
    const later = Date.parse(a.survey.meta.date) >= Date.parse(b.survey.meta.date) ? a : b;
    const earlier = later === a ? b : a;
    const d = new Float64Array(a.samples.length);
    for (let i = 0; i < d.length; i++) d[i] = (later.samples as Float64Array)[i] - (earlier.samples as Float64Array)[i];
    const point = (later.carbon?.co2eT ?? 0) - (earlier.carbon?.co2eT ?? 0);
    return summarise(d, point);
  }, [a, b]);

  const checks = useMemo(() => {
    if (!a) return [];
    return runPreAudit({
      survey: a.survey,
      survival: a.survival,
      carbon: a.carbon,
      qa: a.qa,
      field: a.field,
      change,
      planting,
      carbonParams,
    });
  }, [a, change, planting, carbonParams]);
  const score = useMemo(() => auditScore(checks), [checks]);

  const value = useMemo<Analysis>(
    () => ({ active: a, baseline: b, change, stockChange, checks, score }),
    [a, b, change, stockChange, checks, score],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
