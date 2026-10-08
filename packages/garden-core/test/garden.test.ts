import { test } from "node:test";
import assert from "node:assert/strict";

import {
  EXAMPLE_ROOF_ISSUES,
  History,
  PLANT_BY_ID,
  STYLES,
  TEST_PLOT as P,
  applyStyle,
  area,
  bedSun,
  clampToPlot,
  contours,
  draftTerrain,
  duplicate,
  eastNorthToPlan,
  existingFeatures,
  inItem,
  itemArea,
  levelFn,
  levelling,
  measureLine,
  newItem,
  planToEastNorth,
  planVector,
  plantCount,
  quantities,
  reportSummary,
  roofArea,
  rotate90,
  shadows,
  slopeCells,
  suggestPlants,
  sunHoursAt,
  sunHoursGrid,
  sunPosition,
  type Item,
} from "../src/index.ts";

const z = draftTerrain(P);
const lvl = levelFn(P, z);
const ids = () => {
  let n = 1;
  return () => n++;
};

test("plot: 7 × 43 m, levels relative to the back door", () => {
  assert.equal(P.widthM * P.lengthM, 301);
  assert.ok(Math.abs(lvl(3, P.rearGardenM)) < 1e-12);
  // As in the prototype's draft, the garden rises towards the far end.
  assert.ok(lvl(3, 1) > lvl(3, 25));
});

test("levels: contours every 25 cm, slope bands, distance and fall", () => {
  const c = contours(P, z);
  assert.ok(c.filter((k) => k.segments.length > 0).length >= 4);
  assert.ok(c.some((k) => k.level === 0 && k.major));
  assert.ok(c.some((k) => k.level === 0.25 && !k.major));
  assert.equal(slopeCells(P, z).length, 7 * 43);
  const m = measureLine(lvl, [3, 2], [3, 22]);
  assert.equal(m.distanceM, 20);
  assert.ok(m.riseM < 0, "falls towards the house");
});

test("plan directions: up the plan is the garden's bearing; right is 90° clockwise", () => {
  const up = planToEastNorth(P, [0, 10], [0, 9]);
  const b = (P.gardenBearingDeg * Math.PI) / 180;
  assert.ok(Math.abs(up.east - Math.sin(b)) < 1e-9 && Math.abs(up.north - Math.cos(b)) < 1e-9);
  const right = planToEastNorth(P, [0, 10], [1, 10]);
  assert.ok(Math.abs(right.east - Math.cos(b)) < 1e-9 && Math.abs(right.north + Math.sin(b)) < 1e-9);
  const back = eastNorthToPlan(P, [0, 10], planToEastNorth(P, [0, 10], [4.2, 31.5]));
  assert.ok(Math.abs(back[0] - 4.2) < 1e-9 && Math.abs(back[1] - 31.5) < 1e-9);
  const v = planVector(P, P.gardenBearingDeg);
  assert.ok(Math.abs(v[0]) < 1e-9 && Math.abs(v[1] + 1) < 1e-9);
});

test("design: existing features, shapes and areas", () => {
  const items = existingFeatures(P, ids());
  assert.equal(items.length, 7);
  assert.ok(items.every((i) => i.exist));
  const tub = items.find((i) => i.kind === "hottub")!;
  assert.ok(Math.abs(itemArea(tub) - (Math.PI * 2.1 * 2.1) / 4) < 1e-9);
  assert.ok(inItem(tub, tub.x, tub.y));
  assert.ok(!inItem(tub, tub.x + 1.1, tub.y + 1.1), "round, not square");
  const drawn: Item = { id: 99, kind: "lawn", x: 0, y: 0, w: 0, h: 0, a: 0, pts: [[0, 0], [4, 0], [4, 3], [0, 3]] };
  assert.equal(itemArea(drawn), 12);
  assert.ok(inItem(drawn, 2, 1) && !inItem(drawn, 5, 1));
});

test("design: features cannot be placed in the house and are kept inside the plot", () => {
  assert.equal(newItem(P, "patio", [2, P.rearGardenM + 2], 1), null);
  const it = newItem(P, "patio", [6.9, 0.2], 1)!;
  assert.ok(it.x + it.w / 2 <= P.widthM + 1e-9 && it.y - it.h / 2 >= -1e-9);
  const r: Item = { id: 2, kind: "path", x: 0.5, y: 10, w: 1, h: 6, a: 0 };
  rotate90(P, r);
  assert.equal(r.a, 90);
  assert.ok(r.x - 3 >= -1e-9, "rotated path pushed back inside");
  const d = duplicate(P, { ...r, exist: true }, 3);
  assert.equal(d.id, 3);
  assert.equal(d.exist, undefined);
  const far: Item = { id: 4, kind: "shed", x: -3, y: 50, w: 2, h: 2, a: 0 };
  clampToPlot(P, far);
  assert.deepEqual([far.x, far.y], [1, P.lengthM - 1]);
});

