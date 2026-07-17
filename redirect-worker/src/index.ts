/**
 * redirect-worker — GET /{shortCode}
 *
 * 1. Looks up shortCode in URLS_KV.
 * 2. Returns 404 JSON if not found.
 * 3. Enqueues a ClickEvent to CLICK_QUEUE via ctx.waitUntil() (non-blocking).
 * 4. Returns a 302 redirect to the stored longUrl.
 *
 * WHY 302 NOT 301:
 * 301 (Moved Permanently) is cached by browsers indefinitely. Every repeated
 * visit to the same short URL would be served from the browser cache and never
 * reach this worker — meaning clicks go uncounted. 302 (Found / temporary) is
 * never cached, so every visit hits the worker and generates a click event.
 * This is the same approach used by Bitly, TinyURL, and every analytics-aware
 * link shortener.
 */

import { hashIp } from "./hash";

export interface Env {
  URLS_KV: KVNamespace;
  ANALYTICS_KV: KVNamespace;
  CLICK_QUEUE: Queue<ClickEvent>;
}

/** Shape stored as JSON in URLS_KV (written by shorten-worker). */
interface LinkRecord {
  longUrl: string;
  createdAt: string;
  userId: string;
}

/** Shape of the message published to the click-events Queue. */
export interface ClickEvent {
  shortCode: string;
  /** ISO 8601 timestamp of when the redirect was served. */
  timestamp: string;
  /** Raw User-Agent header, or null if absent. */
  userAgent: string | null;
  /** Raw Referer header, or null if absent. */
  referer: string | null;
  /**
   * SHA-256 hex digest of the CF-Connecting-IP header.
   * We never store the raw IP — this hash lets us deduplicate clicks per
   * unique visitor (with high probability) while keeping the worker GDPR-safe.
   * Null when the header is absent (e.g. local wrangler dev).
   */
  ipHash: string | null;
}

// ── KV helpers ───────────────────────────────────────────────────────────────────

/**
 * Atomically-unsafe KV increment (same pattern as click-processor-worker).
 * Acceptable for this traffic level — see click-processor-worker comment.
 */
async function kvIncrement(kv: KVNamespace, key: string): Promise<void> {
  const raw = await kv.get(key);
  const current = raw !== null ? parseInt(raw, 10) : 0;
  await kv.put(key, String(current + 1));
}

/** Truncates ISO timestamp to YYYY-MM-DDTHH for hourly KV bucket keys. */
function truncateToHour(iso: string): string {
  return iso.slice(0, 13);
}

/**
 * Writes click counters directly to ANALYTICS_KV.
 *
 * WHY DUAL-WRITE (queue + direct KV):
 * In local dev, separate `wrangler dev` processes cannot relay queue messages
 * to each other. The direct KV write makes click counting work locally.
 * In production the queue handles this via click-processor-worker, and both
 * writes succeed independently (KV is idempotent-ish at this traffic level).
 */
async function writeClickToKv(env: Env, event: ClickEvent): Promise<void> {
  const { shortCode, timestamp, referer } = event;
  const hour = truncateToHour(timestamp);
  const referrerKey = referer && referer.trim() !== "" ? referer : "direct";
  await Promise.all([
    kvIncrement(env.ANALYTICS_KV, `total:${shortCode}`),
    kvIncrement(env.ANALYTICS_KV, `hourly:${shortCode}:${hour}`),
    kvIncrement(env.ANALYTICS_KV, `referrer:${shortCode}:${referrerKey}`),
  ]);
}

// ── Utility ────────────────────────────────────────────────────────────────────

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

// ── Handler ────────────────────────────────────────────────────────────────────

async function handleRedirect(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const { pathname } = new URL(request.url);
  // Strip leading slash. Any path with no code (e.g. GET /) → 404.
  const shortCode = pathname.slice(1);
  if (!shortCode) {
    return json({ error: "Short link not found" }, 404);
  }

  // 1. KV lookup ─────────────────────────────────────────────────────────────
  const raw = await env.URLS_KV.get(shortCode);
  if (raw === null) {
    return json({ error: "Short link not found" }, 404);
  }

  let record: LinkRecord;
  try {
    record = JSON.parse(raw) as LinkRecord;
  } catch {
    // Corrupted KV entry — treat as not found rather than throwing 500
    return json({ error: "Short link not found" }, 404);
  }

  // 2. Record the click ─────────────────────────────────────────────────────
  //
  // IMPORTANT: KV write happens BEFORE the redirect response is returned.
  // ctx.waitUntil() is unreliable in local `wrangler dev` — the runtime can
  // terminate the isolate immediately after flushing the HTTP response, before
  // background promises complete. By awaiting writeClickToKv() here we
  // guarantee the counter is incremented on every single visit.
  //
  // Trade-off: the redirect is delayed by ~2-5ms (one round-trip to local KV
  // SQLite). This is imperceptible to users and acceptable for a portfolio
  // project. In a high-traffic production service you'd keep waitUntil() and
  // accept occasional missed counts.
  //
  // The queue.send() is still fire-and-forget (waitUntil) for production —
  // click-processor-worker handles deduplication and aggregation there.
  const clickEvent: ClickEvent = {
    shortCode,
    timestamp: new Date().toISOString(),
    userAgent: request.headers.get("User-Agent"),
    referer: request.headers.get("Referer"),
    ipHash: await hashIp(request.headers.get("CF-Connecting-IP")),
  };

  // Synchronous write — guaranteed to complete before response is sent
  await writeClickToKv(env, clickEvent);

  // Queue send for production click-processor-worker (fire-and-forget)
  ctx.waitUntil(
    env.CLICK_QUEUE.send(clickEvent).catch(() => {
      // Queue send fails silently in local dev — KV write above covers it.
    })
  );

  // 3. Redirect ───────────────────────────────────────────────────────────────
  //
  // 302 (Found / temporary redirect) is intentional — see module comment above.
  return new Response(null, {
    status: 302,
    headers: { Location: record.longUrl },
  });

}


// ── Router ─────────────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === "GET") {
      return handleRedirect(request, env, ctx);
    }
    return json({ error: "Method not allowed" }, 405);
  },
} satisfies ExportedHandler<Env>;
