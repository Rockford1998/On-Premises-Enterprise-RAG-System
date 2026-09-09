import AdmZip from "adm-zip";
import path from "path";
import os from "os";
import fs from "fs";
import { extractZipEntries } from "../extractZipEntries";

describe("extractZipEntries", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "zip-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const writeZip = (entries: Record<string, Buffer | string>): string => {
    const zip = new AdmZip();
    for (const [entryPath, content] of Object.entries(entries)) {
      zip.addFile(entryPath, Buffer.isBuffer(content) ? content : Buffer.from(content, "utf-8"));
    }
    const zipPath = path.join(tmpDir, "archive.zip");
    zip.writeZip(zipPath);
    return zipPath;
  };

  it("extracts source/text files with their zip-relative path as fileName", () => {
    const zipPath = writeZip({
      "src/index.ts": "export const x = 1;",
      "README.md": "# hello",
    });

    const result = extractZipEntries(zipPath);
    const names = result.map((r) => r.fileName).sort();

    expect(names).toEqual(["README.md", "src/index.ts"]);
    expect(result.find((r) => r.fileName === "src/index.ts")?.content).toBe(
      "export const x = 1;",
    );
  });

  it("skips files inside noise directories like node_modules and .git", () => {
    const zipPath = writeZip({
      "src/index.ts": "export const x = 1;",
      "node_modules/lodash/index.js": "module.exports = {};",
      ".git/HEAD": "ref: refs/heads/main",
    });

    const result = extractZipEntries(zipPath);
    expect(result.map((r) => r.fileName)).toEqual(["src/index.ts"]);
  });

  it("skips files with extensions outside the ingestible allowlist", () => {
    const zipPath = writeZip({
      "src/index.ts": "export const x = 1;",
      "assets/logo.png": Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      "package-lock.bin": Buffer.from([0x00, 0x01, 0x02]),
    });

    const result = extractZipEntries(zipPath);
    expect(result.map((r) => r.fileName)).toEqual(["src/index.ts"]);
  });

  it("skips a file with an ingestible extension whose content is actually binary (contains a NUL byte)", () => {
    const binaryLookingText = Buffer.concat([
      Buffer.from("some header"),
      Buffer.from([0x00]),
      Buffer.from("binary payload"),
    ]);
    const zipPath = writeZip({
      "src/index.ts": "export const x = 1;",
      "src/mystery.txt": binaryLookingText,
    });

    const result = extractZipEntries(zipPath);
    expect(result.map((r) => r.fileName)).toEqual(["src/index.ts"]);
  });

  it("returns an empty array for a zip with no ingestible files", () => {
    const zipPath = writeZip({
      "node_modules/pkg/index.js": "module.exports = {};",
      "logo.png": Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    });

    expect(extractZipEntries(zipPath)).toEqual([]);
  });
});
