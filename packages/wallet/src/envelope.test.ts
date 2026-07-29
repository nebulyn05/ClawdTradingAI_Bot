import { describe, it, expect, beforeAll } from "vitest";
import { randomBytes } from "node:crypto";

beforeAll(() => {
  process.env.MASTER_ENCRYPTION_KEY = randomBytes(32).toString("hex");
  process.env.DATABASE_URL ??= "postgresql://clawd:clawd@localhost:5432/clawd_agents";
  process.env.REDIS_URL ??= "redis://localhost:6379";
});

describe("envelope encryption", () => {
  it("round-trips a private key", async () => {
    const { encryptPrivateKey, decryptPrivateKey } = await import("./envelope.js");
    const raw = "super-secret-private-key-material";
    const enc = encryptPrivateKey(raw);
    expect(enc.ciphertext).not.toContain(raw);
    expect(decryptPrivateKey(enc)).toBe(raw);
  });

  it("produces different ciphertext for the same key on repeated calls", async () => {
    const { encryptPrivateKey } = await import("./envelope.js");
    const a = encryptPrivateKey("same-key");
    const b = encryptPrivateKey("same-key");
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(a.wrappedDataKey).not.toBe(b.wrappedDataKey);
  });

  it("fails to decrypt with a tampered auth tag", async () => {
    const { encryptPrivateKey, decryptPrivateKey } = await import("./envelope.js");
    const enc = encryptPrivateKey("tamper-test");
    const tampered = { ...enc, authTag: Buffer.alloc(16, 1).toString("base64") };
    expect(() => decryptPrivateKey(tampered)).toThrow();
  });
});
