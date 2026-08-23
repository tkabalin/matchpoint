const STORAGE_KEY = "matchpoint:last-viewed-player";

interface StoredLastViewed {
  playerId: string;
  viewedAt: number;
}

// Malformed or pre-timestamp (plain-string) storage from an older build reads
// as null here rather than throwing — same "quietly drop the card" handling
// as a stale player id below.
function read(): StoredLastViewed | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredLastViewed;
  } catch {
    return null;
  }
}

export function getLastViewedPlayerId(): string | null {
  return read()?.playerId ?? null;
}

export function getLastViewedAt(): number | null {
  return read()?.viewedAt ?? null;
}

export function setLastViewedPlayerId(playerId: string): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ playerId, viewedAt: Date.now() }));
}

/** Only `purgeLocalData` calls this: the id names one coach's player, so it is theirs
 * to leave behind when the device stops being theirs. */
export function clearLastViewedPlayerId(): void {
  localStorage.removeItem(STORAGE_KEY);
}
