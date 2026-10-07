// Sun position and shadows across the garden, from the house, next door, fences, trees and sheds.

import { corners, samplePoints, type Item } from "./design.ts";
import { planVector, type Plot, type Pt } from "./plot.ts";

const RAD = Math.PI / 180;

export type Month = { id: string; label: string; day: number };
export const MONTHS: Month[] = [
  { id: "mar", label: "March", day: 79 },
  { id: "jun", label: "June", day: 172 },
  { id: "sep", label: "September", day: 265 },
  { id: "dec", label: "December", day: 355 },
];

export const compass = (a: number) =>
  ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"][Math.round((((a % 360) + 360) % 360) / 45) % 8];

/** Sun elevation and compass bearing (degrees) on a day of the year at a solar time (hours). */
export function sunPosition(latitudeDeg: number, day: number, solarHour: number): { el: number; az: number } {
  const d = 23.44 * Math.sin((2 * Math.PI * (284 + day)) / 365) * RAD;
  const h = 15 * (solarHour - 12) * RAD;
  const f = latitudeDeg * RAD;
  const se = Math.sin(f) * Math.sin(d) + Math.cos(f) * Math.cos(d) * Math.cos(h);
  const el = Math.asin(se);
  let az = Math.acos(Math.max(-1, Math.min(1, (Math.sin(d) - se * Math.sin(f)) / (Math.cos(el) * Math.cos(f))))) / RAD;
  if (h > 0) az = 360 - az;
  return { el: el / RAD, az };
}

/** UK clock time to solar time: British Summer Time from late March to late October. */
export const solarHour = (day: number, clock: number) => clock - (day > 85 && day < 300 ? 1 : 0) + 0.04;

export const clockText = (t: number) => `${Math.floor(t)}:${t % 1 ? "30" : "00"}`;

type Caster = { P: Pt[]; h: number };

function casters(plot: Plot, items: Item[]): Caster[] {
  const R = (x: number, y: number, w: number, h: number): Pt[] => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  const { widthM: W, rearGardenM: GH, houseDepthM: HD, houseWidthM: HW } = plot;
  const c: Caster[] = [
    { P: R(0, GH, HW, HD), h: 7 },
    { P: R(-5.8, GH, 5.8, HD), h: 7 }, // next door, joined on
    { P: R(W + 1, GH, 5.8, HD), h: 7 }, // the house across the side passage
    { P: R(-0.05, 0, 0.1, GH), h: 1.8 }, // fences
    { P: R(W - 0.05, 0, 0.1, GH), h: 1.8 },
    { P: R(0, -0.05, W, 0.1), h: 1.8 },
  ];
  for (const i of items) {
    if (i.kind === "shed") c.push({ P: corners(i), h: 2.3 });
    if (i.kind === "greenhouse") c.push({ P: corners(i), h: 2.2 });
  }
  return c;
}

export function convexHull(points: Pt[]): Pt[] {
  const P = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: Pt[] = [];
  const up: Pt[] = [];
  for (const p of P) {
    while (lo.length > 1 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop();
    lo.push(p);
  }
  for (const p of P.slice().reverse()) {
    while (up.length > 1 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop();
    up.push(p);
  }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}

export type Shadows = { polys: Pt[][]; trees: { x: number; y: number; r: number }[] };

/** Shadows on the plan for a sun position, or null when the sun is down. */
export function shadows(plot: Plot, items: Item[], sun: { el: number; az: number }): Shadows | null {
  if (sun.el <= 1) return null;
  const k = 1 / Math.tan(sun.el * RAD);
  const d = planVector(plot, sun.az);
  const v: Pt = [-d[0] * k, -d[1] * k];
  const polys = casters(plot, items).map((c) => convexHull(c.P.concat(c.P.map((p) => [p[0] + v[0] * c.h, p[1] + v[1] * c.h] as Pt))));
  const trees = items.filter((i) => i.kind === "tree").map((i) => ({ x: i.x + v[0] * 4.5, y: i.y + v[1] * 4.5, r: i.w / 2 }));
  return { polys, trees };
}

function inConvex(P: Pt[], x: number, y: number): boolean {
  let s = 0;
  for (let i = 0; i < P.length; i++) {
    const a = P[i];
    const b = P[(i + 1) % P.length];
    const c = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
    if (c !== 0) {
      if (s && Math.sign(c) !== s) return false;
      s = Math.sign(c);
    }
  }
  return true;
}

export const isShaded = (sh: Shadows, x: number, y: number) =>
  sh.polys.some((P) => inConvex(P, x, y)) || sh.trees.some((t) => Math.hypot(x - t.x, y - t.y) < t.r);

/** Shadows every half hour while the sun is up. */
export function daySteps(plot: Plot, items: Item[], day: number): Shadows[] {
  const steps: Shadows[] = [];
  for (let t = 4; t <= 21; t += 0.5) {
    const s = sunPosition(plot.latitudeDeg, day, t);
    if (s.el >= 3) {
      const sh = shadows(plot, items, s);
      if (sh) steps.push(sh);
    }
  }
  return steps;
}

/** Average hours of direct sun over some points on a day. */
export function sunHoursAt(plot: Plot, items: Item[], day: number, pts: Pt[]): number {
  let h = 0;
  for (const sh of daySteps(plot, items, day)) h += (0.5 * pts.filter((p) => !isShaded(sh, p[0], p[1])).length) / pts.length;
  return h;
}

export type SunClass = "sun" | "part" | "shade";
export const SUN_LABEL: Record<SunClass, string> = { sun: "Full sun", part: "Part shade", shade: "Shade" };

/** How sunny a bed is on an average day from spring to autumn. */
export function bedSun(plot: Plot, items: Item[], it: Item): { hours: number; cls: SunClass } {
  const pts = samplePoints(it);
  const hours = (sunHoursAt(plot, items, 172, pts) + sunHoursAt(plot, items, 265, pts)) / 2;
  return { hours, cls: hours >= 6 ? "sun" : hours >= 3 ? "part" : "shade" };
}

export type SunHoursBand = "6plus" | "3to6" | "under3";

/** Hours of sun on a 50 cm grid over the rear garden, for one month. */
export function sunHoursGrid(plot: Plot, items: Item[], day: number): { x: number; y: number; band: SunHoursBand }[] {
  const steps = daySteps(plot, items, day);
  const out: { x: number; y: number; band: SunHoursBand }[] = [];
  for (let x = 0; x < plot.widthM - 0.01; x += 0.5) {
    for (let y = 0; y < plot.rearGardenM - 0.01; y += 0.5) {
      let h = 0;
      for (const sh of steps) if (!isShaded(sh, x + 0.25, y + 0.25)) h += 0.5;
      out.push({ x, y, band: h >= 6 ? "6plus" : h >= 3 ? "3to6" : "under3" });
    }
  }
  return out;
}

export function sunText(plot: Plot, day: number, clock: number): string {
  const s = sunPosition(plot.latitudeDeg, day, solarHour(day, clock));
  return s.el > 1 ? `The sun is in the ${compass(s.az)}, ${Math.round(s.el)}° above the horizon.` : "The sun is down at this time.";
}
