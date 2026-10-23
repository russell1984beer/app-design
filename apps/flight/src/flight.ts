// Turns the plan into real flights: GPS positions for the plot and roof, the garden and roof
// missions, and the pre-flight checks for the chosen mode (DJI simulator or real flight).

import type { Telemetry } from "../../../packages/flight-core/src/bridge.ts";
import { gsdCm, MINI_4_PRO } from "../../../packages/flight-core/src/camera.ts";
import { fromLocal, toLocal, type LatLng } from "../../../packages/flight-core/src/geo.ts";
import type { Mission } from "../../../packages/flight-core/src/mission.ts";
import { planFirstFlight, planSurvey, surveyPhotoChoice, withFilm } from "../../../packages/flight-core/src/planner.ts";
import { planRoofScan, type RoofScan } from "../../../packages/flight-core/src/roof.ts";
import { preflightCheck, type CheckItem, type PreflightResult } from "../../../packages/flight-core/src/safety.ts";
import { clipToY, eastNorthToPlan, planToEastNorth, plotOutline, pointInside, spanAtX, sunElevationAt, type Pt } from "../../../packages/garden-core/src/index.ts";

import { SIM_HOME, drone } from "./drone";
import { planPointFromCorner, takeoffSpotCheck } from "./placement";
import { S, commit, commitNow, currentProject, type AppState } from "./store";
import { recordScan } from "./survey";
import { currentFlyZones } from "./flysafe";
import { lidarFor, lidarStatus, takeoffOffset, type TakeoffOffset } from "./lidar";
import { obstacleHeightsFor } from "./obstacles";
import { currentForecast } from "./weather";

export const SIM_TEST_COUNT = 10;

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
const OFFSET_BLOCK_M = 5;

/** A plan point as a GPS position, given the GPS position of the home point. */
export function planToGps(s: AppState, anchor: LatLng, p: Pt): LatLng {
  const en = planToEastNorth(s.plot, s.home, p);
  return fromLocal(anchor, { x: en.east, y: en.north });
}

export function gpsToPlan(s: AppState, anchor: LatLng, p: LatLng): Pt {
  const v = toLocal(anchor, p);
  return eastNorthToPlan(s.plot, s.home, { east: v.x, north: v.y });
}

/** The plot's boundary in GPS: the traced outline when there is one, otherwise the rectangle. Flights and the geofence use it. */
function plotGps(s: AppState, anchor: LatLng): LatLng[] {
  return plotOutline(s.plot).map((p) => planToGps(s, anchor, p));
}

/** The owner's half of the roof, seen from above. */
function roofPlan(s: AppState): Pt[] {
  const { houseWidthM: HW, rearGardenM: GH, houseDepthM: HD } = s.plot;
  return [[0, GH], [HW, GH], [HW, GH + HD], [0, GH + HD]];
}

/**
 * Recent plans by their inputs. The Scan tab redraws on every telemetry update (10 a second) and asks
 * for the survey several times per redraw; planning it afresh each time was wasted work.
 */
const plans = new Map<string, unknown>();
function remembered<T>(key: string, make: () => T): T {
  if (!plans.has(key)) {
    if (plans.size >= 8) plans.clear();
    plans.set(key, make());
  }
  return plans.get(key) as T;
}

/** How many photos per run the owner can choose, and the recommended number, at the current settings. */
export function photoChoice(s: AppState) {
  return remembered(`choice ${JSON.stringify([s.plot, s.home, s.alt, s.ov])}`, () =>
    surveyPhotoChoice(plotGps(s, SIM_HOME), { altitudeM: s.alt, overlap: s.ov / 100 }),
  );
}

/** The owner's photos per run, kept within what makes sense at the current height (it changes the limits). */
export function photosPerRun(s: AppState): number {
  const c = photoChoice(s);
  return s.photosPerRun === null ? c.recommended : Math.min(c.max, Math.max(c.min, s.photosPerRun));
}

export function surveyMission(s: AppState, anchor: LatLng): Mission {
  const key = JSON.stringify([s.plot, s.home, s.alt, s.ov, s.edgeLap, s.film, s.photosPerRun, s.photoIntervalS, anchor]);
  return remembered(`survey ${key}`, () => {
    const scan = planSurvey(plotGps(s, anchor), {
      altitudeM: s.alt,
      overlap: s.ov / 100,
      edgeLap: s.edgeLap,
      photosPerRun: s.photosPerRun === null ? undefined : photosPerRun(s),
      photoIntervalS: s.photoIntervalS,
    });
    const film = s.film ? filmLine(s.plot) : null;
    return film ? withFilm(scan, planToGps(s, anchor, film[0]), planToGps(s, anchor, film[1])) : scan;
  });
}

