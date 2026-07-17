"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { getLinkStats, ApiError, type LinkStats } from "@/lib/api";
import { useAuth } from "@/components/AuthProvider";
import NavBar from "@/components/NavBar";
import LiveIndicator from "@/components/LiveIndicator";
import CopyButton from "@/components/CopyButton";

const REDIRECT_BASE = process.env.NEXT_PUBLIC_REDIRECT_BASE_URL ?? "";
const POLL_INTERVAL_MS = 2000;

// ── Animated counter ──────────────────────────────────────────────────────────

function useAnimatedNumber(target: number, duration = 600) {
  const [display, setDisplay] = useState(target);
  const prev = useRef(target);
  useEffect(() => {
    if (prev.current === target) return;
    const start = prev.current;
    const diff = target - start;
    const startTime = performance.now();
    const tick = (now: number) => {
      const t = Math.min((now - startTime) / duration, 1);
      const ease = 1 - Math.pow(1 - t, 3); // ease-out cubic
      setDisplay(Math.round(start + diff * ease));
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    prev.current = target;
  }, [target, duration]);
  return display;
}

// ── Bar chart with hover tooltips ─────────────────────────────────────────────

function HourlyChart({ data }: { data: LinkStats["hourly"] }) {
  const [hovered, setHovered] = useState<number | null>(null);

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-muted text-sm font-mono">
        No clicks in the last 24 hours
      </div>
    );
  }

  const max = Math.max(...data.map((d) => d.count), 1);

  return (
    <div className="relative">
      <div className="flex items-end gap-1 h-40 pb-6">
        {data.map((d, i) => {
          const heightPct = (d.count / max) * 100;
          const isHov = hovered === i;
          // Format hour label: "21:00"
          const label = d.hour.slice(11) + ":00";
          return (
            <div
              key={d.hour}
              className="relative flex-1 flex flex-col items-center justify-end h-full group cursor-default"
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
            >
              {/* Tooltip */}
              {isHov && (
                <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 z-10 bg-raised border border-border px-2 py-1 text-xs font-mono text-text whitespace-nowrap pointer-events-none">
                  <span className="text-accent">{d.count}</span>{" "}
                  <span className="text-muted">click{d.count !== 1 ? "s" : ""}</span>
                  <div className="text-muted mt-0.5">{label}</div>
                </div>
              )}
              {/* Bar */}
              <div
                className="w-full transition-colors duration-150"
                style={{
                  height: `${heightPct}%`,
                  minHeight: "3px",
                  background: isHov ? "var(--color-accent-h)" : "var(--color-accent)",
                  opacity: isHov ? 1 : 0.85,
                }}
              />
            </div>
          );
        })}
      </div>
      {/* X-axis baseline */}
      <div className="absolute bottom-6 left-0 right-0 h-px bg-border" />
    </div>
  );
}

// ── Referrer bar ──────────────────────────────────────────────────────────────

