import { test } from "node:test";
import assert from "node:assert/strict";

import { MINI_4_PRO, footprintM, gsdCm } from "../src/camera.ts";
import { areaM2, distanceM, distanceToPolygonM } from "../src/geo.ts";
import { DEFAULT_GRID, planGrid, planOrbit, planSurvey } from "../src/planner.ts";
import {
  DEFAULT_SAFETY,
  batteryNeededToReturn,
  headwindMs,
  preflightCheck,
  type PreflightInput,
} from "../src/safety.ts";
import { FIELD, FIELD_HOME, ORIGIN, PLOT, PLOT_HOME, alongAxis } from "./helpers.ts";

test("test plot is 7 m x 43 m", () => {
  assert.ok(Math.abs(areaM2(PLOT) - 301) < 1);
});

test("camera: footprint and detail at 30 m", () => {
  const fp = footprintM(MINI_4_PRO, 30);
  assert.ok(Math.abs(fp.width - 42.9) < 0.1);
  assert.ok(Math.abs(fp.height - 32.1) < 0.1);
  assert.ok(Math.abs(gsdCm(MINI_4_PRO, 30) - 1.06) < 0.01);
});

test("grid over the plot: every photo point is inside the boundary, spaced for the overlap", () => {
  const m = planGrid(PLOT);
  assert.ok(m.waypoints.length >= 2);
  for (const w of m.waypoints) {
    assert.ok(distanceToPolygonM(w.position, PLOT) < 0.01, "inside the plot");
    assert.equal(w.altitudeM, 20);
    assert.equal(w.gimbalPitchDeg, -90);
  }
  const spacing = footprintM(MINI_4_PRO, 20).height * (1 - 0.75);
  for (let i = 1; i < m.waypoints.length; i++) {
    assert.ok(distanceM(m.waypoints[i - 1].position, m.waypoints[i].position) <= spacing + 0.01);
  }
  assert.equal(m.estimate.photoCount, m.waypoints.length);
});

test("grid over a wide field: several lines, flown back and forth", () => {
  const m = planGrid(FIELD, { altitudeM: 20, direction: "along", lineSpacingM: undefined, sideOverlap: 0.7 });
  const lineSpacing = footprintM(MINI_4_PRO, 20).width * (1 - 0.7);
  const lines = Math.ceil(40 / lineSpacing);
  const headings = new Set(m.waypoints.map((w) => w.headingDeg));
  assert.equal(headings.size, 2, "lines alternate direction");
  let turns = 0;
  for (let i = 1; i < m.waypoints.length; i++) if (m.waypoints[i].headingDeg !== m.waypoints[i - 1].headingDeg) turns++;
  assert.equal(turns, lines - 1);
  for (const w of m.waypoints) assert.ok(distanceToPolygonM(w.position, FIELD) < 0.01);
});

test("default: passes run across the garden, 3 m (about 10 ft) apart", () => {
  const m = planGrid(PLOT);
  // The plot is 43 m long, so passes 3 m apart: 15 of them, each spanning the 7 m width.
  assert.equal(m.estimate.passCount, 15);
  assert.equal(m.estimate.lineSpacingM, 3);
  const headings = new Set(m.waypoints.map((w) => Math.round(w.headingDeg!)));
  assert.deepEqual([...headings].sort((a, b) => a - b), [45, 225], "at right angles to the 135° plot");
  const firstPass = m.waypoints.filter((w) => w.headingDeg === m.waypoints[0].headingDeg).slice(0, 2);
  assert.ok(Math.abs(distanceM(firstPass[0].position, firstPass[1].position)) <= 7.01, "a pass spans the width");
  for (const w of m.waypoints) assert.ok(distanceToPolygonM(w.position, PLOT) < 0.01);
});

test("pass spacing is adjustable", () => {
  const close = planGrid(PLOT, { lineSpacingM: 1.5 });
  const wide = planGrid(PLOT, { lineSpacingM: 6 });
  assert.equal(close.estimate.passCount, 29);
  assert.equal(wide.estimate.passCount, 8);
  assert.ok(close.estimate.photoCount > wide.estimate.photoCount);
  assert.ok(close.estimate.durationS > wide.estimate.durationS);
  assert.throws(() => planGrid(PLOT, { lineSpacingM: 0.5 }), /at least 1 m/);
});

test("passes can run along the garden instead", () => {
  const m = planGrid(PLOT, { direction: "along" });
  // 7 m wide with passes 3 m apart: 3 passes down the length.
  assert.equal(m.estimate.passCount, 3);
  assert.deepEqual([...new Set(m.waypoints.map((w) => Math.round(w.headingDeg!)))].sort((a, b) => a - b), [135, 315]);
});

