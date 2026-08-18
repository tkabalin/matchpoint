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
  className,
  ...props
}: {
  value: T;
  onValueChange: (value: T) => void;
  options: { value: T; label: string }[];
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <ToggleGroup
      variant="outline"
      spacing={0}
      value={[value]}
      // Base UI clears the array when the active item is pressed again; a segmented
      // control has no "none" state, so an empty change is ignored rather than
      // leaving the group with nothing selected.
      onValueChange={(next: unknown[]) => {
        const selected = next[0] as T | undefined;
        if (selected !== undefined) onValueChange(selected);
      }}
      className={cn("w-full", className)}
      {...props}
    >
      {options.map((option) => (
        <ToggleGroupItem key={option.value} value={option.value} className="flex-1">
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
