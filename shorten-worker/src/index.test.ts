/**
 * shorten-worker unit tests
 *
 * Uses plain vitest (Node environment) with an in-memory KV mock.
 * This is the right tool for unit-testing business logic — the
 * @cloudflare/vitest-pool-workers runner is for full-runtime integration
 * tests that need real Workers APIs (Durable Objects, Cache, etc.), which
 * we don't need here.
 *
 * crypto.getRandomValues() and crypto.subtle are available globally in
 * Node.js ≥ 18.7, which covers both generateShortCode() and signJwt().
 *
 * AUTH NOTE: POST /shorten now requires a valid Bearer JWT. All success-path
 * tests generate a token via signJwt() at the start of the suite using a
 * shared TEST_SECRET. The env mock carries the same secret for verification.
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import worker from "./index";
import { validateLongUrl, validateAlias } from "./validators";
import { generateShortCode } from "./shortcode";
import { signJwt } from "../../shared/jwt";

// ── Constants ─────────────────────────────────────────────────────────────────

const TEST_SECRET = "test-jwt-secret-at-least-32-chars!";
const TEST_USER_ID = "test-user-uuid-1234";
const TEST_EMAIL = "tester@example.com";

// ── In-memory KV mock ────────────────────────────────────────────────────────

function createMockKV() {
  const store = new Map<string, string>();
  return {
    _store: store,
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => { store.set(key, value); }),
    delete: vi.fn(async (key: string) => { store.delete(key); }),
    list: vi.fn(async () => ({ keys: [] as { name: string }[], list_complete: true, cacheStatus: null })),
    getWithMetadata: vi.fn(async (key: string) => ({
      value: store.get(key) ?? null,
      metadata: null,
      cacheStatus: null,
    })),
  } as unknown as KVNamespace & { _store: Map<string, string> };
}

// ── JWT test token ────────────────────────────────────────────────────────────

// Generated once before all tests — avoids per-test async overhead.
// All success-path tests use this token; auth-rejection tests use no token
// or a garbage string.
let validToken: string;

beforeAll(async () => {
  validToken = await signJwt(
    { sub: TEST_USER_ID, email: TEST_EMAIL },
    TEST_SECRET
  );
});

// ── Request helpers ───────────────────────────────────────────────────────────

function makeRequest(body: unknown, token?: string, ip?: string): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (ip) headers["CF-Connecting-IP"] = ip;
  return new Request("http://localhost/shorten", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

async function callWorker(body: unknown, kv: KVNamespace, token?: string, ip?: string) {
  const req = makeRequest(body, token, ip);
  const env = { URLS_KV: kv, JWT_SECRET: TEST_SECRET, API_BASE_URL: "http://localhost:8788" };
  const ctx = {} as ExecutionContext;
  return worker.fetch(req, env, ctx);
}

// Shorthand for authed calls (all normal success/failure tests)
async function authedCall(body: unknown, kv: KVNamespace, ip?: string) {
  return callWorker(body, kv, validToken, ip);
}

// ── CORS ──────────────────────────────────────────────────────────────────────

describe("CORS", () => {
  it("OPTIONS returns 204 with CORS headers", async () => {
    const req = new Request("http://localhost/shorten", { method: "OPTIONS" });
    const res = await worker.fetch(req, { URLS_KV: createMockKV(), JWT_SECRET: TEST_SECRET, API_BASE_URL: "http://localhost:8788" }, {} as ExecutionContext);
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("POST returns Access-Control-Allow-Origin", async () => {
    const res = await callWorker({}, createMockKV());
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});

// ── Unit tests: validators ───────────────────────────────────────────────────

describe("validateLongUrl()", () => {
  it("accepts a well-formed https URL", () => {
    expect(validateLongUrl("https://example.com/path?q=1")).toEqual({ ok: true });
  });

  it("accepts a well-formed http URL", () => {
    expect(validateLongUrl("http://example.com")).toEqual({ ok: true });
  });

  it("rejects a plain string", () => {
    expect(validateLongUrl("not-a-url")).toEqual({ ok: false, error: "Invalid URL" });
  });

  it("rejects javascript: scheme", () => {
    expect(validateLongUrl("javascript:alert(1)")).toEqual({ ok: false, error: "Invalid URL" });
  });

  it("rejects ftp: scheme", () => {
    expect(validateLongUrl("ftp://files.example.com")).toEqual({ ok: false, error: "Invalid URL" });
  });
});

describe("validateAlias()", () => {
  it("accepts alphanumeric-only alias", () => {
    expect(validateAlias("myLink123")).toEqual({ ok: true });
  });

  it("accepts alias with hyphens and underscores", () => {
    expect(validateAlias("my-link_v2")).toEqual({ ok: true });
  });

  it("rejects alias shorter than 3 chars", () => {
    expect(validateAlias("ab").ok).toBe(false);
  });

  it("rejects alias longer than 30 chars", () => {
    expect(validateAlias("a".repeat(31)).ok).toBe(false);
  });

  it("rejects alias with spaces", () => {
    expect(validateAlias("bad alias").ok).toBe(false);
  });

  it("rejects alias with special characters", () => {
    expect(validateAlias("bad!alias").ok).toBe(false);
  });
});

describe("generateShortCode()", () => {
  it("returns a string of the requested length", () => {
    expect(generateShortCode(7)).toHaveLength(7);
    expect(generateShortCode(6)).toHaveLength(6);
  });

  it("returns only base62 characters", () => {
    const code = generateShortCode(7);
    expect(code).toMatch(/^[A-Za-z0-9]+$/);
  });

  it("produces unique codes on repeated calls", () => {
    const codes = new Set(Array.from({ length: 20 }, () => generateShortCode(7)));
    expect(codes.size).toBe(20);
  });
});

// ── Auth guard tests (3 new) ──────────────────────────────────────────────────

describe("POST /shorten — Authorization header", () => {
  let kv: ReturnType<typeof createMockKV>;
  beforeEach(() => { kv = createMockKV(); });

  it("returns 401 when no Authorization header is present", async () => {
    // callWorker with no token argument = no Authorization header
    const res = await callWorker({ longUrl: "https://example.com" }, kv);
    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toContain("Authorization");
  });

  it("returns 401 for a garbage / malformed token", async () => {
    const res = await callWorker({ longUrl: "https://example.com" }, kv, "not.a.valid.jwt");
    expect(res.status).toBe(401);
  });

  it("returns 401 for a token signed with the wrong secret", async () => {
    const badToken = await signJwt(
      { sub: "evil-user", email: "hacker@evil.com" },
      "completely-different-secret!!"
    );
    const res = await callWorker({ longUrl: "https://example.com" }, kv, badToken);
    expect(res.status).toBe(401);
  });

  it("succeeds with a valid token and stores the correct userId in the record", async () => {
    const res = await authedCall({ longUrl: "https://example.com/long" }, kv);
    expect(res.status).toBe(201);

    const { shortCode } = await res.json() as { shortCode: string };
    const raw = kv._store.get(shortCode);
    expect(raw).not.toBeNull();
    const record = JSON.parse(raw!) as { userId: string };
    // userId in KV must match the sub claim from the JWT — not "anonymous"
    expect(record.userId).toBe(TEST_USER_ID);
  });
});

// ── Integration tests: POST /shorten ─────────────────────────────────────────

describe("POST /shorten — valid URL", () => {
  let kv: ReturnType<typeof createMockKV>;

  beforeEach(() => { kv = createMockKV(); });

  it("returns 201 with shortUrl, shortCode, longUrl, createdAt", async () => {
    const res = await authedCall({ longUrl: "https://example.com/long/path" }, kv);

    expect(res.status).toBe(201);
    expect(res.headers.get("Content-Type")).toContain("application/json");

    const body = await res.json() as Record<string, string>;
    expect(body.shortCode).toMatch(/^[A-Za-z0-9]{7}$/);
    expect(body.longUrl).toBe("https://example.com/long/path");
    expect(body.shortUrl).toMatch(new RegExp(`/${body.shortCode}$`));
    expect(body.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it("persists a LinkRecord to URLS_KV with real userId (not 'anonymous')", async () => {
    const res = await authedCall({ longUrl: "https://stored.com" }, kv);
    const { shortCode } = await res.json() as { shortCode: string };

    // Two puts: (1) link record, (2) user-links index
    expect(kv.put).toHaveBeenCalledTimes(2);
    const [putKey, putValue] = (kv.put as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string];
    expect(putKey).toBe(shortCode);
    const record = JSON.parse(putValue);
    expect(record.longUrl).toBe("https://stored.com");
    expect(record.userId).toBe(TEST_USER_ID); // real userId from JWT sub claim
    expect(record.createdAt).toBeDefined();
  });

  it("appends the new shortCode to user-links:{userId} in URLS_KV", async () => {
    // First link
    const res1 = await authedCall({ longUrl: "https://first.com" }, kv);
    const { shortCode: sc1 } = await res1.json() as { shortCode: string };

    // Second link from the same user
    const res2 = await authedCall({ longUrl: "https://second.com" }, kv);
    const { shortCode: sc2 } = await res2.json() as { shortCode: string };

    const indexRaw = kv._store.get(`user-links:${TEST_USER_ID}`);
    expect(indexRaw).not.toBeNull();
    const index = JSON.parse(indexRaw!) as string[];
    expect(index).toContain(sc1);
    expect(index).toContain(sc2);
    expect(index).toHaveLength(2);
  });
});

describe("POST /shorten — invalid URL", () => {
  let kv: ReturnType<typeof createMockKV>;

  beforeEach(() => { kv = createMockKV(); });

  it("returns 400 with { error: 'Invalid URL' } for a plain string", async () => {
    const res = await authedCall({ longUrl: "not-a-url" }, kv);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("Invalid URL");
  });

  it("returns 400 for javascript: URI", async () => {
    const res = await authedCall({ longUrl: "javascript:alert(1)" }, kv);
    expect(res.status).toBe(400);
  });

  it("returns 400 when longUrl is missing", async () => {
    const res = await authedCall({}, kv);
    expect(res.status).toBe(400);
  });

  it("does not call URLS_KV.put on validation failure", async () => {
    await authedCall({ longUrl: "bad" }, kv);
    expect(kv.put).not.toHaveBeenCalled();
  });
});

describe("POST /shorten — custom alias", () => {
  let kv: ReturnType<typeof createMockKV>;

  beforeEach(() => { kv = createMockKV(); });

  it("returns 201 using the custom alias as shortCode", async () => {
    const res = await authedCall({ longUrl: "https://example.com", customAlias: "my-link" }, kv);
    expect(res.status).toBe(201);
    const body = await res.json() as { shortCode: string };
    expect(body.shortCode).toBe("my-link");
  });

  it("returns 400 for an alias with invalid characters", async () => {
    const res = await authedCall({ longUrl: "https://example.com", customAlias: "bad alias!" }, kv);
    expect(res.status).toBe(400);
  });

  it("returns 400 for an alias shorter than 3 chars", async () => {
    const res = await authedCall({ longUrl: "https://example.com", customAlias: "ab" }, kv);
    expect(res.status).toBe(400);
  });

  it("returns 409 with { error: 'Alias already taken' } when alias exists in KV", async () => {
    kv._store.set(
      "taken-alias",
      JSON.stringify({ longUrl: "https://original.com", createdAt: new Date().toISOString(), userId: "someone" })
    );

    const res = await authedCall({ longUrl: "https://new.com", customAlias: "taken-alias" }, kv);
    expect(res.status).toBe(409);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("Alias already taken");
  });

  it("does not overwrite the existing KV entry on 409", async () => {
    kv._store.set("taken-alias", JSON.stringify({ longUrl: "https://original.com", createdAt: "", userId: "" }));
    await authedCall({ longUrl: "https://new.com", customAlias: "taken-alias" }, kv);
    expect(kv.put).not.toHaveBeenCalled();
  });
});

describe("POST /shorten — collision retry", () => {
  it("returns 500 when all collision-retry attempts are exhausted", async () => {
    const alwaysTaken: KVNamespace = {
      get: vi.fn(async () => "occupied" as unknown as null),
      put: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined),
      list: vi.fn(async () => ({ keys: [], list_complete: true, cacheStatus: null })),
      getWithMetadata: vi.fn(async () => ({ value: "occupied", metadata: null, cacheStatus: null })),
    } as unknown as KVNamespace;

    const res = await callWorker({ longUrl: "https://example.com" }, alwaysTaken, validToken);
    expect(res.status).toBe(500);
    const body = await res.json() as { error: string };
    expect(body.error).toContain("unique short code");
  });

  it("retries up to MAX_COLLISION_RETRIES (5) times before giving up", async () => {
    const getCount = { n: 0 };
    const alwaysTaken: KVNamespace = {
      get: vi.fn(async () => { getCount.n++; return "occupied" as unknown as null; }),
      put: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined),
      list: vi.fn(async () => ({ keys: [], list_complete: true, cacheStatus: null })),
      getWithMetadata: vi.fn(async () => ({ value: null, metadata: null, cacheStatus: null })),
    } as unknown as KVNamespace;

    await callWorker({ longUrl: "https://example.com" }, alwaysTaken, validToken);
    expect(getCount.n).toBe(5);
  });
});

describe("Rate Limiting", () => {
  let kv: KVNamespace & { _store: Map<string, string> };

  beforeEach(() => {
    kv = createMockKV();
  });

  it("skips rate limiting if CF-Connecting-IP is absent", async () => {
    // 21 requests with NO ip header
    for (let i = 0; i < 21; i++) {
      const res = await authedCall({ longUrl: "https://example.com" }, kv);
      expect(res.status).not.toBe(429);
    }
  });

  it("limits an IP to 20 requests per hour", async () => {
    const ip = "1.2.3.4";
    // 20 requests should succeed
    for (let i = 0; i < 20; i++) {
      const res = await authedCall({ longUrl: "https://example.com" }, kv, ip);
      expect(res.status).toBe(201); // Assuming 201 for valid shorten request
    }

    // 21st request should be rate limited
    const res21 = await authedCall({ longUrl: "https://example.com" }, kv, ip);
    expect(res21.status).toBe(429);
    const body = await res21.json() as { error: string };
    expect(body.error).toBe("Too many requests, try again later");
  });

  it("tracks different IPs independently", async () => {
    const ip1 = "10.0.0.1";
    const ip2 = "10.0.0.2";

    // Exhaust ip1's limit
    for (let i = 0; i < 20; i++) {
      await authedCall({ longUrl: "https://example.com" }, kv, ip1);
    }
    const resLimitIp1 = await authedCall({ longUrl: "https://example.com" }, kv, ip1);
    expect(resLimitIp1.status).toBe(429);

    // ip2 should still be allowed
    const resIp2 = await authedCall({ longUrl: "https://example.com" }, kv, ip2);
    expect(resIp2.status).toBe(201);
  });
});

