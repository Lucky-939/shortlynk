/**
 * auth-worker unit tests
 *
 * Uses plain vitest (Node environment) with in-memory KV and crypto mocks.
 * PBKDF2 is real (no mock) — each test involving password ops will take
 * ~200–400 ms. Generous timeouts are set where needed.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import worker from "./index";
import { signJwt, verifyJwt } from "../../shared/jwt";

// ── Constants ─────────────────────────────────────────────────────────────────

const TEST_SECRET = "test-jwt-secret-32-chars-minimum!";

// ── In-memory KV mock ─────────────────────────────────────────────────────────

function createMockKV() {
  const store = new Map<string, string>();
  return {
    _store: store,
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    list: vi.fn(async () => ({
      keys: [] as { name: string }[],
      list_complete: true,
      cacheStatus: null,
    })),
    getWithMetadata: vi.fn(async (key: string) => ({
      value: store.get(key) ?? null,
      metadata: null,
      cacheStatus: null,
    })),
  } as unknown as KVNamespace & { _store: Map<string, string> };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeEnv(kv: KVNamespace) {
  return { USERS_KV: kv, JWT_SECRET: TEST_SECRET } as unknown as {
    USERS_KV: KVNamespace;
    JWT_SECRET: string;
  };
}

async function post(path: string, body: unknown, kv: KVNamespace, ip?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (ip) headers["CF-Connecting-IP"] = ip;
  const req = new Request(`http://localhost${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  return worker.fetch(req, makeEnv(kv), {} as ExecutionContext);
}

// ── CORS ──────────────────────────────────────────────────────────────────────

describe("CORS", () => {
  it("OPTIONS returns 204 with CORS headers", async () => {
    const req = new Request("http://localhost/signup", { method: "OPTIONS" });
    const res = await worker.fetch(req, makeEnv(createMockKV()), {} as ExecutionContext);
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("POST returns Access-Control-Allow-Origin", async () => {
    const res = await post("/signup", {}, createMockKV());
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});

// ── POST /signup ──────────────────────────────────────────────────────────────

describe("POST /signup — success", () => {
  let kv: ReturnType<typeof createMockKV>;
  beforeEach(() => { kv = createMockKV(); });

  it("returns 201 with userId and email on valid input", async () => {
    const res = await post("/signup", { email: "alice@example.com", password: "hunter42!" }, kv);
    expect(res.status).toBe(201);

    const body = await res.json() as { userId: string; email: string };
    expect(body.email).toBe("alice@example.com");
    expect(typeof body.userId).toBe("string");
    expect(body.userId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  }, 8_000);

  it("never includes passwordHash in the response", async () => {
    const res = await post("/signup", { email: "bob@example.com", password: "securePass1" }, kv);
    const text = await res.text();
    expect(text).not.toContain("passwordHash");
    expect(text).not.toContain("passwordSalt");
  }, 8_000);

  it("stores a user record in USERS_KV keyed by normalized (lowercase) email", async () => {
    await post("/signup", { email: "Charlie@Example.COM", password: "password123" }, kv);
    const raw = kv._store.get("charlie@example.com");
    expect(raw).not.toBeNull();
    const record = JSON.parse(raw!) as Record<string, unknown>;
    expect(typeof record.passwordHash).toBe("string");
    expect(typeof record.userId).toBe("string");
    expect(typeof record.createdAt).toBe("string");
  }, 8_000);
});

describe("POST /signup — duplicate email rejected", () => {
  it("returns 409 when the email is already registered", async () => {
    const kv = createMockKV();
    await post("/signup", { email: "dupe@example.com", password: "firstPassword1" }, kv);
    const res = await post("/signup", { email: "dupe@example.com", password: "secondPassword2" }, kv);

    expect(res.status).toBe(409);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("Email already registered");
  }, 15_000);
});

describe("POST /signup — weak password rejected", () => {
  let kv: ReturnType<typeof createMockKV>;
  beforeEach(() => { kv = createMockKV(); });

  it("returns 400 for a password shorter than 8 characters", async () => {
    const res = await post("/signup", { email: "user@example.com", password: "short" }, kv);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain("8");
  });

  it("returns 400 for an invalid email address", async () => {
    const res = await post("/signup", { email: "not-an-email", password: "validPass123" }, kv);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain("email");
  });
});

// ── POST /login ───────────────────────────────────────────────────────────────

describe("POST /login — success", () => {
  it("returns 200 with a valid JWT token, userId, and email", async () => {
    const kv = createMockKV();
    await post("/signup", { email: "login@example.com", password: "myPassword1" }, kv);

    const res = await post("/login", { email: "login@example.com", password: "myPassword1" }, kv);
    expect(res.status).toBe(200);

    const body = await res.json() as { token: string; userId: string; email: string };
    expect(typeof body.token).toBe("string");
    expect(body.token.split(".")).toHaveLength(3); // valid JWT structure
    expect(body.email).toBe("login@example.com");
    expect(typeof body.userId).toBe("string");
  }, 15_000);

  it("the returned token carries the correct sub and email claims", async () => {
    const kv = createMockKV();
    const signupRes = await post("/signup", { email: "claims@example.com", password: "password99" }, kv);
    const { userId } = await signupRes.json() as { userId: string };

    const loginRes = await post("/login", { email: "claims@example.com", password: "password99" }, kv);
    const { token } = await loginRes.json() as { token: string };

    const payload = await verifyJwt(token, TEST_SECRET);
    expect(payload).not.toBeNull();
    expect(payload!.sub).toBe(userId);
    expect(payload!.email).toBe("claims@example.com");
  }, 15_000);
});

describe("POST /login — wrong password returns generic 401", () => {
  it("returns 401 with 'Invalid credentials' for a wrong password", async () => {
    const kv = createMockKV();
    await post("/signup", { email: "wrongpw@example.com", password: "correctPassword" }, kv);

    const res = await post("/login", { email: "wrongpw@example.com", password: "wrongPassword" }, kv);
    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("Invalid credentials");
  }, 15_000);
});

describe("POST /login — unknown email returns the SAME generic 401", () => {
  it("returns 401 with 'Invalid credentials' (not a distinct 'user not found' message)", async () => {
    const kv = createMockKV();
    const res = await post("/login", { email: "ghost@example.com", password: "anyPassword" }, kv);

    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    // Must be IDENTICAL to the wrong-password message — no information leakage
    expect(body.error).toBe("Invalid credentials");
  });
});

describe("Rate Limiting", () => {
  let kv: ReturnType<typeof createMockKV>;

  beforeEach(() => {
    kv = createMockKV();
  });

  it("skips rate limiting if CF-Connecting-IP is absent", async () => {
    // 11 requests with NO ip header
    for (let i = 0; i < 11; i++) {
      const res = await post("/signup", { email: `test${i}@example.com`, password: "password!" }, kv);
      expect(res.status).not.toBe(429);
    }
  });

  it("limits an IP to 10 requests per hour for /signup", async () => {
    const ip = "1.2.3.4";
    // 10 requests should succeed
    for (let i = 0; i < 10; i++) {
      const res = await post("/signup", { email: `test${i}@example.com`, password: "password!" }, kv, ip);
      expect(res.status).toBe(201);
    }

    // 11th request should be rate limited
    const res11 = await post("/signup", { email: "test11@example.com", password: "password!" }, kv, ip);
    expect(res11.status).toBe(429);
    const body = await res11.json() as { error: string };
    expect(body.error).toBe("Too many requests, try again later");
  }, 10_000);

  it("limits an IP to 10 requests per hour for /login", async () => {
    const ip = "1.2.3.4";
    // 10 requests should succeed (they will 401 because the user doesn't exist, but NOT 429)
    for (let i = 0; i < 10; i++) {
      const res = await post("/login", { email: "ghost@example.com", password: "password!" }, kv, ip);
      expect(res.status).not.toBe(429);
    }

    // 11th request should be rate limited
    const res11 = await post("/login", { email: "ghost@example.com", password: "password!" }, kv, ip);
    expect(res11.status).toBe(429);
  }, 10_000);

  it("tracks different IPs independently", async () => {
    const ip1 = "10.0.0.1";
    const ip2 = "10.0.0.2";

    // Exhaust ip1's limit
    for (let i = 0; i < 10; i++) {
      await post("/signup", { email: `test${i}@example.com`, password: "password!" }, kv, ip1);
    }
    const resLimitIp1 = await post("/signup", { email: "test11@example.com", password: "password!" }, kv, ip1);
    expect(resLimitIp1.status).toBe(429);

    // ip2 should still be allowed
    const resIp2 = await post("/signup", { email: "testip2@example.com", password: "password!" }, kv, ip2);
    expect(resIp2.status).toBe(201);
  }, 10_000);
});

