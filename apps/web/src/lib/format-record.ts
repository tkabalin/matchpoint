/** A wins–losses record, always with the W/L each number belongs to marked
 *  inline (e.g. "14W – 15L") — a bare "14–15" reads fine once you already know
 *  the order, but has no way to tell a first-time reader which side is which.
 *  Matches the spacing player-record-card.tsx's recent-form line already used. */
export function formatRecord(wins: number, losses: number): string {
  return `${wins}W – ${losses}L`;
}
