// DJI FlySafe (GEO) no-fly zones round the take-off point, from the DJI SDK's own database on the
// phone, kept for 6 hours per place. The pre-flight check (flight-core) decides what they mean.

import { useEffect, useReducer } from "react";

import { distanceM, type LatLng } from "../../../packages/flight-core/src/geo.ts";
import type { NoFlyZone } from "../../../packages/flight-core/src/safety.ts";
import { DjiDrone } from "../modules/dji-drone";
import { flyZonesFromDji } from "../modules/dji-drone/src/flyZones.ts";

export type FlyZoneResult = { zones: NoFlyZone[] } | { error: string };

const KEEP_MS = 6 * 60 * 60 * 1000;
const SAME_PLACE_M = 200;

let latest: { at: number; pos: LatLng; result: FlyZoneResult } | null = null;
let loading = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** The zones for this place, if they were looked up recently enough. */
export function currentFlyZones(pos: LatLng | null): FlyZoneResult | null {
  if (!latest || !pos) return null;
  if (Date.now() - latest.at > KEEP_MS || distanceM(latest.pos, pos) > SAME_PLACE_M) return null;
  return latest.result;
}

export async function refreshFlyZones(pos: LatLng): Promise<void> {
  if (loading) return;
  loading = true;
  emit();
  try {
    const zones = await DjiDrone.getFlyZones(pos.lat, pos.lng);
    latest = { at: Date.now(), pos, result: { zones: flyZonesFromDji(zones) } };
  } catch (e) {
    latest = { at: Date.now(), pos, result: { error: (e as Error).message } };
  } finally {
    loading = false;
    emit();
  }
}

/** Look the zones up for this place if needed, and redraw when the answer arrives. */
export function useFlyZones(pos: LatLng | null): { result: FlyZoneResult | null; loading: boolean } {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    listeners.add(bump);
    return () => {
      listeners.delete(bump);
    };
  }, []);
  const result = currentFlyZones(pos);
  useEffect(() => {
    // An error is tried again after a minute.
    const stale = !latest || (latest.result && "error" in latest.result && latest.at < Date.now() - 60_000);
    if (pos && !loading && (!result || stale)) refreshFlyZones(pos);
  }, [pos?.lat, pos?.lng, result]);
  return { result, loading };
}
