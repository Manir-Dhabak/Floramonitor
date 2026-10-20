"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  BookOpen,
  ClipboardCheck,
  Download,
  FileText,
  GitCompareArrows,
  Image as ImageIcon,
  Leaf,
  Map as MapIcon,
  ShieldCheck,
  SlidersHorizontal,
  Sprout,
  Trees,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { crownsGeoJSON, download, surveyFile, treeId, treesCSV, treesGeoJSON } from "@/lib/exports";
import { DEMOS } from "@/lib/demos";
import { useStore, type TabKey } from "@/store/useStore";
import { AnalysisProvider, useAnalysis } from "./AnalysisContext";
import { AuditTab } from "./AuditTab";
import { CarbonTab } from "./CarbonTab";
import { ChangeTab } from "./ChangeTab";
import { ImageViewer } from "./ImageViewer";
import { MapView } from "./MapView";
import { QaTab } from "./QaTab";
import { ReportTab } from "./ReportTab";
import { Sidebar } from "./Sidebar";
import { SurvivalTab } from "./SurvivalTab";
import { UploadDialog } from "./UploadDialog";
import { Badge, Button, Logo, Progress, Stat, cx, fmt } from "@/components/ui";

const TABS: { key: TabKey; label: string; icon: React.ReactNode }[] = [
  { key: "imagery", label: "Imagery", icon: <ImageIcon size={14} /> },
  { key: "map", label: "Map", icon: <MapIcon size={14} /> },
  { key: "survival", label: "Survival & gaps", icon: <Sprout size={14} /> },
  { key: "carbon", label: "Carbon", icon: <Leaf size={14} /> },
  { key: "qa", label: "QA & field", icon: <ClipboardCheck size={14} /> },
  { key: "change", label: "Change", icon: <GitCompareArrows size={14} /> },
  { key: "audit", label: "Pre-audit", icon: <ShieldCheck size={14} /> },
  { key: "report", label: "Report", icon: <FileText size={14} /> },
];

export function Workspace() {
  const params = useSearchParams();
  const loadDemo = useStore((s) => s.loadDemo);
  const surveys = useStore((s) => s.surveys);
  const busy = useStore((s) => s.busy);
  const started = useRef(false);
  const [upload, setUpload] = useState(false);
  const [side, setSide] = useState(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const d = params.get("demo");
    if ((d === "arr" || d === "mangrove") && !useStore.getState().surveys.length) void loadDemo(d);
    if (params.get("upload") === "1") setUpload(true);
  }, [params, loadDemo]);

  return (
    <AnalysisProvider>
      <div className="print-root flex h-screen flex-col overflow-hidden">
        <TopBar onAddSurvey={() => setUpload(true)} onToggleSide={() => setSide(!side)} />
        {surveys.length === 0 ? (
          busy ? <BusyScreen /> : <Welcome onUpload={() => setUpload(true)} />
        ) : (
          <div className="print-root flex min-h-0 flex-1">
            <Sidebar onAddSurvey={() => setUpload(true)} open={side} onClose={() => setSide(false)} />
            <Main onAddSurvey={() => setUpload(true)} />
          </div>
        )}
        <UploadDialog open={upload} onClose={() => setUpload(false)} />
        <ErrorToast />
        {busy && surveys.length > 0 && <BusyBar />}
      </div>
    </AnalysisProvider>
  );
}

