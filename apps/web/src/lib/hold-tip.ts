// One-time "did you know you can hold this" hints — back, skip and the note button
// each get their own key, so seeing one doesn't mark the others seen.
const STORAGE_PREFIX = "matchpoint:hold-tip-seen:";

export function hasSeenHoldTip(key: string): boolean {
  return localStorage.getItem(STORAGE_PREFIX + key) !== null;
}

export function markHoldTipSeen(key: string): void {
  localStorage.setItem(STORAGE_PREFIX + key, "true");
}
