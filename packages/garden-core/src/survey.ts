// A processed drone survey of the plot: ground and surface heights on a grid over the plan, and
// the aerial photo cut to the plot. Made on the PC by tools/survey from OpenDroneMap's results,
// then opened in the app, where it replaces the draft levels and drawn photo.

import type { Plot, Pt, Terrain } from "./plot.ts";

export const SURVEY_FORMAT = "plotwise-survey";
export const SCAN_FORMAT = "plotwise-scan";

/** What the app records about a finished scan, so the PC tool can line the survey up with the plan. */
export type ScanDetails = {
  format: typeof SCAN_FORMAT;
  version: 1;
  flownAt: string;
  plot: Plot;
  /** Take-off point on the plan, and its GPS position as the drone reported it. */
  home: Pt;
  anchor: { lat: number; lng: number };
  photoCount: number;
};

export type HeightGrid = {
  /** Size of each square, metres. Cell (c, r) covers x from c·cellM, y from r·cellM. */
  cellM: number;
  cols: number;
  rows: number;
  /** Heights in metres (any datum), row by row from the far end of the garden. */
  values: number[];
};

export type SurveyPackage = {
  format: typeof SURVEY_FORMAT;
  version: 1;
  createdAt: string;
  flownAt: string;
  photoCount: number;
  plot: Plot;
  /** Bare ground, with trees and buildings taken out. */
  ground: HeightGrid;
  /** Top of everything: roofs, trees, sheds. */
  surface?: HeightGrid;
  /** Aerial photo covering exactly the plot rectangle, far end of the garden at the top. */
  photo?: { mime: "image/jpeg" | "image/png"; base64: string; widthPx: number; heightPx: number };
  /** Share of the plot that the survey actually covered, 0–1. */
  coverage: number;
  /** Shown in the app instead of the usual description, e.g. for a test survey. */
  label?: string;
};

/** Height at any point of the plan, smoothly between grid squares. */
export function gridHeight(g: HeightGrid, x: number, y: number): number {
  // Values sit at square centres.
  const fx = Math.min(Math.max(x / g.cellM - 0.5, 0), g.cols - 1);
  const fy = Math.min(Math.max(y / g.cellM - 0.5, 0), g.rows - 1);
  const c0 = Math.floor(fx);
  const r0 = Math.floor(fy);
  const c1 = Math.min(c0 + 1, g.cols - 1);
  const r1 = Math.min(r0 + 1, g.rows - 1);
  const tx = fx - c0;
  const ty = fy - r0;
  const v = (c: number, r: number) => g.values[r * g.cols + c];
  return (v(c0, r0) * (1 - tx) + v(c1, r0) * tx) * (1 - ty) + (v(c0, r1) * (1 - tx) + v(c1, r1) * tx) * ty;
}

export function terrainFromSurvey(s: SurveyPackage): Terrain {
  return (x, y) => gridHeight(s.ground, x, y);
}

/**
 * Fill holes (null) from the nearest known squares, so the grid has a height everywhere.
 * Returns the filled values and the share of squares that were known.
 */
export function fillHoles(cols: number, rows: number, values: (number | null)[]): { values: number[]; known: number } {
  const out = values.slice();
  const known = values.filter((v) => v !== null && Number.isFinite(v)).length;
  if (known === 0) throw new Error("The survey has no heights over the plot.");
  let missing = values.length - known;
  // Grow known values outwards one square at a time.
  while (missing > 0) {
    const next = out.slice();
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        if (out[i] !== null && Number.isFinite(out[i])) continue;
        let sum = 0;
        let n = 0;
        for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const cc = c + dc;
          const rr = r + dr;
          if (cc < 0 || rr < 0 || cc >= cols || rr >= rows) continue;
          const v = out[rr * cols + cc];
          if (v !== null && Number.isFinite(v)) {
            sum += v;
            n++;
          }
        }
        if (n) {
          next[i] = sum / n;
          missing--;
        }
      }
    }
    for (let i = 0; i < out.length; i++) out[i] = next[i];
  }
  return { values: out as number[], known: known / values.length };
}

/** Check a file opened in the app really is a Plotwise survey, and say plainly what is wrong if not. */
export function readSurvey(text: string): SurveyPackage {
  let data: Partial<SurveyPackage>;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("This file is not a Plotwise survey (it could not be read).");
  }
  if (data.format !== SURVEY_FORMAT) throw new Error("This file is not a Plotwise survey.");
  if (data.version !== 1) throw new Error("This survey was made by a newer version of Plotwise. Update the app.");
  const g = data.ground;
  if (!g || !(g.cellM > 0) || g.values?.length !== g.cols * g.rows || g.values.some((v) => typeof v !== "number" || !Number.isFinite(v))) {
    throw new Error("The survey file is damaged (the ground heights are incomplete).");
  }
  if (!data.plot) throw new Error("The survey file is damaged (no plot).");
  return data as SurveyPackage;
}
