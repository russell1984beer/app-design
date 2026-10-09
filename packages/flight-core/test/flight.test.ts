// End-to-end flight scenarios: the phone-side FlightSession flying the simulated drone.
// The Android module must pass the same scenarios in DJI's simulator.

import { test } from "node:test";
import assert from "node:assert/strict";

import type { DroneBridge } from "../src/bridge.ts";
import { FlightSession, type FlightSessionOptions } from "../src/flight-session.ts";
import { distanceM, distanceToPolygonM } from "../src/geo.ts";
import type { Mission, ScanProgress } from "../src/mission.ts";
import { planGrid, planSurvey } from "../src/planner.ts";
import { DEFAULT_SAFETY, insideGeofence, type SafetySettings } from "../src/safety.ts";
import { SimDrone, type SimOptions } from "../src/sim-drone.ts";
import { FIELD, FIELD_HOME, ORIGIN, PLOT, PLOT_BEARING, PLOT_HOME, alongAxis, landed, run } from "./helpers.ts";

type Setup = {
  boundary?: typeof PLOT;
  home?: typeof PLOT_HOME;
  mission?: Mission;
  settings?: Partial<SafetySettings>;
  sim?: Partial<SimOptions>;
  progress?: ScanProgress;
  bridge?: (sim: SimDrone) => DroneBridge;
};

/** Long scan of the field (125 photos, about 6 minutes): long enough to run a part-used battery down. */
const LONG_SCAN = planGrid(FIELD, { altitudeM: 20 });

function setup(o: Setup = {}) {
  const boundary = o.boundary ?? PLOT;
  const home = o.home ?? PLOT_HOME;
  const mission = o.mission ?? planGrid(boundary);
  const settings = { ...DEFAULT_SAFETY, ...o.settings };
  const sim = new SimDrone({ home, ...o.sim });
  const saved: ScanProgress[] = [];
  const opts: FlightSessionOptions = {
    mission,
    boundary,
    home,
    settings,
    bridge: o.bridge ? o.bridge(sim) : sim,
    progress: o.progress,
    onProgress: (p) => saved.push(p),
    clock: () => sim.timeS,
  };
  const session = new FlightSession(opts);
  return { sim, session, mission, settings, saved, boundary, home };
}

test("normal scan: takes every photo once, stays over the property and lands at home", () => {
  const { sim, session, mission, settings, saved, boundary, home } = setup();
  let leftFence = false;
  session.start();
  run(sim, session, {
    until: landed(sim, session),
    each: () => {
      if (!insideGeofence(sim.telemetry().position, boundary, settings.geofenceMarginM)) leftFence = true;
    },
  });

  assert.equal(session.returnReason, "complete");
  assert.ok(session.isComplete);
  assert.equal(sim.photos.length, mission.waypoints.length);
  assert.deepEqual(
    sim.photos.map((p) => p.waypointIndex),
    mission.waypoints.map((w) => w.index),
  );
  for (const p of sim.photos) {
    assert.ok(distanceM(p.position, mission.waypoints[p.waypointIndex].position) < 0.5, "photo taken at its waypoint");
  }
  assert.equal(saved.length, mission.waypoints.length, "progress saved after every photo");
  assert.equal(leftFence, false);
  assert.ok(distanceM(sim.telemetry().position, home) < 1, "lands at home");
  assert.ok(sim.battery > settings.landingReservePercent);
});

test("signal loss: the drone returns home and lands by itself, with no help from the app", () => {
  const { sim, session, home } = setup({ boundary: FIELD, home: FIELD_HOME });
  session.start();
  run(sim, session, { until: () => session.state === "scanning" && sim.photos.length >= 5 });
  sim.setSignal(false);

  // The app gets nothing while the link is down; step the drone alone.
  while (sim.mode !== "onGround" && sim.timeS < 3600) sim.step(0.1);
  assert.equal(sim.mode, "onGround");
  assert.ok(distanceM(sim.telemetry().position, home) < 1, "landed at home");
  assert.ok(sim.log.some((l) => l.includes("signal lost: returnHome")));

  // The app reconnects having missed the whole return flight.
  sim.setSignal(true);
  session.update();
  assert.equal(session.state, "landed");
  assert.equal(session.returnReason, "droneInitiated");
});

test("signal loss with the app still running: the app sends no commands and waits", () => {
  const { sim, session, home } = setup({ boundary: FIELD, home: FIELD_HOME });
  session.start();
  run(sim, session, { until: () => sim.photos.length >= 5 });
  sim.setSignal(false);
  run(sim, session, { until: () => sim.mode === "onGround" });
  assert.equal(session.state, "signalLost");
  sim.setSignal(true);
  session.update();
  assert.equal(session.state, "landed");
  assert.ok(distanceM(sim.telemetry().position, home) < 1);
});

