import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";

import { DateField } from "./date-field";

// react-day-picker's own day-button aria-label, e.g. "Monday, August 10th,
// 2026" - `toLocaleDateString` has no ordinal-suffix option, so the day
// number is built by hand to match it exactly.
function dayAriaLabel(date: Date): string {
  const day = date.getDate();
  const suffix =
    day % 10 === 1 && day !== 11
      ? "st"
      : day % 10 === 2 && day !== 12
        ? "nd"
        : day % 10 === 3 && day !== 13
          ? "rd"
          : "th";
  const weekday = date.toLocaleDateString("en-US", { weekday: "long" });
  const month = date.toLocaleDateString("en-US", { month: "long" });
  return `${weekday}, ${month} ${day}${suffix}, ${date.getFullYear()}`;
}

// The calendar opens on today's month with no value set, so reaching an
// arbitrary target date means navigating there first. Computed against the
// real current date rather than a faked one - Base UI's Popover open
// transition depends on a real timer, which `vi.useFakeTimers()` stalls
// indefinitely rather than letting the popover's content ever actually
// mount, so this avoids that entirely instead of fighting it.
async function openAndPickDate(user: ReturnType<typeof userEvent.setup>, target: Date) {
  await user.click(screen.getByRole("button", { name: "From" }));
  const today = new Date();
  const monthsAway =
    (target.getFullYear() - today.getFullYear()) * 12 + (target.getMonth() - today.getMonth());
  const navLabel = monthsAway < 0 ? "Go to the Previous Month" : "Go to the Next Month";
  for (let step = 0; step < Math.abs(monthsAway); step++) {
    await user.click(await screen.findByRole("button", { name: navLabel }));
  }
  await user.click(await screen.findByRole("button", { name: dayAriaLabel(target) }));
}

test("shows the yyyy/mm/dd placeholder when no date is set", () => {
  render(<DateField value="" onChange={() => {}} aria-label="From" />);

  expect(screen.getByRole("button", { name: "From" })).toHaveTextContent("yyyy/mm/dd");
});

test("shows the chosen date in yyyy/mm/dd, not the native mm/dd/yyyy", () => {
  render(<DateField value="2026-08-10" onChange={() => {}} aria-label="From" />);

  expect(screen.getByRole("button", { name: "From" })).toHaveTextContent("2026/08/10");
});

test("opens a calendar rather than a native date picker, and picking a day reports it in yyyy-mm-dd", async () => {
  const user = userEvent.setup({ delay: null });
  const onChange = (value: string) => {
    picked = value;
  };
  let picked: string | undefined;
  const target = new Date(2026, 7, 10);

  render(<DateField value="" onChange={onChange} aria-label="From" />);
  await openAndPickDate(user, target);

  expect(picked).toBe("2026-08-10");
});

test("reopening on an already-chosen date lands the calendar on that date's month, not today's", async () => {
  const user = userEvent.setup({ delay: null });
  const target = new Date(2026, 7, 10);

  render(<DateField value="2026-08-10" onChange={() => {}} aria-label="From" />);
  await user.click(screen.getByRole("button", { name: "From" }));

  // If the calendar had opened on "today"'s month instead of the field's own
  // August value, this day wouldn't be in the currently-shown month at all,
  // and no further navigation happens in this test to reach it. A regex,
  // not the plain label: the already-selected day's own aria-label carries
  // a trailing ", selected" react-day-picker adds only to that one cell.
  expect(
    await screen.findByRole("button", { name: new RegExp(dayAriaLabel(target)) }),
  ).toBeInTheDocument();
});
