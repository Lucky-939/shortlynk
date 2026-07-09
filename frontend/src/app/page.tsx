export default function HomePage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4 bg-[#0a0a0f]">
      {/* ── Hero ── */}
      <div className="text-center max-w-2xl mx-auto">
        {/* Logo / wordmark */}
        <div className="mb-6 flex items-center justify-center gap-2">
          <span className="text-4xl">🔗</span>
          <span className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-violet-400 via-fuchsia-400 to-pink-400 bg-clip-text text-transparent">
            ShortLynk
          </span>
        </div>

        <h1 className="text-5xl sm:text-6xl font-extrabold tracking-tight text-white mb-4 leading-tight">
          Shorten. Share.{" "}
          <span className="bg-gradient-to-r from-violet-400 to-pink-400 bg-clip-text text-transparent">
            Analyse.
          </span>
        </h1>

        <p className="text-lg text-slate-400 mb-10 leading-relaxed">
          A blazing-fast URL shortener built on{" "}
          <span className="text-white font-medium">Cloudflare Workers</span> and{" "}
          <span className="text-white font-medium">Pages</span>. Shorten links in
          milliseconds, track every click at the edge.
        </p>

        {/* CTA placeholder */}
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <button
            id="cta-shorten"
            className="px-8 py-3 rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white font-semibold text-base shadow-lg shadow-violet-500/30 hover:shadow-violet-500/50 hover:scale-105 transition-all duration-200 cursor-not-allowed opacity-80"
            disabled
            aria-disabled="true"
            title="Coming soon"
          >
            Shorten a URL →
          </button>
          <a
            id="cta-github"
            href="https://github.com"
            target="_blank"
            rel="noopener noreferrer"
            className="px-8 py-3 rounded-xl border border-slate-700 text-slate-300 font-semibold text-base hover:border-slate-500 hover:text-white hover:scale-105 transition-all duration-200"
          >
            View on GitHub
          </a>
        </div>
      </div>

      {/* ── Feature pills ── */}
      <div className="mt-20 flex flex-wrap gap-3 justify-center max-w-xl">
        {[
          "⚡ Edge-native",
          "📊 Click analytics",
          "🔒 No tracking cookies",
          "🌍 Global CDN",
          "☁️ Cloudflare Pages",
        ].map((feature) => (
          <span
            key={feature}
            className="px-4 py-1.5 rounded-full text-sm font-medium bg-slate-800 text-slate-300 border border-slate-700"
          >
            {feature}
          </span>
        ))}
      </div>

      {/* ── Footer ── */}
      <footer className="mt-16 text-slate-600 text-sm">
        ShortLynk — scaffold placeholder · business logic coming soon
      </footer>
    </main>
  );
}
