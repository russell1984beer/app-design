// Exports from the Materials tab: a materials quote (as HTML, which the app turns into a PDF)
// and the plan as a DXF drawing that CAD programs open (AutoCAD, DraftSight, QCAD, LibreCAD).

import { centre, corners, isOval, isRound, itemName, type Item } from "./design.ts";
import { gbp, quantities, type Prices, type Quantity } from "./materials.ts";
import type { Plot, Pt, Terrain } from "./plot.ts";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function quoteHtml(opts: { plot: Plot; items: Item[]; z: Terrain; title: string; date: Date; prices?: Prices }): string {
  const q = (it: Item) => quantities(it, opts.z, opts.prices);
  const rows = opts.items.filter((i) => !i.exist).map(q);
  const total = rows.reduce((a, r) => a + r.cost, 0);
  const date = opts.date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const card = (r: Quantity) => `<section><h2>${esc(r.title)}</h2><table>${r.lines
    .map(([k, v]) => `<tr><td>${esc(k)}</td><td class="n">${esc(v)}</td></tr>`)
    .join("")}<tr class="sub"><td>Materials estimate</td><td class="n">${gbp(r.cost)}</td></tr></table></section>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(opts.title)}</title><style>
body{font-family:Helvetica,Arial,sans-serif;color:#1E3436;margin:32px;font-size:12pt}
h1{font-size:22pt;margin:0}.meta{color:#5B6E6C;margin:4px 0 20px}
section{border:1px solid #CBD5C7;border-radius:8px;padding:10px 14px;margin-bottom:12px;page-break-inside:avoid}
h2{font-size:13pt;margin:0 0 6px}table{width:100%;border-collapse:collapse}
td{padding:3px 0;border-top:1px dashed #E1E7DD}tr:first-child td{border-top:0}.n{text-align:right;font-weight:600;white-space:nowrap;padding-left:12px}
.sub td{font-weight:700}.total{display:flex;justify-content:space-between;font-size:16pt;font-weight:800;margin:16px 0 6px}
.note{color:#5B6E6C;font-size:10pt}
</style></head><body>
<h1>${esc(opts.title)}</h1>
<p class="meta">Plotwise materials quote · ${esc(date)} · plot about ${opts.plot.widthM.toFixed(1)} × ${opts.plot.lengthM.toFixed(1)} m</p>
${rows.length ? rows.map(card).join("") : "<p>No new features in the design yet.</p>"}
<div class="total"><span>Materials total</span><span>${gbp(total)}</span></div>
<p class="note">Quantities come from the plan and include 5% waste where it applies. Prices are estimates for materials only, excluding labour, delivery and VAT. Levels are estimates until a real drone survey is processed. Get supplier quotes before ordering.</p>
</body></html>`;
}

/** Points round an ellipse, for drawing ponds as polylines. */
function ellipsePoints(it: Item, n = 32): Pt[] {
  const a = (it.a * Math.PI) / 180;
  return Array.from({ length: n }, (_, k) => {
    const t = (2 * Math.PI * k) / n;
    const x = (it.w / 2) * Math.cos(t);
    const y = (it.h / 2) * Math.sin(t);
    return [it.x + x * Math.cos(a) - y * Math.sin(a), it.y + x * Math.sin(a) + y * Math.cos(a)] as Pt;
  });
}

/**
 * The plan as an ASCII DXF (R12), in metres. DXF's y axis points up, so the far end of the rear
 * garden is at the top, as on the screen. Layers: BOUNDARY, HOUSE, NEW, EXISTING, LABELS.
 */
export function planDxf(plot: Plot, items: Item[]): string {
  const out: string[] = [];
  const g = (code: number, value: string | number) => out.push(String(code), typeof value === "number" ? value.toFixed(4) : value);
  const Y = (y: number) => plot.lengthM - y;
  const poly = (layer: string, pts: Pt[]) => {
    g(0, "POLYLINE");
    g(8, layer);
    g(66, "1");
    g(70, "1"); // closed
    for (const p of pts) {
      g(0, "VERTEX");
      g(8, layer);
      g(10, p[0]);
      g(20, Y(p[1]));
      g(30, 0);
    }
    g(0, "SEQEND");
    g(8, layer);
  };
  const text = (p: Pt, h: number, s: string) => {
    g(0, "TEXT");
    g(8, "LABELS");
    g(10, p[0]);
    g(20, Y(p[1]));
    g(30, 0);
    g(40, h);
    g(1, s.replace(/[\r\n]/g, " "));
    g(72, "1"); // centred
    g(11, p[0]);
    g(21, Y(p[1]));
    g(31, 0);
  };

  g(0, "SECTION");
  g(2, "HEADER");
  g(9, "$INSUNITS");
  g(70, "6"); // metres
  g(0, "ENDSEC");
  g(0, "SECTION");
  g(2, "ENTITIES");
  const { widthM: W, lengthM: H, rearGardenM: GH, houseDepthM: HD, houseWidthM: HW } = plot;
  poly("BOUNDARY", [[0, 0], [W, 0], [W, H], [0, H]]);
  poly("HOUSE", [[0, GH], [HW, GH], [HW, GH + HD], [0, GH + HD]]);
  text([HW / 2, GH + HD / 2], 0.6, "House");
  for (const it of items) {
    const layer = it.exist ? "EXISTING" : "NEW";
    if (isRound(it.kind) && !it.pts) {
      g(0, "CIRCLE");
      g(8, layer);
      g(10, it.x);
      g(20, Y(it.y));
      g(30, 0);
      g(40, it.w / 2);
    } else if (isOval(it.kind) && !it.pts) poly(layer, ellipsePoints(it));
    else poly(layer, corners(it));
    text(centre(it), 0.35, itemName(it));
  }
  g(0, "ENDSEC");
  g(0, "EOF");
  return out.join("\n") + "\n";
}
