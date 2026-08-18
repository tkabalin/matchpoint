const STORAGE_KEY = "matchpoint:last-viewed-player";

export function getLastViewedPlayerId(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}

export function setLastViewedPlayerId(playerId: string): void {
  localStorage.setItem(STORAGE_KEY, playerId);
}

/** Only `purgeLocalData` calls this: the id names one coach's player, so it is theirs
 * to leave behind when the device stops being theirs. */
export function clearLastViewedPlayerId(): void {
  localStorage.removeItem(STORAGE_KEY);
}
