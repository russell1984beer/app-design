// The Met Office wind forecast for the take-off point, fetched when needed and kept for 30 minutes
// (the free plan allows 360 requests a day). The key comes from .env at build time.

import { useEffect, useReducer } from "react";

import { distanceM, type LatLng } from "../../../packages/flight-core/src/geo.ts";
import { fetchMetOfficeWind, type ForecastResult } from "../../../packages/flight-core/src/weather.ts";

const API_KEY = process.env.EXPO_PUBLIC_METOFFICE_API_KEY ?? "";
const KEEP_MS = 30 * 60 * 1000;

type Entry = { at: number; pos: LatLng; result: ForecastResult };

let latest: Entry | null = null;
let loading = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const hasForecastKey = () => API_KEY.length > 0;

/** The forecast for this place, if one was fetched in the last 30 minutes within 1 km. */
export function currentForecast(pos: LatLng | null): ForecastResult | null {
  if (!latest || !pos) return null;
  if (Date.now() - latest.at > KEEP_MS || distanceM(latest.pos, pos) > 1000) return null;
  return latest.result;
}

export async function refreshForecast(pos: LatLng): Promise<void> {
  if (loading) return;
  loading = true;
  emit();
  try {
    const result = await fetchMetOfficeWind(pos, API_KEY, (url, init) => fetch(url, init));
    latest = { at: Date.now(), pos, result };
  } finally {
    loading = false;
    emit();
  }
}

/** Fetch the forecast for this place if there is no fresh one, and redraw when it arrives. */
export function useForecast(pos: LatLng | null): { result: ForecastResult | null; loading: boolean } {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    listeners.add(bump);
    return () => {
      listeners.delete(bump);
    };
  }, []);
  const result = currentForecast(pos);
  useEffect(() => {
    if (pos && !result && !loading && (!latest || latest.at < Date.now() - 60_000 || distanceM(latest.pos, pos) > 1000)) refreshForecast(pos);
  }, [pos?.lat, pos?.lng, result]);
  return { result, loading };
}
