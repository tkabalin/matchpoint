import type { ComponentType } from "react";

import { cn } from "@/lib/utils";

/**
 * The wireframe's hero shape: an icon, a big number, a small label beside it —
 * no progress track, no baseline, no delta. `BulletBar` is a different, richer
 * shape (used elsewhere for metrics that need a track/comparison); this is what
 * every stats-screen hero in the wireframe actually draws. Sizing (`size-9`
 * icon, `text-3xl` value) matches what its two real call sites — the Serve
 * tab's per-side hero and the Rally tab's Point-enders hero — had already
 * converged on independently before this component existed to enforce it.
 */
export function StatHero({
  icon: Icon,
  value,
  label,
  className,
}: {
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" | "false" }>;
  value: string;
  label: string;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <Icon className="size-9 shrink-0 text-primary" aria-hidden="true" />
      <div className="flex items-baseline gap-1.5">
        <span className="text-3xl font-bold tabular-nums">{value}</span>
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
    </div>
  );
}
