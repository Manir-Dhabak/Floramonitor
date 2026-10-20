import type { Ecosystem } from "./types";

export interface DemoSurvey {
  key: string;
  name: string;
  date: string;
  rgb: string;
  chm: string;
  truth: string;
}

export interface DemoProject {
  key: "arr" | "mangrove";
  title: string;
  site: string;
  ecosystem: Ecosystem;
  blurb: string;
  surveys: DemoSurvey[];
}

export const DEMOS: Record<"arr" | "mangrove", DemoProject> = {
  arr: {
    key: "arr",
    title: "Dryland ARR plantation",
    site: "Thar desert block, Bikaner (illustrative)",
    ecosystem: "arr",
    blurb: "0.8 ha, 3 × 3 m Khejri / Kumat / Rohida mix, two flights a year apart, termite-hit patch and native shrubs.",
    surveys: [
      {
        key: "arr-y1",
        name: "Year-1 survey",
        date: "2025-10-14",
        rgb: "/demo/arr-thar-y1-rgb.tif",
        chm: "/demo/arr-thar-y1-chm.tif",
        truth: "/demo/arr-thar-y1-truth.json",
      },
      {
        key: "arr-y2",
        name: "Year-2 survey",
        date: "2026-10-12",
        rgb: "/demo/arr-thar-y2-rgb.tif",
        chm: "/demo/arr-thar-y2-chm.tif",
        truth: "/demo/arr-thar-y2-truth.json",
      },
    ],
  },
  mangrove: {
    key: "mangrove",
    title: "Mangrove plantation",
    site: "Sundarbans fringe, West Bengal (illustrative)",
    ecosystem: "mangrove",
    blurb: "0.49 ha tidal mudflat, 1.5 m staggered planting of Avicennia / Rhizophora, creek-bank erosion losses.",
    surveys: [
      {
        key: "mangrove",
        name: "Monitoring flight",
        date: "2026-09-28",
        rgb: "/demo/mangrove-sundarbans-rgb.tif",
        chm: "/demo/mangrove-sundarbans-chm.tif",
        truth: "/demo/mangrove-sundarbans-truth.json",
      },
    ],
  },
};
