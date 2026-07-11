/**
 * shared/jwt.test.ts
 *
 * Unit tests for signJwt / verifyJwt.
 * crypto.subtle is available globally in Node ≥ 18.7 — no polyfill needed.
 */

import { describe, it, expect } from "vitest";
import { signJwt, verifyJwt, type JwtPayload } from "./jwt";

const TEST_SECRET = "test-secret-do-not-use-in-production";
const TEST_PAYLOAD = { sub: "user-123", email: "alice@example.com" };

describe("signJwt / verifyJwt — round-trip", () => {
  it("verifyJwt returns the original payload for a freshly signed token", async () => {
    const token = await signJwt(TEST_PAYLOAD, TEST_SECRET);
    const payload = await verifyJwt(token, TEST_SECRET);

    expect(payload).not.toBeNull();
    expect(payload!.sub).toBe("user-123");
    expect(payload!.email).toBe("alice@example.com");
  });

  it("token is a three-part dot-separated string", async () => {
    const token = await signJwt(TEST_PAYLOAD, TEST_SECRET);
    expect(token.split(".")).toHaveLength(3);
  });

  it("iat is set to approximately now (within 5 seconds)", async () => {
    const before = Math.floor(Date.now() / 1000);
    const token = await signJwt(TEST_PAYLOAD, TEST_SECRET);
    const after = Math.floor(Date.now() / 1000);
    const payload = await verifyJwt(token, TEST_SECRET);

    expect(payload!.iat).toBeGreaterThanOrEqual(before);
    expect(payload!.iat).toBeLessThanOrEqual(after);
  });

  it("exp is set to 7 days from now", async () => {
    const before = Math.floor(Date.now() / 1000);
    const token = await signJwt(TEST_PAYLOAD, TEST_SECRET);
    const payload = await verifyJwt(token, TEST_SECRET);
    const sevenDays = 7 * 24 * 60 * 60;

    expect(payload!.exp).toBeGreaterThanOrEqual(before + sevenDays - 1);
    expect(payload!.exp).toBeLessThanOrEqual(before + sevenDays + 2);
  });
});

describe("verifyJwt — tampered token", () => {
  it("returns null when the signature is tampered", async () => {
    const token = await signJwt(TEST_PAYLOAD, TEST_SECRET);
    const parts = token.split(".");
    // Flip the last character of the signature
    const lastChar = parts[2].slice(-1);
    const flipped = lastChar === "a" ? "b" : "a";
    const tampered = `${parts[0]}.${parts[1]}.${parts[2].slice(0, -1)}${flipped}`;

    const result = await verifyJwt(tampered, TEST_SECRET);
    expect(result).toBeNull();
  });

  it("returns null when the payload is tampered (signature no longer matches)", async () => {
    const token = await signJwt(TEST_PAYLOAD, TEST_SECRET);
    const parts = token.split(".");
    // Replace payload with a crafted one claiming a different sub
    const maliciousPayload = btoa(
      JSON.stringify({ sub: "admin", email: "hacker@evil.com", iat: 0, exp: 9999999999 })
    ).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
    const tampered = `${parts[0]}.${maliciousPayload}.${parts[2]}`;

    const result = await verifyJwt(tampered, TEST_SECRET);
    expect(result).toBeNull();
  });

  it("returns null when verified with the wrong secret", async () => {
    const token = await signJwt(TEST_PAYLOAD, TEST_SECRET);
    const result = await verifyJwt(token, "wrong-secret");
    expect(result).toBeNull();
  });

  it("returns null for a completely malformed token string", async () => {
    expect(await verifyJwt("not.a.valid.jwt.at.all", TEST_SECRET)).toBeNull();
    expect(await verifyJwt("", TEST_SECRET)).toBeNull();
    expect(await verifyJwt("onlytwoparts.here", TEST_SECRET)).toBeNull();
  });
});

describe("verifyJwt — expired token", () => {
  it("returns null for a token whose exp is in the past", async () => {
    const now = Math.floor(Date.now() / 1000);
    // Sign with exp already passed (1 second ago)
    const token = await signJwt(
      { ...TEST_PAYLOAD, iat: now - 10, exp: now - 1 },
      TEST_SECRET
    );

    const result = await verifyJwt(token, TEST_SECRET);
    expect(result).toBeNull();
  });

  it("accepts a token that expires in the future", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await signJwt(
      { ...TEST_PAYLOAD, iat: now, exp: now + 3600 },
      TEST_SECRET
    );

    const result = await verifyJwt(token, TEST_SECRET);
    expect(result).not.toBeNull();
  });
});
