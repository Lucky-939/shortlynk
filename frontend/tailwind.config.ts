import type { Config } from "tailwindcss";

/**
 * ShortLynk Tailwind config — mirrors the design tokens in THEME.md.
 *
 * Colors reference CSS custom properties defined in globals.css so that both
 * Tailwind utility classes (bg-accent, text-muted, etc.) and raw CSS (var())
 * always stay in sync from a single source of truth.
 *
 * MOTIF RULE: No border-radius on interactive elements. Use rounded-full ONLY
 * for avatar images. Everything else stays rectangular — this is deliberate.
 */
const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    // ── Override defaults rather than extend where we want strict control ──
    borderRadius: {
      // "none" is the default personality of this UI.
      // Only expose the values we actually intend to use.
      none: "0px",
      sm: "2px",   // micro: badge corners, the only exception
      full: "9999px", // avatars only
    },

    extend: {
      // ── Color palette — all reference CSS custom properties ──────────────
      colors: {
        bg:       "var(--color-bg)",
        surface:  "var(--color-surface)",
        raised:   "var(--color-raised)",
        border:   "var(--color-border)",
        text:     "var(--color-text)",
        muted:    "var(--color-muted)",
        accent:   "var(--color-accent)",
        "accent-h": "var(--color-accent-h)",
        success:  "var(--color-success)",
        error:    "var(--color-error)",
      },

      // ── Font families — variables injected by next/font in layout.tsx ────
      fontFamily: {
        display: ["var(--font-display)", "system-ui", "sans-serif"],
        sans:    ["var(--font-body)",    "system-ui", "sans-serif"],
        mono:    ["var(--font-mono)",    "monospace"],
      },

      // ── Typographic scale — no changes to Tailwind defaults, documented ──
      // text-xs  0.75rem   badge labels, timestamps
      // text-sm  0.875rem  secondary body, table cells
      // text-base 1rem     primary body
      // text-lg  1.125rem  card titles
      // text-xl  1.25rem   small headings
      // text-2xl 1.5rem    section headings  ← switch to font-display here
      // text-3xl 1.875rem  page headings
      // text-4xl 2.25rem   hero
      // text-5xl 3rem      hero display

      // ── Left-border accent width (the motif) ────────────────────────────
      // Use `border-l-[3px]` for the accent left border — thick enough to
      // read as intentional, thin enough to not compete with content.
      borderWidth: {
        "3": "3px",
      },

      // ── Transitions — keep everything snappy, nothing elaborate ─────────
      transitionDuration: {
        DEFAULT: "120ms",
      },
      transitionTimingFunction: {
        DEFAULT: "ease-out",
      },
    },
  },
  plugins: [],
};

export default config;
