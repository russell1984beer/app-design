// The mission description: plain JSON that the Android module receives and flies.

import type { LatLng } from "./geo.ts";

export type Waypoint = {
  index: number;
  position: LatLng;
  /** Height above the take-off point, metres. */
  altitudeM: number;
  /** Take a photo on arrival. */
  photo: boolean;
  /** Camera tilt: -90 looks straight down, 0 looks at the horizon. */
  gimbalPitchDeg: number;
  /** Compass heading the drone should face; undefined keeps the current heading. */
  headingDeg?: number;
};

export type Mission = {
  id: string;
  kind: "grid" | "orbit";
  /** Cruise speed between waypoints, m/s. */
  speedMs: number;
  waypoints: Waypoint[];
  estimate: MissionEstimate;
};

export type MissionEstimate = {
  photoCount: number;
  pathLengthM: number;
  durationS: number;
  /** Ground sample distance (cm per pixel) at mission height, for grid missions. */
  gsdCm?: number;
};

/** Which photos of a mission are already done. Saved after every photo so a scan can resume. */
export type ScanProgress = {
  missionId: string;
  completedWaypoints: number[];
};

export function emptyProgress(mission: Mission): ScanProgress {
  return { missionId: mission.id, completedWaypoints: [] };
}

export function remainingWaypoints(mission: Mission, progress: ScanProgress): Waypoint[] {
  if (progress.missionId !== mission.id) {
    throw new Error(`Progress belongs to mission ${progress.missionId}, not ${mission.id}`);
  }
  const done = new Set(progress.completedWaypoints);
  return mission.waypoints.filter((w) => !done.has(w.index));
}
