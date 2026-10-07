// The plan of the garden, drawn like the prototype's map, with touch for measuring and designing.

import { useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import { View, type GestureResponderEvent } from "react-native";
import Svg, { Circle, ClipPath, Defs, Ellipse, G, Line, Path, Pattern, Polygon, Polyline, RadialGradient, Rect, Stop, Text as SText } from "react-native-svg";

import { footprintM, MINI_4_PRO } from "../../../packages/flight-core/src/camera.ts";
import {
  EXAMPLE_ROOF_ISSUES,
  KINDS,
  PLANT_BY_ID,
  SEVERITY,
  area,
  bbox,
  centre,
  contours,
  corners,
  draftTerrain,
  fillOf,
  fmtLevel,
  inHouse,
  inItem,
  isOval,
  isRound,
  itemName,
  levelFn,
  localOf,
  materialOf,
  planVector,
  rotP,
  shadows,
  sizeText,
  slopeCells,
  solarHour,
  sunHoursGrid,
  sunPosition,
  MONTHS,
  clampToPlot,
  newItem,
  suggestPlants,
  type Item,
  type Plot,
  type Pt,
  type SlopeBand,
} from "../../../packages/garden-core/src/index.ts";

import { SIM_HOME, drone, useDrone } from "./drone";
import { gpsToPlan, missionOnPlan, roofScan, surveyMission } from "./flight";
import { S, commit, history, nextId, sn, useApp, type AppState } from "./store";
import { C } from "./theme";

type VB = [number, number, number, number];

const f2 = (p: Pt) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`;
const ptsStr = (P: Pt[]) => P.map(f2).join(" ");

const SLOPE_COLOUR: Record<SlopeBand, string> = { under4: "#D3E3C6", "4to8": "#ECE09C", "8to15": "#E9B46B", over15: "#D8784C" };
const HOURS_COLOUR = { "6plus": "#F2CF5B", "3to6": "#C9DC9A", under3: "#8FA7A0" } as const;

/** Cached per plot: the terrain and its contour and slope drawings. */
const terrainCache = new Map<string, { z: ReturnType<typeof draftTerrain>; lvl: (x: number, y: number) => number; contours: ReturnType<typeof contours>; slope: ReturnType<typeof slopeCells> }>();
export function terrainFor(plot: Plot) {
  const key = JSON.stringify(plot);
  let t = terrainCache.get(key);
  if (!t) {
    const z = draftTerrain(plot);
    t = { z, lvl: levelFn(plot, z), contours: contours(plot, z), slope: slopeCells(plot, z) };
    terrainCache.set(key, t);
  }
  return t;
}

function roofView(s: AppState): VB {
  const { widthM: W, rearGardenM: GH, houseDepthM: HD, houseWidthM: HW } = s.plot;
  if (s.roof.showExample) return [-1.8, GH - 1.6, W + 2.6, HD + 3.2];
  const r = roofScan(s, SIM_HOME).radiusM + 1.5;
  return [HW / 2 - r, GH + HD / 2 - r, 2 * r, 2 * r];
}

export function viewBoxFor(s: AppState): VB {
  if (s.tab === "roof") return roofView(s);
  return [-2.4, -2.2, s.plot.widthM + 5.8, s.plot.lengthM + 8];
}

export function MapView() {
  const s = useApp();
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const drag = useRef<Drag | null>(null);

  const vb = viewBoxFor(s);
  const scale = size.w > 0 ? Math.min(size.w / vb[2], size.h / vb[3]) : 1;
  const ox = (size.w - vb[2] * scale) / 2;
  const oy = (size.h - vb[3] * scale) / 2;
  const px = (n: number) => n / scale;
  const toM = (e: GestureResponderEvent): Pt => [vb[0] + (e.nativeEvent.locationX - ox) / scale, vb[1] + (e.nativeEvent.locationY - oy) / scale];

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const content = useMemo(() => layers(s, px), [s.v, scale, size.w]);

  return (
    <View
      style={{ flex: 1 }}
      onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
      onStartShouldSetResponder={() => true}
      onResponderTerminationRequest={() => !drag.current}
      onResponderGrant={(e) => {
        drag.current = pointerDown(toM(e), px);
        if (drag.current) redraw();
      }}
      onResponderMove={(e) => {
        if (drag.current && pointerMove(drag.current, toM(e))) {
          S.v++;
          redraw();
        }
      }}
      onResponderRelease={() => {
        if (drag.current) {
          drag.current = null;
          commit();
        }
      }}
      onResponderTerminate={() => {
        drag.current = null;
        commit();
      }}
      accessible
      accessibilityLabel={s.tab === "roof" ? "Roof plan" : "Garden map"}
    >
      {size.w > 0 && (
        <Svg width={size.w} height={size.h} viewBox={vb.join(" ")} pointerEvents="none">
          {content}
          <DroneOverlay px={px} />
        </Svg>
      )}
    </View>
  );
}

/* ---------- touch ---------- */

type Drag = { t: "move" | "rs" | "ro" | "v"; i?: number; dx?: number; dy?: number; c0?: Pt; start?: Pt[] | null; snap: string; moved: boolean };

function pointerDown(p: Pt, px: (n: number) => number): Drag | null {
  const s = S;
  const { widthM: W, lengthM: H } = s.plot;
  const inG = p[0] >= 0 && p[0] <= W && p[1] >= 0 && p[1] <= H;
  if (s.tab === "roof") {
    if (!s.roof.showExample) return null;
    const GH = s.plot.rearGardenM;
    const i = EXAMPLE_ROOF_ISSUES.findIndex((it) => Math.hypot(it.x - p[0], GH + it.y - p[1]) < 0.6);
    if (i >= 0) {
      s.roof.sel = i;
      commit();
    }
    return null;
  }
  if (s.tab === "plan") {
    // Move the take-off point.
    if (inG && !inHouse(s.plot, p[0], p[1]) && !drone.flying) {
      s.home = [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10];
      commit();
    }
    return null;
  }
  if (!s.scanned) return null;
  if (s.tab === "survey") {
    if (!inG) return null;
    if (s.tool === "dist") {
      if (s.pts.length >= 2) s.pts = [];
      s.pts.push(p);
    } else {
      if (s.closed) {
        s.pts = [];
        s.closed = false;
      }
      s.pts.push(p);
    }
    commit();
    return null;
  }
  if (s.tab !== "design") return null;
  const pr: Pt = [sn(p[0]), sn(p[1])];
  if (s.drawing) {
    if (!inG) return null;
    s.drawing.pts.push(pr);
    commit();
    return null;
  }
  const cur = s.items.find((i) => i.id === s.sel);
  if (cur && s.dmode === "layout") {
    const h = handles(cur).find((h) => Math.hypot(h.at[0] - p[0], h.at[1] - p[1]) < Math.max(0.9, px(22)));
    if (h) {
      const d: Drag = { t: "move", snap: JSON.stringify(s.items), moved: false };
      if (h.id[0] === "m" && cur.pts) {
        history.push(d.snap);
        d.moved = true;
        const i = +h.id.slice(1);
        const P = cur.pts[i];
        const q = cur.pts[(i + 1) % cur.pts.length];
        cur.pts.splice(i + 1, 0, [(P[0] + q[0]) / 2, (P[1] + q[1]) / 2]);
        d.t = "v";
        d.i = i + 1;
        s.vsel = i + 1;
      } else if (h.id[0] === "v") {
        d.t = "v";
        d.i = +h.id.slice(1);
        s.vsel = d.i;
      } else d.t = h.id as "rs" | "ro";
      commit();
      return d;
    }
  }
  if (s.placing) {
    if (!inG || inHouse(s.plot, p[0], p[1])) return null;
    const it = newItem(s.plot, s.placing, pr, nextId());
    if (!it) return null;
    history.push(s.items);
    if (it.kind === "bed" || it.kind === "raised") it.plants = suggestPlants(s.plot, s.items, it);
    s.items.push(it);
    s.sel = it.id;
    s.placing = null;
    commit();
    return null;
  }
  const hit = [...s.items].reverse().find((it) => inItem(it, p[0], p[1]));
  if (hit) {
    if (s.sel !== hit.id) s.vsel = null;
    s.sel = hit.id;
    const c = centre(hit);
    commit();
    if (s.dmode !== "layout") return null;
    return { t: "move", dx: p[0] - c[0], dy: p[1] - c[1], c0: c, start: hit.pts ? hit.pts.map((q) => [q[0], q[1]] as Pt) : null, snap: JSON.stringify(s.items), moved: false };
  }
  s.sel = null;
  s.vsel = null;
  commit();
  return null;
}

function pointerMove(d: Drag, p: Pt): boolean {
  const s = S;
  const it = s.items.find((i) => i.id === s.sel);
  if (!it) return false;
  if (!d.moved) {
    history.push(d.snap);
    d.moved = true;
  }
  const { widthM: W, lengthM: H } = s.plot;
  if (d.t === "move") {
    const nx = sn(p[0] - d.dx!);
    const ny = sn(p[1] - d.dy!);
    if (it.pts && d.start) {
      const dx = nx - d.c0![0];
      const dy = ny - d.c0![1];
      it.pts = d.start.map((q) => [q[0] + dx, q[1] + dy]);
    } else {
      it.x = nx;
      it.y = ny;
    }
    clampToPlot(s.plot, it);
  } else if (d.t === "rs") {
    if (isRound(it.kind)) it.w = it.h = Math.max(0.4, sn(2 * Math.hypot(p[0] - it.x, p[1] - it.y)));
    else {
      const l = localOf(it, p);
      it.w = Math.max(0.3, sn(2 * Math.abs(l[0])));
      it.h = Math.max(0.3, sn(2 * Math.abs(l[1])));
    }
    clampToPlot(s.plot, it);
  } else if (d.t === "ro") {
    let a = (Math.atan2(p[1] - it.y, p[0] - it.x) * 180) / Math.PI + 90;
    if (s.snap) a = Math.round(a / 5) * 5;
    it.a = ((a % 360) + 360) % 360;
  } else if (d.t === "v" && it.pts && d.i !== undefined) {
    it.pts[d.i] = [Math.max(0, Math.min(W, sn(p[0]))), Math.max(0, Math.min(H, sn(p[1])))];
  }
  return true;
}

type Handle = { id: string; at: Pt };

function handles(it: Item): Handle[] {
  if (it.pts) {
    const mids = it.pts.map((p, i) => {
      const q = it.pts![(i + 1) % it.pts!.length];
      return { id: `m${i}`, at: [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2] as Pt };
    });
    // Corners win over midpoints when they overlap.
    return [...it.pts.map((p, i) => ({ id: `v${i}`, at: p })), ...mids];
  }
  if (isRound(it.kind)) return [{ id: "rs", at: [it.x + it.w / 2, it.y] }];
  const c = rotP(it.w / 2, it.h / 2, it.a);
  const r = rotP(0, -it.h / 2 - 1.3, it.a);
  return [
    { id: "ro", at: [it.x + r[0], it.y + r[1]] },
    { id: "rs", at: [it.x + c[0], it.y + c[1]] },
  ];
}

/* ---------- drawing ---------- */

function T({
  x = 0,
  y = 0,
  size,
  weight,
  anchor,
  fill = C.ink,
  transform,
  px,
  children,
}: {
  x?: number;
  y?: number;
  size: number;
  weight?: "400" | "700" | "800";
  anchor?: "start" | "middle" | "end";
  fill?: string;
  transform?: string;
  px: (n: number) => number;
  children: ReactNode;
}) {
  const common = { x, y, fontSize: size, fontWeight: weight ?? "400", textAnchor: anchor ?? "start", fontFamily: "sans-serif" } as const;
  return (
    <G transform={transform}>
      <SText {...common} fill={C.paper} stroke={C.paper} strokeWidth={px(3)} strokeLinejoin="round">
        {children}
      </SText>
      <SText {...common} fill={fill}>
        {children}
      </SText>
    </G>
  );
}

function layers(s: AppState, px: (n: number) => number): ReactNode {
  const tab = s.tab;
  if (tab === "roof") return roofLayer(s, px);
  const k = (n: number) => px(n);
  let body: ReactNode;
  if (tab === "plan" || tab === "scan") body = <>{photoLayer(s, px)}{boundary(s, k)}{flightLayer(s, px)}</>;
  else if (!s.scanned) body = <><G opacity={0.5}>{photoLayer(s, px)}</G>{boundary(s, k)}</>;
  else if (tab === "survey") {
    const base =
      s.layer === "photo" ? photoLayer(s, px) : s.layer === "slope" ? <><G opacity={0.3}>{photoLayer(s, px)}</G><G opacity={0.85}>{slopeLayer(s)}</G>{houseBox(s, px)}</> : <>{contourLayer(s, px)}{houseBox(s, px)}</>;
    body = <>{base}{boundary(s, k)}{dims(s, px)}{measureLayer(s, px)}</>;
  } else {
    const sun = tab === "design" && s.dmode === "sun";
    body = (
      <>
        {planBase(s, px)}
        {sun && s.hours ? hoursLayer(s) : null}
        {itemsLayer(s, px)}
        {sun && !s.hours ? shadowLayer(s) : null}
        {boundary(s, k)}
        {dims(s, px)}
        {northArrow(s, px)}
      </>
    );
  }
  return (
    <>
      {defs(s, px)}
      {street(s, px)}
      {body}
    </>
  );
}

function defs(s: AppState, px: (n: number) => number) {
  const { widthM: W, lengthM: H, rearGardenM: GH } = s.plot;
  return (
    <Defs>
      <Pattern id="grassP" width={0.7} height={0.6} patternUnits="userSpaceOnUse">
        <Path d="M.1 .5l.06-.18M.45 .25l.05-.17M.3 .55l.04-.15" stroke="#5F7E45" strokeWidth={px(1)} />
      </Pattern>
      <Pattern id="deckP" width={1} height={0.15} patternUnits="userSpaceOnUse">
        <Path d="M0 .15H1" stroke="#000" strokeOpacity={0.28} strokeWidth={px(0.7)} />
      </Pattern>
      <Pattern id="meadowP" width={0.9} height={0.9} patternUnits="userSpaceOnUse">
        <Circle cx={0.2} cy={0.3} r={0.09} fill="#D9533B" />
        <Circle cx={0.6} cy={0.15} r={0.08} fill="#F2CF5B" />
        <Circle cx={0.7} cy={0.65} r={0.09} fill="#8E7CC3" />
        <Circle cx={0.3} cy={0.75} r={0.07} fill="#fff" />
      </Pattern>
      <Pattern id="gravelP" width={0.4} height={0.4} patternUnits="userSpaceOnUse">
        <Circle cx={0.1} cy={0.1} r={0.045} fill="#A99F88" />
        <Circle cx={0.3} cy={0.27} r={0.05} fill="#B9B09A" />
      </Pattern>
      <Pattern id="tilesP" width={0.32} height={0.26} patternUnits="userSpaceOnUse">
        <Path d="M0 .26H.32M.16 0V.13M0 .13V.26M.32 .13V.26" stroke="#7E4636" strokeWidth={px(0.6)} fill="none" />
      </Pattern>
      <Pattern id="hatchP" width={0.4} height={0.4} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <Path d="M0 0V.4" stroke="#AAB2AE" strokeWidth={px(1)} />
      </Pattern>
      <RadialGradient id="canopy">
        <Stop offset="0" stopColor="#5E8A4F" />
        <Stop offset="1" stopColor="#36552E" />
      </RadialGradient>
      <ClipPath id="gclip">
        <Rect x={0} y={0} width={W} height={H} />
      </ClipPath>
      <ClipPath id="sclip">
        <Rect x={0} y={0} width={W} height={GH} />
      </ClipPath>
    </Defs>
  );
}

function street(s: AppState, px: (n: number) => number) {
  const { widthM: W, lengthM: H } = s.plot;
  return (
    <>
      <Rect x={-1.2} y={H} width={W + 2.4} height={3} fill="#9BA19D" />
      <T x={W / 2} y={H + 2} size={1.55} anchor="middle" fill="#2E3836" px={px}>
        Street
      </T>
    </>
  );
}

function photoLayer(s: AppState, px: (n: number) => number) {
  const { widthM: W, lengthM: H, rearGardenM: GH, houseDepthM: HD, houseWidthM: HW } = s.plot;
  return (
    <G clipPath="url(#gclip)">
      <Rect width={W} height={H} fill="#7E9C60" />
      <Rect width={W} height={H} fill="url(#grassP)" />
      <Rect x={0} y={0} width={W} height={8} fill="#56743F" opacity={0.5} />
      <Rect x={0} y={GH - 6} width={W} height={6} fill="#C8C0B0" />
      <Path d={`M0 ${GH - 4}h${W}M0 ${GH - 2}h${W}`} stroke="#ADA595" strokeWidth={px(1)} />
      <Circle cx={W - 1.3} cy={GH - 1.3} r={1.05} fill="#3B4A4C" stroke="#8A9496" strokeWidth={px(2)} />
      <Rect x={W - 2.8} y={GH - 10} width={2.2} height={3} fill="#E6EBEB" stroke="#9AA4A6" strokeWidth={px(1)} />
      <Path d={`M${W - 2.8} ${GH - 8.5}h2.2`} stroke="#9AA4A6" strokeWidth={px(1)} />
      <Rect x={W - 3.6} y={GH - 12.6} width={1.8} height={1.6} fill="#F0F0EA" />
      <Rect x={W - 1.4} y={8} width={1.2} height={GH - 14} fill="#CFC8B6" />
      <Circle cx={3} cy={4} r={1.6} fill="url(#canopy)" />
      <Circle cx={4.8} cy={9.5} r={1.1} fill="url(#canopy)" />
      <Circle cx={2.4} cy={13} r={1.4} fill="url(#canopy)" />
      <Circle cx={1.6} cy={18.5} r={0.9} fill="url(#canopy)" />
      <Circle cx={5.2} cy={16} r={0.7} fill="#C9C27A" />
      <Rect x={0} y={GH + HD} width={W} height={H - GH - HD} fill="#B9B5AC" />
      <Rect x={0} y={GH + HD + 1} width={2.2} height={H - GH - HD - 1} fill="#7E9C60" />
      <Rect x={HW} y={GH} width={W - HW} height={HD} fill="#C2BCAE" />
      <Rect x={0} y={GH} width={HW} height={HD} fill="#A5624F" />
      <Path
        d={`M0 ${GH}L${HW / 2} ${GH + HW / 2}V${GH + HD - HW / 2}L0 ${GH + HD}M${HW} ${GH}L${HW / 2} ${GH + HW / 2}M${HW} ${GH + HD}L${HW / 2} ${GH + HD - HW / 2}`}
        stroke="#7E4636"
        fill="none"
        strokeWidth={px(1.5)}
      />
    </G>
  );
}

function houseBox(s: AppState, px: (n: number) => number) {
  const { rearGardenM: GH, houseDepthM: HD, houseWidthM: HW } = s.plot;
  return (
    <>
      <Rect x={0} y={GH} width={HW} height={HD} fill="#D3D7D2" stroke="#6D7772" strokeWidth={px(1.5)} />
      <T x={HW / 2} y={GH + HD / 2} size={1.23} weight="700" anchor="middle" fill="#3E4A47" px={px}>
        House
      </T>
      <T x={HW / 2} y={GH + HD / 2 + 1.3} size={0.91} anchor="middle" fill="#3E4A47" px={px}>
        {`roof ridge about ${s.plot.ridgeHeightM} m`}
      </T>
    </>
  );
}

function planBase(s: AppState, px: (n: number) => number) {
  const { widthM: W, lengthM: H, rearGardenM: GH, houseDepthM: HD } = s.plot;
  const t = terrainFor(s.plot);
  return (
    <>
      <Rect width={W} height={H} fill="#EEF2EA" />
      {t.contours.map((c) => (
        <Path key={c.level} d={c.segments.map(([a, b]) => `M${f2(a)}L${f2(b)}`).join("")} stroke="#B9A48C" strokeWidth={px(c.major ? 1.2 : 0.6)} fill="none" />
      ))}
      <Rect x={0} y={GH + HD} width={W} height={H - GH - HD} fill="#E2DED4" opacity={0.6} />
      {houseBox(s, px)}
    </>
  );
}

function contourLayer(s: AppState, px: (n: number) => number) {
  const { widthM: W, lengthM: H } = s.plot;
  const t = terrainFor(s.plot);
  const spots: Pt[] = [[2, 3], [5, 9], [3, 15], [6, 20], [2, 25], [1.2, 40.5], [4.5, 42]];
  return (
    <>
      <G opacity={0.35}>{photoLayer(s, px)}</G>
      <Rect width={W} height={H} fill="#F3F5EF" opacity={0.55} />
      {t.contours.map((c) => (
        <Path key={c.level} d={c.segments.map(([a, b]) => `M${f2(a)}L${f2(b)}`).join("")} stroke={C.contour} strokeWidth={px(c.major ? 1.6 : 0.7)} fill="none" />
      ))}
      {spots.map((p) => (
        <G key={f2(p)}>
          <Circle cx={p[0]} cy={p[1]} r={0.26} fill={C.ink} />
          <T x={p[0] + 0.25} y={p[1] - 0.2} size={1.1} px={px}>
            {fmtLevel(t.lvl(p[0], p[1]))}
          </T>
        </G>
      ))}
    </>
  );
}

function slopeLayer(s: AppState) {
  return terrainFor(s.plot).slope.map((c) => <Rect key={`${c.x},${c.y}`} x={c.x} y={c.y} width={c.w + 0.02} height={c.h + 0.02} fill={SLOPE_COLOUR[c.band]} />);
}

function boundary(s: AppState, px: (n: number) => number) {
  return <Rect x={0} y={0} width={s.plot.widthM} height={s.plot.lengthM} fill="none" stroke={C.ink} strokeWidth={px(2)} />;
}

function dims(s: AppState, px: (n: number) => number) {
  const { widthM: W, lengthM: H, rearGardenM: GH, houseDepthM: HD } = s.plot;
  const sw = px(1);
  return (
    <G>
      <Path d={`M0 -0.7H${W}M0 -0.95V-0.45M${W} -0.95V-0.45`} stroke={C.ink} strokeWidth={sw} />
      <T x={W / 2} y={-0.95} size={1.22} weight="700" anchor="middle" px={px}>{`about ${W.toFixed(1)} m`}</T>
      <Path d={`M-0.7 0V${H}M-0.95 0H-0.45M-0.95 ${H}H-0.45`} stroke={C.ink} strokeWidth={sw} />
      <T transform={`translate(-0.95 ${H / 2}) rotate(-90)`} size={1.22} weight="700" anchor="middle" px={px}>{`about ${H.toFixed(1)} m`}</T>
      <Path
        d={`M${W + 0.7} 0V${GH}M${W + 0.45} 0H${W + 0.95}M${W + 0.45} ${GH}H${W + 0.95}M${W + 0.7} ${GH + HD}V${H}M${W + 0.45} ${GH + HD}H${W + 0.95}M${W + 0.45} ${H}H${W + 0.95}`}
        stroke={C.ink}
        strokeWidth={sw}
      />
      <T transform={`translate(${W + 1.9} ${GH / 2}) rotate(90)`} size={1.22} weight="700" anchor="middle" px={px}>{`rear garden about ${GH.toFixed(1)} m`}</T>
      <T transform={`translate(${W + 1.9} ${(GH + HD + H) / 2}) rotate(90)`} size={0.91} weight="700" anchor="middle" px={px}>{`front ${(H - GH - HD).toFixed(1)} m`}</T>
    </G>
  );
}

function flightLayer(s: AppState, px: (n: number) => number) {
  const route = missionOnPlan(s, surveyMission(s, SIM_HOME), SIM_HOME);
  const h = s.home;
  return (
    <>
      <Polyline points={ptsStr([h, ...route, h])} fill="none" stroke={C.ink} strokeWidth={px(1.4)} strokeDasharray={[px(4), px(3)]} />
      <Circle cx={h[0]} cy={h[1]} r={0.7} fill={C.hivis} stroke={C.ink} strokeWidth={px(1.5)} />
      <T x={h[0] + 0.9} y={h[1] + 0.4} size={1.1} px={px}>
        Take-off
      </T>
    </>
  );
}

function measureLayer(s: AppState, px: (n: number) => number) {
  const P = s.pts;
  if (!P.length) return null;
  const { lvl } = terrainFor(s.plot);
  const out: ReactNode[] = [];
  if (s.tool === "dist" && P.length === 2) {
    const d = Math.hypot(P[1][0] - P[0][0], P[1][1] - P[0][1]);
    const mx = (P[0][0] + P[1][0]) / 2;
    const my = (P[0][1] + P[1][1]) / 2;
    out.push(
      <Line key="l1" x1={P[0][0]} y1={P[0][1]} x2={P[1][0]} y2={P[1][1]} stroke={C.ink} strokeWidth={px(5)} />,
      <Line key="l2" x1={P[0][0]} y1={P[0][1]} x2={P[1][0]} y2={P[1][1]} stroke={C.hivis} strokeWidth={px(2.5)} />,
      <T key="lt" x={mx} y={my - 0.4} size={1.55} weight="800" anchor="middle" px={px}>{`${d.toFixed(2)} m`}</T>,
    );
  }
  if (s.tool === "area" && P.length > 1) {
    out.push(
      <Polygon
        key="poly"
        points={ptsStr(P)}
        fill={s.closed ? "rgba(240,196,25,0.35)" : "none"}
        stroke={C.ink}
        strokeWidth={px(2.5)}
        strokeDasharray={s.closed ? undefined : [px(5), px(3)]}
      />,
    );
    if (s.closed) {
      const c = P.reduce((a, p) => [a[0] + p[0] / P.length, a[1] + p[1] / P.length], [0, 0]);
      out.push(<T key="at" x={c[0]} y={c[1]} size={1.65} weight="800" anchor="middle" px={px}>{`${area(P).toFixed(1)} m²`}</T>);
    }
  }
  P.forEach((p, i) =>
    out.push(
      <G key={`p${i}`}>
        <Circle cx={p[0]} cy={p[1]} r={0.55} fill={C.hivis} stroke={C.ink} strokeWidth={px(2)} />
        <T x={p[0] + 0.4} y={p[1] + 0.6} size={1.1} px={px}>
          {fmtLevel(lvl(p[0], p[1]))}
        </T>
      </G>,
    ),
  );
  return <>{out}</>;
}

function itemShape(it: Item, fill: string, stroke: { stroke?: string; strokeWidth?: number; strokeDasharray?: number[] }, opacity?: number, key?: string) {
  if (it.pts) return <Polygon key={key} points={ptsStr(it.pts)} fill={fill} fillOpacity={opacity} {...stroke} />;
  const tr = `translate(${it.x.toFixed(2)} ${it.y.toFixed(2)}) rotate(${it.a})`;
  if (isOval(it.kind)) return <Ellipse key={key} transform={tr} rx={it.w / 2} ry={it.h / 2} fill={fill} fillOpacity={opacity} {...stroke} />;
  return <Rect key={key} transform={tr} x={-it.w / 2} y={-it.h / 2} width={it.w} height={it.h} rx={0.12} fill={fill} fillOpacity={opacity} {...stroke} />;
}

function itemsLayer(s: AppState, px: (n: number) => number) {
  const out = s.items.map((it) => {
    const K = KINDS[it.kind];
    const m = materialOf(it);
    const sel = it.id === s.sel;
    const ring = sel
      ? { stroke: C.ink, strokeWidth: px(3), strokeDasharray: [px(6), px(3)] }
      : it.exist
        ? { stroke: K.stroke, strokeWidth: px(1.5), strokeDasharray: [px(3), px(2)] }
        : { stroke: K.stroke, strokeWidth: px(1.5) };
    const parts: ReactNode[] = [itemShape(it, fillOf(it), ring, it.kind === "tree" ? (it.exist ? 0.55 : 0.85) : undefined, "shape")];
    const tex = it.kind === "deck" ? "deckP" : it.kind === "meadow" ? "meadowP" : it.kind === "path" && m?.[0] !== "bark" ? "gravelP" : null;
    if (tex) parts.push(itemShape(it, `url(#${tex})`, {}, undefined, "tex"));
    if (it.kind === "tree") parts.push(<Circle key="trunk" cx={it.x} cy={it.y} r={0.18} fill={K.stroke} />);
    if (it.kind === "hottub") parts.push(<Circle key="water" cx={it.x} cy={it.y} r={Math.max(0.1, it.w / 2 - 0.25)} fill="#6FA3B5" />);
    if ((it.kind === "shed" || it.kind === "greenhouse") && !it.pts) {
      const c = corners(it);
      parts.push(<Path key="x" d={`M${f2(c[0])}L${f2(c[2])}M${f2(c[1])}L${f2(c[3])}`} stroke={K.stroke} strokeWidth={px(1)} fill="none" />);
    }
    if ((it.kind === "bed" || it.kind === "raised") && it.plants?.length) {
      const [x0, y0, x1, y1] = bbox(it);
      let k = 0;
      for (let x = x0 + 0.25; x < x1; x += 0.45) {
        for (let y = y0 + 0.25; y < y1; y += 0.45) {
          if (!inItem(it, x, y)) continue;
          const p = PLANT_BY_ID[it.plants[k++ % it.plants.length]];
          parts.push(<Circle key={`pl${k}`} cx={x} cy={y} r={0.18} fill={p.colour} stroke="#2F3B2A" strokeWidth={px(0.5)} />);
        }
      }
    }
    const [x0, y0, x1, y1] = bbox(it);
    const c = centre(it);
    const fs = Math.min(1.15, Math.max(0.65, Math.min(x1 - x0, y1 - y0) / 3.5));
    parts.push(
      <T key="name" x={c[0]} y={c[1] - fs * 0.15} size={fs} weight="700" anchor="middle" px={px}>
        {itemName(it)}
      </T>,
      <T key="size" x={c[0]} y={c[1] + fs * 1.05} size={fs * 0.85} anchor="middle" px={px}>
        {sizeText(it)}
      </T>,
    );
    return <G key={it.id}>{parts}</G>;
  });
  return (
    <>
      {out}
      {handlesLayer(s, px)}
      {drawLayer(s, px)}
    </>
  );
}

