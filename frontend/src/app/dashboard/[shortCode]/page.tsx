/**
 * generateStaticParams — required by Next.js `output: 'export'` for every
 * dynamic route segment.
 *
 * We return [] because short codes are created by users at runtime; there are
 * no paths to pre-render at build time. The page is fully client-side ("use
 * client") and loads its data via fetch(), so it works correctly when reached
 * through SPA navigation (clicking a link in the dashboard).
 *
 * NOTE — direct URL access (pasting /dashboard/abc123 into the address bar):
 * In a static export there is no server to render unknown paths. Add a
 * Cloudflare Pages `public/_redirects` file with:
 *   /*  /index.html  200
 * to make the browser receive the SPA shell for any path and let the client
 * router take over.
 */
export function generateStaticParams() {
  return [];
}

"use client";


import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { getLinkStats, ApiError, type LinkStats } from "@/lib/api";
import { useAuth } from "@/components/AuthProvider";
import NavBar from "@/components/NavBar";
import StatChart from "@/components/StatChart";
import LiveIndicator from "@/components/LiveIndicator";
import ErrorState from "@/components/ErrorState";
import { StatsSkeleton } from "@/components/LoadingSkeleton";
import CopyButton from "@/components/CopyButton";

const SHORTEN_BASE = process.env.NEXT_PUBLIC_SHORTEN_API_URL ?? "";
const POLL_INTERVAL_MS = 5000;

export default function LinkStatsPage() {
  const { user, logout, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const params = useParams<{ shortCode: string }>();
  const shortCode = params.shortCode;

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
    if (!user) return;
    fetchStats();
    pollingRef.current = setInterval(fetchStats, POLL_INTERVAL_MS);
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [user, fetchStats]);

  if (authLoading || (!user && !error)) return null;

  const shortUrl = `${SHORTEN_BASE}/${shortCode}`;

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
