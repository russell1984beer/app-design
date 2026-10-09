// The shape of the native DjiDrone module (Kotlin: DjiDroneModule.kt / DroneController.kt).

import type { FlightMode } from "../../../../../packages/flight-core/src/bridge.ts";
import type { SignalLossAction } from "../../../../../packages/flight-core/src/safety.ts";

export type NativeTelemetry = {
  lat: number | null;
  lng: number | null;
  altitudeM: number;
  batteryPercent: number | null;
  flightMode: FlightMode;
  signalOk: boolean;
  windSpeedMs: number | null;
  windFromDeg: number | null;
  windWarning: "none" | "moderate" | "strong";
  /** Nearest thing the drone's sensors see sideways or above, metres; null when nothing is close (missing from older builds). */
  obstacleM?: number | null;
  /** Photos that still fit on the drone's storage; null when not reported (missing from older builds). */
  photosLeft?: number | null;
  headingDeg: number;
  productType: string | null;
  djiFlightMode: string | null;
  pilotTookOver: boolean;
  /** Connection details, for the test bench's readout (missing from older builds). */
  rcConnected?: boolean;
  aircraftConnected?: boolean;
  sdkListening?: boolean;
};

export type NativeDroneEvent =
  | { type: "photoTaken"; waypointIndex: number; file: string }
  | { type: "photoFailed"; waypointIndex: number; reason: string };

export type NativeStatus = { kind: string; message: string };

type NativeCircle = { lat: number; lng: number; radiusM: number };

/** One DJI FlySafe zone, as the Android module reports it (FlyZones.kt). */
export type NativeFlyZone = {
  id: number;
  name: string | null;
  /** RESTRICTED, AUTHORIZATION, WARNING, ENHANCED_WARNING, ... */
  category: string | null;
  /** AIRPORT, MILITARY, PRISON, ... */
  type: string | null;
  lowerM: number;
  upperM: number;
  circle: NativeCircle | null;
  /** Parts of a polygon zone, each with its own height limit (0 = no flying at all). */
  areas: { points: [number, number][]; circle: NativeCircle | null; limitM: number }[];
};

export type Subscription = { remove(): void };

export interface DjiDroneNative {
  addListener(event: "onTelemetry", listener: (t: NativeTelemetry) => void): Subscription;
  addListener(event: "onDroneEvent", listener: (e: NativeDroneEvent) => void): Subscription;
  addListener(event: "onStatus", listener: (s: NativeStatus) => void): Subscription;

  getStatus(): { registered: boolean; productConnected: boolean; lastKind: string | null; lastMessage: string | null };

  configureFailsafe(homeLat: number, homeLng: number, returnHeightM: number, action: SignalLossAction): void;
  takeOff(): void;
  goTo(lat: number, lng: number, altitudeM: number, speedMs: number, headingDeg: number | null): void;
  setGimbalPitch(deg: number): void;
  takePhoto(waypointIndex: number): void;
  hover(): void;
  returnHome(): void;
  land(): void;

  enableSimulator(lat: number, lng: number): Promise<void>;
  /** DJI FlySafe (GEO) zones round a position, from the DJI SDK's database. */
  getFlyZones(lat: number, lng: number): Promise<NativeFlyZone[]>;
  disableSimulator(): Promise<void>;
  /** Erase every photo on the drone's storage (on the ground, motors off). */
  formatStorage(): Promise<void>;
  setSimulatorWind(northMs: number, eastMs: number): void;
}
