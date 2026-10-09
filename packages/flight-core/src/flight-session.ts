// The phone-side flight controller. Call update() every time new telemetry arrives (about 10 times
// a second). It flies the mission one waypoint at a time and brings the drone home when a safety
// rule says so. It never fights the pilot: once the pilot takes over, it stops sending commands.

import type { DroneBridge, Telemetry } from "./bridge.ts";
import { distanceM, type LatLng } from "./geo.ts";
import { emptyProgress, remainingWaypoints, type Mission, type ScanProgress } from "./mission.ts";
import { batteryNeededToReturn, insideGeofence, type SafetySettings } from "./safety.ts";

export type SessionState =
  | "ready"
  | "takingOff"
  | "climbing"
  | "scanning"
  | "returning"
  /** Stopped by the emergency button: hovering in place, waiting for the pilot's command. */
  | "holding"
  /** Landing where it is, on the pilot's command. */
  | "landing"
  | "pilotControl"
  | "signalLost"
  | "landed";

export type ReturnReason =
  | "complete"
  | "lowBattery"
  | "wind"
  | "geofence"
  | "pilotButton"
  | "droneInitiated"
  | "signalLoss"
  | "cameraFault"
  | "pilotLanded";

export type FlightSessionOptions = {
  mission: Mission;
  boundary: LatLng[];
  home: LatLng;
  settings: SafetySettings;
  bridge: DroneBridge;
  /** Progress from an earlier, interrupted flight of the same mission. */
  progress?: ScanProgress;
  /** Called after every photo so progress can be saved straight away. */
  onProgress?: (progress: ScanProgress) => void;
  /** Seconds, for measuring real battery drain. Defaults to the system clock. */
  clock?: () => number;
};

/** The drone's sensors see something this close while scanning: stop, hover and wait for the pilot. */
export const OBSTACLE_STOP_M = 3;
/** Roof circles keep only 2 m from the roof (MIN_ROOF_DISTANCE_M), so they stop for something nearer than that. */
export const OBSTACLE_STOP_ORBIT_M = 1.5;
/** After the pilot resumes, give them this long to fly clear before the obstacle rule applies again. */
const OBSTACLE_RESUME_GRACE_S = 15;

const ARRIVED_M = 0.5;
const ARRIVED_ALT_M = 0.3;
const MAX_PHOTO_ATTEMPTS = 3;
/** Fly this long before trusting the measured battery drain. */
const DRAIN_SAMPLE_S = 30;

export class FlightSession {
  state: SessionState = "ready";
  returnReason?: ReturnReason;
  readonly progress: ScanProgress;
  readonly log: string[] = [];

  private readonly o: FlightSessionOptions;
  private commandedIndex?: number;
  private photoRequested = false;
  private photoAttempts = new Map<number, number>();
  private airborneSince?: { timeS: number; battery: number };
  private heldFrom?: SessionState;
  /** Why it is holding: the pilot's STOP button, or an obstacle the drone's sensors saw. */
  holdReason?: "pilot" | "obstacle";
  private obstacleIgnoreUntil = -Infinity;
  /** Arrival time at the waypoint being held over (waypoint holdS). */
  private holdStart?: { index: number; timeS: number };
  private holdEnded = new Set<number>();

  constructor(options: FlightSessionOptions) {
    this.o = options;
    this.progress = options.progress
      ? { missionId: options.progress.missionId, completedWaypoints: [...options.progress.completedWaypoints] }
      : emptyProgress(options.mission);
    remainingWaypoints(options.mission, this.progress); // throws if progress is for another mission
  }

  get isComplete(): boolean {
    return remainingWaypoints(this.o.mission, this.progress).length === 0;
  }

  /** Configure the drone's own failsafes, then take off. Run the pre-flight check first. */
  start(): void {
    if (this.state !== "ready") throw new Error(`Cannot start from state ${this.state}`);
    const { bridge, home, settings } = this.o;
    bridge.configureFailsafe({
      home,
      returnHeightM: settings.returnHeightM,
      signalLossAction: settings.signalLossAction,
    });
    bridge.takeOff();
    this.setState("takingOff");
  }

  /**
   * The emergency button in the app: stop where it is and hover until the pilot decides what to do.
   * Safety rules (battery, wind, geofence, signal loss) keep working while it hovers.
   */
  pilotHold(): void {
    if (this.state !== "takingOff" && this.state !== "climbing" && this.state !== "scanning") return;
    this.o.bridge.hover();
    // Climbing restarts from the climb command; take-off and scanning carry on where they were.
    this.heldFrom = this.state === "climbing" ? "takingOff" : this.state;
    this.commandedIndex = undefined;
    this.photoRequested = false;
    this.holdReason = "pilot";
    this.setState("holding");
  }

