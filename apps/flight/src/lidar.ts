// Free Environment Agency LIDAR for England (Open Government Licence): ground height (DTM) and
// the top of everything (first-return DSM), 1 m grids in British National Grid. Fetched from the
// Defra WCS services round the take-off point, kept in a file on the phone, and used for:
// - the Survey tab's levels until a drone survey is opened (ground heights to about 15 cm);
// - obstacle heights (trees, roofs) for the pre-flight clearance check.
// Positions come from GPS through a Helmert shift, so they are good to a few metres: everything
// that uses them allows for that.

import { useEffect, useReducer } from "react";
import { inflate } from "pako";
import { File, Paths } from "expo-file-system";

import { distanceM, type LatLng } from "../../../packages/flight-core/src/geo.ts";
import { wgs84ToGrid } from "../../../packages/garden-core/src/bng.ts";
import { parseArcGrid, parseTiff, type Raster } from "../../../packages/garden-core/src/raster.ts";
import type { Pt } from "../../../packages/garden-core/src/index.ts";

import type { LidarSite } from "./lidarMath";

export { aboveSeaLevelM, lidarSurvey, obstacleHeights, takeoffOffset, type LidarSite, type TakeoffOffset } from "./lidarMath";

const DTM_URL = "https://environment.data.gov.uk/spatialdata/lidar-composite-digital-terrain-model-dtm-1m/wcs";
const DSM_URL = "https://environment.data.gov.uk/spatialdata/lidar-composite-digital-surface-model-first-return-dsm-1m/wcs";

/** How far round the take-off point to fetch: the whole plot and its neighbours. */
const RADIUS_M = 70;
/** Same site if the take-off point is within this of where the data was fetched. */
const SAME_SITE_M = 40;
const FILE = "lidar.json";

type StoredRaster = { width: number; height: number; values: (number | null)[]; origin: { x: number; y: number }; pixelSize: { x: number; y: number } };
type Stored = { format: "plotwise-lidar"; version: 1; fetchedAt: string; anchor: LatLng; home: Pt; dtm: StoredRaster; dsm: StoredRaster | null };

export type LidarResult = { site: LidarSite } | { error: string };

// ---- The web service ---------------------------------------------------------------------------

async function text(url: string): Promise<string> {
  const res = await fetch(url);
  const body = await res.text();
  if (!res.ok) throw new Error(`${res.status} from the Environment Agency`);
  return body;
}

/** The elevation coverage's id, the axis names and a format, read from the service itself. */
async function describe(base: string): Promise<{ id: string; axes: [string, string]; format: string }> {
  const caps = await text(`${base}?service=WCS&version=2.0.1&request=GetCapabilities`);
  const ids = [...caps.matchAll(/<(?:wcs:)?CoverageId>([^<]+)<\/(?:wcs:)?CoverageId>/g)].map((m) => m[1].trim());
  const id = ids.find((x) => /elevation|dtm|dsm/i.test(x) && !/hillshade/i.test(x)) ?? ids.find((x) => !/hillshade/i.test(x));
  if (!id) throw new Error("the LIDAR service lists no height data");
  const formats = [...caps.matchAll(/<(?:wcs:)?formatSupported>([^<]+)<\/(?:wcs:)?formatSupported>/g)].map((m) => m[1].trim());
  const format =
    formats.find((f) => /arcgrid|aaigrid/i.test(f)) ?? formats.find((f) => /tiff/i.test(f)) ?? "image/tiff";
  let axes: [string, string] = ["E", "N"];
  try {
    const desc = await text(`${base}?service=WCS&version=2.0.1&request=DescribeCoverage&coverageId=${encodeURIComponent(id)}`);
    const m = desc.match(/axisLabels="(\S+)\s+(\S+)"/);
    if (m) axes = [m[1], m[2]];
  } catch {
    // Keep E/N, the usual names for British National Grid.
  }
  return { id, axes, format };
}

async function coverage(base: string, box: { e0: number; e1: number; n0: number; n1: number }): Promise<Raster> {
  const d = await describe(base);
  const url =
    `${base}?service=WCS&version=2.0.1&request=GetCoverage&coverageId=${encodeURIComponent(d.id)}` +
    `&subset=${d.axes[0]}(${box.e0},${box.e1})&subset=${d.axes[1]}(${box.n0},${box.n1})&format=${encodeURIComponent(d.format)}`;
  const res = await fetch(url);
  const buf = new Uint8Array(await res.arrayBuffer());
  const head = String.fromCharCode(...buf.subarray(0, 2));
  if (!res.ok || head === "<?" || head === "<o" || head === "<E") {
    const msg = new TextDecoderLite(buf).text().match(/<(?:ows:)?ExceptionText>([^<]+)</)?.[1];
    throw new Error(msg ? `the LIDAR service said: ${msg.trim()}` : `${res.status} from the LIDAR service`);
  }
  const r = head === "II" || head === "MM" ? parseTiff(buf, (b) => inflate(b)) : parseArcGrid(new TextDecoderLite(buf).text());
  // Without position tags in the file, the pixels fill the box asked for.
  if (!r.origin || !r.pixelSize) {
    r.origin = { x: box.e0, y: box.n1 };
    r.pixelSize = { x: (box.e1 - box.e0) / r.width, y: (box.n1 - box.n0) / r.height };
  }
  if (!r.values.some((v) => Number.isFinite(v))) throw new Error("no LIDAR coverage here (it covers England only)");
  return r;
}

