import { Progress as ProgressPrimitive } from "@base-ui/react/progress";

import { cn } from "@/lib/utils";

function Progress({ className, children, value, ...props }: ProgressPrimitive.Root.Props) {
  return (
    <ProgressPrimitive.Root
      value={value}
      data-slot="progress"
      className={cn("flex flex-wrap gap-3", className)}
      {...props}
    >
      {children}
      <ProgressTrack>
        <ProgressIndicator className="bg-primary" />
      </ProgressTrack>
    </ProgressPrimitive.Root>
  );
}

function ProgressTrack({ className, ...props }: ProgressPrimitive.Track.Props) {
  return (
    <ProgressPrimitive.Track
      className={cn(
        "relative flex h-3 w-full items-center overflow-x-hidden rounded-full bg-muted",
        className,
      )}
      data-slot="progress-track"
      {...props}
    />
  );
}

// The fill colour is deliberately not defaulted here. It used to be `bg-primary`,
// which silently beat the `pattern-*` utilities callers pass in: both set
// background-color, and tailwind-merge can't collapse them because it doesn't know
// `pattern-*` is a background utility, so CSS source order decided the winner.
// Callers set their own fill; `Progress` supplies the primary one for the plain case.
function ProgressIndicator({ className, ...props }: ProgressPrimitive.Indicator.Props) {
  return (
    <ProgressPrimitive.Indicator
      data-slot="progress-indicator"
      className={cn("h-full transition-all", className)}
      {...props}
    />
  );
}

function ProgressLabel({ className, ...props }: ProgressPrimitive.Label.Props) {
  return (
    <ProgressPrimitive.Label
      className={cn("text-sm font-medium", className)}
      data-slot="progress-label"
      {...props}
    />
  );
}

function ProgressValue({ className, ...props }: ProgressPrimitive.Value.Props) {
  return (
    <ProgressPrimitive.Value
      className={cn("ml-auto text-sm text-muted-foreground tabular-nums", className)}
      data-slot="progress-value"
      {...props}
    />
  );
}

// Re-exported so callers that need to put something else inside the track (a
// baseline marker, a second segment) can compose Root/Track/Indicator themselves
// instead of importing the Base UI primitive outside components/ui.
const ProgressRoot = ProgressPrimitive.Root;

export { Progress, ProgressRoot, ProgressTrack, ProgressIndicator, ProgressLabel, ProgressValue };
