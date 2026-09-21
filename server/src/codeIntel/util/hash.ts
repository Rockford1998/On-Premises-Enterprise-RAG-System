import crypto from "crypto";

export const sha256 = (...parts: string[]): string => {
  const hash = crypto.createHash("sha256");
  parts.forEach((part, i) => {
    if (i > 0) hash.update("\0");
    hash.update(part);
  });
  return hash.digest("hex");
};
