/**
 * shared/password.test.ts
 *
 * Unit tests for hashPassword / verifyPassword.
 *
 * Note: PBKDF2 at 100 000 iterations takes ~200–400 ms per call in Node.
 * Each test below involves 1–2 derivations, so this suite will take a few
 * seconds. That is expected and acceptable for a security-critical operation.
 */

import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "./password";

describe("hashPassword / verifyPassword — round-trip", () => {
  it("verifyPassword returns true for the correct password", async () => {
    const { hash, salt } = await hashPassword("correct-horse-battery-staple");
    const valid = await verifyPassword("correct-horse-battery-staple", hash, salt);
    expect(valid).toBe(true);
  }, 10_000); // generous timeout for 2× PBKDF2 derivations

  it("hash and salt are returned as non-empty hex strings", async () => {
    const { hash, salt } = await hashPassword("myPassword123");
    expect(hash).toMatch(/^[0-9a-f]+$/);
    expect(salt).toMatch(/^[0-9a-f]+$/);
    // 32 bytes = 64 hex chars for hash; 16 bytes = 32 hex chars for salt
    expect(hash).toHaveLength(64);
    expect(salt).toHaveLength(32);
  }, 8_000);

  it("two calls to hashPassword produce different salts and hashes", async () => {
    const a = await hashPassword("samePassword");
    const b = await hashPassword("samePassword");
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
  }, 15_000);
});

describe("verifyPassword — wrong password", () => {
  it("returns false for an incorrect password", async () => {
    const { hash, salt } = await hashPassword("correct-password");
    const valid = await verifyPassword("wrong-password", hash, salt);
    expect(valid).toBe(false);
  }, 10_000);

  it("returns false for an empty string when the stored password was non-empty", async () => {
    const { hash, salt } = await hashPassword("not-empty");
    const valid = await verifyPassword("", hash, salt);
    expect(valid).toBe(false);
  }, 10_000);

  it("returns false when the salt does not match", async () => {
    const { hash } = await hashPassword("my-password");
    // Use a completely different salt
    const { salt: wrongSalt } = await hashPassword("other-password");
    const valid = await verifyPassword("my-password", hash, wrongSalt);
    expect(valid).toBe(false);
  }, 15_000);
});
