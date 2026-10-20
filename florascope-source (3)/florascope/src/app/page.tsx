import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  BookOpen,
  Calculator,
  ClipboardCheck,
  Fingerprint,
  GitCompareArrows,
  HardDrive,
  MapPinned,
  ScanSearch,
  ShieldCheck,
  Sprout,
  Upload,
  Waves,
} from "lucide-react";
import { Logo } from "@/components/ui";

const STEPS = [
  {
    icon: <Upload size={18} />,
    title: "Ingest",
    text: "GeoTIFF orthomosaic + CHM or DSM from WebODM, Pix4D, Metashape or DJI Terra. Every input is SHA-256 fingerprinted.",
  },
  {
    icon: <ScanSearch size={18} />,
    title: "Detect every tree",
    text: "Vegetation index + Otsu/hysteresis mask, variable-window tree tops on the height model, watershed crown delineation.",
  },
  {
    icon: <ClipboardCheck size={18} />,
    title: "Validate",
    text: "Review QA plots and enter field-plot counts. Precision, recall and a count-correction factor flow into every number.",
  },
  {
    icon: <Sprout size={18} />,
    title: "Survival & gaps",
    text: "Compare against planting design: survival %, stocking per hectare, gap cells and a replanting list you can send to the field.",
  },
  {
    icon: <Calculator size={18} />,
    title: "Carbon with uncertainty",
    text: "Crown + height → Jucker / Chave / Komiyama allometry → tCO₂e, with Monte Carlo 90% CI and the VCS §2.4 deduction.",
  },
  {
    icon: <ShieldCheck size={18} />,
    title: "Pre-audit & report",
    text: "Readiness checks a VVB would raise, plus a printable report and GPS-tagged GeoJSON/CSV for the monitoring report.",
  },
];

const COMPARE = [
  ["Input", "Drone video, frames stitched by eye", "Georeferenced orthomosaic + height model"],
  ["Tree identity", "Counted once while the drone flies", "Persistent GPS tree IDs, re-identified across flights"],
  ["Missing trees", "Gaps in neat orchard rows", "Stocking grid vs planting design — works on irregular mangrove & Oran sites"],
  ["Height & carbon", "None", "Per-tree height → biomass → tCO₂e with uncertainty"],
  ["Accuracy", "Unvalidated", "QA plots + field plots → precision, recall, count correction"],
  ["Output", "CSV / JSON", "GeoJSON, CSV, GPX field plots, chain-of-custody report, pre-audit checklist"],
];

