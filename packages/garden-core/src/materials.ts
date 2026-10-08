// Material quantities and rough costs for each new feature, from the measured plan and levels.

import { KINDS, bbox, centre, inItem, isRound, itemArea, itemName, itemPerimeter, materialOf, type Item } from "./design.ts";
import { PLANT_BY_ID, plantCount } from "./plants.ts";
import type { Terrain } from "./plot.ts";

/** Cut and fill to level a feature to its average height, on a 25 cm grid. Volumes in m³, fall in m. */
export function levelling(it: Item, z: Terrain): { cut: number; fill: number; fall: number } {
  const [x0, y0, x1, y1] = bbox(it);
  const v: number[] = [];
  for (let x = x0 + 0.125; x < x1; x += 0.25) for (let y = y0 + 0.125; y < y1; y += 0.25) if (inItem(it, x, y)) v.push(z(x, y));
  if (!v.length) {
    const c = centre(it);
    v.push(z(c[0], c[1]));
  }
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  let cut = 0;
  let fill = 0;
  for (const h of v) {
    if (h > m) cut += h - m;
    else fill += m - h;
  }
  return { cut: cut * 0.0625, fill: fill * 0.0625, fall: Math.max(...v) - Math.min(...v) };
}

export const gbp = (n: number) => "£" + Math.round(n).toLocaleString("en-GB");

export type Quantity = { title: string; lines: [string, string][]; cost: number };

/** Unit prices used for the estimates, in pounds. The owner can change any of them. */
export type PriceItem = { id: string; label: string; unit: string; price: number };

export const PRICE_LIST: PriceItem[] = [
  { id: "patio:porcelain", label: "Porcelain slabs", unit: "m²", price: 38 },
  { id: "patio:sandstone", label: "Indian sandstone", unit: "m²", price: 30 },
  { id: "patio:block", label: "Block paving", unit: "m²", price: 28 },
  { id: "patio:brick", label: "Reclaimed brick", unit: "m²", price: 45 },
  { id: "deck:composite", label: "Composite decking, laid", unit: "m²", price: 95 },
  { id: "deck:softwood", label: "Softwood decking, laid", unit: "m²", price: 45 },
  { id: "deck:hardwood", label: "Hardwood decking, laid", unit: "m²", price: 120 },
  { id: "mot", label: "MOT Type 1 sub-base", unit: "tonne", price: 45 },
  { id: "bedding", label: "Sand and cement / sharp sand", unit: "tonne", price: 60 },
  { id: "topsoil", label: "Topsoil", unit: "tonne", price: 45 },
  { id: "turf", label: "Turf", unit: "roll", price: 4.5 },
  { id: "seed", label: "Lawn seed", unit: "m² sown", price: 0.6 },
  { id: "artificial", label: "Artificial grass", unit: "m²", price: 20 },
  { id: "membrane", label: "Weed membrane", unit: "m²", price: 1.3 },
  { id: "compost", label: "Compost / soil mix", unit: "m³", price: 55 },
  { id: "plant", label: "Plants (average)", unit: "each", price: 7 },
  { id: "sleeper", label: "Timber sleeper", unit: "each", price: 32 },
  { id: "corten", label: "Corten steel bed sides", unit: "m", price: 60 },
  { id: "edgeSteel", label: "Steel edging", unit: "m", price: 4 },
  { id: "edgeTimber", label: "Timber edging", unit: "m", price: 2.5 },
  { id: "bark", label: "Bark chips", unit: "m³", price: 60 },
  { id: "gravel", label: "Gravel", unit: "tonne", price: 70 },
  { id: "stepping", label: "Stepping stone", unit: "each", price: 12 },
  { id: "pathEdge", label: "Path edging", unit: "m", price: 4 },
  { id: "liner", label: "Pond liner and underlay", unit: "m²", price: 9 },
  { id: "pondExtras", label: "Pond extras (fixed)", unit: "pond", price: 80 },
  { id: "tree", label: "Semi-mature tree with stake and mulch", unit: "each", price: 140 },
  { id: "shedTimber", label: "Timber shed", unit: "each", price: 650 },
  { id: "shedMetal", label: "Metal shed", unit: "each", price: 450 },
  { id: "slabBase", label: "Paving slab base", unit: "m²", price: 30 },
  { id: "wildflower", label: "Wildflower seed and preparation", unit: "m²", price: 3 },
  { id: "wildflowerFixed", label: "Wildflower meadow extras (fixed)", unit: "meadow", price: 25 },
  { id: "greenhouse", label: "Greenhouse", unit: "each", price: 600 },
  { id: "hottub", label: "Hot tub", unit: "each", price: 3500 },
  { id: "pad", label: "Concrete pad", unit: "m²", price: 12 },
];

