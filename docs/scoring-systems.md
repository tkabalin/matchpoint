# Scoring systems

`matches.scoring_system` names a format and nothing more — the database stores the label, never
interprets it (see `docs/data-model.md`). What each name actually implies is the client's job,
resolved in `apps/web/src/features/capture/state.ts` (`isAdScoringFor`, `maxSetsFor`,
`setRulesFor`). This table is that resolution's source of truth: confirmed with the coach/product
owner, referenced by `state.ts`'s own doc comments rather than restated inline.

| System                                       | Game scoring                                                                         | Set win condition                                                                 | Match decider                                                             | Differs from default in                                                                                                                                                                    |
| -------------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Traditional (ad) scoring                     | Deuce at 40-40, must win by 2 (advantage)                                            | First to 6 games, win by 2; tiebreak at 6-6                                       | Best-of-3 sets                                                            | Baseline — nothing. Also names Women's Grand Slam singles: a separate `womens_grand_slam` value existed once, dropped when nothing in this table distinguished it from Traditional         |
| Men's Grand Slam singles                     | Same as default                                                                      | Same as default                                                                   | Best-of-5 sets (first to 3)                                               | Match decider only — not a general men's-vs-women's rule, just this event type                                                                                                             |
| No-ad scoring                                | At 40-40, next point wins the game outright (sudden death) — no deuce/advantage loop | Same as default                                                                   | Same as default                                                           | Game scoring only                                                                                                                                                                          |
| Match tiebreak (10-point)                    | Same as default                                                                      | Same as default                                                                   | Deciding set replaced entirely by a single first-to-10, win-by-2 tiebreak | Match decider only                                                                                                                                                                         |
| Short sets (e.g. Fast4)                      | Often paired with no-ad                                                              | First to 4 games, win by 2; tiebreak at 3-3                                       | Usually best-of-3 short sets                                              | Game scoring and set length                                                                                                                                                                |
| Pro set                                      | Same as default                                                                      | Single set played to 8 (or 10) games, win by 2; tiebreak at 8-8 (or 10-10)        | The pro set is the whole match — no multiple sets                         | Match structure (one long set instead of several)                                                                                                                                          |
| Advantage set (no-tiebreak decider) — legacy | Same as default                                                                      | That set has no tiebreak — play continues past 6-6 until someone leads by 2 games | Historically used for the deciding set only                               | Set win condition for that set only. Largely obsolete: since 2022 all four Grand Slams use a 10-point deciding-set tiebreak instead. Only relevant for old-format or club-specific matches |

## Beyond the table

Four values the table above doesn't state directly, resolved separately:

- **Short sets' tiebreak point target: 5, win-by-2.** Official ITF Fast4 rules use a first-to-5,
  win-by-2 breaker at 3-3 games — the same structure as a full-length tiebreak, just shorter.
- **Pro set's length: 8 games.** The table states "8 (or 10)" without resolving which; 8 is the more
  common club-level convention, chosen to match this app's amateur/club focus rather than left
  coach-configurable.
- **Legacy's total set count: best-of-3.** Advantage-set matches historically ran at both best-of-3
  and best-of-5 depending on the event; best-of-3 matches club-level convention, the context this
  app targets.
- **Short sets' ad-scoring pairing: always no-ad.** Official ITF Fast4 rules bundle short sets,
  no-ad scoring, and sudden-death breakers together as one fixed package, not an independent choice
  — `state.ts` treats the pairing as unconditional, not merely "often."
