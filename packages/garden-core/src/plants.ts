// Plant library and suggestions matched to how much sun a bed gets.

import { itemArea, type Item } from "./design.ts";
import { bedSun, type SunClass } from "./sun.ts";
import type { Plot } from "./plot.ts";

export type Plant = { id: string; name: string; sun: SunClass; spacingM: number; colour: string; veg?: boolean; note: string };

export const PLANTS: Plant[] = [
  { id: "lav", name: "Lavender Hidcote", sun: "sun", spacingM: 0.45, colour: "#8E7CC3", note: "Scented and loved by bees" },
  { id: "sal", name: "Salvia Caradonna", sun: "sun", spacingM: 0.4, colour: "#5B4B9E", note: "Purple spikes all summer" },
  { id: "nep", name: "Catmint Walker's Low", sun: "sun", spacingM: 0.5, colour: "#9AA6D8", note: "Tough, long flowering" },
  { id: "sti", name: "Mexican feather grass", sun: "sun", spacingM: 0.35, colour: "#D8C98A", note: "Soft movement, drought tolerant" },
  { id: "ech", name: "Echinacea", sun: "sun", spacingM: 0.4, colour: "#D77AA0", note: "Late summer colour" },
  { id: "ros", name: "Rosemary", sun: "sun", spacingM: 0.6, colour: "#6E8F6A", note: "Evergreen herb" },
  { id: "ger", name: "Geranium Rozanne", sun: "part", spacingM: 0.5, colour: "#6D7FD0", note: "Flowers June to October" },
  { id: "alc", name: "Lady's mantle", sun: "part", spacingM: 0.4, colour: "#C8D36A", note: "Easy ground cover" },
  { id: "ast", name: "Astrantia", sun: "part", spacingM: 0.4, colour: "#E6B8C8", note: "Good for cutting" },
  { id: "hyd", name: "Hydrangea Annabelle", sun: "part", spacingM: 1, colour: "#EDEFE0", note: "Big white flower heads" },
  { id: "ane", name: "Japanese anemone", sun: "part", spacingM: 0.5, colour: "#F1C8D6", note: "Autumn flowers" },
  { id: "hos", name: "Hosta", sun: "shade", spacingM: 0.5, colour: "#7FA36A", note: "Bold leaves" },
  { id: "fer", name: "Male fern", sun: "shade", spacingM: 0.6, colour: "#5D8A4A", note: "Tough and low upkeep" },
  { id: "hel", name: "Hellebore", sun: "shade", spacingM: 0.45, colour: "#B07A9A", note: "Winter flowers" },
  { id: "bru", name: "Brunnera Jack Frost", sun: "shade", spacingM: 0.4, colour: "#9DB6D8", note: "Silver leaves, blue flowers" },
  { id: "sar", name: "Sweet box", sun: "shade", spacingM: 0.6, colour: "#3F6B45", note: "Winter scent, evergreen" },
  { id: "tom", name: "Tomatoes", sun: "sun", spacingM: 0.5, colour: "#D9533B", veg: true, note: "Needs a warm, sunny spot" },
  { id: "cou", name: "Courgettes", sun: "sun", spacingM: 0.9, colour: "#E3C34A", veg: true, note: "Very productive" },
  { id: "her", name: "Mixed herbs", sun: "sun", spacingM: 0.3, colour: "#7FA35A", veg: true, note: "Thyme, sage, parsley, chives" },
  { id: "sld", name: "Salad leaves", sun: "part", spacingM: 0.2, colour: "#9CC36A", veg: true, note: "Copes with some shade" },
  { id: "chd", name: "Rainbow chard", sun: "part", spacingM: 0.3, colour: "#C9506B", veg: true, note: "Crops for months" },
  { id: "rhu", name: "Rhubarb", sun: "shade", spacingM: 0.9, colour: "#B5455A", veg: true, note: "Happy in shade" },
];

export const PLANT_BY_ID: Record<string, Plant> = Object.fromEntries(PLANTS.map((p) => [p.id, p]));

/** Raised beds get vegetables, planting beds get flowers and shrubs. */
export const plantPool = (it: Item) => PLANTS.filter((p) => (it.kind === "raised" ? p.veg : !p.veg));

/** Three plants that suit the bed's sun. */
export function suggestPlants(plot: Plot, items: Item[], it: Item): string[] {
  const cls = bedSun(plot, items, it).cls;
  const pool = plantPool(it);
  let good = pool.filter((p) => p.sun === cls);
  if (!good.length) good = pool;
  return good.slice(0, 3).map((p) => p.id);
}

/** Plants needed to fill the bed at each plant's spacing, shared equally between the chosen plants. */
export function plantCount(it: Item, plantId: string): number {
  const ids = it.plants ?? [];
  if (!ids.includes(plantId)) return 0;
  const p = PLANT_BY_ID[plantId];
  return Math.max(1, Math.ceil(itemArea(it) / ids.length / p.spacingM ** 2));
}
