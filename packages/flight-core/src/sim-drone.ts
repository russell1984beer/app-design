// A simulated drone that behaves like a DJI drone for the parts the app depends on:
// take-off, straight-line flight with wind, photos, battery drain, the RC link, the pilot's
// sticks and Return to Home button, and the drone's own failsafes (which work with no app at all).

import type { DroneBridge, DroneEvent, FailsafeConfig, FlightMode, Telemetry } from "./bridge.ts";
import { bearingDeg, fromLocal, toLocal, type LatLng, type Vec2 } from "./geo.ts";
import { headwindMs, type Wind } from "./safety.ts";

export type SimOptions = {
  home: LatLng;
  batteryPercent?: number;
  wind?: Wind;
  /** Battery used per minute in calm air. Real Mini 4 Pro: roughly 3%/min. */
  drainPercentPerMin?: number;
  returnSpeedMs?: number;
};

type Target = { pos: Vec2; altitudeM: number; speedMs: number };
type ReturnPhase = "climb" | "fly" | "descend";

const TAKEOFF_HEIGHT_M = 1.2;
const CLIMB_MS = 3;
const DESCENT_MS = 2;
const PHOTO_DELAY_S = 1;
const CRITICAL_BATTERY = 8;

export class SimDrone implements DroneBridge {
  readonly home: LatLng;
  pos: Vec2 = { x: 0, y: 0 };
  altitudeM = 0;
  battery: number;
  mode: FlightMode = "onGround";
  signalOk = true;
  wind: Wind;
  timeS = 0;
  /** Every photo taken, in order. */
  photos: { waypointIndex: number; file: string; position: LatLng }[] = [];
  /** Highest distance from home reached, metres. */
  maxDistanceFromHomeM = 0;
  /** Make every photo fail, to test camera faults. */
  failPhotos = false;
  /** Log of things the drone did by itself. */
  log: string[] = [];

  private readonly drainPerMin: number;
  private readonly returnSpeedMs: number;
  private failsafe?: FailsafeConfig;
  private target?: Target;
  private returnPhase: ReturnPhase = "climb";
  private pendingPhoto?: { index: number; remainingS: number };
  private events: DroneEvent[] = [];
  private failsafeTriggered = false;

  constructor(o: SimOptions) {
    this.home = o.home;
    this.battery = o.batteryPercent ?? 100;
    this.wind = o.wind ?? { speedMs: 0, fromDeg: 0 };
    this.drainPerMin = o.drainPercentPerMin ?? 3;
    this.returnSpeedMs = o.returnSpeedMs ?? 8;
  }

  // ---- DroneBridge -------------------------------------------------------

  telemetry(): Telemetry {
    return {
      position: fromLocal(this.home, this.pos),
      altitudeM: this.altitudeM,
      batteryPercent: this.battery,
      flightMode: this.mode,
      signalOk: this.signalOk,
      wind: { ...this.wind },
      windWarning: this.wind.speedMs >= 10.7 ? "strong" : this.wind.speedMs >= 8 ? "moderate" : "none",
    };
  }

  drainEvents(): DroneEvent[] {
    if (!this.signalOk) return [];
    const e = this.events;
    this.events = [];
    return e;
  }

  configureFailsafe(config: FailsafeConfig): void {
    if (!this.linked()) return;
    this.failsafe = config;
  }

  takeOff(): void {
    if (!this.linked() || this.mode !== "onGround") return;
    if (!this.failsafe) throw new Error("Refusing to take off: failsafe not configured");
    this.mode = "takingOff";
    this.failsafeTriggered = false;
  }

  goTo(position: LatLng, altitudeM: number, speedMs: number): void {
    if (!this.appInControl()) return;
    this.target = { pos: toLocal(this.home, position), altitudeM, speedMs };
  }

  setGimbalPitch(): void {}

  takePhoto(waypointIndex: number): void {
    if (!this.appInControl()) return;
    this.pendingPhoto = { index: waypointIndex, remainingS: PHOTO_DELAY_S };
  }

  hover(): void {
    if (!this.appInControl()) return;
    this.target = undefined;
  }

  returnHome(): void {
    if (!this.linked() || !this.flying()) return;
    this.startReturn("app");
  }

  land(): void {
    if (!this.linked() || !this.flying()) return;
    this.mode = "landing";
    this.target = undefined;
  }

  // ---- Test controls -----------------------------------------------------

  setSignal(ok: boolean): void {
    this.signalOk = ok;
  }

  setWind(wind: Wind): void {
    this.wind = wind;
  }

  /** The pilot moves the sticks: the drone stops following the app. */
  pilotTakesControl(): void {
    if (!this.flying()) return;
    this.mode = "pilot";
    this.target = undefined;
    this.pendingPhoto = undefined;
  }

  /** The pilot presses Return to Home on the RC-N2. Works whatever the app is doing. */
  pilotPressesReturnHome(): void {
    if (this.flying()) this.startReturn("pilot RC button");
  }

  /** The pilot flies the drone by hand to a point (used after taking control). */
  pilotFlyTo(position: LatLng, altitudeM: number): void {
    if (this.mode !== "pilot") return;
    this.target = { pos: toLocal(this.home, position), altitudeM, speedMs: 5 };
  }

