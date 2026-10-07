// Flight planning: a lawn-mower grid for mapping, and an angled orbit for walls and roofs.

import { MINI_4_PRO, footprintM, gsdCm, type CameraSpec } from "./camera.ts";
import {
  bearingDeg,
  distanceM,
  fromLocal,
  normaliseDeg,
  rotate,
  toLocal,
  type LatLng,
  type Vec2,
} from "./geo.ts";
import type { Mission, MissionEstimate, Waypoint } from "./mission.ts";

/** Pause at each photo waypoint to stop, steady and shoot. */
const PHOTO_PAUSE_S = 2;

export type GridSettings = {
  /** Height above take-off point, metres. */
  altitudeM: number;
  /** Overlap between photos along a line, 0–1. */
  frontOverlap: number;
  /** Overlap between neighbouring lines, 0–1. */
  sideOverlap: number;
  speedMs: number;
  /** Compass direction of the flight lines. Defaults to the boundary's longest side. */
  lineBearingDeg?: number;
  camera: CameraSpec;
};

export const DEFAULT_GRID: GridSettings = {
  altitudeM: 30,
  frontOverlap: 0.8,
  sideOverlap: 0.7,
  speedMs: 4,
  camera: MINI_4_PRO,
};

export function planGrid(boundary: LatLng[], overrides: Partial<GridSettings> = {}): Mission {
  const s = { ...DEFAULT_GRID, ...overrides };
  if (boundary.length < 3) throw new Error("Boundary needs at least 3 corners");
  if (s.frontOverlap < 0 || s.frontOverlap >= 1 || s.sideOverlap < 0 || s.sideOverlap >= 1) {
    throw new Error("Overlap must be between 0 and 1");
  }

  const origin = boundary[0];
  const bearing = s.lineBearingDeg ?? longestEdgeBearing(boundary);
  // Rotate the boundary so that flight lines run along +x.
  const alpha = Math.atan2(Math.cos(bearing * (Math.PI / 180)), Math.sin(bearing * (Math.PI / 180)));
  const pts = boundary.map((p) => rotate(toLocal(origin, p), -alpha));

  const fp = footprintM(s.camera, s.altitudeM);
  const lineSpacing = fp.width * (1 - s.sideOverlap);
  const photoSpacing = fp.height * (1 - s.frontOverlap);

  const minY = Math.min(...pts.map((p) => p.y));
  const maxY = Math.max(...pts.map((p) => p.y));
  const lineCount = Math.max(1, Math.ceil((maxY - minY) / lineSpacing));
  const stripWidth = (maxY - minY) / lineCount;

  const waypoints: Waypoint[] = [];
  for (let i = 0; i < lineCount; i++) {
    const y = minY + (i + 0.5) * stripWidth;
    const xs = crossings(pts, y);
    if (xs.length < 2) continue;
    const x0 = Math.min(...xs);
    const x1 = Math.max(...xs);
    const shots = Math.max(1, Math.ceil((x1 - x0) / photoSpacing));
    const line: Vec2[] = [];
    for (let k = 0; k <= shots; k++) line.push({ x: x0 + ((x1 - x0) * k) / shots, y });
    if (i % 2 === 1) line.reverse();
    const heading = i % 2 === 1 ? normaliseDeg(bearing + 180) : bearing;
    for (const v of line) {
      waypoints.push({
        index: waypoints.length,
        position: fromLocal(origin, rotate(v, alpha)),
        altitudeM: s.altitudeM,
        photo: true,
        gimbalPitchDeg: -90,
        headingDeg: heading,
      });
    }
  }

  const estimate = estimateMission(waypoints, s.speedMs);
  estimate.gsdCm = gsdCm(s.camera, s.altitudeM);
  return { id: missionId("grid", waypoints), kind: "grid", speedMs: s.speedMs, waypoints, estimate };
}

export type OrbitSettings = {
  center: LatLng;
  radiusM: number;
  altitudeM: number;
  photoCount: number;
  /** Camera tilt, e.g. -45 for a roof seen at an angle. */
  gimbalPitchDeg: number;
  speedMs: number;
  /** Fly only part of the circle (e.g. one half of a semi-detached roof). Degrees, clockwise from startBearingDeg. */
  arcDeg: number;
  startBearingDeg: number;
};

export function planOrbit(o: Partial<OrbitSettings> & Pick<OrbitSettings, "center" | "radiusM">): Mission {
  const s: OrbitSettings = {
    altitudeM: 20,
    photoCount: 24,
    gimbalPitchDeg: -45,
    speedMs: 3,
    arcDeg: 360,
    startBearingDeg: 0,
    ...o,
  };
  if (s.radiusM <= 0) throw new Error("Orbit radius must be positive");
  const full = s.arcDeg >= 360;
  const steps = full ? s.photoCount : Math.max(1, s.photoCount - 1);
  const waypoints: Waypoint[] = [];
  for (let i = 0; i < s.photoCount; i++) {
    const b = normaliseDeg(s.startBearingDeg + (Math.min(s.arcDeg, 360) * i) / steps);
    const rad = b * (Math.PI / 180);
    const position = fromLocal(s.center, { x: Math.sin(rad) * s.radiusM, y: Math.cos(rad) * s.radiusM });
    waypoints.push({
      index: i,
      position,
      altitudeM: s.altitudeM,
      photo: true,
      gimbalPitchDeg: s.gimbalPitchDeg,
      headingDeg: normaliseDeg(b + 180), // face the centre
    });
  }
  return {
    id: missionId("orbit", waypoints),
    kind: "orbit",
    speedMs: s.speedMs,
    waypoints,
    estimate: estimateMission(waypoints, s.speedMs),
  };
}

function estimateMission(waypoints: Waypoint[], speedMs: number): MissionEstimate {
  let pathLengthM = 0;
  for (let i = 1; i < waypoints.length; i++) {
    pathLengthM += distanceM(waypoints[i - 1].position, waypoints[i].position);
  }
  const photoCount = waypoints.filter((w) => w.photo).length;
  return { photoCount, pathLengthM, durationS: pathLengthM / speedMs + photoCount * PHOTO_PAUSE_S };
}

function longestEdgeBearing(polygon: LatLng[]): number {
  let best = 0;
  let bearing = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const d = distanceM(a, b);
    if (d > best) {
      best = d;
      bearing = bearingDeg(a, b);
    }
  }
  return bearing;
}

/** x positions where the horizontal line at y crosses the polygon's edges. */
function crossings(pts: Vec2[], y: number): number[] {
  const xs: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    if (a.y > y !== b.y > y) xs.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
  }
  return xs;
}

function missionId(kind: string, waypoints: Waypoint[]): string {
  // FNV-1a over the waypoint list: the same plan always gets the same id, so progress can be matched.
  const text = JSON.stringify(waypoints);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${kind}-${(h >>> 0).toString(16).padStart(8, "0")}`;
}
