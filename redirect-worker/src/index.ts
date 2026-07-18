/**
 * redirect-worker — GET /{shortCode}
 *
 * 1. Looks up shortCode in URLS_KV.
 * 2. Returns 404 JSON if not found.
 * 3. Dispatches a ClickEvent to the click-events queue.
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
  CLICK_QUEUE: Queue<ClickEvent>;
}

/** Shape stored as JSON in URLS_KV (written by shorten-worker). */
interface LinkRecord {
  longUrl: string;
  createdAt: string;
  userId: string;
}

/** Shape of the message sent to analytics-worker and the click-events Queue. */
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
  // We fire a ClickEvent into the queue via ctx.waitUntil. This allows the
  // redirect to complete in ~10ms (just KV read) without waiting for the
  // downstream analytics write to finish.
  const clickEvent: ClickEvent = {
    shortCode,
    timestamp: new Date().toISOString(),
    userAgent: request.headers.get("User-Agent"),
    referer: request.headers.get("Referer"),
    ipHash: await hashIp(request.headers.get("CF-Connecting-IP")),
  };

  // Fire-and-forget to the queue. catch() ensures a queue outage doesn't
  // crash the worker or break the redirect.
  ctx.waitUntil(env.CLICK_QUEUE.send(clickEvent).catch((err) => {
    console.error("[redirect] Failed to queue click event:", err);
  }));

  // 3. Redirect ───────────────────────────────────────────────────────────────
  //
  // 302 (Found / temporary redirect) is intentional — see module comment.
  //
  // Cache-Control: no-store is required. Without it, Chrome (and other
  // browsers) cache 302 responses within the same browsing session, so
  // subsequent visits to the same short URL are served from the browser
  // cache and never reach this worker — meaning clicks after the first
  // one per session are silently dropped.
  return new Response(null, {
    status: 302,
    headers: {
      Location: record.longUrl,
      "Cache-Control": "no-store",
    },
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
