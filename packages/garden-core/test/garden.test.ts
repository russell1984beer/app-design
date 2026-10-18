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
  bbox,
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
  sunElevationAt,
  sunPosition,
  clipToY,
  inRing,
  plotOutline,
  pointInside,
  spanAtX,
  type Item,
} from "../src/index.ts";

const z = draftTerrain(P);
const lvl = levelFn(P, z);
const ids = () => {
  let n = 1;
  return () => n++;
};

test("plot: 7 × 46.5 m, levels relative to the back door", () => {
  assert.equal(P.widthM * P.lengthM, 325.5);
  assert.ok(Math.abs(lvl(3, P.rearGardenM)) < 1e-12);
  // As in the prototype's draft, the garden rises towards the far end.
  assert.ok(lvl(3, 1) > lvl(3, 25));
});

test("plot outline: the rectangle, or a traced boundary of any shape", () => {
  assert.deepEqual(plotOutline(P), [[0, 0], [P.widthM, 0], [P.widthM, P.lengthM], [0, P.lengthM]]);
  // An L shape: narrow at the far end, wide nearer the street.
  const L: [number, number][] = [[0, 0], [10, 0], [10, 20], [30, 20], [30, 40], [0, 40]];
  assert.deepEqual(plotOutline({ ...P, boundary: L }), L);
  assert.ok(inRing(L, 5, 10) && !inRing(L, 20, 10) && inRing(L, 20, 30));
  assert.deepEqual(spanAtX(L, 5), [0, 40]);
  assert.deepEqual(spanAtX(L, 20), [20, 40]);
  assert.equal(spanAtX(L, 40), null);
  // The far-end part up to y = 25: the narrow bit and a 5 m strip of the wide bit.
  const near = clipToY(L, 25);
  assert.ok(near.every(([, y]) => y <= 25));
  assert.ok(inRing(near, 5, 10) && inRing(near, 20, 22) && !inRing(near, 20, 30));
  assert.deepEqual(clipToY(L, -1), []);
  const inside = pointInside(L);
  assert.ok(inRing(L, inside[0], inside[1]));
});

test("levels: contours every 25 cm, slope bands, distance and fall", () => {
  const c = contours(P, z);
  assert.ok(c.filter((k) => k.segments.length > 0).length >= 4);
  assert.ok(c.some((k) => k.level === 0 && k.major));
  assert.ok(c.some((k) => k.level === 0.25 && !k.major));
  assert.equal(slopeCells(P, z).length, P.widthM * Math.ceil(P.lengthM));
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
  assert.equal(items.length, 14);
  assert.ok(items.every((i) => i.exist && i.label));
  // Everything measured on the survey photo lies in the rear garden, clear of the house.
  for (const it of items) {
    const [x0, y0, x1, y1] = bbox(it);
    assert.ok(x0 >= -0.01 && x1 <= P.widthM + 0.01 && y0 >= -0.01 && y1 <= P.rearGardenM + 0.01, `${it.label} inside the rear garden`);
  }
  assert.equal(items.find((i) => i.kind === "greenhouse")!.y < 5, true, "the greenhouse is at the far end");
  const tub = items.find((i) => i.kind === "hottub")!;
  assert.ok(Math.abs(itemArea(tub) - (Math.PI * 1.7 * 1.7) / 4) < 1e-9);
  assert.ok(inItem(tub, tub.x, tub.y));
  assert.ok(!inItem(tub, tub.x + 0.8, tub.y + 0.8), "round, not square");
  const tramp = items.find((i) => i.kind === "trampoline")!;
  assert.ok(!inItem(tramp, tramp.x + 1.4, tramp.y + 1.4), "the trampoline is round too");
  const lawn = items.find((i) => i.kind === "lawn")!;
  assert.ok(inItem(lawn, lawn.x, lawn.y) && itemArea(lawn) > 25, "the drawn lawn has its centre and area");
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
  const r = applyStyle(P, start, "family", ids());
  assert.ok(!r.items.some((i) => i.id === 50), "the old new pond goes");
  assert.equal(r.added.length, STYLES.family.items.length);
  // The family patio, by the house, covers the existing patio there and the hot tub.
  assert.ok(!r.items.some((i) => i.exist && (i.label === "Patio by the house" || i.kind === "hottub")));
  assert.ok(r.items.some((i) => i.exist && i.kind === "greenhouse"), "the greenhouse at the far end stays");
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

test("sun now: the first real scan (14 Oct, 18:13 BST) was flown at sunset; midday was well lit", () => {
  // A made-up spot at the same latitude on the south coast.
  const at = (iso: string) => sunElevationAt(50.87, 0.6, new Date(iso));
  assert.ok(at("2026-10-14T17:13:00Z") < 3, `${at("2026-10-14T17:13:00Z")}`);
  assert.ok(at("2026-10-14T12:00:00Z") > 25);
  assert.ok(at("2026-12-21T12:00:00Z") > 14 && at("2026-12-21T12:00:00Z") < 17, "winter midday is low but not dark");
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
  assert.equal(grid.length, 14 * P.rearGardenM * 2);
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
