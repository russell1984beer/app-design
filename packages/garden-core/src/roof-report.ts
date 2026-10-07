// Roof report. Automatic damage detection is not built yet, so the app shows this example report
// (the prototype's findings) to show what the real one will look like.

import type { Plot } from "./plot.ts";

export type Severity = 1 | 2 | 3;

export type RoofIssue = {
  key: "slip" | "flash" | "ridge" | "gutter" | "moss";
  /** Position on the roof plan, metres from the rear corner at the neighbour's side. */
  x: number;
  y: number;
  severity: Severity;
  title: string;
  where: string;
  detail: string;
  fix: string;
  cost: [number, number];
};

export const SEVERITY: Record<Severity, { label: string; colour: string }> = {
  3: { label: "Fix soon", colour: "#C8442F" },
  2: { label: "Plan to fix", colour: "#D98A1E" },
  1: { label: "Keep an eye on", colour: "#B8A21A" },
};

export const EXAMPLE_ROOF_ISSUES: RoofIssue[] = [
  { key: "slip", x: 1.6, y: 1.4, severity: 3, title: "Slipped tiles", where: "Rear slope, left of the skylight", detail: "Two tiles have slid out of line, leaving a gap where rain can get under the roof.", fix: "Refix or replace the tiles soon, before the next spell of heavy rain.", cost: [150, 300] },
  { key: "flash", x: 4.75, y: 4.3, severity: 2, title: "Lead flashing lifting", where: "Where the chimney meets the roof", detail: "The lead seal around the chimney has lifted at one corner. This is a common source of leaks.", fix: "Re-dress and repoint the flashing within the next few months.", cost: [250, 500] },
  { key: "ridge", x: 2.9, y: 3.4, severity: 2, title: "Ridge mortar cracked", where: "Along the main ridge", detail: "The mortar bedding under two ridge tiles is cracked and crumbling.", fix: "Repoint the ridge, or fit a dry ridge system, this year.", cost: [300, 600] },
  { key: "gutter", x: 4.4, y: -0.05, severity: 2, title: "Gutter blocked", where: "Rear gutter, right-hand end", detail: "Leaves and moss are holding water in the gutter, which can overflow onto the wall.", fix: "Clear the gutter and check the downpipe flows freely.", cost: [80, 150] },
  { key: "moss", x: 1.4, y: 6.6, severity: 1, title: "Moss build-up", where: "Front slope, lower edge", detail: "A patch of moss is growing between tiles. It is not urgent, but it holds damp and can lift tiles over time.", fix: "Remove the moss gently and apply a moss treatment.", cost: [300, 600] },
];

/** Sloping roof area of the owner's half. */
export const roofArea = (p: Plot) => (p.houseWidthM * p.houseDepthM) / Math.cos((p.roofPitchDeg * Math.PI) / 180);

export function reportSummary(issues: RoofIssue[]) {
  const count = (s: Severity) => issues.filter((i) => i.severity === s).length;
  return {
    fixSoon: count(3),
    planFor: count(2),
    watch: count(1),
    low: issues.reduce((a, i) => a + i.cost[0], 0),
    high: issues.reduce((a, i) => a + i.cost[1], 0),
  };
}
