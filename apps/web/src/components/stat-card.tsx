import type { ReactNode } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * A titled panel — the repeating unit of every analytics tab.
 *
 * The heading is a real `h3` rather than styled text so a tab full of these is
 * navigable by heading, which is how the panels read as a list rather than a wall.
 */
export function StatCard({
  title,
  note,
  footnote,
  children,
  className,
}: {
  title?: string;
  /** Sits under the title, for scope caveats ("point-ending shot only"). */
  note?: string;
  /** Sits under the content, for what the reader should take from it. */
  footnote?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardContent className="flex flex-col gap-2">
        {title && (
          <h3 className="text-[0.625rem] tracking-wide text-muted-foreground uppercase">{title}</h3>
        )}
        {note && <p className={cn("text-[0.625rem] text-muted-foreground", "-mt-1")}>{note}</p>}
        {children}
        {footnote && <p className="text-[0.625rem] text-muted-foreground">{footnote}</p>}
      </CardContent>
    </Card>
  );
}
