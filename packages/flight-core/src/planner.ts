// Flight planning: a lawn-mower grid for mapping, and an angled orbit for walls and roofs.

import { MINI_4_PRO, footprintM, gsdCm, type CameraSpec } from "./camera.ts";
import {
  bearingDeg,
  centroid,
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
  /** Overlap between neighbouring lines, 0–1. Only used when lineSpacingM is not set. */
  sideOverlap: number;
  /** Distance between neighbouring passes, metres. When set, it decides the spacing instead of sideOverlap. */
  lineSpacingM?: number;
  /** Passes run across the area (at right angles to its longest side) or along it. */
  direction: "across" | "along";
  speedMs: number;
  /** Exact compass direction of the passes; overrides `direction`. */
  lineBearingDeg?: number;
  /** First and last passes run along the boundary edges, the rest evenly between, at most lineSpacingM apart. */
  edgeToEdge?: boolean;
  /** Distance between photos along a pass. Defaults to what frontOverlap needs. */
  photoSpacingM?: number;
  camera: CameraSpec;
};

/** Passes closer than this would mean a very long flight for no gain. */
export const MIN_LINE_SPACING_M = 1;
/** Side overlap below this leaves gaps that photogrammetry cannot join. */
export const MIN_SIDE_OVERLAP = 0.6;

export const DEFAULT_GRID: GridSettings = {
  altitudeM: 20,
  frontOverlap: 0.75,
  sideOverlap: 0.75,
  // Passes across the garden, about 10 ft apart.
  lineSpacingM: 3,
  direction: "across",
  speedMs: 4,
  camera: MINI_4_PRO,
};

