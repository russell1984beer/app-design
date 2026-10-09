// Turns the plan into real flights: GPS positions for the plot and roof, the garden and roof
// missions, and the pre-flight checks for the chosen mode (DJI simulator or real flight).

import type { Telemetry } from "../../../packages/flight-core/src/bridge.ts";
import { gsdCm, MINI_4_PRO } from "../../../packages/flight-core/src/camera.ts";
import { fromLocal, toLocal, type LatLng } from "../../../packages/flight-core/src/geo.ts";
import type { Mission } from "../../../packages/flight-core/src/mission.ts";
import { planFirstFlight, planSurvey } from "../../../packages/flight-core/src/planner.ts";
import { planRoofScan, type RoofScan } from "../../../packages/flight-core/src/roof.ts";
import { preflightCheck, type CheckItem, type PreflightResult } from "../../../packages/flight-core/src/safety.ts";
import { eastNorthToPlan, planToEastNorth, type Pt } from "../../../packages/garden-core/src/index.ts";

import { SIM_HOME, drone } from "./drone";
import { S, commit, commitNow, type AppState } from "./store";
import { recordScan } from "./survey";
import { currentFlyZones } from "./flysafe";
import { lidarFor, lidarStatus, takeoffOffset, type TakeoffOffset } from "./lidar";
import { obstacleHeightsFor } from "./obstacles";
import { currentForecast } from "./weather";

export const SIM_TEST_COUNT = 9;

/** Is the drone really on the plan's take-off point? Judged by where the house shows up in the LIDAR. */
export function takeoffMismatch(s: AppState, anchor: LatLng | null): TakeoffOffset | null {
  if (s.mode !== "real" || !anchor) return null;
  const site = lidarFor(anchor);
  if (!site) return null;
  const key = `${anchor.lat.toFixed(6)},${anchor.lng.toFixed(6)},${s.home.join(",")}`;
  return takeoffOffset(site, s.plot, (p) => planToGps(s, anchor, p), key);
}

/** Plain words for which way the drone is off the marked take-off point. */
export function offsetWords(alongM: number): string {
  return `${Math.abs(alongM).toFixed(0)} m ${alongM > 0 ? "nearer the house" : "nearer the bottom of the garden"}`;
}

/** Beyond these, the drone is not where the plan thinks: warn, then block (all routes would be shifted). */
export const OFFSET_WARN_M = 2.5;
export const OFFSET_BLOCK_M = 5;

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

/** The bottom of the garden (the far end of the plot) up to the take-off point, full width. */
export function firstFlightArea(s: AppState): Pt[] {
  const W = s.plot.widthM;
  const y = s.home[1];
  return [[0, 0], [W, 0], [W, y], [0, y]];
}

