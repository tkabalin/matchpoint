# Third-party notices

Assets in this app that aren't covered by `pnpm-lock.yaml` (a dependency's own licence travels with
the package) and need their own credit.

## Icons

`src/components/unforced-icon.tsx`'s `UnforcedIcon` (a banana peel, used wherever the app shows a
point's unforced style) is drawn from [game-icons.net](https://game-icons.net)'s **"Banana peel"**,
by [Delapouite](http://delapouite.com), used under
[CC BY 3.0](https://creativecommons.org/licenses/by/3.0/).

**Modified from the original.** The source icon draws a boot stepping on the peel; this app uses the
peel alone, with the boot and its lace details removed and the peel's own path data rewritten to
start from an absolute point so it stands on its own. No other change was made. CC BY 3.0 asks that
a modification like this be flagged, not just the original credited — this note is that flag.

The forced/unforced pair's other half — Lucide's `BicepsFlexed`, used directly wherever
`UnforcedIcon` is — is already covered by `pnpm-lock.yaml` (ISC-licensed); no separate notice
needed.
