// GPS (WGS84) to British National Grid (OSGB36, metres east and north), the grid the Environment
// Agency's LIDAR maps use. A 7-parameter Helmert shift then the Ordnance Survey's Transverse
// Mercator formulae ("A guide to coordinate systems in Great Britain"). Good to about 2-5 m, which
// is fine for 1 m LIDAR as long as what uses it allows for a few metres either way.

export type GridRef = { e: number; n: number };

const RAD = Math.PI / 180;

const WGS84 = { a: 6378137, b: 6356752.314245 };
const AIRY1830 = { a: 6377563.396, b: 6356256.909 };

// WGS84 to OSGB36.
const HELMERT = { tx: -446.448, ty: 125.157, tz: -542.06, s: 20.4894e-6, rx: -0.1502, ry: -0.247, rz: -0.8421 };

// National Grid projection.
const F0 = 0.9996012717;
const LAT0 = 49 * RAD;
const LON0 = -2 * RAD;
const E0 = 400000;
const N0 = -100000;

function toCartesian(latDeg: number, lngDeg: number, el: { a: number; b: number }) {
  const lat = latDeg * RAD;
  const lng = lngDeg * RAD;
  const e2 = 1 - (el.b * el.b) / (el.a * el.a);
  const nu = el.a / Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
  return { x: nu * Math.cos(lat) * Math.cos(lng), y: nu * Math.cos(lat) * Math.sin(lng), z: nu * (1 - e2) * Math.sin(lat) };
}

function fromCartesian(p: { x: number; y: number; z: number }, el: { a: number; b: number }): { lat: number; lng: number } {
  const e2 = 1 - (el.b * el.b) / (el.a * el.a);
  const r = Math.hypot(p.x, p.y);
  let lat = Math.atan2(p.z, r * (1 - e2));
  for (let i = 0; i < 10; i++) {
    const nu = el.a / Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
    lat = Math.atan2(p.z + e2 * nu * Math.sin(lat), r);
  }
  return { lat: lat / RAD, lng: Math.atan2(p.y, p.x) / RAD };
}

/** WGS84 latitude/longitude to OSGB36 latitude/longitude (degrees). */
export function wgs84ToOsgb36(lat: number, lng: number): { lat: number; lng: number } {
  const p = toCartesian(lat, lng, WGS84);
  const { tx, ty, tz, s } = HELMERT;
  const sec = RAD / 3600;
  const rx = HELMERT.rx * sec;
  const ry = HELMERT.ry * sec;
  const rz = HELMERT.rz * sec;
  const q = {
    x: tx + (1 + s) * p.x - rz * p.y + ry * p.z,
    y: ty + rz * p.x + (1 + s) * p.y - rx * p.z,
    z: tz - ry * p.x + rx * p.y + (1 + s) * p.z,
  };
  return fromCartesian(q, AIRY1830);
}

/** OSGB36 latitude/longitude (degrees) to National Grid easting and northing (metres). */
export function osgb36ToGrid(latDeg: number, lngDeg: number): GridRef {
  const { a, b } = AIRY1830;
  const lat = latDeg * RAD;
  const lng = lngDeg * RAD;
  const e2 = 1 - (b * b) / (a * a);
  const n = (a - b) / (a + b);
  const sin = Math.sin(lat);
  const cos = Math.cos(lat);
  const tan = Math.tan(lat);
  const nu = (a * F0) / Math.sqrt(1 - e2 * sin * sin);
  const rho = (a * F0 * (1 - e2)) / (1 - e2 * sin * sin) ** 1.5;
  const eta2 = nu / rho - 1;
  const dLat = lat - LAT0;
  const sLat = lat + LAT0;
  const M =
    b *
    F0 *
    ((1 + n + (5 / 4) * n ** 2 + (5 / 4) * n ** 3) * dLat -
      (3 * n + 3 * n ** 2 + (21 / 8) * n ** 3) * Math.sin(dLat) * Math.cos(sLat) +
      ((15 / 8) * n ** 2 + (15 / 8) * n ** 3) * Math.sin(2 * dLat) * Math.cos(2 * sLat) -
      (35 / 24) * n ** 3 * Math.sin(3 * dLat) * Math.cos(3 * sLat));
  const I = M + N0;
  const II = (nu / 2) * sin * cos;
  const III = (nu / 24) * sin * cos ** 3 * (5 - tan ** 2 + 9 * eta2);
  const IIIA = (nu / 720) * sin * cos ** 5 * (61 - 58 * tan ** 2 + tan ** 4);
  const IV = nu * cos;
  const V = (nu / 6) * cos ** 3 * (nu / rho - tan ** 2);
  const VI = (nu / 120) * cos ** 5 * (5 - 18 * tan ** 2 + tan ** 4 + 14 * eta2 - 58 * tan ** 2 * eta2);
  const dL = lng - LON0;
  return {
    n: I + II * dL ** 2 + III * dL ** 4 + IIIA * dL ** 6,
    e: E0 + IV * dL + V * dL ** 3 + VI * dL ** 5,
  };
}

/** GPS position to British National Grid (metres), good to a few metres. */
export function wgs84ToGrid(lat: number, lng: number): GridRef {
  const o = wgs84ToOsgb36(lat, lng);
  return osgb36ToGrid(o.lat, o.lng);
}
