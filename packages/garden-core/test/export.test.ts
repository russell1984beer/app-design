import { test } from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_PRICES, PRICE_LIST, TEST_PLOT as P, draftTerrain, existingFeatures, planDxf, quantities, quoteHtml, type Item } from "../src/index.ts";

const z = draftTerrain(P);
const patio: Item = { id: 1, kind: "patio", x: 3.5, y: 26, w: 6, h: 4, a: 0, mat: "porcelain" };
const pond: Item = { id: 2, kind: "pond", x: 2, y: 20, w: 2, h: 1.5, a: 30 };
const tree: Item = { id: 3, kind: "tree", x: 5, y: 5, w: 3, h: 3, a: 0 };

test("prices: every price has a default, and changing one changes the estimate", () => {
  for (const p of PRICE_LIST) assert.equal(DEFAULT_PRICES[p.id], p.price);
  const base = quantities(patio, z).cost;
  const dearer = quantities(patio, z, { ...DEFAULT_PRICES, "patio:porcelain": 48 }).cost;
  assert.ok(Math.abs(dearer - base - 24 * 10) < 1e-9, "24 m² at £10 more");
  assert.equal(quantities(tree, z, { ...DEFAULT_PRICES, tree: 200 }).cost, 200);
  // Unknown or missing prices fall back to the defaults.
  assert.equal(quantities(patio, z, {}).cost, base);
});

test("quote: lists each new feature, the total, and leaves out existing ones", () => {
  const items = [...existingFeatures(P, (() => { let n = 100; return () => n++; })()), patio, tree];
  const html = quoteHtml({ plot: P, items, z, title: "Garden <quote>", date: new Date("2026-10-08T12:00:00Z") });
  assert.match(html, /Garden &lt;quote&gt;/, "text is escaped");
  assert.match(html, /Patio, 6\.0 × 4\.0 m/);
  assert.match(html, /Tree, 3\.0 m across/);
  assert.doesNotMatch(html, /Existing/);
  const total = quantities(patio, z).cost + quantities(tree, z).cost;
  assert.match(html, new RegExp(`Materials total</span><span>£${Math.round(total).toLocaleString("en-GB")}`));
  assert.match(html, /8 October 2026/);
});

test("DXF: boundary, house, features and labels, in metres with the garden end at the top", () => {
  const dxf = planDxf(P, [patio, pond, tree, { ...tree, id: 4, exist: true }]);
  const lines = dxf.trim().split("\n");
  assert.equal(lines.length % 2, 0, "code/value pairs");
  assert.equal(lines.at(-1), "EOF");
  const count = (s: string) => lines.filter((l, i) => i % 2 === 1 && l === s).length;
  assert.equal(count("POLYLINE"), 4, "boundary, house, patio, pond");
  assert.equal(count("CIRCLE"), 2);
  assert.equal(count("TEXT"), 5);
  assert.ok(lines.includes("EXISTING") && lines.includes("NEW") && lines.includes("BOUNDARY"));
  // The far end of the garden (plan y = 0) is at the top: DXF y = 43.
  const ys = lines.flatMap((l, i) => (i % 2 === 0 && l === "20" ? [Number(lines[i + 1])] : []));
  assert.equal(Math.max(...ys), 43);
  assert.equal(Math.min(...ys), 0);
});