function TopBar({ onAddSurvey, onToggleSide }: { onAddSurvey: () => void; onToggleSide: () => void }) {
  const project = useStore((s) => s.project);
  const surveys = useStore((s) => s.surveys);
  const activeId = useStore((s) => s.activeId);
  const setActive = useStore((s) => s.setActive);
  const an = useAnalysis();
  const [menu, setMenu] = useState(false);
  const a = an.active;
  // carry IDs forward from the earlier survey for re-identified trees
  const links = (() => {
    const ch = an.change;
    const b = an.baseline;
    if (!ch || !b || !a) return null;
    if (Date.parse(a.survey.meta.date) < Date.parse(b.survey.meta.date)) return null;
    const m = new Map<number, string>();
    for (const [i, j] of ch.pairs) m.set(j, treeId(b.survey, b.trees[i]));
    return m;
  })();
  return (
    <header className="no-print flex h-14 shrink-0 items-center gap-3 border-b border-line bg-panel px-3 sm:gap-4 sm:px-4">
      {surveys.length > 0 && (
        <button onClick={onToggleSide} className="rounded-md p-1.5 text-ink2 hover:bg-panel3 lg:hidden" title="Settings">
          <SlidersHorizontal size={18} />
        </button>
      )}
      <Link href="/" className="shrink-0">
        <span className="hidden sm:inline"><Logo size={30} /></span>
        <span className="sm:hidden"><Logo size={30} withText={false} /></span>
      </Link>
      <div className="h-6 w-px bg-line" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13.5px] font-semibold text-ink">{project.name}</div>
        <div className="truncate text-[11px] text-muted">{project.standard}</div>
      </div>
      {surveys.length > 1 && (
        <div className="hidden items-center gap-1 rounded-lg border border-line2 bg-panel2 p-0.5 md:flex">
          {surveys.map((s) => (
            <button
              key={s.meta.id}
              onClick={() => setActive(s.meta.id)}
              className={cx("h-7 rounded-md px-2.5 text-[12px] font-medium", s.meta.id === activeId ? "bg-panel3 text-ink" : "text-muted hover:text-ink2")}
            >
              {s.meta.date}
            </button>
          ))}
        </div>
      )}
      <Link href="/methods/" className="hidden text-[12.5px] text-muted hover:text-ink lg:inline-flex lg:items-center lg:gap-1.5">
        <BookOpen size={14} /> Methods
      </Link>
      <Button variant="outline" size="sm" icon={<Upload size={13} />} onClick={onAddSurvey}>
        <span className="hidden sm:inline">Add survey</span>
      </Button>
      <div className="relative">
        <Button variant="primary" size="sm" icon={<Download size={13} />} disabled={!a?.survey.detection} onClick={() => setMenu(!menu)}>
          Export
        </Button>
        {menu && a && (
          <div className="absolute right-0 top-9 z-50 w-72 rounded-xl border border-line2 bg-panel p-1.5 shadow-2xl" onMouseLeave={() => setMenu(false)}>
            {[
              {
                label: "Tree inventory — GeoJSON (WGS84)",
                sub: links ? "persistent IDs carried from the baseline flight" : "points with ID, crown, height, health, CO₂e",
                disabled: !a.survey.raster.geo,
                run: () => download(`${a.survey.meta.name}-trees.geojson`, treesGeoJSON(a.survey, a.trees, a.carbon?.perTreeKgCo2e ?? null, links), "application/geo+json"),
              },
              {
                label: "Crown polygons — GeoJSON",
                sub: "convex-hull crown outlines",
                disabled: !a.survey.raster.geo,
                run: () => download(`${a.survey.meta.name}-crowns.geojson`, crownsGeoJSON(a.survey, a.trees), "application/geo+json"),
              },
              {
                label: "Tree inventory — CSV",
                sub: "for Excel / registry annexes",
                run: () => download(`${a.survey.meta.name}-trees.csv`, treesCSV(a.survey, a.trees, a.carbon?.perTreeKgCo2e ?? null, links), "text/csv"),
              },
              {
                label: "FloraScope survey file (.json)",
                sub: "parameters, edits, QA, results, hashes",
                run: () => download(`${a.survey.meta.name}.florascope.json`, surveyFile(a.survey, { survival: a.survival, carbon: a.carbon }), "application/json"),
              },
            ].map((it) => (
              <button
                key={it.label}
                disabled={it.disabled}
                onClick={() => {
                  it.run();
                  setMenu(false);
                }}
                className="block w-full rounded-lg px-3 py-2 text-left hover:bg-panel3 disabled:opacity-40"
              >
                <div className="text-[12.5px] font-medium text-ink">{it.label}</div>
                <div className="text-[11px] text-muted">{it.sub}</div>
              </button>
            ))}
          </div>
        )}
      </div>
    </header>
  );
}

