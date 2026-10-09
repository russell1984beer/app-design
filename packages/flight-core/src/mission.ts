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
  /** Hover here this many seconds on arrival (before any photo), e.g. for checks on a first flight. */
  holdS?: number;
};

export type Mission = {
  id: string;
  kind: "grid" | "orbit" | "check";
  /** Cruise speed between waypoints, m/s. */
  speedMs: number;
  waypoints: Waypoint[];
  estimate: MissionEstimate;
  /** After the last waypoint: the drone's own Return to Home (default), or land straight down where it is. */
  endWith?: "returnHome" | "land";
};

export type MissionEstimate = {
  photoCount: number;
  pathLengthM: number;
  durationS: number;
  /** Ground sample distance (cm per pixel) at mission height, for grid missions. */
  gsdCm?: number;
  /** Grid missions: number of passes, distance between them, and the side overlap that gives. */
  passCount?: number;
  lineSpacingM?: number;
  sideOverlap?: number;
  /** Grid missions: widest pass spacing that still overlaps enough to join the photos. */
  maxLineSpacingM?: number;
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
