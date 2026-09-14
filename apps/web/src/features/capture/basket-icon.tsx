/**
 * A basket of tennis balls, showing roughly how many were in the rally: two balls for
 * the shortest bucket, filled to the brim for the longest counted one, spilling over
 * for 11+. The basket itself never changes size or shape, only how many balls sit in
 * it — every rally-length button stays the same shape and size, at a different fill
 * level, rather than looking like four unrelated pictures.
 */

import type { RallyBucket } from "./point";

// Ball positions, bottom row first and centre-out within each row — the order balls
// actually pile in a real basket: the base fills before anything stacks above it.
const BALL_POSITIONS: readonly { cx: number; cy: number }[] = [
  { cx: 34, cy: 46 },
  { cx: 47, cy: 46 },
  { cx: 20, cy: 46 },
  { cx: 60, cy: 46 },
  { cx: 40, cy: 34 },
  { cx: 27, cy: 34 },
  { cx: 53, cy: 34 },
  { cx: 33, cy: 22 },
  { cx: 47, cy: 22 },
  { cx: 40, cy: 10 },
];

// Once the ten fixed positions above are full, the overflow spills onto the ground in
// front of the basket rather than stacking precariously above the rim — B4 is the only
// bucket that reaches this ("11+" has no upper bound to draw an exact count for).
// Drawn after (so on top of) the basket path below, which is what puts them visually
// in front of it rather than behind.
const OVERFLOW_POSITIONS: readonly { cx: number; cy: number }[] = [
  { cx: 21, cy: 66 },
  { cx: 59, cy: 66 },
  { cx: 40, cy: 73 },
];

// How many of BALL_POSITIONS show for each bucket. B3 and B4 both fill all ten; only
// B4 goes on to draw the overflow balls too.
const BALL_COUNT: Record<RallyBucket, number> = { B1: 2, B2: 5, B3: 10, B4: 10 };

const BALL_RADIUS = 8;

export function BasketIcon({ bucket, className }: { bucket: RallyBucket; className?: string }) {
  const balls = BALL_POSITIONS.slice(0, BALL_COUNT[bucket]);
  const overflowing = bucket === "B4";

  return (
    <svg viewBox="0 0 80 80" className={className} aria-hidden="true">
      {/* The basket itself — fixed shape and size regardless of what's inside it. */}
      <path
        d="M16 50 H64 L54 72 H26 Z"
        fill="#c08552"
        stroke="#8b5a2b"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="M22 58 H58 M24.5 65 H55.5" stroke="#8b5a2b" strokeWidth="1.5" opacity="0.5" />
      <ellipse cx="40" cy="50" rx="24" ry="5" fill="#d6a06c" stroke="#8b5a2b" strokeWidth="2" />

      {balls.map(({ cx, cy }, index) => (
        <circle
          key={index}
          cx={cx}
          cy={cy}
          r={BALL_RADIUS}
          fill="#cbdb2a"
          stroke="white"
          strokeWidth="1.5"
        />
      ))}
      {overflowing &&
        OVERFLOW_POSITIONS.map(({ cx, cy }, index) => (
          <circle
            key={index}
            cx={cx}
            cy={cy}
            r={BALL_RADIUS}
            fill="#cbdb2a"
            stroke="white"
            strokeWidth="1.5"
          />
        ))}
    </svg>
  );
}
