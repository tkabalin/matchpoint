---
paths:
  - apps/web/src/components/**
---

## Generate, Don't Hand-Build

- New UI components are added via the [shadcn/ui](https://ui.shadcn.com/) CLI
  (`pnpm exec shadcn add <component>`, run from `apps/web/`) rather than written from first
  principles. They land in `src/components/ui/` as editable source.
- The `base-luma` style in `apps/web/components.json` builds on **Base UI** (`@base-ui/react`), not
  Radix — older shadcn examples target Radix and won't apply verbatim.
- Follow the composition, styling, and forms conventions in `.claude/skills/shadcn/`. The `shadcn`
  MCP server (in `.mcp.json`) is separate — it only provides registry search/view/install-command
  lookup, not these conventions.
