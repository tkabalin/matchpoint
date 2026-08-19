const STORAGE_KEY = "matchpoint:photo-reminder-dismissed";

export function hasDismissedPhotoReminder(): boolean {
  return localStorage.getItem(STORAGE_KEY) !== null;
}

export function dismissPhotoReminder(): void {
  localStorage.setItem(STORAGE_KEY, "true");
}
