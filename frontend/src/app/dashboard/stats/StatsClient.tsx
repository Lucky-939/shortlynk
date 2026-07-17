"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { getLinkStats, ApiError, type LinkStats } from "@/lib/api";
import { useAuth } from "@/components/AuthProvider";
import NavBar from "@/components/NavBar";
import StatChart from "@/components/StatChart";
import LiveIndicator from "@/components/LiveIndicator";
import ErrorState from "@/components/ErrorState";
import { StatsSkeleton } from "@/components/LoadingSkeleton";
import CopyButton from "@/components/CopyButton";

const REDIRECT_BASE = process.env.NEXT_PUBLIC_REDIRECT_BASE_URL ?? "";
const POLL_INTERVAL_MS = 5000;

/**
 * StatsClient — reads shortCode from ?code= query param.
 * URL pattern: /dashboard/stats?code=abc123
 *
 * Using a query param instead of a dynamic route segment is required for
 * Next.js `output: 'export'` — static exports cannot serve dynamic path
 * segments whose values are unknown at build time.
 */
export default function StatsClient() {
  const { user, logout, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const shortCode = searchParams.get("code") ?? "";

  const [stats, setStats] = useState<LinkStats | null>(null);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Auth guard ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!authLoading && !user) {
      router.replace("/login");
    }
  }, [authLoading, user, router]);

  // Redirect if no code provided
  useEffect(() => {
    if (!shortCode) {
      router.replace("/dashboard");
    }
  }, [shortCode, router]);

  // ── Fetch stats ──────────────────────────────────────────────────────────
  const fetchStats = useCallback(async () => {
    if (!user || !shortCode) return;
    try {
      const data = await getLinkStats(shortCode, user.token);
      setStats(data);
      setError(null);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401) {
          logout();
          router.replace("/login");
          return;
        }
        if (err.status === 404) {
          setError("Link not found.");
          return;
        }
        if (err.status === 403) {
          setError("You don't have access to this link's stats.");
          return;
        }
        setError(err.message);
      } else {
        setError("Could not load stats. Is the analytics service running?");
      }
    } finally {
      setFetching(false);
    }
  }, [user, shortCode, logout, router]);

  // ── Polling — fetch every 5 s for near-live updates ─────────────────────
  useEffect(() => {
    if (!user || !shortCode) return;
    fetchStats();
    pollingRef.current = setInterval(fetchStats, POLL_INTERVAL_MS);
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [user, shortCode, fetchStats]);

  if (authLoading || (!user && !error)) return null;
  if (!shortCode) return null;

  const shortUrl = `${REDIRECT_BASE}/${shortCode}`;

  return (
    <>
      <NavBar />
      <main className="max-w-3xl mx-auto px-4 py-12">

        {/* Breadcrumb */}
        <nav className="mb-8 text-sm" aria-label="Breadcrumb">
          <Link href="/dashboard" className="text-muted hover:text-accent transition-colors">
            ← Dashboard
          </Link>
        </nav>

        {/* Header */}
        <div className="flex items-start justify-between gap-4 mb-10 flex-wrap">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <span className="font-mono text-accent text-xl font-semibold">{shortCode}</span>
              <CopyButton text={shortUrl} />
              <LiveIndicator />
            </div>
            <p className="text-muted text-xs font-mono">{shortUrl}</p>
          </div>
        </div>

        {fetching ? (
          <StatsSkeleton />
        ) : error ? (
          <ErrorState message={error} onRetry={fetchStats} />
        ) : stats ? (
          <div className="space-y-10">
            {/* Total clicks — the hero number */}
            <div className="border border-border border-l-[3px] border-l-accent bg-surface pl-6 pr-6 py-6 inline-block">
              <p className="text-xs font-mono text-muted uppercase tracking-widest mb-1">Total clicks</p>
              <p className="font-display text-5xl font-bold text-text">
                {stats.totalClicks.toLocaleString()}
              </p>
            </div>

            {/* Hourly chart */}
            <div>
              <h2 className="font-display text-lg font-semibold text-text mb-4">
                Last 24 hours
              </h2>
              <div className="border border-border bg-surface p-4">
                <StatChart data={stats.hourly} />
              </div>
            </div>

            {/* Top referrers */}
            <div>
              <h2 className="font-display text-lg font-semibold text-text mb-4">
                Top referrers
              </h2>
              {stats.topReferrers.length === 0 ? (
                <p className="text-muted text-sm font-mono">No referrer data yet.</p>
              ) : (
                <div className="border border-border bg-surface divide-y divide-border">
                  {stats.topReferrers.map((ref, i) => (
                    <div
                      key={ref.referrer}
                      className="flex items-center justify-between px-4 py-3"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="font-mono text-xs text-muted w-4 shrink-0">{i + 1}</span>
                        <span
                          className="font-mono text-sm text-text truncate max-w-xs"
                          title={ref.referrer}
                        >
                          {ref.referrer}
                        </span>
                      </div>
                      <span className="font-mono text-sm text-accent shrink-0 ml-4">
                        {ref.count.toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : null}
      </main>
    </>
  );
}
