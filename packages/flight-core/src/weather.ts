// Wind forecast from the Met Office Weather DataHub (Site-Specific "Global Spot" hourly forecast).
// The owner needs a free DataHub account and a Site-Specific subscription for the API key.
// No network code runs here except through the fetch function passed in, so it is easy to test.

import type { LatLng } from "./geo.ts";
import type { WindForecast } from "./safety.ts";

export const MET_OFFICE_HOURLY_URL = "https://data.hub.api.metoffice.gov.uk/sitespecific/v0/point/hourly";

/** Hours ahead to check: the flight plus the time to set up and swap a battery. */
export const FORECAST_WINDOW_HOURS = 2;

type TimeStep = {
  time?: string;
  windSpeed10m?: number;
  windDirectionFrom10m?: number;
  windGustSpeed10m?: number;
  max10mWindGust?: number;
};

export function metOfficeUrl(p: LatLng): string {
  return `${MET_OFFICE_HOURLY_URL}?latitude=${p.lat.toFixed(4)}&longitude=${p.lng.toFixed(4)}&excludeParameterMetadata=true&includeLocationName=false`;
}

/**
 * The worst wind in the next few hours from a Met Office hourly forecast (GeoJSON):
 * the highest gust, with the mean wind and direction of that hour. Null if the reply has no
 * usable hours, which the pre-flight check treats as "no forecast" and blocks take-off.
 */
export function parseMetOfficeHourly(json: unknown, now: Date, windowHours = FORECAST_WINDOW_HOURS): WindForecast | null {
  const series = (json as { features?: { properties?: { timeSeries?: TimeStep[] } }[] })?.features?.[0]?.properties?.timeSeries;
  if (!Array.isArray(series)) return null;
  // The hour in progress counts, so start from the top of the current hour.
  const from = Math.floor(now.getTime() / 3_600_000) * 3_600_000;
  const to = now.getTime() + windowHours * 3_600_000;
  let worst: WindForecast | null = null;
  for (const t of series) {
    const at = t.time ? Date.parse(t.time) : NaN;
    if (!(at >= from && at <= to)) continue;
    const gust = t.windGustSpeed10m ?? t.max10mWindGust;
    if (typeof gust !== "number" || typeof t.windSpeed10m !== "number" || typeof t.windDirectionFrom10m !== "number") continue;
    if (!worst || gust > worst.gustMs) {
      worst = { speedMs: t.windSpeed10m, gustMs: gust, fromDeg: t.windDirectionFrom10m, source: `Met Office forecast for ${new Date(at).toISOString().slice(11, 16)} UTC` };
    }
  }
  return worst;
}

export type FetchLike = (url: string, init: { headers: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export type ForecastResult = { forecast: WindForecast } | { error: string };

export async function fetchMetOfficeWind(p: LatLng, apiKey: string, fetchFn: FetchLike, now = new Date()): Promise<ForecastResult> {
  if (!apiKey) return { error: "No Met Office key yet. Add EXPO_PUBLIC_METOFFICE_API_KEY to the app's .env file and rebuild." };
  let res;
  try {
    res = await fetchFn(metOfficeUrl(p), { headers: { apikey: apiKey, accept: "application/json" } });
  } catch {
    return { error: "Could not reach the Met Office. Check the phone has internet." };
  }
  if (res.status === 401 || res.status === 403) return { error: "The Met Office did not accept the key. Check it in the .env file." };
  if (res.status === 429) return { error: "Too many forecast requests today (the free plan allows 360). Try again later." };
  if (!res.ok) return { error: `The Met Office forecast failed (error ${res.status}). Try again in a few minutes.` };
  const forecast = parseMetOfficeHourly(await res.json(), now);
  return forecast ? { forecast } : { error: "The Met Office reply had no wind forecast for the next few hours." };
}
