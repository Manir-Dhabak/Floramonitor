// Shared types for FloraScope.

export type HealthClass = "healthy" | "watch" | "weak";
export type Ecosystem = "arr" | "mangrove";
export type SegIndex = "exg" | "exgr" | "vari" | "ndvi";
export type HeightMode = "none" | "chm" | "dsm";
export type MarkerSource = "rgb" | "height" | "segments";

/** Analyst-drawn calibration sample (working px). */
export interface CalibCircle {
  x: number;
  y: number;
  r: number;
  tag?: "small" | "large"; // which wizard step drew it
}

/** Crown calibration: example crowns (smallest → largest) and "not a tree" samples. */
export interface Calibration {
  crowns: CalibCircle[];
  ground: CalibCircle[];
}

/** Georeferencing for the *working* raster grid (after any downsampling). */
export interface GeoInfo {
  epsg: number | null;
  proj4: string | null; // definition used for reprojection (null = unknown CRS)
  originX: number; // map X of the top-left corner of the top-left pixel
  originY: number; // map Y of the top-left corner of the top-left pixel
  resX: number; // map units per working pixel (x)
  resY: number; // map units per working pixel (y, positive; rows go "down")
  isGeographic: boolean;
}

export interface InputFileInfo {
  role: "ortho" | "height";
  name: string;
  sizeBytes: number;
  sha256: string;
  nativeWidth: number;
  nativeHeight: number;
  bands: number;
  dtype: string;
  epsg: number | null;
}

/** Image prepared for analysis in the browser. */
export interface WorkingRaster {
  width: number;
  height: number;
  rgba: Uint8ClampedArray; // display + analysis RGB, alpha=0 => nodata
  valid: Uint8Array; // 1 = valid pixel
  nir: Float32Array | null; // optional NIR band (raw units)
  redRaw: Float32Array | null; // red band in the same raw units as nir (for NDVI)
  heightLayer: Float32Array | null; // CHM on working grid (m), NaN = nodata
  heightMode: HeightMode;
  gsd: number; // metres per working pixel
  nativeGsd: number; // metres per native pixel
  scale: number; // native px per working px
  geo: GeoInfo | null;
  files: InputFileInfo[];
  warnings: string[];
}

export interface DetectParams {
  segIndex: SegIndex;
  thresholdMode: "otsu" | "manual";
  manualThreshold: number;
  thresholdBias: number; // added to the Otsu threshold
  hysteresisLow: number; // low threshold as a fraction of the main threshold (0-1)
  smoothingM: number; // gaussian-ish smoothing of the index (m)
  minCrownDiameterM: number;
  maxCrownDiameterM: number;
  minTreeSpacingM: number; // NMS distance between tree tops
  mergeStrength: number; // crown-segments mode: colour/texture distance below which neighbours merge
  markerSource: MarkerSource;
  minHeightM: number; // trees below this height are ignored (when a height layer exists)
  heightFilter: boolean; // require vegetation pixels to be above minHeight*0.5
  vwfA: number; // variable window filter: radius(m) = a*h + b
  vwfB: number;
  excludeWater: boolean;
  healthWatchZ: number; // robust z below which a tree is "watch"
  healthWeakZ: number; // robust z below which a tree is "weak"
  ndviWatch: number; // absolute NDVI thresholds when NIR exists
  ndviWeak: number;
  dsmGroundWindowM: number; // ground estimation window when a DSM is supplied
}

export interface Tree {
  id: number;
  x: number; // working px (tree top or crown centroid)
  y: number;
  mx: number | null; // map coordinates (CRS units)
  my: number | null;
  lon: number | null;
  lat: number | null;
  crownAreaM2: number;
  crownDiameterM: number;
  heightM: number | null;
  vari: number; // mean VARI over the crown
  ndvi: number | null;
  segIndexMean: number;
  healthZ: number;
  health: HealthClass;
  hull: number[]; // flattened [x0,y0,x1,y1,...] in working px
  source: "auto" | "manual";
  cluster: boolean; // crown larger than max crown size -> possibly several trees
}

export interface DetectStats {
  threshold: number;
  vegFraction: number;
  waterFraction: number;
  validFraction: number;
  segments: number;
  removedSmall: number;
  clusters: number;
  runtimeMs: number;
  markerSource: MarkerSource;
  segInfo?: { superpixels: number; regions: number; shadows: number; ground: number; soil: number; small: number; short: number; mergeT: number };
}

export interface DetectResult {
  trees: Tree[];
  labels: Int32Array; // working grid, value = tree index + 1 (0 = background)
  water: Uint8Array;
  vegMask: Uint8Array;
  stats: DetectStats;
}

