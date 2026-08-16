import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { useCountdown } from "./use-countdown";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

test("returns null when given null", () => {
  const { result } = renderHook(() => useCountdown(null));

  expect(result.current).toBeNull();
});

test("returns the initial value immediately", () => {
  const { result } = renderHook(() => useCountdown(45));

  expect(result.current).toBe(45);
});

test("ticks down by one every second", () => {
  const { result } = renderHook(() => useCountdown(3));

  act(() => vi.advanceTimersByTime(1000));
  expect(result.current).toBe(2);

  act(() => vi.advanceTimersByTime(1000));
  expect(result.current).toBe(1);
});

test("stops at zero instead of going negative", () => {
  const { result } = renderHook(() => useCountdown(2));

  act(() => vi.advanceTimersByTime(5000));

  expect(result.current).toBe(0);
});

test("restarts from a new value when given one", () => {
  const { result, rerender } = renderHook(({ seconds }) => useCountdown(seconds), {
    initialProps: { seconds: 10 as number | null },
  });

  act(() => vi.advanceTimersByTime(3000));
  expect(result.current).toBe(7);

  rerender({ seconds: 20 });
  expect(result.current).toBe(20);

  act(() => vi.advanceTimersByTime(1000));
  expect(result.current).toBe(19);
});
