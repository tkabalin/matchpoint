import type { PlayerRead, PlayerSelfRead } from "@matchpoint/api-client";
import { IdCard, Pencil } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";

import { StatCard } from "@/components/stat-card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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
 * Username, date of birth, dominant hand and the player's own notes field —
 * real `PlayerRead` data that lost its only view surface when the Overview tab
 * was removed; write-only via the edit sheet isn't good enough for a coach who
 * just wants to check it. Owns the Edit trigger too, now that it sits in the
 * one card whose whole content that button edits.
 *
 * The username is shown once at player creation and never again, so a coach
 * with a player who has forgotten theirs has nowhere else to read it.
 *
 * Also mounted on a player's own view of themselves (#203), reading the
 * trimmer `PlayerSelfRead` the player-auth endpoints return — no `notes`
 * there (coach notes are deliberately private) and no edit action (editing a
 * player is coach-only), so both are omitted rather than shown broken.
 */
export function PlayerDetailsCard({
  player,
  onEdit,
}: {
  player: PlayerRead | PlayerSelfRead;
  onEdit?: () => void;
}) {
  return (
    <StatCard className="h-full">
      <div className="flex items-center gap-2">
        <IdCard className="size-7 shrink-0 text-primary" aria-hidden="true" />
        <p className="flex-1 text-base font-bold text-foreground">Player details</p>
        {onEdit && (
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Edit" onClick={onEdit}>
            <Pencil />
          </Button>
        )}
      </div>
      {/* Stacked, not side by side — this card sits at half page width now
          (next to the win/loss card), and a label-left/value-right row has
          no room to breathe at that width. */}
      <dl className="flex flex-col gap-2 text-xs">
        <div>
          <dt className="text-muted-foreground">Username</dt>
          {/* `break-all` because a username has no spaces to wrap at, and this
              card is half the page wide. */}
          <dd className="font-mono break-all">{player.username}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Date of birth</dt>
          <dd>{player.date_of_birth ? formatDateOfBirth(player.date_of_birth) : "—"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Dominant hand</dt>
          <dd className="capitalize">{player.dominant_hand ?? "—"}</dd>
        </div>
        {"notes" in player && (
          <div>
            <dt className="text-muted-foreground">Notes</dt>
            <PlayerNotes notes={player.notes} />
          </div>
        )}
      </dl>
    </StatCard>
  );
}

/**
 * A note runs to 2000 characters and this card is half the page wide, so an
 * unbounded one buries everything under it. Clamped to four lines with the rest a
 * tap away, rather than truncated: the coach wrote it, they can still read it.
 */
function PlayerNotes({ notes }: { notes: string | null }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [clamped, setClamped] = useState(false);

  // Measured, not guessed from a character count: four lines of this width is a
  // different number of characters for every note. Observed rather than measured once,
  // because a rotation or a webfont arriving after mount rewraps the note, and a stale
  // "it fits" hides the toggle on a note whose tail is now unreachable. Skipped while
  // expanded, where the two heights always agree.
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || expanded) return;
    const measure = () => {
      setClamped(node.scrollHeight > node.clientHeight);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, [notes, expanded]);

  return (
    <dd>
      {/* The clamp goes on a child, not the `dd` itself: a `dl > div` may hold
          nothing but `dt` and `dd`, so the toggle has to live inside this one.
          `whitespace-pre-line` because a note written line by line in the edit
          sheet's textarea has to keep reading that way here. */}
      <p ref={ref} className={cn("whitespace-pre-line", !expanded && "line-clamp-4")}>
        {notes ?? "—"}
      </p>
      {clamped && (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => {
            setExpanded((open) => !open);
          }}
          className="mt-0.5 font-medium text-primary"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </dd>
  );
}
