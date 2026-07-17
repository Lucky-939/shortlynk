import { Suspense } from "react";
import StatsClient from "./StatsClient";

/**
 * Static stats page — no dynamic route segment, no generateStaticParams needed.
 *
 * The shortCode is passed as a URL query param: /dashboard/stats?code=abc123
 * StatsClient reads it with useSearchParams() (requires Suspense wrapper in
 * static exports per Next.js docs).
 *
 * This completely avoids the `output: 'export'` + dynamic-route incompatibility.
 */
export default function StatsPage() {
  return (
    <Suspense>
      <StatsClient />
    </Suspense>
  );
}
