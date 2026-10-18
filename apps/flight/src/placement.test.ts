import { test } from "node:test";
import assert from "node:assert/strict";

import { bearingDeg, distanceM, fromLocal } from "../../../packages/flight-core/src/geo.ts";
import { plotFromCorners } from "../../../packages/flight-core/src/georef.ts";
import { TEST_PLOT, type Plot } from "../../../packages/garden-core/src/index.ts";
import { TAKEOFF_BLOCK_M, TAKEOFF_WARN_M, planPointFromCorner, takeoffSpotCheck } from "./placement.ts";

// A made-up spot (not the owner's address: this repository is public).
const FAR_LEFT = { lat: 51.5, lng: -1.2 };

test("plan points from the marked corner: the plot's corners come back where they were marked", () => {
  const plot: Plot = { ...TEST_PLOT, widthM: 7, lengthM: 46.5, gardenBearingDeg: 119 };
  const corners = [[0, 0], [7, 0], [7, 46.5], [0, 46.5]].map(([x, y]) => planPointFromCorner(plot, FAR_LEFT, [x, y]));
  assert.deepEqual(corners[0], FAR_LEFT);
  // Marked in the Projects tab's order, they give back the same plot.
  const back = plotFromCorners(corners);
  assert.ok(Math.abs(back.widthM - 7) < 0.01 && Math.abs(back.lengthM - 46.5) < 0.01);
  assert.ok(Math.abs(back.gardenBearingDeg - 119) < 0.1);
  // Down the garden from the house is towards the far end; the street end is the other way.
  const street = planPointFromCorner(plot, FAR_LEFT, [3.5, 46.5]);
  const far = planPointFromCorner(plot, FAR_LEFT, [3.5, 0]);
  assert.ok(Math.abs(bearingDeg(street, far) - 119) < 0.1);
});

test("take-off spot: on it passes, a few metres off warns, further blocks", () => {
  const home = FAR_LEFT;
  const at = (m: number) => fromLocal(home, { x: m, y: 0 });
  assert.equal(takeoffSpotCheck(at(1), home).status, "pass");
  assert.equal(takeoffSpotCheck(at(TAKEOFF_WARN_M + 0.5), home).status, "warn");
  const far = takeoffSpotCheck(at(TAKEOFF_BLOCK_M + 1), home);
  assert.equal(far.status, "block");
  assert.match(far.message, /6\.0 m from the take-off point/);
  assert.ok(distanceM(at(1), home) < 1.01);
});
