-- Clear one demo season so a regenerated one can be imported in its place.
--
-- Re-importing on its own does not refresh a regenerated season. The generator draws
-- each match's date and opponent from its RNG stream, so a fresh run shares almost no
-- (player, played_on, opponent_name, event) with the last one, and import_sample_data.py
-- recognises a match by exactly those four columns: it adds a second season beside the
-- first rather than correcting it. Points are ON CONFLICT DO NOTHING, so the handful of
-- matches that do collide keep their stored points and end up half one season, half the
-- other.
--
-- Only the matches and their points go. The coaches and players stay for the import to
-- reuse, which is what lets each player keep the username they sign in with. match_sets
-- follows its match out on the constraint's own ON DELETE CASCADE.
--
-- The coaches to clear are named by the coaches.csv about to be imported, so this can
-- never purge a season other than the one being replaced:
--
--   psql -U matchpoint -d matchpoint \
--     -v coach_emails="$(tail -n +2 coaches.csv | cut -d, -f1 | paste -sd,)" \
--     < purge_sample_data.sql
--
-- Take a backup first when the target is production; the import's own docstring has the
-- pg_dump line for it.

\set ON_ERROR_STOP on

BEGIN;

-- Materialised before the deletes, since the second one removes the rows the first
-- joined through. Emails are lowercased to match the column, which the model and a
-- CHECK both fold on write.
CREATE TEMP TABLE purge_players ON COMMIT DROP AS
SELECT p.id
FROM players p
JOIN coaches c ON c.id = p.coach_id
WHERE c.email = ANY (string_to_array(lower(:'coach_emails'), ','));

DELETE FROM points
WHERE match_id IN (SELECT id FROM matches WHERE player_id IN (SELECT id FROM purge_players));

DELETE FROM matches WHERE player_id IN (SELECT id FROM purge_players);

COMMIT;