function Kpis() {
  const an = useAnalysis();
  const a = an.active;
  const planting = useStore((s) => s.planting);
  if (!a) return null;
  const s = a.survival;
  const c = a.carbon;
  const heights = a.trees.filter((t) => t.heightM !== null).map((t) => t.heightM as number);
  const mh = heights.length ? heights.reduce((x, y) => x + y, 0) / heights.length : null;
  const mc = a.trees.length ? a.trees.reduce((x, t) => x + t.crownDiameterM, 0) / a.trees.length : 0;
  const sTone = s ? (s.survivalPctCorrected >= planting.survivalTarget ? "good" : s.survivalPctCorrected >= planting.survivalTarget - 10 ? "warn" : "bad") : "neutral";
  return (
    <div className="no-print flex shrink-0 gap-2 overflow-x-auto pb-0.5 xl:grid xl:grid-cols-7 xl:overflow-visible [&>*]:min-w-[150px] xl:[&>*]:min-w-0">
      <Stat icon={<Trees size={12} />} label="Live trees" value={fmt.int(a.trees.length)} sub={`${a.survey.added.length} added · ${a.survey.removed.length} flagged`} />
      <Stat label="Survival" value={s ? fmt.pct(s.survivalPctCorrected) : "—"} tone={sTone} sub={s ? `${fmt.int(s.expected)} expected` : ""} />
      <Stat label="Stocking" value={s ? fmt.int(s.stockingPerHa) : "—"} unit="/ha" sub={s ? `${s.replantNeeded} to replant` : ""} />
      <Stat label="Mean crown" value={fmt.n(mc, 2)} unit="m" sub={`${(a.survey.raster.gsd * 100).toFixed(1)} cm GSD`} />
      <Stat label="Mean height" value={mh !== null ? fmt.n(mh, 2) : "—"} unit={mh !== null ? "m" : ""} sub={a.survey.raster.heightLayer ? "from height model" : "no height layer"} />
      <Stat label="Carbon stock" value={c ? fmt.t(c.co2eT) : "…"} unit="tCO₂e" tone="good" sub={c ? `±${c.mc.uncertaintyPct.toFixed(1)}% · cons. ${fmt.t(c.mc.conservative)} t` : "computing"} />
      <Stat label="Pre-audit" value={`${an.score.score}`} unit="/100" tone={an.score.score >= 80 ? "good" : an.score.score >= 55 ? "warn" : "bad"} sub={`${an.score.fail} fail · ${an.score.warn} warn`} />
    </div>
  );
}

function Main({ onAddSurvey }: { onAddSurvey: () => void }) {
  const tab = useStore((s) => s.tab);
  const setTab = useStore((s) => s.setTab);
  const an = useAnalysis();
  const a = an.active;
  return (
    <main className="print-root flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-3 lg:overflow-hidden">
      <Kpis />
      <nav className="no-print flex shrink-0 gap-1 overflow-x-auto border-b border-line">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cx(
              "-mb-px inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-[12.5px] font-medium transition-colors",
              tab === t.key ? "border-leaf text-ink" : "border-transparent text-muted hover:text-ink2",
            )}
          >
            {t.icon}
            {t.label}
            {t.key === "audit" && an.score.fail > 0 && <Badge tone="bad" className="ml-0.5 px-1 py-0 text-[10px]">{an.score.fail}</Badge>}
            {t.key === "change" && an.change && <Badge tone="info" className="ml-0.5 px-1 py-0 text-[10px]">2</Badge>}
          </button>
        ))}
      </nav>
      {a?.survey.meta.demo && <DemoGuide />}
      <div className="print-root min-h-[70vh] flex-1 lg:min-h-0">
        {!a?.survey.detection ? (
          <div className="flex h-full items-center justify-center text-muted">Analysing…</div>
        ) : tab === "imagery" ? (
          <ImageViewer />
        ) : tab === "map" ? (
          <MapView />
        ) : tab === "survival" ? (
          <SurvivalTab />
        ) : tab === "carbon" ? (
          <CarbonTab />
        ) : tab === "qa" ? (
          <QaTab />
        ) : tab === "change" ? (
          <ChangeTab onAddSurvey={onAddSurvey} />
        ) : tab === "audit" ? (
          <AuditTab />
        ) : (
          <ReportTab />
        )}
      </div>
    </main>
  );
}

function DemoGuide() {
  const [hidden, setHidden] = useState(false);
  const tab = useStore((s) => s.tab);
  const setTab = useStore((s) => s.setTab);
  const setMode = useStore((s) => s.setMode);
  const eco = useStore((s) => s.project.ecosystem);
  if (hidden) return null;
  const steps: { t: TabKey; label: string; onClick?: () => void }[] = [
    { t: "imagery", label: "Click any tree" },
    { t: "survival", label: "Gaps & replanting" },
    { t: "carbon", label: "Carbon ± uncertainty" },
    { t: "qa", label: eco === "arr" ? "QA: flag the native shrubs" : "QA & field plots", onClick: () => setMode("qa") },
    { t: "change", label: eco === "arr" ? "Tree-level change" : "Change (needs 2 flights)" },
    { t: "report", label: "Print the report" },
  ];
  return (
    <div className="no-print flex shrink-0 items-center gap-2 overflow-x-auto rounded-xl border border-sky/25 bg-sky/5 px-3 py-2">
      <span className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.12em] text-sky">Demo tour</span>
      {steps.map((st, i) => (
        <button
          key={st.label}
          onClick={() => {
            setTab(st.t);
            st.onClick?.();
          }}
          className={cx(
            "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px]",
            tab === st.t ? "border-sky/50 bg-sky/10 text-ink" : "border-line2 text-ink2 hover:border-sky/40",
          )}
        >
          <span className="tabular text-sky">{i + 1}</span>
          {st.label}
        </button>
      ))}
      <span className="ml-auto hidden shrink-0 text-[11px] text-muted xl:inline">Synthetic imagery — every number is computed live in your browser</span>
      <button onClick={() => setHidden(true)} className="shrink-0 text-muted hover:text-ink" title="Hide">
        <X size={14} />
      </button>
    </div>
  );
}

