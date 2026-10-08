// flight-core's DroneBridge on top of the native DJI module. FlightSession talks to this exactly
// as it talks to SimDrone in the tests.

import type { DroneBridge, DroneEvent, FailsafeConfig, Telemetry } from "../../../../../packages/flight-core/src/bridge.ts";
import type { LatLng } from "../../../../../packages/flight-core/src/geo.ts";
import type { DjiDroneNative, NativeStatus, NativeTelemetry, Subscription } from "./DjiDrone.types.ts";

/** Telemetry older than this means the link is gone, whatever the last message said. */
export const STALE_AFTER_MS = 2000;

export type NativeDroneBridgeOptions = {
  now?: () => number;
  onStatus?: (status: NativeStatus) => void;
  /** Called on every telemetry update, after it is stored. Drive FlightSession.update() from here. */
  onTelemetry?: (t: Telemetry) => void;
};

export class NativeDroneBridge implements DroneBridge {
  private readonly native: DjiDroneNative;
  private readonly now: () => number;
  private readonly opts: NativeDroneBridgeOptions;
  private latest?: { t: NativeTelemetry; at: number };
  private lastPosition?: LatLng;
  private home?: LatLng;
  private events: DroneEvent[] = [];
  private subs: Subscription[] = [];

  constructor(native: DjiDroneNative, opts: NativeDroneBridgeOptions = {}) {
    this.native = native;
    this.opts = opts;
    this.now = opts.now ?? (() => Date.now());
  }

  start(): void {
    if (this.subs.length > 0) return;
    this.subs.push(
      this.native.addListener("onTelemetry", (t) => {
        this.latest = { t, at: this.now() };
        if (t.lat != null && t.lng != null) this.lastPosition = { lat: t.lat, lng: t.lng };
        this.opts.onTelemetry?.(this.telemetry());
      }),
      this.native.addListener("onDroneEvent", (e) => {
        this.events.push(e);
      }),
      this.native.addListener("onStatus", (s) => this.opts.onStatus?.(s)),
    );
  }

  stop(): void {
    for (const s of this.subs) s.remove();
    this.subs = [];
  }

  telemetry(): Telemetry {
    const latest = this.latest;
    const fresh = latest !== undefined && this.now() - latest.at < STALE_AFTER_MS;
    const t = latest?.t;
    const position = this.lastPosition ?? this.home ?? { lat: 0, lng: 0 };
    return {
      position,
      altitudeM: t?.altitudeM ?? 0,
      // Unknown battery is reported as empty, so nothing relies on a number it does not have.
      batteryPercent: t?.batteryPercent ?? 0,
      flightMode: t?.flightMode ?? "onGround",
      // No position yet (no GPS) counts as no link: the app must not fly blind.
      signalOk: fresh && t!.signalOk && t!.lat != null,
      wind: t?.windSpeedMs != null ? { speedMs: t.windSpeedMs, fromDeg: this.windFrom(t, position) } : undefined,
      windWarning: t?.windWarning ?? "none",
    };
  }

  /** What is and is not connected, in plain English, for the test bench. */
  linkReport(): string {
    const latest = this.latest;
    if (!latest) return "Nothing heard from the drone module yet.";
    if (this.now() - latest.at >= STALE_AFTER_MS) return "The drone module has stopped reporting.";
    const t = latest.t;
    if (t.sdkListening === false) return "Waiting for the DJI SDK to start.";
    if (t.rcConnected === false) return "Controller not connected. Is it switched on, with the phone plugged into it and Plotwise chosen at the USB prompt?";
    if (t.aircraftConnected === false) return "Controller connected, but not the drone. Switch the drone on and wait for the controller to link to it.";
    if (t.lat == null) return "Drone connected, but it has no GPS position. Indoors, tap Start simulator to give it one.";
    if (!t.signalOk) return "Drone connected, waiting for a steady signal.";
    return "Drone and controller connected.";
  }

  drainEvents(): DroneEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  configureFailsafe(config: FailsafeConfig): void {
    this.home = config.home;
    this.native.configureFailsafe(config.home.lat, config.home.lng, Math.ceil(config.returnHeightM), config.signalLossAction);
  }

  takeOff(): void {
    this.native.takeOff();
  }

  goTo(position: LatLng, altitudeM: number, speedMs: number, headingDeg?: number): void {
    this.native.goTo(position.lat, position.lng, altitudeM, speedMs, headingDeg ?? null);
  }

  setGimbalPitch(deg: number): void {
    this.native.setGimbalPitch(deg);
  }

  takePhoto(waypointIndex: number): void {
    this.native.takePhoto(waypointIndex);
  }

  hover(): void {
    this.native.hover();
  }

  returnHome(): void {
    this.native.returnHome();
  }

  land(): void {
    this.native.land();
  }

  /**
   * Direction the wind blows from. When the drone does not say, assume the worst: wind blowing
   * from home, i.e. straight into the drone's face on the way back.
   */
  private windFrom(t: NativeTelemetry, position: LatLng): number {
    if (t.windFromDeg != null) return t.windFromDeg;
    if (!this.home) return 0;
    const dLat = this.home.lat - position.lat;
    const dLng = (this.home.lng - position.lng) * Math.cos((position.lat * Math.PI) / 180);
    return ((Math.atan2(dLng, dLat) * 180) / Math.PI + 360) % 360;
  }
}
