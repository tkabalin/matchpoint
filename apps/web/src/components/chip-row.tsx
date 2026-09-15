import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/** A row of pill-shaped single-select buttons, promoted out of the player
 *  stats scope panel now that the per-match stats page is a second caller.
 *  An option's `icon` is optional: the surface and Squad stats metric chips
 *  each carry the icon already assigned to that concept elsewhere in the app
 *  (`.claude/rules/web-icons.md`), so the same concept still reads as the
 *  same icon on the chip that picks it. */
export function ChipRow<T extends string>({
  options,
  value,
  onChange,
  scroll,
  "aria-label": ariaLabel,
}: {
  options: { value: T; label: string; icon?: LucideIcon }[];
  value: T;
  onChange: (value: T) => void;
  scroll?: boolean;
  "aria-label": string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn("flex flex-wrap gap-1.5", scroll && "flex-nowrap overflow-x-auto pb-1")}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          aria-pressed={value === option.value}
          className={cn(
            "flex shrink-0 items-center gap-1 rounded-full border px-3 py-1.5 text-sm font-bold whitespace-nowrap",
            value === option.value
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border bg-transparent text-muted-foreground",
          )}
        >
          {option.icon && <option.icon className="size-4 shrink-0" aria-hidden="true" />}
          {option.label}
        </button>
      ))}
    </div>
  );
}
