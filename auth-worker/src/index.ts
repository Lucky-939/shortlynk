/**
 * auth-worker — POST /signup, POST /login
 *
 * Manages user accounts stored in USERS_KV and issues HMAC-SHA256 JWTs.
 * Password hashing uses PBKDF2 via the Web Crypto API (see shared/password.ts).
 * JWT signing uses a shared HMAC-SHA256 implementation (see shared/jwt.ts).
 *
 * JWT_SECRET must be provided as a Wrangler secret (not a plain [vars] entry).
 * For local dev, add it to .dev.vars (gitignored). For production:
 *   wrangler secret put JWT_SECRET --cwd auth-worker
 */

import { hashPassword, verifyPassword } from "../../shared/password";
import { signJwt } from "../../shared/jwt";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Env {
  USERS_KV: KVNamespace;
  JWT_SECRET: string;
}

/** Shape stored as a JSON string in USERS_KV, keyed by email. */
interface UserRecord {
  passwordHash: string;
  passwordSalt: string;
  userId: string;
  createdAt: string; // ISO 8601
}

// ── Validation ────────────────────────────────────────────────────────────────

// Intentionally simple — we just need structural validity, not RFC 5322
// completeness. The KV key is the email itself so extremely long addresses
// could be a problem; 254 chars is the RFC 5321 maximum.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

// ── CORS ──────────────────────────────────────────────────────────────────────
//
// The frontend (Next.js on localhost:3000 or the deployed Pages URL) is a
// different origin from the worker. Browsers block cross-origin fetch() unless
// the server returns the correct Access-Control-* headers on both the preflight
// OPTIONS request and the actual response.
//
// We use `*` for Allow-Origin here because this is a public auth API — the
// secrets are all server-side (JWT_SECRET, password hashes). In production you
// can tighten this to the specific Pages domain via an env var if desired.

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

/** Attaches CORS headers to an existing Response. */
function withCors(response: Response): Response {
  const next = new Response(response.body, response);
  Object.entries(CORS_HEADERS).forEach(([k, v]) => next.headers.set(k, v));
  return next;
}

/** 204 response for browser OPTIONS preflight requests. */
function handleOptions(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

// ── Utility ───────────────────────────────────────────────────────────────────

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

// ── Handlers ──────────────────────────────────────────────────────────────────

async function handleSignup(request: Request, env: Env): Promise<Response> {
  // 1. Parse body ─────────────────────────────────────────────────────────────
  let body: { email?: unknown; password?: unknown };
  try {
    body = await request.json<{ email?: unknown; password?: unknown }>();
  } catch {
    return json({ error: "Request body must be valid JSON" }, 400);
  }

  const { email, password } = body;

  // 2. Validate inputs ────────────────────────────────────────────────────────
  if (typeof email !== "string" || !EMAIL_RE.test(email.trim())) {
    return json({ error: "Invalid email address" }, 400);
  }
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    return json(
      { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` },
      400
    );
  }

  const normalizedEmail = email.trim().toLowerCase();

  // 3. Check for duplicate email ──────────────────────────────────────────────
  //
  // KNOWN RACE-CONDITION LIMITATION (same as shorten-worker's alias check):
  // KV has no atomic "put-if-not-exists". Two concurrent signup requests for
  // the same email could both read null and both proceed to write, with the
  // second overwriting the first. At this project's scale this is an accepted
  // limitation. A Durable Object would be needed to eliminate it entirely.
  const existing = await env.USERS_KV.get(normalizedEmail);
  if (existing !== null) {
    return json({ error: "Email already registered" }, 409);
  }

  // 4. Hash password and create record ───────────────────────────────────────
  const { hash: passwordHash, salt: passwordSalt } = await hashPassword(password);
  const userId = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  const record: UserRecord = { passwordHash, passwordSalt, userId, createdAt };
  await env.USERS_KV.put(normalizedEmail, JSON.stringify(record));

  // 5. Respond — never return the password hash ──────────────────────────────
  return json({ userId, email: normalizedEmail }, 201);
}

async function handleLogin(request: Request, env: Env): Promise<Response> {
  // 1. Parse body ─────────────────────────────────────────────────────────────
  let body: { email?: unknown; password?: unknown };
  try {
    body = await request.json<{ email?: unknown; password?: unknown }>();
  } catch {
    return json({ error: "Request body must be valid JSON" }, 400);
  }

  const { email, password } = body;

  if (typeof email !== "string" || typeof password !== "string") {
    // Return the same generic message as all other auth failures — do not
    // leak which field was wrong.
    return json({ error: "Invalid credentials" }, 401);
  }

  const normalizedEmail = email.trim().toLowerCase();

  // 2. Look up user ───────────────────────────────────────────────────────────
  //
  // IMPORTANT: We return the SAME "Invalid credentials" message whether the
  // email doesn't exist or the password is wrong. Returning a distinct message
  // for an unknown email ("user not found") would let attackers enumerate
  // which email addresses are registered — a well-known account enumeration
  // vulnerability. Generic error messages close that information leak.
  const raw = await env.USERS_KV.get(normalizedEmail);
  if (raw === null) {
    return json({ error: "Invalid credentials" }, 401);
  }

  let record: UserRecord;
  try {
    record = JSON.parse(raw) as UserRecord;
  } catch {
    // Corrupted KV entry — fail safely with the same generic message
    return json({ error: "Invalid credentials" }, 401);
  }

  // 3. Verify password ────────────────────────────────────────────────────────
  const passwordValid = await verifyPassword(
    password,
    record.passwordHash,
    record.passwordSalt
  );
  if (!passwordValid) {
    return json({ error: "Invalid credentials" }, 401);
  }

  // 4. Issue JWT ──────────────────────────────────────────────────────────────
  const token = await signJwt(
    { sub: record.userId, email: normalizedEmail },
    env.JWT_SECRET
  );

  return json({ token, userId: record.userId, email: normalizedEmail }, 200);
}

// ── Router ────────────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const { pathname } = new URL(request.url);

    // Handle CORS preflight for all routes
    if (request.method === "OPTIONS") return handleOptions();

    if (request.method === "POST" && pathname === "/signup") {
      return withCors(await handleSignup(request, env));
    }
    if (request.method === "POST" && pathname === "/login") {
      return withCors(await handleLogin(request, env));
    }

    return withCors(json({ error: "Not found" }, 404));
  },
} satisfies ExportedHandler<Env>;
