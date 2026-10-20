// Full screen: the plot drawing (title plan) laid over a satellite photo. The owner drags it into
// place, turns and sizes it to match, then taps the plot's four corners (or, for any other shape,
// traces its boundary point by point); the app works the plot out.

import { useRef, useState } from "react";
import { Image, PanResponder, ScrollView, StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Polygon, Polyline, Text as SText } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { areaM2, type LatLng } from "../../../packages/flight-core/src/geo.ts";
import { latLngToWorldPx, metresPerPx, plotFromCorners, rectAroundPolygon, tilesAround, worldPxToLatLng } from "../../../packages/flight-core/src/georef.ts";

import { applyBoundary, applyCorners, drawingUri, findPlace } from "./projects";
import { S, commit, currentProject, type Project } from "./store";
import { C } from "./theme";
import { Btn, Card, Chip, Chips, Field, H2, Line, Note, Seg, Status } from "./ui";

/** Esri's World Imagery satellite tiles (free to view, with this credit shown). */
const tileUrl = (z: number, x: number, y: number) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
const CREDIT = "Imagery © Esri, Maxar, Earthstar Geographics";

const CORNER_NAMES = ["far end, left", "far end, right", "street end, right", "street end, left"];

/** Enough for a boundary with many turns; more would be fiddly to tap anyway. */
const MAX_TRACE = 60;

/** Zoomed out this far, a whole town fits on the screen: enough to find the site from a wrong postcode. */
const MIN_ZOOM = 14;

/** A tap moves less than this; more is a drag. */
const TAP_PX = 10;

