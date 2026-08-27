/**
 * The flash that confirms what a captured point just won or lost: the point, the game
 * it finished, or the set.
 *
 * It never takes a pointer event, so a coach who is already tapping the next serve taps
 * through it, and it clears on its own timer rather than on `animationend` — the flash
 * has to go away even where the animation never runs (a backgrounded tab, jsdom).
 *
 * Green for won and red for lost are the pair the header's skip sheet already uses for
 * the same two answers. A game or a set is the bigger moment, so it holds the screen
 * longer and sits at a bigger size, which is also what tells the three apart at a
 * glance when a coach catches one out of the corner of their eye.
 */

import { CircleCheck, CircleX } from "lucide-react";
import { useEffect } from "react";

import { cn } from "@/lib/utils";

/** The biggest thing a point finished, off its own stamps (see point.ts's context). */
export type FlashLevel = "point" | "game" | "set";

// Matches the animation durations in app.css: the node leaves as its animation ends.
const FLASH_MS: Record<FlashLevel, number> = { point: 900, game: 1400, set: 1400 };

const LABEL: Record<FlashLevel, string> = { point: "Point", game: "Game", set: "Set" };

const SIZE: Record<FlashLevel, string> = {
  point: "animate-score-flash gap-2 px-5 py-3 text-lg [&_svg]:size-6",
  game: "animate-score-flash-long gap-3 px-7 py-5 text-2xl [&_svg]:size-8",
  set: "animate-score-flash-long gap-3 px-7 py-5 text-2xl [&_svg]:size-8",
};

export function ScoreFlash({
  level,
  won,
  onDone,
}: {
  level: FlashLevel;
  won: boolean;
  onDone: () => void;
}) {
  useEffect(() => {
    const timer = setTimeout(onDone, FLASH_MS[level]);
    return () => {
      clearTimeout(timer);
    };
  }, [level, onDone]);

  return (
    <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center">
      <div
        role="status"
        className={cn(
          "flex items-center rounded-sm border bg-card font-semibold shadow-lg",
          SIZE[level],
          won ? "border-court/40 text-court" : "border-destructive/40 text-destructive",
        )}
      >
        {won ? <CircleCheck /> : <CircleX />}
        {`${LABEL[level]} ${won ? "won" : "lost"}`}
      </div>
    </div>
  );
}