function sq(p: Pt, on: boolean, px: (n: number) => number, key: string) {
  return <Rect key={key} x={p[0] - 0.3} y={p[1] - 0.3} width={0.6} height={0.6} fill={on ? C.hivis : "#fff"} stroke={C.ink} strokeWidth={px(2)} />;
}

function handlesLayer(s: AppState, px: (n: number) => number) {
  if (s.tab !== "design" || s.dmode !== "layout" || s.drawing) return null;
  const it = s.items.find((i) => i.id === s.sel);
  if (!it) return null;
  const out: ReactNode[] = [];
  if (it.pts) {
    it.pts.forEach((p, i) => {
      const q = it.pts![(i + 1) % it.pts!.length];
      const mx = (p[0] + q[0]) / 2;
      const my = (p[1] + q[1]) / 2;
      out.push(
        <G key={`m${i}`}>
          <Circle cx={mx} cy={my} r={0.28} fill="#fff" stroke={C.ink} strokeWidth={px(1.5)} />
          <Path d={`M${mx - 0.15} ${my}h.3M${mx} ${my - 0.15}v.3`} stroke={C.ink} strokeWidth={px(1.5)} />
        </G>,
      );
    });
    it.pts.forEach((p, i) => out.push(sq(p, s.vsel === i, px, `v${i}`)));
    return <>{out}</>;
  }
  if (isRound(it.kind)) return sq([it.x + it.w / 2, it.y], false, px, "rs");
  const c = rotP(it.w / 2, it.h / 2, it.a);
  const r = rotP(0, -it.h / 2 - 1.3, it.a);
  const t = rotP(0, -it.h / 2, it.a);
  return (
    <>
      <Line x1={it.x + t[0]} y1={it.y + t[1]} x2={it.x + r[0]} y2={it.y + r[1]} stroke={C.ink} strokeWidth={px(1.5)} />
      {sq([it.x + c[0], it.y + c[1]], false, px, "rs")}
      <Circle cx={it.x + r[0]} cy={it.y + r[1]} r={0.34} fill={C.hivis} stroke={C.ink} strokeWidth={px(2)} />
    </>
  );
}