function Welcome({ onUpload }: { onUpload: () => void }) {
  const loadDemo = useStore((s) => s.loadDemo);
  return (
    <div className="grid-bg flex flex-1 items-center justify-center overflow-y-auto p-6">
      <div className="w-full max-w-3xl">
        <h1 className="text-2xl font-semibold tracking-tight">Start a FloraScope analysis</h1>
        <p className="mt-1 text-[13.5px] text-muted">Open a demo project or analyse your own orthomosaic. Everything runs in this browser tab.</p>
        <div className="mt-6 grid gap-3 md:grid-cols-3">
          {(Object.values(DEMOS) as (typeof DEMOS)["arr"][]).map((d) => (
            <button key={d.key} onClick={() => loadDemo(d.key)} className="glow rounded-2xl border border-line2 bg-panel p-5 text-left transition-transform hover:-translate-y-0.5">
              <Badge tone="info">demo · synthetic</Badge>
              <div className="mt-3 text-[15px] font-semibold">{d.title}</div>
              <div className="text-[12px] text-muted">{d.site}</div>
              <p className="mt-2 text-[12px] leading-relaxed text-ink2">{d.blurb}</p>
            </button>
          ))}
          <button onClick={onUpload} className="rounded-2xl border border-dashed border-line2 bg-panel/60 p-5 text-left transition-colors hover:border-leaf/60">
            <Upload className="text-leaf" size={22} />
            <div className="mt-3 text-[15px] font-semibold">Your drone survey</div>
            <p className="mt-2 text-[12px] leading-relaxed text-ink2">GeoTIFF orthomosaic + optional CHM/DSM from WebODM, Pix4D, Metashape or DJI Terra.</p>
          </button>
        </div>
      </div>
    </div>
  );
}

function BusyScreen() {
  const busy = useStore((s) => s.busy);
  return (
    <div className="grid-bg flex flex-1 items-center justify-center">
      <div className="w-[380px] rounded-2xl border border-line2 bg-panel p-6">
        <div className="mb-1 text-[11px] uppercase tracking-[0.16em] text-leaf">Working</div>
        <div className="mb-4 text-[14px] font-medium text-ink">{busy?.label}</div>
        <Progress pct={busy?.pct ?? 5} />
        <div className="mt-3 text-[11.5px] text-muted">Imagery is decoded and analysed locally — nothing is uploaded.</div>
      </div>
    </div>
  );
}

function BusyBar() {
  const busy = useStore((s) => s.busy);
  return (
    <div className="no-print fixed bottom-4 left-1/2 z-40 w-[420px] -translate-x-1/2 rounded-xl border border-line2 bg-panel/95 px-4 py-3 shadow-2xl backdrop-blur">
      <div className="mb-2 flex justify-between text-[12px]">
        <span className="text-ink2">{busy?.label}</span>
        <span className="tabular text-muted">{Math.round(busy?.pct ?? 0)}%</span>
      </div>
      <Progress pct={busy?.pct ?? 0} />
    </div>
  );
}

function ErrorToast() {
  const error = useStore((s) => s.error);
  const setError = useStore((s) => s.setError);
  if (!error) return null;
  return (
    <div className="no-print fixed bottom-4 right-4 z-50 flex max-w-md items-start gap-3 rounded-xl border border-bad/40 bg-panel px-4 py-3 shadow-2xl">
      <div className="flex-1 text-[12.5px] text-ink2">
        <div className="mb-0.5 font-semibold text-bad">Something went wrong</div>
        {error}
      </div>
      <button onClick={() => setError(null)} className="text-muted hover:text-ink">
        <X size={15} />
      </button>
    </div>
  );
}
