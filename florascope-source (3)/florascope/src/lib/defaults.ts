import type { CarbonParams, DetectParams, Ecosystem, PlantingParams, Species } from "./types";

export function defaultDetectParams(eco: Ecosystem, spacing = eco === "mangrove" ? 1.5 : 3): DetectParams {
  return {
    segIndex: "exg",
    thresholdMode: "otsu",
    manualThreshold: 0.1,
    thresholdBias: 0,
    hysteresisLow: 0.6,
    smoothingM: 0.06,
    minCrownDiameterM: eco === "mangrove" ? 0.25 : 0.3,
    maxCrownDiameterM: eco === "mangrove" ? 2.5 : 4,
    minTreeSpacingM: Math.max(0.5, spacing * 0.55),
    mergeStrength: 0, // 0 = automatic (matched to calibration crowns)
    markerSource: "height",
    minHeightM: eco === "mangrove" ? 0.3 : 0.35,
    heightFilter: true,
    vwfA: 0.06,
    vwfB: eco === "mangrove" ? 0.35 : 0.5,
    excludeWater: true,
    healthWatchZ: -1.5,
    healthWeakZ: -3,
    ndviWatch: 0.45,
    ndviWeak: 0.3,
    dsmGroundWindowM: 8,
  };
}

/**
 * Indicative species presets. Wood densities (g/cm³) marked "Zanne 2009" are
 * from the Global Wood Density Database as tabulated in Ecological Processes
 * (2019) 8:9 Table 1; others are genus-level placeholders that MUST be
 * replaced with species/site values before any submission.
 */
export const ARR_SPECIES: Species[] = [
  { id: "pcin", name: "Prosopis cineraria", local: "Khejri", share: 35, woodDensity: 0.75, note: "genus-level placeholder — verify" },
  { id: "asen", name: "Acacia senegal", local: "Kumat", share: 20, woodDensity: 0.85, note: "genus-level placeholder — verify" },
  { id: "tund", name: "Tecomella undulata", local: "Rohida", share: 20, woodDensity: 0.7, note: "placeholder — verify" },
  { id: "sole", name: "Salvadora oleoides", local: "Jaal", share: 15, woodDensity: 0.59, note: "Zanne et al. 2009" },
  { id: "aind", name: "Azadirachta indica", local: "Neem", share: 10, woodDensity: 0.7, note: "Zanne et al. 2009" },
];

export const MANGROVE_SPECIES: Species[] = [
  { id: "amar", name: "Avicennia marina", local: "Baen", share: 40, woodDensity: 0.65, note: "indicative — verify (GWDD)" },
  { id: "rmuc", name: "Rhizophora mucronata", local: "Garjan", share: 25, woodDensity: 0.85, note: "indicative — verify (GWDD)" },
  { id: "eaga", name: "Excoecaria agallocha", local: "Genwa", share: 15, woodDensity: 0.45, note: "indicative — verify (GWDD)" },
  { id: "sape", name: "Sonneratia apetala", local: "Keora", share: 12, woodDensity: 0.55, note: "indicative — verify (GWDD)" },
  { id: "hfom", name: "Heritiera fomes", local: "Sundari", share: 8, woodDensity: 0.85, note: "indicative — verify (GWDD)" },
];

export function defaultCarbonParams(eco: Ecosystem): CarbonParams {
  return {
    model: eco === "mangrove" ? "komiyama" : "jucker-chave",
    dModelA: 0.557,
    dModelB: 0.809,
    species: (eco === "mangrove" ? MANGROVE_SPECIES : ARR_SPECIES).map((s) => ({ ...s })),
    rootShoot: 0.56, // IPCC 2006 Table 4.4, tropical dry forest, AGB < 20 t/ha
    carbonFraction: 0.47, // IPCC 2006 Table 4.3 default
    heightSource: "layer",
    assumedHeightM: eco === "mangrove" ? 1.2 : 1.5,
    assumedHeightCv: 0.3,
    woodDensityCv: 0.1,
    heightBias: 0.05,
    heightCv: 0.08,
    allometryResidualSigma: 0.4,
    allometrySystematicCv: 0.1,
    rootShootCv: 0.25,
    detectionCvUnvalidated: 0.15,
    iterations: 2000,
    projectAreaHa: null,
    bufferPct: 20,
    leakagePct: 0,
    correction: "qa",
  };
}

export function defaultPlanting(eco: Ecosystem): PlantingParams {
  return {
    spacingX: eco === "mangrove" ? 1.5 : 3,
    spacingY: eco === "mangrove" ? 1.5 : 3,
    plantedAreaMode: "auto",
    plantedAreaHa: 0.5,
    gridCellM: eco === "mangrove" ? 6 : 9,
    gapThreshold: 0.5,
    survivalTarget: eco === "mangrove" ? 70 : 80,
    plantingDate: eco === "mangrove" ? "2024-07-15" : "2024-08-01",
  };
}
