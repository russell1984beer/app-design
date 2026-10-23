import { test } from "node:test";
import assert from "node:assert/strict";

import { fromLocal, type LatLng } from "../../../packages/flight-core/src/geo.ts";

import { placeCache } from "./placeCache.ts";

const HERE: LatLng = { lat: 51.0, lng: 0.5 };
const north = (m: number) => fromLocal(HERE, { x: 0, y: m });

function setup(fail = false) {
  let t = 1_000_000;
  let loads = 0;
  let release: () => void = () => {};
  const cache = placeCache({
    keepMs: 60_000,
    samePlaceM: 100,
    retryAfterErrorMs: 10_000,
    now: () => t,
    load: (pos: LatLng) => {
      loads++;
      return new Promise<string>((ok, no) => {
        release = () => (fail ? no(new Error("offline")) : ok(`answer ${pos.lat.toFixed(4)}`));
      });
    },
  });
  return { cache, tick: (ms: number) => (t += ms), loads: () => loads, release: () => release() };
}

test("place cache: an answer is kept for keepMs, then a new lookup is due", async () => {
  const c = setup();
  const p = c.cache.refresh(HERE);
  c.release();
  await p;
  assert.ok(c.cache.current(HERE));
  assert.equal(c.cache.due(HERE), false);
  c.tick(60_001);
  assert.equal(c.cache.current(HERE), null);
  assert.equal(c.cache.due(HERE), true);
});

test("place cache: the same place within samePlaceM, not beyond", async () => {
  const c = setup();
  const p = c.cache.refresh(HERE);
  c.release();
  await p;
  assert.ok(c.cache.current(north(90)));
  assert.equal(c.cache.current(north(110)), null);
  assert.equal(c.cache.latest(), "answer 51.0000");
});

test("place cache: after a failure, asks again only after retryAfterErrorMs; an earlier answer stays", async () => {
  const ok = setup();
  let p = ok.cache.refresh(HERE);
  ok.release();
  await p;
  const c = setup(true);
  p = c.cache.refresh(HERE);
  c.release();
  await p;
  assert.equal(c.cache.error(HERE), "offline");
  assert.equal(c.cache.current(HERE), null);
  assert.equal(c.cache.due(HERE), false);
  c.tick(10_000);
  assert.equal(c.cache.due(HERE), true);
  // Somewhere else is not affected by the failure here.
  assert.equal(c.cache.error(north(500)), null);
  // A failure after an answer: the answer is still there, the failure is reported, and a retry is due later.
  c.cache.set(HERE, "saved");
  c.tick(1);
  p = c.cache.refresh(HERE);
  c.release();
  await p;
  assert.equal(c.cache.current(HERE), "saved");
  assert.equal(c.cache.error(HERE), "offline");
  assert.equal(c.cache.due(HERE), false);
  c.tick(10_000);
  assert.equal(c.cache.due(HERE), true);
});

test("place cache: one lookup at a time", async () => {
  const c = setup();
  const a = c.cache.refresh(HERE);
  const b = c.cache.refresh(north(500));
  assert.equal(c.cache.loading(), true);
  assert.equal(c.cache.due(north(500)), false);
  c.release();
  await Promise.all([a, b]);
  assert.equal(c.loads(), 1);
  assert.equal(c.cache.loading(), false);
});
