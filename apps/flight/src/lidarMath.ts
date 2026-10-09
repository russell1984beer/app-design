// The sums behind the LIDAR features, kept apart from fetching and storage so they can be tested:
// obstacle heights for the pre-flight check, and the LIDAR as a survey of the plot.

import { fromLocal, toLocal, type LatLng } from "../../../packages/flight-core/src/geo.ts";
import type { Mission } from "../../../packages/flight-core/src/mission.ts";
import type { ObstacleHeights } from "../../../packages/flight-core/src/safety.ts";
import { wgs84ToGrid } from "../../../packages/garden-core/src/bng.ts";
import { rasterAt, type Raster } from "../../../packages/garden-core/src/raster.ts";
import { fillHoles, type Plot, type Pt, type SurveyPackage } from "../../../packages/garden-core/src/index.ts";

/** `anchor` is the GPS position of the take-off point, which was at `home` on the plan. */
export type LidarSite = { fetchedAt: string; anchor: LatLng; home: Pt; dtm: Raster; dsm: Raster | null };

/** GPS-to-grid positions are good to a few metres: obstacles this close to the route count. */
export const ROUTE_BUFFER_M = 5;

/**
 * The LIDAR can be years old: the owner can mark a tall spot (a tree since cut down) as gone. Within
 * this distance of a gone spot the LIDAR's surface is ignored and the ground used instead.
 */
export const GONE_RADIUS_M = 4;

const at = (r: Raster, p: LatLng) => {
  const g = wgs84ToGrid(p.lat, p.lng);
  return rasterAt(r, g.e, g.n);
};

/** Highest value of `f` within `radiusM` of a GPS point (1 m steps). */
function maxNear(f: (p: LatLng) => number, p: LatLng, radiusM: number): number {
  let best = -Infinity;
  for (let dx = -radiusM; dx <= radiusM; dx++)
    for (let dy = -radiusM; dy <= radiusM; dy++) {
      if (dx * dx + dy * dy > radiusM * radiusM) continue;
      const v = f(fromLocal(p, { x: dx, y: dy }));
      if (v > best) best = v;
    }
  return best;
}

/** Ground height at the take-off point (the lowest nearby if it has no value, e.g. under a tree). */
function homeGround(s: LidarSite, home: LatLng): number {
  const v = at(s.dtm, home);
  if (Number.isFinite(v)) return v;
  let lo = Infinity;
  for (let dx = -3; dx <= 3; dx++)
    for (let dy = -3; dy <= 3; dy++) {
      const w = at(s.dtm, fromLocal(home, { x: dx, y: dy }));
      if (Number.isFinite(w)) lo = Math.min(lo, w);
    }
  return lo;
}

/**
 * Heights above the take-off point's ground of the tallest thing near the mission's path and over
 * the whole flight area, for the pre-flight check. Null without the surface model.
 */
const obstacleCache = new Map<string, ObstacleHeights | null>();

export function obstacleHeights(s: LidarSite, home: LatLng, mission: Mission, area: LatLng[], gone: LatLng[] = []): ObstacleHeights | null {
  // Worked out once per site, take-off point (to about 10 cm), mission, area and gone spots.
  const ll = (p: LatLng) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;
  const key = [s.fetchedAt, ll(home), mission.id, ...area.map(ll), "gone", ...gone.map(ll)].join("|");
  if (!obstacleCache.has(key)) obstacleCache.set(key, computeObstacles(s, home, mission, area, gone));
  return obstacleCache.get(key)!;
}

/** The top of whatever stands at a point: the surface model, or the ground where a spot is gone. */
function topAt(s: LidarSite, gone: LatLng[]): (p: LatLng) => number {
  const dsm = s.dsm!;
  return (p) => (gone.some((g) => Math.hypot(toLocal(g, p).x, toLocal(g, p).y) < GONE_RADIUS_M) ? at(s.dtm, p) : at(dsm, p));
}

function computeObstacles(s: LidarSite, home: LatLng, mission: Mission, area: LatLng[], gone: LatLng[]): ObstacleHeights | null {
  if (!s.dsm) return null;
  const ground = homeGround(s, home);
  if (!Number.isFinite(ground)) return null;
  const top = topAt(s, gone);
  // Along the path, every metre or so, including out from and back to the take-off point.
  const path = [home, ...mission.waypoints.map((w) => w.position), home];
  let route = -Infinity;
  for (let i = 1; i < path.length; i++) {
    const v = toLocal(path[i - 1], path[i]);
    const steps = Math.max(1, Math.ceil(Math.hypot(v.x, v.y) / 2));
    for (let k = 0; k <= steps; k++) route = Math.max(route, maxNear(top, fromLocal(path[i - 1], { x: (v.x * k) / steps, y: (v.y * k) / steps }), ROUTE_BUFFER_M));
  }
  // The flight area: every metre inside its bounding box, plus the buffer.
  const pts = area.map((p) => toLocal(home, p));
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  let areaMax = -Infinity;
  for (let x = Math.min(...xs) - ROUTE_BUFFER_M; x <= Math.max(...xs) + ROUTE_BUFFER_M; x++)
    for (let y = Math.min(...ys) - ROUTE_BUFFER_M; y <= Math.max(...ys) + ROUTE_BUFFER_M; y++) {
      const v = top(fromLocal(home, { x, y }));
      if (v > areaMax) areaMax = v;
    }
  if (!Number.isFinite(route) || !Number.isFinite(areaMax)) return null;
  return { routeTallestM: Math.max(0, route - ground), areaTallestM: Math.max(0, areaMax - ground), source: "LIDAR" };
}

