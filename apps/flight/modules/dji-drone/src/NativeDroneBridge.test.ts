// Runs FlightSession through NativeDroneBridge with a fake native module, so the JavaScript half
// of the Android module is tested here. The fake forwards commands to flight-core's SimDrone and
// reports back in the same shape as the Kotlin DroneController.

import { test } from "node:test";
import assert from "node:assert/strict";

import { FlightSession } from "../../../../../packages/flight-core/src/flight-session.ts";
import { distanceM, fromLocal, type LatLng } from "../../../../../packages/flight-core/src/geo.ts";
import { planGrid } from "../../../../../packages/flight-core/src/planner.ts";
import { DEFAULT_SAFETY, type SignalLossAction } from "../../../../../packages/flight-core/src/safety.ts";
import { SimDrone } from "../../../../../packages/flight-core/src/sim-drone.ts";
import type { DjiDroneNative, NativeDroneEvent, NativeStatus, NativeTelemetry } from "./DjiDrone.types.ts";
import { NativeDroneBridge, STALE_AFTER_MS } from "./NativeDroneBridge.ts";

const HOME: LatLng = { lat: 52.0, lng: -1.0 };
const corner = (n: number, e: number) => fromLocal(HOME, { x: e, y: n });
const AREA = [corner(-5, -10), corner(35, -10), corner(35, 10), corner(-5, 10)];

type Listener = (payload: never) => void;

class FakeNative implements DjiDroneNative {
  readonly sim = new SimDrone({ home: HOME });
  timeMs = 0;
  /** Simulates the phone-to-controller cable being pulled: no messages at all. */
  silent = false;
  /** The drone reports no wind direction. */
  hideWindDirection = false;
  calls: string[] = [];
  private listeners = new Map<string, Listener[]>();

  addListener(event: string, listener: (payload: never) => void) {
    const list = this.listeners.get(event) ?? [];
    list.push(listener);
    this.listeners.set(event, list);
    return { remove: () => this.listeners.set(event, (this.listeners.get(event) ?? []).filter((l) => l !== listener)) };
  }

  private emit(event: string, payload: NativeTelemetry | NativeDroneEvent | NativeStatus) {
    for (const l of this.listeners.get(event) ?? []) (l as (p: typeof payload) => void)(payload);
  }

  /** One 100 ms tick of the Kotlin loop. */
  tick() {
    this.sim.step(0.1);
    this.timeMs += 100;
    if (this.silent) return;
    for (const e of this.sim.drainEvents()) this.emit("onDroneEvent", e as NativeDroneEvent);
    const t = this.sim.telemetry();
    this.emit("onTelemetry", {
      lat: t.position.lat,
      lng: t.position.lng,
      altitudeM: t.altitudeM,
      batteryPercent: Math.round(t.batteryPercent),
      flightMode: t.flightMode,
      signalOk: t.signalOk,
      windSpeedMs: t.wind?.speedMs ?? null,
      windFromDeg: this.hideWindDirection ? null : (t.wind?.fromDeg ?? null),
      windWarning: t.windWarning,
      headingDeg: 0,
      productType: "DJI_MINI_4_PRO",
      djiFlightMode: null,
      pilotTookOver: t.flightMode === "pilot",
      obstacleM: t.obstacleM ?? null,
    });
  }

  getStatus() {
    return { registered: true, productConnected: true, lastKind: null, lastMessage: null };
  }
  configureFailsafe(homeLat: number, homeLng: number, returnHeightM: number, action: SignalLossAction) {
    this.calls.push(`configureFailsafe ${returnHeightM} ${action}`);
    this.sim.configureFailsafe({ home: { lat: homeLat, lng: homeLng }, returnHeightM, signalLossAction: action });
    this.emit("onStatus", { kind: "failsafeConfigured", message: "stored" });
  }
  takeOff() {
    this.calls.push("takeOff");
    this.sim.takeOff();
  }
  goTo(lat: number, lng: number, altitudeM: number, speedMs: number, headingDeg: number | null) {
    this.calls.push(`goTo heading=${headingDeg}`);
    this.sim.goTo({ lat, lng }, altitudeM, speedMs);
  }
  setGimbalPitch(deg: number) {
    this.calls.push(`gimbal ${deg}`);
  }
  takePhoto(i: number) {
    this.sim.takePhoto(i);
  }
  hover() {
    this.sim.hover();
  }
  returnHome() {
    this.calls.push("returnHome");
    this.sim.returnHome();
  }
  land() {
    this.sim.land();
  }
  async enableSimulator() {}
  async disableSimulator() {}
  async formatStorage() {}
  setSimulatorWind(northMs: number, eastMs: number) {
    const speed = Math.hypot(northMs, eastMs);
    this.sim.setWind({ speedMs: speed, fromDeg: ((Math.atan2(-eastMs, -northMs) * 180) / Math.PI + 360) % 360 });
  }
}

function setup() {
  const native = new FakeNative();
  const statuses: NativeStatus[] = [];
  let session!: FlightSession;
  const bridge = new NativeDroneBridge(native, {
    now: () => native.timeMs,
    onStatus: (s) => statuses.push(s),
    onTelemetry: () => session.update(),
  });
  bridge.start();
  const mission = planGrid(AREA, { altitudeM: 20 });
  session = new FlightSession({
    mission,
    boundary: AREA,
    home: HOME,
    settings: DEFAULT_SAFETY,
    bridge,
    clock: () => native.timeMs / 1000,
  });
  return { native, bridge, session, mission, statuses };
}