  /** The drone's own sensors see something close: stop and hover, exactly like the STOP button. */
  private obstacleHold(distanceM: number): void {
    this.pilotHold();
    this.holdReason = "obstacle";
    this.log.push(`obstacle ${distanceM.toFixed(1)} m away: stopped, hovering, waiting for the pilot`);
  }

  /** Carry on with the scan after an emergency stop. */
  pilotResume(): void {
    if (this.state !== "holding") return;
    if (this.holdReason === "obstacle") this.obstacleIgnoreUntil = this.now() + OBSTACLE_RESUME_GRACE_S;
    this.setState(this.heldFrom ?? "scanning");
    this.heldFrom = undefined;
    this.holdReason = undefined;
  }

  /** Seconds left of a waypoint's hover (holdS), or undefined when not holding over one. */
  get holdRemainingS(): number | undefined {
    const h = this.holdStart;
    if (!h || this.holdEnded.has(h.index) || this.state !== "scanning") return undefined;
    const w = this.o.mission.waypoints.find((x) => x.index === h.index);
    return Math.max(0, (w?.holdS ?? 0) - (this.now() - h.timeS));
  }

  /** The pilot is happy: carry on now instead of waiting out the hover. */
  endHold(): void {
    if (this.holdStart) this.holdEnded.add(this.holdStart.index);
  }

  private now(): number {
    return this.o.clock ? this.o.clock() : performance.now() / 1000;
  }

  /** Land straight down where it is (the pilot has checked the ground below is clear). */
  pilotLand(): void {
    if (this.state === "ready" || this.state === "landed") return;
    this.o.bridge.land();
    this.returnReason = "pilotLanded";
    this.setState("landing");
  }

  /** The Return button in the app. */
  pilotReturnHome(): void {
    if (this.state === "ready" || this.state === "landed") return;
    this.o.bridge.returnHome();
    this.returnReason = "pilotButton";
    this.setState("returning");
  }

  update(): void {
    const { bridge } = this.o;
    for (const e of bridge.drainEvents()) {
      if (e.type === "photoTaken") this.recordPhoto(e.waypointIndex);
      else this.photoFailed(e.waypointIndex, e.reason);
    }

    if (this.state === "ready" || this.state === "landed") return;
    const t = bridge.telemetry();

    // With no link, the drone's own failsafe is in charge. Do nothing until the link is back.
    if (!t.signalOk) {
      if (this.state !== "signalLost") {
        this.setState("signalLost");
        this.returnReason ??= "signalLoss";
      } else if (t.linkUp && t.flightMode === "onGround") {
        // The link is back and the drone says it is on the ground (motors off), even if its
        // position has not come back (seen in DJI's simulator, whose flight ends with the link).
        this.log.push("link back: the drone says it is on the ground");
        this.setState("landed");
      }
      return;
    }

    if (this.state === "signalLost") {
      this.afterSignalRestored(t);
      return;
    }

    // Landed while the app was not watching (app closed or phone asleep during the return).
    if (t.flightMode === "onGround" && (this.state === "climbing" || this.state === "scanning" || this.state === "holding")) {
      this.returnReason ??= "droneInitiated";
      this.setState("landed");
      return;
    }

    if (t.flightMode === "pilot" && this.state !== "pilotControl") {
      this.setState("pilotControl");
      return;
    }

    if (this.state === "pilotControl" || this.state === "returning" || this.state === "landing") {
      if (t.flightMode === "onGround") this.setState("landed");
      return;
    }

    // The drone started returning by itself (RC button, or the drone's own battery rule).
    if (t.flightMode === "returning" || t.flightMode === "landing") {
      this.returnReason = "droneInitiated";
      this.setState("returning");
      return;
    }

    if (this.state === "takingOff" && t.flightMode !== "app") return;

    const reason = this.safetyReason(t);
    if (reason) {
      this.goHome(reason);
      return;
    }

    // Emergency stop: keep hovering, send nothing else, wait for the pilot.
    if (this.state === "holding") return;

    // Something close in front, beside or above (a branch, a wall): stop before the drone gets to it.
    if (this.state === "scanning" && t.obstacleM !== undefined && t.obstacleM < (this.o.mission.kind === "orbit" ? OBSTACLE_STOP_ORBIT_M : OBSTACLE_STOP_M) && this.now() >= this.obstacleIgnoreUntil) {
      this.obstacleHold(t.obstacleM);
      return;
    }

    this.flyMission(t);
  }

