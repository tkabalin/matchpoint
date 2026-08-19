export const SURFACE_LABEL: Record<string, string> = {
  hard: "Hard",
  clay: "Clay",
  grass: "Grass",
  carpet: "Carpet",
};

// `played_on` is a plain calendar date; `new Date(str)` would read it as UTC midnight
// and show the previous day east of UTC. See .claude/rules/web.md.
export function formatPlayedOn(playedOn: string): string {
  const [year, month, day] = playedOn.split("-").map(Number);
  return new Date(year!, month! - 1, day!).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
