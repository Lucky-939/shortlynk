/**
 * redirect-worker unit tests
 *
 * Plain vitest (Node environment) with in-memory KV and Queue mocks.
 *
 * Key patterns:
 * • MockContext captures Promises registered with ctx.waitUntil() so
 *   we can await them before asserting on queue side-effects.
 * • crypto.subtle.digest is available in Node.js ≥19 (we're on v24),
 *   so the SHA-256 hash test works without polyfills.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import worker, { type ClickEvent } from "./index";
import { hashIp } from "./hash";

// ── Mock helpers ─────────────────────────────────────────────────────────────

function createMockKV(store: Map<string, string> = new Map()) {
  return {
    _store: store,
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => { store.set(key, value); }),
    delete: vi.fn(async (key: string) => { store.delete(key); }),
    list: vi.fn(async () => ({ keys: [], list_complete: true, cacheStatus: null })),
    getWithMetadata: vi.fn(async (key: string) => ({
      value: store.get(key) ?? null,
      metadata: null,
      cacheStatus: null,
    })),
  } as unknown as KVNamespace & { _store: Map<string, string> };
}

function createMockQueue() {
  const sent: ClickEvent[] = [];
  return {
    _sent: sent,
    send: vi.fn(async (msg: ClickEvent) => { sent.push(msg); }),
    sendBatch: vi.fn(async () => undefined),
  } as unknown as Queue<ClickEvent> & { _sent: ClickEvent[] };
}

/** Captures waitUntil Promises so tests can flush them before asserting. */
function createMockContext() {
  const pending: Promise<unknown>[] = [];
  return {
    _pending: pending,
    waitUntil: vi.fn((p: Promise<unknown>) => { pending.push(p); }),
    passThroughOnException: vi.fn(),
  } as unknown as ExecutionContext & { _pending: Promise<unknown>[] };
}

/** Build a GET request to /{shortCode} with optional extra headers. */
function makeRequest(
  shortCode: string,
  headers: Record<string, string> = {}
): Request {
  return new Request(`http://localhost/${shortCode}`, {
    method: "GET",
    headers,
  });
}

/** Call the worker and flush all waitUntil promises before returning. */
async function callWorker(
  req: Request,
  kv: KVNamespace,
  queue: Queue<ClickEvent>
) {
  const env = { URLS_KV: kv, CLICK_QUEUE: queue };
  const ctx = createMockContext();
  const res = await worker.fetch(req, env, ctx);
  // Flush background work registered with waitUntil before we assert
  await Promise.all(ctx._pending);
  return { res, ctx };
}

// ── Fixture ──────────────────────────────────────────────────────────────────

const STORED_RECORD = JSON.stringify({
  longUrl: "https://example.com/original/page",
  createdAt: "2026-01-01T00:00:00.000Z",
  userId: "anonymous",
});

// ── hash.ts unit tests ───────────────────────────────────────────────────────

describe("hashIp()", () => {
  it("returns a 64-character lowercase hex string for a valid IP", async () => {
    const result = await hashIp("1.2.3.4");
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });

  it("does not store the raw IP in the hash output", async () => {
    const ip = "203.0.113.42";
    const result = await hashIp(ip);
    expect(result).not.toBe(ip);
    expect(result).not.toContain(ip);
  });

  it("produces the same hash for the same IP (deterministic)", async () => {
    const h1 = await hashIp("10.0.0.1");
    const h2 = await hashIp("10.0.0.1");
    expect(h1).toBe(h2);
  });

  it("produces different hashes for different IPs", async () => {
    const h1 = await hashIp("10.0.0.1");
    const h2 = await hashIp("10.0.0.2");
    expect(h1).not.toBe(h2);
  });

  it("returns null for null input", async () => {
    expect(await hashIp(null)).toBeNull();
  });

  it("returns null for empty string input", async () => {
    expect(await hashIp("")).toBeNull();
  });
});

// ── GET /{shortCode} — found ──────────────────────────────────────────────────

