// Safety rules: settings, pre-flight checks and the in-flight return-home calculations.

import { bearingDeg, distanceM, distanceToPolygonM, polygonsNear, type LatLng } from "./geo.ts";
import type { Mission } from "./mission.ts";

/** UK legal maximum height above the surface. */
export const UK_MAX_ALTITUDE_M = 120;
/** DJI Mini 4 Pro rated maximum wind resistance (Level 5), rounded down. */
export const MINI_4_PRO_MAX_WIND_MS = 10.5;

export type SignalLossAction = "returnHome" | "hover" | "land";

export type SafetySettings = {
  /** Height the drone climbs to before flying home. */
  returnHeightM: number;
  /** Tallest thing near the flight area: roof, tree, aerial. */
  tallestObstacleM: number;
  /** Minimum gap between the return height and the tallest obstacle. */
  obstacleClearanceM: number;
  /** What the drone does by itself if it loses the controller signal. */
  signalLossAction: SignalLossAction;
  /** Highest gust allowed, m/s. Never above MINI_4_PRO_MAX_WIND_MS. */
  maxGustMs: number;
  /** How far outside the property boundary the drone may drift before it is brought home. */
  geofenceMarginM: number;
  /** Battery the drone must still have when it lands, percent. */
  landingReservePercent: number;
  /** Battery used per minute of flight in calm air, percent. */
  batteryDrainPercentPerMin: number;
  /** Speeds used for return-home estimates. */
  returnSpeedMs: number;
  climbSpeedMs: number;
  descentSpeedMs: number;
};

export const DEFAULT_SAFETY: SafetySettings = {
  returnHeightM: 30,
  tallestObstacleM: 8.5,
  obstacleClearanceM: 10,
  signalLossAction: "returnHome",
  maxGustMs: 8,
  geofenceMarginM: 5,
  landingReservePercent: 20,
  batteryDrainPercentPerMin: 4,
  returnSpeedMs: 8,
  climbSpeedMs: 3,
  descentSpeedMs: 2,
};

export type Wind = { speedMs: number; /** Compass direction the wind blows FROM. */ fromDeg: number };

export type WindForecast = Wind & { gustMs: number; source: string };

export type NoFlyZone = {
  name: string;
  /** restricted: never fly. authorisation: needs a DJI unlock / permission. warning: fly with care. */
  kind: "restricted" | "authorisation" | "warning";
  circle?: { center: LatLng; radiusM: number };
  polygon?: LatLng[];
};

export type CheckStatus = "pass" | "warn" | "block";
export type CheckItem = { id: string; status: CheckStatus; message: string };
export type PreflightResult = { canTakeOff: boolean; items: CheckItem[] };

export function validateSettings(s: SafetySettings): CheckItem[] {
  const items: CheckItem[] = [];
  const needed = s.tallestObstacleM + s.obstacleClearanceM;
  items.push(
    s.returnHeightM < needed
      ? block("returnHeight", `Return height ${s.returnHeightM} m is too low: it must be at least ${needed} m to clear obstacles.`)
      : s.returnHeightM > UK_MAX_ALTITUDE_M
        ? block("returnHeight", `Return height ${s.returnHeightM} m is above the UK limit of ${UK_MAX_ALTITUDE_M} m.`)
        : pass("returnHeight", `Return height ${s.returnHeightM} m clears obstacles.`),
  );
  items.push(
    s.maxGustMs > MINI_4_PRO_MAX_WIND_MS
      ? block("windLimit", `Wind limit ${s.maxGustMs} m/s is above what the drone can handle (${MINI_4_PRO_MAX_WIND_MS} m/s).`)
      : pass("windLimit", `Wind limit ${s.maxGustMs} m/s.`),
  );
  items.push(
    s.landingReservePercent < 10
      ? block("batteryReserve", `Landing reserve ${s.landingReservePercent}% is too low (minimum 10%).`)
      : pass("batteryReserve", `Lands with at least ${s.landingReservePercent}% battery.`),
  );
  return items;
}

