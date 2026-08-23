import { useQuery } from "@tanstack/react-query";
import { Mic, NotebookPen } from "lucide-react";

import { StatCard } from "@/components/stat-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { listCoachNotesOptions } from "@/lib/analytics/analytics-options";
import type { CoachNote } from "@/lib/analytics/types.provisional";
import { PATTERN_CLASS, PATTERN_TEXT_CLASS, type CategoryName } from "@/lib/palette";
import { cn } from "@/lib/utils";

// Tag colours come from the safe non-outcome set — a note's theme is a category,
// not a point outcome (.claude/rules/web-color.md).
const THEME_PATTERN: Record<string, CategoryName> = {
  technical: "indigo",
  mental: "yellow",
  physical: "violet",
  tactical: "indigo",
};

/**
 * Coach notes, behind a sheet rather than their own tab: replacing the old
 * Notes tab this way keeps the already-long Serve/Rally page from growing
 * further, and matches the `Sheet` pattern `EditPlayerSheet` already
 * establishes for on-demand content that isn't part of the main scroll.
 */
export function PlayerNotesSheet({
  playerId,
  open,
  onOpenChange,
}: {
  playerId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data, isPending } = useQuery(listCoachNotesOptions({ path: { player_id: playerId } }));
  const notes = data ?? [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="mx-auto max-w-md gap-4 rounded-t-sm p-5">
        <SheetHeader className="p-0">
          <SheetTitle>Notes</SheetTitle>
        </SheetHeader>

        <div className="flex flex-col gap-3">
          {isPending ? (
            <Skeleton className="h-64 w-full" />
          ) : notes.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <NotebookPen />
                </EmptyMedia>
                <EmptyTitle>No notes yet</EmptyTitle>
                <EmptyDescription>
                  Add one after your next session and it&rsquo;ll show up here.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            notes.map((note) => <NoteCard key={note.id} note={note} />)
          )}

          {/* Disabled until notes have an endpoint to write to — see
              lib/analytics/analytics-options.ts. */}
          <Button disabled className="w-full">
            <Mic />
            Quick note
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function NoteCard({ note }: { note: CoachNote }) {
  const meta = [formatRecordedOn(note.recordedOn), note.context].filter(Boolean).join(" · ");

  return (
    <StatCard>
      <p className="text-xs leading-relaxed">{note.body}</p>
      <div className="flex flex-wrap gap-1.5">
        {note.tags.map((tag) => {
          const pattern = THEME_PATTERN[tag];
          return (
            <Badge
              key={tag}
              variant="outline"
              className={cn(
                pattern && [
                  "swatch-halo border-transparent",
                  PATTERN_CLASS[pattern],
                  PATTERN_TEXT_CLASS[pattern],
                ],
              )}
            >
              {tag}
            </Badge>
          );
        })}
      </div>
      <p className="text-[0.625rem] text-muted-foreground">{meta}</p>
    </StatCard>
  );
}

// `recordedOn` is a plain calendar date; see .claude/rules/web.md.
function formatRecordedOn(recordedOn: string): string {
  const [year, month, day] = recordedOn.split("-").map(Number);
  return new Date(year!, month! - 1, day!).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
