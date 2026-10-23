// Garden design: features on the plan, their shapes, materials, starting styles and editing helpers.

import { area, inHouse, inRing, perimeter, type Plot, type Pt } from "./plot.ts";

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
  | "hottub"
  | "trampoline";

type KindInfo = { label: string; w: number; h: number; fill: string; stroke: string };

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
  trampoline: { label: "Trampoline", w: 3, h: 3, fill: "#2E3A3C", stroke: "#5FB8A0" },
};

export const KIND_ORDER = Object.keys(KINDS) as Kind[];
/** Shapes that can be drawn corner by corner. */
export const DRAWABLE: Kind[] = ["lawn", "bed", "patio", "path", "deck", "meadow", "pond"];

/** [id, name, colour]. Prices are in PRICE_LIST (materials.ts). */
export type Material = [string, string, string];

export const MATERIALS: Partial<Record<Kind, Material[]>> = {
  patio: [
    ["porcelain", "Porcelain slabs", "#D7D3CB"],
    ["sandstone", "Indian sandstone", "#D9C7A3"],
    ["block", "Block paving", "#B98F7A"],
    ["brick", "Reclaimed brick", "#B4624A"],
  ],
  path: [
    ["gravel", "Gravel", "#DCD4C0"],
    ["bark", "Bark chips", "#8A6444"],
    ["stepping", "Stepping stones in gravel", "#C9C2B0"],
  ],
  deck: [
    ["composite", "Composite boards", "#7F7468"],
    ["softwood", "Treated softwood", "#C79E6E"],
    ["hardwood", "Hardwood", "#8E5B3A"],
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

export const isRound = (k: Kind) => k === "tree" || k === "hottub" || k === "trampoline";
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

type Existing = { kind: Kind; label: string; x?: number; y?: number; w?: number; h?: number; pts?: Pt[]; mat?: string; nearHouse?: boolean };

/** The middle of a stepping-stone path, widened to a strip. */
function strip(line: Pt[], half: number): Pt[] {
  return [...line.map(([x, y]): Pt => [x - half, y]), ...line.slice().reverse().map(([x, y]): Pt => [x + half, y])];
}

/**
 * What is already in the owner's garden, measured on the first drone survey's aerial photo
 * (14 Oct 2026; 7 m wide, 33 m rear garden). y is from the far end; the ones marked nearHouse
 * keep their distance from the house if the rear garden's length is changed.
 */
const EXISTING: Existing[] = [
  { kind: "greenhouse", label: "Greenhouse", x: 3.65, y: 3.15, w: 5.9, h: 6.3 },
  { kind: "patio", label: "Concrete base", x: 3.9, y: 8.8, w: 6, h: 5, mat: "porcelain" },
  { kind: "shed", label: "Shed", x: 1.5, y: 9.2, w: 2.6, h: 3.2 },
  { kind: "lawn", label: "Lawn", pts: [[2.5, 11.3], [6.9, 11.3], [6.9, 18.9], [5, 18.9], [4.3, 18], [3.3, 16.8], [2.5, 15.6]] },
  { kind: "path", label: "Stepping-stone path", mat: "stepping", pts: strip([[2.05, 11.3], [2.05, 14.4], [2.6, 15.8], [3.4, 17], [4.2, 18.2], [4.7, 19.4], [4.8, 21], [4.6, 22.5], [4.2, 24]], 0.45) },
  { kind: "trampoline", label: "Trampoline", x: 2, y: 20.9, w: 3, h: 3 },
  { kind: "bed", label: "Planting", x: 5.95, y: 21.45, w: 1.9, h: 5.1 },
  { kind: "tree", label: "Hedge", x: 1, y: 13.5, w: 2, h: 2 },
  { kind: "tree", label: "Hedge", x: 1, y: 17, w: 2, h: 2 },
  { kind: "patio", label: "Brick patio", x: 4, y: 26.5, w: 5.8, h: 5, mat: "block", nearHouse: true },
  { kind: "patio", label: "Patio by the house", x: 4, y: 31, w: 5.8, h: 4, mat: "porcelain", nearHouse: true },
  { kind: "hottub", label: "Hot tub", x: 3.35, y: 32.1, w: 1.7, h: 1.7, nearHouse: true },
  { kind: "tree", label: "Hedge", x: 0.7, y: 26, w: 1.4, h: 1.4, nearHouse: true },
  { kind: "tree", label: "Hedge", x: 0.7, y: 30, w: 1.4, h: 1.4, nearHouse: true },
];

/** The rear garden length EXISTING was measured on. */
const EXISTING_GARDEN_M = 33;

/** What was already in the test garden, where the drone survey showed it. */
export function existingFeatures(plot: Plot, nextId: () => number): Item[] {
  const dy = plot.rearGardenM - EXISTING_GARDEN_M;
  return EXISTING.map((e): Item => {
    const shift = e.nearHouse ? dy : 0;
    const base = { id: nextId(), kind: e.kind, a: 0, exist: true, label: e.label, ...(e.mat ? { mat: e.mat } : {}) };
    if (!e.pts) return { ...base, x: e.x!, y: e.y! + shift, w: e.w!, h: e.h! };
    const shape: Item = { ...base, x: 0, y: 0, w: 0, h: 0, pts: e.pts.map(([x, y]): Pt => [x, y + shift]) };
    const [x0, y0, x1, y1] = bbox(shape);
    const [x, y] = centre(shape);
    return { ...shape, x, y, w: x1 - x0, h: y1 - y0 };
  });
}

type Style = { label: string; desc: string; items: [Kind, number, number, number, number][] };

/** The rear garden length the styles below were laid out for (y from the far end). */
const STYLE_GARDEN_M = 29.5;

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
export function applyStyle(plot: Plot, items: Item[], key: string, nextId: () => number): { items: Item[]; note: string; added: Item[] } {
  const kept = items.filter((i) => i.exist);
  // Styles are laid out for a 29.5 m rear garden; keep them at the same distance from the house.
  const dy = plot.rearGardenM - STYLE_GARDEN_M;
  const added: Item[] = STYLES[key].items.map(([kind, x, y, w, h]) => ({ id: nextId(), kind, x, y: y + dy, w, h, a: 0 }));
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
  /** How many changes can be undone (to take back an entry pushed by mistake, see `dropTo`). */
  get depth() {
    return this.undoStack.length;
  }
  /** Forget entries pushed since the stack was `depth` long (a tap that turned out to be a pinch). */
  dropTo(depth: number): void {
    this.undoStack.length = Math.min(this.undoStack.length, depth);
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
