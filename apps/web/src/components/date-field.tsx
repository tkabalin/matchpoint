import { CalendarIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/** `yyyy-mm-dd` (matches `filters.from`/`to`'s own ISO shape, and sorts and
 *  compares the same way `match.played_on` does) to `yyyy/mm/dd` for display
 *  — slashes, not dashes, so it reads as a date and not a stray ID. */
function formatIso(value: string): string {
  return value.replaceAll("-", "/");
}

// `new Date("yyyy-mm-dd")` parses as UTC midnight, which shows as the
// previous local day east of UTC (.claude/rules/web.md) — the same bug this
// field exists to let a coach avoid picking by hand, so it can't commit it
// itself converting back and forth. The multi-argument form always resolves
// to local midnight, both directions.
function parseIso(value: string): Date | undefined {
  if (!value) return undefined;
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year!, month! - 1, day!);
}

function toIso(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * A native `<input type="date">` replacement for the matches filter's From/To
 * range (#300): the native control's own placeholder, calendar-icon affordance
 * and even its rendered width are browser chrome, not CSS this app controls,
 * and they disagree sharply between desktop Chromium (a "mm/dd/yyyy" hint and
 * a visible icon) and mobile WebKit (neither, plus a wider intrinsic size that
 * overlapped the From/To pair in the filter's two-column grid). A button
 * opening a `Calendar` in a `Popover` is fully custom-rendered DOM instead,
 * so it looks and sizes identically everywhere — the same reasoning every
 * other control in this app already follows rather than leaning on native
 * chrome (`.claude/rules/web-shadcn-defaults.md`).
 */
export function DateField({
  id,
  value,
  onChange,
  "aria-label": ariaLabel,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  "aria-label"?: string;
}) {
  const selected = parseIso(value);

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            id={id}
            type="button"
            variant="outline"
            aria-label={ariaLabel}
            className="w-full justify-between font-normal"
          />
        }
      >
        <span className={value ? undefined : "text-muted-foreground"}>
          {value ? formatIso(value) : "yyyy/mm/dd"}
        </span>
        <CalendarIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected}
          onSelect={(date) => onChange(date ? toIso(date) : "")}
          autoFocus
        />
      </PopoverContent>
    </Popover>
  );
}
