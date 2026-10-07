// Simulator test bench: the first screen of the flight app. It connects to the drone through the
// RC-N2, starts DJI's simulator (propellers OFF, drone on a table) and flies the same scenarios as
// packages/flight-core/test/flight.test.ts, one at a time, with the pilot watching.

import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View, useColorScheme } from "react-native";

import { FlightSession } from "../../packages/flight-core/src/flight-session.ts";
import { fromLocal, type LatLng } from "../../packages/flight-core/src/geo.ts";
import { emptyProgress, type Mission, type ScanProgress } from "../../packages/flight-core/src/mission.ts";
import { planGrid } from "../../packages/flight-core/src/planner.ts";
import { DEFAULT_SAFETY, preflightCheck, type CheckItem } from "../../packages/flight-core/src/safety.ts";
import type { Telemetry } from "../../packages/flight-core/src/bridge.ts";
import { DjiDrone, NativeDroneBridge, type NativeStatus } from "./modules/dji-drone";

/** Where the simulated drone starts. A made-up open field; change it if the simulator complains. */
const SIM_HOME: LatLng = { lat: 52.0, lng: -1.0 };
/** A 20 m x 40 m test area just north of the simulated take-off point. */
const corner = (north: number, east: number) => fromLocal(SIM_HOME, { x: east, y: north });
const TEST_AREA = [corner(-5, -10), corner(35, -10), corner(35, 10), corner(-5, 10)];
const TEST_HEIGHT_M = 15;

type Scenario = {
  id: string;
  title: string;
  /** What the pilot does, in plain words. */
  instructions: string;
  /** What should happen. */
  expect: string;
  /** Automatic action once this many photos are taken. */
  atPhoto?: { count: number; run: (s: FlightSession) => void };
  pass: (s: FlightSession) => boolean;
  resume?: boolean;
};

const SCENARIOS: Scenario[] = [
  {
    id: "normal",
    title: "1. Normal scan",
    instructions: "Watch only. Check the map in the simulator moves north first, then east.",
    expect: "Every photo taken, returns and lands at home.",
    pass: (s) => s.state === "landed" && s.returnReason === "complete",
  },
  {
    id: "appReturn",
    title: "2. Return button in the app",
    instructions: "After 4 photos the app presses its own Return button.",
    expect: "Stops the scan, returns home and lands.",
    atPhoto: { count: 4, run: (s) => s.pilotReturnHome() },
    pass: (s) => s.state === "landed" && s.returnReason === "pilotButton",
  },
  {
    id: "resume",
    title: "3. Resume",
    instructions: "Run straight after test 2. Watch only.",
    expect: "Takes only the photos test 2 missed, then lands.",
    resume: true,
    pass: (s) => s.state === "landed" && s.returnReason === "complete",
  },
  {
    id: "rcReturn",
    title: "4. Return button on the controller",
    instructions: "After a few photos, press and hold the Return to Home button on the RC-N2 until it beeps.",
    expect: "App shows 'drone returned by itself' and stops sending commands.",
    pass: (s) => s.state === "landed" && s.returnReason === "droneInitiated",
  },
  {
    id: "takeover",
    title: "5. Pilot takes over",
    instructions:
      "After a few photos, press the Pause button on the RC-N2 once. Then fly the drone back with the sticks and land it.",
    expect: "App shows 'Pilot has control' straight away and sends no more commands.",
    pass: (s) => s.state === "landed" || s.state === "pilotControl",
  },
  {
    id: "gust",
    title: "6. Gust",
    instructions: "After 4 photos the app sets the simulator wind to 9 m/s.",
    expect: "Stops the scan and returns home (wind over the 8 m/s limit).",
    atPhoto: { count: 4, run: () => DjiDrone.setSimulatorWind(-9, 0) },
    pass: (s) => s.state === "landed" && s.returnReason === "wind",
  },
  {
    id: "signal",
    title: "7. Phone loses the controller",
    instructions:
      "After a few photos, unplug the phone from the controller for 10 seconds, then plug it back in. Leave the controller on.",
    expect:
      "Drone stops and hovers by itself (no more app commands). App shows 'Signal lost', then brings the drone home when the cable is back.",
    pass: (s) => s.state === "landed" && s.returnReason === "signalLoss",
  },
  {
    id: "rcOff",
    title: "8. Controller switched off",
    instructions:
      "After a few photos, switch the RC-N2 off. Wait 30 seconds, switch it back on and wait for the link to come back.",
    expect: "The drone's own failsafe flies it home with no controller or app. The app then shows it returning or landed.",
    pass: (s) =>
      (s.state === "landed" || s.state === "returning") && (s.returnReason === "signalLoss" || s.returnReason === "droneInitiated"),
  },
];

