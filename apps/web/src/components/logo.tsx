import logoDark from "@/assets/logo-dark.png";
import logoDarkCompact from "@/assets/logo-dark-compact.png";
import logoLight from "@/assets/logo-light.png";
import logoLightCompact from "@/assets/logo-light-compact.png";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

const VARIANTS = {
  // The persistent mark in the app chrome header — wordmark only, no tagline: at
  // this height the tagline's own type would be a handful of pixels tall and read
  // as noise, not text.
  compact: { light: logoLightCompact, dark: logoDarkCompact, className: "h-7" },
  // The auth screens' large mark above the card, roomy enough for the full lockup.
  hero: { light: logoLight, dark: logoDark, className: "h-16" },
} as const;

/**
 * The MatchPoint mark. Swaps light/dark asset by the coach's own stored theme
 * choice (#182, #200) — `useTheme` rather than a `dark:` CSS variant, since this
 * picks between two whole image assets rather than a color, and a single `<img>`
 * keeps one accessible name instead of two same-alt nodes racing in the DOM. This
 * used to read the OS preference independently of the rest of the app, which is
 * exactly what let the logo and everything else disagree under PWA caching.
 */
export function Logo({
  size = "compact",
  className,
}: {
  size?: keyof typeof VARIANTS;
  className?: string;
}) {
  const variant = VARIANTS[size];
  const [theme] = useTheme();
  const isDark = theme === "dark";

  return (
    <img
      src={isDark ? variant.dark : variant.light}
      alt="MatchPoint"
      className={cn(variant.className, "w-auto", className)}
    />
  );
}
