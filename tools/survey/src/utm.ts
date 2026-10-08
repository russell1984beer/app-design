// Latitude/longitude (WGS84) to UTM grid metres, the coordinates OpenDroneMap writes its results in.
// Standard transverse Mercator series (accurate to well under a millimetre over a garden).

const A = 6378137;
const F = 1 / 298.257223563;
const K0 = 0.9996;
const E2 = F * (2 - F);
const EP2 = E2 / (1 - E2);

export function utmZone(lng: number): number {
  return Math.floor((lng + 180) / 6) + 1;
}

export function latLngToUtm(lat: number, lng: number, zone: number, north: boolean): [number, number] {
  const phi = (lat * Math.PI) / 180;
  const lambda0 = (((zone - 1) * 6 - 180 + 3) * Math.PI) / 180;
  const lambda = (lng * Math.PI) / 180;
  const sin = Math.sin(phi);
  const cos = Math.cos(phi);
  const tan = Math.tan(phi);
  const N = A / Math.sqrt(1 - E2 * sin * sin);
  const T = tan * tan;
  const C = EP2 * cos * cos;
  const a = cos * (lambda - lambda0);
  const M =
    A *
    ((1 - E2 / 4 - (3 * E2 * E2) / 64 - (5 * E2 ** 3) / 256) * phi -
      ((3 * E2) / 8 + (3 * E2 * E2) / 32 + (45 * E2 ** 3) / 1024) * Math.sin(2 * phi) +
      ((15 * E2 * E2) / 256 + (45 * E2 ** 3) / 1024) * Math.sin(4 * phi) -
      ((35 * E2 ** 3) / 3072) * Math.sin(6 * phi));
  const x =
    K0 * N * (a + ((1 - T + C) * a ** 3) / 6 + ((5 - 18 * T + T * T + 72 * C - 58 * EP2) * a ** 5) / 120) + 500000;
  let y =
    K0 *
    (M + N * tan * ((a * a) / 2 + ((5 - T + 9 * C + 4 * C * C) * a ** 4) / 24 + ((61 - 58 * T + T * T + 600 * C - 330 * EP2) * a ** 6) / 720));
  if (!north) y += 10000000;
  return [x, y];
}

/** A function from latitude/longitude to the raster's own coordinates, from its EPSG code. */
export function projectionFor(epsg: number): (lat: number, lng: number) => [number, number] {
  if (epsg === 4326) return (lat, lng) => [lng, lat];
  if (epsg >= 32601 && epsg <= 32660) return (lat, lng) => latLngToUtm(lat, lng, epsg - 32600, true);
  if (epsg >= 32701 && epsg <= 32760) return (lat, lng) => latLngToUtm(lat, lng, epsg - 32700, false);
  throw new Error(`The survey uses map coordinates this tool does not know (EPSG:${epsg}).`);
}
