import { test } from "node:test";
import assert from "node:assert/strict";

import { distanceM, fromLocal } from "../src/geo.ts";
import { latLngToWorldPx, metresPerPx, plotFromCorners, tilesAround, worldPxToLatLng } from "../src/georef.ts";
import { ORIGIN, alongAxis } from "./helpers.ts";

test("map pixels: there and back, and the right scale", () => {
  const p = { lat: 50.87, lng: 0.6 };
  const px = latLngToWorldPx(p, 19);
  const back = worldPxToLatLng(px.x, px.y, 19);
  assert.ok(distanceM(p, back) < 0.01);
  // About 19 cm a pixel at zoom 19 on the south coast: 10 m east is about 53 pixels.
  const east = latLngToWorldPx(fromLocal(p, { x: 10, y: 0 }), 19);
  assert.ok(Math.abs(east.x - px.x - 10 / metresPerPx(p.lat, 19)) < 0.1);
  assert.ok(metresPerPx(p.lat, 19) > 0.18 && metresPerPx(p.lat, 19) < 0.2);
});

test("map tiles: cover the whole view, placed where they belong", () => {
  const tiles = tilesAround(ORIGIN, 19, 600, 400);
  assert.ok(tiles.length >= 6 && tiles.length <= 12);
  assert.ok(tiles.every((t) => t.left > -256 && t.left < 600 && t.top > -256 && t.top < 400));
  assert.ok(tiles.some((t) => t.left <= 0 && t.top <= 0), "top-left corner covered");
  assert.ok(tiles.some((t) => t.left + 256 >= 600 && t.top + 256 >= 400), "bottom-right corner covered");
});

test("plot from its corners: size, direction down the garden, and the plan's origin", () => {
  // A 7 x 46.5 m plot whose garden runs at 119°: the street end at the origin.
  const bearing = 119;
  const at = (along: number, right: number) => alongAxis(ORIGIN, bearing, along, right);
  // Looking down the garden (bearing 119°), left is -x and right +x on the plan.
  const corners = [at(46.5, -3.5), at(46.5, 3.5), at(0, 3.5), at(0, -3.5)];
  const p = plotFromCorners(corners);
  assert.ok(Math.abs(p.widthM - 7) < 0.01 && Math.abs(p.lengthM - 46.5) < 0.01);
  assert.ok(Math.abs(p.gardenBearingDeg - 119) < 0.1);
  assert.deepEqual(p.farLeft, corners[0]);
  assert.throws(() => plotFromCorners(corners.slice(0, 3)), /four corners/);
});
