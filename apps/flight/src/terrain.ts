// The garden's ground levels for the map, measurements, design and materials: from the drone survey
// once one is opened, otherwise the draft from the title plan. Worked out once per plot.

import { contours, draftTerrain, levelFn, slopeCells, terrainFromSurvey, type Plot } from "../../../packages/garden-core/src/index.ts";

import { currentSurvey } from "./survey";

/** Cached per plot: the terrain and its contour and slope drawings. */
const terrainCache = new Map<string, { z: ReturnType<typeof draftTerrain>; lvl: (x: number, y: number) => number; contours: ReturnType<typeof contours>; slope: ReturnType<typeof slopeCells> }>();
export function terrainFor(plot: Plot) {
  const survey = currentSurvey();
  const key = JSON.stringify(plot) + (survey?.createdAt ?? "draft");
  let t = terrainCache.get(key);
  if (!t) {
    // The real survey's ground heights once one is opened; the draft from the title plan until then.
    const z = survey ? terrainFromSurvey(survey) : draftTerrain(plot);
    t = { z, lvl: levelFn(plot, z), contours: contours(plot, z), slope: slopeCells(plot, z) };
    if (terrainCache.size >= 4) terrainCache.clear();
    terrainCache.set(key, t);
  }
  return t;
}
