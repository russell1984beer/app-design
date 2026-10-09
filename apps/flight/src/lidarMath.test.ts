import { test } from "node:test";
import assert from "node:assert/strict";

import { fromLocal, type LatLng } from "../../../packages/flight-core/src/geo.ts";
import { planGrid } from "../../../packages/flight-core/src/planner.ts";
import { wgs84ToGrid } from "../../../packages/garden-core/src/bng.ts";
import type { Raster } from "../../../packages/garden-core/src/raster.ts";

import { lidarSurvey, obstacleHeights, type LidarSite } from "./lidarMath.ts";

const HOME: LatLng = { lat: 52.0, lng: -1.0 };
const at = (north: number, east: number) => fromLocal(HOME, { x: east, y: north });

/** 1 m rasters over 160 m round the take-off point, in National Grid like the real thing. */
function site(): LidarSite {
  const c = wgs84ToGrid(HOME.lat, HOME.lng);
  const size = 160;
  const origin = { x: Math.floor(c.e) - size / 2, y: Math.floor(c.n) + size / 2 };
  const make = (f: (e: number, n: number) => number): Raster => {
    const values = new Float64Array(size * size);
    for (let r = 0; r < size; r++) for (let k = 0; k < size; k++) values[r * size + k] = f(origin.x + k + 0.5, origin.y - r - 0.5);
    return { width: size, height: size, values, origin, pixelSize: { x: 1, y: 1 } };
  };
  // Gently sloping ground; a 6 m tree 15 m north of the take-off point; an 18 m mast 45 m east.
  const tree = wgs84ToGrid(at(15, 0).lat, at(15, 0).lng);
  const mast = wgs84ToGrid(at(0, 45).lat, at(0, 45).lng);
  const ground = (e: number, n: number) => 30 + (n - c.n) * 0.02;
  const dtm = make(ground);
  const dsm = make((e, n) => ground(e, n) + (Math.hypot(e - tree.e, n - tree.n) < 2 ? 6 : Math.hypot(e - mast.e, n - mast.n) < 1.5 ? 18 : 0));
  return { fetchedAt: "2026-10-09T12:00:00Z", anchor: HOME, home: [3.5, 20], dtm, dsm };
}

test("obstacle heights: the tree beside the route counts, the mast far off does not", () => {
  const area = [at(5, -3), at(25, -3), at(25, 3), at(5, 3)];
  const mission = planGrid(area, { altitudeM: 10 });
  const o = obstacleHeights(site(), HOME, mission, area)!;
  assert.ok(Math.abs(o.routeTallestM - 6.3) < 0.6, `route ${o.routeTallestM}`); // tree plus the slope up to it
  assert.ok(o.areaTallestM < 8, `area ${o.areaTallestM}`);
  assert.equal(o.source, "LIDAR");
});

test("obstacle heights: a flight area reaching the mast sees it", () => {
  const area = [at(-5, -3), at(25, -3), at(25, 50), at(-5, 50)];
  const mission = planGrid([at(5, -3), at(25, -3), at(25, 3), at(5, 3)], { altitudeM: 10 });
  const o = obstacleHeights(site(), HOME, mission, area)!;
  assert.ok(o.areaTallestM > 17, `area ${o.areaTallestM}`);
});

test("LIDAR as a survey of the plot: ground levels and the tree on the plan", () => {
  const s = site();
  const plot = { widthM: 7, lengthM: 43, rearGardenM: 29.5, houseDepthM: 8, houseWidthM: 7, ridgeHeightM: 8.5, gardenBearingDeg: 0 } as never;
  // Plan y grows towards the street (south here); the take-off point is at plan (3.5, 20).
  const toGps = ([x, y]: [number, number]) => at(20 - y, x - 3.5);
  const sv = lidarSurvey(s, plot, toGps);
  assert.equal(sv.ground.cellM, 0.5);
  assert.ok(sv.coverage > 0.99);
  const g = (x: number, y: number) => sv.ground.values[Math.floor(y / 0.5) * sv.ground.cols + Math.floor(x / 0.5)];
  // 10 m further north is 0.2 m higher.
  assert.ok(Math.abs(g(3.5, 10) - g(3.5, 20) - 0.2) < 0.05);
  const surf = (x: number, y: number) => sv.surface!.values[Math.floor(y / 0.5) * sv.surface!.cols + Math.floor(x / 0.5)];
  // The tree is 15 m north of the take-off point: plan y = 5.
  assert.ok(surf(3.5, 5) - g(3.5, 5) > 5);
  assert.ok(surf(3.5, 30) - g(3.5, 30) < 0.5);
});

