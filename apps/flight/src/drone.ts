// One connection to the drone for the whole app. Screens subscribe to it; the flight in progress
// (a garden scan, a roof scan or a simulator test) is driven from here on every telemetry update.

import { useEffect, useReducer } from "react";

import type { Telemetry } from "../../../packages/flight-core/src/bridge.ts";
import { FlightSession, type FlightSessionOptions } from "../../../packages/flight-core/src/flight-session.ts";
import type { LatLng } from "../../../packages/flight-core/src/geo.ts";
import type { Mission } from "../../../packages/flight-core/src/mission.ts";
import { DjiDrone, NativeDroneBridge } from "../modules/dji-drone";

/** Where the simulated drone starts: a made-up open field. Change it if the simulator complains. */
export const SIM_HOME: LatLng = { lat: 52.0, lng: -1.0 };

export type JobKind = "survey" | "roof" | "check" | "test";

export type Job = {
  kind: JobKind;
  mission: Mission;
  /** GPS position of the home point. */
  anchor: LatLng;
  session: FlightSession;
};

class DroneHub {
  telemetry: Telemetry | null = null;
  status = "Starting DJI SDK…";
  simOn = false;
  job: Job | null = null;
  readonly log: string[] = [];

  private listeners = new Set<() => void>();
  private telemetryHooks = new Set<(t: Telemetry) => void>();
  private sessionLogLength = 0;
  private started = false;

  readonly bridge = new NativeDroneBridge(DjiDrone, {
    onStatus: (s) => {
      this.status = s.message;
      this.addLog(s.message);
      this.emit();
    },
    onTelemetry: (t) => {
      this.telemetry = t;
      const session = this.job?.session;
      if (session) {
        session.update();
        while (session.log.length > this.sessionLogLength) this.addLog(session.log[this.sessionLogLength++]);
      }
      for (const h of this.telemetryHooks) h(t);
      this.emit();
    },
  });

  start(): void {
    if (this.started) return;
    this.started = true;
    this.bridge.start();
    const s = DjiDrone.getStatus();
    this.status = s.lastMessage ?? (s.registered ? "DJI SDK registered." : "Waiting for DJI SDK…");
  }

  get flying(): boolean {
    const st = this.job?.session.state;
    return !!st && st !== "ready" && st !== "landed";
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onTelemetry(fn: (t: Telemetry) => void): () => void {
    this.telemetryHooks.add(fn);
    return () => this.telemetryHooks.delete(fn);
  }

  addLog(line: string): void {
    this.log.unshift(`${new Date().toLocaleTimeString()}  ${line}`);
    if (this.log.length > 80) this.log.pop();
  }

  async setSimulator(on: boolean): Promise<void> {
    try {
      if (on) {
        // Restarts it if it is still running from before (done in the drone module), so the drone
        // starts again on the ground at SIM_HOME instead of wherever it last stopped.
        await DjiDrone.enableSimulator(SIM_HOME.lat, SIM_HOME.lng);
        DjiDrone.setSimulatorWind(0, 0);
        this.addLog("Simulator on. Propellers must be OFF.");
      } else {
        await DjiDrone.disableSimulator();
        this.addLog("Simulator off.");
      }
      this.simOn = on;
    } catch (e) {
      this.addLog(`Simulator: ${(e as Error).message}`);
      throw e;
    } finally {
      this.emit();
    }
  }

  /** Start a flight. Run the pre-flight check first; FlightSession sets the drone's own failsafes. */
  startJob(kind: JobKind, anchor: LatLng, options: Omit<FlightSessionOptions, "bridge" | "home">): FlightSession {
    if (this.flying) throw new Error("A flight is already in progress");
    // A test wind from the simulator test bench must never reach a real scan.
    if (kind !== "test") {
      this.bridge.setTestWind(null);
      this.bridge.setTestObstacle(null);
    }
    const session = new FlightSession({ ...options, bridge: this.bridge, home: anchor });
    this.job = { kind, mission: options.mission, anchor, session };
    this.sessionLogLength = 0;
    this.addLog(`Starting ${kind === "survey" ? "garden scan" : kind === "roof" ? "roof scan" : kind === "check" ? "first flight check" : "simulator test"}`);
    session.start();
    this.emit();
    return session;
  }

  /** Forget a finished flight (its result has been read). */
  clearJob(): void {
    if (this.flying) return;
    this.job = null;
    this.emit();
  }

  /** The emergency STOP button: hover in place and wait. */
  hold(): void {
    this.job?.session.pilotHold();
    this.addLog("Emergency stop: hovering, waiting for the pilot.");
    this.emit();
  }

  resume(): void {
    this.job?.session.pilotResume();
    this.emit();
  }

  landHere(): void {
    this.job?.session.pilotLand();
    this.emit();
  }

  /** The pilot's Return home button in the app. */
  returnHome(): void {
    this.job?.session.pilotReturnHome();
    this.emit();
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }
}

export const drone = new DroneHub();

/** Redraw this component when the drone reports something. */
export function useDrone(): DroneHub {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => drone.subscribe(bump), []);
  return drone;
}
