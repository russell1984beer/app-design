// Saves the materials quote as a PDF and the plan as a DXF, then opens the phone's share sheet
// (email, Google Drive, WhatsApp, Files and so on).

import { File, Paths } from "expo-file-system";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";

import { planDxf, quoteHtml } from "../../../packages/garden-core/src/index.ts";

import { terrainFor } from "./MapView";
import { S } from "./store";

const stamp = () => new Date().toISOString().slice(0, 10);

export async function shareQuotePdf(): Promise<void> {
  const html = quoteHtml({
    plot: S.plot,
    items: S.items,
    z: terrainFor(S.plot).z,
    title: "Garden materials quote",
    date: new Date(),
    prices: S.prices,
  });
  const { uri } = await Print.printToFileAsync({ html });
  // Give the file a sensible name before sharing.
  const named = new File(Paths.cache, `plotwise-quote-${stamp()}.pdf`);
  if (named.exists) named.delete();
  new File(uri).move(named);
  await Sharing.shareAsync(named.uri, { mimeType: "application/pdf", dialogTitle: "Share the quote", UTI: "com.adobe.pdf" });
}

export async function sharePlanDxf(): Promise<void> {
  const file = new File(Paths.cache, `plotwise-plan-${stamp()}.dxf`);
  if (file.exists) file.delete();
  file.create();
  file.write(planDxf(S.plot, S.items));
  await Sharing.shareAsync(file.uri, { mimeType: "application/dxf", dialogTitle: "Share the plan" });
}
