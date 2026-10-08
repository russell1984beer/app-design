// Turns the plan into real flights: GPS positions for the plot and roof, the garden and roof
// missions, and the pre-flight checks for the chosen mode (DJI simulator or real flight).

import type { Telemetry } from "../../../packages/flight-core/src/bridge.ts";
import { gsdCm, MINI_4_PRO } from "../../../packages/flight-core/src/camera.ts";
import { fromLocal, toLocal, type LatLng } from "../../../packages/flight-core/src/geo.ts";
import type { Mission } from "../../../packages/flight-core/src/mission.ts";
import { planSurvey } from "../../../packages/flight-core/src/planner.ts";
import { planRoofScan, type RoofScan } from "../../../packages/flight-core/src/roof.ts";
import { preflightCheck, type CheckItem, type PreflightResult } from "../../../packages/flight-core/src/safety.ts";
import { eastNorthToPlan, planToEastNorth, type Pt } from "../../../packages/garden-core/src/index.ts";

import { SIM_HOME, drone } from "./drone";
import { S, commit, commitNow, type AppState } from "./store";
import { currentForecast } from "./weather";

export const SIM_TEST_COUNT = 9;

/** A plan point as a GPS position, given the GPS position of the home point. */
export function planToGps(s: AppState, anchor: LatLng, p: Pt): LatLng {
  const en = planToEastNorth(s.plot, s.home, p);
  return fromLocal(anchor, { x: en.east, y: en.north });
}

export function gpsToPlan(s: AppState, anchor: LatLng, p: LatLng): Pt {
  const v = toLocal(anchor, p);
  return eastNorthToPlan(s.plot, s.home, { east: v.x, north: v.y });
}

export function plotGps(s: AppState, anchor: LatLng): LatLng[] {
  const { widthM: W, lengthM: H } = s.plot;
  return ([[0, 0], [W, 0], [W, H], [0, H]] as Pt[]).map((p) => planToGps(s, anchor, p));
}

/** The owner's half of the roof, seen from above. */
export function roofPlan(s: AppState): Pt[] {
  const { houseWidthM: HW, rearGardenM: GH, houseDepthM: HD } = s.plot;
  return [[0, GH], [HW, GH], [HW, GH + HD], [0, GH + HD]];
}

export function surveyMission(s: AppState, anchor: LatLng): Mission {
  return planSurvey(plotGps(s, anchor), { altitudeM: s.alt, overlap: s.ov / 100, edgeLap: s.edgeLap });
}

export function roofScan(s: AppState, anchor: LatLng): RoofScan {
  return planRoofScan({
    roof: roofPlan(s).map((p) => planToGps(s, anchor, p)),
    ridgeHeightM: s.plot.ridgeHeightM,
    home: anchor,
    // The open side of the house is on the right of the plan.
    openSideBearingDeg: (s.plot.gardenBearingDeg + 90) % 360,
  });
}

/** Mission waypoints on the plan, for drawing the route. */
export function missionOnPlan(s: AppState, mission: Mission, anchor: LatLng): Pt[] {
  return mission.waypoints.map((w) => gpsToPlan(s, anchor, w.position));
}

/** Plan-only numbers for the stats boxes; the same wherever the plot is. */
export function surveyStats(s: AppState) {
  const m = surveyMission(s, SIM_HOME);
  return {
    mission: m,
    photos: m.estimate.photoCount,
    passes: m.estimate.passCount ?? 0,
    // Plus about a minute to take off, climb and come home.
    minutes: m.estimate.durationS / 60 + 1,
    gsdCm: gsdCm(MINI_4_PRO, s.alt),
    // Rough: GPS-only positioning with the Mini 4 Pro; RTK needs the Matrice 4E.
    accuracyCm: 3 + s.alt / 15,
  };
}

/** Where the home point is in GPS terms: the simulator's field, or the drone sitting on it. */
export function anchorFor(s: AppState, t: Telemetry | null): LatLng | null {
  if (s.mode === "sim") return SIM_HOME;
  return t?.signalOk ? t.position : null;
}

export type FlightPlan = { kind: "survey" | "roof"; mission: Mission; boundary: LatLng[]; property?: LatLng[]; anchor: LatLng; check: PreflightResult };

