// The Met Office wind forecast for the take-off point, fetched when needed and kept for 30 minutes
// (the free plan allows 360 requests a day). The key comes from .env at build time.

import type { LatLng } from "../../../packages/flight-core/src/geo.ts";
import { fetchMetOfficeWind, type ForecastResult } from "../../../packages/flight-core/src/weather.ts";

import { placeCache } from "./placeCache";

const API_KEY = process.env.EXPO_PUBLIC_METOFFICE_API_KEY ?? "";

// The Met Office's own errors (no key, too many requests...) come back as the answer and are kept
// for the 30 minutes too, so they are not asked again by themselves; "Check the weather again" does.
const forecast = placeCache<ForecastResult>({
  keepMs: 30 * 60 * 1000,
  samePlaceM: 1000,
  retryAfterErrorMs: 60_000,
  load: (pos) => fetchMetOfficeWind(pos, API_KEY, (url, init) => fetch(url, init)),
});

export const hasForecastKey = () => API_KEY.length > 0;

/** The forecast for this place, if one was fetched in the last 30 minutes within 1 km. */
export const currentForecast = forecast.current;

export const refreshForecast = (pos: LatLng) => forecast.refresh(pos);

/** Fetch the forecast for this place if there is no fresh one, and redraw when it arrives. */
export function useForecast(pos: LatLng | null): { result: ForecastResult | null; loading: boolean } {
  const { value, loading } = forecast.use(pos);
  return { result: value, loading };
}