test("link back but no fresh flight data: a drone on the ground ends the flight", () => {
  let frozen = false;
  const { sim, session } = setup({
    boundary: FIELD,
    home: FIELD_HOME,
    bridge: (s) =>
      new Proxy(s, {
        get(target, prop, receiver) {
          if (prop === "telemetry") {
            return () => {
              const t = target.telemetry();
              // DJI's simulator after the cable is replugged: links up, drone on the ground, position stale.
              return frozen ? { ...t, signalOk: false, linkUp: true, flightMode: "onGround" as const } : t;
            };
          }
          const v = Reflect.get(target, prop, receiver);
          return typeof v === "function" ? v.bind(target) : v;
        },
      }),
  });
  session.start();
  run(sim, session, { until: () => sim.photos.length >= 3 });
  sim.setSignal(false);
  session.update();
  assert.equal(session.state, "signalLost");
  frozen = true;
  session.update();
  assert.equal(session.state, "landed");
  assert.equal(session.returnReason, "signalLoss");
});

test("signal loss set to hover: when the link comes back the app brings the drone home", () => {
  const { sim, session, home } = setup({ boundary: FIELD, home: FIELD_HOME, settings: { signalLossAction: "hover" } });
  session.start();
  run(sim, session, { until: () => sim.photos.length >= 5 });
  const lostAt = sim.telemetry().position;
  sim.setSignal(false);
  const t0 = sim.timeS;
  run(sim, session, { until: () => sim.timeS >= t0 + 20 }); // 20 seconds without a link
  assert.ok(distanceM(sim.telemetry().position, lostAt) < 1, "hovered in place");
  sim.setSignal(true);
  run(sim, session, { until: landed(sim, session) });
  assert.equal(session.returnReason, "signalLoss");
  assert.ok(distanceM(sim.telemetry().position, home) < 1);
});

test("gust over the limit mid-scan: pauses the scan and returns home", () => {
  const { sim, session, mission, home } = setup({ boundary: FIELD, home: FIELD_HOME });
  session.start();
  run(sim, session, {
    until: landed(sim, session),
    each: () => {
      if (sim.photos.length === 10) sim.setWind({ speedMs: 9, fromDeg: 270 });
    },
  });
  assert.equal(session.returnReason, "wind");
  assert.ok(sim.photos.length < mission.waypoints.length, "scan stopped early");
  assert.ok(distanceM(sim.telemetry().position, home) < 1);
});

test("drone's own strong-wind warning also brings it home, even under the user's limit", () => {
  const { sim, session } = setup({ boundary: FIELD, home: FIELD_HOME, settings: { maxGustMs: 10.5 } });
  session.start();
  run(sim, session, {
    until: landed(sim, session),
    each: () => {
      if (sim.photos.length === 10) sim.setWind({ speedMs: 10.8, fromDeg: 90 });
    },
  });
  assert.equal(session.returnReason, "wind");
});

test("low battery: returns in time and lands with the reserve", () => {
  const { sim, session, mission, settings } = setup({ boundary: FIELD, home: FIELD_HOME, mission: LONG_SCAN, sim: { batteryPercent: 30 } });
  session.start();
  run(sim, session, { until: landed(sim, session) });
  assert.equal(session.returnReason, "lowBattery");
  assert.ok(sim.photos.length > 0 && sim.photos.length < mission.waypoints.length);
  assert.ok(sim.battery >= settings.landingReservePercent, `landed with ${sim.battery.toFixed(1)}%`);
});

test("low battery with a headwind on the way home: returns earlier and still lands with the reserve", () => {
  const calm = setup({ boundary: FIELD, home: FIELD_HOME, mission: LONG_SCAN, sim: { batteryPercent: 30 } });
  calm.session.start();
  run(calm.sim, calm.session, { until: landed(calm.sim, calm.session) });

  // Home is at the south end, so a southerly wind blows straight into the drone's face on the way back.
  const windy = setup({
    boundary: FIELD,
    home: FIELD_HOME,
    mission: LONG_SCAN,
    sim: { batteryPercent: 30, wind: { speedMs: 6, fromDeg: 180 } },
  });
  windy.session.start();
  run(windy.sim, windy.session, { until: landed(windy.sim, windy.session) });

  assert.equal(windy.session.returnReason, "lowBattery");
  assert.ok(windy.sim.photos.length < calm.sim.photos.length, "headwind makes it turn back sooner");
  assert.ok(windy.sim.battery >= windy.settings.landingReservePercent, `landed with ${windy.sim.battery.toFixed(1)}%`);
});

test("old battery that drains fast: measured drain makes it come home sooner", () => {
  const { sim, session, settings } = setup({
    boundary: FIELD,
    home: FIELD_HOME,
    sim: { batteryPercent: 45, drainPercentPerMin: 9 },
  });
  session.start();
  run(sim, session, { until: landed(sim, session) });
  assert.equal(session.returnReason, "lowBattery");
  assert.ok(sim.battery >= settings.landingReservePercent, `landed with ${sim.battery.toFixed(1)}%`);
});

