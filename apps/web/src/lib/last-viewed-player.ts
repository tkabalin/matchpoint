const STORAGE_KEY = "matchpoint:last-viewed-player";

export function getLastViewedPlayerId(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}

export function setLastViewedPlayerId(playerId: string): void {
  localStorage.setItem(STORAGE_KEY, playerId);
}