  pilotLands(): void {
    if (this.mode === "pilot") {
      this.mode = "landing";
      this.target = undefined;
    }
  }

  distanceFromHomeM(): number {
    return Math.hypot(this.pos.x, this.pos.y);
  }

  // ---- Physics -----------------------------------------------------------

  step(dt: number): void {
    this.timeS += dt;
    if (this.mode === "onGround") return;

    this.battery = Math.max(0, this.battery - (this.drainPerMin / 60) * (1 + this.wind.speedMs / 10) * dt);

    if (this.battery <= CRITICAL_BATTERY && this.mode !== "landing") {
      this.log.push(`critical battery at ${this.battery.toFixed(1)}%: landing where it is`);
      this.mode = "landing";
      this.target = undefined;
    }

    if (!this.signalOk && !this.failsafeTriggered && this.mode !== "returning" && this.mode !== "landing") {
      this.failsafeTriggered = true;
      this.runSignalLossFailsafe();
    }

    switch (this.mode) {
      case "takingOff":
        this.altitudeM = Math.min(TAKEOFF_HEIGHT_M, this.altitudeM + CLIMB_MS * dt);
        if (this.altitudeM >= TAKEOFF_HEIGHT_M) this.mode = "app";
        break;
      case "app":
      case "pilot":
        if (this.target) this.moveToward(this.target, dt);
        this.photoTick(dt);
        break;
      case "returning":
        this.returnTick(dt);
        break;
      case "landing":
        this.descend(dt);
        break;
    }
    this.maxDistanceFromHomeM = Math.max(this.maxDistanceFromHomeM, this.distanceFromHomeM());
  }

  private runSignalLossFailsafe(): void {
    const action = this.failsafe?.signalLossAction ?? "returnHome";
    this.log.push(`signal lost: ${action}`);
    if (action === "returnHome") this.startReturn("signal lost");
    else if (action === "land") {
      this.mode = "landing";
      this.target = undefined;
    } else {
      this.mode = "app";
      this.target = undefined;
    }
    this.pendingPhoto = undefined;
  }

  private startReturn(why: string): void {
    this.log.push(`return to home (${why})`);
    this.mode = "returning";
    this.returnPhase = "climb";
    this.target = undefined;
    this.pendingPhoto = undefined;
  }

  private returnTick(dt: number): void {
    const returnHeight = Math.max(this.failsafe?.returnHeightM ?? 30, 0);
    const home = this.failsafe ? toLocal(this.home, this.failsafe.home) : { x: 0, y: 0 };
    if (this.returnPhase === "climb") {
      if (this.altitudeM < returnHeight) this.altitudeM = Math.min(returnHeight, this.altitudeM + CLIMB_MS * dt);
      else this.returnPhase = "fly";
    } else if (this.returnPhase === "fly") {
      const arrived = this.moveHorizontal(home, this.returnSpeedMs, dt);
      if (arrived) {
        this.returnPhase = "descend";
        this.mode = "landing";
      }
    }
  }

  private descend(dt: number): void {
    this.altitudeM = Math.max(0, this.altitudeM - DESCENT_MS * dt);
    if (this.altitudeM === 0) {
      this.mode = "onGround";
      this.log.push(`landed ${this.distanceFromHomeM().toFixed(1)} m from home with ${this.battery.toFixed(1)}%`);
    }
  }

  private moveToward(t: Target, dt: number): void {
    this.moveHorizontal(t.pos, t.speedMs, dt);
    const dz = t.altitudeM - this.altitudeM;
    const rate = dz > 0 ? CLIMB_MS : DESCENT_MS;
    this.altitudeM += Math.sign(dz) * Math.min(Math.abs(dz), rate * dt);
  }

  /** Returns true once at the point. Ground speed drops by the headwind component. */
  private moveHorizontal(to: Vec2, speedMs: number, dt: number): boolean {
    const dx = to.x - this.pos.x;
    const dy = to.y - this.pos.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.01) {
      this.pos = { ...to };
      return true;
    }
    const bearing = bearingDeg(fromLocal(this.home, this.pos), fromLocal(this.home, to));
    const ground = Math.max(0.5, speedMs - headwindMs(this.wind, bearing));
    const step = Math.min(dist, ground * dt);
    this.pos = { x: this.pos.x + (dx / dist) * step, y: this.pos.y + (dy / dist) * step };
    return step >= dist;
  }

  private photoTick(dt: number): void {
    if (!this.pendingPhoto || this.mode !== "app") return;
    this.pendingPhoto.remainingS -= dt;
    if (this.pendingPhoto.remainingS <= 0) {
      const index = this.pendingPhoto.index;
      if (this.failPhotos) {
        this.events.push({ type: "photoFailed", waypointIndex: index, reason: "simulated camera fault" });
        this.pendingPhoto = undefined;
        return;
      }
      const file = `DJI_${String(this.photos.length + 1).padStart(4, "0")}.JPG`;
      this.photos.push({ waypointIndex: index, file, position: fromLocal(this.home, this.pos) });
      this.events.push({ type: "photoTaken", waypointIndex: index, file });
      this.pendingPhoto = undefined;
    }
  }

  private flying(): boolean {
    return this.mode !== "onGround";
  }

  private linked(): boolean {
    return this.signalOk;
  }

  private appInControl(): boolean {
    return this.signalOk && this.mode === "app";
  }
}
