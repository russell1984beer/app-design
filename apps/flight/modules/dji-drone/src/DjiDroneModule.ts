import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo-modules-core";

import type { DjiDroneNative } from "./DjiDrone.types";

/**
 * The drone only flies from Android (DJI's Mobile SDK is Android only). On the iPad, and in the
 * browser preview, this stand-in reports "no drone" and ignores commands, so the survey, design and
 * materials screens still work.
 */
const NO_DRONE: DjiDroneNative = {
  addListener: () => ({ remove() {} }),
  getStatus: () => ({
    registered: false,
    productConnected: false,
    lastKind: null,
    lastMessage: Platform.OS === "android" ? "The drone module is missing from this build." : "Flying is done from the Android phone.",
  }),
  configureFailsafe() {},
  takeOff() {},
  goTo() {},
  setGimbalPitch() {},
  takePhoto() {},
  hover() {},
  returnHome() {},
  land() {},
  enableSimulator: async () => {
    throw new Error("No drone module on this device.");
  },
  disableSimulator: async () => {},
  getFlyZones: async () => {
    throw new Error("No drone module on this device.");
  },
  setSimulatorWind() {},
};

export default requireOptionalNativeModule<DjiDroneNative>("DjiDrone") ?? NO_DRONE;

/** True on the Android phone with the drone module built in. */
export const canFly = Platform.OS === "android" && requireOptionalNativeModule("DjiDrone") != null;
