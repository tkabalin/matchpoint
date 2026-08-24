import type { ErrorComponentProps } from "@tanstack/react-router";
import { useEffect, useId, useRef } from "react";

import { Button } from "@/components/ui/button";

/**
 * Root route's `errorComponent` — the catch-all for a render or route loader throwing
 * anywhere in the app, same coverage shape as `NotFoundPage`. One action, not two:
 * a crash has one clear resolution (reload), and a second choice would just be a
 * distraction here. Same banner shape as `UpdatePrompt` (`features/pwa/`) so the two
 * kinds of "the app needs you to do something" moments read consistently.
 */
export function RootErrorBanner({ error }: ErrorComponentProps) {
  const bannerRef = useRef<HTMLDivElement>(null);
  const messageId = useId();

  useEffect(() => {
    console.error(error);
    const previouslyFocused = document.activeElement;
    bannerRef.current?.focus();
    return () => {
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
    };
  }, [error]);

  return (
    <div
      ref={bannerRef}
      role="alertdialog"
      aria-labelledby={messageId}
      tabIndex={-1}
      className="fixed inset-x-0 bottom-0 z-50 flex items-center justify-between gap-4 border-t bg-background p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-lg"
    >
      <p id={messageId} className="text-sm">
        Something went wrong.
      </p>
      <Button onClick={() => window.location.reload()}>Reload</Button>
    </div>
  );
}
