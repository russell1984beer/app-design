// The first real flight: low hover over the take-off point, a small square of photos, land straight down.

import { test } from "node:test";
import assert from "node:assert/strict";

import { FlightSession } from "../src/flight-session.ts";
import { distanceM } from "../src/geo.ts";
import { FIRST_FLIGHT, planFirstFlight } from "../src/planner.ts";
import { DEFAULT_SAFETY, insideGeofence } from "../src/safety.ts";
import { SimDrone } from "../src/sim-drone.ts";
import { PLOT, PLOT_HOME, landed, run } from "./helpers.ts";

function setup(settings = DEFAULT_SAFETY) {
  const sim = new SimDrone({ home: PLOT_HOME });
  const session = new FlightSession({ mission: planFirstFlight(PLOT_HOME), boundary: PLOT, home: PLOT_HOME, settings, bridge: sim, clock: () => sim.timeS });
  return { sim, session };
}

test("first flight plan: 5 m up, a 4 m square of 4 photos round the take-off point, then land", () => {
  const m = planFirstFlight(PLOT_HOME);
  assert.equal(m.kind, "check");
  assert.equal(m.endWith, "land");
  assert.equal(m.estimate.photoCount, 4);
  assert.ok(m.waypoints.every((w) => w.altitudeM === FIRST_FLIGHT.altitudeM));
  assert.equal(m.waypoints[0].holdS, FIRST_FLIGHT.holdS);
  assert.ok(distanceM(m.waypoints[0].position, PLOT_HOME) < 0.01);
  assert.ok(distanceM(m.waypoints.at(-1)!.position, PLOT_HOME) < 0.01);
  for (const w of m.waypoints.filter((x) => x.photo)) assert.ok(Math.abs(distanceM(w.position, PLOT_HOME) - Math.SQRT2 * 2) < 0.05);
  // The square fits inside the 7 m wide test garden.
  assert.ok(m.waypoints.every((w) => insideGeofence(w.position, PLOT, 0)));
});

test("first flight: hovers over the take-off point, takes 4 photos, lands where it took off without climbing", () => {
  const { sim, session } = setup();
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
  assert.equal(sim.photos.length, 4);
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
  assert.ok(sim.timeS - t0 < 20, "went on to the square without waiting out the hover");
});

test("first flight: link lost while hovering, then back: the app brings the drone home", () => {
  // Signal-loss action "hover", like the drone holding position when only the phone is unplugged.
  const { sim, session: s2 } = setup({ ...DEFAULT_SAFETY, signalLossAction: "hover" });
  s2.start();
  run(sim, s2, { until: () => s2.holdRemainingS !== undefined });
  sim.setSignal(false);
  const t0 = sim.timeS;
  run(sim, s2, { until: () => sim.timeS >= t0 + 5 });
  assert.equal(s2.state, "signalLost");
  sim.setSignal(true);
  run(sim, s2, { until: landed(sim, s2) });
  assert.equal(s2.returnReason, "signalLoss");
  assert.ok(distanceM(sim.telemetry().position, PLOT_HOME) < 1);
});
