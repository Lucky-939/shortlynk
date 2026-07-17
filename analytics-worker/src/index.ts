/**
 * analytics-worker — GET /links, GET /links/{shortCode}/stats,
 *                      POST /internal/record-click
 *
 * Read-only analytics API for the frontend. Protected by JWT.
 * Also accepts internal click events from redirect-worker via HTTP —
 * analytics-worker is the SOLE writer to ANALYTICS_KV, which avoids
 * cross-process SQLite WAL read-isolation issues that arise when two
 * separate wrangler dev processes share the same KV namespace file.
 *
 * JWT_SECRET must match auth-worker and shorten-worker. Provided as a
 * Wrangler secret (not a plain var). For local dev, add to .dev.vars.
 * For production: wrangler secret put JWT_SECRET --cwd analytics-worker
 */

import { verifyJwt } from "../../shared/jwt";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Env {
  URLS_KV: KVNamespace;
  ANALYTICS_KV: KVNamespace;
  JWT_SECRET: string;
}

/** Shape stored in URLS_KV by shorten-worker. */
interface LinkRecord {
  longUrl: string;
  createdAt: string;
  userId: string;
}

/** Shape of click events posted by redirect-worker. */
interface ClickEvent {
  shortCode: string;
  timestamp: string;
  userAgent: string | null;
  referer: string | null;
  ipHash: string | null;
}

// ── CORS ──────────────────────────────────────────────────────────────────────

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

function withCors(response: Response): Response {
  const next = new Response(response.body, response);
  Object.entries(CORS_HEADERS).forEach(([k, v]) => next.headers.set(k, v));
  return next;
}

