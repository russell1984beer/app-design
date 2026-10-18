import { test } from "node:test";
import assert from "node:assert/strict";

import { distanceM, fromLocal, toLocal, type LatLng } from "../src/geo.ts";
import { latLngToWorldPx, metresPerPx, plotFromCorners, rectAroundPolygon, tilesAround, worldPxToLatLng } from "../src/georef.ts";
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

test("rectangle round a traced boundary: hugs any shape, long side along it, far end where tracing started", () => {
  // An L-shaped site 60 m long running at 70°, 20 m wide at one end and 40 m at the other.
  const bearing = 70;
  const at = (along: number, right: number) => alongAxis(ORIGIN, bearing, along, right);
  // Traced from the far end (60 m along), going round.
  const traced = [at(60, -10), at(60, 10), at(30, 10), at(30, 30), at(0, 30), at(0, -10)];
  const rect = rectAroundPolygon(traced);
  const p = plotFromCorners(rect);
  assert.ok(Math.abs(p.lengthM - 60) < 0.05 && Math.abs(p.widthM - 40) < 0.05, `${p.lengthM} x ${p.widthM}`);
  assert.ok(Math.abs(p.gardenBearingDeg - bearing) < 0.2, `${p.gardenBearingDeg}`);
  // Every traced point is inside the rectangle (within a few centimetres).
  const local = (q: LatLng) => {
    const v = toLocal(p.farLeft, q);
    const b = (p.gardenBearingDeg * Math.PI) / 180;
    return { right: v.x * Math.cos(b) - v.y * Math.sin(b), back: -(v.x * Math.sin(b) + v.y * Math.cos(b)) };
  };
  for (const q of traced) {
    const l = local(q);
    assert.ok(l.right > -0.05 && l.right < p.widthM + 0.05 && l.back > -0.05 && l.back < p.lengthM + 0.05, JSON.stringify(l));
  }
  // Traced from the other end instead: the far end flips round.
  const other = plotFromCorners(rectAroundPolygon([...traced.slice(4), ...traced.slice(0, 4)]));
  const turned = (other.gardenBearingDeg - bearing + 360) % 360;
  assert.ok(Math.abs(turned - 180) < 0.2, `${other.gardenBearingDeg}`);
  assert.throws(() => rectAroundPolygon(traced.slice(0, 2)), /three points/);
});
