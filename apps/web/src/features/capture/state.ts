import { create } from "zustand";

/**
 * In-match capture state.
 *
 * This module — and everything else under `features/capture/` — is a network-free
 * zone: the capture path must never await I/O. ESLint enforces that at the root
 * config; see the `features/capture` block in `eslint.config.mjs`.
 */
interface CaptureState {
  pointsRecorded: number;
}

export const useCaptureStore = create<CaptureState>(() => ({
  pointsRecorded: 0,
}));
