// App state. Like the prototype, panels change the state object directly and then call commit(),
// which redraws and saves the parts worth keeping on the phone.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useReducer } from "react";

import type { LatLng } from "../../../packages/flight-core/src/geo.ts";
import type { ScanProgress } from "../../../packages/flight-core/src/mission.ts";
import { DEFAULT_SAFETY, type SafetySettings } from "../../../packages/flight-core/src/safety.ts";
import { DEFAULT_PRICES, History, TEST_PLOT, existingFeatures, type Prices, type ScanDetails, type Item, type Kind, type Plot, type Pt } from "../../../packages/garden-core/src/index.ts";

export type Tab = "plan" | "scan" | "survey" | "design" | "roof" | "quote";
export type FlightMode = "sim" | "real";

export type AppState = {
  tab: Tab;
  plot: Plot;
  /** Take-off and landing point, on the plan. */
  home: Pt;
  alt: number;
  /** Photo overlap along each pass, percent. */
  ov: number;
  /** Add a lap round the plot's edge with the camera tilted, after the passes. */
  edgeLap: boolean;
  safety: SafetySettings;
  /** Operator ID, airspace, neighbours. Ticked again before every flight. */
  checks: boolean[];
  mode: FlightMode;
  /** A survey is loaded (the draft from the title plan until real processing exists). */
  scanned: boolean;
  layer: "photo" | "contours" | "slope" | "heights";
  tool: "dist" | "area";
  pts: Pt[];
  closed: boolean;
  items: Item[];
  nextId: number;
  sel: number | null;
  /** Selected corner of a drawn shape. */
  vsel: number | null;
  placing: Kind | null;
  drawing: { kind: Kind; pts: Pt[] } | null;
  dmode: "layout" | "sun" | "plants";
  month: string;
  time: number;
  hours: boolean;
  style: string | null;
  styleNote: string;
  snap: boolean;
  existInit: boolean;
  roof: { photosTaken: number; showExample: boolean; sel: number | null };
  /** A scan that stopped part-way, with where the home point was, so it can resume. */
  resume: Partial<Record<"survey" | "roof", { anchor: LatLng; progress: ScanProgress }>>;
  /** The last finished garden scan, for processing into a survey on the PC. */
  lastScan: ScanDetails | null;
  /** The owner's own unit prices for the materials estimate. */
  prices: Prices;
  /** Simulator tests that have passed on this phone. */
  testsPassed: string[];
  /** When the first flight check was last completed for real (not in the simulator). */
  firstFlightDoneAt: string | null;
  /** Tall spots in the LIDAR the owner says are gone (e.g. trees cut down since), on the plan. */
  goneSpots: Pt[];
  showBench: boolean;
  /** Bumped on every change; the map redraws when it changes. */
  v: number;
};

export const S: AppState = {
  tab: "plan",
  plot: TEST_PLOT,
  // Middle of the rear garden; moved by tapping the Plan map.
  home: [TEST_PLOT.widthM / 2, TEST_PLOT.rearGardenM / 2],
  alt: 20,
  ov: 75,
  edgeLap: false,
  safety: DEFAULT_SAFETY,
  checks: [false, false, false],
  mode: "sim",
  scanned: false,
  layer: "contours",
  tool: "dist",
  pts: [],
  closed: false,
  items: [],
  nextId: 1,
  sel: null,
  vsel: null,
  placing: null,
  drawing: null,
  dmode: "layout",
  month: "jun",
  time: 15,
  hours: false,
  style: null,
  styleNote: "",
  snap: true,
  existInit: false,
  roof: { photosTaken: 0, showExample: false, sel: null },
  resume: {},
  prices: DEFAULT_PRICES,
  lastScan: null,
  testsPassed: [],
  firstFlightDoneAt: null,
  goneSpots: [],
  showBench: false,
  v: 0,
};

export const history = new History();

export const nextId = () => S.nextId++;

/** Add the features already in the garden the first time a survey is loaded. */
export function ensureExisting(): void {
  if (S.existInit || !S.scanned) return;
  S.existInit = true;
  S.items.push(...existingFeatures(S.plot, nextId));
}

/** Snap to 10 cm when snapping is on. */
export const sn = (v: number) => (S.snap ? Math.round(v * 10) / 10 : v);

const KEEP = ["plot", "home", "alt", "ov", "edgeLap", "safety", "scanned", "items", "nextId", "existInit", "style", "styleNote", "snap", "roof", "resume", "prices", "lastScan", "testsPassed", "firstFlightDoneAt", "goneSpots"] as const;
const STORE_KEY = "plotwise-state-v1";

const listeners = new Set<() => void>();
let saveTimer: ReturnType<typeof setTimeout> | undefined;

export function commit(): void {
  ensureExisting();
  S.v++;
  for (const l of listeners) l();
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const kept = Object.fromEntries(KEEP.map((k) => [k, S[k]]));
    AsyncStorage.setItem(STORE_KEY, JSON.stringify(kept)).catch(() => {});
  }, 500);
}

/** Save straight away (scan progress must not be lost if the app is closed mid-flight). */
export function commitNow(): void {
  commit();
  if (saveTimer) clearTimeout(saveTimer);
  const kept = Object.fromEntries(KEEP.map((k) => [k, S[k]]));
  AsyncStorage.setItem(STORE_KEY, JSON.stringify(kept)).catch(() => {});
}

export async function loadSaved(): Promise<void> {
  try {
    const text = await AsyncStorage.getItem(STORE_KEY);
    if (text) {
      const saved = JSON.parse(text) as Partial<AppState>;
      for (const k of KEEP) if (saved[k] !== undefined) (S as Record<string, unknown>)[k] = saved[k];
      // New safety settings added later keep their defaults.
      S.safety = { ...DEFAULT_SAFETY, ...S.safety };
      S.prices = { ...DEFAULT_PRICES, ...S.prices };
    }
  } catch {
    // A damaged save starts afresh rather than stopping the app.
  }
  commit();
}

/** Redraw this component whenever the state changes. */
export function useApp(): AppState {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    listeners.add(bump);
    return () => {
      listeners.delete(bump);
    };
  }, []);
  return S;
}

export function go(tab: Tab): void {
  S.tab = tab;
  S.placing = null;
  S.drawing = null;
  commit();
}
