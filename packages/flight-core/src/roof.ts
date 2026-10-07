// Roof scan: the drone circles the house twice, first higher up, then closer to the ridge,
// taking angled close-ups of every slope, the ridge, chimney and gutters.
// On a semi-detached house the circles pass over next door's roof; only the owner's half is reported.

import { centroid, convexHull, distanceM, normaliseDeg, type LatLng } from "./geo.ts";
import type { Mission, Waypoint } from "./mission.ts";
import { buildMission, planOrbit } from "./planner.ts";

/** Closest the circle may come to the roof outline, seen from above, metres. */
export const MIN_ROOF_DISTANCE_M = 2;
/** Lowest the drone may fly above the ridge, metres. */
export const MIN_HEIGHT_ABOVE_RIDGE_M = 3;
/** Gap the drone keeps above the chimney, aerials and cables, metres. */
export const MIN_CHIMNEY_CLEARANCE_M = 2;

export type RoofScanInput = {
  /** Outline of the owner's half of the roof, seen from above. */
  roof: LatLng[];
  /** Ridge height above the take-off point, metres. */
  ridgeHeightM: number;
  /** Top of the chimney or aerial, above the take-off point. Defaults to 1 m above the ridge. */
  chimneyTopM?: number;
  home: LatLng;
  /** Compass direction of the side of the house that is not joined to the neighbour. Each circle starts there. */
  openSideBearingDeg: number;
  distanceFromRoofM?: number;
  /** One circle per height, highest first. */
  heightsAboveRidgeM?: number[];
  photosPerOrbit?: number;
  speedMs?: number;
};

export type RoofOrbit = { altitudeM: number; heightAboveRidgeM: number; gimbalPitchDeg: number };

export type RoofScan = {
  mission: Mission;
  /** Where the drone is allowed to be for this flight: around the circles, the house and the home point. */
  flightArea: LatLng[];
  center: LatLng;
  radiusM: number;
  orbits: RoofOrbit[];
};

export const DEFAULT_ROOF_HEIGHTS_M = [6, 3];

export function planRoofScan(input: RoofScanInput): RoofScan {
  const distanceFromRoofM = input.distanceFromRoofM ?? 2;
  const heights = input.heightsAboveRidgeM ?? DEFAULT_ROOF_HEIGHTS_M;
  const photosPerOrbit = input.photosPerOrbit ?? 24;
  const chimneyTopM = input.chimneyTopM ?? input.ridgeHeightM + 1;
  if (input.roof.length < 3) throw new Error("Roof outline needs at least 3 corners");
  if (heights.length === 0) throw new Error("The roof scan needs at least one circle");
  if (distanceFromRoofM < MIN_ROOF_DISTANCE_M) {
    throw new Error(`Keep at least ${MIN_ROOF_DISTANCE_M} m from the roof`);
  }
  for (const h of heights) {
    if (h < MIN_HEIGHT_ABOVE_RIDGE_M) throw new Error(`Fly at least ${MIN_HEIGHT_ABOVE_RIDGE_M} m above the ridge`);
    if (input.ridgeHeightM + h < chimneyTopM + MIN_CHIMNEY_CLEARANCE_M) {
      throw new Error(`Fly at least ${MIN_CHIMNEY_CLEARANCE_M} m above the chimney and aerials`);
    }
  }

  const center = centroid(input.roof);
  // Every point on this circle is at least distanceFromRoofM from every part of the roof.
  const radiusM = Math.max(...input.roof.map((p) => distanceM(center, p))) + distanceFromRoofM;
  // Aim the camera at the middle of the roof slope, a little below the ridge.
  const aimHeight = input.ridgeHeightM * 0.8;

  const orbits: RoofOrbit[] = [];
  const waypoints: Waypoint[] = [];
  for (const h of heights) {
    const altitudeM = input.ridgeHeightM + h;
    const gimbalPitchDeg = -Math.round((Math.atan2(altitudeM - aimHeight, radiusM) * 180) / Math.PI);
    orbits.push({ altitudeM, heightAboveRidgeM: h, gimbalPitchDeg });
    const orbit = planOrbit({
      center,
      radiusM,
      altitudeM,
      photoCount: photosPerOrbit,
      gimbalPitchDeg,
      speedMs: input.speedMs ?? 2,
      arcDeg: 360,
      startBearingDeg: normaliseDeg(input.openSideBearingDeg),
    });
    for (const w of orbit.waypoints) waypoints.push({ ...w, index: waypoints.length });
  }

  const mission = buildMission("orbit", waypoints, input.speedMs ?? 2);
  const flightArea = convexHull([...waypoints.map((w) => w.position), ...input.roof, input.home]);
  return { mission, flightArea, center, radiusM, orbits };
}
