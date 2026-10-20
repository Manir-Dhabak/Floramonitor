"use client";

import "leaflet/dist/leaflet.css";
import { MapPinOff } from "lucide-react";
import { useEffect, useRef } from "react";
import type * as Leaflet from "leaflet";
import { footprintLatLng, pixelToLonLat } from "@/lib/geo";
import { treeId } from "@/lib/exports";
import { rgbCanvas } from "@/lib/render";
import { useAnalysis } from "./AnalysisContext";
import { Empty } from "@/components/ui";
import { HEALTH_COLORS } from "@/components/ui/charts";

export function MapView() {
  const an = useAnalysis();
  const a = an.active;
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);
  const layerRef = useRef<Leaflet.LayerGroup | null>(null);
  const ctlRef = useRef<Leaflet.Control.Layers | null>(null);
  const geo = a?.survey.raster.geo ?? null;
  const hasLL = !!geo && (geo.isGeographic || !!geo.proj4);

  useEffect(() => {
    if (!el.current || !a || !hasLL || !geo) return;
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !el.current) return;
      if (!mapRef.current) {
        const map = L.map(el.current, { zoomControl: true, preferCanvas: true, maxZoom: 24 });
        const sat = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
          maxZoom: 24,
          maxNativeZoom: 19,
          attribution: "Imagery © Esri, Maxar, Earthstar Geographics",
        });
        const osm = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 24,
          maxNativeZoom: 19,
          attribution: "© OpenStreetMap contributors",
        });
        sat.addTo(map);
        ctlRef.current = L.control.layers({ "Satellite (Esri)": sat, OpenStreetMap: osm }, {}, { collapsed: false }).addTo(map);
        L.control.scale({ metric: true, imperial: false }).addTo(map);
        mapRef.current = map;
      }
      const map = mapRef.current;
      if (layerRef.current) {
        ctlRef.current?.removeLayer(layerRef.current);
        layerRef.current.remove();
      }
      const ctl = ctlRef.current!;
      const group = L.layerGroup().addTo(map);
      layerRef.current = group;
      const sv = a.survey;
      const r = sv.raster;
      const fp = footprintLatLng(geo, r.width, r.height);
      if (fp) {
        const lats = fp.map((p) => p[0]);
        const lons = fp.map((p) => p[1]);
        const bounds = L.latLngBounds([Math.min(...lats), Math.min(...lons)], [Math.max(...lats), Math.max(...lons)]);
        // orthomosaic overlay (downscaled)
        const src = rgbCanvas(r);
        const k = Math.min(1, 2048 / Math.max(r.width, r.height));
        const c = document.createElement("canvas");
        c.width = Math.round(r.width * k);
        c.height = Math.round(r.height * k);
        c.getContext("2d")!.drawImage(src, 0, 0, c.width, c.height);
        const ortho = L.imageOverlay(c.toDataURL("image/jpeg", 0.85), bounds, { opacity: 0.95 });
        ortho.addTo(group);
        ctl.addOverlay(ortho, "Orthomosaic (approx. overlay)");
        L.polygon(fp, { color: "#5cc8f2", weight: 1.5, fill: false, dashArray: "4 4" }).addTo(group);
        map.fitBounds(bounds, { padding: [24, 24] });
      }
      // gaps
      if (a.survival) {
        const gaps = L.layerGroup();
        for (const cell of a.survival.cells) {
          if (!cell.gap) continue;
          const pts = [
            [cell.x0, cell.y0],
            [cell.x1, cell.y0],
            [cell.x1, cell.y1],
            [cell.x0, cell.y1],
          ].map(([x, y]) => pixelToLonLat(geo, x - 0.5, y - 0.5));
          if (pts.some((p) => !p)) continue;
          L.polygon(
            pts.map((p) => [p![1], p![0]] as [number, number]),
            { color: "#f2685c", weight: 1, fillOpacity: 0.3 },
          )
            .bindPopup(`<b>Stocking gap</b><br/>${cell.observed} of ${cell.expected.toFixed(1)} expected trees<br/>Replant ≈ ${Math.max(0, Math.round(cell.expected - cell.observed))}`)
            .addTo(gaps);
        }
        gaps.addTo(group);
        ctl.addOverlay(gaps, "Stocking gaps");
        if (a.survival.plantedHull.length >= 6) {
          const hull: [number, number][] = [];
          for (let i = 0; i < a.survival.plantedHull.length; i += 2) {
            const ll = pixelToLonLat(geo, a.survival.plantedHull[i], a.survival.plantedHull[i + 1]);
            if (ll) hull.push([ll[1], ll[0]]);
          }
          const hl = L.polygon(hull, { color: "#5cc8f2", weight: 2, fill: false });
          ctl.addOverlay(hl, "Planted area");
        }
      }
      // trees
      const trees = L.layerGroup();
      const renderer = L.canvas({ padding: 0.5 });
      a.trees.forEach((t, i) => {
        if (t.lat === null || t.lon === null) return;
        const co2 = a.carbon ? a.carbon.perTreeKgCo2e[i] : null;
        L.circleMarker([t.lat, t.lon], {
          renderer,
          radius: Math.max(3, Math.min(9, t.crownDiameterM * 2.4)),
          color: "#04110b",
          weight: 1,
          fillColor: t.source === "manual" ? "#b39bff" : HEALTH_COLORS[t.health],
          fillOpacity: 0.9,
        })
          .bindPopup(
            `<div style="font-size:12px;line-height:1.5"><b>${treeId(sv, t)}</b><br/>` +
              `${t.lat.toFixed(6)}, ${t.lon.toFixed(6)}<br/>` +
              `Crown ${t.crownDiameterM.toFixed(2)} m · Height ${t.heightM !== null ? t.heightM.toFixed(2) + " m" : "—"}<br/>` +
              `Health: ${t.health}${co2 !== null ? ` · ${co2.toFixed(2)} kg CO₂e` : ""}</div>`,
          )
          .addTo(trees);
      });
      trees.addTo(group);
      ctl.addOverlay(trees, `Trees (${a.trees.length})`);
      // field plots
      if (sv.fieldPlots.length) {
        const plots = L.layerGroup();
        for (const p of sv.fieldPlots) {
          if (p.lat === null || p.lon === null) continue;
          L.circle([p.lat, p.lon], { radius: p.radiusM, color: "#5cc8f2", weight: 2, fillOpacity: 0.08 })
            .bindTooltip(p.id, { permanent: true, direction: "right", className: "" })
            .addTo(plots);
        }
        plots.addTo(group);
        ctl.addOverlay(plots, "Field plots");
      }
      setTimeout(() => map.invalidateSize(), 50);
    })();
    return () => {
      cancelled = true;
    };
  }, [a, geo, hasLL]);

  useEffect(
    () => () => {
      mapRef.current?.remove();
      mapRef.current = null;
    },
    [],
  );

  if (!a) return null;
  if (!hasLL)
    return (
      <Empty icon={<MapPinOff size={36} />} title="This survey is not georeferenced">
        Load a GeoTIFF orthomosaic (or a JPG/PNG with a world file and EPSG code) to see trees on the satellite basemap and export GPS-tagged inventories.
      </Empty>
    );
  return <div ref={el} className="h-full w-full overflow-hidden rounded-xl border border-line" />;
}