export function planGrid(boundary: LatLng[], overrides: Partial<GridSettings> = {}): Mission {
  const s = { ...DEFAULT_GRID, ...overrides };
  if (boundary.length < 3) throw new Error("Boundary needs at least 3 corners");
  if (s.frontOverlap < 0 || s.frontOverlap >= 1 || s.sideOverlap < 0 || s.sideOverlap >= 1) {
    throw new Error("Overlap must be between 0 and 1");
  }
  if (s.lineSpacingM !== undefined && !(s.lineSpacingM >= MIN_LINE_SPACING_M)) {
    throw new Error(`Passes must be at least ${MIN_LINE_SPACING_M} m apart`);
  }

  const origin = boundary[0];
  const bearing =
    s.lineBearingDeg ?? normaliseDeg(longestEdgeBearing(boundary) + (s.direction === "across" ? 90 : 0));
  // Rotate the boundary so that flight lines run along +x.
  const alpha = Math.atan2(Math.cos(bearing * (Math.PI / 180)), Math.sin(bearing * (Math.PI / 180)));
  const pts = boundary.map((p) => rotate(toLocal(origin, p), -alpha));

  const fp = footprintM(s.camera, s.altitudeM);
  const photoSpacing = s.photoSpacingM ?? fp.height * (1 - s.frontOverlap);

  const minY = Math.min(...pts.map((p) => p.y));
  const maxY = Math.max(...pts.map((p) => p.y));
  const width = maxY - minY;
  // Where each pass runs, measured across the area.
  let lineYs: number[];
  let spacing: number;
  if (s.lineSpacingM !== undefined && s.edgeToEdge) {
    // Passes on both edges and evenly between. Kept a few centimetres inside so they never cross it.
    const inset = 0.05;
    const span = Math.max(0, width - 2 * inset);
    const count = Math.ceil(span / s.lineSpacingM) + 1;
    spacing = count > 1 ? span / (count - 1) : 0;
    lineYs = Array.from({ length: count }, (_, i) => minY + inset + i * spacing);
  } else if (s.lineSpacingM !== undefined) {
    // Exactly the requested distance apart, centred on the area.
    spacing = s.lineSpacingM;
    const count = Math.floor(width / spacing) + 1;
    const first = minY + (width - (count - 1) * spacing) / 2;
    lineYs = Array.from({ length: count }, (_, i) => first + i * spacing);
  } else {
    const count = Math.max(1, Math.ceil(width / (fp.width * (1 - s.sideOverlap))));
    spacing = width / count;
    lineYs = Array.from({ length: count }, (_, i) => minY + (i + 0.5) * spacing);
  }

  const waypoints: Waypoint[] = [];
  for (let i = 0; i < lineYs.length; i++) {
    const y = lineYs[i];
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
  estimate.passCount = lineYs.length;
  estimate.lineSpacingM = spacing;
  estimate.sideOverlap = lineYs.length > 1 ? 1 - spacing / fp.width : 1;
  estimate.maxLineSpacingM = fp.width * (1 - MIN_SIDE_OVERLAP);
  return { id: missionId("grid", waypoints), kind: "grid", speedMs: s.speedMs, waypoints, estimate };
}

export type SurveySettings = {
  altitudeM: number;
  /** Photo overlap, 0–1. Sets both the gap between passes and between photos. */
  overlap: number;
  speedMs: number;
  /** After the passes, a lap round the edge of the plot with the camera tilted to look in. */
  edgeLap: boolean;
  edgePhotoCount: number;
  edgeGimbalPitchDeg: number;
};

export const DEFAULT_SURVEY: SurveySettings = { altitudeM: 20, overlap: 0.75, speedMs: 4, edgeLap: false, edgePhotoCount: 24, edgeGimbalPitchDeg: -60 };

/** The garden survey's fixed pattern, from the prototype: gaps between passes and between photos. */
export function surveySpacing(altitudeM: number, overlap: number): { passM: number; photoM: number } {
  return {
    passM: Math.max(MIN_LINE_SPACING_M, 0.75 * altitudeM * (1 - overlap)),
    photoM: Math.max(0.5, 0.5 * altitudeM * (1 - overlap)),
  };
}

/**
 * The garden survey, fixed to the prototype's flight plan: passes straight across the plot,
 * front to back, the first and last along the end boundaries and the rest evenly between,
 * flown back and forth. Optionally followed by a lap round the edge with the camera tilted, to
 * capture walls, steps and tree heights. Every point stays inside the boundary. The drone takes off
 * from the home point and, when the scan is done, its own Return to Home lands it back there.
 */
export function planSurvey(boundary: LatLng[], overrides: Partial<SurveySettings> = {}): Mission {
  const s = { ...DEFAULT_SURVEY, ...overrides };
  const gap = surveySpacing(s.altitudeM, s.overlap);
  const grid = planGrid(boundary, {
    altitudeM: s.altitudeM,
    frontOverlap: s.overlap,
    sideOverlap: s.overlap,
    lineSpacingM: gap.passM,
    photoSpacingM: gap.photoM,
    edgeToEdge: true,
    direction: "across",
    speedMs: s.speedMs,
  });
  if (!s.edgeLap) return grid;

  const middle = centroid(boundary);
  const edges = boundary.map((a, i) => {
    const b = boundary[(i + 1) % boundary.length];
    return { a, b, len: distanceM(a, b) };
  });
  const perimeter = edges.reduce((t, e) => t + e.len, 0);
  // Start the lap at the corner nearest the end of the passes, so there is no long transit.
  const last = grid.waypoints[grid.waypoints.length - 1].position;
  const first = boundary.reduce((best, p, i) => (distanceM(p, last) < distanceM(boundary[best], last) ? i : best), 0);
  const waypoints = [...grid.waypoints];
  for (let k = 0; k < s.edgePhotoCount; k++) {
    let d = (perimeter * k) / s.edgePhotoCount;
    let i = first;
    while (d > edges[i % edges.length].len) {
      d -= edges[i % edges.length].len;
      i++;
    }
    const e = edges[i % edges.length];
    const v = toLocal(e.a, e.b);
    const position = fromLocal(e.a, { x: (v.x * d) / e.len, y: (v.y * d) / e.len });
    waypoints.push({
      index: waypoints.length,
      position,
      altitudeM: s.altitudeM,
      photo: true,
      gimbalPitchDeg: s.edgeGimbalPitchDeg,
      headingDeg: bearingDeg(position, middle),
    });
  }
  const mission = buildMission("grid", waypoints, s.speedMs);
  mission.estimate = { ...grid.estimate, ...mission.estimate };
  return mission;
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
  return buildMission("orbit", waypoints, s.speedMs);
}

/** A mission from a list of waypoints, with its id and time estimate. */
export function buildMission(kind: Mission["kind"], waypoints: Waypoint[], speedMs: number): Mission {
  return { id: missionId(kind, waypoints), kind, speedMs, waypoints, estimate: estimateMission(waypoints, speedMs) };
}

function estimateMission(waypoints: Waypoint[], speedMs: number): MissionEstimate {
  let pathLengthM = 0;
  for (let i = 1; i < waypoints.length; i++) {
    const a = waypoints[i - 1];
    const b = waypoints[i];
    pathLengthM += Math.hypot(distanceM(a.position, b.position), a.altitudeM - b.altitudeM);
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
