# Customization & Theming

Components reference semantic CSS variable tokens. Change the variables to change every component.

## Contents

- How it works (CSS variables → Tailwind utilities → components)
- Color variables and OKLCH format
- Dark mode setup
- Changing the theme (presets, CSS variables)
- Adding custom colors (Tailwind v3 and v4)
- Border radius
- Customizing components (variants, className, wrappers)
- Checking for updates

---

## How It Works

1. CSS variables defined in `:root` (light) and `.dark` (dark mode).
2. Tailwind maps them to utilities: `bg-primary`, `text-muted-foreground`, etc.
3. Components use these utilities — changing a variable changes all components that reference it.

---

## Color Variables

Every color follows the `name` / `name-foreground` convention. The base variable is for backgrounds, `-foreground` is for text/icons on that background.

| Variable                                     | Purpose                          |
| -------------------------------------------- | -------------------------------- |
| `--background` / `--foreground`              | Page background and default text |
| `--card` / `--card-foreground`               | Card surfaces                    |
| `--primary` / `--primary-foreground`         | Primary buttons and actions      |
| `--secondary` / `--secondary-foreground`     | Secondary actions                |
| `--muted` / `--muted-foreground`             | Muted/disabled states            |
| `--accent` / `--accent-foreground`           | Hover and accent states          |
| `--destructive` / `--destructive-foreground` | Error and destructive actions    |
| `--border`                                   | Default border color             |
| `--input`                                    | Form input borders               |
| `--ring`                                     | Focus ring color                 |
| `--chart-1` through `--chart-5`              | Chart/data visualization — **MatchPoint-specific caveat below** |
| `--sidebar-*`                                | Sidebar-specific colors          |
| `--surface` / `--surface-foreground`         | Secondary surface                |

Colors use OKLCH: `--primary: oklch(0.205 0 0)` where values are lightness (0–1), chroma (0 = gray), and hue (0–360).

> **MatchPoint-specific:** `--chart-1` through `--chart-5` are installed but currently a single
> blue hue at five lightness steps, not five distinct categorical colors — they're the *default*
> treatment for a single-series or non-categorical chart. The moment a chart needs to represent one
> of MatchPoint's real categories (point outcomes, a squad metric, anything
> [`.claude/rules/web-color.md`](../../rules/web-color.md) already assigns a hex to), use that
> seven-color categorical palette instead, never `--chart-*` — see that file's "Dashboard color
> roles" section and [`.claude/rules/web-shadcn-defaults.md`](../../rules/web-shadcn-defaults.md)'s
> "Chart colors" section for the exact rule.

---

## Dark Mode

Class-based toggle via `.dark` on the root element — this part matches MatchPoint. **Do not use
`next-themes`, and do not offer a "System" option that reads `prefers-color-scheme`, in this
project specifically.** MatchPoint's theme is decided solely by an in-app toggle
(`apps/web/src/lib/theme.ts`'s `useTheme`/`applyTheme`, wired to Settings > App > Appearance) with
no OS-preference read anywhere — see [`.claude/rules/web.md`](../../rules/web.md)'s "Dark mode —
toggle-only" section for why (two independent OS-preference reads drifted out of sync under PWA
caching, which is what originally broke this). `next-themes` was pulled in once by this skill's own
generated `sonner.tsx` wrapper and removed — that wrapper now reads `useTheme()` from `theme.ts`
instead, the pattern to follow for any other component needing the resolved theme.

The snippet below is the generic/stock pattern this skill otherwise ships — useful context for how
`next-themes` normally works, not something to install here:

```tsx
import { ThemeProvider } from "next-themes"

<ThemeProvider attribute="class" defaultTheme="system" enableSystem>
  {children}
</ThemeProvider>
```

---

## Changing the Theme

