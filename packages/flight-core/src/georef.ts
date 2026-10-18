// Placing a property on the map: satellite map tiles (Web Mercator, the scheme every online map uses)
// and the plot worked out from its four boundary corners, marked by the owner over a satellite photo.

import { bearingDeg, convexHull, distanceM, fromLocal, toLocal, type LatLng } from "./geo.ts";

const TILE_PX = 256;

/** A position as pixels on the whole-world map at zoom level z (0 = the world in one 256 px tile). */
export function latLngToWorldPx(p: LatLng, z: number): { x: number; y: number } {
  const size = TILE_PX * 2 ** z;
  const s = Math.sin((p.lat * Math.PI) / 180);
  return {
    x: ((p.lng + 180) / 360) * size,
    y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * size,
  };
}

/** The reverse of latLngToWorldPx. */
export function worldPxToLatLng(x: number, y: number, z: number): LatLng {
  const size = TILE_PX * 2 ** z;
  const n = Math.PI - (2 * Math.PI * y) / size;
  return { lat: (180 / Math.PI) * Math.atan(Math.sinh(n)), lng: (x / size) * 360 - 180 };
}

/** Metres on the ground per map pixel at a latitude and zoom. */
export function metresPerPx(lat: number, z: number): number {
  return (40_075_016.686 * Math.cos((lat * Math.PI) / 180)) / (TILE_PX * 2 ** z);
}

/** The tiles (x, y at zoom z) covering a view of widthPx x heightPx centred on a position. */
export function tilesAround(centre: LatLng, z: number, widthPx: number, heightPx: number): { x: number; y: number; left: number; top: number }[] {
  const c = latLngToWorldPx(centre, z);
  const x0 = c.x - widthPx / 2;
  const y0 = c.y - heightPx / 2;
  const out: { x: number; y: number; left: number; top: number }[] = [];
  for (let ty = Math.floor(y0 / TILE_PX); ty * TILE_PX < y0 + heightPx; ty++) {
    for (let tx = Math.floor(x0 / TILE_PX); tx * TILE_PX < x0 + widthPx; tx++) {
      out.push({ x: tx, y: ty, left: tx * TILE_PX - x0, top: ty * TILE_PX - y0 });
    }
  }
  return out;
}

export type PlotFromCorners = {
  widthM: number;
  lengthM: number;
  /** Compass direction from the house down the garden to the far end. */
  gardenBearingDeg: number;
  /** The plan's origin: the far end, on the left looking down the garden from the house. */
  farLeft: LatLng;
};

/**
 * The plot from its boundary corners, marked in this order (left and right looking down the garden
 * from the house): far end left, far end right, street end right, street end left. Opposite sides are
 * averaged, so a slightly uneven marking still gives a rectangle.
 */
export function plotFromCorners(c: LatLng[]): PlotFromCorners {
  if (c.length !== 4) throw new Error("Mark all four corners of the plot.");
  const mid = (a: LatLng, b: LatLng): LatLng => ({ lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 });
  return {
    widthM: (distanceM(c[0], c[1]) + distanceM(c[3], c[2])) / 2,
    lengthM: (distanceM(c[0], c[3]) + distanceM(c[1], c[2])) / 2,
    gardenBearingDeg: bearingDeg(mid(c[3], c[2]), mid(c[0], c[1])),
    farLeft: c[0],
  };
}

/**
 * The smallest rectangle round a traced boundary (any shape), as four corners in plotFromCorners'
 * order. Its long side runs along the plot; the far end is the end the tracing started at (the owner
 * is asked to start at a far corner). Used for the design screens' rectangle; flights use the outline.
 */
export function rectAroundPolygon(points: LatLng[]): LatLng[] {
  if (points.length < 3) throw new Error("Tap at least three points round the boundary.");
  const origin = points[0];
  const hull = convexHull(points).map((p) => toLocal(origin, p));
  let best: { area: number; angle: number; minX: number; maxX: number; minY: number; maxY: number } | null = null;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    const c = Math.cos(-angle);
    const s = Math.sin(-angle);
    const xs = hull.map((p) => p.x * c - p.y * s);
    const ys = hull.map((p) => p.x * s + p.y * c);
    const box = { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
    const area = (box.maxX - box.minX) * (box.maxY - box.minY);
    if (!best || area < best.area) best = { area, angle, ...box };
  }
  const r = best!;
  // Back from the box's own frame to east/north.
  const turn = (x: number, y: number) => ({ x: x * Math.cos(r.angle) - y * Math.sin(r.angle), y: x * Math.sin(r.angle) + y * Math.cos(r.angle) });
  const centre = turn((r.minX + r.maxX) / 2, (r.minY + r.maxY) / 2);
  const sizeX = r.maxX - r.minX;
  const sizeY = r.maxY - r.minY;
  // Along the plot: the box's long side.
  const longX = sizeX >= sizeY;
  const length = longX ? sizeX : sizeY;
  const width = longX ? sizeY : sizeX;
  let along = longX ? turn(1, 0) : turn(0, 1);
  // Towards the far end: the side the first point is on (it is at the local origin).
  if (-centre.x * along.x - centre.y * along.y < 0) along = { x: -along.x, y: -along.y };
  // Left, looking towards the far end.
  const left = { x: -along.y, y: along.x };
  const corner = (f: number, l: number) =>
    fromLocal(origin, { x: centre.x + along.x * f * (length / 2) + left.x * l * (width / 2), y: centre.y + along.y * f * (length / 2) + left.y * l * (width / 2) });
  return [corner(1, 1), corner(1, -1), corner(-1, -1), corner(-1, 1)];
}
