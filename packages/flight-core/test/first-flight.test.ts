// The first real flight: hover at 10 m over the take-off point, scan the bottom of the garden up to
// the take-off point, land straight down where it took off.

import { test } from "node:test";
import assert from "node:assert/strict";

import { FlightSession } from "../src/flight-session.ts";
import { distanceM, type LatLng } from "../src/geo.ts";
import { FIRST_FLIGHT, planFirstFlight } from "../src/planner.ts";
import { DEFAULT_SAFETY, insideGeofence } from "../src/safety.ts";
import { SimDrone } from "../src/sim-drone.ts";
import { ORIGIN, PLOT, PLOT_BEARING, PLOT_HOME, alongAxis, landed, rectangle, run } from "./helpers.ts";

/** From the take-off point (20 m from the street) to the bottom of the 43 m plot, full width. */
const BOTTOM: LatLng[] = rectangle(alongAxis(ORIGIN, PLOT_BEARING, 20), PLOT_BEARING, 7, 23);

function setup(settings = DEFAULT_SAFETY) {
  const sim = new SimDrone({ home: PLOT_HOME });
  const mission = planFirstFlight(PLOT_HOME, BOTTOM);
  const session = new FlightSession({ mission, boundary: PLOT, home: PLOT_HOME, settings, bridge: sim, clock: () => sim.timeS });
  return { sim, session, mission };
}

test("first flight plan: 10 m hover over the take-off point, the bottom of the garden, back, land", () => {
  const m = planFirstFlight(PLOT_HOME, BOTTOM);
  assert.equal(m.kind, "check");
  assert.equal(m.endWith, "land");
  assert.ok(m.waypoints.every((w) => w.altitudeM === FIRST_FLIGHT.altitudeM));
  assert.equal(m.waypoints[0].holdS, FIRST_FLIGHT.holdS);
  assert.ok(distanceM(m.waypoints[0].position, PLOT_HOME) < 0.01);
  assert.ok(distanceM(m.waypoints.at(-1)!.position, PLOT_HOME) < 0.01);
  const photos = m.waypoints.filter((w) => w.photo);
  assert.ok(photos.length > 20, `${photos.length} photos`);
  // Only the bottom of the garden, inside the plot.
  assert.ok(photos.every((w) => insideGeofence(w.position, BOTTOM, 0.1)));
  assert.ok(m.waypoints.every((w) => insideGeofence(w.position, PLOT, 0.1)));
  // Starts at the far end and finishes near the take-off point.
  assert.ok(distanceM(photos[0].position, PLOT_HOME) > 15);
  assert.ok(distanceM(photos.at(-1)!.position, PLOT_HOME) < 6);
});

test("first flight: hovers, scans the bottom of the garden, lands where it took off without climbing", () => {
  const { sim, session, mission } = setup();
  session.start();
  let maxAlt = 0;
  let heldFor = 0;
  let last = sim.timeS;
  run(sim, session, {
    until: landed(sim, session),
    each: () => {
      maxAlt = Math.max(maxAlt, sim.telemetry().altitudeM);
      if (session.holdRemainingS !== undefined) heldFor += sim.timeS - last;
      last = sim.timeS;
    },
  });
  assert.equal(session.state, "landed");
  assert.equal(session.returnReason, "complete");
  assert.equal(sim.photos.length, mission.estimate.photoCount);
  assert.ok(maxAlt < FIRST_FLIGHT.altitudeM + 0.5, `climbed to ${maxAlt} m`);
  assert.ok(heldFor >= FIRST_FLIGHT.holdS - 1, `hovered ${heldFor} s`);
  assert.ok(distanceM(sim.telemetry().position, PLOT_HOME) < 1);
});

test("first flight: the pilot can end the hover early", () => {
  const { sim, session } = setup();
  session.start();
  run(sim, session, { until: () => session.holdRemainingS !== undefined });
  const t0 = sim.timeS;
  session.endHold();
  run(sim, session, { until: () => sim.photos.length >= 1 });
  assert.ok(sim.timeS - t0 < 30, "went on to the scan without waiting out the hover");
});

test("first flight: link lost while hovering, then back: the app brings the drone home", () => {
  // Signal-loss action "hover", like the drone holding position when only the phone is unplugged.
  const { sim, session } = setup({ ...DEFAULT_SAFETY, signalLossAction: "hover" });
  session.start();
  run(sim, session, { until: () => session.holdRemainingS !== undefined });
  sim.setSignal(false);
  const t0 = sim.timeS;
  run(sim, session, { until: () => sim.timeS >= t0 + 5 });
  assert.equal(session.state, "signalLost");
  sim.setSignal(true);
  run(sim, session, { until: landed(sim, session) });
  assert.equal(session.returnReason, "signalLoss");
  assert.ok(distanceM(sim.telemetry().position, PLOT_HOME) < 1);
});