export default function App() {
  const dark = useColorScheme() === "dark";
  const c = dark ? DARK : LIGHT;

  const [telemetry, setTelemetry] = useState<Telemetry | null>(null);
  const [statusLine, setStatusLine] = useState<string>("Starting DJI SDK…");
  const [simOn, setSimOn] = useState(false);
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [checks, setChecks] = useState<CheckItem[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const [, setTick] = useState(0);

  const sessionRef = useRef<FlightSession | null>(null);
  const scenarioRef = useRef<Scenario | null>(null);
  const firedRef = useRef(false);
  const progressRef = useRef<ScanProgress | null>(null);
  const logLenRef = useRef(0);

  const mission: Mission = useMemo(() => planGrid(TEST_AREA, { altitudeM: TEST_HEIGHT_M }), []);

  const addLog = (line: string) => setLog((l) => [`${new Date().toLocaleTimeString()}  ${line}`, ...l].slice(0, 80));

  const bridge = useMemo(
    () =>
      new NativeDroneBridge(DjiDrone, {
        onStatus: (s: NativeStatus) => {
          setStatusLine(s.message);
          addLog(s.message);
        },
        onTelemetry: (t) => {
          setTelemetry(t);
          const session = sessionRef.current;
          if (!session) return;
          session.update();
          // Scenario's automatic action.
          const sc = scenarioRef.current;
          if (sc?.atPhoto && !firedRef.current && session.progress.completedWaypoints.length >= sc.atPhoto.count) {
            firedRef.current = true;
            addLog(`Test action: ${sc.title}`);
            sc.atPhoto.run(session);
          }
          while (session.log.length > logLenRef.current) addLog(session.log[logLenRef.current++]);
          setTick((n) => n + 1);
        },
      }),
    [],
  );

  useEffect(() => {
    bridge.start();
    const s = DjiDrone.getStatus();
    setStatusLine(s.lastMessage ?? (s.registered ? "DJI SDK registered." : "Waiting for DJI SDK…"));
    return () => bridge.stop();
  }, [bridge]);

  const session = sessionRef.current;
  const flying = !!session && !["ready", "landed"].includes(session.state);

  async function toggleSimulator() {
    try {
      if (simOn) {
        await DjiDrone.disableSimulator();
        setSimOn(false);
        addLog("Simulator off.");
      } else {
        await DjiDrone.enableSimulator(SIM_HOME.lat, SIM_HOME.lng);
        setSimOn(true);
        addLog("Simulator on. Propellers must be OFF.");
      }
    } catch (e) {
      addLog(`Simulator: ${(e as Error).message}`);
    }
  }

  function run(sc: Scenario) {
    const progress = sc.resume && progressRef.current ? progressRef.current : emptyProgress(mission);
    const result = preflightCheck({
      settings: DEFAULT_SAFETY,
      boundary: TEST_AREA,
      home: SIM_HOME,
      mission,
      // The simulator has no weather; this stands in for the Met Office check.
      forecast: { speedMs: 0, gustMs: 0, fromDeg: 0, source: "simulator" },
      noFlyZones: [],
      batteryPercent: telemetry?.batteryPercent ?? 0,
    });
    setChecks(result.items.filter((i) => i.status !== "pass"));
    if (!result.canTakeOff) {
      addLog("Pre-flight checks failed. See the list above.");
      return;
    }
    DjiDrone.setSimulatorWind(0, 0);
    const s = new FlightSession({
      mission,
      boundary: TEST_AREA,
      home: SIM_HOME,
      settings: DEFAULT_SAFETY,
      bridge,
      progress,
      onProgress: (p) => (progressRef.current = p),
    });
    sessionRef.current = s;
    scenarioRef.current = sc;
    firedRef.current = false;
    logLenRef.current = 0;
    setScenario(sc);
    addLog(`Starting ${sc.title}`);
    s.start();
  }

  const result = scenario && session && !flying ? (scenario.pass(session) ? "PASS" : "CHECK") : null;

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: c.bg }]}>
      <StatusBar style={dark ? "light" : "dark"} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.title, { color: c.ink }]}>Simulator test bench</Text>
        <Text style={[styles.note, { color: c.warn }]}>Propellers OFF. Drone on a table. Controller on, phone plugged into it.</Text>

        <View style={[styles.card, { backgroundColor: c.card }]}>
          <Text style={[styles.label, { color: c.muted }]}>Drone</Text>
          <Text style={{ color: c.ink }}>{statusLine}</Text>
          <View style={styles.row}>
            <Stat c={c} k="Link" v={telemetry?.signalOk ? "OK" : "None"} bad={!telemetry?.signalOk} />
            <Stat c={c} k="Mode" v={telemetry?.flightMode ?? "–"} />
            <Stat c={c} k="Height" v={telemetry ? `${telemetry.altitudeM.toFixed(1)} m` : "–"} />
            <Stat c={c} k="Battery" v={telemetry ? `${telemetry.batteryPercent}%` : "–"} />
          </View>
          <Button c={c} label={simOn ? "Stop simulator" : "Start simulator"} onPress={toggleSimulator} disabled={flying} />
        </View>

        {session && (
          <View style={[styles.card, { backgroundColor: c.card }]}>
            <Text style={[styles.label, { color: c.muted }]}>{scenario?.title}</Text>
            <Text style={{ color: c.ink, fontWeight: "600" }}>
              {session.state}
              {session.returnReason ? ` (${session.returnReason})` : ""} · photos {session.progress.completedWaypoints.length}/
              {mission.waypoints.length}
            </Text>
            {result && (
              <Text style={{ color: result === "PASS" ? c.ok : c.warn, fontWeight: "700" }}>
                {result === "PASS" ? "PASS" : `CHECK: expected ${scenario?.expect}`}
              </Text>
            )}
            <Button c={c} label="RETURN HOME" danger onPress={() => session.pilotReturnHome()} disabled={!flying} />
          </View>
        )}

        {checks.length > 0 && (
          <View style={[styles.card, { backgroundColor: c.card }]}>
            {checks.map((i) => (
              <Text key={i.id + i.message} style={{ color: i.status === "block" ? c.bad : c.warn }}>
                {i.status === "block" ? "STOP" : "CHECK"}: {i.message}
              </Text>
            ))}
          </View>
        )}

        <Text style={[styles.label, { color: c.muted }]}>Tests, in order</Text>
        {SCENARIOS.map((sc) => (
          <View key={sc.id} style={[styles.card, { backgroundColor: c.card }]}>
            <Text style={{ color: c.ink, fontWeight: "700" }}>{sc.title}</Text>
            <Text style={{ color: c.ink }}>{sc.instructions}</Text>
            <Text style={{ color: c.muted }}>Expected: {sc.expect}</Text>
            <Button c={c} label="Run" onPress={() => run(sc)} disabled={!simOn || flying || !telemetry?.signalOk} />
          </View>
        ))}

        <Text style={[styles.label, { color: c.muted }]}>Log</Text>
        <View style={[styles.card, { backgroundColor: c.card }]}>
          {log.map((l, i) => (
            <Text key={i} style={[styles.mono, { color: c.muted }]}>
              {l}
            </Text>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

type Colors = typeof LIGHT;

function Stat({ c, k, v, bad }: { c: Colors; k: string; v: string; bad?: boolean }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.label, { color: c.muted }]}>{k}</Text>
      <Text style={{ color: bad ? c.bad : c.ink, fontWeight: "600" }}>{v}</Text>
    </View>
  );
}

