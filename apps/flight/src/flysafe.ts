// DJI FlySafe (GEO) no-fly zones round the take-off point, from the DJI SDK's own database on the
// phone, kept for 6 hours per place. The pre-flight check (flight-core) decides what they mean.

import type { LatLng } from "../../../packages/flight-core/src/geo.ts";
import type { NoFlyZone } from "../../../packages/flight-core/src/safety.ts";
import { DjiDrone } from "../modules/dji-drone";
import { flyZonesFromDji } from "../modules/dji-drone/src/flyZones.ts";

import { placeCache } from "./placeCache";

type FlyZoneResult = { zones: NoFlyZone[] } | { error: string };

// A failed lookup is asked again after a minute.
const flyZones = placeCache<NoFlyZone[]>({
  keepMs: 6 * 60 * 60 * 1000,
  samePlaceM: 200,
  retryAfterErrorMs: 60_000,
  load: async (pos) => flyZonesFromDji(await DjiDrone.getFlyZones(pos.lat, pos.lng)),
});

/** The zones for this place, if they were looked up recently enough; a failure since then wins. */
export function currentFlyZones(pos: LatLng | null): FlyZoneResult | null {
  const error = flyZones.error(pos);
  if (error !== null) return { error };
  const zones = flyZones.current(pos);
  return zones ? { zones } : null;
}

export const refreshFlyZones = (pos: LatLng) => flyZones.refresh(pos);

/** Look the zones up for this place if needed, and redraw when the answer arrives. */
export function useFlyZones(pos: LatLng | null): { result: FlyZoneResult | null; loading: boolean } {
  const { loading } = flyZones.use(pos);
  return { result: currentFlyZones(pos), loading };
}
