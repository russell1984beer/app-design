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

/**
 * Shortest time between photos taken on the fly. The Mini 4 Pro's 48 MP photos take about 2 s to
 * save; a little more keeps the camera free for the next one. Runs are flown slowly enough for it.
 */
export const PHOTO_INTERVAL_S = 2.5;

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
  /**
   * Fly each pass in one smooth run, taking the photos along it without stopping (only the first and
   * last photo of a pass are taken at a stop), at runSpeedMs.
   */
  onTheFly?: boolean;
  /** Speed along a pass when photos are taken on the fly, m/s. Default: as fast as the camera keeps up. */
  runSpeedMs?: number;
  /** Exactly this many photos along each pass (first and last at its ends); overrides photoSpacingM. */
  photosPerPass?: number;
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
    const shots = s.photosPerPass ? Math.max(1, Math.round(s.photosPerPass) - 1) : Math.max(1, Math.ceil((x1 - x0) / photoSpacing));
    const line: Vec2[] = [];
    for (let k = 0; k <= shots; k++) line.push({ x: x0 + ((x1 - x0) * k) / shots, y });
    if (i % 2 === 1) line.reverse();
    const heading = i % 2 === 1 ? normaliseDeg(bearing + 180) : bearing;
    const runSpeed = s.runSpeedMs ?? runSpeedMs((x1 - x0) / shots, s.speedMs);
    line.forEach((v, k) => {
      const run = s.onTheFly && k > 0 ? { speedMs: runSpeed, ...(k < line.length - 1 ? { onTheFly: true } : {}) } : {};
      waypoints.push({
        index: waypoints.length,
        position: fromLocal(origin, rotate(v, alpha)),
        altitudeM: s.altitudeM,
        photo: true,
        gimbalPitchDeg: -90,
        headingDeg: heading,
        ...run,
      });
    });
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
  /** Photos along each run, chosen by the owner; undefined: the recommended number for the overlap. */
  photosPerRun?: number;
};

/** Fewer photos than this front overlap leaves gaps the survey cannot join. */
export const MIN_FRONT_OVERLAP = 0.6;
/** Photos closer than this would mean crawling along the runs (under 0.4 m/s). */
export const MIN_PHOTO_SPACING_M = 1;

/**
 * The choice of photos per run for the garden survey: the recommended number (from the overlap), and
 * the fewest (MIN_FRONT_OVERLAP) and most (MIN_PHOTO_SPACING_M) that make sense. Per run; multiply by
 * `runs` for the whole flight.
 */
export function surveyPhotoChoice(boundary: LatLng[], overrides: Partial<SurveySettings> = {}): { recommended: number; min: number; max: number; runs: number } {
  const s = { ...DEFAULT_SURVEY, ...overrides };
  const plan = planSurvey(boundary, { ...overrides, photosPerRun: undefined, edgeLap: false });
  const runs = plan.estimate.passCount ?? 1;
  const recommended = Math.round(plan.estimate.photoCount / runs);
  const runLengthM = distanceM(plan.waypoints[0].position, plan.waypoints[recommended - 1].position);
  const along = footprintM(MINI_4_PRO, s.altitudeM).height;
  const min = Math.min(recommended, Math.max(2, Math.ceil(runLengthM / (along * (1 - MIN_FRONT_OVERLAP))) + 1));
  const max = Math.max(recommended, Math.floor(runLengthM / MIN_PHOTO_SPACING_M) + 1);
  return { recommended, min, max, runs };
}

export const DEFAULT_SURVEY: SurveySettings = { altitudeM: 20, overlap: 0.75, speedMs: 4, edgeLap: false, edgePhotoCount: 24, edgeGimbalPitchDeg: -60 };

/** The garden survey's fixed pattern, from the prototype: gaps between passes and between photos. */
export function surveySpacing(altitudeM: number, overlap: number): { passM: number; photoM: number } {
  return {
    passM: Math.max(MIN_LINE_SPACING_M, 0.75 * altitudeM * (1 - overlap)),
    photoM: Math.max(0.5, 0.5 * altitudeM * (1 - overlap)),
  };
}

/** Speed along a survey run: as fast as the camera can keep up with the photo spacing. */
export function runSpeedMs(photoSpacingM: number, cruiseMs: number): number {
  return Math.min(cruiseMs, photoSpacingM / PHOTO_INTERVAL_S);
}

/**
 * The garden survey: smooth runs along the length of the plot (the owner's choice after the first real
 * scan, which stopped for every photo and blurred some), the first and last along the side boundaries
 * and the rest evenly between, flown back and forth. Photos along a run are taken on the fly at a
 * steady speed; the drone only stops at the ends of each run. Optionally followed by a lap round the
 * edge with the camera tilted, to capture walls, steps and tree heights. Every point stays inside the
 * boundary. The drone takes off from the home point and, when the scan is done, its own Return to
 * Home lands it back there.
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
    direction: "along",
    speedMs: s.speedMs,
    onTheFly: true,
    photosPerPass: s.photosPerRun,
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

export type FirstFlightSettings = {
  /** Height above the take-off point, metres, for the hover and the scan. */
  altitudeM: number;
  /** Hover above the take-off point this long first, for the checks (wind, unplugged cable). */
  holdS: number;
  /** Photo overlap for the scan, 0-1 (as the full garden scan). */
  overlap: number;
  speedMs: number;
};

