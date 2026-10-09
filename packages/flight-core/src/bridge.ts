// The boundary between the planning/safety logic (here) and a real or simulated drone.
// The Android module implements this interface on top of DJI MSDK v5; SimDrone implements it for tests.
//
// Commands never block: they tell the drone what to do next and return straight away.
// FlightSession reads telemetry and events on every update and decides the next command.

import type { LatLng } from "./geo.ts";
import type { SignalLossAction, Wind } from "./safety.ts";

export type FlightMode =
  | "onGround"
  | "takingOff"
  /** Flying and following app commands (including hovering while waiting for one). */
  | "app"
  /** The pilot has taken over with the sticks; the app must not send flight commands. */
  | "pilot"
  | "returning"
  | "landing";

export type Telemetry = {
  position: LatLng;
  /** Height above the take-off point, metres. */
  altitudeM: number;
  batteryPercent: number;
  flightMode: FlightMode;
  /** The controller link to the drone is working. */
  signalOk: boolean;
  /**
   * The controller and the drone are connected again, even though the flight data is not yet
   * fresh (signalOk false). Lets the app see that the drone is on the ground after a link loss.
   */
  linkUp?: boolean;
  /** The drone's own wind estimate, if it reports one. */
  wind?: Wind;
  /** The drone's own wind warning level. */
  windWarning: "none" | "moderate" | "strong";
  /** Nearest obstacle the drone's own sensors see, sideways or above, metres (none: nothing seen or not reported). */
  obstacleM?: number;
  /** How many more photos fit on the drone's storage (none: not reported). */
  photosLeft?: number;
};

export type DroneEvent =
  | { type: "photoTaken"; waypointIndex: number; file: string }
  | { type: "photoFailed"; waypointIndex: number; reason: string };

export type FailsafeConfig = {
  home: LatLng;
  returnHeightM: number;
  signalLossAction: SignalLossAction;
};

export interface DroneBridge {
  telemetry(): Telemetry;
  /** Events since the last call (photos taken etc). */
  drainEvents(): DroneEvent[];

  /** Store the home point, return height and signal-loss action ON THE DRONE, so they work without the app. */
  configureFailsafe(config: FailsafeConfig): void;
  takeOff(): void;
  /** Fly in a straight line to a point and hover there. */
  goTo(position: LatLng, altitudeM: number, speedMs: number, headingDeg?: number): void;
  setGimbalPitch(deg: number): void;
  takePhoto(waypointIndex: number): void;
  hover(): void;
  /** Use the drone's own Return to Home: climb to return height, fly home, land. */
  returnHome(): void;
  land(): void;
}
