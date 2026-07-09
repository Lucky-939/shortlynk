/**
 * redirect-worker — GET /{shortCode}
 *
 * 1. Looks up shortCode in URLS_KV.
 * 2. Returns 404 JSON if not found.
 * 3. Enqueues a ClickEvent to CLICK_QUEUE via ctx.waitUntil() (non-blocking).
 * 4. Returns a 301 redirect to the stored longUrl.
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

  // 2. Build and enqueue the click event ─────────────────────────────────────
  //
  // ctx.waitUntil() is the correct pattern here for two reasons:
  //
  // a) NON-BLOCKING: The 301 response is returned to the client immediately.
  //    The queue.send() Promise runs in the background. From the browser's
  //    perspective, the redirect is instantaneous — it never waits for the
  //    analytics write.
  //
  // b) SAFE / RELIABLE: Cloudflare guarantees that any Promise registered
  //    with ctx.waitUntil() will be allowed to run to completion (or retry
  //    on transient failure) even after the HTTP response has already been
  //    flushed. Without waitUntil(), the runtime could terminate the Worker
  //    isolate as soon as the response is sent, silently dropping the event.
  //
  const clickEvent: ClickEvent = {
    shortCode,
    timestamp: new Date().toISOString(),
    userAgent: request.headers.get("User-Agent"),
    referer: request.headers.get("Referer"),
    ipHash: await hashIp(request.headers.get("CF-Connecting-IP")),
  };
  ctx.waitUntil(env.CLICK_QUEUE.send(clickEvent));

  // 3. Redirect ───────────────────────────────────────────────────────────────
  return new Response(null, {
    status: 301,
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
