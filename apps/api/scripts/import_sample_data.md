# Writing sample data for `import_sample_data.py`

This is the CSV format the importer reads. The CSVs directly under
`apps/web/scripts/fake-data/` are not it — those are the frontend's own capture-model
dump, in different column names and different enum casing. What that generator writes to
`apps/web/scripts/fake-data/import/` is this format, and is the fastest way to a full
demo season; build these four files by hand only for a dataset it can't produce.

The script's own docstring covers *running* it (prod backup, scp'ing files into the
container, the demo password). This covers *constructing valid rows*.

## Files

| File          | Required? | One row per                                                       |
| ------------- | --------- | ------------------------------------------------------------------ |
| `coaches.csv` | yes       | coach                                                                |
| `players.csv` | yes       | player                                                               |
| `matches.csv` | yes       | match                                                                 |
| `points.csv`  | optional  | captured point — omit the file entirely for a match with no points |
| `checkpoints.csv` | optional | score checkpoint, the board as the coach declared it on the score editor |
| `notes.csv`   | optional  | dated coach note about a player, filed under its focus areas          |
| `photos/`     | optional  | the files `photo` cells name; any folder works, the cell is the path |

Re-running the importer on an edited version of the same files is safe: rows are
recognised by natural key (coach by email, player by coach+first+last name, match by
player+played_on+opponent+event, point by match+sequence, note by
player+recorded_on+body) and refreshed, not duplicated.

A **regenerated** season is not an edited one. The generator draws each match's date and
opponent from its RNG stream, so a fresh run shares almost no match natural key with the
last, and importing it over the old season leaves both in place, roughly 720 matches
where 360 were wanted. Clear the old one first with `purge_sample_data.sql`, which takes
the coach emails from the `coaches.csv` about to be imported:

```sh
psql -U matchpoint -d matchpoint \
  -v coach_emails="$(tail -n +2 coaches.csv | cut -d, -f1 | paste -sd,)" \
  < purge_sample_data.sql
```

It clears those coaches' matches only, with their points and score checkpoints. The coaches
and players stay for the import to reuse, so each player keeps the username they sign in with.

## `coaches.csv`

```
email,display_name,photo
```

One row per coach. `email` is lowercased on write, so casing in the file doesn't
matter. There's no password column: every imported coach shares one generated
password, printed by the script when it finishes — see its docstring.

- `photo`: a JPEG, PNG or WebP, as a path relative to the CSV directory (e.g.
  `photos/coach-1.webp`), blank = no photo. It goes through the same normaliser an
  upload does, so any size or orientation is fine. A coach that already has a photo
  keeps it on a second import.

## `players.csv`

```
coach_email,first_name,last_name,date_of_birth,dominant_hand,gender,notes,photo
```

- `coach_email` joins to a row in `coaches.csv`.
- `(coach_email, first_name, last_name)` must be unique — there's no id column, so
  that triple is how a player is recognised on a second import.
- `date_of_birth`: `YYYY-MM-DD`, blank = unset.
- `dominant_hand`: `right` \| `left`, blank = unset.
- `gender`: `male` \| `female` \| `other`, blank = unset.
- `notes`: free text, blank = unset.
- `photo`: as on `coaches.csv`.
- Don't invent a `username` — the importer mints one from the name.

## `matches.csv`

```
coach_email,player_first_name,player_last_name,opponent_name,played_on,surface,event,scoring_system,result,result_reason,match_key
```

- `(coach_email, player_first_name, player_last_name)` must match a `players.csv` row
  exactly.
- `played_on`: `YYYY-MM-DD`, **required** — every match is filed by the date it was
  played.
- `surface`: `hard` \| `clay` \| `grass` \| `carpet`, blank = unset. There is no
  `unspecified` value — use blank.
- `scoring_system`: `traditional` \| `mens_grand_slam` \| `no_ad_scoring` \|
  `match_tiebreak_10_points` \| `short_sets` \| `pro_set` \| `legacy`, blank = unset.
- `result`: `win` \| `loss` from the tracked player's side, blank = unset.
- `result_reason`: `completed` \| `retirement` \| `walkover` \| `default`, how the
  match reached that result, blank = unset.
- `opponent_name`, `event`: free text, blank = unset.
- `match_key`: any label, unique per coach, used only to join `points.csv` rows to
  this match — it's never stored. Leave it blank for a match with no points. A UUID,
  a slug, whatever's convenient; nothing downstream reads it as anything but a join
  key.
- `(player, played_on, opponent_name, event)` is the natural key a second import
  recognises this match by — `match_key` can change between runs without creating a
  duplicate match, as long as those four still match.

## `points.csv`

```
coach_email,match_key,sequence,server,won,court_side,serve1_outcome,serve1_fault_mode,serve2_outcome,serve2_fault_mode,return_outcome,end_reason,unusual_reason,note,wing,shot_type,ball_in,ball_half,ball_depth,ball_out_mode,rally_length_bucket,set_number,game_number,in_tiebreak,is_break_point,is_game_point,is_game_end,is_set_point,is_set_end,is_match_point
```

`(coach_email, match_key)` joins to a `matches.csv` row. Every row is validated
against `schemas/point.py`'s `PointCreate` before it's stored — shape only, never
tennis-logic coherence, so a set score that doesn't add up won't be rejected. The
match's set tally (`match_sets`) is recomputed afterwards purely from `is_game_end` /
`is_set_end` + `won` (on top of the newest checkpoint, if `checkpoints.csv` declares
one), so for a demo to look right on the dashboard, keep those three flags consistent
with the scoreline you intend, even though nothing enforces it.

Booleans accept `true`/`false` (also `1`/`0`, `yes`/`no`). The nine score-context
columns from `set_number` on (plus `in_tiebreak`) are **always required** — never
blank, whatever the point's other fields look like.