function handleOptions(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

// ── Utility ───────────────────────────────────────────────────────────────────

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

/** Reads a KV counter value, defaulting to 0 if the key is absent. */
async function getCounter(kv: KVNamespace, key: string): Promise<number> {
  const raw = await kv.get(key);
  return raw !== null ? parseInt(raw, 10) : 0;
}

/** Increments a KV counter by 1. Read-modify-write (see click-processor comments). */
async function kvIncrement(kv: KVNamespace, key: string): Promise<void> {
  const raw = await kv.get(key);
  const current = raw !== null ? parseInt(raw, 10) : 0;
  await kv.put(key, String(current + 1));
}

/** Truncates ISO timestamp to YYYY-MM-DDTHH for hourly bucket keys. */
function truncateToHour(iso: string): string {
  return iso.slice(0, 13);
}

// ── Auth helper ───────────────────────────────────────────────────────────────

async function requireAuth(request: Request, secret: string) {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  const token = authHeader.slice("Bearer ".length).trim();
  if (!token) return null;
  return verifyJwt(token, secret);
}

// ── Timestamp helper ──────────────────────────────────────────────────────────

/**
 * Builds the YYYY-MM-DDTHH key segment for a given UTC hour offset from now.
 *
 * @param hoursAgo 0 = current hour, 1 = one hour ago, …, 23 = 23 hours ago.
 */
function hourKeyAt(hoursAgo: number): string {
  const d = new Date(Date.now() - hoursAgo * 60 * 60 * 1000);
  return d.toISOString().slice(0, 13); // "YYYY-MM-DDTHH"
}

// ── Route handlers ────────────────────────────────────────────────────────────

/**
 * GET /links
 *
 * Returns all links created by the authenticated user, each enriched with
 * its total click count from ANALYTICS_KV.
 */
async function handleListLinks(request: Request, env: Env): Promise<Response> {
  const payload = await requireAuth(request, env.JWT_SECRET);
  if (!payload) return json({ error: "Missing or invalid Authorization token" }, 401);

  const userId = payload.sub;

  // Read the per-user link index maintained by shorten-worker
  const rawIndex = await env.URLS_KV.get(`user-links:${userId}`);
  if (rawIndex === null) {
    // Brand-new user with no links — return empty array, not an error
    return json([], 200);
  }

  let shortCodes: string[];
  try {
    shortCodes = JSON.parse(rawIndex) as string[];
  } catch {
    return json([], 200); // Corrupted index — safe fallback
  }

  if (shortCodes.length === 0) return json([], 200);

  // Fetch link records and click totals in parallel
  const results = await Promise.all(
    shortCodes.map(async (shortCode) => {
      const [rawRecord, totalClicks] = await Promise.all([
        env.URLS_KV.get(shortCode),
        getCounter(env.ANALYTICS_KV, `total:${shortCode}`),
      ]);

      if (rawRecord === null) return null; // link deleted or index stale — skip

      let record: LinkRecord;
      try {
        record = JSON.parse(rawRecord) as LinkRecord;
      } catch {
        return null;
      }

      return {
        shortCode,
        longUrl: record.longUrl,
        createdAt: record.createdAt,
        totalClicks,
      };
    })
  );

  // Filter out any null entries (stale index references)
  return json(results.filter(Boolean), 200);
}

/**
 * GET /links/{shortCode}/stats
 *
 * Returns detailed analytics for one link:
 *   - totalClicks
 *   - hourly breakdown for the last 24 hours (24 individual KV gets)
 *   - top 5 referrers by click count
 *
 * Access control: only the link owner (record.userId === jwt.sub) may view
 * stats. A different authenticated user gets 403, not 404 — this avoids
 * leaking whether a code exists to other users.
 */
async function handleLinkStats(
  request: Request,
  env: Env,
  shortCode: string
): Promise<Response> {
  const payload = await requireAuth(request, env.JWT_SECRET);
  if (!payload) return json({ error: "Missing or invalid Authorization token" }, 401);

  // 1. Fetch the link record ─────────────────────────────────────────────────
  const rawRecord = await env.URLS_KV.get(shortCode);
  if (rawRecord === null) return json({ error: "Link not found" }, 404);

  let record: LinkRecord;
  try {
    record = JSON.parse(rawRecord) as LinkRecord;
  } catch {
    return json({ error: "Link not found" }, 404);
  }

  // 2. Ownership check ────────────────────────────────────────────────────────
  if (record.userId !== payload.sub) {
    return json({ error: "Forbidden" }, 403);
  }

  // 3. Total clicks ───────────────────────────────────────────────────────────
  const totalClicks = await getCounter(env.ANALYTICS_KV, `total:${shortCode}`);

  // 4. Hourly breakdown — last 24 hours ─────────────────────────────────────
  //
  // KV has no range-query or scan-by-prefix-with-cursor that could efficiently
  // retrieve an ordered time range. Instead, we know the exact set of keys:
  // 24 buckets, each named `hourly:{shortCode}:{YYYY-MM-DDTHH}`. Fetching
  // them individually is the KV-appropriate pattern for bounded, known key
  // sets — it's a fixed 24 GETs regardless of data volume. This would be
  // a single range scan in a time-series DB, but KV is not one.
  const hourlyEntries = await Promise.all(
    Array.from({ length: 24 }, (_, i) => i).map(async (hoursAgo) => {
      const hour = hourKeyAt(hoursAgo);
      const count = await getCounter(
        env.ANALYTICS_KV,
        `hourly:${shortCode}:${hour}`
      );
      return { hour, count };
    })
  );
  // Include only hours with at least one click; sort most-recent first
  const hourly = hourlyEntries
    .filter((e) => e.count > 0)
    .sort((a, b) => b.hour.localeCompare(a.hour));

  // 5. Referrers ─────────────────────────────────────────────────────────────
  //
  // We use KV's list() with a prefix to discover all referrer keys for this
  // shortCode. Unlike the fixed hourly window, we don't know in advance which
  // referrer domains have clicked this link. list() is the only KV mechanism
  // for key discovery. Default limit is 1000 — sufficient for any realistic
  // referrer set. If a link ever accumulated > 1000 unique referrers we'd
  // need cursor-based pagination; not a concern at this project's scale.
  const prefix = `referrer:${shortCode}:`;
  const listed = await env.ANALYTICS_KV.list({ prefix });

  const referrerCounts = await Promise.all(
    listed.keys.map(async ({ name }) => {
      const referrer = name.slice(prefix.length); // strip key prefix to get raw domain/value
      const count = await getCounter(env.ANALYTICS_KV, name);
      return { referrer, count };
    })
  );

  const topReferrers = referrerCounts
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return json({ totalClicks, hourly, topReferrers }, 200);
}

// ── Router ────────────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

    if (request.method === "OPTIONS") return handleOptions();

    // POST /internal/record-click — called by redirect-worker to record a click.
    // No auth: this is an internal endpoint, not exposed to the public.
    // In production, replace with a Cloudflare Service Binding.
    if (request.method === "POST" && pathname === "/internal/record-click") {
      try {
        const event = await request.json() as ClickEvent;
        const { shortCode, timestamp, referer } = event;
        const hour = truncateToHour(timestamp);
        const referrerKey = referer && referer.trim() !== "" ? referer : "direct";
        await Promise.all([
          kvIncrement(env.ANALYTICS_KV, `total:${shortCode}`),
          kvIncrement(env.ANALYTICS_KV, `hourly:${shortCode}:${hour}`),
          kvIncrement(env.ANALYTICS_KV, `referrer:${shortCode}:${referrerKey}`),
        ]);
        return withCors(json({ ok: true }, 200));
      } catch (err) {
        console.error("[analytics] record-click failed:", err);
        return withCors(json({ error: "Failed to record click" }, 500));
      }
    }

    if (request.method !== "GET") {
      return withCors(json({ error: "Method not allowed" }, 405));
    }

    // GET /links
    if (pathname === "/links") {
      return withCors(await handleListLinks(request, env));
    }

    // GET /links/{shortCode}/stats
    const statsMatch = pathname.match(/^\/links\/([^/]+)\/stats$/);
    if (statsMatch) {
      return withCors(await handleLinkStats(request, env, statsMatch[1]));
    }

    return withCors(json({ error: "Not found" }, 404));
  },
} satisfies ExportedHandler<Env>;