/** Bytes to text without TextDecoder (not on every phone's JavaScript engine). */
class TextDecoderLite {
  constructor(private readonly b: Uint8Array) {}
  text(): string {
    let s = "";
    for (let i = 0; i < this.b.length; i += 8192) s += String.fromCharCode(...this.b.subarray(i, i + 8192));
    return s;
  }
}

// ---- Storage -----------------------------------------------------------------------------------

const toStored = (r: Raster): StoredRaster => ({
  width: r.width,
  height: r.height,
  values: Array.from(r.values, (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null)),
  origin: r.origin!,
  pixelSize: r.pixelSize!,
});
const fromStored = (r: StoredRaster): Raster => ({ ...r, values: Float64Array.from(r.values, (v) => (v === null ? NaN : v)) });

let site: LidarSite | null = null;
let lastError: { at: number; anchor: LatLng; error: string } | null = null;
let loading = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export async function loadSavedLidar(): Promise<void> {
  try {
    const f = new File(Paths.document, FILE);
    if (!f.exists) return;
    const s = JSON.parse(await f.text()) as Stored;
    if (s.format !== "plotwise-lidar") return;
    site = { fetchedAt: s.fetchedAt, anchor: s.anchor, home: s.home, dtm: fromStored(s.dtm), dsm: s.dsm ? fromStored(s.dsm) : null };
    emit();
  } catch {
    site = null;
  }
}

export async function fetchLidar(anchor: LatLng, home: Pt): Promise<void> {
  if (loading) return;
  loading = true;
  emit();
  try {
    const c = wgs84ToGrid(anchor.lat, anchor.lng);
    const box = { e0: Math.floor(c.e - RADIUS_M), e1: Math.ceil(c.e + RADIUS_M), n0: Math.floor(c.n - RADIUS_M), n1: Math.ceil(c.n + RADIUS_M) };
    const dtm = await coverage(DTM_URL, box);
    let dsm: Raster | null = null;
    try {
      dsm = await coverage(DSM_URL, box);
    } catch {
      // Levels still work without it; obstacle heights do not.
    }
    site = { fetchedAt: new Date().toISOString(), anchor, home, dtm, dsm };
    lastError = null;
    const f = new File(Paths.document, FILE);
    if (f.exists) f.delete();
    f.create();
    const stored: Stored = { format: "plotwise-lidar", version: 1, fetchedAt: site.fetchedAt, anchor, home, dtm: toStored(dtm), dsm: dsm ? toStored(dsm) : null };
    f.write(JSON.stringify(stored));
  } catch (e) {
    lastError = { at: Date.now(), anchor, error: (e as Error).message };
  } finally {
    loading = false;
    emit();
  }
}

/** Say where on the plan the drone was when the LIDAR was fetched (lines the levels up again). */
export function setLidarHome(home: Pt): void {
  if (!site) return;
  site = { ...site, home };
  try {
    const f = new File(Paths.document, FILE);
    if (f.exists) {
      const stored = JSON.parse(f.textSync()) as Stored;
      stored.home = home;
      f.write(JSON.stringify(stored));
    }
  } catch {
    // The change still holds until the app is closed.
  }
  emit();
}

/** The LIDAR for this take-off point, if fetched. */
export function lidarFor(anchor: LatLng | null): LidarSite | null {
  if (!site) return null;
  if (anchor && distanceM(site.anchor, anchor) > SAME_SITE_M) return null;
  return site;
}

export function currentLidar(): LidarSite | null {
  return site;
}

/** Why there is no LIDAR for this take-off point yet: still fetching, or the error. */
export function lidarStatus(anchor: LatLng): { loading: boolean; error: string | null } {
  const err = lastError && distanceM(lastError.anchor, anchor) < SAME_SITE_M ? lastError.error : null;
  return { loading, error: err };
}

/** Fetch the LIDAR for this take-off point if there is none yet, and redraw when it arrives. */
export function useLidar(anchor: LatLng | null, home: Pt): { site: LidarSite | null; loading: boolean; error: string | null } {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    listeners.add(bump);
    return () => {
      listeners.delete(bump);
    };
  }, []);
  const have = lidarFor(anchor);
  const err = lastError && anchor && distanceM(lastError.anchor, anchor) < SAME_SITE_M ? lastError : null;
  useEffect(() => {
    // An error is tried again after 5 minutes.
    if (anchor && !have && !loading && (!err || Date.now() - err.at > 5 * 60_000)) fetchLidar(anchor, home);
  }, [anchor?.lat, anchor?.lng, !!have]);
  return { site: have, loading, error: have ? null : (err?.error ?? null) };
}