function drawLayer(s: AppState, px: (n: number) => number) {
  if (s.tab !== "design" || !s.drawing) return null;
  const P = s.drawing.pts;
  if (!P.length) return null;
  return (
    <>
      <Polyline
        points={ptsStr(P.length > 2 ? [...P, P[0]] : P)}
        fill={P.length > 2 ? "rgba(240,196,25,0.3)" : "none"}
        stroke={C.ink}
        strokeWidth={px(2)}
        strokeDasharray={[px(5), px(3)]}
      />
      {P.map((p, i) => (
        <Circle key={i} cx={p[0]} cy={p[1]} r={i ? 0.25 : 0.38} fill={C.hivis} stroke={C.ink} strokeWidth={px(2)} />
      ))}
    </>
  );
}

const monthDay = (s: AppState) => MONTHS.find((m) => m.id === s.month)!.day;

let hoursCache = { key: "", node: null as ReactNode };
function hoursLayer(s: AppState) {
  const key = s.month + s.plot.gardenBearingDeg + JSON.stringify(s.items.filter((i) => ["tree", "shed", "greenhouse"].includes(i.kind)).map((i) => [i.x, i.y, i.w, i.h, i.a, i.pts]));
  if (hoursCache.key === key) return hoursCache.node;
  const cells = sunHoursGrid(s.plot, s.items, monthDay(s));
  const node = (
    <G opacity={0.85}>
      {cells.map((c) => (
        <Rect key={`${c.x},${c.y}`} x={c.x} y={c.y} width={0.52} height={0.52} fill={HOURS_COLOUR[c.band]} />
      ))}
    </G>
  );
  hoursCache = { key, node };
  return node;
}

