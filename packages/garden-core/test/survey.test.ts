import { test } from "node:test";
import assert from "node:assert/strict";

import { TEST_PLOT, fillHoles, gridHeight, readSurvey, terrainFromSurvey, type SurveyPackage } from "../src/index.ts";

const plane = (cols: number, rows: number, cellM: number) =>
  Array.from({ length: cols * rows }, (_, i) => 1 + 0.1 * ((i % cols) + 0.5) * cellM + 0.02 * (Math.floor(i / cols) + 0.5) * cellM);

test("survey grid: heights between squares are smooth and exact on a sloping plane", () => {
  const g = { cellM: 0.5, cols: 14, rows: 86, values: plane(14, 86, 0.5) };
  for (const [x, y] of [[0.25, 0.25], [3.1, 20.7], [6.75, 42.75], [2, 10]]) {
    assert.ok(Math.abs(gridHeight(g, x, y) - (1 + 0.1 * x + 0.02 * y)) < 1e-9, `${x},${y}`);
  }
  // Outside the squares' centres it holds the edge value.
  assert.equal(gridHeight(g, -5, 0.25), gridHeight(g, 0.25, 0.25));
});

test("survey grid: holes are filled from their neighbours", () => {
  const { values, known } = fillHoles(3, 3, [1, 1, 1, 1, null, 1, null, null, 1]);
  assert.deepEqual(values, [1, 1, 1, 1, 1, 1, 1, 1, 1]);
  assert.ok(Math.abs(known - 6 / 9) < 1e-9);
  assert.throws(() => fillHoles(2, 1, [null, null]), /no heights/);
});

test("survey file: opened, checked, and used as the terrain", () => {
  const pkg: SurveyPackage = {
    format: "plotwise-survey",
    version: 1,
    createdAt: "2026-10-08T12:00:00Z",
    flownAt: "2026-10-08T11:00:00Z",
    photoCount: 52,
    plot: TEST_PLOT,
    ground: { cellM: 0.5, cols: 14, rows: 86, values: plane(14, 86, 0.5) },
    coverage: 1,
  };
  const s = readSurvey(JSON.stringify(pkg));
  assert.ok(Math.abs(terrainFromSurvey(s)(3, 10) - 1.5) < 1e-9);
  assert.throws(() => readSurvey("not json"), /not a Plotwise survey/);
  assert.throws(() => readSurvey(JSON.stringify({ format: "other" })), /not a Plotwise survey/);
  assert.throws(() => readSurvey(JSON.stringify({ ...pkg, version: 2 })), /newer version/);
  assert.throws(() => readSurvey(JSON.stringify({ ...pkg, ground: { ...pkg.ground, values: [1] } })), /damaged/);
});