test("resume: after a battery swap the scan carries on and keeps the photos already taken", () => {
  const first = setup({ boundary: FIELD, home: FIELD_HOME, mission: LONG_SCAN, sim: { batteryPercent: 30 } });
  first.session.start();
  run(first.sim, first.session, { until: landed(first.sim, first.session) });
  assert.equal(first.session.returnReason, "lowBattery");
  const progress = first.saved[first.saved.length - 1];
  const before = first.sim.photos.map((p) => p.waypointIndex);

  // Same mission, fresh battery, progress loaded from storage.
  const second = setup({ boundary: FIELD, home: FIELD_HOME, mission: first.mission, progress });
  second.session.start();
  run(second.sim, second.session, { until: landed(second.sim, second.session) });
  assert.equal(second.session.returnReason, "complete");

  const after = second.sim.photos.map((p) => p.waypointIndex);
  assert.deepEqual([...before, ...after].sort((a, b) => a - b), first.mission.waypoints.map((w) => w.index));
  assert.equal(new Set(after).size, after.length);
  assert.ok(after.every((i) => !before.includes(i)), "no photo taken twice");
});

test("resume refuses progress from a different mission", () => {
  const other = planGrid(FIELD);
  assert.throws(() => setup({ progress: { missionId: other.id, completedWaypoints: [0] } }));
});

test("pilot presses Return in the app: drone comes home", () => {
  const { sim, session, home } = setup({ boundary: FIELD, home: FIELD_HOME });
  session.start();
  run(sim, session, { until: () => sim.photos.length >= 8 });
  session.pilotReturnHome();
  run(sim, session, { until: landed(sim, session) });
  assert.equal(session.returnReason, "pilotButton");
  assert.ok(distanceM(sim.telemetry().position, home) < 1);
});

test("pilot presses Return to Home on the controller: the app follows and stops the scan", () => {
  const { sim, session, home } = setup({ boundary: FIELD, home: FIELD_HOME });
  session.start();
  run(sim, session, { until: () => sim.photos.length >= 8 });
  sim.pilotPressesReturnHome();
  run(sim, session, { until: landed(sim, session) });
  assert.equal(session.returnReason, "droneInitiated");
  assert.ok(distanceM(sim.telemetry().position, home) < 1);
});

test("pilot takes the sticks: the app stops sending flight commands", () => {
  let commandsAfterTakeover = 0;
  let takenOver = false;
  const { sim, session, home } = setup({
    boundary: FIELD,
    home: FIELD_HOME,
    bridge: (s) =>
      new Proxy(s, {
        get(target, prop, receiver) {
          const v = Reflect.get(target, prop, receiver);
          const commands = ["goTo", "takePhoto", "hover", "returnHome", "land", "takeOff", "setGimbalPitch"];
          if (typeof v === "function" && commands.includes(String(prop))) {
            return (...args: unknown[]) => {
              if (takenOver) commandsAfterTakeover++;
              return v.apply(target, args);
            };
          }
          return typeof v === "function" ? v.bind(target) : v;
        },
      }),
  });
  session.start();
  run(sim, session, { until: () => sim.photos.length >= 6 });
  const photos = session.progress.completedWaypoints.length;
  sim.pilotTakesControl();
  takenOver = true;
  run(sim, session, { until: () => session.state === "pilotControl" });

  sim.pilotFlyTo(home, 10);
  run(sim, session, { until: () => distanceM(sim.telemetry().position, home) < 0.5 && Math.abs(sim.altitudeM - 10) < 0.1 });
  sim.pilotLands();
  run(sim, session, { until: landed(sim, session) });

  assert.equal(commandsAfterTakeover, 0);
  assert.equal(session.progress.completedWaypoints.length, photos, "photos already taken are kept");
});

test("geofence: a waypoint outside the property is never reached", () => {
  const mission = planGrid(PLOT);
  const far = { ...mission.waypoints[3], position: { lat: mission.waypoints[3].position.lat + 0.001, lng: mission.waypoints[3].position.lng } };
  const bad: Mission = { ...mission, waypoints: mission.waypoints.map((w, i) => (i === 3 ? far : w)) };
  const { sim, session, home } = setup({ mission: bad });
  session.start();
  run(sim, session, { until: landed(sim, session) });
  assert.equal(session.returnReason, "geofence");
  assert.ok(sim.maxDistanceFromHomeM < 60, `went ${sim.maxDistanceFromHomeM.toFixed(1)} m from home`);
  assert.ok(distanceM(sim.telemetry().position, home) < 1);
});

