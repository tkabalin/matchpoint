import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { LucideIcon } from "lucide-react";
import { Brain, Compass, Dumbbell, NotebookPen, Plus, Trash2, Wrench } from "lucide-react";
import { useState } from "react";

import { StatCard } from "@/components/stat-card";
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
import { Textarea } from "@/components/ui/textarea";
import { listCoachNotesOptions } from "@/lib/analytics/analytics-options";
import type { CoachNote } from "@/lib/analytics/types.provisional";
import { cn } from "@/lib/utils";

// A large, unique icon per theme instead of a colored tag — text on a colored
// background is illegible at this size, an icon isn't. Not from the palette
// rule's swatch set on purpose: these mark a category on a note's own card,
// not a chart or a legend, so there's no fill to pattern-match against.
const THEME_ICON: Record<string, LucideIcon> = {
  technical: Wrench,
  mental: Brain,
  physical: Dumbbell,
  tactical: Compass,
};

function todayIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

/**
 * Coach notes, behind a sheet rather than their own tab: replacing the old
 * Notes tab this way keeps the already-long Serve/Rally page from growing
 * further, and matches the `Sheet` pattern `EditPlayerSheet` already
 * establishes for on-demand content that isn't part of the main scroll.
 *
 * Quick note writes straight into the query cache — there's no notes-write
 * endpoint yet (see `lib/analytics/analytics-options.ts`), and a fixture
 * that only ever renders three sample rows isn't "notes," it's a mockup a
 * coach can't actually use during a session.
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
  const queryClient = useQueryClient();
  const notesOptions = listCoachNotesOptions({ path: { player_id: playerId } });
  const { data, isPending } = useQuery(notesOptions);
  const notes = data ?? [];

  const [composing, setComposing] = useState(false);
  const [draftBody, setDraftBody] = useState("");
  const [draftTags, setDraftTags] = useState<string[]>([]);
  // Which note (if any) is mid-delete-confirmation — only one at a time, and
  // it resets whenever the sheet closes below.
  const [deletingId, setDeletingId] = useState<string | null>(null);

  function deleteNote(id: string) {
    queryClient.setQueryData<CoachNote[]>(notesOptions.queryKey, (previous) =>
      (previous ?? []).filter((existing) => existing.id !== id),
    );
    setDeletingId(null);
  }

  // Closing mid-compose or mid-delete-confirm shouldn't leave that state
  // waiting for the next time the sheet opens.
  function handleOpenChange(next: boolean) {
    if (!next) {
      setComposing(false);
      setDraftBody("");
      setDraftTags([]);
      setDeletingId(null);
    }
    onOpenChange(next);
  }

  function toggleTag(tag: string) {
    setDraftTags((tags) => (tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag]));
  }

  function saveNote() {
    const body = draftBody.trim();
    if (!body) return;

    const note: CoachNote = {
      id: crypto.randomUUID(),
      body,
      tags: draftTags,
      recordedOn: todayIso(),
      context: null,
      linkedMatchId: null,
    };
    queryClient.setQueryData<CoachNote[]>(notesOptions.queryKey, (previous) => [
      note,
      ...(previous ?? []),
    ]);

    setComposing(false);
    setDraftBody("");
    setDraftTags([]);
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent side="bottom" className="mx-auto max-w-md gap-4 rounded-t-sm p-5">
        <SheetHeader className="p-0">
          <SheetTitle>Notes</SheetTitle>
        </SheetHeader>

        <div className="flex flex-col gap-3">
          {isPending ? (
            <Skeleton className="h-64 w-full" />
          ) : notes.length === 0 && !composing ? (
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
            notes.map((note) => (
              <NoteCard
                key={note.id}
                note={note}
                confirmingDelete={deletingId === note.id}
                onRequestDelete={() => setDeletingId(note.id)}
                onCancelDelete={() => setDeletingId(null)}
                onConfirmDelete={() => deleteNote(note.id)}
              />
            ))
          )}

          {composing ? (
            <StatCard>
              <Textarea
                autoFocus
                placeholder="What did you notice?"
                value={draftBody}
                onChange={(event) => setDraftBody(event.target.value)}
              />
              <div className="flex flex-wrap gap-2">
                {Object.entries(THEME_ICON).map(([tag, Icon]) => {
                  const selected = draftTags.includes(tag);
                  return (
                    <button
                      key={tag}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => toggleTag(tag)}
                      className={cn(
                        "flex flex-col items-center gap-1 rounded-sm border p-2",
                        selected ? "border-primary bg-primary/5" : "border-border",
                      )}
                    >
                      <Icon
                        className={cn("size-6", selected ? "text-primary" : "text-foreground")}
                        aria-hidden="true"
                      />
                      <span className="text-[0.5625rem] capitalize">{tag}</span>
                    </button>
                  );
                })}
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1"
                  onClick={() => setComposing(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  className="flex-1"
                  disabled={!draftBody.trim()}
                  onClick={saveNote}
                >
                  Save note
                </Button>
              </div>
            </StatCard>
          ) : (
            <Button type="button" className="w-full" onClick={() => setComposing(true)}>
              <Plus />
              Quick note
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function NoteCard({
  note,
  confirmingDelete,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
}: {
  note: CoachNote;
  confirmingDelete: boolean;
  onRequestDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
}) {
  const meta = [formatRecordedOn(note.recordedOn), note.context].filter(Boolean).join(" · ");

  return (
    <StatCard>
      <div className="flex gap-3">
        <div className="flex shrink-0 -space-x-2">
          {note.tags.map((tag) => {
            const Icon = THEME_ICON[tag];
            if (!Icon) return null;
            return (
              <span
                key={tag}
                title={tag}
                className="flex size-9 items-center justify-center rounded-full border-2 border-card bg-muted"
              >
                <Icon className="size-5 text-foreground" aria-hidden="true" />
              </span>
            );
          })}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs leading-relaxed">{note.body}</p>
          <p className="mt-1 text-[0.625rem] text-muted-foreground">{meta}</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Delete note"
          onClick={onRequestDelete}
        >
          <Trash2 />
        </Button>
      </div>

      {confirmingDelete && (
        <div className="flex items-center justify-between gap-2 border-t pt-2">
          <p className="text-xs text-muted-foreground">Delete this note?</p>
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onCancelDelete}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" size="sm" onClick={onConfirmDelete}>
              Delete
            </Button>
          </div>
        </div>
      )}
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
