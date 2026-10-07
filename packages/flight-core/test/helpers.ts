import { fromLocal, type LatLng } from "../src/geo.ts";
import { FlightSession } from "../src/flight-session.ts";
import type { SimDrone } from "../src/sim-drone.ts";

// A made-up location. Do not put the owner's real address or coordinates in this public repo.
export const ORIGIN: LatLng = { lat: 52.0, lng: -1.0 };

/** Rectangle `widthM` wide and `lengthM` long, starting at `origin` and running along `bearingDeg`. */
export function rectangle(origin: LatLng, bearingDeg: number, widthM: number, lengthM: number): LatLng[] {
  const b = (bearingDeg * Math.PI) / 180;
  const along = { x: Math.sin(b), y: Math.cos(b) };
  const across = { x: Math.cos(b), y: -Math.sin(b) };
  const at = (a: number, c: number) => fromLocal(origin, { x: along.x * a + across.x * c, y: along.y * a + across.y * c });
  return [at(0, -widthM / 2), at(lengthM, -widthM / 2), at(lengthM, widthM / 2), at(0, widthM / 2)];
}

/** A point `a` metres along and `c` metres across the same rectangle's axis. */
export function alongAxis(origin: LatLng, bearingDeg: number, a: number, c = 0): LatLng {
  const b = (bearingDeg * Math.PI) / 180;
  return fromLocal(origin, {
    x: Math.sin(b) * a + Math.cos(b) * c,
    y: Math.cos(b) * a - Math.sin(b) * c,
  });
}

/**
 * Same shape as the owner's test garden: a 7 m x 43 m plot (5.5 m front garden, 8 m house,
 * 29.5 m rear garden) running from the street towards the south-east.
 */
export const PLOT_BEARING = 135;
export const PLOT = rectangle(ORIGIN, PLOT_BEARING, 7, 43);
/** Home point on the rear lawn, 20 m from the street. */
export const PLOT_HOME = alongAxis(ORIGIN, PLOT_BEARING, 20);

/** A bigger field, for flights long enough to run the battery down. */
export const FIELD = rectangle(ORIGIN, 0, 40, 100);
export const FIELD_HOME = alongAxis(ORIGIN, 0, 2);

export type RunOptions = {
  until: () => boolean;
  maxS?: number;
  dt?: number;
  /** Called before each step with the simulated time, to inject gusts, signal loss etc. */
  each?: (timeS: number) => void;
};

/** Step the simulator and the session together. Returns the simulated time, or throws on timeout. */
export function run(sim: SimDrone, session: FlightSession, o: RunOptions): number {
  const dt = o.dt ?? 0.1;
  const maxS = o.maxS ?? 3600;
  while (sim.timeS < maxS) {
    o.each?.(sim.timeS);
    sim.step(dt);
    session.update();
    if (o.until()) return sim.timeS;
  }
  throw new Error(`Timed out after ${maxS} s. Session: ${session.state}. Log:\n${session.log.join("\n")}\n${sim.log.join("\n")}`);
}

export const landed = (sim: SimDrone, session: FlightSession) => () =>
  sim.mode === "onGround" && session.state === "landed";
