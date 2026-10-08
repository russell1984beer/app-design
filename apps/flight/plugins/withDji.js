// Expo config plugin: wires the DJI SDK into the generated Android project on `expo prebuild`.
const fs = require("fs");
const path = require("path");
const { withAndroidManifest, withMainApplication, withDangerousMod } = require("expo/config-plugins");
const { addDjiToMainApplication, addDjiToManifest, ACCESSORY_FILTER_XML, readApiKey } = require("./dji-mods");

function withDji(config) {
  const apiKey = readApiKey(process.env);

  config = withAndroidManifest(config, (c) => {
    c.modResults = addDjiToManifest(c.modResults, apiKey);
    return c;
  });

  config = withMainApplication(config, (c) => {
    if (c.modResults.language !== "kt") throw new Error("withDji: expected a Kotlin MainApplication");
    c.modResults.contents = addDjiToMainApplication(c.modResults.contents);
    return c;
  });

  config = withDangerousMod(config, [
    "android",
    async (c) => {
      const dir = path.join(c.modRequest.platformProjectRoot, "app", "src", "main", "res", "xml");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "accessory_filter.xml"), ACCESSORY_FILTER_XML);
      return c;
    },
  ]);

  return config;
}

module.exports = withDji;
