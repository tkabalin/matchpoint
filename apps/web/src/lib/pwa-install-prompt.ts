const STORAGE_KEY = "matchpoint:install-prompt-dismissed";

export function hasDismissedInstallPrompt(): boolean {
  return localStorage.getItem(STORAGE_KEY) !== null;
}

export function dismissInstallPrompt(): void {
  localStorage.setItem(STORAGE_KEY, "true");
}
