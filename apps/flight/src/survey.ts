// The real survey, once one has been processed on the PC and opened in the app. Kept as a file on
// the phone or iPad (it is too big for the app's saved settings), and read back when the app starts.
// Also: sharing the scan details the PC tool needs to line the survey up with the plan.

import * as DocumentPicker from "expo-document-picker";
import { Platform } from "react-native";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";

import { SCAN_FORMAT, readSurvey, type ScanDetails, type SurveyPackage } from "../../../packages/garden-core/src/index.ts";

import { SIM_HOME } from "./drone";
import { planToGps } from "./flight";
import { currentLidar, fillGapsFromLidar, lidarSurvey } from "./lidar";
import { HOME_PROJECT_ID, S, commit } from "./store";

const SURVEY_FILE = "survey.json";

let current: SurveyPackage | null = null;

/** The drone survey opened in the app, if it matches the plot. */
export function droneSurvey(): SurveyPackage | null {
  if (!current) return null;
  const p = current.plot;
  const q = S.plot;
  return p.widthM === q.widthM && p.lengthM === q.lengthM ? current : null;
}

let lidarCache: { key: string; survey: SurveyPackage | null } | null = null;

let mergedCache: { key: string; survey: SurveyPackage } | null = null;

/**
 * The levels in use: the drone survey if one is open (with any part it did not fly filled from the
 * LIDAR), otherwise the Environment Agency's LIDAR.
 */
export function currentSurvey(): SurveyPackage | null {
  const drone = droneSurvey();
  if (drone) {
    if (!drone.ground.measured?.includes("0")) return drone;
    const lidar = lidarOnlySurvey();
    if (!lidar) return drone;
    const key = `${drone.createdAt}|${lidar.createdAt}`;
    if (mergedCache?.key !== key) mergedCache = { key, survey: fillGapsFromLidar(drone, lidar) };
    return mergedCache.survey;
  }
  return lidarOnlySurvey();
}

function lidarOnlySurvey(): SurveyPackage | null {
  const l = currentLidar();
  if (!l) return null;
  const key = `${l.fetchedAt}|${l.home.join(",")}|${JSON.stringify(S.plot)}|${JSON.stringify(S.goneSpots)}`;
  if (lidarCache?.key !== key) {
    let survey: SurveyPackage | null = null;
    try {
      // The plot placed on GPS as it was when the LIDAR was fetched.
      survey = lidarSurvey(l, S.plot, (p) => planToGps({ ...S, home: l.home }, l.anchor, p), S.goneSpots);
    } catch {
      survey = null;
    }
    lidarCache = { key, survey };
  }
  return lidarCache.survey;
}

/** Each project's survey in its own file (the first project keeps the original name). */
function surveyFile(): File {
  return new File(Paths.document, S.projectId === HOME_PROJECT_ID ? SURVEY_FILE : `survey-${S.projectId}.json`);
}

/** Read the open project's saved survey (when the app starts, or another project is opened). */
export async function loadSavedSurvey(): Promise<void> {
  // The browser preview can be given a survey to show.
  const demo = (globalThis as { __PLOTWISE_DEMO_SURVEY__?: string }).__PLOTWISE_DEMO_SURVEY__;
  if (Platform.OS === "web" && demo) {
    current = readSurvey(demo);
    S.scanned = true;
    S.layer = "photo";
    commit();
    return;
  }
  current = null;
  try {
    const f = surveyFile();
    if (!f.exists) return;
    current = readSurvey(await f.text());
    S.scanned = true;
    commit();
  } catch {
    current = null;
  }
}

/** Let the user pick a plotwise-survey file (from Downloads, Drive, an email…) and use it. */
export async function openSurveyFile(): Promise<"opened" | "cancelled"> {
  const pick = await DocumentPicker.getDocumentAsync({ type: ["application/json", "*/*"], copyToCacheDirectory: true });
  if (pick.canceled || !pick.assets?.[0]) return "cancelled";
  const text = await new File(pick.assets[0].uri).text();
  const survey = readSurvey(text);
  if (survey.plot.widthM !== S.plot.widthM || survey.plot.lengthM !== S.plot.lengthM) {
    throw new Error(`This survey is for a ${survey.plot.widthM} × ${survey.plot.lengthM} m plot, but the app is set up for ${S.plot.widthM} × ${S.plot.lengthM} m.`);
  }
  const f = surveyFile();
  if (f.exists) f.delete();
  f.create();
  f.write(text);
  current = survey;
  S.scanned = true;
  S.layer = survey.photo ? "photo" : "contours";
  commit();
  return "opened";
}

export function removeSurvey(): void {
  const f = surveyFile();
  if (f.exists) f.delete();
  current = null;
  commit();
}

/**
 * Record a real garden scan (or first flight check) as its photos are taken, so its details can be
 * sent to the PC for processing, also when it stopped part-way.
 */
export function recordScan(anchor: { lat: number; lng: number }, photoCount: number, flownAt: string): void {
  S.lastScan = { format: SCAN_FORMAT, version: 1, flownAt, plot: S.plot, home: S.home, anchor, photoCount };
}

/**
 * The scan details to send to the PC: the last recorded scan; for a scan stopped before the app
 * recorded part-flown scans, the stopped scan's take-off point; or, failing that, the LIDAR's take-off
 * point (lined up on the house), which places the plot on the map just as well.
 */
export function scanDetailsToSend(): ScanDetails | null {
  if (S.lastScan) return S.lastScan;
  const base = { format: SCAN_FORMAT, version: 1 as const, flownAt: new Date().toISOString(), plot: S.plot };
  const stopped = S.resume.survey;
  if (stopped && !(stopped.anchor.lat === SIM_HOME.lat && stopped.anchor.lng === SIM_HOME.lng)) {
    return { ...base, home: S.home, anchor: stopped.anchor, photoCount: stopped.progress.completedWaypoints.length };
  }
  const l = currentLidar();
  if (l) return { ...base, home: l.home, anchor: l.anchor, photoCount: 0 };
  return null;
}

export async function shareScanDetails(scan: ScanDetails): Promise<void> {
  const f = new File(Paths.cache, `plotwise-scan-${scan.flownAt.slice(0, 10)}.json`);
  if (f.exists) f.delete();
  f.create();
  f.write(JSON.stringify(scan, null, 2));
  await Sharing.shareAsync(f.uri, { mimeType: "application/json", dialogTitle: "Send the scan details to the PC" });
}
