import { useEffect, useId, useRef } from "react";

import { Button } from "@/components/ui/button";

/**
 * The affordance `registerType: "prompt"` requires: a new service worker is waiting, and
 * nothing happens until the user says so.
 *
 * Dismissable on purpose. The reason for prompting rather than auto-updating is that the
 * user might be mid-match, and a banner that cannot be dismissed would cover the capture
 * screen for exactly as long as they keep refusing to reload. Dismissing only takes this
 * banner away — the waiting worker still activates on the next natural reload.
 */
export function UpdatePrompt({
  onReload,
  onDismiss,
}: {
  onReload: () => void;
  onDismiss: () => void;
}) {
  const bannerRef = useRef<HTMLDivElement>(null);
  const messageId = useId();

  // `alertdialog` rather than a live region: the banner and its text are inserted in one
  // go, and a live region only announces changes made while it is already in the
  // accessibility tree, so a screen reader would stay silent. Focus is what gets it read
  // out — and this is a two-button decision, so focus belongs in it either way. Focus
  // goes back to wherever it was when the banner leaves.
  useEffect(() => {
    const previouslyFocused = document.activeElement;
    bannerRef.current?.focus();
    return () => {
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
    };
  }, []);

  return (
    <div
      ref={bannerRef}
      role="alertdialog"
      aria-labelledby={messageId}
      tabIndex={-1}
      className="fixed inset-x-0 bottom-0 z-50 flex items-center justify-between gap-4 border-t bg-background p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-lg"
    >
      <p id={messageId} className="text-sm">
        A new version of MatchPoint is available.
      </p>
      <div className="flex gap-2">
        <Button variant="ghost" onClick={onDismiss}>
          Later
        </Button>
        <Button onClick={onReload}>Reload</Button>
      </div>
    </div>
  );
}