export function prepareFlight(kind: "survey" | "roof", s: AppState, t: Telemetry | null, resume = false): FlightPlan | { error: string } {
  // Resuming uses the home point's position from the first flight, so the plan is exactly the same.
  const anchor = resume && s.resume[kind] ? s.resume[kind].anchor : anchorFor(s, t);
  if (!anchor) return { error: "No GPS position from the drone yet. Put the drone on the take-off point, switch it on and wait for GPS." };
  let mission: Mission;
  let boundary: LatLng[];
  let property: LatLng[] | undefined;
  if (kind === "survey") {
    mission = surveyMission(s, anchor);
    boundary = plotGps(s, anchor);
  } else {
    const r = roofScan(s, anchor);
    mission = r.mission;
    boundary = r.flightArea;
    property = plotGps(s, anchor);
  }
  // The simulator has no weather. Real flights use the Met Office forecast for the take-off point.
  const weather = s.mode === "real" ? currentForecast(anchor) : null;
  const forecast = s.mode === "sim" ? { speedMs: 0, gustMs: 0, fromDeg: 0, source: "DJI simulator" } : weather && "forecast" in weather ? weather.forecast : undefined;
  const check = preflightCheck({
    settings: s.safety,
    boundary,
    property,
    home: anchor,
    mission,
    forecast,
    noFlyZones: [],
    batteryPercent: t?.batteryPercent ?? 0,
  });
  const extra: CheckItem[] = [];
  if (!t?.signalOk) extra.push({ id: "link", status: "block", message: "Drone not connected. Plug the phone into the RC-N2 and switch the drone on." });
  if (s.mode === "real") {
    if (s.testsPassed.length < SIM_TEST_COUNT) {
      extra.push({ id: "simTests", status: "block", message: `Run all ${SIM_TEST_COUNT} simulator tests first (${s.testsPassed.length} passed so far).` });
    }
    if (weather && "error" in weather) extra.push({ id: "forecast", status: "block", message: weather.error });
    extra.push({ id: "noFlyZones", status: "warn", message: "DJI FlySafe zones are not checked by the app yet. Check DJI Fly before you fly." });
  }
  if (!s.checks.every(Boolean)) extra.push({ id: "checklist", status: "block", message: "Tick every item in Before you fly (Plan tab)." });
  const items = [...extra, ...check.items];
  return { kind, mission, boundary, property, anchor, check: { canTakeOff: items.every((i) => i.status !== "block"), items } };
}

/** A scan of this kind that stopped part-way and still matches the current settings. */
export function resumable(kind: "survey" | "roof", s: AppState = S): { done: number; total: number } | null {
  const r = s.resume[kind];
  if (!r || (s.mode === "sim") !== (r.anchor.lat === SIM_HOME.lat && r.anchor.lng === SIM_HOME.lng)) return null;
  const mission = kind === "survey" ? surveyMission(s, r.anchor) : roofScan(s, r.anchor).mission;
  if (mission.id !== r.progress.missionId) return null;
  const done = r.progress.completedWaypoints.length;
  return done > 0 && done < mission.waypoints.length ? { done, total: mission.waypoints.length } : null;
}

/** Take off and fly the plan. Saves progress after every photo so the scan can resume. */
export async function launch(plan: FlightPlan, resume: boolean): Promise<void> {
  if (S.mode === "sim" && !drone.simOn) await drone.setSimulator(true);
  const saved = resume ? S.resume[plan.kind] : undefined;
  const progress = saved && saved.progress.missionId === plan.mission.id ? saved.progress : undefined;
  if (!resume) delete S.resume[plan.kind];
  drone.startJob(plan.kind, plan.anchor, {
    mission: plan.mission,
    boundary: plan.boundary,
    settings: S.safety,
    progress,
    onProgress: (p) => {
      S.resume[plan.kind] = { anchor: plan.anchor, progress: p };
      if (plan.kind === "roof") S.roof.photosTaken = p.completedWaypoints.length;
      if (p.completedWaypoints.length >= plan.mission.waypoints.length) delete S.resume[plan.kind];
      commitNow();
    },
  });
  commit();
}

export const RETURN_REASON: Record<string, string> = {
  complete: "Scan complete.",
  lowBattery: "Came home to swap the battery.",
  wind: "Came home because the wind got too strong.",
  geofence: "Came home because it drifted outside the allowed area.",
  pilotButton: "You pressed Return home.",
  droneInitiated: "The drone returned by itself (Return to Home on the controller, or its own failsafe).",
  signalLoss: "The signal was lost, so the drone came home.",
  cameraFault: "The camera stopped taking photos, so the drone came home.",
  pilotLanded: "You told it to land where it was.",
};

export const STATE_TEXT: Record<string, string> = {
  ready: "Ready",
  takingOff: "Taking off",
  climbing: "Climbing to scan height",
  scanning: "Scanning",
  returning: "Returning home",
  holding: "Stopped. Hovering in place, waiting for you.",
  landing: "Landing where it is",
  pilotControl: "Pilot has control. The app has stopped sending commands.",
  signalLost: "Signal lost. The drone is following its own failsafe.",
  landed: "Landed",
};
