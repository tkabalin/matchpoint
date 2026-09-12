/**
 * The app-wide icon for a point's unforced style — see .claude/rules/web-icons.md's
 * "Point-ender style: Unforced" row and THIRD_PARTY_NOTICES.md for the licence this is
 * under. An unforced error is a self-inflicted, avoidable one — the same joke a banana
 * peel makes.
 *
 * A real line-art pictogram, not hand-drawn — but cropped down from game-icons.net's
 * "Banana peel" (CC BY 3.0), which draws a boot stepping on the peel rather than the
 * peel alone. The path data below is exactly that icon's own peel subpaths, with the
 * boot and its lace details left out and the first point rewritten from a relative to
 * an absolute move so the peel stands as a complete path by itself — the only change
 * made, and CC BY 3.0 asks that a change like this be flagged, not just the icon
 * credited (see THIRD_PARTY_NOTICES.md).
 *
 * Forced's own icon (a single flexed arm) needs none of this: it's Lucide's own
 * `BicepsFlexed`, imported directly wherever this is — arm-wrestling itself doesn't
 * exist as a pictogram in any freely-licensed icon set searched.
 */

import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

/** "Banana peel" (peel subpaths only), by Delapouite (http://delapouite.com). */
export function UnforcedIcon({ className, ...props }: IconProps) {
  return (
    <svg viewBox="6.4 297.9 499.1 213.8" className={className} aria-hidden="true" {...props}>
      <path
        fill="currentColor"
        d="M216.158 317.867c-1.93.008-3.322.324-4.496.645c1.007 12.28 1.89 21.67 2.22 26.802c.135 2.085.15 3.93.138 5.784c5.136-1.573 10.24-2.392 15.253-2.528c1.41-5.27 4.942-11.547 12.27-19.783c.183-.285.252-.444.257-.375c.006.09.015-.237-.63-1.074c-1.287-1.674-5.192-4.53-10.03-6.442c-4.838-1.91-10.546-3.048-14.98-3.03zm-153.174 46.27c-.936.143-1.622.452-2.5 1.345c-1.18 1.202-2.628 3.658-3.654 7.282c-2.052 7.246-2.28 18.665-.166 30.36c2.114 11.693 6.475 23.732 12.395 32.85c2.324 3.58 4.842 6.625 7.505 9.112c15.763-4.76 32.333-8.89 47.444-11.45c-24.98-15.224-38.57-30.71-46.569-43.736c-5.478-8.922-8.535-16.58-10.925-21.113c-1.99-3.773-2.544-4.354-3.53-4.65m168.97 1.773c-6.16-.012-12.7 1.703-19.94 5.326c-2.462 1.232-4.116 3.314-5.463 7.98c-1.348 4.664-1.838 11.484-1.476 19.26c.724 15.547 4.603 34.716 7.23 51.08l2.882 17.936l-16.014-8.572c-18.284-9.787-35.306-11.132-54.543-9.754c-20.922 1.498-52.502 9.324-78.234 18.08c-12.865 4.378-24.37 9.007-32.316 12.98c-3.467 1.734-5.86 3.234-7.635 4.467c1.764 2.986 4.14 4.224 8.172 5.217c5.598 1.38 14.486.904 24.733-1.045c20.493-3.897 45.75-13.088 67.92-14.85c35.257-2.805 75.38 10.294 97.177 11.417c7.785.4 17.53 1.202 24.658.332c3.565-.435 6.33-1.335 7.64-2.14c1.097-.67 1.298-.95 1.478-1.755c-.266-1.334-.757-3.473-1.473-6.292c-1.533-6.03-3.872-14.574-6.338-23.683c-4.93-18.22-10.373-37.42-11.28-48.15l17.165-4.48c14.838 32.71 20.124 55.845 23.88 69.555c1.88 6.855 3.6 11.144 4.57 12.47c.967 1.328.13 1.122 3.237 1.122h.49l.48.053c7.68.833 28.17-2.197 45.196-5.883c17.027-3.686 31.438-7.666 31.438-7.666l.5-.137l.51-.08c34.406-5.364 65.797 8.805 88.408 17.04c11.305 4.118 20.553 6.367 24.81 5.844c2.13-.262 2.894-.67 3.95-1.836c.543-.6 1.174-1.598 1.79-3.04c-19.358-13.836-68.408-45.78-102.544-49.49c-11.62-1.264-25.05-1.387-36.828.805c-11.777 2.193-21.532 6.655-27.288 13.49l-9.603 11.405l-5.62-13.81c-12.367-30.39-27.037-55.573-42.538-69.596c-9.69-8.765-18.912-13.582-29.182-13.602zm241.204 19.565c-19.144 11.233-45.09 23.978-73.46 36.513c10.647 2.604 21.453 6.62 31.908 11.352c32.338-10.455 41.97-22.153 44.207-30.647c1.52-5.77-.156-11.773-2.654-17.218z"
      />
    </svg>
  );
}
