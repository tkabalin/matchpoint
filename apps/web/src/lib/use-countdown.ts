import { useEffect, useState } from "react";

/**
 * Ticks a Retry-After-style second count down to 0, one second at a time. Feed it a
 * fresh value each time a 429 arrives (see getRetryAfterSeconds in parse-error.ts) —
 * it doesn't guess at anything, just counts down whatever it was given.
 */
export function useCountdown(seconds: number | null): number | null {
  // Resetting on a prop change belongs at render time, not in an effect body — see
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes.
  const [trackedSeconds, setTrackedSeconds] = useState(seconds);
  const [remaining, setRemaining] = useState(seconds);

  if (seconds !== trackedSeconds) {
    setTrackedSeconds(seconds);
    setRemaining(seconds);
  }

  useEffect(() => {
    if (seconds === null || seconds <= 0) return;

    const interval = setInterval(() => {
      setRemaining((current) => (current === null || current <= 1 ? 0 : current - 1));
    }, 1000);

    return () => clearInterval(interval);
  }, [seconds]);

  return remaining;
}
