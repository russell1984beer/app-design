// Zooming and moving the map: which part of the plan (the SVG viewBox) is on screen. Kept apart
// from the map's drawing so the sums can be tested.

/** [x, y, width, height] in plan metres. */
export type VB = [number, number, number, number];

/** How far in it zooms: k = 1 shows the whole plot, MAX_ZOOM is 8 times closer. */
export const MAX_ZOOM = 8;

/** Zoom level and the plan point in the middle of the view (null: the middle of the whole plot). */
export type Zoom = { k: number; c: [number, number] | null };

export const NO_ZOOM: Zoom = { k: 1, c: null };

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** The part of the plan on screen; the middle is kept inside the whole plot's view. */
export function zoomedView(base: VB, z: Zoom): VB {
  const k = clamp(z.k, 1, MAX_ZOOM);
  if (k === 1) return base;
  const w = base[2] / k;
  const h = base[3] / k;
  const cx = clamp(z.c?.[0] ?? base[0] + base[2] / 2, base[0] + w / 2, base[0] + base[2] - w / 2);
  const cy = clamp(z.c?.[1] ?? base[1] + base[3] / 2, base[1] + h / 2, base[1] + base[3] - h / 2);
  return [cx - w / 2, cy - h / 2, w, h];
}

/** How a view sits on a screen of size w x h (fitted whole, centred): pixels per metre and the offsets. */
export function fit(vb: VB, w: number, h: number): { scale: number; ox: number; oy: number } {
  const scale = w > 0 && h > 0 ? Math.min(w / vb[2], h / vb[3]) : 1;
  return { scale, ox: (w - vb[2] * scale) / 2, oy: (h - vb[3] * scale) / 2 };
}

/** Screen point to plan point. */
export function toPlan(vb: VB, w: number, h: number, sx: number, sy: number): [number, number] {
  const f = fit(vb, w, h);
  return [vb[0] + (sx - f.ox) / f.scale, vb[1] + (sy - f.oy) / f.scale];
}

/**
 * The zoom that puts plan point `p` under screen point (sx, sy) at zoom level k: what a pinch does
 * (the spot between the fingers stays under them while they spread or move).
 */
export function zoomAt(base: VB, w: number, h: number, k: number, p: [number, number], sx: number, sy: number): Zoom {
  const kk = clamp(k, 1, MAX_ZOOM);
  if (kk === 1) return NO_ZOOM;
  const vw = base[2] / kk;
  const vh = base[3] / kk;
  const f = fit([0, 0, vw, vh], w, h);
  const x = p[0] - (sx - f.ox) / f.scale;
  const y = p[1] - (sy - f.oy) / f.scale;
  return { k: kk, c: [x + vw / 2, y + vh / 2] };
}