function ReferrerRow({
  referrer,
  count,
  maxCount,
  rank,
}: {
  referrer: string;
  count: number;
  maxCount: number;
  rank: number;
}) {
  const pct = maxCount > 0 ? (count / maxCount) * 100 : 0;
  return (
    <div className="relative flex items-center gap-4 px-4 py-3 group hover:bg-raised transition-colors">
      {/* Progress fill */}
      <div
        className="absolute inset-0 bg-accent/5 pointer-events-none"
        style={{ width: `${pct}%` }}
      />
      <span className="font-mono text-xs text-muted w-4 shrink-0 z-10">{rank}</span>
      <span className="font-mono text-sm text-text truncate flex-1 min-w-0 z-10" title={referrer}>
        {referrer}
      </span>
      <span className="font-mono text-sm text-accent shrink-0 z-10">{count.toLocaleString()}</span>
    </div>
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
  accent = false,
}: {
  label: string;
  value: string | number;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`bg-surface border border-border p-5 flex flex-col gap-1 ${
        accent ? "border-l-[3px] border-l-accent" : ""
      }`}
    >
      <p className="text-xs font-mono text-muted uppercase tracking-widest">{label}</p>
      <p className="font-display text-3xl font-bold text-text leading-none mt-1">{value}</p>
      {sub && <p className="text-xs font-mono text-muted mt-1">{sub}</p>}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function StatsClient() {
  const { user, logout, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const shortCode = searchParams.get("code") ?? "";

  const [stats, setStats] = useState<LinkStats | null>(null);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Animated total clicks
  const animatedTotal = useAnimatedNumber(stats?.totalClicks ?? 0);

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [authLoading, user, router]);

  useEffect(() => {
    if (!shortCode) router.replace("/dashboard");
  }, [shortCode, router]);

  const fetchStats = useCallback(async () => {
    if (!user || !shortCode) return;
    try {
      const data = await getLinkStats(shortCode, user.token);
      setStats(data);
      setError(null);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401) { logout(); router.replace("/login"); return; }
        if (err.status === 404) { setError("Link not found."); return; }
        if (err.status === 403) { setError("You don't have access to this link's stats."); return; }
        setError(err.message);
      } else {
        setError("Could not load stats. Is the analytics service running?");
      }
    } finally {
      setFetching(false);
    }
  }, [user, shortCode, logout, router]);

  useEffect(() => {
    if (!user || !shortCode) return;
    const startPolling = () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
      fetchStats();
      pollingRef.current = setInterval(fetchStats, POLL_INTERVAL_MS);
    };
    startPolling();
    const onVisibility = () => { if (document.visibilityState === "visible") startPolling(); };
    const onPageShow = (e: PageTransitionEvent) => { if (e.persisted) startPolling(); };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [user, shortCode, fetchStats]);

  if (authLoading || (!user && !error)) return null;
  if (!shortCode) return null;

  const shortUrl = `${REDIRECT_BASE}/${shortCode}`;

  // Derived stats
  const peakHour = stats?.hourly.reduce(
    (best, h) => (h.count > (best?.count ?? 0) ? h : best),
    null as LinkStats["hourly"][0] | null
  );
  const peakLabel = peakHour ? peakHour.hour.slice(11) + ":00 UTC" : "—";
  const topReferrer = stats?.topReferrers[0]?.referrer ?? "—";
  const maxReferrerCount = stats?.topReferrers[0]?.count ?? 1;

  return (
    <>
      <NavBar />
      <main className="max-w-4xl mx-auto px-4 py-10">

        {/* Breadcrumb */}
        <nav className="mb-6 text-sm" aria-label="Breadcrumb">
          <Link href="/dashboard" className="text-muted hover:text-accent transition-colors font-mono text-xs">
            ← Dashboard
          </Link>
        </nav>

        {/* Header */}
        <div className="flex items-start justify-between gap-4 mb-8 flex-wrap">
          <div>
            <div className="flex items-center gap-3 mb-1 flex-wrap">
              <span className="font-mono text-accent text-2xl font-semibold tracking-tight">
                {shortCode}
              </span>
              <CopyButton text={shortUrl} />
              <LiveIndicator />
            </div>
            <p className="text-muted text-xs font-mono">{shortUrl}</p>
          </div>
        </div>

        {fetching ? (
          /* Skeleton */
          <div className="space-y-6 animate-pulse">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="bg-surface border border-border h-24" />
              ))}
            </div>
            <div className="bg-surface border border-border h-52" />
            <div className="bg-surface border border-border h-32" />
          </div>
        ) : error ? (
          <div className="border border-error/30 bg-error/5 px-6 py-5">
            <p className="text-error font-mono text-sm mb-3">{error}</p>
            <button
              onClick={fetchStats}
              className="text-xs font-mono text-muted border border-border px-3 py-1.5 hover:border-accent hover:text-accent transition-colors"
            >
              Retry
            </button>
          </div>
        ) : stats ? (
          <div className="space-y-6">

            {/* ── Stat cards row ── */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="bg-surface border border-border border-l-[3px] border-l-accent p-5 col-span-2 md:col-span-1 flex flex-col gap-1">
                <p className="text-xs font-mono text-muted uppercase tracking-widest">Total clicks</p>
                <p className="font-display text-4xl font-bold text-accent leading-none mt-1">
                  {animatedTotal.toLocaleString()}
                </p>
                <p className="text-xs font-mono text-muted mt-1">all time</p>
              </div>

              <StatCard
                label="Last hour"
                value={
                  stats.hourly.find(h => h.hour === new Date().toISOString().slice(0, 13))?.count ?? 0
                }
                sub="clicks"
              />
              <StatCard label="Peak hour" value={peakLabel} sub={peakHour ? `${peakHour.count} clicks` : undefined} />
              <StatCard label="Top source" value={topReferrer} sub={stats.topReferrers[0] ? `${stats.topReferrers[0].count} clicks` : undefined} />
            </div>

            {/* ── Hourly chart ── */}
            <section className="bg-surface border border-border p-6">
              <div className="flex items-center justify-between mb-5">
                <h2 className="font-display text-base font-semibold text-text">
                  Last 24 hours
                </h2>
                <span className="text-xs font-mono text-muted">
                  {stats.hourly.reduce((s, h) => s + h.count, 0)} clicks shown
                </span>
              </div>
              <HourlyChart data={stats.hourly} />
            </section>

            {/* ── Top referrers ── */}
            <section className="bg-surface border border-border">
              <div className="px-6 py-4 border-b border-border flex items-center justify-between">
                <h2 className="font-display text-base font-semibold text-text">Top referrers</h2>
                <span className="text-xs font-mono text-muted">
                  {stats.topReferrers.length} source{stats.topReferrers.length !== 1 ? "s" : ""}
                </span>
              </div>
              {stats.topReferrers.length === 0 ? (
                <div className="px-6 py-8 text-muted text-sm font-mono">
                  No referrer data yet — share your link to start tracking.
                </div>
              ) : (
                <div className="divide-y divide-border overflow-hidden">
                  {stats.topReferrers.map((ref, i) => (
                    <ReferrerRow
                      key={ref.referrer}
                      referrer={ref.referrer}
                      count={ref.count}
                      maxCount={maxReferrerCount}
                      rank={i + 1}
                    />
                  ))}
                </div>
              )}
            </section>

            {/* ── Footer note ── */}
            <p className="text-xs font-mono text-muted text-right">
              ● Live · updates every 2 s
            </p>

          </div>
        ) : null}
      </main>
    </>
  );
}
