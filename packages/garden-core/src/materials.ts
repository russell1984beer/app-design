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

export function quantities(it: Item, z: Terrain): Quantity {
  const A = itemArea(it);
  const per = itemPerimeter(it);
  const m = materialOf(it);
  const shape = it.pts ? "custom shape" : isRound(it.kind) ? `${it.w.toFixed(1)} m across` : `${it.w.toFixed(1)} × ${it.h.toFixed(1)} m`;
  const title = `${itemName(it)}, ${shape}`;
  const ar: [string, string] = ["Area", `${A.toFixed(1)} m²`];
  const mat = m?.[0];
  const price = m?.[3] ?? 0;
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
        cost: A * price + t1 * 45 + t2 * 60,
      };
    }
    case "lawn": {
      if (mat === "seed") {
        return { title, lines: [ar, ["Lawn seed, 35 g/m²", `${Math.ceil(A * 35)} g`], ["Topsoil, 50 mm", `${(A * 0.07).toFixed(1)} t`]], cost: A * 0.6 + A * 0.07 * 45 };
      }
      if (mat === "artificial") {
        return {
          title,
          lines: [ar, ["Artificial grass", `${Math.ceil(A * 1.1)} m²`], ["Sub-base and sand", `${(A * 0.2).toFixed(1)} t`], ["Weed membrane", `${Math.ceil(A * 1.1)} m²`]],
          cost: A * 1.1 * 20 + A * 0.2 * 45 + A * 1.3,
        };
      }
      const t = A * 0.05 * 1.4;
      return { title, lines: [ar, ["Turf rolls (1 m²)", `${Math.ceil(A * 1.05)} rolls`], ["Topsoil, 50 mm", `${t.toFixed(1)} t`]], cost: A * 1.05 * 4.5 + t * 45 };
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
          edging = per * 60;
        } else {
          lines.push(["Timber sleepers, 2 high", `${sleepers} sleepers`]);
          edging = sleepers * 32;
        }
      } else if (mat !== "none") {
        lines.push([m?.[1] ?? "Edging", `${per.toFixed(1)} m`]);
        edging = per * (mat === "steel" ? 4 : 2.5);
      }
      return { title, lines, cost: compost * 55 + nPlants * 7 + edging };
    }
    case "path": {
      if (mat === "bark") {
        const v = A * 0.075;
        return { title, lines: [ar, ["Bark chips, 75 mm", `${v.toFixed(2)} m³`], ["Weed membrane", `${Math.ceil(A * 1.1)} m²`]], cost: v * 60 + A * 1.3 };
      }
      if (mat === "stepping") {
        const n = Math.ceil(A / 0.7);
        const g = A * 0.05 * 1.7;
        return { title, lines: [ar, ["Stepping stones, 450 mm", `${n} stones`], ["Gravel, 50 mm", `${g.toFixed(2)} t`]], cost: n * 12 + g * 70 };
      }
      const g = A * 0.05 * 1.7;
      return {
        title,
        lines: [ar, ["Gravel, 50 mm", `${g.toFixed(2)} t`], ["Weed membrane", `${Math.ceil(A * 1.1)} m²`], ["Edging", `${per.toFixed(1)} m`]],
        cost: g * 70 + A * 1.3 + per * 4,
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
        cost: lw * lh * 9 + 80,
      };
    }
    case "tree":
      return { title, lines: [["Semi-mature tree", "1"], ["Bark mulch ring", "0.09 m³"], ["Stake and tie kit", "1"]], cost: 140 };
    case "shed":
      return { title, lines: [[`${m?.[1]} shed`, "1"], ["Paving slab base", `${A.toFixed(1)} m²`]], cost: (mat === "metal" ? 450 : 650) + A * 30 };
    case "meadow":
      return { title, lines: [ar, ["Wildflower seed mix, 5 g/m²", `${Math.ceil(A * 5)} g`], ["Seedbed preparation", `${A.toFixed(1)} m²`]], cost: A * 3 + 25 };
    case "greenhouse":
      return { title, lines: [["Greenhouse", "1"], ["Paving slab base", `${A.toFixed(1)} m²`]], cost: 600 + A * 30 };
    case "hottub":
      return { title, lines: [["Hot tub", "1"], ["Concrete pad, 100 mm", `${(A * 0.1).toFixed(2)} m³`]], cost: 3500 + A * 12 };
  }
}

export const kindLabel = (it: Item) => KINDS[it.kind].label;
