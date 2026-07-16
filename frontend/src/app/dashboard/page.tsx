"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { getLinks, ApiError, type LinkSummary } from "@/lib/api";
import { useAuth } from "@/components/AuthProvider";
import NavBar from "@/components/NavBar";
import LinkCard from "@/components/LinkCard";
import ShortenForm from "@/components/ShortenForm";
import ErrorState from "@/components/ErrorState";
import { DashboardSkeleton } from "@/components/LoadingSkeleton";

const SHORTEN_BASE = process.env.NEXT_PUBLIC_SHORTEN_API_URL ?? "";

export default function DashboardPage() {
  const { user, logout, isLoading: authLoading } = useAuth();
  const router = useRouter();

  const [links, setLinks] = useState<LinkSummary[]>([]);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── Auth guard ───────────────────────────────────────────────────────────
  // Wait for the auth context to finish rehydrating from localStorage before
  // deciding to redirect — avoids a flash-redirect on page load.
  useEffect(() => {
    if (!authLoading && !user) {
      router.replace("/login");
    }
  }, [authLoading, user, router]);

  // ── Fetch links ──────────────────────────────────────────────────────────
  const fetchLinks = useCallback(async () => {
    if (!user) return;
    setError(null);
    try {
      const data = await getLinks(user.token);
      setLinks(data);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        // Token expired or invalid — clear auth and redirect
        logout();
        router.replace("/login");
        return;
      }
      setError(
        err instanceof ApiError
          ? err.message
          : "Could not load your links. Is the analytics service running?"
      );
    } finally {
      setFetching(false);
    }
  }, [user, logout, router]);

  useEffect(() => {
    if (user) fetchLinks();
  }, [user, fetchLinks]);

  // ── Handle new shorten success ───────────────────────────────────────────
  function handleNewLink() {
    // Refresh the link list so the new entry appears immediately
    setFetching(true);
    fetchLinks();
  }

  // ── Render ───────────────────────────────────────────────────────────────
  if (authLoading || (!user && !error)) return null; // avoid flash

  return (
    <>
      <NavBar />
      <main className="max-w-5xl mx-auto px-4 py-12">

        {/* Header */}
        <div className="flex items-start justify-between mb-8 flex-wrap gap-4">
          <div>
            <h1 className="font-display text-3xl font-semibold text-text mb-1">Your links</h1>
            <p className="text-muted text-sm">
              {user?.email}
            </p>
          </div>
        </div>

        {/* Shorten inline */}
        <div className="mb-10 max-w-xl">
          <p className="text-xs font-mono text-muted uppercase tracking-widest mb-2">Shorten a new link</p>
          <ShortenForm onSuccess={handleNewLink} />
        </div>

        <div className="border-t border-border mb-8" />

        {/* Link list */}
        {fetching ? (
          <DashboardSkeleton />
        ) : error ? (
          <ErrorState message={error} onRetry={fetchLinks} />
        ) : links.length === 0 ? (
          // Empty state
          <div className="border border-border border-l-[3px] border-l-accent bg-surface pl-6 pr-6 py-10 text-center">
            <p className="font-display text-xl text-text mb-2">No links yet</p>
            <p className="text-muted text-sm">
              Paste a URL in the box above to create your first short link.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {links.map((link) => (
              <LinkCard key={link.shortCode} link={link} shortenApiBase={SHORTEN_BASE} />
            ))}
          </div>
        )}
      </main>
    </>
  );
}
