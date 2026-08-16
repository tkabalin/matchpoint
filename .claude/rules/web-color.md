---
paths:
  - apps/web/**
---

# Color rule

This is an always-on constraint, not a workflow to invoke. Apply it to every screen, component, or
chart without being asked. Never use a color from this file for anything other than its assigned
role.

## Navigation / brand color

**Deep blue `#045C8C`** — reserved for navigation bars, active tabs, links, and primary buttons.
This is the only color allowed to represent brand/chrome and interactive state. It must never be
reused for a category, status, or data color — if blue starts meaning "primary button" in one place
and "category 5" in another, it stops being scannable at a glance.

## Categorical / rainbow palette

Colorblind-safe (protanopia/deuteranopia) rainbow sequence. Use this set whenever multiple
categories, series, or values need distinct colors — charts, tags, legends, status chips.

| Position | Name           | Hex       | Pattern                                                                                                                |
| -------- | -------------- | --------- | ---------------------------------------------------------------------------------------------------------------------- |
| Red      | Vermillion     | `#D55E00` | Bold diagonal bands (45°)                                                                                              |
| Orange   | Orange         | `#E69F00` | Bold dots                                                                                                              |
| Yellow   | Pale yellow    | `#EDDD6E` | Bold cross-hatch                                                                                                       |
| Green    | Bluish green   | `#009E73` | Bold vertical bands                                                                                                    |
| Blue     | Deep blue      | `#045C8C` | Bold diagonal bands (-45°) — **also the nav color; do not use as a category color if nav is visible in the same view** |
| Indigo   | Dark indigo    | `#2E1A47` | Bold dots                                                                                                              |
| Violet   | Magenta purple | `#C13584` | Bold cross-hatch                                                                                                       |

> Deep blue does double duty as both the nav color and a rainbow swatch. If a screen shows both
> navigation chrome and this palette as data colors (e.g. a chart with a visible nav bar), skip blue
> as a category color on that screen to avoid the same ambiguity this file exists to prevent.

### Pattern rule

Color alone never guarantees separation for every severity of color vision deficiency. Every
categorical color must ship with its pattern — never color alone.

- **Red — bold diagonal bands, 45°**: 8×8px tile, rotated 45°, solid 4×8px band (half the tile),
  black at 50% opacity.
- **Orange — bold dots**: 10×10px tile, circle radius 2.2px centered, black at 45% opacity.
- **Yellow — bold cross-hatch**: 8×8px tile, X of two diagonal lines corner-to-corner, stroke width
  2px, black at 45% opacity.
- **Green — bold vertical bands**: 8×8px tile, solid 4×8px band (half the tile), white at 40%
  opacity.
- **Blue — bold diagonal bands, -45°**: 8×8px tile, rotated -45°, solid 4×8px band, white at 40%
  opacity. Same geometry as red, mirrored rotation — intentional, so the two are never confusable
  even under total hue loss.
- **Indigo — bold dots**: 10×10px tile, circle radius 2.2px, white at 50% opacity. Same geometry as
  orange; separated by opposite mark color and a large lightness gap.
- **Violet — bold cross-hatch**: 8×8px tile, same X geometry as yellow, black at 40% opacity.
  Separated from yellow by opposite mark color and a large lightness/saturation gap.

Rules for any new or modified pattern:

- Marks must be legible as a shape on their own — never a faint texture.
- Choose black or white per-swatch based on genuine contrast against that swatch's own base color.
- If two colors must reuse a motif, separate them by rotation/direction, mark color, or a large
  lightness gap — never let two adjacent colors share a motif _and_ similar lightness.

## Light/dark mode background rule

Every swatch must carry a visible 1px border, regardless of fill lightness. Pale colors can vanish
on a light-mode background; dark colors can vanish on a dark-mode background. Check every new or
edited color against both a light and a dark background before it ships — this applies to every
future addition to this file, not just the colors that look risky at first glance.
