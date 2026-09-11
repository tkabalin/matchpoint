import type { PlayerNoteRead } from "@matchpoint/api-client";
import { createPlayerNote, deletePlayerNote, updatePlayerNote } from "@matchpoint/api-client";
import {
  listPlayerNotesOptions,
  listPlayerNotesQueryKey,
} from "@matchpoint/api-client/react-query";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { LucideIcon } from "lucide-react";
import { Brain, Compass, Dumbbell, NotebookPen, Pencil, Plus, Trash2, Wrench } from "lucide-react";
import { useState } from "react";

import { StatCard } from "@/components/stat-card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  blankNoteForm,
  buildNoteUpdateBody,
  NOTE_BODY_MAX,
  NOTE_FOCUS_OPTIONS,
  type NoteFormValues,
  noteFormValuesFrom,
  validateNoteForm,
} from "@/lib/note-form";
import { earliestRecordedOnIso, todayIso } from "@/lib/note-date";
import { parseErrorMessage } from "@/lib/parse-error";
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

/** `null` is the plain list. `noteId: null` is composing a new note; a real id is
 *  editing that note in place — the same form either way, so create and edit share
 *  one composer rather than the whole-sheet step swap `EditPlayerSheet` uses. */
type Draft = { noteId: string | null; values: NoteFormValues };