export default function Home() {
  return (
    <div className="min-h-screen bg-bg">
      <header className="sticky top-0 z-30 border-b border-line/70 bg-bg/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
          <Logo size={32} />
          <nav className="flex items-center gap-5 text-[13px] text-muted">
            <a href="#how" className="hidden hover:text-ink sm:inline">
              How it works
            </a>
            <Link href="/methods/" className="hidden hover:text-ink sm:inline">
              Methods
            </Link>
            <Link href="/workspace/" className="inline-flex h-9 items-center gap-2 rounded-lg bg-leaf px-4 font-semibold text-[#04110b] hover:bg-[#5ef0ae]">
              Open workspace <ArrowRight size={15} />
            </Link>
          </nav>
        </div>
      </header>

      <section className="grid-bg relative overflow-hidden">
        <div className="pointer-events-none absolute -top-40 left-1/2 h-[520px] w-[900px] -translate-x-1/2 rounded-full bg-leaf/10 blur-3xl" />
        <div className="relative mx-auto grid max-w-6xl items-center gap-10 px-5 pb-16 pt-14 lg:grid-cols-[1.05fr_1fr] lg:pt-20">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-leaf/30 bg-leaf/10 px-3 py-1 text-[12px] font-medium text-leaf">
              <BadgeCheck size={14} /> AI-powered dMRV for nature-based carbon
            </div>
            <h1 className="mt-5 text-[40px] font-semibold leading-[1.05] tracking-tight text-ink sm:text-[52px]">
              From drone flight to an <span className="text-leaf">audit-ready</span> tree inventory.
            </h1>
            <p className="mt-5 max-w-xl text-[16px] leading-relaxed text-ink2">
              FloraScope finds every tree in your orthomosaic, gives it a GPS ID, measures crown and height, checks survival against the planting design, and estimates tCO₂e with
              VCS-style uncertainty — for ARR and mangrove projects, entirely in your browser.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/workspace/?demo=arr" className="inline-flex h-11 items-center gap-2 rounded-xl bg-leaf px-5 text-[14.5px] font-semibold text-[#04110b] hover:bg-[#5ef0ae]">
                Try the ARR demo <ArrowRight size={16} />
              </Link>
              <Link href="/workspace/?demo=mangrove" className="inline-flex h-11 items-center gap-2 rounded-xl border border-line2 bg-panel px-5 text-[14.5px] font-medium text-ink hover:border-leaf/60">
                <Waves size={16} className="text-sky" /> Mangrove demo
              </Link>
              <Link href="/workspace/?upload=1" className="inline-flex h-11 items-center gap-2 rounded-xl px-4 text-[14.5px] font-medium text-ink2 hover:text-ink">
                <Upload size={16} /> Analyse your flight
              </Link>
            </div>
            <div className="mt-8 grid max-w-lg grid-cols-3 gap-3 text-[12px]">
              {[
                ["Runs locally", "imagery never leaves the browser"],
                ["GPS tree IDs", "WGS84 + UTM per tree"],
                ["VCS §2.4", "90% CI & deduction built in"],
              ].map(([a, b]) => (
                <div key={a} className="rounded-xl border border-line bg-panel/70 px-3 py-2.5">
                  <div className="font-semibold text-ink">{a}</div>
                  <div className="text-muted">{b}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="relative">
            <div className="glow overflow-hidden rounded-2xl border border-line2 bg-panel">
              <div className="flex items-center gap-1.5 border-b border-line px-3 py-2">
                <span className="h-2.5 w-2.5 rounded-full bg-bad/70" />
                <span className="h-2.5 w-2.5 rounded-full bg-warn/70" />
                <span className="h-2.5 w-2.5 rounded-full bg-leaf/70" />
                <span className="ml-2 text-[11px] text-muted">Year-2 survey · 5 cm GSD · 655 trees detected</span>
              </div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/hero.webp" alt="Detected trees on a dryland plantation orthomosaic, coloured by health, with a stocking gap highlighted" className="block w-full" />
            </div>
            <div className="absolute -bottom-5 -left-4 hidden rounded-xl border border-line2 bg-panel/95 px-4 py-3 shadow-2xl backdrop-blur sm:block">
              <div className="text-[11px] uppercase tracking-wider text-muted">Survival</div>
              <div className="text-xl font-semibold text-leaf tabular">82.9%</div>
            </div>
            <div className="absolute -right-3 -top-4 hidden rounded-xl border border-line2 bg-panel/95 px-4 py-3 shadow-2xl backdrop-blur sm:block">
              <div className="text-[11px] uppercase tracking-wider text-muted">Stocking gap</div>
              <div className="text-[13px] font-semibold text-bad">Termite patch → replanting list</div>
            </div>
          </div>
        </div>
      </section>

      <section id="how" className="mx-auto max-w-6xl px-5 py-16">
        <div className="mb-8 max-w-2xl">
          <div className="text-[12px] font-semibold uppercase tracking-[0.16em] text-leaf">How it works</div>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight">Six steps from pixels to a defensible number</h2>
          <p className="mt-3 text-[14.5px] leading-relaxed text-muted">Each step is transparent, parameterised and logged, so the reviewer can see how the number was produced — not just the number.</p>
        </div>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {STEPS.map((s, i) => (
            <div key={s.title} className="rounded-2xl border border-line bg-panel p-5">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-leaf/10 p-2 text-leaf">{s.icon}</div>
                <div className="text-[11px] font-semibold text-faint tabular">0{i + 1}</div>
              </div>
              <div className="mt-3 text-[15px] font-semibold">{s.title}</div>
              <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{s.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-y border-line bg-panel/50">
        <div className="mx-auto max-w-6xl px-5 py-16">
          <div className="mb-8 max-w-2xl">
            <div className="text-[12px] font-semibold uppercase tracking-[0.16em] text-leaf">Built for carbon, not orchards</div>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight">What a tree counter does vs what a VVB needs</h2>
          </div>
          <div className="overflow-hidden rounded-2xl border border-line">
            <table className="w-full text-[13px]">
              <thead className="bg-panel2 text-left text-[11.5px] uppercase tracking-wider text-muted">
                <tr>
                  <th className="px-4 py-3 font-medium" />
                  <th className="px-4 py-3 font-medium">Typical drone tree counter</th>
                  <th className="px-4 py-3 font-medium text-leaf">FloraScope</th>
                </tr>
              </thead>
              <tbody>
                {COMPARE.map(([k, a, b]) => (
                  <tr key={k} className="border-t border-line">
                    <td className="px-4 py-3 font-medium text-ink">{k}</td>
                    <td className="px-4 py-3 text-muted">{a}</td>
                    <td className="px-4 py-3 text-ink2">{b}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-4 px-5 py-16 md:grid-cols-4">
        {[
          { icon: <MapPinned size={18} />, t: "GPS-tagged census", d: "Every tree carries map and WGS84 coordinates — the identifier VM0047's census-based approach allows." },
          { icon: <GitCompareArrows size={18} />, t: "Tree-level change", d: "Re-identify trees between flights for survival, mortality, growth and paired stock change." },
          { icon: <Fingerprint size={18} />, t: "Chain of custody", d: "Input hashes, parameters and every analyst edit are exported with the survey." },
          { icon: <HardDrive size={18} />, t: "Private by design", d: "Client imagery is processed on the analyst's machine. No uploads, no accounts." },
        ].map((f) => (
          <div key={f.t} className="rounded-2xl border border-line bg-panel p-5">
            <div className="text-leaf">{f.icon}</div>
            <div className="mt-3 text-[14.5px] font-semibold">{f.t}</div>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">{f.d}</p>
          </div>
        ))}
      </section>

      <section className="mx-auto max-w-6xl px-5 pb-20">
        <div className="glow flex flex-col items-start justify-between gap-6 rounded-3xl border border-leaf/30 bg-gradient-to-br from-panel2 to-panel p-8 md:flex-row md:items-center">
          <div>
            <h3 className="text-2xl font-semibold tracking-tight">See it on a plantation in under a minute</h3>
            <p className="mt-2 text-[14px] text-muted">Two synthetic flights of a Thar dryland block, a year apart — detection, gaps, carbon, QA and change, ready to explore.</p>
          </div>
          <div className="flex gap-3">
            <Link href="/workspace/?demo=arr" className="inline-flex h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-xl bg-leaf px-5 text-[14.5px] font-semibold text-[#04110b] hover:bg-[#5ef0ae]">
              Launch demo <ArrowRight size={16} />
            </Link>
            <Link href="/methods/" className="inline-flex h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-xl border border-line2 px-5 text-[14.5px] text-ink2 hover:text-ink">
              <BookOpen size={16} /> Methods
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-3 px-5 py-8 text-[12px] text-muted sm:flex-row sm:items-center">
          <Logo size={24} />
          <div>FloraScope MVP · Flora Carbon AI, Kolkata · Demo data is synthetic; validate on real flights before reporting.</div>
        </div>
      </footer>
    </div>
  );
}
