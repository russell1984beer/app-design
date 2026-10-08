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
      // The DJI SDK needs its own (newer) C++ runtime; the app's own jniLibs win over the copies in
      // dependencies such as React Native's. See modules/dji-drone/android/libcxx/README.md.
      const libDir = path.join(c.modRequest.platformProjectRoot, "app", "src", "main", "jniLibs", "arm64-v8a");
      fs.mkdirSync(libDir, { recursive: true });
      fs.copyFileSync(path.join(__dirname, "..", "modules", "dji-drone", "android", "libcxx", "arm64-v8a", "libc++_shared.so"), path.join(libDir, "libc++_shared.so"));
      return c;
    },
  ]);

  return config;
}

module.exports = withDji;
