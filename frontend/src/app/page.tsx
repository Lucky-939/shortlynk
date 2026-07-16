"use client";

import NavBar from "@/components/NavBar";
import ShortenForm from "@/components/ShortenForm";
import { useAuth } from "@/components/AuthProvider";

const STEPS = [
  {
    n: "01",
    title: "Paste your URL",
    body: "Drop any long link into the box. Optionally add a custom alias.",
  },
  {
    n: "02",
    title: "Get your short link",
    body: "We return a short code instantly — hosted at the edge in 300+ cities.",
  },
  {
    n: "03",
    title: "Track every click",
    body: "See total clicks, hourly trends, and top referrers from your dashboard.",
  },
];

export default function HomePage() {
  const { user } = useAuth();

  return (
    <>
      <NavBar />
      <main className="max-w-5xl mx-auto px-4">

        {/* ── Hero ─────────────────────────────────────────────────────── */}
        <section className="pt-24 pb-16 text-center">
          <div className="inline-block border border-border px-3 py-1 mb-6">
            <span className="text-xs font-mono text-muted uppercase tracking-widest">
              Built on Cloudflare Workers
            </span>
          </div>

          <h1 className="font-display text-5xl sm:text-6xl font-bold text-text mb-5 leading-[1.1] tracking-tight">
            Short links that<br />
            <span className="text-accent">actually tell you things.</span>
          </h1>

          <p className="text-muted text-lg max-w-xl mx-auto mb-12 leading-relaxed">
            Shorten URLs in milliseconds, track clicks at the edge.
            No bloat. No tracking pixels. Just clean analytics.
          </p>

          {/* Shorten box */}
          <div className="max-w-xl mx-auto">
            <ShortenForm placeholder="Paste a long URL to shorten it…" />
            {!user && (
              <p className="text-muted text-xs mt-3 font-mono">
                ↑ Hit Shorten — you'll be asked to sign in first.
              </p>
            )}
          </div>
        </section>

        {/* ── Divider ───────────────────────────────────────────────────── */}
        <div className="border-t border-border" />

        {/* ── How it works ──────────────────────────────────────────────── */}
        <section className="py-20">
          <h2 className="font-display text-2xl font-semibold text-text mb-12 text-center">
            How it works
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8">
            {STEPS.map((step) => (
              <div key={step.n} className="border border-border bg-surface p-6">
                <span className="font-mono text-accent text-xs mb-3 block">{step.n}</span>
                <h3 className="font-display font-semibold text-text text-lg mb-2">
                  {step.title}
                </h3>
                <p className="text-muted text-sm leading-relaxed">{step.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Footer ────────────────────────────────────────────────────── */}
        <footer className="border-t border-border py-8 flex items-center justify-between text-muted text-xs font-mono flex-wrap gap-4">
          <span>ShortLynk — edge-native URL shortener</span>
          <a
            href="https://github.com/Lucky-939/shortlynk"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-accent transition-colors"
          >
            GitHub →
          </a>
        </footer>
      </main>
    </>
  );
}
