/**
 * page.tsx — Server Component wrapper for /dashboard/[shortCode]
 *
 * Next.js App Router rule: `generateStaticParams` is a server-only export and
 * CANNOT coexist with "use client" in the same file. The solution is the
 * standard split pattern:
 *   - This file (server component) owns generateStaticParams
 *   - LinkStatsClient.tsx (client component) owns all the React hooks / fetch logic
 *
 * generateStaticParams returns [] because short codes are user-generated at
 * runtime. The page is fully client-side and fetches data after hydration.
 * Cloudflare Pages `public/_redirects` (/* /index.html 200) handles direct
 * URL access for paths unknown at build time.
 */

import LinkStatsClient from "./LinkStatsClient";

export function generateStaticParams() {
  return [];
}

export default function LinkStatsPage() {
  return <LinkStatsClient />;
}
