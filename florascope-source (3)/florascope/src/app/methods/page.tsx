import Link from "next/link";
import type { Metadata } from "next";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Logo } from "@/components/ui";

export const metadata: Metadata = { title: "Methods — FloraScope" };

function H({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="mt-12 scroll-mt-20 text-xl font-semibold tracking-tight text-ink">
      {children}
    </h2>
  );
}

function Eq({ children }: { children: React.ReactNode }) {
  return <div className="my-3 overflow-x-auto rounded-lg border border-line bg-panel2 px-4 py-3 font-mono text-[13px] text-leaf">{children}</div>;
}

export default function Methods() {
  return (
    <div className="min-h-screen bg-bg">
      <header className="sticky top-0 z-30 border-b border-line/70 bg-bg/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-5">
          <Link href="/">
            <Logo size={30} />
          </Link>
          <Link href="/workspace/" className="inline-flex h-9 items-center gap-2 rounded-lg bg-leaf px-4 text-[13px] font-semibold text-[#04110b]">
            Open workspace <ArrowRight size={15} />
          </Link>
        </div>
      </header>
      <div className="mx-auto grid max-w-5xl gap-10 px-5 py-10 lg:grid-cols-[200px_1fr]">
        <nav className="hidden text-[13px] lg:block">
          <div className="sticky top-24 space-y-2 text-muted">
            {[
              ["inputs", "Inputs"],
              ["detection", "Tree detection"],
              ["health", "Health"],
              ["validation", "Validation"],
              ["survival", "Survival & gaps"],
              ["carbon", "Biomass & carbon"],
              ["uncertainty", "Uncertainty"],
              ["change", "Change analysis"],
              ["audit", "Pre-audit checks"],
              ["limits", "Limitations"],
              ["roadmap", "Roadmap"],
              ["refs", "References"],
            ].map(([id, l]) => (
              <a key={id} href={`#${id}`} className="block hover:text-ink">
                {l}
              </a>
            ))}
          </div>
        </nav>
        <article className="max-w-none text-[14px] leading-relaxed text-ink2">
          <Link href="/" className="inline-flex items-center gap-1.5 text-[12.5px] text-muted hover:text-ink">
            <ArrowLeft size={14} /> Home
          </Link>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-ink">Methods</h1>
          <p className="mt-3 text-muted">
            FloraScope is fully client-side: every step below runs in a Web Worker in the browser. Parameters are visible and editable in the workspace, and are written into the exported survey file and report.
          </p>

          <H id="inputs">1. Inputs</H>
          <ul className="mt-3 list-disc space-y-1.5 pl-5">
            <li>Orthomosaic: GeoTIFF (RGB, RGBA with alpha mask, or RGB+NIR; 8/16-bit or float) or JPG/PNG with an optional world file and EPSG code. Large images are downsampled to a configurable working limit (default 16 MP) using GeoTIFF overviews where available.</li>
            <li>Height model: a canopy height model (CHM, metres above ground) or a digital surface model (DSM). For a DSM, ground is estimated with a moving-minimum filter (default 8 m window) followed by smoothing, and CHM = DSM − ground — suitable for flat plantations and mudflats.</li>
            <li>Height layers are resampled onto the orthomosaic grid using both geotransforms (same CRS), or by extent when no georeferencing exists.</li>
            <li>Each input is fingerprinted with SHA-256 in the browser for chain of custody.</li>
          </ul>

          <H id="detection">2. Individual tree detection</H>
          <ol className="mt-3 list-decimal space-y-1.5 pl-5">
            <li>
              Vegetation index per pixel — Excess Green ExG = (2g − r − b) with chromatic coordinates (Woebbecke et al. 1995), ExG − ExR (Meyer &amp; Neto 2008), VARI (Gitelson et al. 2002), or NDVI when a NIR band exists.
            </li>
            <li>Gaussian smoothing (default 6 cm), then Otsu&apos;s threshold over the valid area with a user offset. Hysteresis keeps weaker pixels (≥ 60% of the threshold) only when they connect to a confident pixel or stand above the minimum tree height.</li>
            <li>Water / tidal channels are masked (dark, blue-dominant, non-vegetated pixels; small blobs removed). With a height model, vegetation lower than half the minimum tree height is ignored.</li>
            <li>Morphological opening/closing and removal of objects smaller than the minimum crown diameter.</li>
            <li>
              Tree tops: with a height model, a variable-window filter (Popescu &amp; Wynne 2004) accepts a pixel as a tree top when it is the highest point within radius r = a·H + b (defaults a = 0.06, b = 0.5 m; mangrove b = 0.35 m). Without height, peaks of the Euclidean distance transform of the crown mask are used, with non-maximum suppression at the minimum tree spacing.
            </li>
            <li>Marker-controlled watershed (priority flooding) on the inverted height model or distance transform delineates one crown per tree top. Crowns above the maximum diameter are flagged as possible clusters.</li>
            <li>Per crown: area, equivalent diameter, maximum height, mean VARI/NDVI, convex-hull outline, map and WGS84 coordinates.</li>
          </ol>
          <h3 className="mt-6 text-[15px] font-semibold text-ink">Dense or mixed canopy: calibrated crown segments</h3>
          <p className="mt-2">
            When crowns touch (agroforestry, natural regeneration, palms among shrubs) the vegetation mask becomes one continuous blob and shape-based peaks split
            single trees into many. In that case the analyst calibrates the detector by drawing example crowns — at least the smallest and the largest tree — and
            optionally a few &ldquo;not a tree&rdquo; areas (grass, ground cover, soil). FloraScope then:
          </p>
          <ol className="mt-2 list-decimal space-y-1.5 pl-5">
            <li>over-segments the image into colour-coherent superpixels (SLIC; Achanta et al. 2012, CIELAB, compactness 10) about 0.6× the smallest crown radius across;</li>
            <li>merges neighbouring superpixels in order of similarity (lightness, green–red and blue–yellow chroma, local texture, plus a penalty for darker shadow seams between them) while the merged region stays within the largest calibration crown — so crown borders follow changes in colour and structure;</li>
            <li>absorbs fragments smaller than a plausible crown into their most similar neighbour, and shadow holes enclosed by one crown into that crown; shadow cut-offs adapt to the darkest calibration crown;</li>
            <li>keeps regions that look like trees: drawn samples always win, bare soil is dropped, and with &ldquo;not a tree&rdquo; samples a two-class linear discriminant (pixel LDA averaged per region) removes ground-like regions; with a height model, regions lower than the minimum tree height are dropped.</li>
          </ol>
          <p className="mt-2">
            The <b>Crown merging</b> setting controls how different two patches may be and still join one crown. Remaining errors are fixed in the viewer: <b>Merge</b> joins pieces of one
            tree, <b>Edit</b> flags false trees or adds missed ones; merged and flagged crowns count as false positives in QA precision.
          </p>

          <H id="health">3. Health screening</H>
          <p className="mt-3">
            The crown&apos;s mean VARI is converted into a robust z-score within the block (median and MAD, with a floor so homogeneous blocks are not over-flagged). Defaults: watch below z = −1.5, weak below z = −3, plus small crowns with
            below-median greenness marked watch. With NIR, absolute NDVI thresholds are used. This is a screening signal for field checks, not a diagnosis.
          </p>

          <H id="validation">4. Validation and count correction</H>
          <p className="mt-3">
            <b>QA plots.</b> The analyst draws plots and corrects every error inside them (flag false detections, add missed trees). Within plots: TP = kept detections, FP = flagged, FN = added. Precision = TP/(TP+FP), recall = TP/(TP+FN). The estimated true count is detected × P/R. In the Monte Carlo, P and R are drawn from Beta(TP+1, FP+1) and Beta(TP+1, FN+1).
          </p>
          <p className="mt-2">
            <b>Field plots.</b> Spatially balanced random circular plots (default r = 5.64 m = 100 m²) are generated inside the planted area and exported as GPX/CSV/GeoJSON. Field counts give a ratio-of-sums correction with a 90% CI; field mean heights give a CHM height-bias estimate that can be applied to the carbon model.
          </p>

          <H id="survival">5. Survival, stocking and gaps</H>
          <Eq>expected = (10 000 / (spacing_row × spacing_plant)) × planted_area_ha</Eq>
          <p>
            The planted area is either entered or estimated as the convex hull of detected trees buffered by half a spacing, minus water and nodata. Stocking is evaluated in square cells (default 9 m ARR, 6 m mangrove — roughly 9–16 planting positions per cell). A cell with at least 40% plantable area and stocking below the gap threshold (default 50% of design) is a gap; its shortfall is added to the replanting list.
          </p>

          <H id="carbon">6. Biomass and carbon</H>
          <p className="mt-3">Stem diameter is predicted from crown diameter (CD, m) and height (H, m) with the global model of Jucker et al. (2017):</p>
          <Eq>D [cm] = 0.557 · (H · CD)^0.809 · exp(0.056² / 2)</Eq>
          <p>Above-ground biomass (kg) for terrestrial ARR species (Chave et al. 2014), with ρ the share-weighted wood density (g/cm³):</p>
          <Eq>AGB = 0.0673 · (ρ · D² · H)^0.976</Eq>
          <p>Trees shorter than breast height (1.3 m) use Jucker&apos;s direct crown-height model for angiosperms:</p>
          <Eq>AGB = 0.016 · (H · CD)^2.013 · exp(0.204² / 2)</Eq>
          <p>Mangroves use the common equations of Komiyama et al. (2005):</p>
          <Eq>AGB = 0.251 · ρ · D^2.46 &nbsp;&nbsp;&nbsp; BGB = 0.199 · ρ^0.899 · D^2.22</Eq>
          <p>
            For ARR, BGB = R · AGB with R = 0.56 by default (IPCC 2006 Vol. 4 Table 4.4, tropical dry forest, AGB &lt; 20 t/ha). Carbon = (AGB + BGB) × CF (default 0.47), CO₂e = C × 44/12. Photogrammetric CHMs tend to
            under-estimate sapling height, so a bias correction (default +5%) is applied and should be calibrated with field heights. Wood densities in the presets are indicative; amber values are placeholders that
            must be replaced before reporting.
          </p>

          <H id="uncertainty">7. Uncertainty and conservativeness</H>
          <p className="mt-3">
            A seeded Monte Carlo (default 2 000 iterations) draws shared systematic multipliers for wood density, height, allometric model error and root:shoot ratio, the count-correction factor (from QA or field plots, or ±15% when unvalidated), and — when results are extrapolated to a larger project area — a bootstrap of grid-cell carbon densities. Per-tree allometric residuals (σ = 0.4 on the log scale by default) are aggregated exactly for small samples and with the central-limit approximation for large ones.
          </p>
          <Eq>U = (P95 − P5) / 2 / mean × 100% &nbsp;&nbsp; discount = U / 1.6449 × 0.4307 (if U &gt; 10%)</Eq>
          <p>
            Following VCS Methodology Requirements v5.0 §2.4: no deduction when U ≤ 10%; the discounted (conservative) estimate otherwise; exclusion when U &gt; 100%. Indicative net removals further subtract leakage and the AFOLU non-permanence buffer. They are illustrative only.
          </p>

          <H id="change">8. Change between flights</H>
          <p className="mt-3">
            Trees from two surveys are matched one-to-one by distance (closest pairs first) in map coordinates when both are georeferenced in the same CRS (tolerance 0.4 × spacing). Unmatched baseline trees are losses; unmatched new trees are recruits, replanting or new detections. Growth is the per-tree change in crown diameter and height. Stock change is computed from the two surveys&apos; Monte Carlo samples drawn with the same seed, so shared systematic errors largely cancel.
          </p>

          <H id="audit">9. Pre-audit checks</H>
          <p className="mt-3">
            Data &amp; traceability (hashes, date, georeferencing, CRS, coverage), measurement adequacy (pixels across the smallest crown, height data, merged crowns), detection accuracy (QA effort, precision/recall ≥ 90%, field plots), survival &amp; stocking (target, gaps, planted-area source), carbon &amp; uncertainty (U ≤ 10%, sourced wood densities, allometry applicability) and monitoring continuity (linked survey, edit log).
          </p>

          <H id="limits">10. Limitations</H>
          <ul className="mt-3 list-disc space-y-1.5 pl-5">
            <li>The detector is classical computer vision. It performs well on open plantations (sand, soil, mudflat backgrounds) but closed canopies need a trained deep-learning model and canopy-cover methods.</li>
            <li>The demo datasets are procedurally generated; their benchmark scores are an upper bound.</li>
            <li>D from H×CD uses a global terrestrial model — calibrate with field DBH, especially for mangroves.</li>
            <li>Browser memory limits analysis to roughly 16–36 MP per survey; very large orthomosaics are downsampled or should be tiled.</li>
          </ul>

          <H id="roadmap">11. Roadmap</H>
          <ul className="mt-3 list-disc space-y-1.5 pl-5">
            <li>Pluggable deep-learning detector (DeepForest / YOLO-seg fine-tuned on Flora sites, ONNX in the browser or GPU backend).</li>
            <li>Species classification and per-species allometry; multispectral (Mavic 3M) health with absolute NDVI/NDRE.</li>
            <li>Tiled processing for 100+ ha orthomosaics; COG streaming.</li>
            <li>Drone-calibrated satellite upscaling for whole-project canopy and stock maps.</li>
            <li>Direct hand-off to Carbon Intel monitoring-report drafting and the pre-audit workflow.</li>
          </ul>

          <H id="refs">References</H>
          <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-[13px] text-muted">
            <li>Chave J. et al. (2014) Improved allometric models to estimate the aboveground biomass of tropical trees. Global Change Biology 20: 3177–3190.</li>
            <li>Jucker T. et al. (2017) Allometric equations for integrating remote sensing imagery into forest monitoring programmes. Global Change Biology 23: 177–190.</li>
            <li>Komiyama A., Poungparn S., Kato S. (2005) Common allometric equations for estimating the tree weight of mangroves. Journal of Tropical Ecology 21: 471–477.</li>
            <li>Popescu S.C., Wynne R.H. (2004) Seeing the trees in the forest. Photogrammetric Engineering &amp; Remote Sensing 70: 589–604.</li>
            <li>Otsu N. (1979) A threshold selection method from gray-level histograms. IEEE Transactions on Systems, Man and Cybernetics 9: 62–66.</li>
            <li>Woebbecke D.M. et al. (1995) Color indices for weed identification under various soil, residue, and lighting conditions. Transactions of the ASAE 38: 259–269.</li>
            <li>Meyer G.E., Neto J.C. (2008) Verification of color vegetation indices for automated crop imaging applications. Computers and Electronics in Agriculture 63: 282–293.</li>
            <li>Gitelson A.A. et al. (2002) Novel algorithms for remote estimation of vegetation fraction. Remote Sensing of Environment 80: 76–87.</li>
            <li>Felzenszwalb P.F., Huttenlocher D.P. (2012) Distance transforms of sampled functions. Theory of Computing 8: 415–428.</li>
            <li>Achanta R. et al. (2012) SLIC superpixels compared to state-of-the-art superpixel methods. IEEE TPAMI 34: 2274–2282.</li>
            <li>IPCC (2006) Guidelines for National Greenhouse Gas Inventories, Volume 4, Chapter 4.</li>
            <li>Verra. VCS Methodology Requirements v5.0, §2.4 Uncertainty; VM0047 Afforestation, Reforestation and Revegetation v1.1.</li>
            <li>Zanne A.E. et al. (2009) Global Wood Density Database. Dryad.</li>
          </ol>
        </article>
      </div>
    </div>
  );
}
