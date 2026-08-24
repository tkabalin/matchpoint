const STORAGE_KEY = "matchpoint:attention-dismissed";

/**
 * Dismissal for the Home "Needs attention" card (#205), scoped by
 * `${playerId}:${tier}` rather than the flag's free-text reason — the reason
 * (a stat delta) shifts on every minor fluctuation, which would make an
 * exact-text dismissal fragile. Tier-keyed means dismissing hides that
 * player's flag until it clears and a genuinely different flag (a different
 * tier) appears for them; `pickSquadAttention` simply stops returning a
 * dismissed pair once the underlying issue changes category, so there's no
 * expiry to track here.
 */
export function isAttentionFlagDismissed(playerId: string, tier: string): boolean {
  return localStorage.getItem(STORAGE_KEY) === `${playerId}:${tier}`;
}

export function dismissAttentionFlag(playerId: string, tier: string): void {
  localStorage.setItem(STORAGE_KEY, `${playerId}:${tier}`);
}