function Button({ c, label, onPress, disabled, danger }: { c: Colors; label: string; onPress: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={[styles.button, { backgroundColor: danger ? c.bad : c.accent, opacity: disabled ? 0.4 : 1 }]}
    >
      <Text style={{ color: c.onAccent, fontWeight: "700", textAlign: "center" }}>{label}</Text>
    </Pressable>
  );
}

const LIGHT = { bg: "#e9eee9", card: "#ffffff", ink: "#14211b", muted: "#56665e", accent: "#1d6b47", onAccent: "#ffffff", ok: "#23824f", warn: "#a86f00", bad: "#b8322a" };
const DARK = { bg: "#0d1411", card: "#151f1a", ink: "#e2ebe5", muted: "#93a39a", accent: "#5cc08c", onAccent: "#0b1a12", ok: "#5cc08c", warn: "#e6b23a", bad: "#f0776c" };

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: 16, gap: 12 },
  title: { fontSize: 24, fontWeight: "700" },
  note: { fontWeight: "600" },
  card: { borderRadius: 12, padding: 12, gap: 8 },
  label: { fontSize: 12, textTransform: "uppercase", letterSpacing: 0.8 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  stat: { minWidth: 70, gap: 2 },
  button: { borderRadius: 10, paddingVertical: 12, paddingHorizontal: 14 },
  mono: { fontFamily: "monospace", fontSize: 11 },
});
