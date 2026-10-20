"use client";

import { Crosshair, Download, Sprout } from "lucide-react";
import { gapsGeoJSON, download } from "@/lib/exports";
import { useStore } from "@/store/useStore";
import { useAnalysis } from "./AnalysisContext";
import { Button, Card, Empty, Stat, fmt } from "@/components/ui";
import { HEALTH_COLORS, Histogram, StackBar } from "@/components/ui/charts";

export function SurvivalTab() {
  const an = useAnalysis();
  const a = an.active;
  const planting = useStore((s) => s.planting);
  const focusOn = useStore((s) => s.focusOn);
  const setTab = useStore((s) => s.setTab);
  const overlays = useStore((s) => s.overlays);
  const toggleOverlay = useStore((s) => s.toggleOverlay);
  if (!a?.survival) return <Empty icon={<Sprout size={36} />} title="Run detection to see survival and stocking" />;
  const s = a.survival;
  const target = planting.survivalTarget;
  const tone = s.survivalPctCorrected >= target ? "good" : s.survivalPctCorrected >= target - 10 ? "warn" : "bad";
  const health = { healthy: 0, watch: 0, weak: 0 };
  for (const t of a.trees) health[t.health]++;
  const gapCells = s.cells.filter((c) => c.gap).sort((x, y) => y.expected - y.observed - (x.expected - x.observed));
  const ratios = s.cells.filter((c) => c.plantableHa > 0.4 * ((s.cellSizePx * a.survey.raster.gsd) ** 2) / 10000).map((c) => Math.min(2, c.ratio));
  const corrected = Math.abs(a.correction - 1) > 1e-6;

  return (
    <div className="grid h-full gap-3 overflow-y-auto pb-6 lg:grid-cols-[1fr_380px]">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <Stat label="Survival" value={fmt.pct(s.survivalPctCorrected)} tone={tone} sub={`target ${target}% · ${corrected ? `corrected ×${a.correction.toFixed(3)}` : "uncorrected"}`} />
          <Stat label="Live trees" value={fmt.int(s.observedCorrected)} sub={`of ${fmt.int(s.expected)} expected`} />
          <Stat label="Stocking" value={fmt.int(s.stockingPerHa)} unit="/ha" sub={`design ${fmt.int(s.designDensity)}/ha`} />
          <Stat label="Replant need" value={fmt.int(s.replantNeeded)} unit="seedlings" tone={s.replantNeeded > 0 ? "warn" : "good"} sub={`${s.gapCells} gap cells · ${fmt.n(s.gapAreaHa, 3)} ha`} />
        </div>
        <Card
          title="Stocking by grid cell"
          right={
            <div className="flex gap-1.5">
              <Button size="sm" variant={overlays.gaps ? "subtle" : "outline"} onClick={() => toggleOverlay("gaps")}>
                {overlays.gaps ? "Hide" : "Show"} on imagery
              </Button>
              <Button size="sm" variant="outline" icon={<Download size={12} />} disabled={!a.survey.raster.geo} onClick={() => download(`${a.survey.meta.name}-stocking-grid.geojson`, gapsGeoJSON(a.survey, s), "application/geo+json")}>
                GeoJSON
              </Button>
            </div>
          }
        >
          <StockingGrid />
          <p className="mt-3 text-[11.5px] leading-relaxed text-muted">
            Each {planting.gridCellM} m cell compares detected trees with the design density over its plantable area (planted extent minus water and nodata). Cells below {Math.round(planting.gapThreshold * 100)}% of
            design stocking are gaps. Click a cell to inspect it on the imagery.
          </p>
        </Card>
        <Card title="Distribution of cell stocking ratios">
          <Histogram values={ratios} nBins={20} unit="×" format={(v) => v.toFixed(2)} markers={[{ x: planting.gapThreshold, label: "gap threshold", color: "#f2685c", dash: true }, { x: 1, label: "design density", color: "#e8f1ec" }]} />
        </Card>
      </div>
      <div className="space-y-3">
        <Card title="Tree health (within-block greenness)">
          <StackBar
            parts={[
              { label: "Healthy", value: health.healthy, color: HEALTH_COLORS.healthy },
              { label: "Watch", value: health.watch, color: HEALTH_COLORS.watch },
              { label: "Weak", value: health.weak, color: HEALTH_COLORS.weak },
            ]}
          />
          <p className="mt-3 text-[11.5px] leading-relaxed text-muted">
            {a.survey.raster.nir
              ? "NDVI thresholds from the NIR band."
              : "RGB VARI compared within this block (robust z-score). It flags visible stress and sparse canopy — a screening signal for field checks, not a diagnosis."}
          </p>
        </Card>
        <Card title="Crown diameter">
          <Histogram values={a.trees.map((t) => t.crownDiameterM)} unit=" m" format={(v) => v.toFixed(2)} />
        </Card>
        {a.trees.some((t) => t.heightM !== null) && (
          <Card title="Tree height">
            <Histogram values={a.trees.filter((t) => t.heightM !== null).map((t) => t.heightM as number)} unit=" m" color="#a3e635" format={(v) => v.toFixed(2)} />
          </Card>
        )}
        <Card title={`Replanting list (${gapCells.length})`} pad={false}>
          <div className="max-h-72 overflow-y-auto">
            {gapCells.length === 0 && <div className="p-4 text-[12px] text-muted">No gap cells — stocking meets the threshold everywhere.</div>}
            {gapCells.slice(0, 50).map((c) => (
              <div key={`${c.i}-${c.j}`} className="flex items-center justify-between border-b border-line px-4 py-2 text-[12px] last:border-0">
                <div>
                  <div className="font-medium text-ink">Cell {c.i}-{c.j}</div>
                  <div className="tabular text-muted">
                    {c.observed} / {c.expected.toFixed(1)} trees · {Math.round(c.ratio * 100)}%
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="tabular text-warn">+{Math.max(0, Math.round(c.expected - c.observed))}</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Crosshair size={12} />}
                    onClick={() => {
                      if (!overlays.gaps) toggleOverlay("gaps");
                      focusOn((c.x0 + c.x1) / 2, (c.y0 + c.y1) / 2, 2.2);
                      setTab("imagery");
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

function StockingGrid() {
  const an = useAnalysis();
  const a = an.active!;
  const s = a.survival!;
  const focusOn = useStore((st) => st.focusOn);
  const setTab = useStore((st) => st.setTab);
  const ni = Math.max(...s.cells.map((c) => c.i)) + 1;
  const nj = Math.max(...s.cells.map((c) => c.j)) + 1;
  const byKey = new Map(s.cells.map((c) => [`${c.i}-${c.j}`, c]));
  const color = (r: number, gap: boolean) => {
    if (gap) return `rgba(242,104,92,${0.55 + 0.4 * (1 - Math.min(1, r / 0.5))})`;
    const k = Math.min(1, r);
    return `rgba(61,220,151,${0.18 + 0.7 * k})`;
  };
  return (
    <div className="flex gap-4">
      <div className="grid flex-1 gap-[2px]" style={{ gridTemplateColumns: `repeat(${nj}, minmax(0,1fr))`, maxWidth: 560 }}>
        {Array.from({ length: ni * nj }, (_, k) => {
          const i = Math.floor(k / nj);
          const j = k % nj;
          const c = byKey.get(`${i}-${j}`);
          if (!c || c.plantableHa <= 0) return <div key={k} className="aspect-square rounded-[3px] bg-panel2" />;
          return (
            <button
              key={k}
              title={`Cell ${i}-${j}: ${c.observed} of ${c.expected.toFixed(1)} expected (${Math.round(c.ratio * 100)}%)`}
              onClick={() => {
                focusOn((c.x0 + c.x1) / 2, (c.y0 + c.y1) / 2, 2.2);
                setTab("imagery");
              }}
              className="aspect-square rounded-[3px] transition-transform hover:scale-110"
              style={{ background: color(c.ratio, c.gap) }}
            />
          );
        })}
      </div>
      <div className="hidden w-28 shrink-0 space-y-2 text-[11px] text-ink2 sm:block">
        <div className="flex items-center gap-2"><span className="h-3 w-3 rounded-sm" style={{ background: "rgba(61,220,151,.88)" }} />≥ 100%</div>
        <div className="flex items-center gap-2"><span className="h-3 w-3 rounded-sm" style={{ background: "rgba(61,220,151,.5)" }} />50–100%</div>
        <div className="flex items-center gap-2"><span className="h-3 w-3 rounded-sm" style={{ background: "rgba(242,104,92,.85)" }} />Gap</div>
        <div className="flex items-center gap-2"><span className="h-3 w-3 rounded-sm bg-panel2" />Not plantable</div>
      </div>
    </div>
  );
}
