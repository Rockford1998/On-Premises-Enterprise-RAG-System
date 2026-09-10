/**
 * AES-256-GCM helpers for secrets that must be stored (not just hashed) —
 * currently only Drive connection refresh tokens. Unlike a password or a
 * refresh-token *lookup* hash, a stored provider credential has to be
 * recoverable to actually call the API, so it's encrypted rather than hashed.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { env } from "../config/env";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

class MissingEncryptionKeyError extends Error {
  constructor() {
    super(
      "CREDENTIALS_ENCRYPTION_KEY is not set. Generate one with: " +
      'node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
    );
    this.name = "MissingEncryptionKeyError";
  }
}

const getKey = (): Buffer => {
  const raw = env.credentialsEncryptionKey;
  if (!raw) throw new MissingEncryptionKeyError();
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("CREDENTIALS_ENCRYPTION_KEY must decode to exactly 32 bytes (base64-encoded).");
  }
  return key;
};

/** Returns "iv:authTag:ciphertext", all base64. */
export const encryptSecret = (plaintext: string): string => {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("base64"), authTag.toString("base64"), ciphertext.toString("base64")].join(":");
};

export const decryptSecret = (payload: string): string => {
  const key = getKey();
  const [ivB64, authTagB64, ciphertextB64] = payload.split(":");
  if (!ivB64 || !authTagB64 || !ciphertextB64) {
    throw new Error("Malformed encrypted payload");
  }
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(authTagB64, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextB64, "base64")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
};
