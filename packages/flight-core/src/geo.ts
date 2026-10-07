// Small-area geometry. Gardens are tiny, so a flat local grid in metres
// (x = east, y = north) centred on an origin point is accurate to centimetres.

export type LatLng = { lat: number; lng: number };
export type Vec2 = { x: number; y: number };

const EARTH_RADIUS_M = 6_371_000;
const DEG = Math.PI / 180;

export function toLocal(origin: LatLng, p: LatLng): Vec2 {
  return {
    x: (p.lng - origin.lng) * DEG * EARTH_RADIUS_M * Math.cos(origin.lat * DEG),
    y: (p.lat - origin.lat) * DEG * EARTH_RADIUS_M,
  };
}

export function fromLocal(origin: LatLng, v: Vec2): LatLng {
  return {
    lat: origin.lat + v.y / (EARTH_RADIUS_M * DEG),
    lng: origin.lng + v.x / (EARTH_RADIUS_M * DEG * Math.cos(origin.lat * DEG)),
  };
}

export function distanceM(a: LatLng, b: LatLng): number {
  const v = toLocal(a, b);
  return Math.hypot(v.x, v.y);
}

/** Compass bearing from a to b in degrees (0 = north, 90 = east). */
export function bearingDeg(a: LatLng, b: LatLng): number {
  const v = toLocal(a, b);
  return normaliseDeg(Math.atan2(v.x, v.y) / DEG);
}

export function normaliseDeg(d: number): number {
  return ((d % 360) + 360) % 360;
}

export function centroid(polygon: LatLng[]): LatLng {
  const lat = polygon.reduce((s, p) => s + p.lat, 0) / polygon.length;
  const lng = polygon.reduce((s, p) => s + p.lng, 0) / polygon.length;
  return { lat, lng };
}

export function areaM2(polygon: LatLng[]): number {
  const o = polygon[0];
  const pts = polygon.map((p) => toLocal(o, p));
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

export function pointInPolygon(p: Vec2, polygon: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

function distanceToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Distance from a point to a polygon in metres; 0 when the point is inside. */
export function distanceToPolygonM(p: LatLng, polygon: LatLng[]): number {
  const o = polygon[0];
  const pts = polygon.map((q) => toLocal(o, q));
  const lp = toLocal(o, p);
  if (pointInPolygon(lp, pts)) return 0;
  let best = Infinity;
  for (let i = 0; i < pts.length; i++) {
    best = Math.min(best, distanceToSegment(lp, pts[i], pts[(i + 1) % pts.length]));
  }
  return best;
}

function segmentsIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const cross = (o: Vec2, p: Vec2, q: Vec2) => (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** True when two polygons overlap or touch within `marginM` of each other. */
export function polygonsNear(a: LatLng[], b: LatLng[], marginM = 0): boolean {
  if (a.some((p) => distanceToPolygonM(p, b) <= marginM)) return true;
  if (b.some((p) => distanceToPolygonM(p, a) <= marginM)) return true;
  const o = a[0];
  const la = a.map((p) => toLocal(o, p));
  const lb = b.map((p) => toLocal(o, p));
  for (let i = 0; i < la.length; i++) {
    for (let j = 0; j < lb.length; j++) {
      if (segmentsIntersect(la[i], la[(i + 1) % la.length], lb[j], lb[(j + 1) % lb.length])) return true;
    }
  }
  return false;
}

export function rotate(v: Vec2, angleRad: number): Vec2 {
  const c = Math.cos(angleRad);
  const s = Math.sin(angleRad);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}
