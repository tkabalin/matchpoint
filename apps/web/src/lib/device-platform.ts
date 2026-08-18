export type DevicePlatform = "ios" | "android" | "other";

/**
 * Which install instructions to show (#130). iPadOS 13+ reports itself as a Mac in
 * its user agent, distinguished only by touch support, so that case is checked
 * separately from the plain iPhone/iPod check.
 */
export function detectPlatform(
  userAgent = navigator.userAgent,
  maxTouchPoints = navigator.maxTouchPoints,
): DevicePlatform {
  if (/iPad|iPhone|iPod/.test(userAgent)) return "ios";
  if (userAgent.includes("Macintosh") && maxTouchPoints > 1) return "ios";
  if (/Android/.test(userAgent)) return "android";
  return "other";
}

/** True once the app is already running installed, on either platform's own check. */
export function isRunningInstalled(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia("(display-mode: standalone)").matches || nav.standalone === true;
}
