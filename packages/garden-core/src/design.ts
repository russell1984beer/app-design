// Garden design: features on the plan, their shapes, materials, starting styles and editing helpers.

import { area, inHouse, perimeter, type Plot, type Pt } from "./plot.ts";

export type Kind =
  | "patio"
  | "lawn"
  | "bed"
  | "raised"
  | "path"
  | "deck"
  | "pond"
  | "meadow"
  | "shed"
  | "tree"
  | "greenhouse"
  | "hottub";

export type KindInfo = { label: string; w: number; h: number; fill: string; stroke: string };

export const KINDS: Record<Kind, KindInfo> = {
  patio: { label: "Patio", w: 4.2, h: 3.6, fill: "#CFC6B3", stroke: "#7D7462" },
  lawn: { label: "Lawn", w: 6, h: 5, fill: "#9CC077", stroke: "#5E7F4E" },
  bed: { label: "Planting bed", w: 3, h: 1.2, fill: "#86644A", stroke: "#4F3826" },
  raised: { label: "Raised bed", w: 2.4, h: 1.2, fill: "#8A6A4C", stroke: "#5A3F28" },
  path: { label: "Gravel path", w: 1, h: 6, fill: "#DCD4C0", stroke: "#9C927B" },
  deck: { label: "Decking", w: 4, h: 3, fill: "#B88B5E", stroke: "#7A5733" },
  pond: { label: "Pond", w: 2.4, h: 1.6, fill: "#5D97BC", stroke: "#2F6688" },
  meadow: { label: "Wildflower meadow", w: 5, h: 4, fill: "#C3CC86", stroke: "#7E8C45" },
  shed: { label: "Shed", w: 2.4, h: 1.8, fill: "#7D8A80", stroke: "#4C5750" },
  tree: { label: "Tree", w: 3.2, h: 3.2, fill: "#5C8A50", stroke: "#2F4D2A" },
  greenhouse: { label: "Greenhouse", w: 2.2, h: 3, fill: "#DCE6E4", stroke: "#7E9296" },
  hottub: { label: "Hot tub", w: 2.1, h: 2.1, fill: "#4B6670", stroke: "#2E3F45" },
};

export const KIND_ORDER = Object.keys(KINDS) as Kind[];
/** Shapes that can be drawn corner by corner. */
export const DRAWABLE: Kind[] = ["lawn", "bed", "patio", "path", "deck", "meadow", "pond"];

/** [id, name, colour, price per m² where it applies] */
export type Material = [string, string, string, number?];

export const MATERIALS: Partial<Record<Kind, Material[]>> = {
  patio: [
    ["porcelain", "Porcelain slabs", "#D7D3CB", 38],
    ["sandstone", "Indian sandstone", "#D9C7A3", 30],
    ["block", "Block paving", "#B98F7A", 28],
    ["brick", "Reclaimed brick", "#B4624A", 45],
  ],
  path: [
    ["gravel", "Gravel", "#DCD4C0"],
    ["bark", "Bark chips", "#8A6444"],
    ["stepping", "Stepping stones in gravel", "#C9C2B0"],
  ],
  deck: [
    ["composite", "Composite boards", "#7F7468", 95],
    ["softwood", "Treated softwood", "#C79E6E", 45],
    ["hardwood", "Hardwood", "#8E5B3A", 120],
  ],
  lawn: [
    ["turf", "Turf", "#9CC077"],
    ["seed", "Grass seed", "#B3CF8E"],
    ["artificial", "Artificial grass", "#6FBF5A"],
  ],
  raised: [
    ["sleeper", "Timber sleepers", "#8A6A4C"],
    ["corten", "Corten steel", "#9A5B3A"],
  ],
  bed: [
    ["steel", "Steel edging", "#86644A"],
    ["timber", "Timber edging", "#86644A"],
    ["none", "No edging", "#86644A"],
  ],
  shed: [
    ["timber", "Timber", "#7D8A80"],
    ["metal", "Metal", "#9AA3A6"],
  ],
};

/**
 * A feature on the plan. Most are a rectangle or circle centred on x, y with width w, length h and
 * angle a (degrees). Drawn shapes have their own corners in pts instead.
 */
export type Item = {
  id: number;
  kind: Kind;
  x: number;
  y: number;
  w: number;
  h: number;
  a: number;
  pts?: Pt[];
  mat?: string;
  /** Already in the garden, so not counted in materials. */
  exist?: boolean;
  label?: string;
  plants?: string[];
};

export const isRound = (k: Kind) => k === "tree" || k === "hottub";
export const isOval = (k: Kind) => isRound(k) || k === "pond";

export function materialOf(it: Item): Material | null {
  const m = MATERIALS[it.kind];
  return m ? (m.find((x) => x[0] === it.mat) ?? m[0]) : null;
}

export function fillOf(it: Item): string {
  return materialOf(it)?.[2] ?? KINDS[it.kind].fill;
}

export function rotP(x: number, y: number, a: number): Pt {
  const c = Math.cos((a * Math.PI) / 180);
  const s = Math.sin((a * Math.PI) / 180);
  return [x * c - y * s, x * s + y * c];
}

