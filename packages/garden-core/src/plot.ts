// The plot, in metres on the plan. x runs across the plot (0 at the neighbour's side), y runs
// down the plan from the far end of the rear garden (0) to the street (lengthM).

export type Pt = [number, number];

export type Plot = {
  widthM: number;
  rearGardenM: number;
  houseDepthM: number;
  /** Whole plot, rear garden to street. */
  lengthM: number;
  /** The house is joined to next door at x = 0; a side passage runs down the other side. */
  houseWidthM: number;
  ridgeHeightM: number;
  roofPitchDeg: number;
  /** Compass direction the rear garden runs towards, from the house. Up on the plan. */
  gardenBearingDeg: number;
  latitudeDeg: number;
};

/** Same shape as the owner's garden, from the title plan. */
export const TEST_PLOT: Plot = {
  widthM: 7,
  rearGardenM: 29.5,
  houseDepthM: 8,
  lengthM: 43,
  houseWidthM: 5.8,
  ridgeHeightM: 8.5,
  roofPitchDeg: 35,
  gardenBearingDeg: 128,
  latitudeDeg: 50.86,
};

export const frontGardenM = (p: Plot) => p.lengthM - p.rearGardenM - p.houseDepthM;

export function inHouse(p: Plot, x: number, y: number): boolean {
  return x <= p.houseWidthM && y >= p.rearGardenM && y <= p.rearGardenM + p.houseDepthM;
}

export function inPlot(p: Plot, x: number, y: number): boolean {
  return x >= 0 && x <= p.widthM && y >= 0 && y <= p.lengthM;
}

/** Ground height in metres above an arbitrary datum. */
export type Terrain = (x: number, y: number) => number;

/**
 * Estimated levels until a real scan is processed: a gentle fall towards the far end of the
 * garden, a small rise and a hollow, and steps up to the patio.
 */
export function draftTerrain(p: Plot): Terrain {
  const GH = p.rearGardenM;
  const zg = (x: number, y: number) =>
    1.9 -
    0.055 * y +
    0.35 * Math.exp(-((x - 5) ** 2 + (y - 12) ** 2) / 10) -
    0.25 * Math.exp(-((x - 2.5) ** 2 + (y - 20) ** 2) / 5) +
    (y > GH - 6 ? 0.055 * (y - (GH - 6)) : 0);
  return (x, y) => (y <= GH ? zg(x, y) : y <= GH + p.houseDepthM ? zg(x, GH) : zg(x, GH) - 0.11 * (y - GH - p.houseDepthM));
}

/** Levels are given relative to the back door threshold. */
export function levelFn(p: Plot, z: Terrain): (x: number, y: number) => number {
  const datum = z(3, p.rearGardenM);
  return (x, y) => z(x, y) - datum;
}

