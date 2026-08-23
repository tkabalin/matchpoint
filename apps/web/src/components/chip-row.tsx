import { cn } from "@/lib/utils";

/** A row of pill-shaped single-select buttons — promoted out of the player
 *  stats scope panel now that the per-match stats page is a second caller. */
export function ChipRow<T extends string>({
  options,
  value,
  onChange,
  scroll,
  "aria-label": ariaLabel,
}: {
  options: { value: T; label: string }[];
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
            "shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium whitespace-nowrap",
            value === option.value
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border bg-transparent text-muted-foreground",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