/** Centre of a feature (the centroid for drawn shapes). */
export function centre(it: Item): Pt {
  if (!it.pts) return [it.x, it.y];
  const P = it.pts;
  let A = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < P.length; i++) {
    const [a, b] = P[i];
    const [c, d] = P[(i + 1) % P.length];
    const f = a * d - c * b;
    A += f;
    cx += (a + c) * f;
    cy += (b + d) * f;
  }
  if (Math.abs(A) < 1e-6) return [P[0][0], P[0][1]];
  return [cx / (3 * A), cy / (3 * A)];
}

export function corners(it: Item): Pt[] {
  if (it.pts) return it.pts;
  return ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as Pt[]).map(([sx, sy]) => {
    const r = rotP((sx * it.w) / 2, (sy * it.h) / 2, it.a);
    return [it.x + r[0], it.y + r[1]];
  });
}

/** A plan point in the feature's own unrotated frame, relative to its centre. */
export const localOf = (it: Item, p: Pt): Pt => rotP(p[0] - it.x, p[1] - it.y, -it.a);

export function inRing(P: Pt[], x: number, y: number): boolean {
  let c = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const [a, b] = P[i];
    const [d, e] = P[j];
    if (b > y !== e > y && x < ((d - a) * (y - b)) / (e - b) + a) c = !c;
  }
  return c;
}

export function inItem(it: Item, x: number, y: number): boolean {
  if (it.pts) return inRing(it.pts, x, y);
  const l = localOf(it, [x, y]);
  if (isOval(it.kind)) return (l[0] / (it.w / 2)) ** 2 + (l[1] / (it.h / 2)) ** 2 <= 1;
  return Math.abs(l[0]) <= it.w / 2 && Math.abs(l[1]) <= it.h / 2;
}

export function itemArea(it: Item): number {
  if (it.pts) return area(it.pts);
  if (isOval(it.kind)) return (Math.PI * it.w * it.h) / 4;
  return it.w * it.h;
}

export function itemPerimeter(it: Item): number {
  if (it.pts) return perimeter(it.pts);
  return 2 * (it.w + it.h);
}

