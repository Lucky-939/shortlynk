/**
 * validators.ts — URL and alias validation helpers for shorten-worker.
 */

type ValidationOk = { ok: true };
type ValidationErr = { ok: false; error: string };
type ValidationResult = ValidationOk | ValidationErr;

/**
 * Validates that `rawUrl` is a well-formed absolute HTTP/HTTPS URL.
 * Rejects any other scheme (e.g. javascript:, ftp:, data:) to prevent
 * link injection attacks.
 */
export function validateLongUrl(rawUrl: string): ValidationResult {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, error: "Invalid URL" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "Invalid URL" };
  }
  return { ok: true };
}

/**
 * Validates a custom alias:
 *   - Alphanumeric characters, hyphens, and underscores only
 *   - Length: 3–30 characters
 */
const ALIAS_REGEX = /^[A-Za-z0-9_-]{3,30}$/;

export function validateAlias(alias: string): ValidationResult {
  if (!ALIAS_REGEX.test(alias)) {
    return {
      ok: false,
      error:
        "Custom alias must be 3–30 characters and contain only letters, digits, hyphens, or underscores",
    };
  }
  return { ok: true };
}
