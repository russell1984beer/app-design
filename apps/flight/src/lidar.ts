// Free Environment Agency LIDAR for England (Open Government Licence): ground height (DTM) and
// the top of everything (first-return DSM), 1 m grids in British National Grid. Fetched from the
// Defra WCS services round the take-off point, kept in a file on the phone, and used for:
// - the Survey tab's levels until a drone survey is opened (ground heights to about 15 cm);
// - obstacle heights (trees, roofs) for the pre-flight clearance check.
// Positions come from GPS through a Helmert shift, so they are good to a few metres: everything
// that uses them allows for that.

import { inflate } from "pako";
import { File, Paths } from "expo-file-system";

import { distanceM, type LatLng } from "../../../packages/flight-core/src/geo.ts";
import { wgs84ToGrid } from "../../../packages/garden-core/src/bng.ts";
import { parseArcGrid, parseTiff, type Raster } from "../../../packages/garden-core/src/raster.ts";
import type { Pt } from "../../../packages/garden-core/src/index.ts";

import type { LidarSite } from "./lidarMath";
import { placeCache } from "./placeCache";
import { HOME_PROJECT_ID, currentProject } from "./store";

const DTM_URL = "https://environment.data.gov.uk/spatialdata/lidar-composite-digital-terrain-model-dtm-1m/wcs";
const DSM_URL = "https://environment.data.gov.uk/spatialdata/lidar-composite-digital-surface-model-first-return-dsm-1m/wcs";

/** How far round the take-off point to fetch: the whole plot and its neighbours. */
const RADIUS_M = 70;
/** Same site if the take-off point is within this of where the data was fetched. */
const SAME_SITE_M = 40;
const FILE = "lidar.json";

type StoredRaster = { width: number; height: number; values: (number | null)[]; origin: { x: number; y: number }; pixelSize: { x: number; y: number } };
type Stored = { format: "plotwise-lidar"; version: 1; fetchedAt: string; anchor: LatLng; home: Pt; dtm: StoredRaster; dsm: StoredRaster | null };

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

async function download(anchor: LatLng, home: Pt): Promise<LidarSite> {
  const c = wgs84ToGrid(anchor.lat, anchor.lng);
  const box = { e0: Math.floor(c.e - RADIUS_M), e1: Math.ceil(c.e + RADIUS_M), n0: Math.floor(c.n - RADIUS_M), n1: Math.ceil(c.n + RADIUS_M) };
  const dtm = await coverage(DTM_URL, box);
  let dsm: Raster | null = null;
  try {
    dsm = await coverage(DSM_URL, box);
  } catch {
    // Levels still work without it; obstacle heights do not.
  }
  const site: LidarSite = { fetchedAt: new Date().toISOString(), anchor, home, dtm, dsm };
  try {
    const f = new File(Paths.document, FILE);
    if (f.exists) f.delete();
    f.create();
    const stored: Stored = { format: "plotwise-lidar", version: 1, fetchedAt: site.fetchedAt, anchor, home, dtm: toStored(dtm), dsm: dsm ? toStored(dsm) : null };
    f.write(JSON.stringify(stored));
  } catch {
    // Still used until the app is closed.
  }
  return site;
}

// The phone keeps one site, with no time limit. A failed fetch is tried again after 5 minutes.
const lidar = placeCache<LidarSite, [home: Pt]>({ keepMs: Infinity, samePlaceM: SAME_SITE_M, retryAfterErrorMs: 5 * 60_000, load: download });

export async function loadSavedLidar(): Promise<void> {
  try {
    const f = new File(Paths.document, FILE);
    if (!f.exists) return;
    const s = JSON.parse(await f.text()) as Stored;
    if (s.format !== "plotwise-lidar") return;
    lidar.set(s.anchor, { fetchedAt: s.fetchedAt, anchor: s.anchor, home: s.home, dtm: fromStored(s.dtm), dsm: s.dsm ? fromStored(s.dsm) : null });
  } catch {
    // A damaged file: fetched again when needed.
  }
}

export const fetchLidar = (anchor: LatLng, home: Pt) => lidar.refresh(anchor, home);

/** Say where on the plan the drone was when the LIDAR was fetched (lines the levels up again). */
export function setLidarHome(home: Pt): void {
  const site = lidar.latest();
  if (!site) return;
  lidar.set(site.anchor, { ...site, home });
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
}

/** The LIDAR for this take-off point, if fetched (with no take-off point: whatever the phone has). */
export function lidarFor(anchor: LatLng | null): LidarSite | null {
  return anchor ? lidar.current(anchor) : lidar.latest();
}

/** A postcode's middle can be this far from the property itself. */
const POSTCODE_REACH_M = 300;

/**
 * The LIDAR for the open project: only if it was fetched there. The phone keeps one site, fetched on
 * the owner's own flights; another property must not show its levels. (The first project, the owner's
 * own, always used it before projects had locations.)
 */
export function currentLidar(): LidarSite | null {
  const site = lidar.latest();
  if (!site) return null;
  const p = currentProject();
  if (p.id === HOME_PROJECT_ID) return site;
  const at = p.corners?.[0] ?? p.overlay?.centre ?? p.postcodeAt;
  return at && distanceM(at, site.anchor) <= POSTCODE_REACH_M ? site : null;
}

/** Why there is no LIDAR for this take-off point yet: still fetching, or the error. */
export function lidarStatus(anchor: LatLng): { loading: boolean; error: string | null } {
  return { loading: lidar.loading(), error: lidar.error(anchor) };
}

/** Fetch the LIDAR for this take-off point if there is none yet, and redraw when it arrives. */
export function useLidar(anchor: LatLng | null, home: Pt): { site: LidarSite | null; loading: boolean; error: string | null } {
  const { error, loading } = lidar.use(anchor, home);
  const site = lidarFor(anchor);
  return { site, loading, error: site ? null : error };
}
