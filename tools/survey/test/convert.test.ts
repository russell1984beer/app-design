import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeArrayBuffer } from "geotiff";
import jpeg from "jpeg-js";

import { bearingDeg, distanceM, fromLocal } from "../../../packages/flight-core/src/geo.ts";
import { TEST_PLOT, gridHeight, planToEastNorth, readSurvey, type ScanDetails } from "../../../packages/garden-core/src/index.ts";
import { adjustScan, makeSurvey, readScan } from "../src/convert.ts";
import { latLngToUtm, projectionFor, utmZone } from "../src/utm.ts";

const anchor = { lat: 52.0, lng: -1.0 };
const scan: ScanDetails = {
  format: "plotwise-scan",
  version: 1,
  flownAt: "2026-10-08T10:00:00Z",
  plot: TEST_PLOT,
  home: [3.5, 14.75],
  anchor,
  photoCount: 52,
};
const toUtm = projectionFor(32630);
const planToUtm = (x: number, y: number) => {
  const en = planToEastNorth(TEST_PLOT, scan.home, [x, y]);
  const ll = fromLocal(anchor, { x: en.east, y: en.north });
  return toUtm(ll.lat, ll.lng);
};

test("UTM: the right zone, the central meridian at 500 km, and true distances", () => {
  assert.equal(utmZone(-1), 30);
  assert.ok(Math.abs(latLngToUtm(52, -3, 30, true)[0] - 500000) < 1e-6);
  const a = toUtm(52, -1);
  const b = toUtm(52 + 100 / 111_200, -1); // about 100 m north
  const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
  assert.ok(Math.abs(d - 100) < 0.5, `${d}`);
  assert.throws(() => projectionFor(27700), /does not know/);
});

/** A GeoTIFF in UTM zone 30 around the plot, like OpenDroneMap writes. */
function geotiff(dir: string, name: string, bands: number, value: (e: number, n: number, band: number) => number | null, res = 0.05, nodata?: number) {
  const corners = [[0, 0], [7, 0], [7, TEST_PLOT.lengthM], [0, TEST_PLOT.lengthM]].map(([x, y]) => planToUtm(x, y));
  const e0 = Math.min(...corners.map((c) => c[0])) - 3;
  const n1 = Math.max(...corners.map((c) => c[1])) + 3;
  const width = Math.ceil((Math.max(...corners.map((c) => c[0])) + 3 - e0) / res);
  const height = Math.ceil((n1 - (Math.min(...corners.map((c) => c[1])) - 3)) / res);
  const data: number[][] = Array.from({ length: bands }, () => new Array(width * height));
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const e = e0 + (c + 0.5) * res;
      const n = n1 - (r + 0.5) * res;
      for (let b = 0; b < bands; b++) data[b][r * width + c] = value(e, n, b) ?? nodata ?? 0;
    }
  }
  const interleaved = new Uint8Array(width * height * bands);
  for (let i = 0; i < width * height; i++) for (let b = 0; b < bands; b++) interleaved[i * bands + b] = data[b][i];
  const buf = writeArrayBuffer(bands === 1 ? Float32Array.from(data[0]) : interleaved, {
    width,
    height,
    ModelPixelScale: [res, res, 0],
    ModelTiepoint: [0, 0, 0, e0, n1, 0],
    GTModelTypeGeoKey: 1,
    GTRasterTypeGeoKey: 1,
    ProjectedCSTypeGeoKey: 32630,
    ...(bands > 1 ? { SamplesPerPixel: bands, BitsPerSample: new Array(bands).fill(8), ExtraSamples: [2] } : {}),
    ...(nodata !== undefined ? { GDAL_NODATA: `${nodata}\0` } : {}),
  } as never);
  const path = join(dir, name);
  writeFileSync(path, Buffer.from(buf as ArrayBuffer));
  return path;
}

test("conversion: the ground model is lined up with the plan, metre for metre", async () => {
  const dir = mkdtempSync(join(tmpdir(), "plotwise-"));
  // A sloping plane in map coordinates, so every height says exactly where it was taken.
  const [e0, n0] = planToUtm(0, 0);
  const height = (e: number, n: number) => 50 + 0.02 * (e - e0) + 0.05 * (n - n0);
  const dtm = geotiff(dir, "dtm.tif", 1, height);
  const s = await makeSurvey({ scan, dtm, photoCount: 52, now: new Date("2026-10-08T12:00:00Z") });
  assert.equal(s.ground.cols, 28);
  assert.equal(s.ground.rows, Math.ceil(TEST_PLOT.lengthM / 0.25));
  assert.equal(s.coverage, 1);
  for (const [x, y] of [[1, 1], [3.5, 20], [6, 40], [2.2, 31.7]]) {
    const [e, n] = planToUtm(x, y);
    assert.ok(Math.abs(gridHeight(s.ground, x, y) - height(e, n)) < 0.01, `height at ${x},${y}`);
  }
  assert.equal(readSurvey(JSON.stringify(s)).photoCount, 52);
});