test("camera fault: after repeated failed photos the drone comes home", () => {
  const { sim, session } = setup();
  sim.failPhotos = true;
  session.start();
  run(sim, session, { until: landed(sim, session) });
  assert.equal(session.returnReason, "cameraFault");
  assert.equal(session.progress.completedWaypoints.length, 0);
});

test("refuses to take off before the failsafe is configured on the drone", () => {
  const sim = new SimDrone({ home: PLOT_HOME });
  assert.throws(() => sim.takeOff());
});

for (const edgeLap of [false, true]) test(`garden survey${edgeLap ? " with the edge lap" : ""}: never crosses the property boundary and lands back where it took off`, () => {
  const home = alongAxis(ORIGIN, PLOT_BEARING, 28.25); // middle of the rear garden
  const mission = planSurvey(PLOT, { edgeLap });
  const sim = new SimDrone({ home });
  const session = new FlightSession({ mission, boundary: PLOT, home, settings: DEFAULT_SAFETY, bridge: sim, clock: () => sim.timeS });
  let furthestOut = 0;
  session.start();
  run(sim, session, {
    until: landed(sim, session),
    each: () => {
      furthestOut = Math.max(furthestOut, distanceToPolygonM(sim.telemetry().position, PLOT));
    },
  });
  assert.equal(session.returnReason, "complete");
  assert.equal(sim.photos.length, mission.waypoints.length);
  assert.ok(furthestOut < 0.3, `went ${furthestOut.toFixed(2)} m outside the boundary`);
  assert.ok(distanceM(sim.telemetry().position, home) < 1, "lands at the take-off point");
});

/** Fly until a few photos are taken, then press the emergency stop. */
function stopMidScan(o: Setup = {}) {
  const s = setup(o);
  s.session.start();
  run(s.sim, s.session, { until: () => s.sim.photos.length >= 4 && s.session.state === "scanning" });
  s.session.pilotHold();
  assert.equal(s.session.state, "holding");
  return s;
}

test("emergency stop: the drone stops and hovers in place, taking no more photos, until told what to do", () => {
  const { sim, session } = stopMidScan();
  // Let it brake to a stop first.
  for (let i = 0; i < 30; i++) {
    sim.step(0.1);
    session.update();
  }
  const stoppedAt = sim.telemetry().position;
  const photos = sim.photos.length;
  const until = sim.timeS + 30;
  let moved = 0;
  while (sim.timeS < until) {
    sim.step(0.1);
    session.update();
    moved = Math.max(moved, distanceM(sim.telemetry().position, stoppedAt));
  }
  assert.equal(session.state, "holding");
  assert.ok(moved < 0.5, `drifted ${moved.toFixed(2)} m while holding`);
  assert.equal(sim.photos.length, photos, "no photos while holding");
});

test("emergency stop, then Resume: the scan carries on and finishes as normal", () => {
  const { sim, session, mission, home } = stopMidScan();
  for (let i = 0; i < 100; i++) {
    sim.step(0.1);
    session.update();
  }
  session.pilotResume();
  run(sim, session, { until: landed(sim, session) });
  assert.equal(session.returnReason, "complete");
  assert.equal(new Set(sim.photos.map((p) => p.waypointIndex)).size, mission.waypoints.length);
  assert.ok(distanceM(sim.telemetry().position, home) < 1);
});

test("emergency stop, then Return home or Land here", () => {
  const a = stopMidScan();
  a.session.pilotReturnHome();
  run(a.sim, a.session, { until: landed(a.sim, a.session) });
  assert.equal(a.session.returnReason, "pilotButton");
  assert.ok(distanceM(a.sim.telemetry().position, a.home) < 1);

  const b = stopMidScan();
  const here = b.sim.telemetry().position;
  b.session.pilotLand();
  run(b.sim, b.session, { until: landed(b.sim, b.session) });
  assert.equal(b.session.returnReason, "pilotLanded");
  assert.ok(distanceM(b.sim.telemetry().position, here) < 1, "landed where it stopped");
});

test("emergency stop: safety rules still work while it hovers", () => {
  const { sim, session, settings } = stopMidScan({ boundary: FIELD, home: FIELD_HOME, mission: LONG_SCAN, sim: { batteryPercent: 35 } });
  run(sim, session, { until: landed(sim, session) });
  assert.equal(session.returnReason, "lowBattery", "came home on its own when the battery ran low");
  assert.ok(sim.battery >= settings.landingReservePercent);

  const w = stopMidScan();
  w.sim.setWind({ speedMs: 9, fromDeg: 270 });
  run(w.sim, w.session, { until: landed(w.sim, w.session) });
  assert.equal(w.session.returnReason, "wind");
});

test("emergency stop: the pilot can still take the sticks", () => {
  const { sim, session } = stopMidScan();
  sim.pilotTakesControl();
  sim.step(0.1);
  session.update();
  assert.equal(session.state, "pilotControl");
});