test("default flying height is 20 m with 75% overlap, as in the prototype", () => {
  assert.equal(DEFAULT_GRID.altitudeM, 20);
  assert.equal(DEFAULT_GRID.frontOverlap, 0.75);
});

test("survey: the grid, then a lap round the edge looking in, all inside the plot", () => {
  const grid = planGrid(PLOT);
  const m = planSurvey(PLOT);
  assert.equal(m.waypoints.length, grid.waypoints.length + 24);
  assert.deepEqual(m.waypoints.slice(0, grid.waypoints.length), grid.waypoints);
  assert.equal(m.estimate.passCount, 15);
  const lap = m.waypoints.slice(grid.waypoints.length);
  for (const w of lap) {
    assert.ok(distanceToPolygonM(w.position, PLOT) < 0.01, "inside the plot");
    assert.equal(w.gimbalPitchDeg, -60);
    assert.equal(w.altitudeM, 20);
  }
  // Evenly spread: 43 + 7 + 43 + 7 = 100 m of edge, so about 4.2 m between photos.
  for (let i = 1; i < lap.length; i++) assert.ok(distanceM(lap[i - 1].position, lap[i].position) < 4.3);
  // Starts near where the grid ends.
  assert.ok(distanceM(grid.waypoints[grid.waypoints.length - 1].position, lap[0].position) < 8);
  m.waypoints.forEach((w, i) => assert.equal(w.index, i));
});

test("same plan always gets the same id, different plans different ids", () => {
  assert.equal(planGrid(PLOT).id, planGrid(PLOT).id);
  assert.notEqual(planGrid(PLOT).id, planGrid(PLOT, { altitudeM: 25 }).id);
});

test("orbit: circle at the right radius, camera facing the centre", () => {
  const center = alongAxis(ORIGIN, 135, 9.5); // middle of the house
  const m = planOrbit({ center, radiusM: 12, photoCount: 12 });
  assert.equal(m.waypoints.length, 12);
  for (const w of m.waypoints) {
    assert.ok(Math.abs(distanceM(center, w.position) - 12) < 0.01);
    const facing = w.headingDeg!;
    const towardCentre = (Math.atan2(
      (center.lng - w.position.lng) * Math.cos((center.lat * Math.PI) / 180),
      center.lat - w.position.lat,
    ) * 180) / Math.PI;
    const diff = Math.abs((((facing - towardCentre) % 360) + 540) % 360 - 180);
    assert.ok(diff < 0.5, "faces the centre");
  }
});

test("orbit arc: half a circle for one side of a semi-detached roof", () => {
  const m = planOrbit({ center: ORIGIN, radiusM: 10, photoCount: 7, arcDeg: 180, startBearingDeg: 90 });
  const first = m.waypoints[0].position;
  const last = m.waypoints[6].position;
  assert.ok(Math.abs(distanceM(first, last) - 20) < 0.01, "ends opposite the start");
});

test("headwind: wind from the direction of travel counts fully, tailwind is negative", () => {
  assert.equal(headwindMs({ speedMs: 5, fromDeg: 180 }, 180), 5);
  assert.ok(Math.abs(headwindMs({ speedMs: 5, fromDeg: 0 }, 180) + 5) < 1e-9);
  assert.ok(Math.abs(headwindMs({ speedMs: 5, fromDeg: 90 }, 180)) < 1e-9);
});

test("battery needed to return grows with distance and headwind", () => {
  const far = alongAxis(ORIGIN, 0, 95);
  const base = { position: far, altitudeM: 30, home: FIELD_HOME, settings: DEFAULT_SAFETY };
  const calm = batteryNeededToReturn({ ...base, wind: { speedMs: 0, fromDeg: 0 } });
  const tail = batteryNeededToReturn({ ...base, wind: { speedMs: 6, fromDeg: 0 } });
  const head = batteryNeededToReturn({ ...base, wind: { speedMs: 6, fromDeg: 180 } });
  const near = batteryNeededToReturn({ ...base, position: FIELD_HOME, wind: { speedMs: 0, fromDeg: 0 } });
  assert.ok(calm > DEFAULT_SAFETY.landingReservePercent);
  assert.ok(near < calm);
  assert.ok(head > tail);
});

function goodPreflight(): PreflightInput {
  return {
    settings: DEFAULT_SAFETY,
    boundary: PLOT,
    home: PLOT_HOME,
    mission: planGrid(PLOT),
    forecast: { speedMs: 3, gustMs: 5, fromDeg: 225, source: "test" },
    noFlyZones: [],
    batteryPercent: 95,
  };
}

