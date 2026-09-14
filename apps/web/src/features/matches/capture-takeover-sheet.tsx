import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

/**
 * The explicit takeover prompt a claim conflict raises (#197) — another device
 * already holds this match. Same shape and title as `delete-match-sheet.tsx`'s own
 * conflict step, since it's the same concept; the warning here carries the same
 * "unsaved points need that device reconnected" caveat for the same reason.
 */
export function CaptureTakeoverSheet({
  open,
  takingOver,
  error,
  onTakeOver,
  onDecline,
}: {
  open: boolean;
  takingOver: boolean;
  error: string | null;
  onTakeOver: () => void;
  onDecline: () => void;
}) {
  return (
    <Sheet open={open} onOpenChange={(next) => !next && onDecline()}>
      <SheetContent side="bottom" className="mx-auto max-w-md gap-4 rounded-t-sm p-5">
        <SheetHeader className="p-0">
          <SheetTitle>Being captured on another device</SheetTitle>
        </SheetHeader>

        <p className="text-sm text-muted-foreground">
          This match is being captured on another device. Take over on this one? Any points it's
          recorded but hasn't synced yet will need that device reconnected before you finish this
          match here — otherwise they'll be lost.
        </p>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <Button type="button" disabled={takingOver} className="w-full" onClick={onTakeOver}>
          {takingOver ? "Taking over…" : "Take over"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={takingOver}
          className="w-full"
          onClick={onDecline}
        >
          Cancel
        </Button>
      </SheetContent>
    </Sheet>
  );
}