export function bbox(it: Item): [number, number, number, number] {
  const P: Pt[] = it.pts ?? (isRound(it.kind) ? [[it.x - it.w / 2, it.y - it.h / 2], [it.x + it.w / 2, it.y + it.h / 2]] : corners(it));
  const xs = P.map((p) => p[0]);
  const ys = P.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

export const itemName = (it: Item) =>
  it.label || (it.exist ? `Existing ${KINDS[it.kind].label.toLowerCase()}` : KINDS[it.kind].label);

export function sizeText(it: Item): string {
  if (it.pts) return `${itemArea(it).toFixed(1)} m²`;
  if (isRound(it.kind)) return `${it.w.toFixed(1)} m across`;
  return `${it.w.toFixed(1)} × ${it.h.toFixed(1)} m`;
}

/** Nudge a feature back inside the plot. */
export function clampToPlot(plot: Plot, it: Item): void {
  const [x0, y0, x1, y1] = bbox(it);
  let dx = 0;
  let dy = 0;
  if (x0 < 0) dx = -x0;
  else if (x1 > plot.widthM) dx = plot.widthM - x1;
  if (y0 < 0) dy = -y0;
  else if (y1 > plot.lengthM) dy = plot.lengthM - y1;
  if (it.pts) it.pts = it.pts.map((p) => [p[0] + dx, p[1] + dy]);
  else {
    it.x += dx;
    it.y += dy;
  }
}

/** A few points spread over a feature, for sampling sun and shade. */
export function samplePoints(it: Item): Pt[] {
  const c = centre(it);
  const P = corners(it);
  const k = Math.max(1, Math.floor(P.length / 4));
  const out: Pt[] = [c];
  for (let i = 0; i < P.length && out.length < 5; i += k) out.push([(P[i][0] + c[0]) / 2, (P[i][1] + c[1]) / 2]);
  return out;
}

/** What was already in the test garden: the patio, hot tub, greenhouse and trees. */
export function existingFeatures(plot: Plot, nextId: () => number): Item[] {
  const W = plot.widthM;
  const GH = plot.rearGardenM;
  const base = { a: 0, exist: true };
  const items: Item[] = [
    { ...base, id: nextId(), kind: "patio", x: W / 2, y: GH - 3, w: W, h: 6, mat: "sandstone" },
    { ...base, id: nextId(), kind: "hottub", x: W - 1.3, y: GH - 1.3, w: 2.1, h: 2.1 },
    { ...base, id: nextId(), kind: "greenhouse", x: W - 1.7, y: GH - 8.5, w: 2.2, h: 3 },
  ];
  for (const [x, y, w] of EXISTING_TREES) items.push({ ...base, id: nextId(), kind: "tree", x, y, w, h: w });
  return items;
}

export const EXISTING_TREES: [number, number, number][] = [
  [3, 4, 3.2],
  [4.8, 9.5, 2.2],
  [2.4, 13, 2.8],
  [1.6, 18.5, 1.8],
];

export type Style = { label: string; desc: string; items: [Kind, number, number, number, number][] };

export const STYLES: Record<string, Style> = {
  family: {
    label: "Family garden",
    desc: "Lawn for play, a patio, veg beds and a shed",
    items: [["patio", 3.5, 27.4, 6.6, 3.8], ["lawn", 3.8, 17.5, 4.6, 11], ["bed", 0.75, 17.5, 1.1, 11], ["path", 6.6, 14.5, 0.7, 21], ["raised", 4.6, 7, 2.4, 1.2], ["raised", 4.6, 4.6, 2.4, 1.2], ["shed", 1.6, 1.3, 2.6, 2]],
  },
  low: {
    label: "Low maintenance",
    desc: "Big patio, gravel and shrubs, with no lawn to mow",
    items: [["patio", 3.5, 26.9, 6.6, 4.8], ["path", 3.5, 16, 1, 16], ["bed", 1.5, 20, 2.2, 7], ["bed", 5.5, 20, 2.2, 7], ["bed", 1.5, 12, 2.2, 6], ["bed", 5.6, 12, 2, 6], ["deck", 3.5, 3.5, 6, 3.6]],
  },
  wildlife: {
    label: "Wildlife garden",
    desc: "A pond in the low spot, meadow and native planting",
    items: [["patio", 3.5, 27.8, 5, 3], ["pond", 2.6, 20.2, 2.6, 1.8], ["meadow", 3.5, 12, 6.6, 8], ["bed", 4.9, 21, 1.6, 4], ["path", 6.6, 14, 0.7, 18], ["tree", 5.5, 3, 3, 3], ["bed", 1.6, 3, 2.6, 3]],
  },
  party: {
    label: "Entertaining",
    desc: "A patio by the house and a deck down the garden for evenings outside",
    items: [["patio", 3.5, 27.2, 6.6, 4.4], ["lawn", 3.5, 19, 6.6, 7], ["deck", 3.5, 11.5, 6, 4], ["bed", 1.2, 6, 2, 5], ["bed", 5.8, 6, 2, 5], ["shed", 3.5, 1.4, 2.4, 1.8]],
  },
};

/**
 * Replace the new features with a style's layout. Existing features stay, unless a hard
 * feature of the style (patio, deck, shed, pond) is built on top of them.
 */
export function applyStyle(items: Item[], key: string, nextId: () => number): { items: Item[]; note: string; added: Item[] } {
  const kept = items.filter((i) => i.exist);
  const added: Item[] = STYLES[key].items.map(([kind, x, y, w, h]) => ({ id: nextId(), kind, x, y, w, h, a: 0 }));
  const hard = added.filter((i) => ["patio", "deck", "shed", "pond"].includes(i.kind));
  const remaining = kept.filter((t) => {
    const c = centre(t);
    return !hard.some((i) => inItem(i, c[0], c[1]));
  });
  const gone = kept.length - remaining.length;
  const note = gone ? `${gone} existing feature${gone > 1 ? "s were" : " was"} removed to make room.` : "Existing features are kept.";
  return { items: [...remaining, ...added], note, added };
}

export function newItem(plot: Plot, kind: Kind, at: Pt, id: number): Item | null {
  if (at[0] < 0 || at[0] > plot.widthM || at[1] < 0 || at[1] > plot.lengthM || inHouse(plot, at[0], at[1])) return null;
  const K = KINDS[kind];
  const it: Item = { id, kind, x: at[0], y: at[1], w: K.w, h: K.h, a: 0 };
  clampToPlot(plot, it);
  return it;
}

export function rotate90(plot: Plot, it: Item): void {
  if (it.pts) {
    const c = centre(it);
    it.pts = it.pts.map((p) => {
      const r = rotP(p[0] - c[0], p[1] - c[1], 90);
      return [c[0] + r[0], c[1] + r[1]];
    });
  } else it.a = (it.a + 90) % 360;
  clampToPlot(plot, it);
}

export function duplicate(plot: Plot, it: Item, id: number): Item {
  const n: Item = JSON.parse(JSON.stringify(it));
  n.id = id;
  delete n.exist;
  if (n.pts) n.pts = n.pts.map((p) => [p[0] + 0.6, p[1] + 0.6]);
  else {
    n.x += 0.6;
    n.y += 0.6;
  }
  clampToPlot(plot, n);
  return n;
}

/** Undo and redo over the list of features. */
export class History {
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  get canUndo() {
    return this.undoStack.length > 0;
  }
  get canRedo() {
    return this.redoStack.length > 0;
  }
  /** Call before a change, with the features as they are now. */
  push(items: Item[] | string): void {
    this.undoStack.push(typeof items === "string" ? items : JSON.stringify(items));
    if (this.undoStack.length > 60) this.undoStack.shift();
    this.redoStack = [];
  }
  undo(current: Item[]): Item[] | null {
    const prev = this.undoStack.pop();
    if (prev === undefined) return null;
    this.redoStack.push(JSON.stringify(current));
    return JSON.parse(prev);
  }
  redo(current: Item[]): Item[] | null {
    const next = this.redoStack.pop();
    if (next === undefined) return null;
    this.undoStack.push(JSON.stringify(current));
    return JSON.parse(next);
  }
}
