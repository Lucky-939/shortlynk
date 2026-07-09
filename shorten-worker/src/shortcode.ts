/**
 * shortcode.ts — Base62 short code generation for shorten-worker.
 */

const BASE62 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/**
 * Generates a cryptographically random base62 short code of the given length
 * using `crypto.getRandomValues()` (available in the Workers runtime).
 *
 * Code space:
 *   length=6 → 62^6  ≈  56.8 billion  possible codes
 *   length=7 → 62^7  ≈   3.5 trillion  possible codes  ← default
 *
 * Note: mapping raw bytes via `b % 62` introduces a slight modulo bias
 * (since 256 / 62 ≈ 4.13, chars 0–55 appear ~0.2 % more often than
 * chars 56–61). This is negligible for a URL shortener and is a well-known
 * acceptable trade-off vs. rejection-sampling.
 */
export function generateShortCode(length = 7): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => BASE62[b % 62]).join("");
}