export type Prices = Record<string, number>;
export const DEFAULT_PRICES: Prices = Object.fromEntries(PRICE_LIST.map((p) => [p.id, p.price]));

export function quantities(it: Item, z: Terrain, prices: Prices = DEFAULT_PRICES): Quantity {
  const P = (id: string) => prices[id] ?? DEFAULT_PRICES[id] ?? 0;
  const A = itemArea(it);
  const per = itemPerimeter(it);
  const m = materialOf(it);
  const shape = it.pts ? "custom shape" : isRound(it.kind) ? `${it.w.toFixed(1)} m across` : `${it.w.toFixed(1)} × ${it.h.toFixed(1)} m`;
  const title = `${itemName(it)}, ${shape}`;
  const ar: [string, string] = ["Area", `${A.toFixed(1)} m²`];
  const mat = m?.[0];
  const price = P(`${it.kind}:${m?.[0]}`);
  switch (it.kind) {
    case "patio": {
      const L = levelling(it, z);
      const t1 = A * 0.15 * 2.1;
      const t2 = A * 0.04 * 1.9;
      const unit: [string, string] =
        mat === "block"
          ? ["Block paving", `${Math.ceil(A * 50 * 1.05)} blocks`]
          : mat === "brick"
            ? ["Reclaimed bricks", `${Math.ceil(A * 60 * 1.05)} bricks`]
            : [`${m?.[1]}, 600 × 600`, `${Math.ceil((A / 0.36) * 1.05)} slabs`];
      return {
        title,
        lines: [
          ar,
          unit,
          ["MOT Type 1 sub-base, 150 mm", `${t1.toFixed(1)} t`],
          [mat === "block" ? "Sharp sand bed" : "Sand and cement bed", `${t2.toFixed(1)} t`],
          [`Levelling (ground falls ${(L.fall * 100).toFixed(0)} cm)`, `${L.cut.toFixed(2)} m³ cut, ${L.fill.toFixed(2)} m³ fill`],
        ],
        cost: A * price + t1 * P("mot") + t2 * P("bedding"),
      };
    }
    case "lawn": {
      if (mat === "seed") {
        return { title, lines: [ar, ["Lawn seed, 35 g/m²", `${Math.ceil(A * 35)} g`], ["Topsoil, 50 mm", `${(A * 0.07).toFixed(1)} t`]], cost: A * P("seed") + A * 0.07 * P("topsoil") };
      }
      if (mat === "artificial") {
        return {
          title,
          lines: [ar, ["Artificial grass", `${Math.ceil(A * 1.1)} m²`], ["Sub-base and sand", `${(A * 0.2).toFixed(1)} t`], ["Weed membrane", `${Math.ceil(A * 1.1)} m²`]],
          cost: A * 1.1 * P("artificial") + A * 0.2 * P("mot") + A * 1.1 * P("membrane"),
        };
      }
      const t = A * 0.05 * 1.4;
      return { title, lines: [ar, ["Turf rolls (1 m²)", `${Math.ceil(A * 1.05)} rolls`], ["Topsoil, 50 mm", `${t.toFixed(1)} t`]], cost: Math.ceil(A * 1.05) * P("turf") + t * P("topsoil") };
    }
    case "bed":
    case "raised": {
      const raised = it.kind === "raised";
      const compost = A * (raised ? 0.35 : 0.2);
      const plants = (it.plants ?? []).map((id) => [PLANT_BY_ID[id].name, plantCount(it, id)] as const);
      const nPlants = plants.reduce((a, b) => a + b[1], 0);
      const sleepers = Math.ceil(per / 2.4) * 2;
      const lines: [string, string][] = [
        ar,
        [raised ? "Topsoil and compost mix" : "Compost, 200 mm", `${compost.toFixed(2)} m³`],
        ...plants.map(([name, n]) => [name, `${n} plants`] as [string, string]),
      ];
      let edging = 0;
      if (raised) {
        if (mat === "corten") {
          lines.push(["Corten steel sides, 400 mm", `${per.toFixed(1)} m`]);
          edging = per * P("corten");
        } else {
          lines.push(["Timber sleepers, 2 high", `${sleepers} sleepers`]);
          edging = sleepers * P("sleeper");
        }
      } else if (mat !== "none") {
        lines.push([m?.[1] ?? "Edging", `${per.toFixed(1)} m`]);
        edging = per * P(mat === "steel" ? "edgeSteel" : "edgeTimber");
      }
      return { title, lines, cost: compost * P("compost") + nPlants * P("plant") + edging };
    }
    case "path": {
      if (mat === "bark") {
        const v = A * 0.075;
        return { title, lines: [ar, ["Bark chips, 75 mm", `${v.toFixed(2)} m³`], ["Weed membrane", `${Math.ceil(A * 1.1)} m²`]], cost: v * P("bark") + Math.ceil(A * 1.1) * P("membrane") };
      }
      if (mat === "stepping") {
        const n = Math.ceil(A / 0.7);
        const g = A * 0.05 * 1.7;
        return { title, lines: [ar, ["Stepping stones, 450 mm", `${n} stones`], ["Gravel, 50 mm", `${g.toFixed(2)} t`]], cost: n * P("stepping") + g * P("gravel") };
      }
      const g = A * 0.05 * 1.7;
      return {
        title,
        lines: [ar, ["Gravel, 50 mm", `${g.toFixed(2)} t`], ["Weed membrane", `${Math.ceil(A * 1.1)} m²`], ["Edging", `${per.toFixed(1)} m`]],
        cost: g * P("gravel") + Math.ceil(A * 1.1) * P("membrane") + per * P("pathEdge"),
      };
    }
    case "deck":
      return {
        title,
        lines: [ar, [`${m?.[1]}, 3.6 m`, `${Math.ceil((A * 1.1) / 0.53)} boards`], ["Joists at 400 mm centres", `${Math.ceil((A / 0.4) * 1.1)} m`], ["Ground screws", `${Math.ceil(A / 1.2)} screws`]],
        cost: A * price,
      };
    case "pond": {
      const d = 0.6;
      const [x0, y0, x1, y1] = bbox(it);
      const lw = x1 - x0 + 2 * d + 0.6;
      const lh = y1 - y0 + 2 * d + 0.6;
      const size = `${lw.toFixed(1)} × ${lh.toFixed(1)} m`;
      return {
        title,
        lines: [["Surface area", `${A.toFixed(1)} m²`], ["Excavation, 600 mm deep", `${(A * d * 0.75).toFixed(2)} m³`], ["EPDM liner", size], ["Underlay", size]],
        cost: lw * lh * P("liner") + P("pondExtras"),
      };
    }
    case "tree":
      return { title, lines: [["Semi-mature tree", "1"], ["Bark mulch ring", "0.09 m³"], ["Stake and tie kit", "1"]], cost: P("tree") };
    case "shed":
      return { title, lines: [[`${m?.[1]} shed`, "1"], ["Paving slab base", `${A.toFixed(1)} m²`]], cost: P(mat === "metal" ? "shedMetal" : "shedTimber") + A * P("slabBase") };
    case "meadow":
      return { title, lines: [ar, ["Wildflower seed mix, 5 g/m²", `${Math.ceil(A * 5)} g`], ["Seedbed preparation", `${A.toFixed(1)} m²`]], cost: A * P("wildflower") + P("wildflowerFixed") };
    case "greenhouse":
      return { title, lines: [["Greenhouse", "1"], ["Paving slab base", `${A.toFixed(1)} m²`]], cost: P("greenhouse") + A * P("slabBase") };
    case "hottub":
      return { title, lines: [["Hot tub", "1"], ["Concrete pad, 100 mm", `${(A * 0.1).toFixed(2)} m³`]], cost: P("hottub") + A * P("pad") };
  }
}

export const kindLabel = (it: Item) => KINDS[it.kind].label;
