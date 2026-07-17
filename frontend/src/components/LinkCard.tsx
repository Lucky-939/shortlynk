"use client";

import Link from "next/link";
import type { LinkSummary } from "@/lib/api";
import CopyButton from "./CopyButton";

interface LinkCardProps {
  link: LinkSummary;
}

const REDIRECT_BASE = process.env.NEXT_PUBLIC_REDIRECT_BASE_URL ?? "";

/** Formats a date string to a readable short form: "15 Jun 2025" */
function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

/**
 * LinkCard — one row in the dashboard link list.
 * Short code in monospace, truncated URL with tooltip, click count, copy button.
 * Clicking the row navigates to the stats detail page.
 */
export default function LinkCard({ link }: LinkCardProps) {
  const shortUrl = `${REDIRECT_BASE}/${link.shortCode}`;

  return (
    <div className="group border border-border bg-surface hover:border-l-[3px] hover:border-l-accent hover:pl-[calc(1rem-3px)] pl-4 pr-4 py-4 transition-all duration-120">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        {/* Left: short code + long URL */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3 mb-1.5 flex-wrap">
            <Link
              href={`/dashboard/stats?code=${link.shortCode}`}
              className="font-mono text-accent font-medium text-base hover:underline underline-offset-2"
            >
              {link.shortCode}
            </Link>
            <CopyButton text={shortUrl} label="Copy link" />
          </div>
          {/* Long URL — truncated, full value in title tooltip */}
          <p
            className="text-muted text-sm truncate max-w-md"
            title={link.longUrl}
          >
            {link.longUrl}
          </p>
        </div>

        {/* Right: stats + date */}
        <div className="flex flex-col items-end gap-1 shrink-0 text-right">
          <span className="font-mono text-text font-semibold text-base">
            {link.totalClicks.toLocaleString()}
          </span>
          <span className="text-muted text-xs">
            {link.totalClicks === 1 ? "click" : "clicks"}
          </span>
          <span className="text-muted text-xs mt-1">{formatDate(link.createdAt)}</span>
        </div>
      </div>

      {/* Stats link — visible on hover */}
      <div className="mt-2">
        <Link
          href={`/dashboard/stats?code=${link.shortCode}`}
          className="text-xs text-muted hover:text-accent transition-colors"
        >
          View detailed stats →
        </Link>
      </div>
    </div>
  );
}