  private flyMission(t: Telemetry): void {
    const { bridge, mission } = this.o;
    const next = remainingWaypoints(mission, this.progress)[0];

    if (this.state === "takingOff") {
      if (!next) return this.finish();
      // Climb straight up above the take-off point before going anywhere.
      bridge.goTo(t.position, next.altitudeM, mission.speedMs);
      this.setState("climbing");
      return;
    }

    if (this.state === "climbing") {
      if (!next) return this.finish();
      if (Math.abs(t.altitudeM - next.altitudeM) < ARRIVED_ALT_M) this.setState("scanning");
      else return;
    }

    if (!next) return this.finish();

    if (this.commandedIndex !== next.index) {
      bridge.setGimbalPitch(next.gimbalPitchDeg);
      bridge.goTo(next.position, next.altitudeM, mission.speedMs, next.headingDeg);
      this.commandedIndex = next.index;
      this.photoRequested = false;
      return;
    }

    const arrived =
      distanceM(t.position, next.position) < ARRIVED_M && Math.abs(t.altitudeM - next.altitudeM) < ARRIVED_ALT_M;
    if (arrived && next.holdS && !this.holdEnded.has(next.index)) {
      if (this.holdStart?.index !== next.index) {
        this.holdStart = { index: next.index, timeS: this.now() };
        this.log.push(`hovering ${next.holdS} s over waypoint ${next.index}`);
      }
      if (this.now() - this.holdStart.timeS < next.holdS) return;
      this.holdEnded.add(next.index);
    }
    if (arrived && !this.photoRequested) {
      if (next.photo) {
        bridge.takePhoto(next.index);
        this.photoRequested = true;
      } else {
        this.recordPhoto(next.index);
      }
    }
  }

  private safetyReason(t: Telemetry): ReturnReason | undefined {
    const { settings, boundary, home } = this.o;
    const wind = t.wind ?? { speedMs: 0, fromDeg: 0 };
    if (t.windWarning === "strong" || wind.speedMs > settings.maxGustMs) return "wind";
    const drain = Math.max(settings.batteryDrainPercentPerMin, this.measuredDrainPerMin(t));
    const needed = batteryNeededToReturn({
      position: t.position,
      altitudeM: t.altitudeM,
      home,
      wind,
      settings: { ...settings, batteryDrainPercentPerMin: drain },
    });
    if (t.batteryPercent <= needed) return "lowBattery";
    if (!insideGeofence(t.position, boundary, settings.geofenceMarginM)) return "geofence";
    return undefined;
  }

  /** Battery actually used per minute on this flight, so an old or cold battery is noticed. */
  private measuredDrainPerMin(t: Telemetry): number {
    const now = this.o.clock ? this.o.clock() : performance.now() / 1000;
    if (!this.airborneSince) {
      this.airborneSince = { timeS: now, battery: t.batteryPercent };
      return 0;
    }
    const elapsed = now - this.airborneSince.timeS;
    if (elapsed < DRAIN_SAMPLE_S) return 0;
    return ((this.airborneSince.battery - t.batteryPercent) / elapsed) * 60;
  }

  private afterSignalRestored(t: Telemetry): void {
    this.log.push("signal restored");
    if (t.flightMode === "onGround") this.setState("landed");
    else if (t.flightMode === "pilot") this.setState("pilotControl");
    else if (t.flightMode === "returning" || t.flightMode === "landing") this.setState("returning");
    else this.goHome("signalLoss"); // drone was hovering (failsafe set to hover): bring it home
  }

  /** Every waypoint done: the drone's own Return to Home, or land straight down if the mission says so. */
  private finish(): void {
    if (this.o.mission.endWith !== "land") return this.goHome("complete");
    this.o.bridge.land();
    this.returnReason = "complete";
    this.setState("landing");
  }

  private goHome(reason: ReturnReason): void {
    this.o.bridge.returnHome();
    this.returnReason = reason;
    this.setState("returning");
  }

  private recordPhoto(index: number): void {
    if (!this.progress.completedWaypoints.includes(index)) {
      this.progress.completedWaypoints.push(index);
      this.o.onProgress?.({ ...this.progress, completedWaypoints: [...this.progress.completedWaypoints] });
    }
    if (this.commandedIndex === index) this.photoRequested = false;
  }

  private photoFailed(index: number, reason: string): void {
    const attempts = (this.photoAttempts.get(index) ?? 0) + 1;
    this.photoAttempts.set(index, attempts);
    this.log.push(`photo ${index} failed (${reason}), attempt ${attempts}`);
    if (attempts < MAX_PHOTO_ATTEMPTS) this.photoRequested = false; // try again on the next update
    else if (this.state === "scanning") this.goHome("cameraFault");
  }

  private setState(s: SessionState): void {
    if (s === this.state) return;
    this.log.push(`${this.state} -> ${s}${s === "returning" && this.returnReason ? ` (${this.returnReason})` : ""}`);
    this.state = s;
  }
}
