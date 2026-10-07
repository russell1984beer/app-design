import { requireNativeModule } from "expo-modules-core";

import type { DjiDroneNative } from "./DjiDrone.types";

export default requireNativeModule<DjiDroneNative>("DjiDrone");
