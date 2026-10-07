// Flight planning: a lawn-mower or criss-cross grid for mapping, and an angled orbit for walls and roofs.

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
  /** Overlap between neighbouring lines, 0–1. Only used when lineSpacingM is not set. */
  sideOverlap: number;
  /** Distance between neighbouring passes, metres. When set, it decides the spacing instead of sideOverlap. */
  lineSpacingM?: number;
  /** Passes run across the area (at right angles to its longest side) or along it. */
  direction: "across" | "along";
  /** One set of passes, or a criss-cross: the set above, then a second set at right angles to it. */
  pattern: "single" | "crisscross";
  speedMs: number;
  /** Exact compass direction of the passes; overrides `direction`. */
  lineBearingDeg?: number;
  camera: CameraSpec;
};

/** Passes closer than this would mean a very long flight for no gain. */
export const MIN_LINE_SPACING_M = 1;
/** Side overlap below this leaves gaps that photogrammetry cannot join. */
export const MIN_SIDE_OVERLAP = 0.6;

export const DEFAULT_GRID: GridSettings = {
  altitudeM: 30,
  frontOverlap: 0.8,
  sideOverlap: 0.7,
  // Passes across the garden, about 10 ft apart.
  lineSpacingM: 3,
  direction: "across",
  pattern: "crisscross",
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

  const fp = footprintM(s.camera, s.altitudeM);
  const firstBearing =
    s.lineBearingDeg ?? normaliseDeg(longestEdgeBearing(boundary) + (s.direction === "across" ? 90 : 0));
  const bearings = s.pattern === "crisscross" ? [firstBearing, normaliseDeg(firstBearing + 90)] : [firstBearing];

  const waypoints: Waypoint[] = [];
  let passCount = 0;
  let spacing = 0;
  for (const bearing of bearings) {
    const set = planPasses(boundary, bearing, s);
    passCount += set.passes.length;
    spacing = Math.max(spacing, set.spacing);
    // Join each set on from wherever the last one finished, by the shortest route.
    const last = waypoints[waypoints.length - 1]?.position;
    for (const { position, headingDeg } of snake(set.passes, bearing, last)) {
      waypoints.push({ index: waypoints.length, position, altitudeM: s.altitudeM, photo: true, gimbalPitchDeg: -90, headingDeg });
    }
  }

  const estimate = estimateMission(waypoints, s.speedMs);
  estimate.gsdCm = gsdCm(s.camera, s.altitudeM);
  estimate.passCount = passCount;
  estimate.lineSpacingM = spacing;
  estimate.sideOverlap = passCount > bearings.length ? 1 - spacing / fp.width : 1;
  estimate.maxLineSpacingM = fp.width * (1 - MIN_SIDE_OVERLAP);
  return { id: missionId("grid", waypoints), kind: "grid", speedMs: s.speedMs, waypoints, estimate };
}

/** Parallel passes over the area along one compass bearing. Each pass's photo points run in that direction. */
function planPasses(boundary: LatLng[], bearing: number, s: GridSettings): { passes: LatLng[][]; spacing: number } {
  const origin = boundary[0];
  // Rotate the boundary so that the passes run along +x.
  const alpha = Math.atan2(Math.cos(bearing * (Math.PI / 180)), Math.sin(bearing * (Math.PI / 180)));
  const pts = boundary.map((p) => rotate(toLocal(origin, p), -alpha));
  const fp = footprintM(s.camera, s.altitudeM);
  const photoSpacing = fp.height * (1 - s.frontOverlap);

  const minY = Math.min(...pts.map((p) => p.y));
  const maxY = Math.max(...pts.map((p) => p.y));
  const width = maxY - minY;
  // Where each pass runs, measured across the area.
  let lineYs: number[];
  let spacing: number;
  if (s.lineSpacingM !== undefined) {
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

  const passes: LatLng[][] = [];
  for (const y of lineYs) {
    const xs = crossings(pts, y);
    if (xs.length < 2) continue;
    const x0 = Math.min(...xs);
    const x1 = Math.max(...xs);
    const shots = Math.max(1, Math.ceil((x1 - x0) / photoSpacing));
    const pass: LatLng[] = [];
    for (let k = 0; k <= shots; k++) pass.push(fromLocal(origin, rotate({ x: x0 + ((x1 - x0) * k) / shots, y }, alpha)));
    passes.push(pass);
  }
  return { passes, spacing };
}

/**
 * Fly the passes back and forth (lawn-mower). Of the four ways to do that, start at the corner
 * nearest `from`, so a second set of passes joins on without a long trip.
 */
function snake(passes: LatLng[][], bearing: number, from?: LatLng): { position: LatLng; headingDeg: number }[] {
  const options: { position: LatLng; headingDeg: number }[][] = [];
  for (const reverseOrder of [false, true]) {
    for (const flipFirst of [false, true]) {
      const ordered = reverseOrder ? [...passes].reverse() : passes;
      const route: { position: LatLng; headingDeg: number }[] = [];
      ordered.forEach((pass, i) => {
        const backwards = (i % 2 === 1) !== flipFirst;
        const headingDeg = backwards ? normaliseDeg(bearing + 180) : bearing;
        for (const position of backwards ? [...pass].reverse() : pass) route.push({ position, headingDeg });
      });
      options.push(route);
    }
  }
  if (!from) return options[0];
  return options.reduce((best, r) =>
    r.length && distanceM(from, r[0].position) < distanceM(from, best[0].position) ? r : best,
  );
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
