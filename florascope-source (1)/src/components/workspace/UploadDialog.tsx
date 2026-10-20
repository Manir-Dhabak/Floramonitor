"use client";

import { FileImage, Mountain, Upload, X } from "lucide-react";
import { useRef, useState } from "react";
import { fileToSource } from "@/lib/loader";
import type { HeightMode } from "@/lib/types";
import { useStore } from "@/store/useStore";
import { Button, NumberField, Select, TextField, cx } from "@/components/ui";

function DropZone({
  label,
  accept,
  file,
  onFile,
  icon,
  hint,
}: {
  label: string;
  accept: string;
  file: File | null;
  onFile: (f: File | null) => void;
  icon: React.ReactNode;
  hint: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const f = e.dataTransfer.files?.[0];
        if (f) onFile(f);
      }}
      onClick={() => ref.current?.click()}
      className={cx(
        "flex cursor-pointer items-center gap-3 rounded-xl border border-dashed px-4 py-3.5 transition-colors",
        over ? "border-leaf bg-leaf/5" : file ? "border-leaf/50 bg-panel2" : "border-line2 bg-panel2 hover:border-leaf/50",
      )}
    >
      <div className={cx("rounded-lg p-2", file ? "bg-leaf/15 text-leaf" : "bg-panel3 text-muted")}>{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium text-ink">{label}</div>
        <div className="truncate text-[11.5px] text-muted">{file ? `${file.name} · ${(file.size / 1e6).toFixed(1)} MB` : hint}</div>
      </div>
      {file && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onFile(null);
          }}
          className="text-muted hover:text-bad"
        >
          <X size={15} />
        </button>
      )}
      <input ref={ref} type="file" accept={accept} className="hidden" onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
    </div>
  );
}

export function UploadDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const addSurvey = useStore((s) => s.addSurvey);
  const project = useStore((s) => s.project);
  const setProject = useStore((s) => s.setProject);
  const surveys = useStore((s) => s.surveys);
  const [ortho, setOrtho] = useState<File | null>(null);
  const [height, setHeight] = useState<File | null>(null);
  const [world, setWorld] = useState<File | null>(null);
  const [heightMode, setHeightMode] = useState<Exclude<HeightMode, "none">>("chm");
  const [name, setName] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [site, setSite] = useState("");
  const [gsdCm, setGsdCm] = useState(3);
  const [epsg, setEpsg] = useState(0);
  const [mp, setMp] = useState(16);
  if (!open) return null;
  const isRaster = ortho && !/\.(tif|tiff)$/i.test(ortho.name);

  const go = async () => {
    if (!ortho) return;
    onClose();
    const o = ortho;
    const h = height;
    const wf = world;
    setOrtho(null);
    setHeight(null);
    setWorld(null);
    setName("");
    await addSurvey({
      ortho: await fileToSource(o),
      height: h ? await fileToSource(h) : null,
      heightMode: h ? heightMode : "none",
      options: {
        maxPixels: mp * 1e6,
        gsdFallback: gsdCm / 100,
        epsgOverride: epsg > 0 ? epsg : null,
        worldFile: wf,
        bandMap: null,
      },
      name: name || `Survey ${surveys.length + 1}`,
      date,
      site: site || project.name,
    });
  };

  return (
    <div className="no-print fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-line2 bg-panel p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-tight">Add a drone survey</h2>
          <button onClick={onClose} className="text-muted hover:text-ink">
            <X size={18} />
          </button>
        </div>
        <p className="mb-4 text-[12.5px] text-muted">
          Files are read locally in your browser — nothing is uploaded. Use the orthomosaic and DSM/CHM exported from WebODM, Pix4D, Agisoft Metashape or DJI Terra.
        </p>
        <div className="space-y-2.5">
          <DropZone label="Orthomosaic (required)" accept=".tif,.tiff,.jpg,.jpeg,.png,.webp" file={ortho} onFile={setOrtho} icon={<FileImage size={18} />} hint="GeoTIFF (RGB / RGBA / RGB+NIR) or JPG/PNG" />
          <DropZone label="Height model (recommended)" accept=".tif,.tiff" file={height} onFile={setHeight} icon={<Mountain size={18} />} hint="Canopy height model (CHM) or surface model (DSM) GeoTIFF" />
          {height && (
            <Select
              label="Height layer type"
              value={heightMode}
              onChange={setHeightMode}
              options={[
                { value: "chm", label: "CHM — heights above ground" },
                { value: "dsm", label: "DSM — elevations (ground estimated automatically)" },
              ]}
            />
          )}
          {isRaster && <DropZone label="World file (optional)" accept=".jgw,.pgw,.wld,.tfw,.jpgw,.pngw" file={world} onFile={setWorld} icon={<Upload size={18} />} hint=".jgw / .pgw to georeference a JPG/PNG" />}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <TextField label="Survey name" value={name} placeholder={`Survey ${surveys.length + 1}`} onChange={setName} />
          <TextField label="Flight date" type="date" value={date} onChange={setDate} />
          <TextField label="Site" value={site} placeholder="e.g. Block A, Bikaner" onChange={setSite} />
          <Select
            label="Ecosystem"
            value={project.ecosystem}
            onChange={(v) => setProject({ ecosystem: v })}
            options={[
              { value: "arr", label: "ARR / agroforestry" },
              { value: "mangrove", label: "Mangrove" },
            ]}
          />
        </div>
        <details className="mt-3 rounded-lg border border-line bg-panel2 px-3 py-2">
          <summary className="cursor-pointer text-[12px] font-medium text-ink2">Advanced</summary>
          <div className="mt-3 grid grid-cols-3 gap-3 pb-1">
            <NumberField label="GSD if no georef" unit="cm" value={gsdCm} step={0.5} min={0.2} onChange={setGsdCm} />
            <NumberField label="EPSG override" value={epsg} step={1} min={0} onChange={(v) => setEpsg(Math.round(v))} hint="e.g. 32643 for UTM 43N, 32645 for UTM 45N. 0 = from file." />
            <NumberField label="Working limit" unit="MP" value={mp} step={4} min={2} max={64} onChange={setMp} hint="Larger images are downsampled to this many megapixels for in-browser analysis." />
          </div>
        </details>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!ortho} onClick={go}>
            Analyse survey
          </Button>
        </div>
      </div>
    </div>
  );
}
