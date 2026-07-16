import type { Metadata } from "next";
import { Space_Grotesk, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

/**
 * Font loading via next/font/google — fonts are self-hosted by Next.js at
 * build time (no Google DNS lookup at runtime, better privacy + performance).
 * Each font exposes a CSS custom property that globals.css and tailwind.config
 * reference, keeping the "single source of truth" contract intact.
 */

/** Display / heading font — Space Grotesk
 *  Character: geometric grotesque with subtle quirks (especially the 'a', 'g').
 *  Feels technical but designed — right for a developer-facing product heading.
 */
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

/** Body font — Inter
 *  The reliable workhorse. Stays out of the way so Space Grotesk and
 *  JetBrains Mono can do their jobs at the sizes that matter.
 */
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-body",
  weight: ["400", "500", "600"],
  display: "swap",
});

/** Monospace font — JetBrains Mono
 *  Used for every short code and URL displayed in the UI.
 *  Short links ARE the product — they deserve a deliberate typeface, not the
 *  browser default monospace stack.
 */
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  weight: ["400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "ShortLynk — Fast, Smart URL Shortener",
  description:
    "ShortLynk is a blazing-fast URL shortener built on Cloudflare Workers. Shorten links, track clicks, and gain insights — all at the edge.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${spaceGrotesk.variable} ${inter.variable} ${jetbrainsMono.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
