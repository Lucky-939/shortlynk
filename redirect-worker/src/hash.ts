/**
 * hash.ts — IP anonymisation helper for redirect-worker.
 *
 * Raw IP addresses are personal data under GDPR/CCPA. We SHA-256-hash
 * them before storing so we can still deduplicate clicks per unique visitor
 * (with high probability) without ever persisting the IP itself.
 *
 * SHA-256 is available via the Web Crypto API (crypto.subtle) in both the
 * Workers runtime and Node.js ≥19, so no extra polyfill is needed.
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
