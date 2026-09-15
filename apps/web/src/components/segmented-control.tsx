import type { LucideIcon } from "lucide-react";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

/**
 * The full-width segmented control the wireframe uses for every either/or switch
 * (surface, format, serving vs. returning, trend window).
 *
 * A thin wrapper over `ToggleGroup` for two reasons: `spacing={0}` plus equal-width
 * items is the look, repeated at every call site, and Base UI's group value is an
 * array even when only one item can be active — every caller here wants a single
 * value, so the array lives in one place rather than six.
 */
export function SegmentedControl<T extends string>({
  value,
  onValueChange,
  options,
  deselectable,
  className,
  ...props
}: {
  value: T;
  onValueChange: (value: T) => void;
  /** `icon`, when given, must be a distinct symbol per option — two options
   *  sharing an icon defeats the point of having one. */
  options: { value: T; label: string; icon?: LucideIcon }[];
  /** Lets the active item be pressed again to clear the choice, for an optional
   *  field whose unpicked state is `""`. Typed so only a value union that
   *  actually includes `""` can ask for it. */
  deselectable?: "" extends T ? boolean : never;
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <ToggleGroup
      variant="outline"
      spacing={0}
      value={[value]}
      // Base UI clears the array when the active item is pressed again. For a
      // required choice that would leave the group with nothing selected, so the
      // empty change is ignored; `deselectable` is how an optional one opts into
      // it, taking the press back to its own unpicked "" state.
      onValueChange={(next: unknown[]) => {
        const selected = next[0] as T | undefined;
        if (selected !== undefined) onValueChange(selected);
        else if (deselectable) onValueChange("" as T);
      }}
      className={cn("w-full", className)}
      {...props}
    >
      {options.map((option) => (
        <ToggleGroupItem key={option.value} value={option.value} className="flex-1 gap-1.5">
          {option.icon && <option.icon className="size-4 shrink-0" aria-hidden="true" />}
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
