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
  headingDeg: number;
  productType: string | null;
  djiFlightMode: string | null;
  pilotTookOver: boolean;
};

export type NativeDroneEvent =
  | { type: "photoTaken"; waypointIndex: number; file: string }
  | { type: "photoFailed"; waypointIndex: number; reason: string };

export type NativeStatus = { kind: string; message: string };

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
  disableSimulator(): Promise<void>;
  setSimulatorWind(northMs: number, eastMs: number): void;
}
