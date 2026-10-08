// Turns OpenDroneMap's results (ground model, surface model and aerial photo, as GeoTIFFs) into a
// Plotwise survey file lined up with the plan, using the scan details the app recorded.

import { readFile } from "node:fs/promises";
import { fromArrayBuffer } from "geotiff";
import jpeg from "jpeg-js";

import { fromLocal } from "../../../packages/flight-core/src/geo.ts";
import {
  SURVEY_FORMAT,
  fillHoles,
  planToEastNorth,
  type HeightGrid,
  type Pt,
  type ScanDetails,
  type SurveyPackage,
} from "../../../packages/garden-core/src/index.ts";
import { projectionFor } from "./utm.ts";

export type Raster = {
  width: number;
  height: number;
  /** Map coordinates of the top-left corner, and the size of one pixel (y is negative: rows go south). */
  origin: [number, number];
  resolution: [number, number];
  toMap: (lat: number, lng: number) => [number, number];
  nodata: number | null;
  bands: ArrayLike<number>[];
};

export async function readRaster(path: string): Promise<Raster> {
  const buf = await readFile(path);
  const tiff = await fromArrayBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const img = await tiff.getImage();
  const keys = img.getGeoKeys() as Record<string, number> | null;
  const epsg = keys?.ProjectedCSTypeGeoKey ?? keys?.GeographicTypeGeoKey;
  if (!epsg) throw new Error(`${path} has no map position.`);
  const bands = (await img.readRasters()) as unknown as ArrayLike<number>[];
  const origin = img.getOrigin();
  const res = img.getResolution();
  return {
    width: img.getWidth(),
    height: img.getHeight(),
    origin: [origin[0], origin[1]],
    resolution: [res[0], res[1]],
    toMap: projectionFor(epsg),
    nodata: img.getGDALNoData(),
    bands,
  };
}

/** Plan point (metres) to the raster's pixel position, through GPS. */
function planToPixel(scan: ScanDetails, r: Raster, p: Pt): [number, number] {
  const en = planToEastNorth(scan.plot, scan.home, p);
  const ll = fromLocal(scan.anchor, { x: en.east, y: en.north });
  const [mx, my] = r.toMap(ll.lat, ll.lng);
  return [(mx - r.origin[0]) / r.resolution[0], (my - r.origin[1]) / r.resolution[1]];
}

/** Raster value at a pixel position, bilinear; null where there is no data. */
function sample(r: Raster, band: number, px: number, py: number): number | null {
  const x = px - 0.5;
  const y = py - 0.5;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  if (x0 < 0 || y0 < 0 || x0 + 1 >= r.width || y0 + 1 >= r.height) return null;
  const tx = x - x0;
  const ty = y - y0;
  const b = r.bands[band];
  let sum = 0;
  let wsum = 0;
  for (const [dx, dy, w] of [[0, 0, (1 - tx) * (1 - ty)], [1, 0, tx * (1 - ty)], [0, 1, (1 - tx) * ty], [1, 1, tx * ty]] as const) {
    const v = b[(y0 + dy) * r.width + x0 + dx];
    if (!Number.isFinite(v) || v === r.nodata || v < -1e4) continue;
    sum += v * w;
    wsum += w;
  }
  return wsum > 0.5 ? sum / wsum : null;
}

export function heightGrid(scan: ScanDetails, dem: Raster, cellM = 0.25): { grid: HeightGrid; coverage: number } {
  const cols = Math.ceil(scan.plot.widthM / cellM);
  const rows = Math.ceil(scan.plot.lengthM / cellM);
  const raw: (number | null)[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const [px, py] = planToPixel(scan, dem, [(c + 0.5) * cellM, (r + 0.5) * cellM]);
      const v = sample(dem, 0, px, py);
      raw.push(v === null ? null : Math.round(v * 1000) / 1000);
    }
  }
  const { values, known } = fillHoles(cols, rows, raw);
  return { grid: { cellM, cols, rows, values }, coverage: known };
}

/** The aerial photo cut to the plot rectangle and turned so the far end of the garden is at the top. */
export function plotPhoto(scan: ScanDetails, ortho: Raster, pxPerM = 40): SurveyPackage["photo"] {
  const w = Math.round(scan.plot.widthM * pxPerM);
  const h = Math.round(scan.plot.lengthM * pxPerM);
  const data = Buffer.alloc(w * h * 4);
  const alpha = ortho.bands.length >= 4 ? 3 : -1;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const [px, py] = planToPixel(scan, ortho, [(i + 0.5) / pxPerM, (j + 0.5) / pxPerM]);
      const k = (j * w + i) * 4;
      const a = alpha >= 0 ? sample(ortho, alpha, px, py) : 255;
      const inside = a !== null && a > 127;
      for (let b = 0; b < 3; b++) {
        const v = inside ? sample(ortho, b, px, py) : null;
        // Areas the drone did not see are left light grey.
        data[k + b] = v === null ? 0xd8 : Math.max(0, Math.min(255, Math.round(v)));
      }
      data[k + 3] = 255;
    }
  }
  const encoded = jpeg.encode({ data, width: w, height: h }, 85);
  return { mime: "image/jpeg", base64: Buffer.from(encoded.data).toString("base64"), widthPx: w, heightPx: h };
}

export async function makeSurvey(opts: { scan: ScanDetails; dtm: string; dsm?: string; ortho?: string; photoCount: number; now?: Date }): Promise<SurveyPackage> {
  const dtm = await readRaster(opts.dtm);
  const ground = heightGrid(opts.scan, dtm);
  const surface = opts.dsm ? heightGrid(opts.scan, await readRaster(opts.dsm)).grid : undefined;
  const photo = opts.ortho ? plotPhoto(opts.scan, await readRaster(opts.ortho)) : undefined;
  return {
    format: SURVEY_FORMAT,
    version: 1,
    createdAt: (opts.now ?? new Date()).toISOString(),
    flownAt: opts.scan.flownAt,
    photoCount: opts.photoCount,
    plot: opts.scan.plot,
    ground: ground.grid,
    surface,
    photo,
    coverage: Math.round(ground.coverage * 1000) / 1000,
  };
}

export function readScan(text: string): ScanDetails {
  const s = JSON.parse(text) as ScanDetails;
  if (s.format !== "plotwise-scan" || !s.plot || !s.home || !s.anchor) {
    throw new Error("That is not a Plotwise scan details file (plotwise-scan-….json, shared from the app after a scan).");
  }
  return s;
}