test("conversion: gaps in the model are filled and the coverage is reported", async () => {
  const dir = mkdtempSync(join(tmpdir(), "plotwise-"));
  const [, nMid] = planToUtm(3.5, 21.5);
  // No data on one side of a line across the middle of the plot.
  const dtm = geotiff(dir, "dtm.tif", 1, (e, n) => (n > nMid + 3 ? null : 10), 0.1, -9999);
  const s = await makeSurvey({ scan, dtm, photoCount: 52 });
  assert.ok(s.coverage > 0.2 && s.coverage < 0.8, `${s.coverage}`);
  assert.ok(s.ground.values.every((v) => Math.abs(v - 10) < 1e-9), "filled from the known side");
  // The file says which squares were measured, so the app can fill the rest from better heights.
  const m = s.ground.measured!;
  assert.equal(m.length, s.ground.values.length);
  assert.ok(Math.abs([...m].filter((ch) => ch === "1").length / m.length - s.coverage) < 0.002);
});

test("conversion: the aerial photo is cut to the plot with the far end at the top", async () => {
  const dir = mkdtempSync(join(tmpdir(), "plotwise-"));
  const dtm = geotiff(dir, "dtm.tif", 1, () => 10, 0.2);
  // Red in the far half of the garden (plan y < half the length), blue in the street half.
  const [eA, nA] = planToUtm(3.5, 0);
  const [eB, nB] = planToUtm(3.5, TEST_PLOT.lengthM);
  const far = (e: number, n: number) => (e - eA) ** 2 + (n - nA) ** 2 < (e - eB) ** 2 + (n - nB) ** 2;
  const ortho = geotiff(dir, "ortho.tif", 4, (e, n, b) => (b === 3 ? 255 : far(e, n) ? [220, 20, 20][b] : [20, 20, 220][b]), 0.1);
  const s = await makeSurvey({ scan, dtm, ortho, photoCount: 52 });
  assert.equal(s.photo!.widthPx, 280);
  assert.equal(s.photo!.heightPx, TEST_PLOT.lengthM * 40);
  const img = jpeg.decode(Buffer.from(s.photo!.base64, "base64"));
  const px = (x: number, y: number) => Array.from(img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 3));
  assert.ok(px(140, 100)[0] > 150 && px(140, 100)[2] < 80, "top is the far end (red)");
  assert.ok(px(140, s.photo!.heightPx - 120)[2] > 150 && px(140, s.photo!.heightPx - 120)[0] < 80, "bottom is the street end (blue)");
});

test("line-up correction: new garden direction, outline moved back and sideways", () => {
  const turned = adjustScan(scan, { bearingDeg: 118 });
  assert.equal(turned.plot.gardenBearingDeg, 118);
  assert.deepEqual(turned.anchor, anchor);
  const back = adjustScan(scan, { bearingDeg: 118, backM: 4.5 }).anchor;
  assert.ok(Math.abs(distanceM(anchor, back) - 4.5) < 0.01);
  assert.ok(Math.abs(bearingDeg(anchor, back) - 118) < 0.5, "towards the far end of the garden");
  const side = adjustScan(scan, { bearingDeg: 118, sideM: 2 }).anchor;
  assert.ok(Math.abs(distanceM(anchor, side) - 2) < 0.01);
  assert.ok(Math.abs(bearingDeg(anchor, side) - 208) < 0.5, "towards the right-hand fence");
  assert.equal(scan.plot.gardenBearingDeg, TEST_PLOT.gardenBearingDeg, "the original is left alone");
  const longer = adjustScan(scan, { rearGardenM: TEST_PLOT.rearGardenM + 3.5 }).plot;
  assert.equal(longer.rearGardenM, TEST_PLOT.rearGardenM + 3.5);
  assert.equal(longer.lengthM, TEST_PLOT.lengthM + 3.5, "the whole plot grows with the rear garden");
  assert.equal(longer.houseDepthM, TEST_PLOT.houseDepthM);
});

test("scan details file: checked before use", () => {
  assert.equal(readScan(JSON.stringify(scan)).photoCount, 52);
  assert.throws(() => readScan("{}"), /not a Plotwise scan details file/);
});
