// Allometric models used to turn crown diameter (CD) + height (H) into biomass.
//
// References
//  - Jucker T. et al. (2017) Allometric equations for integrating remote sensing
//    imagery into forest monitoring programmes. Global Change Biology 23:177–190.
//      D  = 0.557 · (H·CD)^0.809 · exp(0.056²/2)            (global model, Eq. 6)
//      AGB = 0.016 · (H·CD)^2.013 · exp(0.204²/2)           (angiosperms, Eq. 7)
//  - Chave J. et al. (2014) Improved allometric models to estimate the
//    aboveground biomass of tropical trees. Global Change Biology 20:3177–3190.
//      AGB = 0.0673 · (ρ·D²·H)^0.976
//  - Komiyama A., Poungparn S., Kato S. (2005) Common allometric equations for
//    estimating the tree weight of mangroves. J. Tropical Ecology 21:471–477.
//      AGB = 0.251 · ρ · D^2.46      BGB (roots) = 0.199 · ρ^0.899 · D^2.22
//  Units: D cm, H m, CD m, ρ g/cm³, biomass kg (dry matter).

import type { AllometryModel, Species } from "./types";

export const JUCKER_D = { a: 0.557, b: 0.809, rse: 0.056 };
export const JUCKER_AGB_ANGIO = { a: 0.016, b: 2.013, rse: 0.204 };
export const CHAVE14 = { a: 0.0673, b: 0.976 };
export const KOMIYAMA = { agbA: 0.251, agbB: 2.46, bgbA: 0.199, bgbRho: 0.899, bgbB: 2.22 };
export const BREAST_HEIGHT_M = 1.3;

export function weightedWoodDensity(species: Species[]): number {
  const tot = species.reduce((s, x) => s + Math.max(0, x.share), 0);
  if (tot <= 0) return 0.6;
  return species.reduce((s, x) => s + Math.max(0, x.share) * x.woodDensity, 0) / tot;
}

/** Stem diameter (cm) predicted from height and crown diameter (Jucker 2017). */
export function diameterFromHcd(H: number, CD: number, a = JUCKER_D.a, b = JUCKER_D.b): number {
  return a * Math.pow(Math.max(1e-6, H * CD), b) * Math.exp((JUCKER_D.rse * JUCKER_D.rse) / 2);
}

export interface TreeBiomass {
  dCm: number;
  agbKg: number;
  bgbKg: number;
  branch: "chave" | "jucker-direct" | "komiyama";
}

export function treeBiomass(
  model: AllometryModel,
  H: number,
  CD: number,
  rho: number,
  rootShoot: number,
  dA = JUCKER_D.a,
  dB = JUCKER_D.b,
): TreeBiomass {
  const D = diameterFromHcd(H, CD, dA, dB);
  if (model === "komiyama") {
    const agb = KOMIYAMA.agbA * rho * Math.pow(D, KOMIYAMA.agbB);
    const bgb = KOMIYAMA.bgbA * Math.pow(rho, KOMIYAMA.bgbRho) * Math.pow(D, KOMIYAMA.bgbB);
    return { dCm: D, agbKg: agb, bgbKg: bgb, branch: "komiyama" };
  }
  if (model === "jucker-direct" || H < BREAST_HEIGHT_M) {
    const agb = JUCKER_AGB_ANGIO.a * Math.pow(Math.max(1e-6, H * CD), JUCKER_AGB_ANGIO.b) * Math.exp((JUCKER_AGB_ANGIO.rse ** 2) / 2);
    return { dCm: D, agbKg: agb, bgbKg: agb * rootShoot, branch: "jucker-direct" };
  }
  const agb = CHAVE14.a * Math.pow(rho * D * D * H, CHAVE14.b);
  return { dCm: D, agbKg: agb, bgbKg: agb * rootShoot, branch: "chave" };
}

export const MODEL_LABELS: Record<AllometryModel, string> = {
  "jucker-chave": "Jucker 2017 (H×CD → D) + Chave 2014 pantropical",
  "jucker-direct": "Jucker 2017 direct AGB from H×CD (angiosperms)",
  komiyama: "Jucker 2017 (H×CD → D) + Komiyama 2005 mangrove common equations",
};