function shadowLayer(s: AppState) {
  const N = monthDay(s);
  const sh = shadows(s.plot, s.items, sunPosition(s.plot.latitudeDeg, N, solarHour(N, s.time)));
  if (!sh) return <Rect x={0} y={0} width={s.plot.widthM} height={s.plot.rearGardenM} fill={C.ink} opacity={0.4} />;
  return (
    <G clipPath="url(#sclip)" opacity={0.32}>
      {sh.polys.map((P, i) => (
        <Polygon key={i} points={ptsStr(P)} fill={C.ink} />
      ))}
      {sh.trees.map((t, i) => (
        <Circle key={`t${i}`} cx={t.x} cy={t.y} r={t.r} fill={C.ink} />
      ))}
    </G>
  );
}

function northArrow(s: AppState, px: (n: number) => number) {
  const d = planVector(s.plot, 0);
  const cx = s.plot.widthM + 1.5;
  const cy = s.plot.rearGardenM + s.plot.houseDepthM / 2;
  const L = 1.1;
  return (
    <>
      <Line x1={cx - d[0] * L} y1={cy - d[1] * L} x2={cx + d[0] * L} y2={cy + d[1] * L} stroke={C.ink} strokeWidth={px(2)} />
      <Circle cx={cx + d[0] * L} cy={cy + d[1] * L} r={0.22} fill={C.ink} />
      <T x={cx + d[0] * (L + 0.9)} y={cy + d[1] * (L + 0.9) + 0.35} size={0.9} weight="800" anchor="middle" px={px}>
        N
      </T>
    </>
  );
}

