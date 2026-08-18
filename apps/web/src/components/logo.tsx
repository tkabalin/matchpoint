import logoDark from "@/assets/logo-dark.png";
import logoDarkCompact from "@/assets/logo-dark-compact.png";
import logoLight from "@/assets/logo-light.png";
import logoLightCompact from "@/assets/logo-light-compact.png";
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
 * The MatchPoint mark.
 *
 * Always the light asset for now. A `prefers-color-scheme` swap was tried and
 * backed out: nothing in the app ever applies the `.dark` class (checked — no
 * toggle, no system-preference listener exists anywhere), so a coach with a dark OS
 * theme got the dark logo alone, floating as a black box on an otherwise all-white
 * page. The dark asset stays imported and ready; wiring it in belongs with actually
 * building the app's dark theme, not before it.
 */
export function Logo({
  size = "compact",
  className,
}: {
  size?: keyof typeof VARIANTS;
  className?: string;
}) {
  const variant = VARIANTS[size];

  return (
    <img
      src={variant.light}
      alt="MatchPoint"
      className={cn(variant.className, "w-auto", className)}
    />
  );
}
