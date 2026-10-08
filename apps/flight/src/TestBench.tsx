// Simulator test bench, opened from the Scan tab. It starts DJI's simulator (propellers OFF, drone
// on a table) and flies the same scenarios as packages/flight-core/test/flight.test.ts, one at a
// time, with the pilot watching. Real flights unlock once all of them have passed.

import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import type { FlightSession } from "../../../packages/flight-core/src/flight-session.ts";
import { fromLocal } from "../../../packages/flight-core/src/geo.ts";
import { emptyProgress, type Mission, type ScanProgress } from "../../../packages/flight-core/src/mission.ts";
import { planGrid } from "../../../packages/flight-core/src/planner.ts";
import { DEFAULT_SAFETY, preflightCheck, type CheckItem } from "../../../packages/flight-core/src/safety.ts";
import { DjiDrone } from "../modules/dji-drone";
import { SIM_HOME, drone, useDrone } from "./drone";
import { S, commit, commitNow } from "./store";
/** A 20 m x 40 m test area just north of the simulated take-off point. */
const corner = (north: number, east: number) => fromLocal(SIM_HOME, { x: east, y: north });
// Small on purpose: each test then takes about 2 minutes, so the drone (motors running on a table,
// with no air flowing over it) does not overheat and fly home by itself part-way through.
const TEST_AREA = [corner(-5, -6), corner(15, -6), corner(15, 6), corner(-5, 6)];
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
  {
    id: "emergencyStop",
    title: "9. Emergency STOP button",
    instructions:
      "After a few photos, tap the red STOP button at the bottom of the screen. Watch the simulator for 10 seconds, then tap Resume scan.",
    expect: "Stops and hovers in place (no drifting, no photos) until Resume, then finishes the scan and lands at home.",
    pass: (s) => s.state === "landed" && s.returnReason === "complete" && s.log.some((l) => l.includes("-> holding")),
  },
];

export function TestBench() {
  const c = LIGHT;
  const d = useDrone();
  const telemetry = d.telemetry;
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [checks, setChecks] = useState<CheckItem[]>([]);

  const scenarioRef = useRef<Scenario | null>(null);
  const firedRef = useRef(false);
  const progressRef = useRef<ScanProgress | null>(null);

  const mission: Mission = useMemo(() => planGrid(TEST_AREA, { altitudeM: TEST_HEIGHT_M }), []);

  // Each scenario's automatic action, once enough photos are taken.
  useEffect(
    () =>
      drone.onTelemetry(() => {
        const session = drone.job?.kind === "test" ? drone.job.session : null;
        const sc = scenarioRef.current;
        if (session && sc?.atPhoto && !firedRef.current && session.progress.completedWaypoints.length >= sc.atPhoto.count) {
          firedRef.current = true;
          drone.addLog(`Test action: ${sc.title}`);
          sc.atPhoto.run(session);
        }
      }),
    [],
  );

  const session = d.job?.kind === "test" ? d.job.session : null;
  const flying = d.flying;

  async function toggleSimulator() {
    try {
      await d.setSimulator(!d.simOn);
    } catch {
      // Shown in the log.
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
      drone.addLog("Pre-flight checks failed. See the list above.");
      return;
    }
    DjiDrone.setSimulatorWind(0, 0);
    scenarioRef.current = sc;
    firedRef.current = false;
    setScenario(sc);
    drone.startJob("test", SIM_HOME, {
      mission,
      boundary: TEST_AREA,
      settings: DEFAULT_SAFETY,
      progress,
      onProgress: (p) => (progressRef.current = p),
    });
  }

  const result = scenario && session && !flying ? (scenario.pass(session) ? "PASS" : "CHECK") : null;

  useEffect(() => {
    if (result === "PASS" && scenario && !S.testsPassed.includes(scenario.id)) {
      S.testsPassed = [...S.testsPassed, scenario.id];
      commitNow();
    }
  }, [result, scenario]);

  return (
    <View style={[styles.root, { backgroundColor: c.bg }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Button
          c={c}
          label="← Back to the app"
          onPress={() => {
            S.showBench = false;
            commit();
          }}
          disabled={flying}
        />
        <Text style={[styles.title, { color: c.ink }]}>Simulator test bench</Text>
        <Text style={{ color: c.muted }}>
          Passed: {S.testsPassed.length} of {SCENARIOS.length}. Real flights unlock when all have passed.
        </Text>
        <Text style={[styles.note, { color: c.warn }]}>Propellers OFF. Drone on a table. Controller on, phone plugged into it.</Text>

        <View style={[styles.card, { backgroundColor: c.card }]}>
          <Text style={[styles.label, { color: c.muted }]}>Drone</Text>
          <Text style={{ color: c.ink }}>{d.status}</Text>
          <Text style={{ color: telemetry?.signalOk ? c.ok : c.warn }}>{d.bridge.linkReport()}</Text>
          <View style={styles.row}>
            <Stat c={c} k="Link" v={telemetry?.signalOk ? "OK" : "None"} bad={!telemetry?.signalOk} />
            <Stat c={c} k="Mode" v={telemetry?.flightMode ?? "–"} />
            <Stat c={c} k="Height" v={telemetry ? `${telemetry.altitudeM.toFixed(1)} m` : "–"} />
            <Stat c={c} k="Battery" v={telemetry ? `${telemetry.batteryPercent}%` : "–"} />
          </View>
          <Button c={c} label={d.simOn ? "Stop simulator" : "Start simulator"} onPress={toggleSimulator} disabled={flying} />
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
            <Button c={c} label="RETURN HOME" danger onPress={() => d.returnHome()} disabled={!flying} />
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
            <Text style={{ color: c.ink, fontWeight: "700" }}>
              {sc.title}
              {S.testsPassed.includes(sc.id) ? "  ✓ passed" : ""}
            </Text>
            <Text style={{ color: c.ink }}>{sc.instructions}</Text>
            <Text style={{ color: c.muted }}>Expected: {sc.expect}</Text>
            <Button c={c} label="Run" onPress={() => run(sc)} disabled={!d.simOn || flying || !telemetry?.signalOk} />
          </View>
        ))}

        <Text style={[styles.label, { color: c.muted }]}>Log</Text>
        <View style={[styles.card, { backgroundColor: c.card }]}>
          {d.log.map((l, i) => (
            <Text key={i} style={[styles.mono, { color: c.muted }]}>
              {l}
            </Text>
          ))}
        </View>
      </ScrollView>
    </View>
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
