import { test } from "node:test";
import assert from "node:assert/strict";

import { MAX_ZOOM, NO_ZOOM, boxAround, levelTurn, toPlan, turnBox, turnPt, zoomAt, zoomedView, type VB } from "./mapZoom.ts";

// The garden view: a tall, thin plot (about 13 x 51 m with the margins) on a phone-shaped map.
const BASE: VB = [-2.4, -2.2, 12.8, 51];
const W = 400;
const H = 500;

test("no zoom shows the whole plot", () => {
  assert.deepEqual(zoomedView(BASE, NO_ZOOM), BASE);
});

test("zooming keeps the view inside the plot and within the zoom limits", () => {
  const v = zoomedView(BASE, { k: 4, c: [100, -100] });
  assert.ok(Math.abs(v[2] - BASE[2] / 4) < 1e-9);
  assert.ok(v[0] >= BASE[0] && v[0] + v[2] <= BASE[0] + BASE[2] + 1e-9);
  assert.ok(v[1] >= BASE[1] - 1e-9);
  assert.equal(zoomedView(BASE, { k: 100, c: null })[2], BASE[2] / MAX_ZOOM);
  assert.deepEqual(zoomedView(BASE, { k: 0.2, c: [3, 3] }), BASE);
});

test("a pinch keeps the spot between the fingers under them", () => {
  const spot: [number, number] = [3.5, 20];
  const z = zoomAt(BASE, W, H, 3, spot, 180, 260);
  const back = toPlan(zoomedView(BASE, z), W, H, 180, 260);
  assert.ok(Math.hypot(back[0] - spot[0], back[1] - spot[1]) < 1e-6, `${back}`);
});

test("pinching all the way out goes back to the whole plot", () => {
  assert.deepEqual(zoomAt(BASE, W, H, 0.5, [3, 20], 100, 100), NO_ZOOM);
});

test("a quarter turn clockwise puts the plan's top edge down the right-hand side", () => {
  assert.deepEqual(turnPt([10, 0], 90), [0, 10]);
  assert.deepEqual(turnPt([0, 10], 90), [-10, 0]);
  assert.deepEqual(turnPt(turnPt([3, 7], 270), -270), [3, 7]);
  assert.deepEqual(turnBox([0, 0, 7, 46], 90), [-46, 0, 46, 7]);
  assert.deepEqual(turnBox([0, 0, 7, 46], 0), [0, 0, 7, 46]);
});

test("a traced outline is turned so its longest side lies level along the bottom", () => {
  // A long side slanting down to the right, the rest of the shape above it on screen.
  const ring: [number, number][] = [[0, 0], [100, 50], [90, 20], [20, -10]];
  const deg = levelTurn(ring);
  const [a, b] = [turnPt(ring[0], deg), turnPt(ring[1], deg)];
  assert.ok(Math.abs(a[1] - b[1]) < 0.2); // the turn is rounded to a tenth of a degree
  for (const p of ring) assert.ok(turnPt(p, deg)[1] <= Math.max(a[1], b[1]) + 1e-6);
  assert.deepEqual(boxAround([[1, 2], [5, 9]], 1), [0, 1, 6, 9]);
});
