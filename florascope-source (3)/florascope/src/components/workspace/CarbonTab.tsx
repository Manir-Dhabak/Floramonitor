"use client";

import { Leaf, Loader2 } from "lucide-react";
import { MODEL_LABELS } from "@/lib/allometry";
import { useStore } from "@/store/useStore";
import { useAnalysis } from "./AnalysisContext";
import { Badge, Card, Empty, Stat, fmt } from "@/components/ui";
import { BarList, HEALTH_COLORS, Histogram } from "@/components/ui/charts";

export function CarbonTab() {
  const an = useAnalysis();
  const a = an.active;
  const p = useStore((s) => s.carbon);
  if (!a?.survival) return <Empty icon={<Leaf size={36} />} title="Run detection to estimate carbon" />;
  const c = a.carbon;
  if (!c)
    return (
      <Empty icon={<Loader2 size={32} className="animate-spin" />} title="Running Monte Carlo…">
        Propagating allometric, height, wood-density and detection uncertainty.
      </Empty>
    );
  const mc = c.mc;
  const u = mc.uncertaintyPct;
  const uTone = u <= 10 ? "good" : u <= 100 ? "warn" : "bad";
  const credit = indicativeCredits(mc.conservative, p.leakagePct, p.bufferPct);

  return (
    <div className="grid h-full gap-3 overflow-y-auto pb-6 lg:grid-cols-[1fr_400px]">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <Stat label="Carbon stock" value={fmt.t(c.co2eT)} unit="tCO₂e" tone="good" sub={`${fmt.n(c.co2ePerHa, 2)} tCO₂e/ha · ${fmt.n(c.areaBasisHa, 2)} ha`} />
          <Stat label="90% CI" value={`${fmt.t(mc.p5)}–${fmt.t(mc.p95)}`} unit="t" sub={`Monte Carlo n=${p.iterations}`} />
          <Stat label="Uncertainty" value={`±${u.toFixed(1)}%`} tone={uTone} sub={u <= 10 ? "no deduction" : `deduction ${mc.discountPct.toFixed(1)}%`} />
          <Stat label="Conservative" value={fmt.t(mc.conservative)} unit="tCO₂e" sub="after VCS §2.4 deduction" />
        </div>
        <Card
          title="Monte Carlo distribution of total CO₂e"
          right={a.carbonPending ? <Badge tone="info"><Loader2 size={11} className="animate-spin" />updating</Badge> : <Badge>seeded, reproducible</Badge>}
        >
          <Histogram
            bins={mc.hist}
            unit=" t"
            format={(v) => fmt.t(v)}
            height={170}
            markers={[
              { x: mc.p5, label: `P5 ${fmt.t(mc.p5)} t`, color: "#f5b942", dash: true },
              { x: mc.mean, label: `mean ${fmt.t(mc.mean)} t`, color: "#e8f1ec" },
              { x: mc.p95, label: `P95 ${fmt.t(mc.p95)} t`, color: "#f5b942", dash: true },
              { x: mc.conservative, label: `conservative ${fmt.t(mc.conservative)} t`, color: "#5cc8f2" },
            ]}
          />
        </Card>
        <Card title="Uncertainty deduction (VCS Methodology Requirements v5.0 §2.4)">
          <table className="w-full text-[12.5px] tabular">
            <tbody className="[&_td]:py-1.5 [&_tr]:border-b [&_tr]:border-line">
              <tr>
                <td className="text-muted">Mean estimate</td>
                <td className="text-right text-ink">{fmt.n(mc.mean, 2)} tCO₂e</td>
              </tr>
              <tr>
                <td className="text-muted">90% CI half-width (U)</td>
                <td className="text-right text-ink">
                  {fmt.n((mc.p95 - mc.p5) / 2, 2)} t = {u.toFixed(2)}%
                </td>
              </tr>
              <tr>
                <td className="text-muted">Discount factor = U / 1.6449 × 0.4307</td>
                <td className="text-right text-ink">{u <= 10 ? "0 (U ≤ 10%)" : `${mc.discountPct.toFixed(2)}%`}</td>
              </tr>
              <tr>
                <td className="text-muted">Conservative estimate</td>
                <td className="text-right font-semibold text-leaf">{fmt.n(mc.conservative, 2)} tCO₂e</td>
              </tr>
            </tbody>
          </table>
          {mc.excluded && <p className="mt-2 text-[12px] text-bad">U exceeds 100% of the estimate: these removals would be excluded from crediting.</p>}
        </Card>
        <Card title="Indicative removals (illustrative, not an issuance estimate)">
          <div className="space-y-2 text-[12.5px] tabular">
            <Row k="Conservative stock in live trees" v={`${fmt.n(mc.conservative, 2)} t`} />
            <Row k={`Leakage (${p.leakagePct}%)`} v={`− ${fmt.n(credit.leak, 2)} t`} />
            <Row k={`Non-permanence buffer (${p.bufferPct}%)`} v={`− ${fmt.n(credit.buffer, 2)} t`} />
            <Row k="Indicative net removals vs. zero baseline" v={`${fmt.n(credit.net, 2)} tCO₂e`} strong />
          </div>
          <p className="mt-3 text-[11.5px] leading-relaxed text-muted">
            Assumes no pre-project woody biomass. Real crediting follows the methodology&apos;s baseline (e.g. VM0047 dynamic performance benchmark or census-based approach),
            monitoring periods and registry buffer rules. Use the Change tab for stock change between monitoring events.
          </p>
        </Card>
      </div>
      <div className="space-y-3">
        <Card title="Biomass pools">
          <BarList
            unit=" t"
            format={(v) => fmt.n(v, 2)}
            items={[
              { label: "Above-ground biomass (dry)", value: c.agbT, color: "#3ddc97" },
              { label: "Below-ground biomass (dry)", value: c.bgbT, color: "#1f9f6a" },
              { label: "Carbon", value: c.carbonT, color: "#a3e635" },
              { label: "CO₂e", value: c.co2eT, color: "#5cc8f2" },
            ]}
          />
        </Card>
        <Card title="CO₂e by crown size class">
          <BarList
            unit=" t"
            format={(v) => fmt.n(v, 2)}
            items={c.bySize.filter((b) => b.n > 0).map((b) => ({ label: b.label, value: b.co2eT, sub: `${fmt.int(b.n)} trees` }))}
          />
        </Card>
        <Card title="CO₂e by health class">
          <BarList
            unit=" t"
            format={(v) => fmt.n(v, 2)}
            items={(["healthy", "watch", "weak"] as const).map((h) => ({ label: h[0].toUpperCase() + h.slice(1), value: c.byHealth[h].co2eT, sub: `${fmt.int(c.byHealth[h].n)} trees`, color: HEALTH_COLORS[h] }))}
          />
        </Card>
        <Card title="Model & assumptions">
          <dl className="space-y-1.5 text-[12px]">
            <Def k="Allometry" v={MODEL_LABELS[p.model]} />
            <Def k="Wood density (weighted)" v={`${c.weightedDensity.toFixed(3)} g/cm³`} />
            <Def k="Root:shoot / C fraction" v={p.model === "komiyama" ? `Komiyama roots / ${p.carbonFraction}` : `${p.rootShoot} / ${p.carbonFraction}`} />
            <Def k="Count correction" v={`${c.correctionFactor.toFixed(3)} — ${c.correctionLabel}`} />
            <Def k="Height" v={p.heightSource === "layer" && a.survey.raster.heightLayer ? `Height model, bias corr. +${(p.heightBias * 100).toFixed(0)}%` : `Assumed ${p.assumedHeightM} m`} />
          </dl>
          {c.notes.length > 0 && (
            <ul className="mt-3 space-y-1 text-[11.5px] leading-relaxed text-warn">
              {c.notes.map((n) => (
                <li key={n}>• {n}</li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

export function indicativeCredits(conservative: number, leakagePct: number, bufferPct: number) {
  const leak = conservative * (leakagePct / 100);
  const afterLeak = conservative - leak;
  const buffer = afterLeak * (bufferPct / 100);
  return { leak, buffer, net: afterLeak - buffer };
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between border-b border-line pb-1.5 ${strong ? "font-semibold text-leaf" : ""}`}>
      <span className={strong ? "" : "text-muted"}>{k}</span>
      <span className={strong ? "" : "text-ink"}>{v}</span>
    </div>
  );
}

function Def({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="shrink-0 text-muted">{k}</dt>
      <dd className="text-right text-ink2">{v}</dd>
    </div>
  );
}
