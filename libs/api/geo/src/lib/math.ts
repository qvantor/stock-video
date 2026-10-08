const R = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** Great-circle distance in metres. */
export const haversineM = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
};

/** Initial bearing from point 1 to point 2, degrees clockwise from north (0..360). */
export const bearingDeg = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const y = Math.sin(rad(lon2 - lon1)) * Math.cos(rad(lat2));
  const x =
    Math.cos(rad(lat1)) * Math.sin(rad(lat2)) -
    Math.sin(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(rad(lon2 - lon1));
  return (deg(Math.atan2(y, x)) + 360) % 360;
};

/** Smallest absolute angle between two headings. */
export const angleDiff = (a: number, b: number): number => {
  const d = Math.abs((((a - b) % 360) + 360) % 360);
  return d > 180 ? 360 - d : d;
};

export interface CameraPose {
  /** Heading of the camera, degrees clockwise from north. */
  yawDeg: number;
  /** Gimbal pitch, degrees (0 = horizon, -90 = straight down). */
  pitchDeg?: number | null;
  /** Height above the ground, metres. */
  heightM?: number | null;
}

/** Horizontal field of view of a typical drone camera (24 mm equivalent ≈ 84°). */
export const DEFAULT_HFOV_DEG = 84;

/**
 * Whether a target is inside the camera's view: within ±HFOV/2 of the yaw and, when the gimbal
 * pitch and height are known, not closer than where the bottom of the frame hits the ground.
 * Pointing straight down (≤ -80°) everything near the drone is in view.
 */
export const inCameraSector = (
  pose: CameraPose,
  target: { bearingDeg: number; distanceM: number },
  hfovDeg = DEFAULT_HFOV_DEG,
): boolean => {
  const pitch = pose.pitchDeg ?? null;
  if (pitch !== null && pitch <= -80)
    return target.distanceM <= Math.max(150, (pose.heightM ?? 100) * 1.5);
  if (angleDiff(pose.yawDeg, target.bearingDeg) > hfovDeg / 2) return false;
  if (pitch !== null && pose.heightM && pitch < 0) {
    // Vertical FOV ≈ 0.6 × HFOV for 16:9; the far edge of the frame is (pitch + vfov/2) below the horizon.
    const vHalf = (hfovDeg * 0.6) / 2;
    const nearAngle = -pitch + vHalf;
    const nearM = nearAngle >= 90 ? 0 : pose.heightM / Math.tan(rad(nearAngle));
    if (target.distanceM < nearM * 0.8) return false;
  }
  return true;
};

/** Snap coordinates to a ~50 m grid so nearby clips share cache entries. */
export const gridKey = (
  lat: number,
  lon: number,
  stepM = 50,
): { lat: number; lon: number; key: string } => {
  const latStep = stepM / 111_320;
  const glat = Math.round(lat / latStep) * latStep;
  const lonStep = latStep / Math.max(0.01, Math.cos(rad(glat)));
  const glon = Math.round(lon / lonStep) * lonStep;
  const r = (v: number) => Number(v.toFixed(5));
  return { lat: r(glat), lon: r(glon), key: `${r(glat).toFixed(5)},${r(glon).toFixed(5)}` };
};
