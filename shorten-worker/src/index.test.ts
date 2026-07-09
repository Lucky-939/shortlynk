/**
 * shorten-worker unit tests
 *
 * Uses plain vitest (Node environment) with an in-memory KV mock.
 * This is the right tool for unit-testing business logic — the
 * @cloudflare/vitest-pool-workers runner is for full-runtime integration
 * tests that need real Workers APIs (Durable Objects, Cache, etc.), which
 * we don't need here.
 *
 * crypto.getRandomValues() is available globally in Node.js ≥19, which
 * covers the generateShortCode() calls in the handler.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import worker from "./index";
import { validateLongUrl, validateAlias } from "./validators";
import { generateShortCode } from "./shortcode";

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

// ── Helper ───────────────────────────────────────────────────────────────────

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/shorten", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function callWorker(body: unknown, kv: KVNamespace) {
  const req = makeRequest(body);
  const env = { URLS_KV: kv };
  const ctx = {} as ExecutionContext;
  return worker.fetch(req, env, ctx);
}

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
    // 62^7 ≈ 3.5 trillion — 20 calls should all be unique
    expect(codes.size).toBe(20);
  });
});

// ── Integration tests: POST /shorten ─────────────────────────────────────────

describe("POST /shorten — valid URL", () => {
  let kv: ReturnType<typeof createMockKV>;

  beforeEach(() => { kv = createMockKV(); });

  it("returns 201 with shortUrl, shortCode, longUrl, createdAt", async () => {
    const res = await callWorker({ longUrl: "https://example.com/long/path" }, kv);

    expect(res.status).toBe(201);
    expect(res.headers.get("Content-Type")).toContain("application/json");

    const body = await res.json() as Record<string, string>;
    expect(body.shortCode).toMatch(/^[A-Za-z0-9]{7}$/);
    expect(body.longUrl).toBe("https://example.com/long/path");
    expect(body.shortUrl).toMatch(new RegExp(`/${body.shortCode}$`));
    expect(body.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it("persists a LinkRecord to URLS_KV on success", async () => {
    const res = await callWorker({ longUrl: "https://stored.com" }, kv);
    const { shortCode } = await res.json() as { shortCode: string };

    expect(kv.put).toHaveBeenCalledOnce();
    const [putKey, putValue] = (kv.put as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string];
    expect(putKey).toBe(shortCode);
    const record = JSON.parse(putValue);
    expect(record.longUrl).toBe("https://stored.com");
    expect(record.userId).toBe("anonymous");
    expect(record.createdAt).toBeDefined();
  });
});

describe("POST /shorten — invalid URL", () => {
  let kv: ReturnType<typeof createMockKV>;

  beforeEach(() => { kv = createMockKV(); });

  it("returns 400 with { error: 'Invalid URL' } for a plain string", async () => {
    const res = await callWorker({ longUrl: "not-a-url" }, kv);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("Invalid URL");
  });

  it("returns 400 for javascript: URI", async () => {
    const res = await callWorker({ longUrl: "javascript:alert(1)" }, kv);
    expect(res.status).toBe(400);
  });

  it("returns 400 when longUrl is missing", async () => {
    const res = await callWorker({}, kv);
    expect(res.status).toBe(400);
  });

  it("does not call URLS_KV.put on validation failure", async () => {
    await callWorker({ longUrl: "bad" }, kv);
    expect(kv.put).not.toHaveBeenCalled();
  });
});

describe("POST /shorten — custom alias", () => {
  let kv: ReturnType<typeof createMockKV>;

  beforeEach(() => { kv = createMockKV(); });

  it("returns 201 using the custom alias as shortCode", async () => {
    const res = await callWorker({ longUrl: "https://example.com", customAlias: "my-link" }, kv);
    expect(res.status).toBe(201);
    const body = await res.json() as { shortCode: string };
    expect(body.shortCode).toBe("my-link");
  });

  it("returns 400 for an alias with invalid characters", async () => {
    const res = await callWorker({ longUrl: "https://example.com", customAlias: "bad alias!" }, kv);
    expect(res.status).toBe(400);
  });

  it("returns 400 for an alias shorter than 3 chars", async () => {
    const res = await callWorker({ longUrl: "https://example.com", customAlias: "ab" }, kv);
    expect(res.status).toBe(400);
  });

  // ── duplicate alias rejected ────────────────────────────────────────────
  it("returns 409 with { error: 'Alias already taken' } when alias exists in KV", async () => {
    // Pre-populate KV with the alias
    kv._store.set(
      "taken-alias",
      JSON.stringify({ longUrl: "https://original.com", createdAt: new Date().toISOString(), userId: "anonymous" })
    );

    const res = await callWorker({ longUrl: "https://new.com", customAlias: "taken-alias" }, kv);
    expect(res.status).toBe(409);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("Alias already taken");
  });

  it("does not overwrite the existing KV entry on 409", async () => {
    kv._store.set("taken-alias", JSON.stringify({ longUrl: "https://original.com", createdAt: "", userId: "" }));
    await callWorker({ longUrl: "https://new.com", customAlias: "taken-alias" }, kv);
    expect(kv.put).not.toHaveBeenCalled();
  });
});

describe("POST /shorten — collision retry", () => {
  it("returns 500 when all collision-retry attempts are exhausted", async () => {
    // A KV where every .get() returns non-null → every candidate looks taken
    const alwaysTaken: KVNamespace = {
      get: vi.fn(async () => "occupied" as unknown as null),
      put: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined),
      list: vi.fn(async () => ({ keys: [], list_complete: true, cacheStatus: null })),
      getWithMetadata: vi.fn(async () => ({ value: "occupied", metadata: null, cacheStatus: null })),
    } as unknown as KVNamespace;

    const res = await callWorker({ longUrl: "https://example.com" }, alwaysTaken);
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

    await callWorker({ longUrl: "https://example.com" }, alwaysTaken);
    // Should have tried exactly 5 times (MAX_COLLISION_RETRIES)
    expect(getCount.n).toBe(5);
  });
});
