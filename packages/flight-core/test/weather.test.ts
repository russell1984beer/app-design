import { test } from "node:test";
import assert from "node:assert/strict";

import { fetchMetOfficeWind, metOfficeUrl, parseMetOfficeHourly, type FetchLike } from "../src/weather.ts";
import { DEFAULT_SAFETY, preflightCheck } from "../src/safety.ts";
import { planSurvey } from "../src/planner.ts";
import { PLOT, PLOT_HOME } from "./helpers.ts";

const step = (time: string, speed: number, gust: number, dir = 220) => ({ time, windSpeed10m: speed, windGustSpeed10m: gust, windDirectionFrom10m: dir });
const reply = (steps: object[]) => ({ type: "FeatureCollection", features: [{ type: "Feature", properties: { timeSeries: steps } }] });
const NOW = new Date("2026-10-08T10:20:00Z");

test("weather: takes the worst gust over the next two hours, including the hour in progress", () => {
  const f = parseMetOfficeHourly(
    reply([
      step("2026-10-08T09:00Z", 9, 15), // already past
      step("2026-10-08T10:00Z", 3, 5),
      step("2026-10-08T11:00Z", 4, 7, 250),
      step("2026-10-08T12:00Z", 3, 6),
      step("2026-10-08T13:00Z", 10, 18), // too far ahead
    ]),
    NOW,
  );
  assert.deepEqual({ ...f, source: undefined }, { speedMs: 4, gustMs: 7, fromDeg: 250, source: undefined });
  assert.match(f!.source, /11:00 UTC/);
});

test("weather: a reply with no usable hours means no forecast, so take-off is blocked", () => {
  assert.equal(parseMetOfficeHourly({}, NOW), null);
  assert.equal(parseMetOfficeHourly(reply([step("2026-10-07T10:00Z", 3, 5)]), NOW), null);
  assert.equal(parseMetOfficeHourly(reply([{ time: "2026-10-08T11:00Z", windSpeed10m: 3 }]), NOW), null);
  const r = preflightCheck({ settings: DEFAULT_SAFETY, boundary: PLOT, home: PLOT_HOME, mission: planSurvey(PLOT), forecast: undefined, noFlyZones: [], batteryPercent: 95 });
  assert.equal(r.items.find((i) => i.id === "wind")?.status, "block");
});

test("weather: gusts over the limit from the Met Office block take-off", async () => {
  const fetchFn: FetchLike = async () => ({ ok: true, status: 200, json: async () => reply([step("2026-10-08T11:00Z", 6, 9.5)]) });
  const r = await fetchMetOfficeWind(PLOT_HOME, "key", fetchFn, NOW);
  assert.ok("forecast" in r);
  const check = preflightCheck({ settings: DEFAULT_SAFETY, boundary: PLOT, home: PLOT_HOME, mission: planSurvey(PLOT), forecast: r.forecast, noFlyZones: [], batteryPercent: 95 });
  assert.ok(!check.canTakeOff);
});

test("weather: sends the key as the apikey header and explains failures plainly", async () => {
  let seen: { url: string; headers: Record<string, string> } | undefined;
  const ok: FetchLike = async (url, init) => {
    seen = { url, headers: init.headers };
    return { ok: true, status: 200, json: async () => reply([step("2026-10-08T11:00Z", 2, 4)]) };
  };
  await fetchMetOfficeWind({ lat: 52, lng: -1 }, "secret", ok, NOW);
  assert.equal(seen!.headers.apikey, "secret");
  assert.equal(seen!.url, metOfficeUrl({ lat: 52, lng: -1 }));
  assert.match(seen!.url, /latitude=52\.0000&longitude=-1\.0000/);

  const status = (n: number): FetchLike => async () => ({ ok: false, status: n, json: async () => ({}) });
  assert.match(((await fetchMetOfficeWind(PLOT_HOME, "", ok)) as { error: string }).error, /No Met Office key/);
  assert.match(((await fetchMetOfficeWind(PLOT_HOME, "k", status(401))) as { error: string }).error, /did not accept the key/);
  assert.match(((await fetchMetOfficeWind(PLOT_HOME, "k", status(429))) as { error: string }).error, /360/);
  const offline: FetchLike = async () => {
    throw new Error("offline");
  };
  assert.match(((await fetchMetOfficeWind(PLOT_HOME, "k", offline)) as { error: string }).error, /internet/);
});
