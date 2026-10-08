import { test } from "node:test";
import assert from "node:assert/strict";

import { FlightSession } from "../src/flight-session.ts";
import { bearingDeg, distanceM, distanceToPolygonM } from "../src/geo.ts";
import { planRoofScan, type RoofScanInput } from "../src/roof.ts";
import { DEFAULT_SAFETY, insideGeofence, preflightCheck } from "../src/safety.ts";
import { SimDrone } from "../src/sim-drone.ts";
import { PLOT, PLOT_HOME, RIDGE_HEIGHT_M, ROOF, ROOF_OPEN_SIDE, acrossM, landed, run } from "./helpers.ts";

const INPUT: RoofScanInput = { roof: ROOF, ridgeHeightM: RIDGE_HEIGHT_M, home: PLOT_HOME, openSideBearingDeg: ROOF_OPEN_SIDE };

test("roof plan: two full circles, 6 m then 3 m above the ridge, 24 photos each", () => {
  const scan = planRoofScan(INPUT);
  assert.equal(scan.mission.waypoints.length, 48);
  assert.deepEqual(scan.orbits.map((o) => o.altitudeM), [RIDGE_HEIGHT_M + 6, RIDGE_HEIGHT_M + 3]);
  scan.mission.waypoints.forEach((w, i) => {
    assert.equal(w.index, i);
    assert.equal(w.altitudeM, i < 24 ? RIDGE_HEIGHT_M + 6 : RIDGE_HEIGHT_M + 3);
    assert.ok(distanceToPolygonM(w.position, ROOF) >= 2 - 0.01, "at least 2 m from the roof");
    assert.ok(Math.abs(distanceM(w.position, scan.center) - scan.radiusM) < 0.01);
  });
  // The circles go all the way round, so they pass over next door's half too.
  assert.ok(scan.mission.waypoints.some((w) => acrossM(w.position) < -3.5));
  // A few minutes of circling, plus take-off and landing.
  assert.ok(scan.mission.estimate.durationS > 100 && scan.mission.estimate.durationS < 330, `${scan.mission.estimate.durationS}`);
});

test("roof plan: camera faces the roof, tilted down more on the higher circle", () => {
  const scan = planRoofScan(INPUT);
  const [high, low] = scan.orbits;
  assert.ok(high.gimbalPitchDeg < low.gimbalPitchDeg, "steeper from higher up");
  for (const o of scan.orbits) assert.ok(o.gimbalPitchDeg < -10 && o.gimbalPitchDeg > -70, `tilt ${o.gimbalPitchDeg}`);
  for (const w of scan.mission.waypoints) {
    const toCentre = bearingDeg(w.position, scan.center);
    const diff = Math.abs(((w.headingDeg! - toCentre + 540) % 360) - 180);
    assert.ok(diff < 0.5);
  }
});

test("roof plan: the flight area covers the circles, the house and the home point", () => {
  const scan = planRoofScan(INPUT);
  for (const p of [...scan.mission.waypoints.map((w) => w.position), ...ROOF, PLOT_HOME]) {
    assert.ok(distanceToPolygonM(p, scan.flightArea) < 0.01);
  }
});

test("roof plan: refuses to fly too close to the roof, too low, or near the chimney", () => {
  assert.throws(() => planRoofScan({ ...INPUT, distanceFromRoofM: 1 }), /at least 2 m from the roof/);
  assert.throws(() => planRoofScan({ ...INPUT, heightsAboveRidgeM: [6, 1] }), /above the ridge/);
  assert.throws(() => planRoofScan({ ...INPUT, chimneyTopM: RIDGE_HEIGHT_M + 2 }), /above the chimney/);
  assert.throws(() => planRoofScan({ ...INPUT, heightsAboveRidgeM: [] }));
});

test("roof pre-flight: allowed, with a warning about flying over the street and next door", () => {
  const scan = planRoofScan(INPUT);
  const r = preflightCheck({
    settings: DEFAULT_SAFETY,
    boundary: scan.flightArea,
    property: PLOT,
    home: PLOT_HOME,
    mission: scan.mission,
    forecast: { speedMs: 3, gustMs: 5, fromDeg: 225, source: "test" },
    noFlyZones: [],
    batteryPercent: 90,
  });
  assert.ok(r.canTakeOff, JSON.stringify(r.items.filter((i) => i.status === "block")));
  assert.equal(r.items.find((i) => i.id === "overflight")?.status, "warn");
});

function fly(scan = planRoofScan(INPUT)) {
  const sim = new SimDrone({ home: PLOT_HOME });
  const session = new FlightSession({
    mission: scan.mission,
    boundary: scan.flightArea,
    home: PLOT_HOME,
    settings: DEFAULT_SAFETY,
    bridge: sim,
    clock: () => sim.timeS,
  });
  return { sim, session, scan };
}

test("roof flight: takes every photo, never comes close to the roof below ridge height, lands home", () => {
  const { sim, session, scan } = fly();
  let unsafe = false;
  let leftArea = false;
  session.start();
  run(sim, session, {
    until: landed(sim, session),
    each: () => {
      const t = sim.telemetry();
      if (distanceToPolygonM(t.position, ROOF) < 2 - 0.3 && t.altitudeM < RIDGE_HEIGHT_M + 3 - 0.3) unsafe = true;
      if (!insideGeofence(t.position, scan.flightArea, DEFAULT_SAFETY.geofenceMarginM)) leftArea = true;
    },
  });
  assert.equal(session.returnReason, "complete");
  assert.equal(sim.photos.length, scan.mission.waypoints.length);
  assert.equal(unsafe, false, "flew close to the roof below a safe height");
  assert.equal(leftArea, false);
  assert.ok(distanceM(sim.telemetry().position, PLOT_HOME) < 1);
});

test("roof flight: a gust brings it home part-way round", () => {
  const { sim, session, scan } = fly();
  session.start();
  run(sim, session, {
    until: landed(sim, session),
    each: () => {
      if (sim.photos.length === 5) sim.setWind({ speedMs: 9, fromDeg: 270 });
    },
  });
  assert.equal(session.returnReason, "wind");
  assert.ok(sim.photos.length < scan.mission.waypoints.length);
});
