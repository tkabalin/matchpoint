import { Toaster as Sonner, type ToasterProps } from "sonner";
import {
  CircleCheckIcon,
  InfoIcon,
  TriangleAlertIcon,
  OctagonXIcon,
  Loader2Icon,
} from "lucide-react";

import { useTheme } from "@/lib/theme";

const Toaster = ({ ...props }: ToasterProps) => {
  const [theme] = useTheme();

  return (
    <Sonner
      theme={theme}
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast",
          // Every info toast today is a one-line tip with no action of its own — see
          // match-header.tsx and note-button.tsx's own "press and hold" nudges — so it
          // has nothing to be tapped for. Without this it still sits in the pointer-event
          // path of whatever renders under it, which on a narrow viewport can be a
          // dialog's own button (a stuck "press and hold" toast blocked the Undo
          // confirmation's button on mobile WebKit in e2e).
          info: "pointer-events-none",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