function roofLayer(s: AppState, px: (n: number) => number) {
  const { widthM: W, rearGardenM: y0, houseDepthM: h, houseWidthM: w } = s.plot;
  const r = w / 2;
  const P = (pts: Pt[], fill: string) => <Polygon points={pts.map((p) => `${p[0]},${p[1] + y0}`).join(" ")} fill={fill} />;
  const example = s.roof.showExample;
  const scan = roofScan(s, SIM_HOME);
  const centrePlan = gpsToPlan(s, SIM_HOME, scan.center);
  const label = (x: number, y: number, text: string) => (
    <T x={x} y={y} size={0.42} anchor="middle" px={px}>
      {text}
    </T>
  );
  return (
    <>
      {defs(s, px)}
      {!example && <Rect x={-20} y={y0 - 20} width={W + 40} height={h + 40} fill="#DCE3D7" />}
      <Rect x={example ? -1.4 : -5.8} y={y0} width={example ? 1.4 : 5.8} height={h} fill="url(#hatchP)" stroke="#AAB2AE" strokeWidth={px(1)} />
      <T transform={`translate(${example ? -0.6 : -2.9} ${y0 + h / 2}) rotate(-90)`} size={0.38} anchor="middle" fill="#55605E" px={px}>
        {example ? "Neighbour's roof, not scanned" : "Neighbour's roof"}
      </T>
      <Rect x={w} y={y0} width={W - w} height={h} fill="#C2BCAE" />
      {P([[0, 0], [w, 0], [r, r]], "#94553F")}
      {P([[0, h], [w, h], [r, h - r]], "#B5705A")}
      {P([[0, 0], [r, r], [r, h - r], [0, h]], "#A5624F")}
      {P([[w, 0], [r, r], [r, h - r], [w, h]], "#9B5B47")}
      <Rect x={0} y={y0} width={w} height={h} fill="url(#tilesP)" opacity={0.55} />
      <Path d={`M0 ${y0}L${r} ${y0 + r}V${y0 + h - r}L0 ${y0 + h}M${w} ${y0}L${r} ${y0 + r}M${w} ${y0 + h}L${r} ${y0 + h - r}`} stroke="#5E3024" strokeWidth={px(2.5)} fill="none" />
      <Rect x={1.3} y={y0 + 0.7} width={0.7} height={0.95} fill="#6F8B99" stroke="#E9ECEA" strokeWidth={px(1.5)} />
      <Rect x={3.6} y={y0 + 0.8} width={0.7} height={0.95} fill="#6F8B99" stroke="#E9ECEA" strokeWidth={px(1.5)} />
      <Rect x={4.35} y={y0 + 4.05} width={0.85} height={0.6} fill="#8B5444" stroke="#5E3024" strokeWidth={px(1)} />
      <Circle cx={4.6} cy={y0 + 4.35} r={0.14} fill="#3A2A26" />
      <Circle cx={4.95} cy={y0 + 4.35} r={0.14} fill="#3A2A26" />
      <Path d={`M0 ${y0 - 0.1}H${w}M0 ${y0 + h + 0.1}H${w}`} stroke="#E9ECEA" strokeWidth={px(3)} />
      <Rect x={0} y={y0} width={w} height={h} fill="none" stroke={C.ink} strokeWidth={px(1.5)} />
      {label(r, y0 - 0.55, "Rear garden")}
      {label(r, y0 + h + 0.75, "Front, street")}
      {!example && (
        <>
          <Circle cx={centrePlan[0]} cy={centrePlan[1]} r={scan.radiusM} fill="none" stroke={C.ink} strokeWidth={px(1.4)} strokeDasharray={[px(4), px(3)]} />
          <T x={centrePlan[0]} y={centrePlan[1] - scan.radiusM - 0.35} size={0.5} anchor="middle" px={px}>
            {`Drone circles at ${scan.radiusM.toFixed(1)} m from the middle`}
          </T>
        </>
      )}
      {example &&
        EXAMPLE_ROOF_ISSUES.map((it, i) => {
          const sel = s.roof.sel === i;
          return (
            <G key={it.key}>
              {sel && <Circle cx={it.x} cy={y0 + it.y} r={0.6} fill="none" stroke={C.ink} strokeWidth={px(2.5)} />}
              <Circle cx={it.x} cy={y0 + it.y} r={0.38} fill={SEVERITY[it.severity].colour} stroke="#fff" strokeWidth={px(2)} />
              <SText x={it.x} y={y0 + it.y + 0.15} fontSize={0.42} fontWeight="800" textAnchor="middle" fontFamily="sans-serif" fill="#fff">
                {String(i + 1)}
              </SText>
            </G>
          );
        })}
    </>
  );
}