describe("GET /{shortCode} — found", () => {
  let kv: ReturnType<typeof createMockKV>;
  let queue: ReturnType<typeof createMockQueue>;

  beforeEach(() => {
    kv = createMockKV(new Map([["abc1234", STORED_RECORD]]));
    queue = createMockQueue();
  });

  it("returns HTTP 301", async () => {
    const { res } = await callWorker(makeRequest("abc1234"), kv, queue);
    expect(res.status).toBe(301);
  });

  it("sets Location header to the stored longUrl", async () => {
    const { res } = await callWorker(makeRequest("abc1234"), kv, queue);
    expect(res.headers.get("Location")).toBe("https://example.com/original/page");
  });

  it("returns a null/empty body (not a JSON payload)", async () => {
    const { res } = await callWorker(makeRequest("abc1234"), kv, queue);
    const body = await res.text();
    expect(body).toBe("");
  });

  it("sends exactly one click event to the queue", async () => {
    await callWorker(makeRequest("abc1234"), kv, queue);
    expect(queue.send).toHaveBeenCalledOnce();
  });

  it("click event contains correct shortCode", async () => {
    await callWorker(makeRequest("abc1234"), kv, queue);
    const [event] = queue._sent;
    expect(event.shortCode).toBe("abc1234");
  });

  it("click event timestamp is a valid ISO 8601 string", async () => {
    await callWorker(makeRequest("abc1234"), kv, queue);
    const [event] = queue._sent;
    expect(event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it("click event includes User-Agent from request headers", async () => {
    await callWorker(
      makeRequest("abc1234", { "User-Agent": "Mozilla/5.0 TestBrowser" }),
      kv,
      queue
    );
    const [event] = queue._sent;
    expect(event.userAgent).toBe("Mozilla/5.0 TestBrowser");
  });

  it("click event includes Referer from request headers", async () => {
    await callWorker(
      makeRequest("abc1234", { Referer: "https://google.com" }),
      kv,
      queue
    );
    const [event] = queue._sent;
    expect(event.referer).toBe("https://google.com");
  });

  it("click event userAgent is null when header is absent", async () => {
    await callWorker(makeRequest("abc1234"), kv, queue);
    expect(queue._sent[0].userAgent).toBeNull();
  });

  it("click event referer is null when header is absent", async () => {
    await callWorker(makeRequest("abc1234"), kv, queue);
    expect(queue._sent[0].referer).toBeNull();
  });

  it("click event ipHash is a 64-char hex when CF-Connecting-IP is present", async () => {
    await callWorker(
      makeRequest("abc1234", { "CF-Connecting-IP": "203.0.113.7" }),
      kv,
      queue
    );
    const [event] = queue._sent;
    expect(event.ipHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("click event ipHash is NOT the raw IP address", async () => {
    const rawIp = "203.0.113.7";
    await callWorker(
      makeRequest("abc1234", { "CF-Connecting-IP": rawIp }),
      kv,
      queue
    );
    const [event] = queue._sent;
    expect(event.ipHash).not.toBe(rawIp);
    expect(event.ipHash).not.toContain(rawIp);
  });

  it("click event ipHash is null when CF-Connecting-IP is absent", async () => {
    await callWorker(makeRequest("abc1234"), kv, queue);
    expect(queue._sent[0].ipHash).toBeNull();
  });

  it("queue send happens via ctx.waitUntil (non-blocking)", async () => {
    const env = { URLS_KV: kv, CLICK_QUEUE: queue };
    const ctx = createMockContext();
    // Call without flushing waitUntil to confirm it was registered
    await worker.fetch(makeRequest("abc1234"), env, ctx);
    expect(ctx.waitUntil).toHaveBeenCalledOnce();
    // Queue.send not yet resolved until we flush
    await Promise.all(ctx._pending);
    expect(queue.send).toHaveBeenCalledOnce();
  });
});

// ── GET /{shortCode} — not found ──────────────────────────────────────────────

describe("GET /{shortCode} — not found", () => {
  let kv: ReturnType<typeof createMockKV>;
  let queue: ReturnType<typeof createMockQueue>;

  beforeEach(() => {
    kv = createMockKV(); // empty
    queue = createMockQueue();
  });

  it("returns 404 when shortCode is not in KV", async () => {
    const { res } = await callWorker(makeRequest("missing"), kv, queue);
    expect(res.status).toBe(404);
  });

  it("returns { error: 'Short link not found' } JSON body", async () => {
    const { res } = await callWorker(makeRequest("missing"), kv, queue);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("Short link not found");
  });

  it("does NOT send a queue event for a missing shortCode", async () => {
    await callWorker(makeRequest("missing"), kv, queue);
    expect(queue.send).not.toHaveBeenCalled();
  });

  it("returns 404 for an empty pathname (GET /)", async () => {
    const req = new Request("http://localhost/", { method: "GET" });
    const { res } = await callWorker(req, kv, queue);
    expect(res.status).toBe(404);
  });
});

// ── Non-GET methods ───────────────────────────────────────────────────────────

describe("non-GET methods", () => {
  it("returns 405 for POST requests", async () => {
    const kv = createMockKV();
    const queue = createMockQueue();
    const req = new Request("http://localhost/abc", { method: "POST" });
    const { res } = await callWorker(req, kv, queue);
    expect(res.status).toBe(405);
  });
});
