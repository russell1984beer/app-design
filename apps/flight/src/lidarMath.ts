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

const at = (r: Raster, p: LatLng) => {
  const g = wgs84ToGrid(p.lat, p.lng);
  return rasterAt(r, g.e, g.n);
};

/** Highest value within `radiusM` of a GPS point (1 m steps). */
function maxNear(r: Raster, p: LatLng, radiusM: number): number {
  let best = -Infinity;
  for (let dx = -radiusM; dx <= radiusM; dx++)
    for (let dy = -radiusM; dy <= radiusM; dy++) {
      if (dx * dx + dy * dy > radiusM * radiusM) continue;
      const v = at(r, fromLocal(p, { x: dx, y: dy }));
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

export function obstacleHeights(s: LidarSite, home: LatLng, mission: Mission, area: LatLng[]): ObstacleHeights | null {
  // Worked out once per site, take-off point (to about 10 cm) and mission.
  const key = [s.fetchedAt, home.lat.toFixed(6), home.lng.toFixed(6), mission.id, ...area.map((p) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`)].join("|");
  if (!obstacleCache.has(key)) obstacleCache.set(key, computeObstacles(s, home, mission, area));
  return obstacleCache.get(key)!;
}

function computeObstacles(s: LidarSite, home: LatLng, mission: Mission, area: LatLng[]): ObstacleHeights | null {
  if (!s.dsm) return null;
  const ground = homeGround(s, home);
  if (!Number.isFinite(ground)) return null;
  const dsm = s.dsm;
  // Along the path, every metre or so, including out from and back to the take-off point.
  const path = [home, ...mission.waypoints.map((w) => w.position), home];
  let route = -Infinity;
  for (let i = 1; i < path.length; i++) {
    const v = toLocal(path[i - 1], path[i]);
    const steps = Math.max(1, Math.ceil(Math.hypot(v.x, v.y) / 2));
    for (let k = 0; k <= steps; k++) route = Math.max(route, maxNear(dsm, fromLocal(path[i - 1], { x: (v.x * k) / steps, y: (v.y * k) / steps }), ROUTE_BUFFER_M));
  }
  // The flight area: every metre inside its bounding box, plus the buffer.
  const pts = area.map((p) => toLocal(home, p));
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  let areaMax = -Infinity;
  for (let x = Math.min(...xs) - ROUTE_BUFFER_M; x <= Math.max(...xs) + ROUTE_BUFFER_M; x++)
    for (let y = Math.min(...ys) - ROUTE_BUFFER_M; y <= Math.max(...ys) + ROUTE_BUFFER_M; y++) {
      const v = at(dsm, fromLocal(home, { x, y }));
      if (v > areaMax) areaMax = v;
    }
  if (!Number.isFinite(route) || !Number.isFinite(areaMax)) return null;
  return { routeTallestM: Math.max(0, route - ground), areaTallestM: Math.max(0, areaMax - ground), source: "LIDAR" };
}

/**
 * The LIDAR as a survey of the plot, for the Survey tab until a drone survey is opened: ground and
 * surface heights on a 0.5 m grid over the plan. `toGps` turns a plan point into a GPS position.
 */
export function lidarSurvey(s: LidarSite, plot: Plot, toGps: (p: Pt) => LatLng): SurveyPackage {
  const cellM = 0.5;
  const cols = Math.ceil(plot.widthM / cellM);
  const rows = Math.ceil(plot.lengthM / cellM);
  const sample = (r: Raster) => {
    const raw: (number | null)[] = [];
    for (let row = 0; row < rows; row++)
      for (let c = 0; c < cols; c++) {
        const v = at(r, toGps([(c + 0.5) * cellM, (row + 0.5) * cellM]));
        raw.push(Number.isFinite(v) ? v : null);
      }
    return fillHoles(cols, rows, raw);
  };
  if (!s.dtm.values.some(Number.isFinite)) throw new Error("No LIDAR ground heights over the plot.");
  const ground = sample(s.dtm);
  const surface = s.dsm ? sample(s.dsm) : null;
  return {
    format: "plotwise-survey",
    version: 1,
    createdAt: s.fetchedAt,
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