export function firstFlightMission(s: AppState, anchor: LatLng): Mission {
  return planFirstFlight(anchor, firstFlightArea(s).map((p) => planToGps(s, anchor, p)));
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

export type FlightKind = "survey" | "roof" | "check";

export type FlightPlan = { kind: FlightKind; mission: Mission; boundary: LatLng[]; property?: LatLng[]; anchor: LatLng; check: PreflightResult };

export function prepareFlight(kind: FlightKind, s: AppState, t: Telemetry | null, resume = false): FlightPlan | { error: string } {
  // Resuming uses the home point's position from the first flight, so the plan is exactly the same.
  const saved = kind === "check" ? undefined : s.resume[kind];
  const anchor = resume && saved ? saved.anchor : anchorFor(s, t);
  if (!anchor) return { error: "No GPS position from the drone yet. Put the drone on the take-off point, switch it on and wait for GPS." };
  let mission: Mission;
  let boundary: LatLng[];
  let property: LatLng[] | undefined;
  if (kind === "survey") {
    mission = surveyMission(s, anchor);
    boundary = plotGps(s, anchor);
  } else if (kind === "check") {
    if (s.home[1] < 3) return { error: "The take-off point is too close to the bottom of the garden for this check. Move it on the Plan map." };
    mission = firstFlightMission(s, anchor);
    boundary = plotGps(s, anchor);
  } else {
    const r = roofScan(s, anchor);
    mission = r.mission;
    boundary = r.flightArea;
    property = plotGps(s, anchor);
  }
  // The simulator has no weather. Real flights use the Met Office forecast for the take-off point.
  const weather = s.mode === "real" ? currentForecast(anchor) : null;
  // DJI's no-fly zones round the take-off point (the simulator's made-up field has none to check).
  const flyZones = s.mode === "real" ? currentFlyZones(anchor) : null;
  // Tree and roof heights from the Environment Agency's LIDAR (real flights only: the simulator's
  // field is made up).
  const lidar = s.mode === "real" ? lidarFor(anchor) : null;
  const obstacles = s.mode === "real" ? obstacleHeightsFor(s, anchor, mission, boundary) : null;
  const forecast = s.mode === "sim" ? { speedMs: 0, gustMs: 0, fromDeg: 0, source: "DJI simulator" } : weather && "forecast" in weather ? weather.forecast : undefined;
  const check = preflightCheck({
    settings: s.safety,
    boundary,
    property,
    home: anchor,
    mission,
    forecast,
    noFlyZones: flyZones && "zones" in flyZones ? flyZones.zones : [],
    batteryPercent: t?.batteryPercent ?? 0,
    obstacles: obstacles ?? undefined,
  });
  const extra: CheckItem[] = [];
  if (!t?.signalOk) extra.push({ id: "link", status: "block", message: "Drone not connected. Plug the phone into the RC-N2 and switch the drone on." });
  if (s.mode === "real") {
    if (s.testsPassed.length < SIM_TEST_COUNT) {
      extra.push({ id: "simTests", status: "block", message: `Run all ${SIM_TEST_COUNT} simulator tests first (${s.testsPassed.length} passed so far).` });
    }
    if (weather && "error" in weather) extra.push({ id: "forecast", status: "block", message: weather.error });
    if (!flyZones) extra.push({ id: "flySafe", status: "block", message: "Checking DJI's no-fly zones for this place…" });
    else if ("error" in flyZones)
      // The drone itself still refuses to take off in DJI's restricted zones.
      extra.push({ id: "flySafe", status: "warn", message: `Could not check DJI's no-fly zones (${flyZones.error}). Check DJI Fly before you fly.` });
    const off = takeoffMismatch(s, anchor);
    if (off && Math.abs(off.alongM) >= OFFSET_BLOCK_M)
      extra.push({
        id: "takeoffPoint",
        status: "block",
        message: `The drone seems to be about ${offsetWords(off.alongM)} than the take-off point on the plan (the house shows up shifted in the LIDAR). The whole flight would be shifted too. Carry the drone to the take-off point, or move the take-off point (button above).`,
      });
    else if (off && Math.abs(off.alongM) >= OFFSET_WARN_M)
      extra.push({
        id: "takeoffPoint",
        status: "warn",
        message: `The drone may be about ${offsetWords(off.alongM)} than the take-off point on the plan. Check it is standing on the marked spot.`,
      });
    if (obstacles?.source === "LIDAR" && s.goneSpots.length)
      extra.push({
        id: "goneSpots",
        status: "warn",
        message: `The clearance check ignores ${s.goneSpots.length === 1 ? "a tall spot" : `${s.goneSpots.length} tall spots`} in the LIDAR that you marked as gone (Survey tab, Heights). Make sure nothing has grown back there.`,
      });
    if (!obstacles) {
      // Heights are an extra check: without them the flight is not blocked, but the pilot is told.
      const st = lidarStatus(anchor);
      const why = lidar ? "the LIDAR has no tree and roof heights here" : st.loading ? "still fetching the LIDAR" : st.error ? `no LIDAR (${st.error})` : "no LIDAR yet";
      extra.push({ id: "heights", status: "warn", message: `Tree and roof heights not checked (${why}). Check the route is clear with your own eyes.` });
    }
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
  const kind = plan.kind;
  const saved = resume && kind !== "check" ? S.resume[kind] : undefined;
  const progress = saved && saved.progress.missionId === plan.mission.id ? saved.progress : undefined;
  if (!resume && kind !== "check") delete S.resume[kind];
  drone.startJob(plan.kind, plan.anchor, {
    mission: plan.mission,
    boundary: plan.boundary,
    settings: S.safety,
    progress,
    onProgress: (p) => {
      if (kind === "check") return; // a first flight check is short: it is simply flown again
      S.resume[kind] = { anchor: plan.anchor, progress: p };
      if (plan.kind === "roof") S.roof.photosTaken = p.completedWaypoints.length;
      if (p.completedWaypoints.length >= plan.mission.waypoints.length) {
        delete S.resume[kind];
        if (kind === "survey" && S.mode === "real") recordScan(plan.anchor, plan.mission.waypoints.length);
      }
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
