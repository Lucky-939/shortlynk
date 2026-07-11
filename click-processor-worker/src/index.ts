/**
 * click-processor-worker
 *
 * Queue consumer — receives ClickEvent messages from the "click-events" queue
 * and aggregates analytics counters into ANALYTICS_KV.
 *
 * KV counter keys:
 *   total:{shortCode}                        — total clicks for a short code
 *   hourly:{shortCode}:{YYYY-MM-DDTHH}       — clicks in a given UTC hour
 *   referrer:{shortCode}:{referer|"direct"}  — clicks from a given referrer
 *
 * Note: this worker exports a `queue` handler only. There is no `fetch`
 * handler — Cloudflare Workers Queues consumers don't need one.
 */

export interface Env {
  ANALYTICS_KV: KVNamespace;
}

/** Shape of messages published by redirect-worker to the click-events queue. */
interface ClickEvent {
  shortCode: string;
  /** ISO 8601 timestamp of when the redirect was served. */
  timestamp: string;
  /** Raw User-Agent header, or null if absent. */
  userAgent: string | null;
  /** Raw Referer header, or null if absent. */
  referer: string | null;
  /** SHA-256 hex digest of the visitor IP, or null if absent. */
  ipHash: string | null;
}

// ── KV helpers ────────────────────────────────────────────────────────────────

/**
 * Increments a numeric counter stored as a plain string in KV by 1.
 *
 * Pattern: read current value → add 1 → write back.
 *
 * KNOWN RACE-CONDITION LIMITATION: Cloudflare KV does not provide atomic
 * increment semantics (unlike Redis INCR or DynamoDB atomic counters). Two
 * concurrent invocations of this worker that both read the same value before
 * either has written back will produce a "lost update" — the counter ends up
 * incremented by 1 instead of 2. At this project's expected traffic level
 * (hundreds of clicks per second at most, spread across hourly/referrer
 * buckets) the probability of a collision on any single key is negligible and
 * the approximation is acceptable. Eliminating the race entirely would require
 * a Durable Object acting as a serialised write gate.
 */
async function kvIncrement(kv: KVNamespace, key: string): Promise<void> {
  const raw = await kv.get(key);
  const current = raw !== null ? parseInt(raw, 10) : 0;
  await kv.put(key, String(current + 1));
}

// ── Timestamp helpers ─────────────────────────────────────────────────────────

/**
 * Truncates an ISO 8601 timestamp to the UTC hour, producing the format
 * `YYYY-MM-DDTHH` suitable for use as a KV key segment.
 *
 * Example: "2025-06-15T13:47:22.000Z" → "2025-06-15T13"
 */
function truncateToHour(isoTimestamp: string): string {
  // Slice the first 13 characters of the ISO string — "YYYY-MM-DDTHH"
  return isoTimestamp.slice(0, 13);
}

// ── Per-message processor ─────────────────────────────────────────────────────

/**
 * Processes a single ClickEvent:
 *   1. Increments total-clicks counter: `total:{shortCode}`
 *   2. Increments hourly-bucket counter: `hourly:{shortCode}:{YYYY-MM-DDTHH}`
 *   3. Increments referrer counter:      `referrer:{shortCode}:{referer|"direct"}`
 *
 * Throws on any KV failure so the caller can decide whether to ack or retry.
 */
async function processClickEvent(event: ClickEvent, env: Env): Promise<void> {
  const { shortCode, timestamp, referer } = event;

  // 1. Total-clicks counter ───────────────────────────────────────────────────
  await kvIncrement(env.ANALYTICS_KV, `total:${shortCode}`);

  // 2. Hourly-bucket counter ──────────────────────────────────────────────────
  const hourBucket = truncateToHour(timestamp);
  await kvIncrement(env.ANALYTICS_KV, `hourly:${shortCode}:${hourBucket}`);

  // 3. Referrer counter ───────────────────────────────────────────────────────
  // Treat a null / empty referer as "direct" traffic (typed-in URL, bookmarks,
  // or native apps that don't send a Referer header).
  const referrerKey = referer && referer.trim() !== "" ? referer : "direct";
  await kvIncrement(env.ANALYTICS_KV, `referrer:${shortCode}:${referrerKey}`);
}

// ── Queue consumer entrypoint ─────────────────────────────────────────────────

export default {
  /**
   * Queue consumer handler — called by Cloudflare when a batch of messages
   * arrives on the "click-events" queue.
   *
   * Per-message ack/retry strategy:
   *   - On success  → message.ack()   : remove from queue, do not redeliver.
   *   - On failure  → message.retry() : requeue this specific message for
   *                                     redelivery; other messages in the
   *                                     batch are unaffected.
   *
   * This is the correct Cloudflare Queues pattern: individual message
   * acknowledgement within a batch. Do NOT call batch.ackAll() /
   * batch.retryAll() when you want fine-grained per-message control.
   */
  async queue(batch: MessageBatch<ClickEvent>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      try {
        // Guard against malformed payloads. The `body` may not conform to
        // ClickEvent if the producer sent bad data (or the schema changed).
        const event = message.body;
        if (
          typeof event !== "object" ||
          event === null ||
          typeof event.shortCode !== "string" ||
          typeof event.timestamp !== "string"
        ) {
          console.error(
            "[click-processor] malformed message — retrying:",
            JSON.stringify(event)
          );
          message.retry();
          continue;
        }

        await processClickEvent(event, env);
        message.ack();
      } catch (err) {
        // Unexpected runtime error (e.g. KV quota exceeded, transient network
        // error). Retry this individual message; the rest of the batch continues.
        console.error(
          "[click-processor] failed to process message, will retry:",
          err
        );
        message.retry();
      }
    }
  },
} satisfies ExportedHandler<Env>;
