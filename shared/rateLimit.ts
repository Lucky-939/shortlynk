/**
 * rateLimit.ts — shared KV-based fixed-window rate limiter
 */

/**
 * Returns the lowercase hex SHA-256 digest of `ip`, or `null` if `ip` is
 * null/empty (e.g. when the CF-Connecting-IP header is absent in local dev).
 */
export async function hashIp(ip: string | null): Promise<string | null> {
  if (!ip) return null;
  const encoded = new TextEncoder().encode(ip);
  const buffer = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Checks a fixed-window rate limit using a KVNamespace.
 * Returns `true` if the request is allowed (under limit), or `false` if blocked.
 *
 * @param kv The KV namespace to use for counting
 * @param key A unique string identifying the actor and action (e.g., "shorten:abc123hash")
 * @param limit The maximum number of allowed requests in the window
 * @param windowSeconds The duration of the fixed window in seconds
 */
export async function checkRateLimit(
  kv: KVNamespace,
  key: string,
  limit: number,
  windowSeconds: number
): Promise<boolean> {
  const windowTimestamp = Math.floor(Date.now() / 1000 / windowSeconds);
  const fullKey = `ratelimit:${key}:${windowTimestamp}`;

  const currentCount = parseInt((await kv.get(fullKey)) || "0", 10);

  if (currentCount >= limit) {
    return false;
  }

  // Same get-then-put caveat applies here: high concurrency could cause
  // under-counting due to race conditions, which is acceptable for this level
  // of basic rate limiting.
  await kv.put(fullKey, (currentCount + 1).toString(), {
    expirationTtl: windowSeconds,
  });

  return true;
}