### Enum values

| Column                                | Values                                                                             |
| -------------------------------------- | ----------------------------------------------------------------------------------- |
| `server`                                | `tracked` \| `opponent`                                                            |
| `serve1_outcome`                       | `in` \| `fault` \| `ace`; blank = a serve nobody watched                            |
| `court_side` (required), `ball_half`    | `deuce` \| `ad`                                                                     |
| `serve1_fault_mode`, `serve2_fault_mode`, `ball_out_mode` | `net` \| `long` \| `wide`                                     |
| `serve2_outcome`                       | `in` \| `fault` \| `ace`                                                            |
| `return_outcome`                       | `in` \| `net` \| `long` \| `wide`                                                   |
| `end_reason`                           | `forced` \| `mistake` \| `ace` \| `double_fault` \| `unusual`; blank = an ending nobody watched |
| `unusual_reason`                       | `net_touch` \| `ball_hit_player` \| `reached_over` \| `double_hit` \| `hindrance` \| `point_penalty` \| `other` |
| `wing`                                  | `forehand` \| `backhand`                                                            |
| `shot_type`                             | `drive` \| `volley` \| `dropshot` \| `lob`                                          |
| `ball_depth`                            | `short` \| `deep`                                                                   |
| `rally_length_bucket`                   | `b1` (1-2 shots) \| `b2` (3-5) \| `b3` (6-10) \| `b4` (11+), per the capture screen  |

### Which fields go together

The trickiest part of a hand-written row. `PointCreate` enforces these as a group —
get any one wrong and the whole row is rejected:

- **Unwatched serve.** A blank `serve1_outcome` is a serve nobody saw, not a fourth
  outcome: `serve1_fault_mode`, `serve2_*` and `return_outcome` are all blank with it,
  and the point carries on to its ending as normal.
- **Unwatched ending.** A blank `end_reason` is an ending seen only as who won it:
  `unusual_reason`, `rally_length_bucket` and the whole last-shot group below are
  blank with it.
- **Second serve.** `serve2_outcome` is set only when `serve1_outcome` is `fault`
  (never on an ace or an in-first-serve), and even then it's optional: a faulted first
  serve whose second attempt went unwatched records no `serve2_outcome` either.
- **Serve fault mode**, checked once per attempt (`serve1_*`, then `serve2_*` if it
  exists): set exactly when the tracked player served and that attempt's outcome is
  `fault`, and blank otherwise. A serve that landed needs no placement of its own,
  `court_side` being the box it had to land in, and an opponent's placement is out of
  scope.
- **Double fault.** Both serves faulted exactly when `end_reason` is `double_fault`.
- **Ace.** A serve recorded as an `ace` exactly when `end_reason` is `ace`: an ace is
  what ended the point, so neither half stands without the other.
- **Return outcome.** Set only when `server` is `opponent` (it describes the tracked
  player's return of the opponent's serve, so it's never set on a point the tracked
  player served), and only when `serve1_outcome` is also set: a return can't be
  recorded off a serve nobody watched.
- **Unusual reason.** Set only when `end_reason` is `unusual`.
- **Last shot / final ball** (`wing`, `shot_type`, `ball_in`, `ball_half`,
  `ball_depth`, `ball_out_mode`), as one group:
  - No last shot to record when `end_reason` is blank, `ace`, `double_fault`, or
    `unusual`, or `return_outcome` is a miss (`net`/`long`/`wide`): all six blank.
  - Otherwise: `wing` and `shot_type` are set together or both blank. `ball_in` may
    also be blank, the same unwatched-final-ball case as the second serve above, with
    `ball_half`, `ball_depth` and `ball_out_mode` all blank alongside it. If `ball_in`
    is true, `ball_half` and `ball_depth` are required and `ball_out_mode` is blank; if
    false, `ball_out_mode` is required and `ball_half`/`ball_depth` are blank.

## `checkpoints.csv`

```
coach_email,match_key,sequence,serves_next,order_changed,after
```

One row per score checkpoint: the scoreboard as the coach declared it on the score
editor, which is how capture records games nobody watched or corrects a mis-tap.
`(coach_email, match_key)` joins to a `matches.csv` row as for a point, and a
checkpoint shares its match's `sequence` space with the points (no point and
checkpoint of one match may share a sequence). The set tally is folded from the newest
checkpoint plus the points after it, the same as a live sync.

- `serves_next`: `tracked` \| `opponent`, who serves the game after the declared board.
- `order_changed`: boolean, whether the serving order on court deviated from rotation.
- `after`: one JSON cell in the shape `schemas/score_checkpoint.py`'s `ScoreSnapshot`
  vets: `{"sets": [{"set_number": 1, "games_tracked": 6, "games_opponent": 3,
  "tiebreak_tracked": null, "tiebreak_opponent": null, "winner": "tracked"}, ...]}`,
  set 1 first with no gaps, `winner` null on the set in progress.

## `notes.csv`

```
coach_email,player_first_name,player_last_name,recorded_on,focus_areas,body
```

One row per coach note, the dated timeline the player screen shows. Not capture data:
these are what a coach types up after a session or a match.

- `(coach_email, player_first_name, player_last_name)` must match a `players.csv` row
  exactly, as on `matches.csv`.
- `recorded_on`: `YYYY-MM-DD`, **required**, no later than today and no more than ten
  years back (`schemas/player_note.py`'s own bounds).
- `focus_areas`: a space-separated subset of `technical` \| `mental` \| `physical` \|
  `tactical`, blank for none. Order and repeats don't matter; they're canonicalised.
- `body`: the note, free text.
- `(player, recorded_on, body)` is how a second import recognises the note, so a
  reworded note is a new one and a re-filed one refreshes its focus areas.