/** The drone's live position and camera footprint during a flight. */
function DroneOverlay({ px }: { px: (n: number) => number }) {
  const d = useDrone();
  const s = useApp();
  const job = d.job;
  const t = d.telemetry;
  if (!job || job.kind === "test" || !t || t.position.lat === 0) return null;
  if (s.tab === "roof" ? job.kind !== "roof" || s.roof.showExample : !(s.tab === "scan" || s.tab === "plan") || job.kind !== "survey") return null;
  const p = gpsToPlan(s, job.anchor, t.position);
  const route = missionOnPlan(s, job.mission, job.anchor);
  const done = job.session.progress.completedWaypoints;
  const last = done.length ? Math.max(...done) : -1;
  const flown = [s.home, ...route.slice(0, last + 1), p];
  const fp = footprintM(MINI_4_PRO, Math.max(1, t.altitudeM));
  const icon = (
    <G transform={`translate(${p[0]} ${p[1]}) scale(${s.tab === "roof" ? 0.8 : 2.1})`}>
      <Circle r={0.55} fill={C.ink} />
      <Circle r={0.22} fill={C.hivis} />
      {[[-0.6, -0.6], [0.6, -0.6], [0.6, 0.6], [-0.6, 0.6]].map((q) => (
        <Circle key={q.join()} cx={q[0]} cy={q[1]} r={0.28} fill="none" stroke={C.ink} strokeWidth={px(1.5)} />
      ))}
    </G>
  );
  return (
    <>
      <Polyline points={ptsStr(flown)} fill="none" stroke={C.hivis} strokeWidth={px(3.5)} />
      {s.tab !== "roof" && job.mission.waypoints[Math.min(last + 1, job.mission.waypoints.length - 1)]?.gimbalPitchDeg === -90 && (
        <Rect x={p[0] - fp.width / 2} y={p[1] - fp.height / 2} width={fp.width} height={fp.height} fill={C.hivis} opacity={0.18} stroke={C.hivis} strokeWidth={px(1)} />
      )}
      {icon}
    </>
  );
}

export { roofView };