/** A rectangle the analyst has fully reviewed (QA), in working px. */
export interface QaPlot {
  id: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface EditLogEntry {
  t: string; // ISO time
  action: "remove" | "restore" | "add" | "delete-manual" | "qa-plot" | "merge" | "calibrate";
  treeId?: number;
  x?: number;
  y?: number;
}

export interface Species {
  id: string;
  name: string;
  local?: string;
  share: number; // % of planted stock
  woodDensity: number; // g/cm3 (oven-dry mass / green volume)
  note?: string;
}

export type AllometryModel = "jucker-chave" | "jucker-direct" | "komiyama";

export interface CarbonParams {
  model: AllometryModel;
  dModelA: number; // stem diameter model D = a·(H·CD)^b (Jucker 2017 global: 0.557, 0.809)
  dModelB: number;
  species: Species[];
  rootShoot: number; // R (BGB/AGB) when not using Komiyama roots
  carbonFraction: number;
  heightSource: "layer" | "assumed";
  assumedHeightM: number;
  assumedHeightCv: number;
  // uncertainty components (1-sigma, relative)
  woodDensityCv: number;
  heightBias: number; // multiplicative bias correction for CHM heights (e.g. 0.05 = CHM under-estimates by 5%)
  heightCv: number;
  allometryResidualSigma: number; // per-tree residual (log scale)
  allometrySystematicCv: number; // shared model error
  rootShootCv: number;
  detectionCvUnvalidated: number; // used when no QA/field validation exists
  iterations: number;
  projectAreaHa: number | null; // extrapolate per-ha density to this area (null = surveyed area only)
  bufferPct: number; // AFOLU non-permanence buffer (%)
  leakagePct: number;
  correction: "none" | "qa" | "field";
}

export interface PlantingParams {
  spacingX: number;
  spacingY: number;
  plantedAreaMode: "auto" | "manual";
  plantedAreaHa: number;
  gridCellM: number;
  gapThreshold: number; // stocking ratio below which a cell is a gap
  survivalTarget: number; // %
  plantingDate: string;
}

export interface FieldPlot {
  id: string;
  x: number; // working px centre
  y: number;
  radiusM: number;
  lon: number | null;
  lat: number | null;
  mx: number | null;
  my: number | null;
  detected: number;
  fieldCount: number | null;
  fieldMeanHeight: number | null;
  fieldMeanDbh: number | null; // cm, mean stem diameter of trees in the plot (≥ breast height)
}

export interface SurveyMeta {
  id: string;
  name: string;
  site: string;
  date: string; // acquisition date
  ecosystem: Ecosystem;
  demo: string | null; // demo key, if any
  truthUrl: string | null;
  createdAt: string;
}

export interface CellStat {
  i: number;
  j: number;
  x0: number; // working px
  y0: number;
  x1: number;
  y1: number;
  plantableHa: number;
  expected: number;
  observed: number;
  ratio: number;
  gap: boolean;
}

export interface SurvivalResult {
  plantedAreaHa: number;
  surveyedAreaHa: number;
  designDensity: number; // trees/ha
  expected: number;
  observed: number;
  observedCorrected: number;
  survivalPct: number;
  survivalPctCorrected: number;
  stockingPerHa: number;
  gapCells: number;
  gapAreaHa: number;
  replantNeeded: number;
  cells: CellStat[];
  cellSizePx: number;
  plantedHull: number[]; // working px polygon
  plantableMask: Uint8Array;
}

export interface McSummary {
  mean: number;
  median: number;
  p5: number;
  p95: number;
  sd: number;
  uncertaintyPct: number; // half-width of 90% CI as % of mean
  discountPct: number; // VCS §2.4 conservativeness deduction
  conservative: number;
  excluded: boolean;
  hist: { x0: number; x1: number; n: number }[];
}

export interface CarbonResult {
  trees: number;
  agbT: number; // point estimates (tonnes dry matter)
  bgbT: number;
  carbonT: number;
  co2eT: number;
  co2ePerHa: number;
  areaBasisHa: number;
  extrapolated: boolean;
  mc: McSummary; // tCO2e
  perTreeKgCo2e: Float32Array;
  byHealth: Record<HealthClass, { n: number; co2eT: number }>;
  bySize: { label: string; n: number; co2eT: number }[];
  weightedDensity: number;
  notes: string[];
  correctionFactor: number;
  correctionLabel: string;
}

export interface QaMetrics {
  plots: number;
  reviewedAreaHa: number;
  tp: number;
  fp: number;
  fn: number;
  precision: number | null;
  recall: number | null;
  f1: number | null;
  correction: number | null; // estimated true / detected
}

export interface FieldMetrics {
  plotsWithCounts: number;
  meanRatio: number | null; // field / detected
  ratioCi: [number, number] | null;
  heightBias: number | null; // (field - detected)/detected
  dbhCalibA: number | null; // fitted coefficient a of D = a·(H·CD)^b from field DBH
  dbhPlots: number;
}

export interface TruthBenchmark {
  truthAlive: number;
  detected: number;
  tp: number;
  fp: number;
  fn: number;
  precision: number;
  recall: number;
  f1: number;
  countErrorPct: number;
  crownRmseM: number | null;
  heightRmseM: number | null;
  heightBiasM: number | null;
}

export interface Survey {
  meta: SurveyMeta;
  raster: WorkingRaster;
  detectParams: DetectParams;
  detection: DetectResult | null;
  removed: number[]; // auto tree ids flagged as false positives
  added: Tree[]; // manual trees (false negatives)
  qaPlots: QaPlot[];
  editLog: EditLogEntry[];
  fieldPlots: FieldPlot[];
  calibration: Calibration;
  merges: [number, number][]; // [keptTreeId, absorbedTreeId] — analyst merged over-split crowns
}

export type CheckStatus = "pass" | "warn" | "fail" | "info";

export interface AuditCheck {
  id: string;
  group: string;
  title: string;
  status: CheckStatus;
  detail: string;
  ref?: string;
}