export const fmtLevel = (v: number) => (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(2);

export type Contour = { level: number; major: boolean; segments: [Pt, Pt][] };

/** Contour lines every 25 cm, by marching squares on a 40 cm grid. */
export function contours(p: Plot, z: Terrain): Contour[] {
  const s = 0.4;
  const W = p.widthM;
  const H = p.lengthM;
  const datum = z(3, p.rearGardenM);
  const out: Contour[] = [];
  // Cover the whole range of levels in the plot, in 25 cm steps.
  let lo = Infinity;
  let hi = -Infinity;
  for (let x = 0; x <= W; x += s) {
    for (let y = 0; y <= H; y += s) {
      const v = z(x, y) - datum;
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
  }
  for (let L = Math.floor(lo * 4) / 4; L <= hi; L += 0.25) {
    const lv = L + datum;
    const segments: [Pt, Pt][] = [];
    for (let x = 0; x < W - 1e-6; x += s) {
      for (let y = 0; y < H - 1e-6; y += s) {
        const x2 = Math.min(x + s, W);
        const y2 = Math.min(y + s, H);
        const c: Pt[] = [[x, y], [x2, y], [x2, y2], [x, y2]];
        const v = c.map((q) => z(q[0], q[1]));
        const pts: Pt[] = [];
        for (let k = 0; k < 4; k++) {
          const a = v[k];
          const b = v[(k + 1) % 4];
          if ((a - lv) * (b - lv) < 0) {
            const t = (lv - a) / (b - a);
            const P = c[k];
            const Q = c[(k + 1) % 4];
            pts.push([P[0] + t * (Q[0] - P[0]), P[1] + t * (Q[1] - P[1])]);
          }
        }
        if (pts.length >= 2) segments.push([pts[0], pts[1]]);
        if (pts.length === 4) segments.push([pts[2], pts[3]]);
      }
    }
    const level = Math.round(L * 100) / 100;
    out.push({ level, major: Math.abs(level % 0.5) < 1e-9, segments });
  }
  return out;
}

/** Slope at a point, measured across `spanM` (1 m: the size of the slope map's squares, so survey noise does not show as steep). */
export function slopePercent(z: Terrain, x: number, y: number, spanM = 1): number {
  const e = spanM / 2;
  return Math.hypot((z(x + e, y) - z(x - e, y)) / (2 * e), (z(x, y + e) - z(x, y - e)) / (2 * e)) * 100;
}

export type SlopeBand = "under4" | "4to8" | "8to15" | "over15";
export const slopeBand = (pct: number): SlopeBand => (pct < 4 ? "under4" : pct < 8 ? "4to8" : pct < 15 ? "8to15" : "over15");

/** 1 m squares coloured by slope. */
export function slopeCells(p: Plot, z: Terrain): { x: number; y: number; w: number; h: number; band: SlopeBand }[] {
  const cells = [];
  for (let x = 0; x < p.widthM; x += 1) {
    for (let y = 0; y < p.lengthM; y += 1) {
      const w = Math.min(1, p.widthM - x);
      const h = Math.min(1, p.lengthM - y);
      cells.push({ x, y, w, h, band: slopeBand(slopePercent(z, x + w / 2, y + h / 2)) });
    }
  }
  return cells;
}

/** Distance, rise and gradient between two points. */
export function measureLine(lvl: (x: number, y: number) => number, a: Pt, b: Pt) {
  const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const rise = lvl(b[0], b[1]) - lvl(a[0], a[1]);
  const gradient = d > 0 ? Math.abs(rise) / d : 0;
  return { distanceM: d, riseM: rise, gradient };
}

export function gradientText(g: number): string {
  return g < 0.005 ? "level" : `1 in ${(1 / g).toFixed(1)} (${(g * 100).toFixed(1)}%)`;
}

export const area = (P: Pt[]) => Math.abs(P.reduce((a, p, i) => a + p[0] * P[(i + 1) % P.length][1] - P[(i + 1) % P.length][0] * p[1], 0)) / 2;
export const perimeter = (P: Pt[]) =>
  P.reduce((a, p, i) => a + Math.hypot(P[(i + 1) % P.length][0] - p[0], P[(i + 1) % P.length][1] - p[1]), 0);

/** A plan direction for a compass bearing: [right, down] on the plan. */
export function planVector(p: Plot, bearingDeg: number): Pt {
  const r = ((bearingDeg - p.gardenBearingDeg) * Math.PI) / 180;
  return [Math.sin(r), -Math.cos(r)];
}

/**
 * Plan position to metres east and north of a reference point on the plan. Lets the flight app
 * turn the plan into GPS positions once it knows where one point (the home point) is.
 */
export function planToEastNorth(p: Plot, ref: Pt, pt: Pt): { east: number; north: number } {
  const b = (p.gardenBearingDeg * Math.PI) / 180;
  const dx = pt[0] - ref[0];
  const dy = pt[1] - ref[1];
  return { east: dx * Math.cos(b) - dy * Math.sin(b), north: -dx * Math.sin(b) - dy * Math.cos(b) };
}

/** The reverse of planToEastNorth. */
export function eastNorthToPlan(p: Plot, ref: Pt, en: { east: number; north: number }): Pt {
  const b = (p.gardenBearingDeg * Math.PI) / 180;
  return [ref[0] + en.east * Math.cos(b) - en.north * Math.sin(b), ref[1] - (en.east * Math.sin(b) + en.north * Math.cos(b))];
}
