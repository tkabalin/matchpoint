import logoDark from "@/assets/logo-dark.png";
import logoDarkCompact from "@/assets/logo-dark-compact.png";
import logoLight from "@/assets/logo-light.png";
import logoLightCompact from "@/assets/logo-light-compact.png";
import { usePrefersDark } from "@/lib/use-prefers-dark";
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
 * The MatchPoint mark. Swaps light/dark asset by the live OS preference (#176) —
 * `usePrefersDark` rather than a `dark:` CSS variant, since this picks between two
 * whole image assets rather than a color, and a single `<img>` keeps one accessible
 * name instead of two same-alt nodes racing in the DOM.
 */
export function Logo({
  size = "compact",
  className,
}: {
  size?: keyof typeof VARIANTS;
  className?: string;
}) {
  const variant = VARIANTS[size];
  const isDark = usePrefersDark();

  return (
    <img
      src={isDark ? variant.dark : variant.light}
      alt="MatchPoint"
      className={cn(variant.className, "w-auto", className)}
    />
  );
}
