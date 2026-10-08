// Pure edits used by withDji.js. No Expo imports, so they can be tested with plain Node.

const MAIN_APP_CLASS = /class MainApplication\s*:\s*Application\(\),\s*ReactApplication\s*\{/;
const SUPER_ON_CREATE = /override fun onCreate\(\)\s*\{\s*\n(\s*)super\.onCreate\(\)/;

const ATTACH = `
  // DJI SDK: must be installed before anything else touches it.
  override fun attachBaseContext(base: android.content.Context) {
    super.attachBaseContext(base)
    expo.modules.djidrone.DjiSdk.install(this)
  }
`;

/** Adds the two DJI start-up calls to MainApplication.kt. Safe to run twice. */
function addDjiToMainApplication(src) {
  if (src.includes("expo.modules.djidrone.DjiSdk")) return src;
  if (!MAIN_APP_CLASS.test(src)) throw new Error("withDji: MainApplication class declaration not found");
  if (!SUPER_ON_CREATE.test(src)) throw new Error("withDji: super.onCreate() not found in MainApplication");
  return src
    .replace(MAIN_APP_CLASS, (m) => `${m}\n${ATTACH}`)
    .replace(SUPER_ON_CREATE, (m, indent) => `${m}\n${indent}expo.modules.djidrone.DjiSdk.init(this)`);
}

const USB_ATTACHED = "android.hardware.usb.action.USB_ACCESSORY_ATTACHED";

/**
 * Adds the DJI App Key and the "open this app when the controller is plugged in" filter to the
 * parsed AndroidManifest (the xml2js object Expo config plugins use).
 */
function addDjiToManifest(manifest, apiKey) {
  const app = manifest.manifest.application[0];
  app["meta-data"] = (app["meta-data"] ?? []).filter((m) => m.$["android:name"] !== "com.dji.sdk.API_KEY");
  app["meta-data"].push({ $: { "android:name": "com.dji.sdk.API_KEY", "android:value": apiKey } });

  const activity = (app.activity ?? []).find((a) => a.$["android:name"] === ".MainActivity");
  if (!activity) throw new Error("withDji: .MainActivity not found in AndroidManifest");
  activity["intent-filter"] = activity["intent-filter"] ?? [];
  const hasFilter = activity["intent-filter"].some((f) => (f.action ?? []).some((a) => a.$["android:name"] === USB_ATTACHED));
  if (!hasFilter) activity["intent-filter"].push({ action: [{ $: { "android:name": USB_ATTACHED } }] });
  activity["meta-data"] = (activity["meta-data"] ?? []).filter((m) => m.$["android:name"] !== USB_ATTACHED);
  activity["meta-data"].push({ $: { "android:name": USB_ATTACHED, "android:resource": "@xml/accessory_filter" } });
  return manifest;
}

/** Any DJI USB accessory (the RC-N2 and other DJI controllers). */
const ACCESSORY_FILTER_XML = `<?xml version="1.0" encoding="utf-8"?>
<resources>
  <usb-accessory manufacturer="DJI" />
</resources>
`;

/** The App Key from the environment. Checked but never printed. */
function readApiKey(env) {
  const key = (env.DJI_API_KEY ?? "").trim();
  if (!key) {
    throw new Error(
      "withDji: DJI_API_KEY is not set. Put it in apps/flight/.env (see .env.example). Never commit the key.",
    );
  }
  return key;
}

module.exports = { addDjiToMainApplication, addDjiToManifest, ACCESSORY_FILTER_XML, readApiKey };
