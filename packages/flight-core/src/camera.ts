// Camera geometry used to space photos for photogrammetry.

export type CameraSpec = {
  name: string;
  sensorWidthMm: number;
  sensorHeightMm: number;
  focalLengthMm: number;
  imageWidthPx: number;
  imageHeightPx: number;
};

/** DJI Mini 4 Pro main camera (1/1.3" sensor, 24 mm equivalent), 12 MP mode. Approximate figures. */
export const MINI_4_PRO: CameraSpec = {
  name: "DJI Mini 4 Pro",
  sensorWidthMm: 9.6,
  sensorHeightMm: 7.2,
  focalLengthMm: 6.72,
  imageWidthPx: 4032,
  imageHeightPx: 3024,
};

/** Ground area covered by one straight-down photo, metres. Width runs across the image's long side. */
export function footprintM(camera: CameraSpec, altitudeM: number): { width: number; height: number } {
  return {
    width: (camera.sensorWidthMm * altitudeM) / camera.focalLengthMm,
    height: (camera.sensorHeightMm * altitudeM) / camera.focalLengthMm,
  };
}

/** Ground sample distance in centimetres per pixel. */
export function gsdCm(camera: CameraSpec, altitudeM: number): number {
  return (footprintM(camera, altitudeM).width / camera.imageWidthPx) * 100;
}
