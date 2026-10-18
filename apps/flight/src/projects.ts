// The properties in the app: adding and opening them, finding a postcode, the plot drawing, and the
// plot worked out from the boundary corners marked over the satellite map.

import * as DocumentPicker from "expo-document-picker";
import { File, Paths } from "expo-file-system";
import { Image } from "react-native";

import type { LatLng } from "../../../packages/flight-core/src/geo.ts";
import { plotFromCorners } from "../../../packages/flight-core/src/georef.ts";

import { DjiDrone } from "../modules/dji-drone";

import {
  HOME_PROJECT_ID,
  PROJECT_FIELDS,
  S,
  commit,
  currentProject,
  freshProjectData,
  newProject,
  type AppState,
  type Project,
} from "./store";
import { loadSavedSurvey } from "./survey";

/** Open another project: the open one's fields are put away with it, the other's brought out. */
export async function openProject(id: string): Promise<void> {
  const next = S.projects.find((p) => p.id === id);
  if (!next || id === S.projectId) return;
  const cur = currentProject();
  cur.data = Object.fromEntries(PROJECT_FIELDS.map((k) => [k, S[k]])) as Project["data"];
  Object.assign(S, freshProjectData(), next.data ?? {});
  next.data = null;
  S.projectId = id;
  // Nothing selected or half-drawn carries over from the other property.
  Object.assign(S, { sel: null, vsel: null, pts: [], closed: false, placing: null, drawing: null, layer: "contours" } satisfies Partial<AppState>);
  commit();
  await loadSavedSurvey();
  commit();
}

export async function addProject(name: string): Promise<void> {
  const p = newProject(Date.now().toString(36), name.trim() || `Project ${S.projects.length + 1}`);
  // It joins the list with a fresh start; opening it puts the current project's data away.
  p.data = freshProjectData();
  S.projects.push(p);
  await openProject(p.id);
}

export function renameProject(name: string): void {
  if (!name.trim()) return;
  currentProject().name = name.trim();
  commit();
}

/** Delete a project that is not open, with its drawing and survey files. */
export function deleteProject(id: string): void {
  if (id === S.projectId || id === HOME_PROJECT_ID) return;
  const p = S.projects.find((x) => x.id === id);
  if (!p) return;
  for (const name of [p.drawing?.file, `survey-${id}.json`]) {
    if (!name) continue;
    const f = new File(Paths.document, name);
    if (f.exists) f.delete();
  }
  S.projects = S.projects.filter((x) => x.id !== id);
  commit();
}

/** A UK postcode's middle, from postcodes.io (free, no key). Throws with a plain message. */
export async function findPostcode(postcode: string): Promise<void> {
  const pc = postcode.toUpperCase().replace(/\s+/g, "");
  if (!/^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/.test(pc)) throw new Error("That does not look like a UK postcode.");
  let res: Response;
  try {
    res = await fetch(`https://api.postcodes.io/postcodes/${pc}`);
  } catch {
    throw new Error("Could not reach the postcode service. Check the phone's internet connection.");
  }
  if (res.status === 404) throw new Error("Postcode not found.");
  if (!res.ok) throw new Error(`The postcode service answered ${res.status}. Try again later.`);
  const body = (await res.json()) as { result?: { latitude: number; longitude: number; postcode: string } };
  if (!body.result) throw new Error("Postcode not found.");
  const p = currentProject();
  p.postcode = body.result.postcode;
  p.postcodeAt = { lat: body.result.latitude, lng: body.result.longitude };
  commit();
}

/** Longest side of a PDF page drawn as a picture: fine enough to read a title plan's boundary line. */
const PDF_PAGE_PX = 3000;

/**
 * Pick the plot drawing and keep a copy: the Land Registry title plan as its PDF file (the first page
 * is turned into a picture), or a photo or screenshot of it.
 */
export async function pickDrawing(): Promise<"picked" | "cancelled"> {
  const pick = await DocumentPicker.getDocumentAsync({ type: ["application/pdf", "image/*"], copyToCacheDirectory: true });
  if (pick.canceled || !pick.assets?.[0]) return "cancelled";
  const asset = pick.assets[0];
  const p = currentProject();
  const isPdf = asset.mimeType === "application/pdf" || /\.pdf$/i.test(asset.name);
  const ext = isPdf ? "png" : (asset.name.match(/\.(\w+)$/)?.[1] ?? "jpg").toLowerCase();
  const name = `drawing-${p.id}-${Date.now().toString(36)}.${ext}`;
  const copy = new File(Paths.document, name);
  let width: number;
  let height: number;
  if (isPdf) {
    if (!DjiDrone.renderPdfPage) throw new Error("This version of the app cannot open PDFs. Use a screenshot of the title plan instead.");
    [width, height] = await DjiDrone.renderPdfPage(asset.uri, copy.uri, PDF_PAGE_PX);
  } else {
    new File(asset.uri).copy(copy);
    ({ width, height } = await Image.getSize(copy.uri));
  }
  if (p.drawing) {
    const old = new File(Paths.document, p.drawing.file);
    if (old.exists) old.delete();
  }
  // A new drawing has to be lined up again.
  p.drawing = { file: name, widthPx: width, heightPx: height };
  p.overlay = null;
  p.corners = null;
  commit();
  return "picked";
}

export const drawingUri = (p: Project): string | null => (p.drawing ? new File(Paths.document, p.drawing.file).uri : null);

/**
 * The plot from the marked corners: its width, length and direction, and where it is. The house and
 * the front garden keep their depths; the rear garden takes the rest of the length.
 */
export function applyCorners(corners: LatLng[], overlay: Project["overlay"]): void {
  const g = plotFromCorners(corners);
  const front = S.plot.lengthM - S.plot.rearGardenM - S.plot.houseDepthM;
  const lengthM = Math.round(g.lengthM * 10) / 10;
  S.plot = {
    ...S.plot,
    widthM: Math.round(g.widthM * 10) / 10,
    lengthM,
    rearGardenM: Math.max(3, Math.round((lengthM - S.plot.houseDepthM - front) * 10) / 10),
    gardenBearingDeg: Math.round(g.gardenBearingDeg),
    latitudeDeg: Math.round(g.farLeft.lat * 100) / 100,
  };
  // The take-off point stays inside the (possibly smaller) rear garden.
  S.home = [Math.min(S.home[0], S.plot.widthM), Math.min(S.home[1], S.plot.rearGardenM)];
  const p = currentProject();
  p.corners = corners;
  p.overlay = overlay;
  commit();
}