```bash
# Apply a preset code from ui.shadcn.com.
npx shadcn@latest apply --preset a2r6bw

# Positional shorthand also works.
npx shadcn@latest apply a2r6bw

# Switch to a named preset and overwrite existing components.
npx shadcn@latest apply --preset nova

# Preserve existing components instead.
npx shadcn@latest init --preset nova --force --no-reinstall

# Use a custom theme URL.
npx shadcn@latest apply --preset "https://ui.shadcn.com/init?base=radix&style=nova&theme=blue&..."
```

Or edit CSS variables directly in `globals.css`.

---

## Adding Custom Colors

Add variables to the file at `tailwindCssFile` from `npx shadcn@latest info` (typically `globals.css`). Never create a new CSS file for this.

```css
/* 1. Define in the global CSS file. */
:root {
  --warning: oklch(0.84 0.16 84);
  --warning-foreground: oklch(0.28 0.07 46);
}
.dark {
  --warning: oklch(0.41 0.11 46);
  --warning-foreground: oklch(0.99 0.02 95);
}
```

```css
/* 2a. Register with Tailwind v4 (@theme inline). */
@theme inline {
  --color-warning: var(--warning);
  --color-warning-foreground: var(--warning-foreground);
}
```

When `tailwindVersion` is `"v3"` (check via `npx shadcn@latest info`), register in `tailwind.config.js` instead:

```js
// 2b. Register with Tailwind v3 (tailwind.config.js).
module.exports = {
  theme: {
    extend: {
      colors: {
        warning: "oklch(var(--warning) / <alpha-value>)",
        "warning-foreground":
          "oklch(var(--warning-foreground) / <alpha-value>)",
      },
    },
  },
}
```

```tsx
// 3. Use in components.
<div className="bg-warning text-warning-foreground">Warning</div>
```

---

## Border Radius

`--radius` controls border radius globally. Stock shadcn derives a small handful of values from it
(`rounded-lg` = `var(--radius)`, `rounded-md` = `calc(var(--radius) - 2px)`) — **that stock scale is
not what MatchPoint uses.**

`apps/web/src/app.css` defines an extended seven-step scale, each a multiple of one base
`--radius: 0.45rem`: `--radius-sm` (`0.6×`) through `--radius-4xl` (`2.6×`). And per
[`.claude/rules/web-shadcn-defaults.md`](../../rules/web-shadcn-defaults.md)'s "Radius" section,
every rectangular component in this project is prescribed to use `rounded-sm` specifically — the
small end of that scale, not `rounded-lg`/`rounded-md` as the stock example above implies is
typical — with `rounded-full` reserved for genuinely circular elements. That migration isn't fully
finished: `apps/web/src/components/ui/card.tsx`'s `CardHeader`/`CardFooter` are a known, tracked
straggler still on `rounded-t-4xl`/`rounded-b-4xl`, a live example of the drift to watch for when
touching any `components/ui/` file. Check `.claude/rules/web-shadcn-defaults.md` before assuming
any radius value you see in an existing component is the pattern to copy.

---

## Customizing Components

See also: [rules/styling.md](./rules/styling.md) for Incorrect/Correct examples.

Prefer these approaches in order:

### 1. Built-in variants

```tsx
<Button variant="outline" size="sm">
  Click
</Button>
```

### 2. Tailwind classes via `className`

```tsx
<Card className="mx-auto max-w-md">...</Card>
```

### 3. Add a new variant

Edit the component source to add a variant via `cva`:

```tsx
// components/ui/button.tsx
warning: "bg-warning text-warning-foreground hover:bg-warning/90",
```

### 4. Wrapper components

Compose shadcn/ui primitives into higher-level components:

```tsx
export function ConfirmDialog({ title, description, onConfirm, children }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{children}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Confirm</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
```

---

## Checking for Updates

```bash
npx shadcn@latest add button --diff
```

To preview exactly what would change before updating, use `--dry-run` and `--diff`:

```bash
npx shadcn@latest add button --dry-run        # see all affected files
npx shadcn@latest add button --diff button.tsx # see the diff for a specific file
```

See [Updating Components in SKILL.md](./SKILL.md#updating-components) for the full smart merge workflow.
