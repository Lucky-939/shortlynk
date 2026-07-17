"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  BarChart,
  Bar,
  XAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
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

// ── IST timezone helper ──────────────────────────────────────────────────────

/**
 * Converts a UTC hour key ("YYYY-MM-DDTHH") to a display string in
 * Indian Standard Time (Asia/Kolkata, UTC+5:30).
 *
 * Uses an explicit timeZone rather than the browser's local setting so the
 * display is consistent for all visitors regardless of their system clock.
 *
 * Returns "HH:MM" (24-hour, always 5 chars, e.g. "03:30", "21:00").
 */
function utcHourKeyToIST(utcKey: string): string {
  // Append ":00:00Z" to make a full ISO-8601 UTC datetime string that
  // Date can parse unambiguously as UTC (without the Z it's local-time).
  const utcDate = new Date(utcKey + ":00:00Z");
  return utcDate.toLocaleTimeString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

// ── Custom tooltip ────────────────────────────────────────────────────────────

function ChartTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { value: number; payload: { label: string } }[];
}) {
  if (!active || !payload?.length) return null;
  const { value, payload: { label } } = payload[0];
  return (
    <div className="bg-surface border border-border px-3 py-2 pointer-events-none">
      <p className="font-mono text-xs text-muted mb-0.5">{label}</p>
      <p className="font-mono text-sm text-accent font-semibold">
        {value} click{value !== 1 ? "s" : ""}
      </p>
    </div>
  );
}

// ── Bar chart ─────────────────────────────────────────────────────────────────

function HourlyChart({ data }: { data: LinkStats["hourly"] }) {
  // Build a full 24-bucket array. The API only returns hours with > 0 clicks.
  // We generate the last 24 UTC hour keys and merge.
  const buckets = Array.from({ length: 24 }, (_, i) => {
    const d = new Date(Date.now() - (23 - i) * 3_600_000);
    const key = d.toISOString().slice(0, 13); // "YYYY-MM-DDTHH" (UTC)
    // Convert the UTC hour key to IST for display — presentation only.
    const label = utcHourKeyToIST(key); // e.g. "03:30", "21:00"
    const match = data.find((h) => h.hour === key);
    return { key, label, count: match?.count ?? 0 };
  });

  const totalClicks = buckets.reduce((s, b) => s + b.count, 0);

  // Empty state — all zeros look like a rendering bug
  if (totalClicks === 0) {
    return (
      <div className="flex items-center justify-center h-36 text-muted text-sm font-mono">
        No clicks in the last 24 hours
      </div>
    );
  }

  const peak = Math.max(...buckets.map((b) => b.count));

  // X-axis tick formatter — only render every 3rd IST hour (show labels at
  // IST hours 0, 3, 6, 9, 12, 15, 18, 21). The label is already in IST
  // ("HH:MM") so we parse the IST hour directly.
  const tickFormatter = (label: string) => {
    const istHour = parseInt(label.slice(0, 2), 10);
    return istHour % 3 === 0 ? label : "";
  };

  return (
    <ResponsiveContainer width="100%" height={160}>
      <BarChart data={buckets} barCategoryGap="20%" margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
        <XAxis
          dataKey="label"
          tickFormatter={tickFormatter}
          tick={{
            fontFamily: "var(--font-mono, monospace)",
            fontSize: 11,
            fill: "var(--color-muted)",
          }}
          axisLine={false}
          tickLine={false}
          interval={0}
        />
        {/* Y-axis intentionally omitted — bar heights speak for themselves */}
        <Tooltip
          content={<ChartTooltip />}
          cursor={{ fill: "rgba(255,255,255,0.04)" }}
        />
        <Bar dataKey="count" radius={0} isAnimationActive={false}>
          {buckets.map((b) => (
            <Cell
              key={b.key}
              fill={
                b.count === peak && peak > 0
                  ? "var(--color-accent)"          // peak bar: loud accent
                  : b.count > 0
                  ? "rgba(232,255,71,0.35)"        // non-zero: dim accent
                  : "var(--color-raised)"          // zero: near-invisible
              }
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
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
  // Convert peak hour key to IST for display.
  const peakLabel = peakHour ? utcHourKeyToIST(peakHour.hour) : "—";
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
              <StatCard label="Peak hour (IST)" value={peakLabel} sub={peakHour ? `${peakHour.count} clicks` : undefined} />
              <StatCard label="Top source" value={topReferrer} sub={stats.topReferrers[0] ? `${stats.topReferrers[0].count} clicks` : undefined} />
            </div>

            {/* ── Hourly chart ── */}
            <section className="bg-surface border border-border p-6">
              <div className="flex items-center justify-between mb-5">
                <h2 className="font-display text-base font-semibold text-text flex items-center gap-2">
                  Last 24 hours
                  <span className="text-xs font-mono text-muted font-normal tracking-normal">(IST)</span>
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
