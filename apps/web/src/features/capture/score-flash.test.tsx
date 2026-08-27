import { act, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { ScoreFlash } from "./score-flash";

afterEach(() => {
  vi.useRealTimers();
});

test.each([
  ["point", true, "Point won"],
  ["point", false, "Point lost"],
  ["game", true, "Game won"],
  ["game", false, "Game lost"],
  ["set", true, "Set won"],
  ["set", false, "Set lost"],
] as const)("a %s won=%s flashes %s", (level, won, expected) => {
  render(<ScoreFlash level={level} won={won} onDone={vi.fn()} />);

  expect(screen.getByRole("status")).toHaveTextContent(expected);
});

test("it clears itself, and never blocks the screen it covers", () => {
  vi.useFakeTimers();
  const onDone = vi.fn();
  render(<ScoreFlash level="point" won onDone={onDone} />);

  // The next point is being tapped underneath this, so nothing here may take the tap.
  expect(screen.getByRole("status").parentElement).toHaveClass("pointer-events-none");
  expect(onDone).not.toHaveBeenCalled();

  act(() => {
    vi.advanceTimersByTime(900);
  });

  expect(onDone).toHaveBeenCalledOnce();
});

test("a game holds longer than a point", () => {
  vi.useFakeTimers();
  const onDone = vi.fn();
  render(<ScoreFlash level="game" won onDone={onDone} />);

  act(() => {
    vi.advanceTimersByTime(900);
  });
  expect(onDone).not.toHaveBeenCalled();

  act(() => {
    vi.advanceTimersByTime(500);
  });
  expect(onDone).toHaveBeenCalledOnce();
});

test("a re-render doesn't restart the timer", () => {
  vi.useFakeTimers();
  const onDone = vi.fn();
  const { rerender } = render(<ScoreFlash level="point" won onDone={onDone} />);

  act(() => {
    vi.advanceTimersByTime(600);
  });
  rerender(<ScoreFlash level="point" won onDone={onDone} />);
  act(() => {
    vi.advanceTimersByTime(300);
  });

  expect(onDone).toHaveBeenCalledOnce();
});
