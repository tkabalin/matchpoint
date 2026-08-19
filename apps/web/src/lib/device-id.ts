const STORAGE_KEY = "matchpoint:device-id";

/**
 * Names this installed app instance to the server: the holder of a match's capture
 * claim, and the sender of every point batch. It names the installation, not the
 * coach, so a purge on sign-out or a coach switch must leave it in place.
 */
export function getDeviceId(): string {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored !== null) return stored;

  const minted = crypto.randomUUID();
  localStorage.setItem(STORAGE_KEY, minted);
  return minted;
}
