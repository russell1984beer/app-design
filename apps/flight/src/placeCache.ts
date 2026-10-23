// One "look it up near here" cache, shared by the weather forecast, the DJI fly zones and the LIDAR.
// It keeps the latest answer and the latest failure, each with where and when it happened. A place
// counts as the same within samePlaceM, and an answer or failure is current for keepMs. After a
// failure, the screens ask again only once retryAfterErrorMs has passed. One lookup at a time.

import { useEffect, useReducer } from "react";

import { distanceM, type LatLng } from "../../../packages/flight-core/src/geo.ts";

type Stamp = { at: number; pos: LatLng };

export function placeCache<T, A extends unknown[] = []>(o: {
  keepMs: number;
  samePlaceM: number;
  retryAfterErrorMs: number;
  load: (pos: LatLng, ...args: A) => Promise<T>;
  /** For the tests. */
  now?: () => number;
}) {
  const now = o.now ?? Date.now;
  let latest: (Stamp & { value: T }) | null = null;
  // Cleared by the next answer, so a failure here is always newer than the answer.
  let failed: (Stamp & { error: string }) | null = null;
  let loading = false;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());
  const fits = (e: Stamp | null, pos: LatLng | null): boolean => !!e && !!pos && now() - e.at <= o.keepMs && distanceM(e.pos, pos) <= o.samePlaceM;

  /** The answer for this place, if there is a current one. */
  const current = (pos: LatLng | null): T | null => (fits(latest, pos) ? latest!.value : null);

  /** Why the last lookup for this place failed (since its last answer), or null. */
  const error = (pos: LatLng | null): string | null => (fits(failed, pos) ? failed!.error : null);

  /** Is a lookup due here: no answer, or the last one failed, and not straight after a failure. */
  function due(pos: LatLng): boolean {
    if (loading) return false;
    const failedHere = fits(failed, pos);
    if (current(pos) !== null && !failedHere) return false;
    return !failedHere || now() - failed!.at >= o.retryAfterErrorMs;
  }

  async function refresh(pos: LatLng, ...args: A): Promise<void> {
    if (loading) return;
    loading = true;
    emit();
    try {
      latest = { at: now(), pos, value: await o.load(pos, ...args) };
      failed = null;
    } catch (e) {
      failed = { at: now(), pos, error: e instanceof Error ? e.message : String(e) };
    } finally {
      loading = false;
      emit();
    }
  }

  /** An answer from elsewhere (a saved file, or a correction), for this place. */
  function set(pos: LatLng, value: T): void {
    latest = { at: now(), pos, value };
    emit();
  }

  /** Look it up for this place when due, and redraw when anything changes. */
  function use(pos: LatLng | null, ...args: A): { value: T | null; error: string | null; loading: boolean } {
    const [, bump] = useReducer((n: number) => n + 1, 0);
    useEffect(() => {
      listeners.add(bump);
      return () => {
        listeners.delete(bump);
      };
    }, []);
    const value = current(pos);
    const err = error(pos);
    useEffect(() => {
      if (pos && due(pos)) void refresh(pos, ...args);
    }, [pos?.lat, pos?.lng, value, err]);
    return { value, error: err, loading };
  }

  return {
    current,
    error,
    due,
    refresh,
    set,
    use,
    /** The latest answer wherever it was for. */
    latest: (): T | null => latest?.value ?? null,
    loading: () => loading,
  };
}
