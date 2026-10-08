// Lets the app import flight-core and garden-core straight from packages/.
const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
config.watchFolders = [path.resolve(__dirname, "../../packages/flight-core"), path.resolve(__dirname, "../../packages/garden-core")];
module.exports = config;
