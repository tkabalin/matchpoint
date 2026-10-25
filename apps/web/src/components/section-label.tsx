/** Names a group of rows, reusing the small-caps list label `player-list.tsx` and
 * `start-match.tsx` already use. `aria-labelledby` carries the name onto the
 * `ItemGroup`'s own `role="list"`, so the grouping is announced, not just drawn. */
export function SectionLabel({ id, children }: { id: string; children: string }) {
  return (
    <h2 id={id} className="mt-2 text-[0.625rem] tracking-wide text-muted-foreground uppercase">
      {children}
    </h2>
  );
}
