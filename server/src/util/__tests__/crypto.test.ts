import { randomBytes } from "crypto";

// encryptSecret/decryptSecret read env.credentialsEncryptionKey at call time,
// so the key just needs to be set before this module (and its env import)
// loads. jest.setup.js already covers JWT_SECRET/MONGODB_URL/NODE_ENV.
process.env.CREDENTIALS_ENCRYPTION_KEY = randomBytes(32).toString("base64");

import { encryptSecret, decryptSecret } from "../crypto";

describe("crypto (credential encryption)", () => {
  it("round-trips a secret", () => {
    const plaintext = "1//0gABCDEFGHIJKLMNOPQRSTUVWXYZ-refresh-token";
    const encrypted = encryptSecret(plaintext);
    expect(encrypted).not.toEqual(plaintext);
    expect(decryptSecret(encrypted)).toBe(plaintext);
  });

  it("produces a different ciphertext each time (random IV)", () => {
    const plaintext = "same-secret";
    expect(encryptSecret(plaintext)).not.toEqual(encryptSecret(plaintext));
  });

  it("rejects a tampered payload", () => {
    const encrypted = encryptSecret("some-secret");
    const [iv, authTag, ciphertext] = encrypted.split(":");
    const tamperedByte = Buffer.from(ciphertext, "base64");
    tamperedByte[0] ^= 0xff;
    const tampered = [iv, authTag, tamperedByte.toString("base64")].join(":");
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it("rejects a malformed payload", () => {
    expect(() => decryptSecret("not-a-valid-payload")).toThrow("Malformed encrypted payload");
  });
});
