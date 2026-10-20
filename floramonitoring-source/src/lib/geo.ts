import proj4 from "proj4";
import type { GeoInfo } from "./types";

export const WGS84 = "+proj=longlat +datum=WGS84 +no_defs";

/** proj4 definitions for the CRSs drone software most often writes. */
export function proj4ForEpsg(epsg: number | null): string | null {
  if (!epsg) return null;
  if (epsg === 4326) return WGS84;
  if (epsg === 3857 || epsg === 900913)
    return "+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +wktext +no_defs";
  if (epsg >= 32601 && epsg <= 32660) return `+proj=utm +zone=${epsg - 32600} +datum=WGS84 +units=m +no_defs`;
  if (epsg >= 32701 && epsg <= 32760) return `+proj=utm +zone=${epsg - 32700} +south +datum=WGS84 +units=m +no_defs`;
  if (epsg >= 26901 && epsg <= 26923) return `+proj=utm +zone=${epsg - 26900} +datum=NAD83 +units=m +no_defs`;
  if (epsg >= 25828 && epsg <= 25838)
    return `+proj=utm +zone=${epsg - 25800} +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs`;
  return null;
}

/** Try to fetch an unknown EPSG definition from epsg.io (best effort). */
export async function fetchProj4(epsg: number): Promise<string | null> {
  try {
    const r = await fetch(`https://epsg.io/${epsg}.proj4`);
    if (!r.ok) return null;
    const t = (await r.text()).trim();
    return t.startsWith("+proj") ? t : null;
  } catch {
    return null;
  }
}

export function isGeographicEpsg(epsg: number | null): boolean {
  return epsg === 4326 || epsg === 4269 || epsg === 4258;
}

/** Working-pixel (x, y) -> map coordinates (pixel centre). */
export function pixelToMap(geo: GeoInfo, x: number, y: number): [number, number] {
  return [geo.originX + (x + 0.5) * geo.resX, geo.originY - (y + 0.5) * geo.resY];
}

export function mapToPixel(geo: GeoInfo, mx: number, my: number): [number, number] {
  return [(mx - geo.originX) / geo.resX - 0.5, (geo.originY - my) / geo.resY - 0.5];
}

const converters = new Map<string, proj4.Converter>();
function conv(def: string) {
  let c = converters.get(def);
  if (!c) {
    c = proj4(def, WGS84);
    converters.set(def, c);
  }
  return c;
}

export function mapToLonLat(geo: GeoInfo, mx: number, my: number): [number, number] | null {
  if (geo.isGeographic) return [mx, my];
  if (!geo.proj4) return null;
  try {
    const [lon, lat] = conv(geo.proj4).forward([mx, my]);
    return Number.isFinite(lon) && Number.isFinite(lat) ? [lon, lat] : null;
  } catch {
    return null;
  }
}

export function lonLatToMap(geo: GeoInfo, lon: number, lat: number): [number, number] | null {
  if (geo.isGeographic) return [lon, lat];
  if (!geo.proj4) return null;
  try {
    const [x, y] = conv(geo.proj4).inverse([lon, lat]);
    return [x, y];
  } catch {
    return null;
  }
}

export function pixelToLonLat(geo: GeoInfo | null, x: number, y: number): [number, number] | null {
  if (!geo) return null;
  const [mx, my] = pixelToMap(geo, x, y);
  return mapToLonLat(geo, mx, my);
}

/** Ground sample distance in metres for a working-grid pixel. */
export function gsdMetres(geo: GeoInfo): number {
  if (!geo.isGeographic) return (geo.resX + geo.resY) / 2;
  const latC = geo.originY; // approximate
  const mPerDegLat = 111320;
  const mPerDegLon = 111320 * Math.cos((latC * Math.PI) / 180);
  return (geo.resX * mPerDegLon + geo.resY * mPerDegLat) / 2;
}

/** Image footprint corners in lon/lat: [[lat,lon] x4] for map overlays. */
export function footprintLatLng(geo: GeoInfo, w: number, h: number): [number, number][] | null {
  const pts: [number, number][] = [];
  for (const [x, y] of [
    [-0.5, -0.5],
    [w - 0.5, -0.5],
    [w - 0.5, h - 0.5],
    [-0.5, h - 0.5],
  ] as const) {
    const ll = pixelToLonLat(geo, x, y);
    if (!ll) return null;
    pts.push([ll[1], ll[0]]);
  }
  return pts;
}

export function utmEpsgForLonLat(lon: number, lat: number): number {
  const zone = Math.floor((lon + 180) / 6) + 1;
  return (lat >= 0 ? 32600 : 32700) + zone;
}
