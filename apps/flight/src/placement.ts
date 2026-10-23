// Placing a real flight: from the plot lined up on the title plan when there is one (its far-left
// corner marked on the satellite map), otherwise from the drone sitting on the take-off point.
// No React Native here, so the tests can run it.

import { distanceM, fromLocal, toLocal, type LatLng } from "../../../packages/flight-core/src/geo.ts";
import type { CheckItem } from "../../../packages/flight-core/src/safety.ts";
import { eastNorthToPlan, planToEastNorth, type Plot, type Pt } from "../../../packages/garden-core/src/index.ts";

/**
 * Further than this from the take-off point on the plan: warn. The same limits apply to the LIDAR
 * check of where the house shows up (flight.ts), since both mean every route would be shifted.
 */
export const TAKEOFF_WARN_M = 2.5;
/**
 * Further than this: no take-off. The drone climbs straight up where it stands before flying the
 * plan, and comes home to where it took off, so a small gap is safe; a big one means it is in the
 * wrong place (or the GPS is not settled yet).
 */
export const TAKEOFF_BLOCK_M = 5;

/** A plan point's GPS position, from the plot's far-left corner (plan 0, 0) as marked on the title plan. */
export function planPointFromCorner(plot: Plot, farLeft: LatLng, p: Pt): LatLng {
  const en = planToEastNorth(plot, [0, 0], p);
  return fromLocal(farLeft, { x: en.east, y: en.north });
}

/** Is the drone on the take-off point the plan puts at `planHome`? A pre-flight check item. */
export function takeoffSpotCheck(drone: LatLng, planHome: LatLng): CheckItem {
  const d = distanceM(drone, planHome);
  const m = `${d.toFixed(1)} m`;
  if (d > TAKEOFF_BLOCK_M)
    return {
      id: "takeoffSpot",
      status: "block",
      message: `The drone is ${m} from the take-off point on the plan. Carry it to the yellow point (or wait a minute for its GPS to settle).`,
    };
  if (d > TAKEOFF_WARN_M)
    return { id: "takeoffSpot", status: "warn", message: `The drone is ${m} from the take-off point on the plan. Check it is standing on the marked spot.` };
  return { id: "takeoffSpot", status: "pass", message: `The drone is on the take-off point (${m} away, within GPS accuracy).` };
}

/** What placing a plan point needs: the plot and its take-off point on the plan. */
type PlanPlace = { plot: Plot; home: Pt };

/** A plan point as a GPS position, given the GPS position of the home point. */
export function planToGps(s: PlanPlace, anchor: LatLng, p: Pt): LatLng {
  const en = planToEastNorth(s.plot, s.home, p);
  return fromLocal(anchor, { x: en.east, y: en.north });
}

export function gpsToPlan(s: PlanPlace, anchor: LatLng, p: LatLng): Pt {
  const v = toLocal(anchor, p);
  return eastNorthToPlan(s.plot, s.home, { east: v.x, north: v.y });
}
