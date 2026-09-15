import { CircleDot, Repeat2 } from "lucide-react";
import type { ComponentType } from "react";

import { cn } from "@/lib/utils";

type ServeRallyTab = "serve" | "rally";

/**
 * The Serve/Rally switch under the surface record card — identical at all three
 * call sites (`player-profile.tsx`, `player-self-view.tsx`, `match-stats-page.tsx`),
 * so it's its own component rather than three copies of the same options array.
 *
 * Deliberately not built on `SegmentedControl`/`ToggleGroupItem`: those bake in a
 * muted `data-[state=on]:bg-muted` active state shared by every other either/or
 * switch in the app (surface, format, trend window), and this one needed a louder,
 * more clearly-interactive active state without touching that shared default
 * everywhere else. Primary blue is the right color for it — `.claude/rules/
 * web-color.md` reserves blue for exactly "navigation bars, active tabs, and
 * interactive state", which a tab switch literally is.
 */
export function ServeRallyToggle({
  value,
  onValueChange,
}: {
  value: ServeRallyTab;
  onValueChange: (value: ServeRallyTab) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Serve or rally"
      className="flex w-full overflow-hidden rounded-sm border"
    >
      <ToggleButton
        active={value === "serve"}
        icon={CircleDot}
        label="Serve"
        onClick={() => onValueChange("serve")}
      />
      <ToggleButton
        active={value === "rally"}
        icon={Repeat2}
        label="Rally"
        onClick={() => onValueChange("rally")}
        className="border-l"
      />
    </div>
  );
}

function ToggleButton({
  active,
  icon: Icon,
  label,
  onClick,
  className,
}: {
  active: boolean;
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" | "false" }>;
  label: string;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex flex-1 items-center justify-center gap-1.5 px-3 py-2 text-sm font-bold transition-colors",
        active
          ? "bg-primary text-primary-foreground"
          : "bg-transparent text-muted-foreground hover:bg-muted",
        className,
      )}
    >
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      {label}
    </button>
  );
}
