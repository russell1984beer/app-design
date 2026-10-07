// Roof scan: an angled half-orbit around the owner's half of a semi-detached roof.
// The arc stays on the open side of the house, so the drone never crosses the neighbour's half.

import { centroid, convexHull, distanceM, normaliseDeg, type LatLng } from "./geo.ts";
import type { Mission } from "./mission.ts";
import { planOrbit } from "./planner.ts";

/** Closest the drone may fly to any part of the roof, metres. */
export const MIN_ROOF_DISTANCE_M = 4;
/** Lowest the drone may fly above the ridge, metres. */
export const MIN_HEIGHT_ABOVE_RIDGE_M = 3;

export type RoofScanInput = {
  /** Outline of the owner's half of the roof, seen from above. */
  roof: LatLng[];
  /** Ridge height above the take-off point, metres. */
  ridgeHeightM: number;
  home: LatLng;
  /** Compass direction of the side of the house that is not joined to the neighbour. The arc is centred on it. */
  openSideBearingDeg: number;
  distanceFromRoofM?: number;
  heightAboveRidgeM?: number;
  photoCount?: number;
  /** How far round the house to fly, degrees. 180 goes from the front, round the open side, to the back. */
  arcDeg?: number;
  speedMs?: number;
};

export type RoofScan = {
  mission: Mission;
  /** Where the drone is allowed to be for this flight: around the arc, the house and the home point. */
  flightArea: LatLng[];
  center: LatLng;
  radiusM: number;
  altitudeM: number;
  gimbalPitchDeg: number;
};

export function planRoofScan(input: RoofScanInput): RoofScan {
  const distanceFromRoofM = input.distanceFromRoofM ?? 6;
  const heightAboveRidgeM = input.heightAboveRidgeM ?? 5;
  const arcDeg = input.arcDeg ?? 180;
  if (input.roof.length < 3) throw new Error("Roof outline needs at least 3 corners");
  if (distanceFromRoofM < MIN_ROOF_DISTANCE_M) {
    throw new Error(`Keep at least ${MIN_ROOF_DISTANCE_M} m from the roof`);
  }
  if (heightAboveRidgeM < MIN_HEIGHT_ABOVE_RIDGE_M) {
    throw new Error(`Fly at least ${MIN_HEIGHT_ABOVE_RIDGE_M} m above the ridge`);
  }

  const center = centroid(input.roof);
  // Every point on this circle is at least distanceFromRoofM from every part of the roof.
  const radiusM = Math.max(...input.roof.map((p) => distanceM(center, p))) + distanceFromRoofM;
  const altitudeM = input.ridgeHeightM + heightAboveRidgeM;
  // Aim the camera at the middle of the roof slope, a little below the ridge.
  const aimHeight = input.ridgeHeightM * 0.8;
  const gimbalPitchDeg = -Math.round((Math.atan2(altitudeM - aimHeight, radiusM) * 180) / Math.PI);

  const mission = planOrbit({
    center,
    radiusM,
    altitudeM,
    photoCount: input.photoCount ?? 15,
    gimbalPitchDeg,
    speedMs: input.speedMs ?? 2,
    arcDeg,
    startBearingDeg: normaliseDeg(input.openSideBearingDeg - Math.min(arcDeg, 360) / 2),
  });
  const flightArea = convexHull([...mission.waypoints.map((w) => w.position), ...input.roof, input.home]);
  return { mission, flightArea, center, radiusM, altitudeM, gimbalPitchDeg };
}
