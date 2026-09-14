const STORAGE_KEY = "matchpoint:note-hold-tip-seen";

export function hasSeenNoteHoldTip(): boolean {
  return localStorage.getItem(STORAGE_KEY) !== null;
}

export function markNoteHoldTipSeen(): void {
  localStorage.setItem(STORAGE_KEY, "true");
}