export function LineUp() {
  const p = currentProject();
  const insets = useSafeAreaInsets();
  const drawing = p.drawing!;
  const start = p.overlay?.centre ?? p.postcodeAt!;
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [z, setZ] = useState(19);
  const [mapCentre, setMapCentre] = useState<LatLng>(start);
  /** Metres on the ground per drawing pixel at a printed scale (PDFs know their paper size). */
  const atScale = (scale: number) => (drawing.paperWidthMm! / 1000) * scale / drawing.widthPx;
  // A PDF starts at 1:1250, the usual scale of title and location plans; a picture about 60 m across.
  const [ov, setOv] = useState<NonNullable<Project["overlay"]>>(
    p.overlay ?? { centre: start, rotationDeg: 0, metresPerPx: drawing.paperWidthMm ? atScale(1250) : 60 / drawing.widthPx },
  );
  const [mode, setMode] = useState<"move" | "corners" | "trace">(p.boundary ? "trace" : "move");
  const [corners, setCorners] = useState<LatLng[]>(p.boundary ? [] : (p.corners ?? []));
  const [trace, setTrace] = useState<LatLng[]>(p.boundary ?? []);
  const [opacity, setOpacity] = useState(0.55);
  /** What a drag moves in "Move the plan": the plan, or the satellite photo under it. */
  const [dragWhat, setDragWhat] = useState<"plan" | "photo">("plan");
  const [found, setFound] = useState<{ ok: boolean; text: string } | null>(null);

  const c = latLngToWorldPx(mapCentre, z);
  const toScreen = (q: LatLng) => {
    const w = latLngToWorldPx(q, z);
    return { x: w.x - c.x + size.w / 2, y: w.y - c.y + size.h / 2 };
  };
  const toLatLng = (x: number, y: number) => worldPxToLatLng(c.x + x - size.w / 2, c.y + y - size.h / 2, z);
  const mpp = metresPerPx(mapCentre.lat, z);

  // The touch handler is made once, so it reads the latest values through a ref.
  const now = useRef({ mode, ov, corners, trace, toScreen, toLatLng, dragWhat, c, z });
  now.current = { mode, ov, corners, trace, toScreen, toLatLng, dragWhat, c, z };
  const dragFrom = useRef<{ x: number; y: number } | null>(null);
  const touch = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        const n = now.current;
        // Dragging the photo: remember the map's middle (world pixels); dragging the plan: where it is on screen.
        dragFrom.current = n.mode === "move" && n.dragWhat === "photo" ? { x: n.c.x, y: n.c.y } : n.toScreen(n.ov.centre);
      },
      onPanResponderMove: (_, g) => {
        const n = now.current;
        if (n.mode !== "move" || !dragFrom.current) return;
        if (n.dragWhat === "photo") setMapCentre(worldPxToLatLng(dragFrom.current.x - g.dx, dragFrom.current.y - g.dy, n.z));
        else setOv({ ...n.ov, centre: n.toLatLng(dragFrom.current.x + g.dx, dragFrom.current.y + g.dy) });
      },
      onPanResponderRelease: (e, g) => {
        const n = now.current;
        if (n.mode === "move" || Math.abs(g.dx) + Math.abs(g.dy) > TAP_PX) return;
        const at = n.toLatLng(e.nativeEvent.locationX, e.nativeEvent.locationY);
        if (n.mode === "corners" && n.corners.length < 4) setCorners([...n.corners, at]);
        if (n.mode === "trace" && n.trace.length < MAX_TRACE) setTrace([...n.trace, at]);
      },
    }),
  ).current;

  const close = () => {
    S.lineUp = false;
    commit();
  };
  const saveOverlay = () => {
    currentProject().overlay = ov;
    close();
  };

  const d = toScreen(ov.centre);
  const dw = (drawing.widthPx * ov.metresPerPx) / mpp;
  const dh = (drawing.heightPx * ov.metresPerPx) / mpp;
  const shown = mode === "trace" ? trace : corners;
  const pts = shown.map(toScreen);
  const closedShape = mode === "trace" ? trace.length >= 3 : corners.length === 4;
  const result = corners.length === 4 ? plotFromCorners(corners) : null;
  const traced = trace.length >= 3 ? { rect: plotFromCorners(rectAroundPolygon(trace)), areaM2: areaM2(trace) } : null;
  const turn = (deg: number) => setOv({ ...ov, rotationDeg: (ov.rotationDeg + deg + 360) % 360 });
  const scale = (f: number) => setOv({ ...ov, metresPerPx: ov.metresPerPx * f });

  return (
    <View style={[styles.body, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.map} onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })} {...touch.panHandlers}>
        {/* Pictures only: the touches go to the map underneath. */}
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
        {size.w > 0 &&
          tilesAround(mapCentre, z, size.w, size.h).map((t) => (
            <Image key={`${z}/${t.x}/${t.y}`} source={{ uri: tileUrl(z, t.x, t.y) }} style={{ position: "absolute", left: t.left, top: t.top, width: 256, height: 256 }} />
          ))}
        {size.w > 0 && (
          <Image
            source={{ uri: drawingUri(p)! }}
            style={{ position: "absolute", left: d.x - dw / 2, top: d.y - dh / 2, width: dw, height: dh, opacity, transform: [{ rotate: `${ov.rotationDeg}deg` }] }}
          />
        )}
        </View>
        <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
          {closedShape ? (
            <Polygon points={pts.map((q) => `${q.x},${q.y}`).join(" ")} fill="none" stroke={C.hivis} strokeWidth={3} />
          ) : (
            pts.length > 1 && <Polyline points={pts.map((q) => `${q.x},${q.y}`).join(" ")} fill="none" stroke={C.hivis} strokeWidth={3} />
          )}
          {pts.map((q, i) => (
            <Circle key={i} cx={q.x} cy={q.y} r={9} fill={C.hivis} stroke={C.ink} strokeWidth={2} />
          ))}
          {pts.map((q, i) => (
            <SText key={`t${i}`} x={q.x} y={q.y + 4} fontSize={11} fontWeight="700" textAnchor="middle" fill={C.ink}>
              {i + 1}
            </SText>
          ))}
        </Svg>
        <Text style={styles.credit}>{CREDIT}</Text>
      </View>

      <ScrollView style={styles.panel} contentContainerStyle={{ padding: 16 }}>
        <H2 small>Line up the title plan</H2>
        <Seg
          options={[
            ["move", "Move the plan"],
            ["corners", "Mark the corners"],
            ["trace", "Trace any shape"],
          ]}
          value={mode}
          onChange={setMode}
        />
        {mode === "move" ? (
          <>
            <Note>
              First find the site in the photo: search for it, or drag the photo (zoom out to look further). Then drag the plan until its boundary sits on
              the plot, and turn and size it to match. Lines on houses and fences make good guides.
            </Note>
            <Field
              label="Find a place"
              value=""
              placeholder="e.g. Station Road, Ashford"
              onCommit={async (q) => {
                if (!q.trim()) return;
                try {
                  const place = await findPlace(q);
                  // The photo and the plan both go there; the plan then only needs fine adjusting.
                  setMapCentre(place.at);
                  setOv({ ...ov, centre: place.at });
                  setFound({ ok: true, text: `Found: ${place.name}` });
                } catch (e) {
                  setFound({ ok: false, text: (e as Error).message });
                }
              }}
            />
            {found && <Status status={found.ok ? "pass" : "block"} text={found.text} />}
            <Chips>
              <Chip label="Drag moves the plan" pressed={dragWhat === "plan"} onPress={() => setDragWhat("plan")} />
              <Chip label="Drag moves the photo" pressed={dragWhat === "photo"} onPress={() => setDragWhat("photo")} />
            </Chips>
            <Chips>
              <Chip label="Bring the plan to the middle of the photo" onPress={() => setOv({ ...ov, centre: mapCentre })} />
            </Chips>
            <Chips>
              <Chip label="Turn ⟲ 5°" onPress={() => turn(-5)} />
              <Chip label="⟲ 1°" onPress={() => turn(-1)} />
              <Chip label="⟳ 1°" onPress={() => turn(1)} />
              <Chip label="⟳ 5°" onPress={() => turn(5)} />
            </Chips>
            {drawing.paperWidthMm && (
              <>
                <Note>Scale printed on the plan (sets its size exactly; then only small changes should be needed):</Note>
                <Chips>
                  {[500, 1250, 2500].map((sc) => (
                    <Chip key={sc} label={`1:${sc}`} pressed={Math.abs(ov.metresPerPx / atScale(sc) - 1) < 0.001} onPress={() => setOv({ ...ov, metresPerPx: atScale(sc) })} />
                  ))}
                </Chips>
              </>
            )}
            <Chips>
              <Chip label="Smaller" onPress={() => scale(1 / 1.1)} />
              <Chip label="−2%" onPress={() => scale(1 / 1.02)} />
              <Chip label="+2%" onPress={() => scale(1.02)} />
              <Chip label="Bigger" onPress={() => scale(1.1)} />
            </Chips>
            <Chips>
              <Chip label="More see-through" onPress={() => setOpacity(Math.max(0.15, opacity - 0.15))} />
              <Chip label="Less see-through" onPress={() => setOpacity(Math.min(1, opacity + 0.15))} />
            </Chips>
            <Chips>
              <Chip label="Zoom out" onPress={() => setZ(Math.max(MIN_ZOOM, z - 1))} />
              <Chip label="Zoom in" onPress={() => setZ(Math.min(19, z + 1))} />
              <Chip label="Centre the photo on the plan" onPress={() => setMapCentre(ov.centre)} />
            </Chips>
          </>
        ) : mode === "trace" ? (
          <>
            <Note>
              For a plot that is not a simple rectangle. Start at a corner of the far end (the end away from the road or the entrance), then tap every turn
              of the boundary line in order, all the way round. The shape closes itself; there is no need to tap the first point again.
            </Note>
            <Text style={styles.next}>
              {trace.length === 0 ? "Next: point 1, a corner of the far end" : `${trace.length} point${trace.length === 1 ? "" : "s"} so far${trace.length < 3 ? " (at least 3 needed)" : ""}`}
            </Text>
            <Chips>
              <Chip label="Undo last point" onPress={() => setTrace(trace.slice(0, -1))} />
              <Chip label="Start again" onPress={() => setTrace([])} />
            </Chips>
            {traced && (
              <>
                <Card>
                  <Line first k="Area inside the boundary" v={`${Math.round(traced.areaM2)} m²`} />
                  <Line k="Length (far end to the road)" v={`${traced.rect.lengthM.toFixed(1)} m`} />
                  <Line k="Widest" v={`${traced.rect.widthM.toFixed(1)} m`} />
                  <Line k="Runs" v={`${Math.round(traced.rect.gardenBearingDeg)}°`} />
                </Card>
                <Note>Scans and the flying limit follow this outline. The design screens use the rectangle round it. A survey made for the old shape will need making again.</Note>
                <Btn
                  label={`Use this boundary (${trace.length} points)`}
                  onPress={() => {
                    applyBoundary(trace, ov);
                    S.lineUp = false;
                    commit();
                  }}
                />
              </>
            )}
          </>
        ) : (
          <>
            <Note>
              Looking down the garden from the house, tap the plot's corners in this order on the plan's boundary line: 1 far end left, 2 far end right, 3
              street end right, 4 street end left.
            </Note>
            {corners.length < 4 && <Text style={styles.next}>Next: corner {corners.length + 1}, {CORNER_NAMES[corners.length]}</Text>}
            <Chips>
              <Chip label="Undo last corner" onPress={() => setCorners(corners.slice(0, -1))} />
              <Chip label="Start the corners again" onPress={() => setCorners([])} />
            </Chips>
            {result && (
              <>
                <Card>
                  <Line first k="Width" v={`${result.widthM.toFixed(1)} m`} />
                  <Line k="Length (garden, house and front)" v={`${result.lengthM.toFixed(1)} m`} />
                  <Line k="Garden runs" v={`${Math.round(result.gardenBearingDeg)}°`} />
                </Card>
                <Note>Using these changes the plot's size and direction. A survey made for the old size will need making again.</Note>
                <Btn
                  label="Use these measurements"
                  onPress={() => {
                    applyCorners(corners, ov);
                    S.lineUp = false;
                    commit();
                  }}
                />
              </>
            )}
          </>
        )}
        <Btn label="Save the position and close" alt onPress={saveOverlay} />
        <Btn label="Cancel" alt onPress={close} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, backgroundColor: C.ground },
  map: { flex: 1, overflow: "hidden", backgroundColor: "#333" },
  credit: { position: "absolute", left: 6, bottom: 4, fontSize: 10, color: C.white, textShadowColor: "#000", textShadowRadius: 3 },
  panel: { maxHeight: "45%", backgroundColor: C.paper, borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  next: { fontWeight: "700", color: C.ink, marginVertical: 6 },
});
