# ShortLynk Design Tokens — THEME.md

A deliberately small design system. Enough identity to not look like a template;
small enough to apply consistently by hand across every component.

---

## Direction

**"Terminal meets editorial."**

Developer tool energy — decisive, structured, monochromatic foundation with one
loud accent. Dark-mode first. Not another blue/purple SaaS gradient.

---

## Color Palette

| Token              | Value     | Usage                                      |
|--------------------|-----------|---------------------------------------------|
| `--color-bg`       | `#0D0D0B` | Page background — near-black, slightly warm |
| `--color-surface`  | `#161614` | Cards, panels, sidebar                     |
| `--color-raised`   | `#1E1E1A` | Hover state surfaces, nested cards          |
| `--color-border`   | `#2A2A26` | Dividers, input borders, card outlines      |
| `--color-text`     | `#F0EDE8` | Primary text — warm white, not pure #fff    |
| `--color-muted`    | `#7A7670` | Secondary labels, placeholder text          |
| `--color-accent`   | `#E8FF47` | THE accent — electric chartreuse            |
| `--color-accent-h` | `#D4EB38` | Accent hover/pressed                        |
| `--color-success`  | `#4ADE80` | Positive states, copy confirmations         |
| `--color-error`    | `#F87171` | Errors, destructive actions                 |

### Why chartreuse?
`#E8FF47` reads immediately as "live / active / online" — a terminal cursor
blink colour. Extremely rare in SaaS (most reach for indigo or teal), so it
creates genuine differentiation. The warm undertone (slightly yellow-green, not
neon) keeps it from reading as garish on the warm-dark background.

---

## Typography

| Role    | Font             | Weights    | Usage                                       |
|---------|------------------|------------|---------------------------------------------|
| Display | **Space Grotesk**| 400–700    | Page headings, hero, dashboard section titles |
| Body    | **Inter**        | 400–600    | Paragraphs, labels, UI copy                 |
| Mono    | **JetBrains Mono**| 400–600   | Short codes, URLs, stats numbers            |

### Typographic scale (rem, 4px base)
```
text-xs   0.75rem  / 12px   — badge labels, timestamps
text-sm   0.875rem / 14px   — secondary body, table cells
text-base 1rem     / 16px   — primary body
text-lg   1.125rem / 18px   — emphasized body, card titles
text-xl   1.25rem  / 20px   — small section headings
text-2xl  1.5rem   / 24px   — section headings
text-3xl  1.875rem / 30px   — page headings
text-4xl  2.25rem  / 36px   — hero
text-5xl  3rem     / 48px   — hero display
```

**Rule:** Display font for anything `text-2xl` and above. Inter for everything
below that. JetBrains Mono for any string that IS a URL or short code.

---

## Spacing / Sizing Rhythm

4px base grid — stick to Tailwind's default scale. The named semantic sizes:

| Semantic name | Tailwind class | px  | Usage                        |
|---------------|---------------|-----|-------------------------------|
| nano          | `p-1`         | 4   | Tight internal padding        |
| xs            | `p-2`         | 8   | Icon buttons, badge padding   |
| sm            | `p-3`         | 12  | Input padding, small cards    |
| md            | `p-4`         | 16  | Standard card padding         |
| lg            | `p-6`         | 24  | Section padding               |
| xl            | `p-8`         | 32  | Page section gaps             |
| 2xl           | `p-12`        | 48  | Hero spacing                  |
| 3xl           | `p-16`        | 64  | Top-level page padding        |

**Never use arbitrary values** (`p-[13px]`, `mt-[7px]`). If the scale doesn't
cover it, round to the nearest step.

---

## The ONE Visual Motif: Sharp Rectangles + Left-Border Accent

**Zero border-radius everywhere.** No `rounded-lg`, no pill buttons.
The app uses flat, rectangular, grid-aligned forms throughout.

**The single decorative touch:** a `2px` left border in `--color-accent` on
anything "active", "selected", "focused", or "featured":

```
active nav item:   border-l-2 border-accent
focused input:     border-b-2 border-accent   (underline style, not box)
primary button:    bg-accent text-bg (flat rectangle, no shadow, no radius)
card hover:        border-l-2 border-accent transition
stat highlight:    left accent bar on metric cards
```

This motif is deliberately minimal — one recurring element. It creates the
"terminal cursor" association and gives every interactive element a consistent
personality without needing gradients, shadows, or animations.

### Applied examples

```
Button (primary):  bg-accent text-bg font-semibold px-4 py-2 [no rounded]
Button (ghost):    border border-border text-text px-4 py-2 hover:border-accent
Input:             bg-surface border-b border-border focus:border-b-2 focus:border-accent
Card:              bg-surface border border-border hover:border-l-2 hover:border-l-accent
Badge:             bg-raised text-muted text-xs px-2 py-0.5 font-mono
Short code display: font-mono text-accent
```

---

## What to Avoid

- `rounded-lg`, `rounded-full` — reserved for avatars only
- Box shadows (`shadow-*`) — elevation is expressed via border, not shadow
- Gradients on interactive elements — accent is flat
- Multiple accent colors — `--color-accent` is the only chromatic color in the UI
- Decorative illustrations — let the typography and data carry the page

---

## Quick Reference Card

```css
/* In any component, reach for these before anything else: */
bg-bg          /* page background     */
bg-surface     /* card/panel bg       */
bg-raised      /* hover surface       */
border-border  /* all borders         */
text-text      /* primary copy        */
text-muted     /* secondary copy      */
text-accent    /* links, active items */
bg-accent      /* primary CTA button  */
font-display   /* headings ≥ 2xl      */
font-mono      /* any URL / shortCode */
```
