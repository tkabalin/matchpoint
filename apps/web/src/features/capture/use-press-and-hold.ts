import { useEffect, useRef } from "react";

// Long enough that a deliberate press is unmistakable, short enough to feel like a
// hold rather than a hang. From the design handoff. Exported so a caller animating its
// own hold progress (e.g. a fill bar) times it against this exact value, rather than a
// second, hand-copied number drifting from the timer it's supposed to represent.
export const HOLD_MS = 450;

/**
 * A second action on a capture-header button, reached by holding it rather than by a
 * control of its own: skip's hold opens the score editor, the note button's opens the
 * typed-note sheet. Spread `holdHandlers` onto the button and let its `onClick` ask
 * `consumeHold()` which gesture it is handling.
 */
export function usePressAndHold() {
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Set once the hold has crossed HOLD_MS, so the click that follows the release runs
  // the hold's action rather than the tap's.
  const holdFired = useRef(false);

  useEffect(() => {
    return () => {
      if (holdTimer.current !== null) clearTimeout(holdTimer.current);
    };
  }, []);

  function startHold() {
    holdFired.current = false;
    holdTimer.current = setTimeout(() => {
      holdTimer.current = null;
      holdFired.current = true;
    }, HOLD_MS);
  }

  function cancelHold() {
    if (holdTimer.current !== null) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  }

  // A pointer the browser took away (scroll takeover, palm rejection) produces no
  // click, so the flag it set has nothing left to consume it and would run the hold's
  // action on whatever activation came next.
  function abortHold() {
    cancelHold();
    holdFired.current = false;
  }

  /** Whether this activation came from a hold, clearing the flag either way. */
  function consumeHold() {
    const held = holdFired.current;
    holdFired.current = false;
    return held;
  }

  return {
    holdHandlers: {
      onPointerDown: startHold,
      onPointerUp: cancelHold,
      // Leave clears the timer only: a touch pointer fires `pointerleave` after
      // `pointerup` and before the click, so clearing the flag here would make every
      // hold on a touch screen read as a tap.
      onPointerLeave: cancelHold,
      onPointerCancel: abortHold,
    },
    cancelHold,
    consumeHold,
  };
}
