import { test } from "node:test";
import assert from "node:assert/strict";

import { flyZonesFromDji } from "./flyZones.ts";
import type { NativeFlyZone } from "./DjiDrone.types.ts";

const base: NativeFlyZone = { id: 1, name: "Somewhere", category: "RESTRICTED", type: "AIRPORT", lowerM: 0, upperM: 0, circle: null, areas: [] };

test("FlySafe zones: circles, polygons and height limits", () => {
  const zones = flyZonesFromDji([
    { ...base, circle: { lat: 52, lng: -1, radiusM: 500 } },
    {
      ...base,
      id: 2,
      category: "AUTHORIZATION",
      type: "MILITARY",
      areas: [
        { points: [[52, -1], [52.01, -1], [52.01, -0.99]], circle: null, limitM: 0 },
        { points: [], circle: { lat: 52, lng: -1, radiusM: 900 }, limitM: 60 },
      ],
    },
    { ...base, id: 3, category: "WARNING", type: null, lowerM: 120, circle: { lat: 52, lng: -1, radiusM: 2000 } },
  ]);
  assert.equal(zones.length, 4);
  assert.deepEqual(zones[0], { name: 'DJI zone "Somewhere" (airport)', kind: "restricted", circle: { center: { lat: 52, lng: -1 }, radiusM: 500 }, heightLimitM: undefined });
  assert.equal(zones[1].kind, "authorisation");
  assert.equal(zones[1].polygon?.length, 3);
  assert.equal(zones[1].heightLimitM, undefined);
  assert.equal(zones[2].heightLimitM, 60);
  assert.equal(zones[3].kind, "warning");
  assert.equal(zones[3].heightLimitM, 120);
});
