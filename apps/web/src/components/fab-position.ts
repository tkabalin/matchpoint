// Split out of primary-match-action.tsx rather than left duplicated: the Matches and
// Players floating actions are two different controls that have to sit in the same
// place, and the two copies of this string had already drifted from the nav's own
// height. Tracks the page column's right edge rather than the viewport's, so it stays
// beside the content once the screen is wider than the column, and clears the nav by a
// constant gap whether or not the device has a home indicator.
//
// Position only, not shape: Players' own Add button is a plain circular icon FAB
// (still `size-12 rounded-full` at its own call site), but PrimaryMatchAction is a
// labelled pill sized by `buttonVariants` instead — the two controls share where they
// sit, not what they look like.
export const FAB_POSITION =
  "fixed right-[max(1rem,calc(50%-13rem))] bottom-[calc(var(--spacing-nav)+1rem)] z-40 shadow-lg";
