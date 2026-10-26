// The phone-side flight controller. Call update() every time new telemetry arrives (about 10 times
// a second). It flies the mission one waypoint at a time and brings the drone home when a safety
// rule says so. It never fights the pilot: once the pilot takes over, it stops sending commands.

import type { DroneBridge, Telemetry } from "./bridge.ts";
import { distanceM, toLocal, type LatLng } from "./geo.ts";
import { emptyProgress, remainingWaypoints, type Mission, type ScanProgress, type Waypoint } from "./mission.ts";
import { batteryNeededToReturn, droneLimits, insideGeofence, type SafetySettings } from "./safety.ts";

type SessionState =
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

type ReturnReason =
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
const OBSTACLE_STOP_M = 3;
/** Roof circles keep only 2 m from the roof (MIN_ROOF_DISTANCE_M), so they stop for something nearer than that. */
const OBSTACLE_STOP_ORBIT_M = 1.5;
/** After the pilot resumes, give them this long to fly clear before the obstacle rule applies again. */
const OBSTACLE_RESUME_GRACE_S = 15;

/** A return or landing this soon after "pilot" is the drone's own (DJI reports "pilot" for a moment first). */
const PILOT_BLIP_S = 5;
const ARRIVED_M = 0.5;
const ARRIVED_ALT_M = 0.3;
const MAX_PHOTO_ATTEMPTS = 3;
/**
 * A photo that fails every attempt is skipped (the overlap covers one gap); this many skipped in a row
 * means the camera itself is in trouble, and the drone comes home. On 19 Oct one slow photo on a slow
 * card ended a scan 47 photos in.
 */
const MAX_SKIPPED_IN_A_ROW = 2;
/** After a failed photo, wait this long before the next one (the camera may still be saving). */
const PHOTO_RETRY_DELAY_S = 4;

// A stopped photo waits until the drone has stopped braking: the first real scan fired while it still
// leaned 15-21° and moved at up to 0.8 m/s, and those photos were half as sharp as the level ones.
const SETTLED_SPEED_MS = 0.2;
const SETTLED_TILT_DEG = 4;
/** Shoot anyway after this long (gusty air never quite settles). */
const SETTLE_MAX_S = 3;