/** Wind speed against the drone when travelling on `travelBearingDeg`. Negative means tailwind. */
export function headwindMs(wind: Wind, travelBearingDeg: number): number {
  return wind.speedMs * Math.cos(((travelBearingDeg - wind.fromDeg) * Math.PI) / 180);
}

export type ReturnEstimateInput = {
  position: LatLng;
  altitudeM: number;
  home: LatLng;
  wind: Wind;
  settings: SafetySettings;
};

/**
 * Battery percent needed to climb to return height, fly home into any headwind, descend and
 * still land with the reserve. Tailwind is ignored; a 25% margin covers estimate error.
 */
export function batteryNeededToReturn({ position, altitudeM, home, wind, settings: s }: ReturnEstimateInput): number {
  const distance = distanceM(position, home);
  const bearingHome = distance < 1 ? 0 : bearingDeg(position, home);
  const headwind = Math.max(0, headwindMs(wind, bearingHome));
  const groundSpeed = Math.max(1, s.returnSpeedMs - headwind);
  const cruiseAlt = Math.max(altitudeM, s.returnHeightM);
  const seconds =
    (cruiseAlt - altitudeM) / s.climbSpeedMs + distance / groundSpeed + cruiseAlt / s.descentSpeedMs;
  // Fighting wind costs power even while hovering.
  const drainPerS = (s.batteryDrainPercentPerMin / 60) * (1 + wind.speedMs / 10);
  return seconds * drainPerS * 1.25 + s.landingReservePercent;
}

export function insideGeofence(p: LatLng, boundary: LatLng[], marginM: number): boolean {
  return distanceToPolygonM(p, boundary) <= marginM;
}

export type PreflightInput = {
  settings: SafetySettings;
  /** Where the drone may fly: the property for a garden scan, the roof scan's flight area for a roof scan. */
  boundary: LatLng[];
  /** The owner's land, when the flight area reaches beyond it. Photos taken from outside it get a warning. */
  property?: LatLng[];
  home?: LatLng;
  mission: Mission;
  /** Latest forecast for the site; missing means it could not be fetched. */
  forecast?: WindForecast;
  noFlyZones: NoFlyZone[];
  batteryPercent: number;
};

