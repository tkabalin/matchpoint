# Scoring systems

`matches.scoring_system` names a format and nothing more — the database stores the label, never
interprets it (see `docs/data-model.md`). What each name actually implies is the client's job,
resolved in `apps/web/src/features/capture/state.ts` (`isAdScoringFor`, `maxSetsFor`,
`setRulesFor`). This table is that resolution's source of truth: confirmed with the coach/product
owner, referenced by `state.ts`'s own doc comments rather than restated inline.

| System                                       | Game scoring                                                                         | Set win condition                                                                 | Match decider                                                             | Differs from default in                                                                                                                                                                    |
| -------------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Traditional (ad) scoring                     | Deuce at 40-40, must win by 2 (advantage)                                            | First to 6 games, win by 2; tiebreak at 6-6                                       | Best-of-3 sets                                                            | Baseline — nothing                                                                                                                                                                         |
| Men's Grand Slam singles                     | Same as default                                                                      | Same as default                                                                   | Best-of-5 sets (first to 3)                                               | Match decider only — not a general men's-vs-women's rule, just this event type                                                                                                             |
| Women's Grand Slam singles                   | Same as default                                                                      | Same as default                                                                   | Best-of-3 sets                                                            | Nothing — matches the default                                                                                                                                                              |
| No-ad scoring                                | At 40-40, next point wins the game outright (sudden death) — no deuce/advantage loop | Same as default                                                                   | Same as default                                                           | Game scoring only                                                                                                                                                                          |
| Match tiebreak (10-point)                    | Same as default                                                                      | Same as default                                                                   | Deciding set replaced entirely by a single first-to-10, win-by-2 tiebreak | Match decider only                                                                                                                                                                         |
| Short sets (e.g. Fast4)                      | Often paired with no-ad                                                              | First to 4 games, win by 2; tiebreak at 3-3                                       | Usually best-of-3 short sets                                              | Game scoring and set length                                                                                                                                                                |
| Pro set                                      | Same as default                                                                      | Single set played to 8 (or 10) games, win by 2; tiebreak at 8-8 (or 10-10)        | The pro set is the whole match — no multiple sets                         | Match structure (one long set instead of several)                                                                                                                                          |
| Advantage set (no-tiebreak decider) — legacy | Same as default                                                                      | That set has no tiebreak — play continues past 6-6 until someone leads by 2 games | Historically used for the deciding set only                               | Set win condition for that set only. Largely obsolete: since 2022 all four Grand Slams use a 10-point deciding-set tiebreak instead. Only relevant for old-format or club-specific matches |

## Gaps this table doesn't close

Left as `TODO`s in `state.ts` because this table doesn't state them:

- **Short sets' tiebreak point target** — the table gives the game-count trigger (3-3) but not how
  many points win the resulting breaker. `state.ts` defaults to 5 (Fast4's common convention),
  unconfirmed.
- **Pro set's exact length** — stated here as "8 (or 10)" with no way to tell which a given match
  uses. `state.ts` defaults to the 8-game/7-point convention.
- **Legacy's total set count** — the table doesn't state best-of-3 vs. best-of-5 for this format.
  `state.ts` assumes best-of-3, unconfirmed.
- **Short sets' ad-scoring pairing** — "often paired with no-ad" is not a hard rule; `state.ts`
  treats it as always no-ad, a simplification.