/**
 * The fly-over film's line on the plan, inside the plot: down the middle of the garden from the far end
 * to just short of the house; on a traced boundary, the length of it through its middle. Null when
 * there is no room for one.
 */
function filmLine(p: AppState["plot"]): [Pt, Pt] | null {
  if (!p.boundary) return [[p.widthM / 2, 2], [p.widthM / 2, Math.max(4, p.rearGardenM - 3)]];
  const x = pointInside(p.boundary)[0];
  const span = spanAtX(p.boundary, x);
  if (!span || span[1] - span[0] < 10) return null;
  return [[x, span[0] + 2], [x, span[1] - 3]];
}

/** Below this the sun is too low for sharp photos (the first real scan, at sunset, needed 1/15 s). */
const SUN_BLOCK_DEG = 8;
/** Below this, warn: the camera may slow its shutter and blur. */
const SUN_WARN_DEG = 20;

/** The bottom of the garden (the far end of the plot) up to the take-off point, full width (inside a traced boundary). */
function firstFlightArea(s: AppState): Pt[] {
  const W = s.plot.widthM;
  const y = s.home[1];
  const clipped = s.plot.boundary ? clipToY(s.plot.boundary, y) : [];
  return clipped.length ? clipped : [[0, 0], [W, 0], [W, y], [0, y]];
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

/** The far-left corner of the plot as marked on the title plan (Projects tab), if it has been. */
const markedCorner = (): LatLng | null => currentProject().corners?.[0] ?? null;

/**
 * Where the plan's take-off point is in GPS terms, which places the whole plan: the simulator's field;
 * on a real flight, from the plot lined up on the title plan when there is one, otherwise the drone
 * sitting on it. Needs the drone connected either way.
 */
export function anchorFor(s: AppState, t: Telemetry | null): LatLng | null {
  if (s.mode === "sim") return SIM_HOME;
  if (!t?.signalOk) return null;
  const corner = markedCorner();
  return corner ? planPointFromCorner(s.plot, corner, s.home) : t.position;
}

type FlightKind = "survey" | "roof" | "check";

export type FlightPlan = {
  kind: FlightKind;
  mission: Mission;
  boundary: LatLng[];
  property?: LatLng[];
  /** Places the plan (see anchorFor). */
  anchor: LatLng;
  /** Where the drone actually stands: it takes off here and its Return to Home lands it here. */
  home: LatLng;
  check: PreflightResult;
};

export function prepareFlight(kind: FlightKind, s: AppState, t: Telemetry | null, resume = false): FlightPlan | { error: string } {
  // Resuming uses the home point's position from the first flight, so the plan is exactly the same.
  const saved = kind === "check" ? undefined : s.resume[kind];
  const anchor = resume && saved ? saved.anchor : anchorFor(s, t);
  if (!anchor) return { error: "No GPS position from the drone yet. Put the drone on the take-off point, switch it on and wait for GPS." };
  // With no title plan line-up the two are the same point.
  const home = s.mode === "sim" || !t?.signalOk ? anchor : t.position;
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
    home,
    mission,
    forecast,
    noFlyZones: flyZones && "zones" in flyZones ? flyZones.zones : [],
    batteryPercent: t?.batteryPercent ?? 0,
    obstacles: obstacles ?? undefined,
    photosLeft: t?.photosLeft,
    // Resuming takes only the photos still missing.
    photosNeeded: mission.waypoints.length - (resume && saved?.progress.missionId === mission.id ? saved.progress.completedWaypoints.length : 0),
  });
  const extra: CheckItem[] = [];
  // Say what is actually missing: a drone that is connected but has no GPS fix is not "not connected".
  // In the simulator the drone only gets a position once the simulator runs, and launch() starts it,
  // so there the controller and drone being linked is enough.
  const linked = s.mode === "sim" ? !!t?.linkUp || !!t?.signalOk : !!t?.signalOk;
  if (!linked) extra.push({ id: "link", status: "block", message: drone.bridge.linkReport() });
  if (s.mode === "real") {
    if (s.testsPassed.length < SIM_TEST_COUNT) {
      extra.push({ id: "simTests", status: "block", message: `Run all ${SIM_TEST_COUNT} simulator tests first (${s.testsPassed.length} passed so far).` });
    }
    if (weather && "error" in weather) extra.push({ id: "forecast", status: "block", message: weather.error });
    const sun = sunElevationAt(anchor.lat, anchor.lng, new Date());
    if (sun < SUN_BLOCK_DEG)
      extra.push({ id: "light", status: "block", message: "Too dark for sharp photos: the sun is too low. Fly when it is higher (late morning to mid afternoon is best)." });
    else if (sun < SUN_WARN_DEG)
      extra.push({ id: "light", status: "warn", message: `The sun is low (${Math.round(sun)}° up), so some photos may blur. Late morning to mid afternoon gives sharper photos.` });
    if (!flyZones) extra.push({ id: "flySafe", status: "block", message: "Checking DJI's no-fly zones for this place…" });
    else if ("error" in flyZones)
      // The drone itself still refuses to take off in DJI's restricted zones.
      extra.push({ id: "flySafe", status: "warn", message: `Could not check DJI's no-fly zones (${flyZones.error}). Check DJI Fly before you fly.` });
    // Placed from the title plan: the drone must be standing on the take-off point it puts on the map.
    if (markedCorner() && t?.signalOk) extra.push(takeoffSpotCheck(t.position, anchor));
    // The house in the LIDAR against the plan: checks the drone's spot, or the title plan's line-up.
    const off = takeoffMismatch(s, anchor);
    const lineUp = !!markedCorner();
    if (off && Math.abs(off.alongM) >= OFFSET_BLOCK_M)
      extra.push({
        id: "takeoffPoint",
        status: "block",
        message: lineUp
          ? `The plot as lined up on the title plan seems to be about ${Math.abs(off.alongM).toFixed(0)} m off the house in the LIDAR. The whole flight would be shifted. Check the line-up on the Projects tab.`
          : `The drone seems to be about ${offsetWords(off.alongM)} than the take-off point on the plan (the house shows up shifted in the LIDAR). The whole flight would be shifted too. Carry the drone to the take-off point, or move the take-off point (button above).`,
      });
    else if (off && Math.abs(off.alongM) >= OFFSET_WARN_M)
      extra.push({
        id: "takeoffPoint",
        status: "warn",
        message: lineUp
          ? `The plot as lined up on the title plan may be about ${Math.abs(off.alongM).toFixed(0)} m off the house in the LIDAR. Check the line-up on the Projects tab.`
          : `The drone may be about ${offsetWords(off.alongM)} than the take-off point on the plan. Check it is standing on the marked spot.`,
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
  return { kind, mission, boundary, property, anchor, home, check: { canTakeOff: items.every((i) => i.status !== "block"), items } };
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

const SIM_POSITION_WAIT_MS = 20_000;

/** Take off and fly the plan. Saves progress after every photo so the scan can resume. */
export async function launch(plan: FlightPlan, resume: boolean): Promise<void> {
  if (S.mode === "sim") {
    if (!drone.simOn) await drone.setSimulator(true);
    // The simulator gives the drone its pretend GPS position a moment after it starts.
    if (!(await drone.positionReady(SIM_POSITION_WAIT_MS))) throw new Error("The simulator is on but the drone has no position yet. Wait a few seconds and tap Start again.");
  }
  const kind = plan.kind;
  const saved = resume && kind !== "check" ? S.resume[kind] : undefined;
  const progress = saved && saved.progress.missionId === plan.mission.id ? saved.progress : undefined;
  if (!resume && kind !== "check") delete S.resume[kind];
  const flownAt = new Date().toISOString();
  const photoIndices = new Set(plan.mission.waypoints.filter((w) => w.photo).map((w) => w.index));
  drone.startJob(plan.kind, plan.anchor, plan.home, {
    mission: plan.mission,
    boundary: plan.boundary,
    settings: S.safety,
    progress,
    onProgress: (p) => {
      // Real garden photos can be made into a survey, even from a scan that stopped part-way.
      if (S.mode === "real" && kind !== "roof") recordScan(plan.anchor, p.completedWaypoints.filter((i) => photoIndices.has(i)).length, flownAt);
      if (kind === "check") return commitNow(); // a first flight check is short: it is simply flown again
      S.resume[kind] = { anchor: plan.anchor, progress: p };
      if (plan.kind === "roof") S.roof.photosTaken = p.completedWaypoints.length;
      if (p.completedWaypoints.length >= plan.mission.waypoints.length) {
        delete S.resume[kind];
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
