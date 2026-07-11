/**
 * shorten-worker — POST /shorten
 *
 * Creates a short URL mapping in URLS_KV and returns the short URL.
 *
 * Requires a valid Bearer JWT in the Authorization header (issued by
 * auth-worker). The userId from the token's `sub` claim is stored with
 * the link record, replacing the former hardcoded "anonymous" value.
 */

import { validateLongUrl, validateAlias } from "./validators";
import { generateShortCode } from "./shortcode";
import { verifyJwt } from "../../shared/jwt";

export interface Env {
  URLS_KV: KVNamespace;
  JWT_SECRET: string;
}

/** Shape stored as a JSON string value in URLS_KV. */
interface LinkRecord {
  longUrl: string;
  createdAt: string; // ISO 8601
  userId: string;
}

/** Shape of a valid POST /shorten request body. */
interface ShortenRequestBody {
  longUrl?: unknown;
  customAlias?: unknown;
}

/** Maximum times to retry finding a unique auto-generated short code. */
const MAX_COLLISION_RETRIES = 5;

// ── Utility ────────────────────────────────────────────────────────────────────

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

// ── Auth ───────────────────────────────────────────────────────────────────────

/**
 * Extracts and verifies the Bearer token from the Authorization header.
 *
 * @returns The verified JWT payload (containing `sub` = userId) or null if
 *          the header is missing, malformed, or the token is invalid/expired.
 */
async function extractVerifiedToken(request: Request, secret: string) {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  const token = authHeader.slice("Bearer ".length).trim();
  if (!token) return null;
  return verifyJwt(token, secret);
}

// ── Handler ────────────────────────────────────────────────────────────────────

async function handleShorten(request: Request, env: Env): Promise<Response> {
  // 0. Verify JWT ────────────────────────────────────────────────────────────
  const payload = await extractVerifiedToken(request, env.JWT_SECRET);
  if (!payload) {
    return json({ error: "Missing or invalid Authorization token" }, 401);
  }
  const userId = payload.sub;

  // 1. Parse JSON body ──────────────────────────────────────────────────────
  let body: ShortenRequestBody;
  try {
    body = await request.json<ShortenRequestBody>();
  } catch {
    return json({ error: "Request body must be valid JSON" }, 400);
  }

  const { longUrl, customAlias } = body;

  // 2. Validate longUrl ─────────────────────────────────────────────────────
  if (typeof longUrl !== "string" || longUrl.trim() === "") {
    return json({ error: "Missing required field: longUrl" }, 400);
  }
  const urlResult = validateLongUrl(longUrl);
  if (!urlResult.ok) {
    return json({ error: urlResult.error }, 400);
  }

  // 3. Resolve shortCode ────────────────────────────────────────────────────
  let shortCode: string;

  if (customAlias !== undefined) {
    // ── Custom alias ────────────────────────────────────────────────────────
    if (typeof customAlias !== "string") {
      return json({ error: "customAlias must be a string" }, 400);
    }
    const aliasResult = validateAlias(customAlias);
    if (!aliasResult.ok) {
      return json({ error: aliasResult.error }, 400);
    }

    // Cloudflare KV does not support atomic "put-if-not-exists" semantics
    // (unlike DynamoDB's conditional PutItem). We must do a get-then-put,
    // which has a theoretical race condition: two concurrent requests with
    // the same alias could both read null and then both write, with the
    // second write silently overwriting the first. At this project's scale
    // (low traffic, no adversarial alias squatting expected) this is an
    // accepted known limitation. Eliminating it would require a distributed
    // lock via a Durable Object.
    const existing = await env.URLS_KV.get(customAlias);
    if (existing !== null) {
      return json({ error: "Alias already taken" }, 409);
    }
    shortCode = customAlias;
  } else {
    // ── Auto-generate ───────────────────────────────────────────────────────
    // 62^7 ≈ 3.5 trillion codes → collisions are astronomically unlikely,
    // but we guard against them with bounded retries anyway.
    let generated: string | null = null;
    for (let attempt = 0; attempt < MAX_COLLISION_RETRIES; attempt++) {
      const candidate = generateShortCode(7);
      const collision = await env.URLS_KV.get(candidate);
      if (collision === null) {
        generated = candidate;
        break;
      }
    }
    if (generated === null) {
      // Exhausted retries — this should be practically impossible unless KV is
      // nearly saturated or the random generator is broken.
      return json(
        { error: "Failed to generate a unique short code. Please try again." },
        500
      );
    }
    shortCode = generated;
  }

  // 4. Persist to URLS_KV ───────────────────────────────────────────────────
  const createdAt = new Date().toISOString();
  const record: LinkRecord = {
    longUrl,
    createdAt,
    userId, // real userId from verified JWT, no longer "anonymous"
  };
  await env.URLS_KV.put(shortCode, JSON.stringify(record));

  // 5. Build shortUrl from the request's own origin ─────────────────────────
  // Workers naturally receive the deployed origin in request.url, so this
  // will produce the correct public URL without any extra config once deployed.
  // In local dev, the origin will be http://127.0.0.1:8787.
  const origin = new URL(request.url).origin;
  const shortUrl = `${origin}/${shortCode}`;

  return json({ shortUrl, shortCode, longUrl, createdAt }, 201);
}

// ── Router ─────────────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (request.method === "POST" && pathname === "/shorten") {
      return handleShorten(request, env);
    }

    return json({ error: "Not found" }, 404);
  },
} satisfies ExportedHandler<Env>;