const blocked = (input: PreflightInput, id: string) => {
  const r = preflightCheck(input);
  return !r.canTakeOff && r.items.some((i) => i.id === id && i.status === "block");
};

test("preflight: a good setup can take off", () => {
  const r = preflightCheck(goodPreflight());
  assert.ok(r.canTakeOff, JSON.stringify(r.items.filter((i) => i.status !== "pass")));
});

test("preflight: blocks without a home point, or with home outside the property", () => {
  assert.ok(blocked({ ...goodPreflight(), home: undefined }, "home"));
  assert.ok(blocked({ ...goodPreflight(), home: alongAxis(ORIGIN, 135, 80) }, "home"));
});

test("preflight: blocks when gusts exceed the limit or there is no forecast", () => {
  assert.ok(blocked({ ...goodPreflight(), forecast: { speedMs: 5, gustMs: 9, fromDeg: 0, source: "test" } }, "wind"));
  assert.ok(blocked({ ...goodPreflight(), forecast: undefined }, "wind"));
  const close = preflightCheck({ ...goodPreflight(), forecast: { speedMs: 4, gustMs: 7, fromDeg: 0, source: "test" } });
  assert.ok(close.canTakeOff);
  assert.equal(close.items.find((i) => i.id === "wind")?.status, "warn");
});

test("preflight: wind limit can never be set above what the drone can handle", () => {
  assert.ok(blocked({ ...goodPreflight(), settings: { ...DEFAULT_SAFETY, maxGustMs: 12 } }, "windLimit"));
});

test("preflight: return height must clear the roof and trees", () => {
  assert.ok(blocked({ ...goodPreflight(), settings: { ...DEFAULT_SAFETY, returnHeightM: 15 } }, "returnHeight"));
  assert.ok(blocked({ ...goodPreflight(), settings: { ...DEFAULT_SAFETY, returnHeightM: 130 } }, "returnHeight"));
});

test("preflight: blocks a mission that leaves the property", () => {
  assert.ok(blocked({ ...goodPreflight(), mission: planGrid(FIELD) }, "geofence"));
});

test("preflight: no-fly zones", () => {
  const zone = (kind: "restricted" | "authorisation" | "warning", distance: number, radiusM: number) => ({
    name: `Zone ${kind}`,
    kind,
    circle: { center: alongAxis(ORIGIN, 45, distance), radiusM },
  });
  assert.ok(blocked({ ...goodPreflight(), noFlyZones: [zone("restricted", 500, 600)] }, "noFlyZones"));
  assert.ok(blocked({ ...goodPreflight(), noFlyZones: [zone("authorisation", 500, 600)] }, "noFlyZones"));
  assert.ok(preflightCheck({ ...goodPreflight(), noFlyZones: [zone("warning", 500, 600)] }).canTakeOff);
  assert.ok(preflightCheck({ ...goodPreflight(), noFlyZones: [zone("restricted", 2000, 600)] }).canTakeOff);

  const square = [
    alongAxis(ORIGIN, 0, -10, -10),
    alongAxis(ORIGIN, 0, -10, 10),
    alongAxis(ORIGIN, 0, 10, 10),
    alongAxis(ORIGIN, 0, 10, -10),
  ];
  assert.ok(blocked({ ...goodPreflight(), noFlyZones: [{ name: "Square", kind: "restricted", polygon: square }] }, "noFlyZones"));
});

test("preflight: warns when passes are too far apart for the photos to overlap", () => {
  const ok = preflightCheck(goodPreflight());
  assert.equal(ok.items.find((i) => i.id === "passSpacing")?.status, "pass");
  // At 15 m a photo covers about 21 m across; 60% overlap needs passes 8.5 m apart or closer.
  const wide = preflightCheck({ ...goodPreflight(), mission: planGrid(PLOT, { altitudeM: 15, lineSpacingM: 10 }) });
  const item = wide.items.find((i) => i.id === "passSpacing");
  assert.equal(item?.status, "warn");
  assert.match(item!.message, /8\.5 m or less/);
  assert.ok(wide.canTakeOff, "a warning, not a stop");
});

test("preflight: battery too low to start is blocked; not enough for the whole scan is a warning", () => {
  assert.ok(blocked({ ...goodPreflight(), batteryPercent: 25 }, "battery"));
  const big = preflightCheck({
    ...goodPreflight(),
    boundary: FIELD,
    home: FIELD_HOME,
    mission: planGrid(FIELD, { altitudeM: 20 }),
    batteryPercent: 40,
  });
  assert.ok(big.canTakeOff);
  assert.equal(big.items.find((i) => i.id === "battery")?.status, "warn");
});
