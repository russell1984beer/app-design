// Tree, roof and shed heights for the pre-flight clearance check. A drone survey, once opened, is
// the best source inside the plot (it shows what is there now, to a few centimetres); the
// Environment Agency's LIDAR fills in beyond the plot, and covers everything until the first survey.

import type { LatLng } from "../../../packages/flight-core/src/geo.ts";
import type { Mission } from "../../../packages/flight-core/src/mission.ts";
import type { ObstacleHeights } from "../../../packages/flight-core/src/safety.ts";
import { gridHeight } from "../../../packages/garden-core/src/index.ts";

import { gpsToPlan, planToGps } from "./flight";
import { lidarFor } from "./lidar";
import { lidarHeights, obstaclesFrom, type HeightAbove } from "./lidarMath";
import type { AppState } from "./store";
import { droneSurvey } from "./survey";

const cache = new Map<string, ObstacleHeights | null>();

export function obstacleHeightsFor(s: AppState, anchor: LatLng, mission: Mission, area: LatLng[]): ObstacleHeights | null {
  const survey = droneSurvey();
  const lidar = lidarFor(anchor);
  const ll = (p: LatLng) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;
  const key = [ll(anchor), s.home.join(","), JSON.stringify(s.plot), mission.id, area.map(ll).join(";"), survey?.createdAt, lidar?.fetchedAt, JSON.stringify(s.goneSpots)].join("|");
  if (cache.has(key)) return cache.get(key)!;

  const { widthM: W, lengthM: L } = s.plot;
  const inPlot = (p: LatLng) => {
    const [x, y] = gpsToPlan(s, anchor, p);
    return x >= 0 && x <= W && y >= 0 && y <= L;
  };
  const sources: HeightAbove[] = [];
  const surface = survey?.surface;
  if (survey && surface) {
    const groundHome = gridHeight(survey.ground, s.home[0], s.home[1]);
    sources.push((p) => {
      if (!inPlot(p)) return NaN;
      const [x, y] = gpsToPlan(s, anchor, p);
      return gridHeight(surface, x, y) - groundHome;
    });
  }
  if (lidar) {
    // The gone spots only matter for the LIDAR: a drone survey already shows what is there now.
    const gone = s.goneSpots.map((p) => planToGps(s, anchor, p));
    const h = lidarHeights(lidar, anchor, gone, surface ? inPlot : undefined);
    if (h) sources.push(h);
  }
  const source = surface && lidar ? "The drone survey (and LIDAR beyond the plot)" : surface ? "The drone survey" : "LIDAR";
  const result = sources.length ? obstaclesFrom(sources, anchor, mission, area, source) : null;
  cache.set(key, result);
  return result;
}