export const FIRST_FLIGHT: FirstFlightSettings = { altitudeM: 10, holdS: 60, overlap: 0.75, speedMs: 3 };

/**
 * The first real flight, chosen by the owner: climb to 10 m over the take-off point and hover there
 * (time to compare the wind reading and try unplugging the phone), then scan `area` (the bottom of
 * the garden up to the take-off point) in the garden scan's pattern, finishing at the take-off end,
 * come back over the take-off point and land straight down (no climb to the return height).
 */
export function planFirstFlight(home: LatLng, area: LatLng[], overrides: Partial<FirstFlightSettings> = {}): Mission {
  const s = { ...FIRST_FLIGHT, ...overrides };
  const scan = planSurvey(area, { altitudeM: s.altitudeM, overlap: s.overlap, speedMs: s.speedMs, edgeLap: false });
  let passes = scan.waypoints;
  // Start at the far end and work back towards the take-off point, so the scan ends near it.
  if (passes.length > 1 && distanceM(passes[0].position, home) < distanceM(passes[passes.length - 1].position, home)) passes = [...passes].reverse();
  const hover: Waypoint = { index: 0, position: home, altitudeM: s.altitudeM, photo: false, gimbalPitchDeg: -90, holdS: s.holdS };
  const back: Waypoint = { index: passes.length + 1, position: home, altitudeM: s.altitudeM, photo: false, gimbalPitchDeg: -90 };
  const waypoints = [hover, ...passes.map((w, i) => ({ ...w, index: i + 1 })), back];
  const mission = buildMission("check", waypoints, s.speedMs);
  return { ...mission, endWith: "land" };
}

export type FilmSettings = {
  altitudeM: number;
  /** Camera tilt while filming: -90 straight down, 0 the horizon. */
  gimbalPitchDeg: number;
  speedMs: number;
};

export const DEFAULT_FILM: FilmSettings = { altitudeM: 20, gimbalPitchDeg: -35, speedMs: 2 };

/**
 * The fly-over film, added after a scan: from `from`, film a slow run to `to` looking ahead, turn
 * round and film the run back. Both points must be inside the property; the film never leaves the
 * straight line between them.
 */
export function filmWaypoints(from: LatLng, to: LatLng, firstIndex: number, overrides: Partial<FilmSettings> = {}): Waypoint[] {
  const s = { ...DEFAULT_FILM, ...overrides };
  const there = bearingDeg(from, to);
  const back = normaliseDeg(there + 180);
  const w = (position: LatLng, headingDeg: number, extra: Partial<Waypoint>): Waypoint => ({
    index: 0,
    position,
    altitudeM: s.altitudeM,
    photo: false,
    gimbalPitchDeg: s.gimbalPitchDeg,
    headingDeg,
    ...extra,
  });
  return [
    // Get into place facing along the run; a moment's hover lets the camera switch to video.
    w(from, there, { holdS: 2, video: "start" }),
    w(to, there, { speedMs: s.speedMs }),
    w(to, back, { holdS: 1 }),
    w(from, back, { speedMs: s.speedMs, video: "stop" }),
  ].map((x, i) => ({ ...x, index: firstIndex + i }));
}

/** The same mission with the fly-over film added after its last waypoint. */
export function withFilm(mission: Mission, from: LatLng, to: LatLng, overrides: Partial<FilmSettings> = {}): Mission {
  const film = filmWaypoints(from, to, mission.waypoints.length, { altitudeM: mission.waypoints[mission.waypoints.length - 1]?.altitudeM, ...overrides });
  const m = buildMission(mission.kind, [...mission.waypoints, ...film], mission.speedMs);
  return { ...m, endWith: mission.endWith, estimate: { ...mission.estimate, ...m.estimate, photoCount: mission.estimate.photoCount } };
}

/** A mission from a list of waypoints, with its id and time estimate. */
export function buildMission(kind: Mission["kind"], waypoints: Waypoint[], speedMs: number): Mission {
  return { id: missionId(kind, waypoints), kind, speedMs, waypoints, estimate: estimateMission(waypoints, speedMs) };
}

function estimateMission(waypoints: Waypoint[], speedMs: number): MissionEstimate {
  let pathLengthM = 0;
  let flyingS = 0;
  for (let i = 1; i < waypoints.length; i++) {
    const a = waypoints[i - 1];
    const b = waypoints[i];
    const leg = Math.hypot(distanceM(a.position, b.position), a.altitudeM - b.altitudeM);
    pathLengthM += leg;
    flyingS += leg / (b.speedMs ?? speedMs);
  }
  const photoCount = waypoints.filter((w) => w.photo).length;
  // Photos taken on the fly cost no extra time; the others need a stop.
  const stops = waypoints.filter((w) => w.photo && !w.onTheFly).length;
  const holds = waypoints.reduce((t, w) => t + (w.holdS ?? 0), 0);
  return { photoCount, pathLengthM, durationS: flyingS + stops * PHOTO_PAUSE_S + holds };
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
