/**
 * shared/jwt.ts
 *
 * Homegrown HMAC-SHA256 JWT implementation using the Web Crypto API
 * (crypto.subtle). No external JWT library — Workers supports the Web Crypto
 * spec natively, so we sign and verify tokens without any npm dependency.
 *
 * Token structure follows RFC 7519:
 *   base64url(header) . base64url(payload) . base64url(signature)
 *
 * Claims included in every token:
 *   sub   — userId (the "subject" claim)
 *   email — user's email address
 *   iat   — issued-at (Unix seconds)
 *   exp   — expiry (Unix seconds, 7 days from iat)
 */

// ── Base64url helpers ─────────────────────────────────────────────────────────

function base64urlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function base64urlDecode(str: string): Uint8Array {
  // Re-pad to a multiple-of-4 length before passing to atob
  const padded = str + "==".slice(0, (4 - (str.length % 4)) % 4);
  const base64 = padded.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function jsonToBase64url(obj: unknown): string {
  return base64urlEncode(new TextEncoder().encode(JSON.stringify(obj)));
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface JwtPayload {
  /** userId — the "subject" claim */
  sub: string;
  email: string;
  /** Issued-at: Unix timestamp in seconds */
  iat: number;
  /** Expiry: Unix timestamp in seconds */
  exp: number;
}

// ── Key import ────────────────────────────────────────────────────────────────

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Signs a JWT with HMAC-SHA256.
 *
 * @param payload  Must include `sub` (userId) and `email`. `iat` and `exp`
 *                 are generated automatically if not provided.
 * @param secret   The shared secret used for signing (env.JWT_SECRET).
 * @returns        A compact JWT string: `header.payload.signature`
 */
export async function signJwt(
  payload: Pick<JwtPayload, "sub" | "email"> & Partial<Pick<JwtPayload, "iat" | "exp">>,
  secret: string
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const fullPayload: JwtPayload = {
    sub: payload.sub,
    email: payload.email,
    iat: payload.iat ?? now,
    exp: payload.exp ?? now + 7 * 24 * 60 * 60, // 7 days
  };

  const header = { alg: "HS256", typ: "JWT" };
  const headerB64 = jsonToBase64url(header);
  const payloadB64 = jsonToBase64url(fullPayload);
  const signingInput = `${headerB64}.${payloadB64}`;

  const key = await importHmacKey(secret);
  const signatureBytes = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(signingInput)
  );

  return `${signingInput}.${base64urlEncode(new Uint8Array(signatureBytes))}`;
}

/**
 * Verifies a JWT's signature and expiry.
 *
 * Uses `crypto.subtle.verify` for the HMAC check (constant-time by
 * specification — avoids timing side-channels on the signature comparison).
 *
 * @returns The decoded payload, or `null` if the token is invalid or expired.
 *          Never throws — all parse errors are caught and surfaced as `null`.
 */
export async function verifyJwt(
  token: string,
  secret: string
): Promise<JwtPayload | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [headerB64, payloadB64, sigB64] = parts;
  const signingInput = `${headerB64}.${payloadB64}`;

  try {
    const key = await importHmacKey(secret);
    const signatureBytes = base64urlDecode(sigB64);
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      signatureBytes,
      new TextEncoder().encode(signingInput)
    );
    if (!valid) return null;

    // Decode the payload (base64url → JSON)
    const payloadJson = new TextDecoder().decode(base64urlDecode(payloadB64));
    const payload = JSON.parse(payloadJson) as JwtPayload;

    // Reject expired tokens
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now) return null;

    return payload;
  } catch {
    // Malformed base64, invalid JSON, missing fields — all treated as invalid
    return null;
  }
}