export function preflightCheck(input: PreflightInput): PreflightResult {
  const { settings: s, boundary, home, mission, forecast } = input;
  const items: CheckItem[] = [...validateSettings(s)];

  if (!home) {
    items.push(block("home", "Set the home point on the map."));
  } else if (!insideGeofence(home, boundary, s.geofenceMarginM)) {
    items.push(block("home", "The home point is outside the property."));
  } else {
    items.push(pass("home", "Home point set."));
  }

  const outside = mission.waypoints.filter((w) => !insideGeofence(w.position, boundary, s.geofenceMarginM));
  items.push(
    outside.length > 0
      ? block("geofence", `${outside.length} waypoint(s) are outside the property plus ${s.geofenceMarginM} m.`)
      : pass("geofence", "Whole flight stays inside the allowed area."),
  );

  if (input.property) {
    const property = input.property;
    const over = mission.waypoints.filter((w) => distanceToPolygonM(w.position, property) > 0.5);
    if (over.length > 0) {
      items.push(
        warn(
          "overflight",
          `${over.length} of ${mission.waypoints.length} photos are taken from above the street or a neighbour's land. Let the neighbours know and keep clear of people.`,
        ),
      );
    }
  }

  const e = mission.estimate;
  if (e.sideOverlap !== undefined && e.lineSpacingM !== undefined && e.maxLineSpacingM !== undefined) {
    items.push(
      e.lineSpacingM > e.maxLineSpacingM + 1e-9
        ? warn(
            "passSpacing",
            `Passes are ${e.lineSpacingM.toFixed(1)} m apart: too far for the photos to overlap at this height, so the map may have gaps. Use ${Math.floor(e.maxLineSpacingM * 10) / 10} m or less, or fly higher.`,
          )
        : pass("passSpacing", `${e.passCount} passes, ${e.lineSpacingM.toFixed(1)} m apart.`),
    );
  }

  const tooHigh = mission.waypoints.filter((w) => w.altitudeM > UK_MAX_ALTITUDE_M);
  const tooLow = mission.waypoints.filter((w) => w.altitudeM < s.tallestObstacleM + 2);
  if (tooHigh.length > 0) {
    items.push(block("altitude", `Mission goes above the UK limit of ${UK_MAX_ALTITUDE_M} m.`));
  } else if (tooLow.length > 0) {
    items.push(warn("altitude", `${tooLow.length} waypoint(s) are close to obstacle height. Check the path is clear.`));
  } else {
    items.push(pass("altitude", "Mission height clears obstacles."));
  }

  if (!forecast) {
    items.push(block("wind", "No wind forecast. Connect to the internet to check the weather."));
  } else if (forecast.gustMs > s.maxGustMs) {
    items.push(block("wind", `Gusts of ${forecast.gustMs} m/s forecast; your limit is ${s.maxGustMs} m/s.`));
  } else if (forecast.gustMs > s.maxGustMs * 0.8) {
    items.push(warn("wind", `Gusts of ${forecast.gustMs} m/s are close to your limit of ${s.maxGustMs} m/s.`));
  } else {
    items.push(pass("wind", `Gusts of ${forecast.gustMs} m/s are within your limit.`));
  }

  items.push(...noFlyZoneChecks(input.noFlyZones, boundary, s.geofenceMarginM));

  const reserveFloor = s.landingReservePercent + 10;
  if (input.batteryPercent < reserveFloor) {
    items.push(block("battery", `Battery ${input.batteryPercent}% is too low to start (need ${reserveFloor}%).`));
  } else {
    const wind = forecast ?? { speedMs: 0, fromDeg: 0 };
    const missionPercent = (mission.estimate.durationS / 60) * s.batteryDrainPercentPerMin * (1 + wind.speedMs / 10);
    const last = mission.waypoints[mission.waypoints.length - 1];
    const returnPercent =
      home && last
        ? batteryNeededToReturn({ position: last.position, altitudeM: last.altitudeM, home, wind, settings: s })
        : s.landingReservePercent;
    const total = missionPercent + returnPercent;
    items.push(
      total > input.batteryPercent
        ? warn("battery", `This scan needs about ${Math.ceil(total)}% battery. The drone will come home to swap batteries and the scan will resume.`)
        : pass("battery", `Battery ${input.batteryPercent}% is enough (about ${Math.ceil(total)}% needed).`),
    );
  }

  return { canTakeOff: items.every((i) => i.status !== "block"), items };
}

function noFlyZoneChecks(zones: NoFlyZone[], boundary: LatLng[], marginM: number): CheckItem[] {
  const hits = zones.filter((z) => {
    if (z.circle) return distanceToPolygonM(z.circle.center, boundary) <= z.circle.radiusM + marginM;
    if (z.polygon) return polygonsNear(boundary, z.polygon, marginM);
    return false;
  });
  if (hits.length === 0) return [pass("noFlyZones", "No restricted airspace over the property.")];
  return hits.map((z) =>
    z.kind === "restricted"
      ? block("noFlyZones", `${z.name}: restricted airspace. Flying here is not allowed.`)
      : z.kind === "authorisation"
        ? block("noFlyZones", `${z.name}: needs permission. Unlock it in DJI Fly / FlySafe first.`)
        : warn("noFlyZones", `${z.name}: take extra care in this area.`),
  );
}

const pass = (id: string, message: string): CheckItem => ({ id, status: "pass", message });
const warn = (id: string, message: string): CheckItem => ({ id, status: "warn", message });
const block = (id: string, message: string): CheckItem => ({ id, status: "block", message });