function runUntil(native: FakeNative, done: () => boolean, maxS = 1800) {
  while (native.timeMs < maxS * 1000) {
    native.tick();
    if (done()) return;
  }
  throw new Error("timed out");
}

test("full scan through the native bridge: every photo, lands at home", () => {
  const { native, session, mission, statuses } = setup();
  session.start();
  runUntil(native, () => session.state === "landed");
  assert.equal(session.returnReason, "complete");
  assert.equal(native.sim.photos.length, mission.waypoints.length);
  assert.ok(distanceM(native.sim.telemetry().position, HOME) < 1);
  assert.ok(native.calls[0].startsWith("configureFailsafe 30 returnHome"), "failsafe stored before take-off");
  assert.equal(native.calls[1], "takeOff");
  assert.ok(native.calls.includes("gimbal -90"));
  assert.ok(native.calls.some((c) => c === "goTo heading=0" || /goTo heading=\d/.test(c)), "headings passed through");
  assert.ok(statuses.some((s) => s.kind === "failsafeConfigured"));
});

test("pilot presses RTH on the controller: the app follows", () => {
  const { native, session } = setup();
  session.start();
  runUntil(native, () => native.sim.photos.length >= 3);
  native.sim.pilotPressesReturnHome();
  runUntil(native, () => session.state === "landed");
  assert.equal(session.returnReason, "droneInitiated");
});

test("app Return button sends Return to Home", () => {
  const { native, session } = setup();
  session.start();
  runUntil(native, () => native.sim.photos.length >= 3);
  session.pilotReturnHome();
  assert.ok(native.calls.includes("returnHome"));
  runUntil(native, () => session.state === "landed");
});

test("gust from the simulator wind setting: returns home", () => {
  const { native, session } = setup();
  session.start();
  runUntil(native, () => native.sim.photos.length >= 3);
  native.setSimulatorWind(-9, 0); // 9 m/s from the north
  runUntil(native, () => session.state === "landed");
  assert.equal(session.returnReason, "wind");
});

test("obstacle from the drone's sensors: stops and hovers, Resume finishes the scan", () => {
  const { native, session, mission } = setup();
  session.start();
  runUntil(native, () => native.sim.photos.length >= 3);
  native.sim.setObstacle(2);
  runUntil(native, () => session.state === "holding");
  assert.equal(session.holdReason, "obstacle");
  native.sim.setObstacle(undefined);
  session.pilotResume();
  runUntil(native, () => session.state === "landed");
  assert.equal(session.returnReason, "complete");
  assert.equal(new Set(native.sim.photos.map((p) => p.waypointIndex)).size, mission.waypoints.length);
});

test("test bench obstacle stands in for the drone's own reading", () => {
  const { native, bridge } = setup();
  native.tick();
  assert.equal(bridge.telemetry().obstacleM, undefined);
  bridge.setTestObstacle(2);
  assert.equal(bridge.telemetry().obstacleM, 2);
  bridge.setTestObstacle(null);
  assert.equal(bridge.telemetry().obstacleM, undefined);
});

test("no telemetry for 2 seconds counts as signal lost", () => {
  const { native, bridge } = setup();
  native.tick();
  assert.equal(bridge.telemetry().signalOk, true);
  native.silent = true;
  for (let i = 0; i < STALE_AFTER_MS / 100 + 1; i++) native.tick();
  assert.equal(bridge.telemetry().signalOk, false);
});

test("no GPS position yet counts as no link", () => {
  const native = new FakeNative();
  const bridge = new NativeDroneBridge(native, { now: () => native.timeMs });
  bridge.start();
  assert.equal(bridge.telemetry().signalOk, false, "before any telemetry");
});

test("link report says which part is not connected", () => {
  const native = new FakeNative();
  const bridge = new NativeDroneBridge(native, { now: () => native.timeMs });
  bridge.start();
  assert.match(bridge.linkReport(), /Nothing heard/);
  const base = { lat: null, lng: null, altitudeM: 0, batteryPercent: 80, flightMode: "onGround", signalOk: false, windSpeedMs: null, windFromDeg: null, windWarning: "none", headingDeg: 0, productType: null, djiFlightMode: null, pilotTookOver: false, sdkListening: true } as const;
  const send = (t: Partial<NativeTelemetry>) => (native as unknown as { emit(e: string, p: NativeTelemetry): void }).emit("onTelemetry", { ...base, ...t });
  send({ rcConnected: false, aircraftConnected: false });
  assert.match(bridge.linkReport(), /Controller not connected/);
  send({ rcConnected: true, aircraftConnected: false });
  assert.match(bridge.linkReport(), /not the drone/);
  send({ rcConnected: true, aircraftConnected: true });
  assert.match(bridge.linkReport(), /no GPS position/);
  send({ rcConnected: true, aircraftConnected: true, lat: 52, lng: -1, signalOk: true });
  assert.match(bridge.linkReport(), /Drone and controller connected/);
  native.timeMs += STALE_AFTER_MS;
  assert.match(bridge.linkReport(), /stopped reporting/);
});

test("unknown wind direction is treated as a headwind on the way home", () => {
  const { native, bridge, session } = setup();
  native.hideWindDirection = true;
  native.sim.setWind({ speedMs: 5, fromDeg: 0 });
  session.start();
  runUntil(native, () => native.sim.photos.length >= 4);
  const t = bridge.telemetry();
  const toHome = ((Math.atan2(
    (HOME.lng - t.position.lng) * Math.cos((t.position.lat * Math.PI) / 180),
    HOME.lat - t.position.lat,
  ) * 180) / Math.PI + 360) % 360;
  assert.ok(Math.abs(t.wind!.fromDeg - toHome) < 0.5);
});
