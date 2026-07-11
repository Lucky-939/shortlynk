/**
 * click-processor-worker unit tests
 *
 * Uses plain vitest (Node environment) with an in-memory KV mock.
 * No Cloudflare runtime is needed — the queue handler only touches KV
 * (mocked below) and the ClickEvent schema (plain objects).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import worker from "./index";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ClickEvent {
  shortCode: string;
  timestamp: string;
  userAgent: string | null;
  referer: string | null;
  ipHash: string | null;
}

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

// ── MessageBatch / Message mock ───────────────────────────────────────────────

/**
 * Minimal mock for a Cloudflare Queues Message<T>.
 * Each message tracks whether ack() or retry() was called.
 */
function makeMockMessage<T>(body: T): Message<T> & {
  _acked: boolean;
  _retried: boolean;
} {
  const m = {
    id: crypto.randomUUID(),
    timestamp: new Date(),
    attempts: 1,
    body,
    _acked: false,
    _retried: false,
    ack() {
      m._acked = true;
    },
    retry() {
      m._retried = true;
    },
  } as unknown as Message<T> & { _acked: boolean; _retried: boolean };
  return m;
}

/**
 * Wraps an array of messages into a minimal MessageBatch<T>.
 */
function makeBatch<T>(messages: Message<T>[]): MessageBatch<T> {
  return {
    queue: "click-events",
    messages,
    ackAll: vi.fn(),
    retryAll: vi.fn(),
  } as unknown as MessageBatch<T>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeEvent(overrides: Partial<ClickEvent> = {}): ClickEvent {
  return {
    shortCode: "abc123",
    timestamp: "2025-06-15T13:47:22.000Z",
    userAgent: "Mozilla/5.0",
    referer: "https://example.com",
    ipHash: "a".repeat(64),
    ...overrides,
  };
}

async function runBatch(
  messages: ReturnType<typeof makeMockMessage<ClickEvent>>[],
  kv: KVNamespace
) {
  const batch = makeBatch(messages as unknown as Message<ClickEvent>[]);
  const env = { ANALYTICS_KV: kv };
  await worker.queue(batch, env);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("queue() — total-clicks counter", () => {
  it("creates the total:{shortCode} key and sets it to 1 on first click", async () => {
    const kv = createMockKV();
    const msg = makeMockMessage(makeEvent({ shortCode: "xyz" }));
    await runBatch([msg], kv);

    expect(kv._store.get("total:xyz")).toBe("1");
  });

  it("increments total:{shortCode} from 0 → 1 → 2 across two messages", async () => {
    const kv = createMockKV();
    const m1 = makeMockMessage(makeEvent({ shortCode: "abc" }));
    const m2 = makeMockMessage(makeEvent({ shortCode: "abc" }));
    await runBatch([m1], kv);
    await runBatch([m2], kv);

    expect(kv._store.get("total:abc")).toBe("2");
  });

  it("keeps separate total counters for different shortCodes", async () => {
    const kv = createMockKV();
    const m1 = makeMockMessage(makeEvent({ shortCode: "aaa" }));
    const m2 = makeMockMessage(makeEvent({ shortCode: "bbb" }));
    await runBatch([m1, m2], kv);

    expect(kv._store.get("total:aaa")).toBe("1");
    expect(kv._store.get("total:bbb")).toBe("1");
  });
});

describe("queue() — hourly-bucket counter", () => {
  it("creates hourly:{shortCode}:{YYYY-MM-DDTHH} key from the message timestamp", async () => {
    const kv = createMockKV();
    const msg = makeMockMessage(
      makeEvent({ shortCode: "sc1", timestamp: "2025-06-15T13:47:22.000Z" })
    );
    await runBatch([msg], kv);

    // Bucket should be truncated to the hour: "2025-06-15T13"
    expect(kv._store.get("hourly:sc1:2025-06-15T13")).toBe("1");
  });

  it("places clicks in different hour-buckets when timestamps differ by hour", async () => {
    const kv = createMockKV();
    const m1 = makeMockMessage(
      makeEvent({ shortCode: "sc2", timestamp: "2025-06-15T13:59:59.000Z" })
    );
    const m2 = makeMockMessage(
      makeEvent({ shortCode: "sc2", timestamp: "2025-06-15T14:00:01.000Z" })
    );
    await runBatch([m1, m2], kv);

    expect(kv._store.get("hourly:sc2:2025-06-15T13")).toBe("1");
    expect(kv._store.get("hourly:sc2:2025-06-15T14")).toBe("1");
  });

  it("aggregates multiple clicks in the same hour into one bucket", async () => {
    const kv = createMockKV();
    const makeHour = (min: string) =>
      makeMockMessage(
        makeEvent({ shortCode: "sc3", timestamp: `2025-06-15T09:${min}:00.000Z` })
      );
    await runBatch([makeHour("05"), makeHour("30"), makeHour("59")], kv);

    expect(kv._store.get("hourly:sc3:2025-06-15T09")).toBe("3");
  });

  it("hourly key format is exactly YYYY-MM-DDTHH (13 chars, no minutes/seconds)", async () => {
    const kv = createMockKV();
    const msg = makeMockMessage(
      makeEvent({ shortCode: "fmt", timestamp: "2025-12-31T23:45:00.000Z" })
    );
    await runBatch([msg], kv);

    const keys = [...kv._store.keys()].filter((k) => k.startsWith("hourly:fmt:"));
    expect(keys).toHaveLength(1);
    // The suffix after "hourly:fmt:" should be exactly 13 chars: "2025-12-31T23"
    const suffix = keys[0].replace("hourly:fmt:", "");
    expect(suffix).toBe("2025-12-31T23");
    expect(suffix).toHaveLength(13);
  });
});

describe("queue() — referrer counter", () => {
  it("uses the referer value as the referrer key when present", async () => {
    const kv = createMockKV();
    const msg = makeMockMessage(
      makeEvent({ shortCode: "ref1", referer: "https://google.com" })
    );
    await runBatch([msg], kv);

    expect(kv._store.get("referrer:ref1:https://google.com")).toBe("1");
  });

  it('defaults referrer to "direct" when referer is null', async () => {
    const kv = createMockKV();
    const msg = makeMockMessage(makeEvent({ shortCode: "ref2", referer: null }));
    await runBatch([msg], kv);

    expect(kv._store.get("referrer:ref2:direct")).toBe("1");
  });

  it('defaults referrer to "direct" when referer is an empty string', async () => {
    const kv = createMockKV();
    const msg = makeMockMessage(makeEvent({ shortCode: "ref3", referer: "" }));
    await runBatch([msg], kv);

    expect(kv._store.get("referrer:ref3:direct")).toBe("1");
  });

  it("keeps separate referrer buckets per origin", async () => {
    const kv = createMockKV();
    const m1 = makeMockMessage(
      makeEvent({ shortCode: "ref4", referer: "https://twitter.com" })
    );
    const m2 = makeMockMessage(
      makeEvent({ shortCode: "ref4", referer: "https://facebook.com" })
    );
    const m3 = makeMockMessage(makeEvent({ shortCode: "ref4", referer: null }));
    await runBatch([m1, m2, m3], kv);

    expect(kv._store.get("referrer:ref4:https://twitter.com")).toBe("1");
    expect(kv._store.get("referrer:ref4:https://facebook.com")).toBe("1");
    expect(kv._store.get("referrer:ref4:direct")).toBe("1");
  });
});

describe("queue() — message acknowledgement", () => {
  it("calls message.ack() on each successfully processed message", async () => {
    const kv = createMockKV();
    const m1 = makeMockMessage(makeEvent({ shortCode: "ack1" }));
    const m2 = makeMockMessage(makeEvent({ shortCode: "ack2" }));
    await runBatch([m1, m2], kv);

    expect(m1._acked).toBe(true);
    expect(m1._retried).toBe(false);
    expect(m2._acked).toBe(true);
    expect(m2._retried).toBe(false);
  });
});

describe("queue() — per-message failure isolation", () => {
  it("retries a malformed message without preventing other messages from being acked", async () => {
    const kv = createMockKV();

    // A good message
    const goodMsg = makeMockMessage(makeEvent({ shortCode: "good" }));

    // A malformed message — body is missing required fields
    const badMsg = makeMockMessage(
      // Cast so TypeScript lets us simulate a bad payload at runtime
      { notAClickEvent: true } as unknown as ClickEvent
    );

    // Put bad message first to ensure it doesn't stop the good one
    await runBatch(
      [badMsg, goodMsg] as ReturnType<typeof makeMockMessage<ClickEvent>>[],
      kv
    );

    // Good message should be fully processed and acked
    expect(goodMsg._acked).toBe(true);
    expect(goodMsg._retried).toBe(false);
    expect(kv._store.get("total:good")).toBe("1");

    // Bad message should be retried, not acked
    expect(badMsg._acked).toBe(false);
    expect(badMsg._retried).toBe(true);
  });

  it("retries a message that causes a KV error without affecting neighbours", async () => {
    const kv = createMockKV();

    let callCount = 0;
    // Make the first KV.get() call throw (simulates a transient KV error)
    kv.get = vi.fn(async (key: string) => {
      callCount++;
      if (callCount === 1) throw new Error("KV transient error");
      return kv._store.get(key) ?? null;
    }) as typeof kv.get;

    const failingMsg = makeMockMessage(makeEvent({ shortCode: "fail" }));
    const okMsg = makeMockMessage(makeEvent({ shortCode: "ok" }));

    await runBatch(
      [failingMsg, okMsg] as ReturnType<typeof makeMockMessage<ClickEvent>>[],
      kv
    );

    expect(failingMsg._retried).toBe(true);
    expect(failingMsg._acked).toBe(false);

    expect(okMsg._acked).toBe(true);
    expect(okMsg._retried).toBe(false);
    // "ok" shortCode counters were written despite the earlier failure
    expect(kv._store.get("total:ok")).toBe("1");
  });

  it("processes all good messages in a mixed batch of good and malformed", async () => {
    const kv = createMockKV();

    const good1 = makeMockMessage(makeEvent({ shortCode: "g1" }));
    const bad1 = makeMockMessage({ wrong: true } as unknown as ClickEvent);
    const good2 = makeMockMessage(makeEvent({ shortCode: "g2" }));
    const bad2 = makeMockMessage(null as unknown as ClickEvent);
    const good3 = makeMockMessage(makeEvent({ shortCode: "g3" }));

    await runBatch(
      [good1, bad1, good2, bad2, good3] as ReturnType<
        typeof makeMockMessage<ClickEvent>
      >[],
      kv
    );

    // All good messages processed and acked
    expect(good1._acked).toBe(true);
    expect(good2._acked).toBe(true);
    expect(good3._acked).toBe(true);
    expect(kv._store.get("total:g1")).toBe("1");
    expect(kv._store.get("total:g2")).toBe("1");
    expect(kv._store.get("total:g3")).toBe("1");

    // All bad messages retried, never acked
    expect(bad1._retried).toBe(true);
    expect(bad1._acked).toBe(false);
    expect(bad2._retried).toBe(true);
    expect(bad2._acked).toBe(false);
  });
});

describe("queue() — all three counters per click", () => {
  it("writes total, hourly and referrer keys for every successfully processed message", async () => {
    const kv = createMockKV();
    const msg = makeMockMessage(
      makeEvent({
        shortCode: "multi",
        timestamp: "2025-08-20T07:30:00.000Z",
        referer: "https://github.com",
      })
    );
    await runBatch([msg], kv);

    expect(kv._store.get("total:multi")).toBe("1");
    expect(kv._store.get("hourly:multi:2025-08-20T07")).toBe("1");
    expect(kv._store.get("referrer:multi:https://github.com")).toBe("1");
    // Exactly three keys written
    expect(kv._store.size).toBe(3);
  });
});
