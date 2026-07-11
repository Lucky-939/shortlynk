/**
 * analytics-worker unit tests
 *
 * Uses plain vitest (Node environment) with in-memory KV mocks.
 * crypto.subtle (used by verifyJwt) is available in Node ≥ 18.7.
 */

import { describe, it, expect, vi, beforeAll } from "vitest";
import worker from "./index";
import { signJwt } from "../../shared/jwt";

// ── Constants ─────────────────────────────────────────────────────────────────

const TEST_SECRET = "test-analytics-secret-32-chars!!";
const OWNER_ID = "owner-user-uuid";
const OTHER_ID = "other-user-uuid";
const OWNER_EMAIL = "owner@example.com";
const OTHER_EMAIL = "other@example.com";

// ── JWT tokens ────────────────────────────────────────────────────────────────

let ownerToken: string;
let otherToken: string;

beforeAll(async () => {
  ownerToken = await signJwt({ sub: OWNER_ID, email: OWNER_EMAIL }, TEST_SECRET);
  otherToken = await signJwt({ sub: OTHER_ID, email: OTHER_EMAIL }, TEST_SECRET);
});

// ── KV mocks ──────────────────────────────────────────────────────────────────

function createMockKV(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    _store: store,
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => { store.set(key, value); }),
    delete: vi.fn(async (key: string) => { store.delete(key); }),
    list: vi.fn(async ({ prefix }: { prefix?: string } = {}) => {
      const keys = [...store.keys()]
        .filter((k) => (prefix ? k.startsWith(prefix) : true))
        .map((name) => ({ name }));
      return { keys, list_complete: true, cacheStatus: null };
    }),
    getWithMetadata: vi.fn(async (key: string) => ({
      value: store.get(key) ?? null,
      metadata: null,
      cacheStatus: null,
    })),
  } as unknown as KVNamespace & { _store: Map<string, string> };
}

// ── Request helpers ───────────────────────────────────────────────────────────

function makeEnv(urlsKvData: Record<string, string>, analyticsKvData: Record<string, string>) {
  return {
    URLS_KV: createMockKV(urlsKvData),
    ANALYTICS_KV: createMockKV(analyticsKvData),
    JWT_SECRET: TEST_SECRET,
  } as unknown as { URLS_KV: KVNamespace; ANALYTICS_KV: KVNamespace; JWT_SECRET: string };
}

async function get(path: string, token: string | null, env: ReturnType<typeof makeEnv>) {
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const req = new Request(`http://localhost${path}`, { method: "GET", headers });
  return worker.fetch(req, env, {} as ExecutionContext);
}

// ── Link record helper ────────────────────────────────────────────────────────

function linkRecord(shortCode: string, userId: string, longUrl = "https://example.com") {
  return JSON.stringify({
    longUrl,
    createdAt: "2025-06-15T10:00:00.000Z",
    userId,
  });
}

// ── GET /links ────────────────────────────────────────────────────────────────

describe("GET /links — no auth", () => {
  it("returns 401 when no Authorization header is present", async () => {
    const env = makeEnv({}, {});
    const res = await get("/links", null, env);
    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toContain("Authorization");
  });

  it("returns 401 for a garbage token", async () => {
    const env = makeEnv({}, {});
    const res = await get("/links", "not.valid.jwt", env);
    expect(res.status).toBe(401);
  });
});

