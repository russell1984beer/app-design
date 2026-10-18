// Placing a property on the map: satellite map tiles (Web Mercator, the scheme every online map uses)
// and the plot worked out from its four boundary corners, marked by the owner over a satellite photo.

import { bearingDeg, distanceM, type LatLng } from "./geo.ts";

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
