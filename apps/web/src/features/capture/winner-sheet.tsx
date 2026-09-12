/**
 * "Who won the point?" — the one question a point can never go without.
 *
 * Asked wherever the coach stops short of a full capture: the header's skip records a
 * point winner-only, and the final ball screen's "didn't see" records one whose ending went
 * unwatched. Both need the same two taps and the same wording, which is why the sheet
 * is shared rather than written twice.
 */

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

export function WinnerSheet({
  open,
  description,
  trackedPlayerName,
  opponentName,
  onPick,
  onEditScore,
  onOpenChange,
}: {
  open: boolean;
  description: string;
  trackedPlayerName: string;
  opponentName: string;
  onPick: (won: boolean) => void;
  // Where a coach goes when the gap is bigger than the one point this sheet records.
  onEditScore?: () => void;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="mx-auto max-w-md gap-4 rounded-t-sm p-5">
        <SheetHeader className="p-0">
          <SheetTitle>Who won the point?</SheetTitle>
        </SheetHeader>
        <p className="text-sm text-muted-foreground">{description}</p>
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="ghost"
            onClick={() => {
              onPick(true);
            }}
            className="h-[76px] flex-col gap-1 border-court/30 bg-court/10 hover:bg-court/20"
          >
            <span className="text-base font-semibold text-court">Win</span>
            <span className="text-xs text-muted-foreground">Point to {trackedPlayerName}</span>
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              onPick(false);
            }}
            className="h-[76px] flex-col gap-1 border-destructive/30 bg-destructive/10 hover:bg-destructive/20"
          >
            <span className="text-base font-semibold text-destructive">Loss</span>
            <span className="text-xs text-muted-foreground">Point to {opponentName}</span>
          </Button>
        </div>
        {onEditScore !== undefined && (
          <Button variant="ghost" onClick={onEditScore} className="h-11 w-full text-sm">
            Missed more than one point? Set the score
          </Button>
        )}
      </SheetContent>
    </Sheet>
  );
}