describe("GET /links — user with zero links", () => {
  it("returns 200 with empty array when no user-links index exists", async () => {
    const env = makeEnv({}, {});
    const res = await get("/links", ownerToken, env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([]);
  });

  it("returns 200 with empty array when index is an empty list", async () => {
    const env = makeEnv({ [`user-links:${OWNER_ID}`]: "[]" }, {});
    const res = await get("/links", ownerToken, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });
});

describe("GET /links — user with links", () => {
  it("returns 200 with correct shape and totalClicks for each link", async () => {
    const urlsKv = {
      [`user-links:${OWNER_ID}`]: JSON.stringify(["abc123", "xyz789"]),
      "abc123": linkRecord("abc123", OWNER_ID, "https://first.com"),
      "xyz789": linkRecord("xyz789", OWNER_ID, "https://second.com"),
    };
    const analyticsKv = {
      "total:abc123": "42",
      "total:xyz789": "7",
    };

    const env = makeEnv(urlsKv, analyticsKv);
    const res = await get("/links", ownerToken, env);
    expect(res.status).toBe(200);

    const body = await res.json() as Array<{
      shortCode: string; longUrl: string; createdAt: string; totalClicks: number;
    }>;
    expect(body).toHaveLength(2);

    const first = body.find((l) => l.shortCode === "abc123");
    expect(first).toBeDefined();
    expect(first!.longUrl).toBe("https://first.com");
    expect(first!.totalClicks).toBe(42);
    expect(first!.createdAt).toBe("2025-06-15T10:00:00.000Z");

    const second = body.find((l) => l.shortCode === "xyz789");
    expect(second!.totalClicks).toBe(7);
  });

  it("returns totalClicks of 0 for a link that has never been clicked", async () => {
    const urlsKv = {
      [`user-links:${OWNER_ID}`]: JSON.stringify(["newlink"]),
      "newlink": linkRecord("newlink", OWNER_ID),
    };
    const env = makeEnv(urlsKv, {}); // no analytics KV entries
    const res = await get("/links", ownerToken, env);
    const body = await res.json() as Array<{ totalClicks: number }>;
    expect(body[0].totalClicks).toBe(0);
  });
});

// ── GET /links/{shortCode}/stats ──────────────────────────────────────────────

describe("GET /links/{shortCode}/stats — owner", () => {
  it("returns 200 with correct shape for an existing link", async () => {
    const shortCode = "abc123";
    const hour = new Date().toISOString().slice(0, 13);

    const urlsKv = { [shortCode]: linkRecord(shortCode, OWNER_ID) };
    const analyticsKv = {
      [`total:${shortCode}`]: "15",
      [`hourly:${shortCode}:${hour}`]: "8",
      [`referrer:${shortCode}:https://google.com`]: "10",
      [`referrer:${shortCode}:direct`]: "5",
    };

    const env = makeEnv(urlsKv, analyticsKv);
    const res = await get(`/links/${shortCode}/stats`, ownerToken, env);
    expect(res.status).toBe(200);

    const body = await res.json() as {
      totalClicks: number;
      hourly: Array<{ hour: string; count: number }>;
      topReferrers: Array<{ referrer: string; count: number }>;
    };

    expect(body.totalClicks).toBe(15);

    // Hourly: current hour should be present with count 8
    const currentHourEntry = body.hourly.find((e) => e.hour === hour);
    expect(currentHourEntry).toBeDefined();
    expect(currentHourEntry!.count).toBe(8);

    // Top referrers: sorted by count desc
    expect(body.topReferrers).toHaveLength(2);
    expect(body.topReferrers[0].referrer).toBe("https://google.com");
    expect(body.topReferrers[0].count).toBe(10);
    expect(body.topReferrers[1].referrer).toBe("direct");
    expect(body.topReferrers[1].count).toBe(5);
  });

  it("topReferrers is capped at 5 entries even with more referrers", async () => {
    const shortCode = "many";
    const analyticsKv: Record<string, string> = {
      [`total:${shortCode}`]: "100",
    };
    // Create 8 unique referrers
    for (let i = 1; i <= 8; i++) {
      analyticsKv[`referrer:${shortCode}:https://site${i}.com`] = String(i * 10);
    }

    const urlsKv = { [shortCode]: linkRecord(shortCode, OWNER_ID) };
    const env = makeEnv(urlsKv, analyticsKv);
    const res = await get(`/links/${shortCode}/stats`, ownerToken, env);
    const body = await res.json() as { topReferrers: unknown[] };
    expect(body.topReferrers).toHaveLength(5);
    // First entry should have highest count (site8 = 80 clicks)
    expect((body.topReferrers[0] as { count: number }).count).toBe(80);
  });

  it("hourly array contains only non-zero hours", async () => {
    const shortCode = "sparse";
    const urlsKv = { [shortCode]: linkRecord(shortCode, OWNER_ID) };
    // No analytics data at all
    const env = makeEnv(urlsKv, {});
    const res = await get(`/links/${shortCode}/stats`, ownerToken, env);
    const body = await res.json() as { hourly: unknown[] };
    expect(body.hourly).toHaveLength(0);
  });
});

describe("GET /links/{shortCode}/stats — different user gets 403", () => {
  it("returns 403 when the authenticated user is not the link owner", async () => {
    const shortCode = "owned";
    // Link belongs to OWNER_ID, but otherToken is for OTHER_ID
    const urlsKv = { [shortCode]: linkRecord(shortCode, OWNER_ID) };
    const env = makeEnv(urlsKv, {});
    const res = await get(`/links/${shortCode}/stats`, otherToken, env);
    expect(res.status).toBe(403);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("Forbidden");
  });
});

describe("GET /links/{shortCode}/stats — nonexistent shortCode", () => {
  it("returns 404 when the shortCode does not exist in URLS_KV", async () => {
    const env = makeEnv({}, {}); // empty KV
    const res = await get("/links/doesnotexist/stats", ownerToken, env);
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("Link not found");
  });
});