test("design: a style replaces new features and removes existing ones it builds over", () => {
  const start = [...existingFeatures(P, ids()), { id: 50, kind: "pond" as const, x: 2, y: 2, w: 1, h: 1, a: 0 }];
  const r = applyStyle(start, "family", ids());
  assert.ok(!r.items.some((i) => i.id === 50), "the old new pond goes");
  assert.equal(r.added.length, STYLES.family.items.length);
  // The family patio covers the existing patio and hot tub.
  assert.ok(!r.items.some((i) => i.exist && i.kind === "patio"));
  assert.match(r.note, /removed to make room/);
});

test("design: undo and redo", () => {
  const h = new History();
  let items: Item[] = [];
  h.push(items);
  items = [{ id: 1, kind: "bed", x: 2, y: 2, w: 1, h: 1, a: 0 }];
  assert.ok(h.canUndo && !h.canRedo);
  items = h.undo(items)!;
  assert.equal(items.length, 0);
  items = h.redo(items)!;
  assert.equal(items.length, 1);
});

test("sun: June midday is high in the south, December low", () => {
  const june = sunPosition(P.latitudeDeg, 172, 12);
  assert.ok(Math.abs(june.el - (90 - P.latitudeDeg + 23.44)) < 0.5);
  assert.ok(Math.abs(june.az - 180) < 1);
  const dec = sunPosition(P.latitudeDeg, 355, 12);
  assert.ok(dec.el > 14 && dec.el < 17);
  assert.equal(shadows(P, [], sunPosition(P.latitudeDeg, 172, 1)), null, "night");
});

test("sun: shade from trees and sheds; open lawn gets more sun", () => {
  const items = existingFeatures(P, ids());
  const pts: [number, number][] = [];
  for (let x = 0.5; x < 7; x += 1) for (let y = 0.5; y < 29; y += 1) pts.push([x, y]);
  const bare = pts.map((p) => sunHoursAt(P, [], 172, [p]));
  const planted = pts.map((p) => sunHoursAt(P, items, 172, [p]));
  assert.ok(bare.some((h) => h > 6));
  assert.ok(planted.every((h, i) => h <= bare[i]), "trees and the greenhouse only ever take sun away");
  assert.ok(planted.some((h, i) => h < bare[i] - 1));
  const grid = sunHoursGrid(P, items, 172);
  assert.equal(grid.length, 14 * 59);
});

test("plants: suggestions suit the bed's sun; raised beds get vegetables", () => {
  const items = existingFeatures(P, ids());
  const bed: Item = { id: 90, kind: "bed", x: 3.5, y: 20, w: 3, h: 1.2, a: 0 };
  const sun = bedSun(P, items, bed);
  const s = suggestPlants(P, items, bed);
  assert.equal(s.length, 3);
  assert.ok(s.every((id) => PLANT_BY_ID[id].sun === sun.cls && !PLANT_BY_ID[id].veg));
  const raised: Item = { ...bed, kind: "raised" };
  assert.ok(suggestPlants(P, items, raised).every((id) => PLANT_BY_ID[id].veg));
  bed.plants = ["lav", "sal"];
  // 3.6 m² shared by two plants: lavender at 45 cm needs ceil(1.8 / 0.2025) = 9.
  assert.equal(plantCount(bed, "lav"), 9);
  assert.equal(plantCount(bed, "hos"), 0);
});

test("materials: patio quantities and levelling", () => {
  const patio: Item = { id: 1, kind: "patio", x: 3.5, y: 26, w: 6, h: 4, a: 0, mat: "porcelain" };
  const q = quantities(patio, z);
  assert.equal(q.lines[0][1], "24.0 m²");
  assert.equal(q.lines[1][1], `${Math.ceil((24 / 0.36) * 1.05)} slabs`);
  assert.ok(q.cost > 24 * 38);
  const L = levelling(patio, z);
  assert.ok(L.fall > 0 && L.cut > 0 && L.fill > 0);
  const turf = quantities({ id: 2, kind: "lawn", x: 3, y: 15, w: 5, h: 4, a: 0 }, z);
  assert.equal(turf.lines[1][1], "21 rolls");
});

test("every kind of feature has quantities", () => {
  for (const kind of ["patio", "lawn", "bed", "raised", "path", "deck", "pond", "meadow", "shed", "tree", "greenhouse", "hottub"] as const) {
    const q = quantities({ id: 1, kind, x: 3, y: 10, w: 2, h: 2, a: 0, plants: kind.includes("bed") || kind === "raised" ? [] : undefined }, z);
    assert.ok(q.cost > 0 && q.lines.length > 0, kind);
  }
});

test("roof: area of the owner's half at 35° and the example report", () => {
  assert.equal(Math.round(roofArea(P)), 57);
  const s = reportSummary(EXAMPLE_ROOF_ISSUES);
  assert.deepEqual([s.fixSoon, s.planFor, s.watch], [1, 3, 1]);
  assert.equal(s.low, 1080);
  assert.equal(area([[0, 0], [2, 0], [2, 2]]), 2);
});
