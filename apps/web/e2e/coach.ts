import { fileURLToPath } from "node:url";

// The coach the signed-in specs run as. auth.setup.ts signs this one up against the live
// API and saves the session it earns here; a spec joins it with
// `test.use({ storageState: COACH_STORAGE_STATE })`.
export const COACH_STORAGE_STATE = fileURLToPath(new URL(".auth/coach.json", import.meta.url));

// Shared because the app shows it back: /home greets the coach by name, so a spec that
// hardcoded one would be asserting against whatever the setup happened to type.
export const COACH_DISPLAY_NAME = "E2E Coach";
