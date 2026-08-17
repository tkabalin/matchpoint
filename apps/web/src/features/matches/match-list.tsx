import { listMatchesOptions } from "@matchpoint/api-client/react-query";
import { useQuery } from "@tanstack/react-query";

import { Alert, AlertDescription } from "@/components/ui/alert";

export function MatchList() {
  const { data, isPending, isError } = useQuery(listMatchesOptions());

  if (isPending) return <p>Loading matches…</p>;
  if (isError)
    return (
      <Alert variant="destructive">
        <AlertDescription>Could not load matches.</AlertDescription>
      </Alert>
    );
  if (data.length === 0) return <p>No matches yet.</p>;

  return (
    <ul>
      {data.map((match) => (
        <li key={match.id}>
          {match.opponent_name ?? "Unknown opponent"} — {match.played_on}
          {match.surface && ` (${match.surface})`}
        </li>
      ))}
    </ul>
  );
}
