// Lets the app import flight-core straight from packages/flight-core.
const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
config.watchFolders = [path.resolve(__dirname, "../../packages/flight-core")];
module.exports = config;
