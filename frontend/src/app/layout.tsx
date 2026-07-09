import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ShortLynk — Fast, Smart URL Shortener",
  description:
    "ShortLynk is a blazing-fast URL shortener built on Cloudflare Workers and Pages. Shorten links, track clicks, and gain insights — all at the edge.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
