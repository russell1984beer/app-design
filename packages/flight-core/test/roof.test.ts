import { test } from "node:test";
import assert from "node:assert/strict";

import { FlightSession } from "../src/flight-session.ts";
import { bearingDeg, distanceM, distanceToPolygonM } from "../src/geo.ts";
import { planRoofScan, type RoofScanInput } from "../src/roof.ts";
import { DEFAULT_SAFETY, insideGeofence, preflightCheck } from "../src/safety.ts";
import { SimDrone } from "../src/sim-drone.ts";
import { PLOT, PLOT_HOME, RIDGE_HEIGHT_M, ROOF, ROOF_OPEN_SIDE, acrossM, landed, run } from "./helpers.ts";

const INPUT: RoofScanInput = { roof: ROOF, ridgeHeightM: RIDGE_HEIGHT_M, home: PLOT_HOME, openSideBearingDeg: ROOF_OPEN_SIDE };

test("roof plan: keeps its distance from the roof and flies above the ridge", () => {
  const scan = planRoofScan(INPUT);
  assert.equal(scan.mission.waypoints.length, 15);
  assert.equal(scan.altitudeM, RIDGE_HEIGHT_M + 5);
  for (const w of scan.mission.waypoints) {
    assert.ok(distanceToPolygonM(w.position, ROOF) >= 6 - 0.01, "at least 6 m from the roof");
    assert.equal(w.altitudeM, scan.altitudeM);
  }
});

test("roof plan: stays on the open side, never over the neighbour's half", () => {
  const scan = planRoofScan(INPUT);
  for (const w of scan.mission.waypoints) assert.ok(acrossM(w.position) > -0.01, `waypoint ${w.index} crosses to the neighbour's side`);
});

test("roof plan: camera faces the roof, tilted down", () => {
  const scan = planRoofScan(INPUT);
  assert.ok(scan.gimbalPitchDeg < -10 && scan.gimbalPitchDeg > -60, `tilt ${scan.gimbalPitchDeg}`);
  for (const w of scan.mission.waypoints) {
    const toCentre = bearingDeg(w.position, scan.center);
    const diff = Math.abs(((w.headingDeg! - toCentre + 540) % 360) - 180);
    assert.ok(diff < 0.5);
    assert.equal(w.gimbalPitchDeg, scan.gimbalPitchDeg);
  }
});

test("roof plan: the flight area covers the arc, the house and the home point", () => {
  const scan = planRoofScan(INPUT);
  for (const p of [...scan.mission.waypoints.map((w) => w.position), ...ROOF, PLOT_HOME]) {
    assert.ok(distanceToPolygonM(p, scan.flightArea) < 0.01);
  }
});

test("roof plan: refuses to fly too close to the roof or too low", () => {
  assert.throws(() => planRoofScan({ ...INPUT, distanceFromRoofM: 2 }));
  assert.throws(() => planRoofScan({ ...INPUT, heightAboveRidgeM: 1 }));
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
      if (distanceToPolygonM(t.position, ROOF) < 4 && t.altitudeM < RIDGE_HEIGHT_M + 3) unsafe = true;
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