/**
 * Coach notes, behind a sheet rather than their own tab: replacing the old Notes
 * tab this way keeps the already-long Serve/Rally page from growing further, and
 * matches the `Sheet` pattern `EditPlayerSheet` already establishes for on-demand
 * content that isn't part of the main scroll.
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
  const notesOptions = listPlayerNotesOptions({ path: { player_id: playerId } });
  const { data, isPending, isError } = useQuery(notesOptions);
  const notes = data ?? [];

  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Which note (if any) is mid-delete-confirmation — only one at a time, and it
  // resets whenever the sheet closes below.
  const [deletingId, setDeletingId] = useState<string | null>(null);

  function invalidateNotes() {
    return queryClient.invalidateQueries({
      queryKey: listPlayerNotesQueryKey({ path: { player_id: playerId } }),
    });
  }

  const { mutate: create, isPending: isCreating } = useMutation({
    mutationFn: async (values: NoteFormValues) => {
      const { error: createError } = await createPlayerNote({
        path: { player_id: playerId },
        body: {
          body: values.body.trim(),
          recorded_on: values.recordedOn,
          focus_areas: NOTE_FOCUS_OPTIONS.filter((area) => values.focusAreas.includes(area)),
        },
      });
      if (createError) throw createError;
    },
    onSuccess: async () => {
      await invalidateNotes();
      setDraft(null);
      setError(null);
    },
    onError: (mutationError) => {
      setError(parseErrorMessage(mutationError, "Could not save that note."));
    },
  });

  const { mutate: update, isPending: isUpdating } = useMutation({
    mutationFn: async ({ note, values }: { note: PlayerNoteRead; values: NoteFormValues }) => {
      const body = buildNoteUpdateBody(note, values);
      if (Object.keys(body).length === 0) return;
      const { error: updateError } = await updatePlayerNote({
        path: { player_id: playerId, note_id: note.id },
        body,
      });
      if (updateError) throw updateError;
    },
    onSuccess: async () => {
      await invalidateNotes();
      setDraft(null);
      setError(null);
    },
    onError: (mutationError) => {
      setError(parseErrorMessage(mutationError, "Could not save that note."));
    },
  });

  const { mutate: remove, isPending: isDeleting } = useMutation({
    mutationFn: async (noteId: string) => {
      const { error: deleteError } = await deletePlayerNote({
        path: { player_id: playerId, note_id: noteId },
      });
      if (deleteError) throw deleteError;
    },
    onSuccess: async () => {
      await invalidateNotes();
      setDeletingId(null);
    },
    onError: (mutationError) => {
      setError(parseErrorMessage(mutationError, "Could not delete that note."));
      setDeletingId(null);
    },
  });

  // Closing mid-compose, mid-edit or mid-delete-confirm shouldn't leave that state
  // waiting for the next time the sheet opens.
  function handleOpenChange(next: boolean) {
    if (!next) {
      setDraft(null);
      setError(null);
      setDeletingId(null);
    }
    onOpenChange(next);
  }

  function saveDraft() {
    if (!draft) return;
    const { isValid } = validateNoteForm(draft.values);
    if (!isValid) return;
    if (draft.noteId === null) {
      create(draft.values);
    } else {
      const note = notes.find((existing) => existing.id === draft.noteId);
      if (note) update({ note, values: draft.values });
    }
  }

  const isSaving = isCreating || isUpdating;

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent side="bottom" className="mx-auto max-w-md gap-4 rounded-t-sm p-5">
        <SheetHeader className="p-0">
          <SheetTitle>Notes</SheetTitle>
        </SheetHeader>

        <div className="flex flex-col gap-3">
          {isPending ? (
            <Skeleton className="h-64 w-full" />
          ) : isError ? (
            <Alert variant="destructive">
              <AlertDescription>Could not load notes.</AlertDescription>
            </Alert>
          ) : notes.length === 0 && !draft ? (
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
            notes.map((note) =>
              draft?.noteId === note.id ? (
                <NoteComposer
                  key={note.id}
                  values={draft.values}
                  onChange={(values) => setDraft({ noteId: note.id, values })}
                  onCancel={() => setDraft(null)}
                  onSave={saveDraft}
                  saving={isSaving}
                />
              ) : (
                <NoteCard
                  key={note.id}
                  note={note}
                  confirmingDelete={deletingId === note.id}
                  deleting={isDeleting && deletingId === note.id}
                  onEdit={() => setDraft({ noteId: note.id, values: noteFormValuesFrom(note) })}
                  onRequestDelete={() => setDeletingId(note.id)}
                  onCancelDelete={() => setDeletingId(null)}
                  onConfirmDelete={() => remove(note.id)}
                />
              ),
            )
          )}

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {draft?.noteId === null ? (
            <NoteComposer
              values={draft.values}
              onChange={(values) => setDraft({ noteId: null, values })}
              onCancel={() => setDraft(null)}
              onSave={saveDraft}
              saving={isSaving}
            />
          ) : (
            !draft && (
              <Button
                type="button"
                className="w-full"
                onClick={() => {
                  setError(null);
                  setDraft({ noteId: null, values: blankNoteForm() });
                }}
              >
                <Plus />
                Quick note
              </Button>
            )
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function NoteComposer({
  values,
  onChange,
  onCancel,
  onSave,
  saving,
}: {
  values: NoteFormValues;
  onChange: (values: NoteFormValues) => void;
  onCancel: () => void;
  onSave: () => void;
  saving: boolean;
}) {
  const [showErrors, setShowErrors] = useState(false);
  const { bodyError, dateError, isValid } = validateNoteForm(values);

  function toggleFocus(area: (typeof NOTE_FOCUS_OPTIONS)[number]) {
    onChange({
      ...values,
      focusAreas: values.focusAreas.includes(area)
        ? values.focusAreas.filter((existing) => existing !== area)
        : [...values.focusAreas, area],
    });
  }

  return (
    <StatCard>
      <Field data-invalid={showErrors && bodyError !== null ? true : undefined}>
        <Textarea
          autoFocus
          placeholder="What did you notice?"
          maxLength={NOTE_BODY_MAX}
          value={values.body}
          onChange={(event) => onChange({ ...values, body: event.target.value })}
        />
        {showErrors && bodyError !== null && <FieldError>{bodyError}</FieldError>}
      </Field>

      <div className="flex flex-wrap gap-2">
        {NOTE_FOCUS_OPTIONS.map((area) => {
          const Icon = THEME_ICON[area];
          const selected = values.focusAreas.includes(area);
          return (
            <button
              key={area}
              type="button"
              aria-pressed={selected}
              onClick={() => toggleFocus(area)}
              className={cn(
                "flex flex-col items-center gap-1 rounded-sm border p-2",
                selected ? "border-primary bg-primary/5" : "border-border",
              )}
            >
              {Icon && (
                <Icon
                  className={cn("size-6", selected ? "text-primary" : "text-foreground")}
                  aria-hidden="true"
                />
              )}
              <span className="text-[0.5625rem] capitalize">{area}</span>
            </button>
          );
        })}
      </div>

      <Field data-invalid={showErrors && dateError !== null ? true : undefined}>
        <FieldLabel htmlFor="note-recorded-on">Date</FieldLabel>
        <Input
          id="note-recorded-on"
          type="date"
          min={earliestRecordedOnIso()}
          max={todayIso()}
          value={values.recordedOn}
          onChange={(event) => onChange({ ...values, recordedOn: event.target.value })}
        />
        {showErrors && dateError !== null && <FieldError>{dateError}</FieldError>}
      </Field>

      <div className="flex gap-2">
        <Button type="button" variant="outline" className="flex-1" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="button"
          className="flex-1"
          disabled={saving}
          onClick={() => {
            setShowErrors(true);
            if (isValid) onSave();
          }}
        >
          {saving ? "Saving…" : "Save note"}
        </Button>
      </div>
    </StatCard>
  );
}

function NoteCard({
  note,
  confirmingDelete,
  deleting,
  onEdit,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
}: {
  note: PlayerNoteRead;
  confirmingDelete: boolean;
  deleting: boolean;
  onEdit: () => void;
  onRequestDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
}) {
  return (
    <StatCard>
      <div className="flex gap-3">
        <div className="flex shrink-0 -space-x-2">
          {note.focus_areas.map((area) => {
            const Icon = THEME_ICON[area];
            if (!Icon) return null;
            return (
              <span
                key={area}
                title={area}
                className="flex size-9 items-center justify-center rounded-full border-2 border-card bg-muted"
              >
                <Icon className="size-5 text-foreground" aria-hidden="true" />
              </span>
            );
          })}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs leading-relaxed">{note.body}</p>
          <p className="mt-1 text-[0.625rem] text-muted-foreground">
            {formatRecordedOn(note.recorded_on)}
          </p>
        </div>
        <div className="flex shrink-0 flex-col gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Edit note"
            onClick={onEdit}
          >
            <Pencil />
          </Button>
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
      </div>

      {confirmingDelete && (
        <div className="flex items-center justify-between gap-2 border-t pt-2">
          <p className="text-xs text-muted-foreground">Delete this note?</p>
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onCancelDelete}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={deleting}
              onClick={onConfirmDelete}
            >
              {deleting ? "Deleting…" : "Delete"}
            </Button>
          </div>
        </div>
      )}
    </StatCard>
  );
}

// `recorded_on` is a plain calendar date; see .claude/rules/web.md.
function formatRecordedOn(recordedOn: string): string {
  const [year, month, day] = recordedOn.split("-").map(Number);
  return new Date(year!, month! - 1, day!).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
