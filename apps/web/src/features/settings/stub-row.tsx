import { Badge } from "@/components/ui/badge";
import { Item, ItemContent, ItemTitle } from "@/components/ui/item";
import { cn } from "@/lib/utils";

/**
 * A settings row for something not built yet — same "soon" tag treatment the
 * wireframe uses for its own not-yet-real rows (Two-factor auth, Notifications).
 * Non-interactive: no chevron, no `render` button/link, nothing to tap.
 */
export function StubRow({ label, danger = false }: { label: string; danger?: boolean }) {
  return (
    <Item variant="muted">
      <ItemContent>
        <ItemTitle className={cn(danger && "text-destructive")}>{label}</ItemTitle>
      </ItemContent>
      <Badge variant="secondary">soon</Badge>
    </Item>
  );
}
