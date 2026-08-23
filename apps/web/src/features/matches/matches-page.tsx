import type { MatchRead } from "@matchpoint/api-client";
import { useState } from "react";

import { AppPage, PageHeader } from "@/components/page-shell";
import { PrimaryMatchAction } from "@/components/primary-match-action";

import { DeleteMatchSheet } from "./delete-match-sheet";
import { EditMatchSheet } from "./edit-match-sheet";
import { MatchList } from "./match-list";

export function MatchesPage() {
  const [editing, setEditing] = useState<MatchRead | null>(null);
  const [deleting, setDeleting] = useState<MatchRead | null>(null);

  return (
    <AppPage>
      <PageHeader title="Matches" />
      <MatchList onEdit={setEditing} onDelete={setDeleting} />
      <PrimaryMatchAction />

      {editing && (
        <EditMatchSheet
          match={editing}
          open={editing !== null}
          onOpenChange={(open) => !open && setEditing(null)}
        />
      )}

      <DeleteMatchSheet
        match={deleting}
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
      />
    </AppPage>
  );
}
