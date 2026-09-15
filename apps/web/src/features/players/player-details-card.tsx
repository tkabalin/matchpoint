import type { PlayerNoteRead, PlayerRead, PlayerSelfRead } from "@matchpoint/api-client";
import { createPlayerNote, deletePlayerNote, updatePlayerNote } from "@matchpoint/api-client";
import {
  listPlayerNotesOptions,
  listPlayerNotesQueryKey,
} from "@matchpoint/api-client/react-query";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { LucideIcon } from "lucide-react";
import {
  AtSign,
  Brain,
  Cake,
  Compass,
  Dumbbell,
  Hand,
  IdCard,
  NotebookPen,
  Pencil,
  Plus,
  Trash2,
  Wrench,
} from "lucide-react";
import { useState } from "react";

import { StatCard } from "@/components/stat-card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
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
 *  editing that note in place — the same form either way. */
type Draft = { noteId: string | null; values: NoteFormValues };

// `date_of_birth` is a plain calendar date; `new Date(str)` reads it as UTC
// midnight, which is the previous day east of UTC (.claude/rules/web.md).
function formatDateOfBirth(dateOfBirth: string): string {
  const [year, month, day] = dateOfBirth.split("-").map(Number);
  return new Date(year!, month! - 1, day!).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * Username, date of birth, dominant hand, and the coach's own dated notes on this
 * player — real data that lost its only view surface when the Overview tab was
 * removed; write-only via the edit sheet isn't good enough for a coach who just
 * wants to check it. Owns the Edit trigger too, now that it sits in the one card
 * whose whole content that button edits.
 *
 * Notes live here in full now, not behind a separate bottom-of-page sheet: one
 * notes concept (a dated, focus-tagged list), not the old split between that list
 * and a second plain-text field set once at creation and never revisited.
 *
 * The username is shown once at player creation and never again, so a coach
 * with a player who has forgotten theirs has nowhere else to read it.
 *
 * Also mounted on a player's own view of themselves (#203), reading the
 * trimmer `PlayerSelfRead` the player-auth endpoints return — no notes there
 * (coach notes are deliberately private) and no edit action (editing a player
 * is coach-only), so both are omitted rather than shown broken.
 */
export function PlayerDetailsCard({
  player,
  onEdit,
}: {
  player: PlayerRead | PlayerSelfRead;
  onEdit?: () => void;
}) {
  return (
    <StatCard>
      <div className="flex items-center gap-2">
        <IdCard className="size-7 shrink-0 text-primary" aria-hidden="true" />
        <p className="flex-1 text-base font-bold text-foreground">Player details</p>
        {onEdit && (
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Edit" onClick={onEdit}>
            <Pencil />
          </Button>
        )}
      </div>
      <dl className="flex flex-col gap-2 text-sm">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <dt className="flex items-center gap-1.5 font-bold text-muted-foreground">
              <AtSign className="size-4 shrink-0" aria-hidden="true" />
              Username
            </dt>
            {/* `break-all` because a username has no spaces to wrap at. */}
            <dd className="font-mono font-bold break-all text-foreground">{player.username}</dd>
          </div>
          <div>
            <dt className="flex items-center gap-1.5 font-bold text-muted-foreground">
              <Cake className="size-4 shrink-0" aria-hidden="true" />
              Date of birth
            </dt>
            <dd className="font-bold text-foreground">
              {player.date_of_birth ? formatDateOfBirth(player.date_of_birth) : "—"}
            </dd>
          </div>
        </div>
        <div>
          <dt className="flex items-center gap-1.5 font-bold text-muted-foreground">
            <Hand className="size-4 shrink-0" aria-hidden="true" />
            Dominant hand
          </dt>
          <dd className="font-bold text-foreground capitalize">{player.dominant_hand ?? "—"}</dd>
        </div>
      </dl>

      {/* `"notes" in player` still distinguishes `PlayerRead` from the trimmer
          `PlayerSelfRead` — only its presence is read now, never its (retired)
          string value, since the field itself stays coach-only-private. */}
      {"notes" in player && <PlayerNotes playerId={player.id} />}
    </StatCard>
  );
}

function PlayerNotes({ playerId }: { playerId: string }) {
  const queryClient = useQueryClient();
  const notesOptions = listPlayerNotesOptions({ path: { player_id: playerId } });
  const { data, isPending, isError } = useQuery(notesOptions);
  const notes = data ?? [];

  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Which note (if any) is mid-delete-confirmation — only one at a time.
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
    <div className="flex flex-col gap-2 border-t pt-2">
      <p className="flex items-center gap-1.5 text-sm font-bold text-foreground">
        <NotebookPen className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        Notes
      </p>

      {isPending ? (
        <Skeleton className="h-16 w-full" />
      ) : isError ? (
        <Alert variant="destructive">
          <AlertDescription>Could not load notes.</AlertDescription>
        </Alert>
      ) : (
        <div className="flex flex-col gap-2">
          {notes.map((note) =>
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
          )}
        </div>
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
            variant="outline"
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
    <div className="flex flex-col gap-2 rounded-sm border p-2">
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

      <div className="flex flex-wrap gap-1.5">
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
                "flex flex-col items-center gap-1 rounded-sm border p-1.5",
                selected ? "border-primary bg-primary/5" : "border-border",
              )}
            >
              {Icon && (
                <Icon
                  className={cn("size-5", selected ? "text-primary" : "text-foreground")}
                  aria-hidden="true"
                />
              )}
              <span className="text-[0.5rem] capitalize">{area}</span>
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

      {/* Grid, not flex + flex-1: Button's own base classes carry shrink-0,
          which can out-rank flex-1's implicit shrink and leave the longer
          label ("Save note") overflowing its column. */}
      <div className="grid grid-cols-2 gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="button"
          disabled={saving}
          onClick={() => {
            setShowErrors(true);
            if (isValid) onSave();
          }}
        >
          {saving ? "Saving…" : "Save note"}
        </Button>
      </div>
    </div>
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
    <div className="flex flex-col gap-2 rounded-sm border p-2">
      <div className="flex gap-2">
        <div className="flex shrink-0 -space-x-2">
          {note.focus_areas.map((area) => {
            const Icon = THEME_ICON[area];
            if (!Icon) return null;
            return (
              <span
                key={area}
                title={area}
                className="flex size-7 items-center justify-center rounded-full border-2 border-card bg-muted"
              >
                <Icon className="size-4 text-foreground" aria-hidden="true" />
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
        // Stacked, not a single justify-between row: "Delete this note?" plus
        // two buttons doesn't fit one line at this card's width, and neither
        // side had room to shrink into — the same overflow the composer's
        // Cancel/Save row had.
        <div className="flex flex-col gap-2 border-t pt-2">
          <p className="text-xs text-muted-foreground">Delete this note?</p>
          <div className="grid grid-cols-2 gap-2">
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
    </div>
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
