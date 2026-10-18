// Full screen: the plot drawing (title plan) laid over a satellite photo. The owner drags it into
// place, turns and sizes it to match, then taps the plot's four corners; the app works the plot out.

import { useRef, useState } from "react";
import { Image, PanResponder, ScrollView, StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Polygon, Polyline, Text as SText } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { LatLng } from "../../../packages/flight-core/src/geo.ts";
import { latLngToWorldPx, metresPerPx, plotFromCorners, tilesAround, worldPxToLatLng } from "../../../packages/flight-core/src/georef.ts";

import { applyCorners, drawingUri } from "./projects";
import { S, commit, currentProject, type Project } from "./store";
import { C } from "./theme";
import { Btn, Card, Chip, Chips, H2, Line, Note, Seg } from "./ui";

/** Esri's World Imagery satellite tiles (free to view, with this credit shown). */
const tileUrl = (z: number, x: number, y: number) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
const CREDIT = "Imagery © Esri, Maxar, Earthstar Geographics";

const CORNER_NAMES = ["far end, left", "far end, right", "street end, right", "street end, left"];

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
  const [mode, setMode] = useState<"move" | "corners">("move");
  const [corners, setCorners] = useState<LatLng[]>(p.corners ?? []);
  const [opacity, setOpacity] = useState(0.55);

  const c = latLngToWorldPx(mapCentre, z);
  const toScreen = (q: LatLng) => {
    const w = latLngToWorldPx(q, z);
    return { x: w.x - c.x + size.w / 2, y: w.y - c.y + size.h / 2 };
  };
  const toLatLng = (x: number, y: number) => worldPxToLatLng(c.x + x - size.w / 2, c.y + y - size.h / 2, z);
  const mpp = metresPerPx(mapCentre.lat, z);

  // The touch handler is made once, so it reads the latest values through a ref.
  const now = useRef({ mode, ov, corners, toScreen, toLatLng });
  now.current = { mode, ov, corners, toScreen, toLatLng };
  const dragFrom = useRef<{ x: number; y: number } | null>(null);
  const touch = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        dragFrom.current = now.current.toScreen(now.current.ov.centre);
      },
      onPanResponderMove: (_, g) => {
        const n = now.current;
        if (n.mode !== "move" || !dragFrom.current) return;
        setOv({ ...n.ov, centre: n.toLatLng(dragFrom.current.x + g.dx, dragFrom.current.y + g.dy) });
      },
      onPanResponderRelease: (e, g) => {
        const n = now.current;
        if (n.mode !== "corners" || Math.abs(g.dx) + Math.abs(g.dy) > TAP_PX || n.corners.length >= 4) return;
        setCorners([...n.corners, n.toLatLng(e.nativeEvent.locationX, e.nativeEvent.locationY)]);
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
  const pts = corners.map(toScreen);
  const result = corners.length === 4 ? plotFromCorners(corners) : null;
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
          {pts.length === 4 ? (
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
          ]}
          value={mode}
          onChange={setMode}
        />
        {mode === "move" ? (
          <>
            <Note>Drag the plan until its boundary sits on your plot in the photo, then turn and size it to match. Lines on houses and fences make good guides.</Note>
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
              <Chip label="Zoom out" onPress={() => setZ(Math.max(17, z - 1))} />
              <Chip label="Zoom in" onPress={() => setZ(Math.min(19, z + 1))} />
              <Chip label="Centre the photo on the plan" onPress={() => setMapCentre(ov.centre)} />
            </Chips>
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
