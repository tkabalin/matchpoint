import { ImagePlus, Trash2 } from "lucide-react";
import { useRef } from "react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

/** What the API's own allowlist accepts, so the picker cannot offer a refusable file. */
const ACCEPTED = "image/jpeg,image/png,image/webp";

/**
 * Choosing or clearing a photo, for a coach or a player.
 *
 * Deliberately does no network work of its own: it reports the file that was picked and
 * leaves the caller to decide when that becomes a request. Profile uploads straight
 * away because the coach already exists; adding a player has to hold the file until the
 * player it belongs to has an id.
 */
export function PhotoPickerSheet({
  open,
  onOpenChange,
  title = "Photo",
  hasPhoto,
  onChoose,
  onRemove,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  /** Drives whether removing is offered — there is nothing to remove otherwise. */
  hasPhoto: boolean;
  onChoose: (file: File) => void;
  onRemove: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="mx-auto max-w-md gap-3 rounded-t-sm p-5">
        <SheetHeader className="p-0">
          <SheetTitle>{title}</SheetTitle>
        </SheetHeader>

        {/* Hidden rather than styled: a file input cannot be restyled across browsers,
            so the visible control is a Button that clicks this one. */}
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED}
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            // Cleared so picking the same file twice in a row still fires a change.
            event.target.value = "";
            if (file) onChoose(file);
          }}
        />

        <Button type="button" className="w-full" onClick={() => inputRef.current?.click()}>
          <ImagePlus />
          Choose photo
        </Button>

        {hasPhoto && (
          <Button type="button" variant="outline" className="w-full" onClick={onRemove}>
            <Trash2 />
            Remove photo
          </Button>
        )}

        <SheetClose render={<Button variant="ghost" className="w-full text-muted-foreground" />}>
          Cancel
        </SheetClose>
      </SheetContent>
    </Sheet>
  );
}
