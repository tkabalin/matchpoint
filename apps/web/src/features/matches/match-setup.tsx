import { getPlayerOptions } from "@matchpoint/api-client/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link, getRouteApi } from "@tanstack/react-router";

import { PlayerLoadError } from "@/components/player-load-error";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

// Avoids a circular import between this component and its route file — same pattern as
// player-profile.tsx.
const routeApi = getRouteApi("/_authenticated/new-match/$playerId");

export function MatchSetup() {
  const { playerId } = routeApi.useParams();
  const {
    data: player,
    isError,
    error,
  } = useQuery(getPlayerOptions({ path: { player_id: playerId } }));

  // Without this the form renders headed "New match" with no name, plus a Start
  // button, for a player the coach cannot reach — the 404 has to stop the flow
  // rather than just leave a blank (#78).
  if (isError)
    return (
      <div className="mx-auto max-w-sm p-4">
        <PlayerLoadError error={error} />
      </div>
    );

  return (
    <div className="mx-auto max-w-sm p-4">
      <Card>
        <CardHeader>
          <CardTitle>
            <h1>New match{player ? ` — ${player.first_name}` : ""}</h1>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="opponent">Opponent</FieldLabel>
              <Input id="opponent" type="text" placeholder="Search or add opponent" />
            </Field>
            <Field>
              <FieldLabel htmlFor="surface">Surface</FieldLabel>
              <ToggleGroup id="surface" defaultValue={["unspecified"]} variant="outline">
                <ToggleGroupItem value="unspecified">Unspecified</ToggleGroupItem>
                <ToggleGroupItem value="carpet">Carpet</ToggleGroupItem>
                <ToggleGroupItem value="clay">Clay</ToggleGroupItem>
                <ToggleGroupItem value="grass">Grass</ToggleGroupItem>
                <ToggleGroupItem value="hard">Hard</ToggleGroupItem>
              </ToggleGroup>
            </Field>
            <Field>
              <FieldLabel htmlFor="format">Format</FieldLabel>
              <ToggleGroup id="format" defaultValue={["best-of-3"]} variant="outline">
                <ToggleGroupItem value="best-of-3">Best of 3</ToggleGroupItem>
                <ToggleGroupItem value="best-of-5">Best of 5</ToggleGroupItem>
              </ToggleGroup>
            </Field>
            <Field orientation="horizontal">
              <FieldLabel htmlFor="ad-scoring">Ad scoring</FieldLabel>
              <Switch id="ad-scoring" defaultChecked />
            </Field>
            <Field orientation="horizontal">
              <FieldLabel htmlFor="final-set-tiebreak">Final-set tiebreak</FieldLabel>
              <Switch id="final-set-tiebreak" defaultChecked />
            </Field>
          </FieldGroup>
        </CardContent>
        <CardFooter className="flex-col gap-2">
          {/* Disabled: there's nowhere for this to go yet — live match capture has no
              route or page wired to it (see #157). Real once that screen exists. */}
          <Button disabled className="w-full">
            Start match
          </Button>
          <Link
            to="/players/$playerId"
            params={{ playerId }}
            className="text-center text-sm text-muted-foreground underline underline-offset-4"
          >
            Cancel
          </Link>
        </CardFooter>
      </Card>
    </div>
  );
}