/** A photo on the fly is taken this far before the spot, for the camera's own delay. */
const FLY_PAST_LEAD_M = 0.3;
/** Pushed further than this off the run's line (wind), the photo is taken later at a stop instead. */
const FLY_PAST_MAX_OFF_M = 1.5;
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
  /** Photos asked for on the fly, not yet confirmed by the drone. */
  private flyPending = new Set<number>();
  /** On-the-fly photos that failed or were missed: taken at a stop instead. */
  private stopAt = new Set<number>();
  /** When the drone arrived at the current stop photo, for the settling wait. */
  private settleStart?: number;
  private filming = false;
  /** No photo before this time (a pause after a failed one). */
  private retryAfter = -Infinity;
  /** Photos given up on after every attempt failed (the scan carried on without them). */
  readonly skippedPhotos: number[] = [];
  private skippedInARow = 0;

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
    const { bridge, home, settings, mission, boundary } = this.o;
    bridge.configureFailsafe({
      home,
      returnHeightM: settings.returnHeightM,
      signalLossAction: settings.signalLossAction,
      ...droneLimits(home, mission, boundary, settings),
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
    this.commanded(undefined);
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

  /** When the pilot (as far as the app can tell) last took control. */
  private pilotSinceS = 0;

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

    // The drone's own return, seen just after a moment of "pilot" (DJI drops the app's control a
    // moment before it shows Return to Home, and near home it lands instead). Still hands off.
    // Later on, a landing is the pilot's own (holding the stick down makes DJI land by itself).
    if (
      this.state === "pilotControl" &&
      (t.flightMode === "returning" || t.flightMode === "landing") &&
      this.now() - this.pilotSinceS < PILOT_BLIP_S
    ) {
      this.returnReason ??= "droneInitiated";
      this.setState("returning");
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
    const remaining = remainingWaypoints(mission, this.progress);
    // Photos already asked for on the fly are passed; the drone confirms them a moment later.
    const next = remaining.find((w) => !this.flyPending.has(w.index));

    // Everything flown; wait for the last photos to be confirmed.
    if (!next && remaining.length > 0 && this.state === "scanning") return;

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

    if (next.onTheFly && !this.stopAt.has(next.index)) return this.flyPast(t, next);

    if (this.commandedIndex !== next.index) {
      bridge.setGimbalPitch(next.gimbalPitchDeg);
      bridge.goTo(next.position, next.altitudeM, next.speedMs ?? mission.speedMs, next.headingDeg);
      this.commanded(next.index);
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
        // The camera is still saving a photo from the run: wait for it rather than be told it is busy.
        if (!this.settled(t) || this.cameraBusy()) return;
        bridge.takePhoto(next.index);
        this.photoRequested = true;
      } else {
        if (next.video === "start" && !this.filming) {
          bridge.startVideo();
          this.filming = true;
          this.log.push("filming");
        } else if (next.video === "stop") {
          this.stopFilming();
        }
        this.recordPhoto(next.index);
      }
    }
  }

  /**
   * An on-the-fly photo: keep flying towards the end of the run at its steady speed and take the
   * photo as the drone passes the spot. Missed (blown off the line), it is taken at a stop instead.
   */
  private flyPast(t: Telemetry, w: Waypoint): void {
    const { bridge, mission } = this.o;
    const end = mission.waypoints.find((x) => x.index > w.index && !x.onTheFly) ?? w;
    if (this.commandedIndex !== end.index) {
      bridge.setGimbalPitch(w.gimbalPitchDeg);
      bridge.goTo(end.position, end.altitudeM, end.speedMs ?? mission.speedMs, end.headingDeg);
      this.commanded(end.index);
    }
    const run = toLocal(w.position, end.position);
    const len = Math.hypot(run.x, run.y);
    const at = toLocal(w.position, t.position);
    const along = len > 0 ? (at.x * run.x + at.y * run.y) / len : 0;
    const off = len > 0 ? Math.abs(at.x * run.y - at.y * run.x) / len : Math.hypot(at.x, at.y);
    if (along < -FLY_PAST_LEAD_M) return;
    if (off > FLY_PAST_MAX_OFF_M) {
      if (along > 0) {
        this.log.push(`photo ${w.index} missed on the fly (${off.toFixed(1)} m off the line): taking it at a stop`);
        this.stopAt.add(w.index);
      }
      return;
    }
    // The camera is still saving the last photo (a slow card), or pausing after a failed one: rather
    // than be refused, take this one later at a stop.
    if (this.cameraBusy()) {
      this.log.push(`photo ${w.index}: camera still busy as the drone passed, taking it at a stop`);
      this.stopAt.add(w.index);
      return;
    }
    bridge.takePhoto(w.index);
    this.flyPending.add(w.index);
  }

  /** Stopped photos wait until the drone is still and level (when it reports that), or SETTLE_MAX_S. */
  private settled(t: Telemetry): boolean {
    if (t.speedMs === undefined && t.tiltDeg === undefined) return true;
    this.settleStart ??= this.now();
    const still = (t.speedMs ?? 0) <= SETTLED_SPEED_MS && (t.tiltDeg ?? 0) <= SETTLED_TILT_DEG;
    return still || this.now() - this.settleStart >= SETTLE_MAX_S;
  }

  /** Heading for a new waypoint: no photo asked for there yet, and a fresh settling wait. */
  private commanded(index: number | undefined): void {
    this.commandedIndex = index;
    this.photoRequested = false;
    this.settleStart = undefined;
  }

  /** Still saving a photo taken on the fly, or pausing after a failed one. */
  private cameraBusy(): boolean {
    return this.flyPending.size > 0 || this.now() < this.retryAfter;
  }

  private stopFilming(): void {
    if (!this.filming) return;
    this.o.bridge.stopVideo();
    this.filming = false;
    this.log.push("filming stopped");
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
    const skipped = this.skippedPhotos.indexOf(index);
    if (skipped >= 0) {
      // Saved after all (a slow card): not missing.
      this.skippedPhotos.splice(skipped, 1);
      this.log.push(`photo ${index} arrived late after all`);
    }
    this.skippedInARow = 0;
    this.markDone(index);
  }

  /** Done with this waypoint: saved for resuming, and the scan moves on. */
  private markDone(index: number): void {
    this.flyPending.delete(index);
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
    // One taken on the fly is tried again at a stop (the drone has flown on past the spot).
    if (this.flyPending.delete(index)) this.stopAt.add(index);
    // Try again after a pause: on 18 Oct a slow card was still saving, and two instant retries were
    // both refused, so the scan ended at the first photo.
    if (attempts < MAX_PHOTO_ATTEMPTS) {
      this.photoRequested = false;
      this.retryAfter = this.now() + PHOTO_RETRY_DELAY_S;
    } else if (this.state === "scanning") {
      if (++this.skippedInARow >= MAX_SKIPPED_IN_A_ROW) return this.goHome("cameraFault");
      // Skip it and fly on; marked done so the scan does not stop here (or come back for it on a resume).
      this.log.push(`photo ${index} skipped after ${attempts} attempts`);
      this.skippedPhotos.push(index);
      this.retryAfter = -Infinity;
      this.markDone(index);
    }
  }

  private setState(s: SessionState): void {
    if (s === this.state) return;
    // Whatever ends the flight (the app, the pilot or the drone itself) also ends the film.
    if (s === "returning" || s === "landing" || s === "landed") this.stopFilming();
    if (s === "pilotControl") this.pilotSinceS = this.now();
    this.log.push(`${this.state} -> ${s}${s === "returning" && this.returnReason ? ` (${this.returnReason})` : ""}`);
    this.state = s;
  }
}
