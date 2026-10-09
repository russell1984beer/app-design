import { test } from "node:test";
import assert from "node:assert/strict";

import { MAX_ZOOM, NO_ZOOM, toPlan, zoomAt, zoomedView, type VB } from "./mapZoom.ts";

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