/**
 * The LIDAR as a survey of the plot, for the Survey tab until a drone survey is opened: ground and
 * surface heights on a 0.5 m grid over the plan. `toGps` turns a plan point into a GPS position.
 */
export function lidarSurvey(s: LidarSite, plot: Plot, toGps: (p: Pt) => LatLng, gone: Pt[] = []): SurveyPackage {
  const cellM = 0.5;
  const cols = Math.ceil(plot.widthM / cellM);
  const rows = Math.ceil(plot.lengthM / cellM);
  const sample = (r: Raster, isSurface = false) => {
    const raw: (number | null)[] = [];
    for (let row = 0; row < rows; row++)
      for (let c = 0; c < cols; c++) {
        const q: Pt = [(c + 0.5) * cellM, (row + 0.5) * cellM];
        // A spot the owner marked as gone shows the ground, not the old tree.
        const isGone = isSurface && gone.some((g) => Math.hypot(g[0] - q[0], g[1] - q[1]) < GONE_RADIUS_M);
        const v = at(isGone ? s.dtm : r, toGps(q));
        raw.push(Number.isFinite(v) ? v : null);
      }
    return fillHoles(cols, rows, raw);
  };
  if (!s.dtm.values.some(Number.isFinite)) throw new Error("No LIDAR ground heights over the plot.");
  const ground = sample(s.dtm);
  const surface = s.dsm ? sample(s.dsm, true) : null;
  return {
    format: "plotwise-survey",
    version: 1,
    // Includes where it is lined up and the gone spots, so drawings cached by createdAt are redone.
    createdAt: `${s.fetchedAt} @${s.home.join(",")} -${gone.length}`,
    flownAt: s.fetchedAt,
    photoCount: 0,
    plot,
    ground: { cellM, cols, rows, values: ground.values },
    surface: surface ? { cellM, cols, rows, values: surface.values } : undefined,
    coverage: ground.known,
    label:
      "Levels from the Environment Agency's LIDAR (free, 1 m grid, ground heights to about 15 cm). Its position on the plan is good to a few metres, and it may be a few years old. A drone survey replaces it.",
  };
}

/** How far the drone is from the take-off point on the plan, judged by where the house shows up. */
export type TakeoffOffset = {
  /** Plan metres along the garden: positive means the drone is nearer the street than the marked point. */
  alongM: number;
  /** How clearly the house stands out in the LIDAR at the best match (0-1). */
  score: number;
};

const offsetCache = new Map<string, TakeoffOffset | null>();

/**
 * Finds the house (the plan's house rectangle) in the LIDAR heights. If it shows up shifted along
 * the garden, the drone is not on the take-off point the plan assumes, by that much. `toGps` places
 * a plan point using the drone's position as the take-off point. Null when the house cannot be found
 * clearly (no surface model, or nothing house-like).
 */
export function takeoffOffset(s: LidarSite, plot: Plot, toGps: (p: Pt) => LatLng, cacheKey: string): TakeoffOffset | null {
  const key = `${s.fetchedAt}|${cacheKey}|${JSON.stringify(plot)}`;
  if (offsetCache.has(key)) return offsetCache.get(key)!;
  const result = computeOffset(s, plot, toGps);
  offsetCache.set(key, result);
  return result;
}

function computeOffset(s: LidarSite, plot: Plot, toGps: (p: Pt) => LatLng): TakeoffOffset | null {
  if (!s.dsm) return null;
  const dsm = s.dsm;
  const W = Math.min(plot.houseWidthM, plot.widthM);
  const y0 = plot.rearGardenM;
  const y1 = plot.rearGardenM + plot.houseDepthM;
  // Sample points inside the house, 1 m apart, kept a little in from its edges.
  const pts: Pt[] = [];
  for (let x = 0.75; x < W - 0.5; x += 1) for (let y = y0 + 0.75; y < y1 - 0.5; y += 1) pts.push([x, y]);
  if (pts.length < 6) return null;
  const tall = (p: Pt) => {
    const g = toGps(p);
    const top = at(dsm, g);
    const ground = at(s.dtm, g);
    return Number.isFinite(top) && Number.isFinite(ground) && top - ground >= 3;
  };
  const scores: { d: number; score: number }[] = [];
  for (let d = -20; d <= 20; d += 0.5) {
    // A feature at plan y shows up at y - d when the drone is d further along than assumed.
    const hit = pts.filter(([x, y]) => tall([x, y - d])).length;
    scores.push({ d, score: hit / pts.length });
  }
  const best = Math.max(...scores.map((x) => x.score));
  if (best < 0.7) return null;
  // The middle of the best-matching run of shifts (a house deeper than the plan says gives a plateau).
  const good = scores.filter((x) => x.score >= best - 0.05).map((x) => x.d);
  const mid = good[Math.floor(good.length / 2)];
  return { alongM: mid, score: best };
}
