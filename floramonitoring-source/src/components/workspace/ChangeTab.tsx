"use client";

import { GitCompareArrows, Loader2 } from "lucide-react";
import { useStore } from "@/store/useStore";
import { useAnalysis } from "./AnalysisContext";
import { ImageViewer } from "./ImageViewer";
import { indicativeCredits } from "./CarbonTab";
import { Badge, Button, Card, Empty, Stat, fmt } from "@/components/ui";
import { Histogram } from "@/components/ui/charts";

export function ChangeTab({ onAddSurvey }: { onAddSurvey: () => void }) {
  const an = useAnalysis();
  const surveys = useStore((s) => s.surveys);
  const setBaseline = useStore((s) => s.setBaseline);
  const activeId = useStore((s) => s.activeId);
  const carbonP = useStore((s) => s.carbon);
  const ch = an.change;
  if (!ch || !an.baseline || !an.active) {
    const others = surveys.filter((s) => s.meta.id !== activeId);
    return (
      <Empty icon={<GitCompareArrows size={36} />} title="Compare two monitoring flights">
        Load an earlier (or later) survey of the same site and set it as the baseline. FloraScope re-identifies every tree by its coordinates to measure individual survival, mortality, recruitment and growth — and the carbon stock change between the two dates.
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {others.map((o) => (
            <Button key={o.meta.id} variant="outline" onClick={() => setBaseline(o.meta.id)}>
              Use “{o.meta.name}” as baseline
            </Button>
          ))}
          <Button variant="primary" onClick={onAddSurvey}>
            Add a survey
          </Button>
        </div>
      </Empty>
    );
  }
  const later = Date.parse(an.active.survey.meta.date) >= Date.parse(an.baseline.survey.meta.date) ? an.active : an.baseline;
  const earlier = later === an.active ? an.baseline : an.active;
  const sc = an.stockChange;
  const perYear = sc ? sc.conservative / ch.years : 0;
  const credit = sc ? indicativeCredits(sc.conservative, carbonP.leakagePct, carbonP.bufferPct) : null;

  return (
    <div className="grid h-full gap-3 lg:grid-cols-[420px_1fr]">
      <div className="space-y-3 overflow-y-auto pb-6 pr-1">
        <Card title="Tree-level change" right={<Badge tone="info">{ch.coordBasis === "map" ? "matched on map coordinates" : "matched on image coordinates"}</Badge>}>
          <div className="mb-3 text-[12px] text-muted">
            {earlier.survey.meta.name} ({earlier.survey.meta.date}) → {later.survey.meta.name} ({later.survey.meta.date}) · {ch.years.toFixed(2)} yr · tolerance {ch.tolM} m
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Re-identified" value={fmt.int(ch.survived)} tone="good" sub={`of ${fmt.int(ch.baseCount)} baseline trees`} />
            <Stat label="Tree survival" value={fmt.pct(ch.survivalPct)} sub={`${ch.annualMortalityPct.toFixed(1)}% mortality / yr`} />
            <Stat label="Lost" value={fmt.int(ch.lost)} tone={ch.lost ? "bad" : "neutral"} sub="dead, removed or not detected" />
            <Stat label="New" value={fmt.int(ch.recruited)} sub="recruits, replanting or new detections" />
          </div>
        </Card>
        <Card title="Growth of re-identified trees">
          <div className="mb-1 flex justify-between text-[12px]">
            <span className="text-muted">Δ crown diameter</span>
            <span className="tabular text-ink">
              mean {ch.dCrown.mean >= 0 ? "+" : ""}
              {ch.dCrown.mean.toFixed(2)} m · median {ch.dCrown.median.toFixed(2)} m
            </span>
          </div>
          <Histogram values={ch.dCrown.values} unit=" m" format={(v) => v.toFixed(2)} height={110} />
          {ch.dHeight && (
            <>
              <div className="mb-1 mt-4 flex justify-between text-[12px]">
                <span className="text-muted">Δ height</span>
                <span className="tabular text-ink">
                  mean {ch.dHeight.mean >= 0 ? "+" : ""}
                  {ch.dHeight.mean.toFixed(2)} m · median {ch.dHeight.median.toFixed(2)} m
                </span>
              </div>
              <Histogram values={ch.dHeight.values} unit=" m" color="#a3e635" format={(v) => v.toFixed(2)} height={110} />
            </>
          )}
        </Card>
        <Card title="Carbon stock change" right={!sc ? <Badge tone="info"><Loader2 size={11} className="animate-spin" />computing</Badge> : <Badge>paired Monte Carlo</Badge>}>
          {sc && credit ? (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Stat label="Δ CO₂e" value={`${sc.mean >= 0 ? "+" : ""}${fmt.t(sc.mean)}`} unit="t" tone={sc.mean >= 0 ? "good" : "bad"} sub={`90% CI ${fmt.t(sc.p5)} to ${fmt.t(sc.p95)} t`} />
                <Stat label="Uncertainty" value={`±${sc.uncertaintyPct.toFixed(1)}%`} tone={sc.uncertaintyPct <= 10 ? "good" : sc.uncertaintyPct <= 100 ? "warn" : "bad"} sub={sc.uncertaintyPct > 10 ? `deduction ${sc.discountPct.toFixed(1)}%` : "no deduction"} />
                <Stat label="Conservative Δ" value={fmt.t(sc.conservative)} unit="t" sub={`${fmt.n(perYear, 2)} tCO₂e / yr`} />
                <Stat label="Indicative net" value={fmt.t(credit.net)} unit="t" sub={`after ${carbonP.leakagePct}% leakage, ${carbonP.bufferPct}% buffer`} />
              </div>
              <div className="mt-3">
                <Histogram
                  bins={sc.hist}
                  unit=" t"
                  format={(v) => fmt.t(v)}
                  height={110}
                  markers={[
                    { x: sc.p5, label: "P5", color: "#f5b942", dash: true },
                    { x: sc.mean, label: "mean", color: "#e8f1ec" },
                    { x: sc.p95, label: "P95", color: "#f5b942", dash: true },
                  ]}
                />
              </div>
              <p className="mt-2 text-[11.5px] leading-relaxed text-muted">
                Both surveys are simulated with the same random draws for shared systematic errors (wood density, allometry, height bias), so the difference is not inflated by errors that cancel between dates.
              </p>
            </>
          ) : (
            <div className="text-[12px] text-muted">Waiting for both surveys&apos; Monte Carlo runs…</div>
          )}
        </Card>
      </div>
      <div className="min-h-[420px]">
        <ImageViewer variant="change" />
      </div>
    </div>
  );
}