test("take-off offset: the house shows where the drone really is", async () => {
  const { takeoffOffset } = await import("./lidarMath.ts");
  // Plot running north (bottom of the garden) to south (street): plan y grows towards the street.
  // Rear garden 29.5 m, house 8 m deep, 7 m wide. The plan's take-off point is at (3.5, 14.75).
  const plot = { widthM: 7, lengthM: 43, rearGardenM: 29.5, houseDepthM: 8, houseWidthM: 7, ridgeHeightM: 8.5, gardenBearingDeg: 0 } as never;
  const planHome: [number, number] = [3.5, 14.75];
  const c = wgs84ToGrid(HOME.lat, HOME.lng);
  const size = 160;
  const origin = { x: Math.floor(c.e) - size / 2, y: Math.floor(c.n) + size / 2 };
  // The real take-off spot (where HOME is) is on the patio, 9 m nearer the house: plan y 23.75.
  const realHomeY = 23.75;
  // The house (and next door's half) occupy plan y 29.5-37.5, i.e. 5.75-13.75 m south of HOME.
  const make = (f: (e: number, n: number) => number): Raster => {
    const values = new Float64Array(size * size);
    for (let r = 0; r < size; r++) for (let k = 0; k < size; k++) values[r * size + k] = f(origin.x + k + 0.5, origin.y - r - 0.5);
    return { width: size, height: size, values, origin, pixelSize: { x: 1, y: 1 } };
  };
  const south = (n: number) => c.n - n; // metres south of HOME
  const dtm = make(() => 20);
  const dsm = make((e, n) => 20 + (south(n) > 29.5 - realHomeY && south(n) < 37.5 - realHomeY && Math.abs(e - c.e) < 10 ? 8 : 0));
  const site: LidarSite = { fetchedAt: "x", anchor: HOME, home: planHome, dtm, dsm };
  // The plan places points assuming HOME is at planHome.
  const toGps = ([x, y]: [number, number]) => at(planHome[1] - y, x - planHome[0]);
  const off = takeoffOffset(site, plot, toGps, "patio")!;
  assert.ok(Math.abs(off.alongM - (realHomeY - planHome[1])) <= 1, `along ${off.alongM}`);
  // With the take-off point moved to the patio, the house lines up.
  const moved: [number, number] = [3.5, realHomeY];
  const toGps2 = ([x, y]: [number, number]) => at(moved[1] - y, x - moved[0]);
  const ok = takeoffOffset(site, plot, toGps2, "moved")!;
  assert.ok(Math.abs(ok.alongM) <= 1, `after moving ${ok.alongM}`);
  // No house-like block at all: no answer.
  assert.equal(takeoffOffset({ ...site, fetchedAt: "flat", dsm: make(() => 20) }, plot, toGps, "flat"), null);
});

test("a tall spot marked as gone (tree cut down) is ignored by the clearance check and the map", () => {
  const area = [at(5, -3), at(25, -3), at(25, 3), at(5, 3)];
  const mission = planGrid(area, { altitudeM: 10 });
  const s = { ...site(), fetchedAt: "gone-test" };
  const before = obstacleHeights(s, HOME, mission, area)!;
  const after = obstacleHeights(s, HOME, mission, area, [at(15, 0)])!;
  assert.ok(before.routeTallestM > 5);
  assert.ok(after.routeTallestM < 1, `after ${after.routeTallestM}`);
  const plot = { widthM: 7, lengthM: 43, rearGardenM: 29.5, houseDepthM: 8, houseWidthM: 7, ridgeHeightM: 8.5, gardenBearingDeg: 0 } as never;
  const toGps = ([x, y]: [number, number]) => at(20 - y, x - 3.5);
  const sv = lidarSurvey(s, plot, toGps, [[3.5, 5]]);
  const k = Math.floor(5 / 0.5) * sv.ground.cols + Math.floor(3.5 / 0.5);
  assert.ok(sv.surface!.values[k] - sv.ground.values[k] < 0.5);
});
