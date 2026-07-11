/**
 * shared/password.ts
 *
 * Password hashing and verification using PBKDF2 via the Web Crypto API.
 *
 * WHY NOT BCRYPT / ARGON2?
 * ─────────────────────────
 * bcrypt and argon2 are implemented as native C extensions in Node.js. The
 * Cloudflare Workers runtime runs V8 in a sandboxed environment with no
 * native addon support and no access to Node's `crypto` module. Neither
 * library is available. Attempting to import them causes a runtime error.
 *
 * WHY PBKDF2 VIA WEB CRYPTO?
 * ───────────────────────────
 * `crypto.subtle` (the W3C Web Crypto API) is part of the WinterCG standard
 * that Cloudflare Workers implements natively. PBKDF2 is a well-established
 * NIST-approved key derivation function (SP 800-132). At 100 000 iterations
 * with SHA-256 it is expensive enough to make offline brute-force attacks
 * impractical on commodity hardware, making it a reasonable substitute for
 * bcrypt in a Workers context. PBKDF2 is also deterministic (same password +
 * salt = same key), which is exactly what we need for verification.
 *
 * For future reference: if Cloudflare ever ships `argon2id` via Web Crypto
 * (proposed in the W3C spec), that would be the preferred upgrade path.
 */

// ── Constants ─────────────────────────────────────────────────────────────────

/** Number of PBKDF2 iterations. NIST recommends ≥ 600 000 for SHA-256 in
 *  high-security contexts, but 100 000 is an acceptable minimum for most
 *  applications and keeps per-request latency reasonable in a Worker. */
const PBKDF2_ITERATIONS = 100_000;

/** Output length in bits (32 bytes = 256-bit key). */
const KEY_LENGTH_BITS = 256;

/** Salt length in bytes. 16 bytes = 128 bits of entropy. */
const SALT_BYTES = 16;

// ── Encoding helpers ──────────────────────────────────────────────────────────

function bufToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBuf(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

// ── Constant-time comparison ──────────────────────────────────────────────────

/**
 * Compares two byte arrays in constant time using XOR accumulation.
 *
 * This is the same algorithm used internally by Node's `crypto.timingSafeEqual`
 * and is the industry-standard pattern for avoiding timing side-channels in
 * password/hash comparison. By OR-ing every XOR result into a single accumulator
 * rather than returning early on the first mismatch, the loop always runs to
 * completion regardless of where the bytes differ.
 */
function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// ── PBKDF2 helper ─────────────────────────────────────────────────────────────

async function deriveKey(password: string, salt: Uint8Array): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    KEY_LENGTH_BITS
  );

  return new Uint8Array(bits);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Hashes a password using PBKDF2-SHA256 with a freshly generated random salt.
 *
 * @returns `{ hash, salt }` — both as lowercase hex strings suitable for
 *          storage in KV. Never store the raw password.
 */
export async function hashPassword(
  password: string
): Promise<{ hash: string; salt: string }> {
  const saltBytes = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const derived = await deriveKey(password, saltBytes);
  return {
    hash: bufToHex(derived.buffer),
    salt: bufToHex(saltBytes.buffer),
  };
}

/**
 * Verifies a password against a previously stored hash and salt.
 *
 * Re-derives the key from `password` + `salt` and compares to `hash` using
 * `constantTimeEqual` to avoid timing side-channels.
 *
 * @returns `true` if the password matches, `false` otherwise.
 */
export async function verifyPassword(
  password: string,
  hash: string,
  salt: string
): Promise<boolean> {
  const saltBytes = hexToBuf(salt);
  const derived = await deriveKey(password, saltBytes);
  return constantTimeEqual(derived, hexToBuf(hash));
}
