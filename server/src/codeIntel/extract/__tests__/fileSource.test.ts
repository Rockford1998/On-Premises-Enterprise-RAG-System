import fs from "fs";
import os from "os";
import path from "path";
import { DirectorySource, SourceError, unsafeEntryReason, ZipSource } from "../fileSource";
import { buildZip } from "./zipBuilder";

const limits = { maxEntries: 1000, maxTotalBytes: 10 * 1024 * 1024 };

const collect = async (source: { list: () => AsyncIterable<{ path: string; size: number }> }) => {
  const out: string[] = [];
  for await (const entry of source.list()) out.push(entry.path);
  return out;
};

describe("unsafeEntryReason", () => {
  it.each([
    ["../evil.js", "path traversal"],
    ["a/../../evil.js", "path traversal"],
    ["a\\..\\evil.js", "path traversal"],
    ["/etc/passwd", "absolute path"],
    ["\\windows\\x", "absolute path"],
    ["C:\\Windows\\x.js", "absolute path"],
    ["C:evil.js", "absolute path"],
    ["a\0b.js", "NUL byte in name"],
  ])("rejects %j", (name, reason) => {
    expect(unsafeEntryReason(name)).toBe(reason);
  });

  it.each(["src/a.ts", "a/b/c.js", "..hidden/file.js", "file..name.js", ".env"])("accepts %j", (name) => {
    expect(unsafeEntryReason(name)).toBeNull();
  });
});

describe("ZipSource", () => {
  it("lists files sorted, with sizes, and reads them", async () => {
    const zip = new ZipSource(
      buildZip([
        { name: "b.js", data: "bb" },
        { name: "src/", },
        { name: "src/a.ts", data: "aaa" },
      ]),
      limits,
    );
    const listed: { path: string; size: number }[] = [];
    for await (const e of zip.list()) listed.push(e);
    expect(listed).toEqual([{ path: "b.js", size: 2 }, { path: "src/a.ts", size: 3 }]);
    expect((await zip.read("src/a.ts")).toString()).toBe("aaa");
  });

  it("strips a single top-level folder (GitHub-style archive)", async () => {
    const zip = new ZipSource(
      buildZip([
        { name: "repo-abc123/", },
        { name: "repo-abc123/package.json", data: "{}" },
        { name: "repo-abc123/src/index.ts", data: "x" },
      ]),
      limits,
    );
    expect(await collect(zip)).toEqual(["package.json", "src/index.ts"]);
  });

  it("does not strip when files sit at more than one top level", async () => {
    const zip = new ZipSource(
      buildZip([
        { name: "README.md", data: "x" },
        { name: "src/a.ts", data: "x" },
      ]),
      limits,
    );
    expect(await collect(zip)).toEqual(["README.md", "src/a.ts"]);
  });

  it("ignores macOS junk when deciding whether to strip the root", async () => {
    const zip = new ZipSource(
      buildZip([
        { name: "proj/a.ts", data: "x" },
        { name: "__MACOSX/proj/._a.ts", data: "junk" },
      ]),
      limits,
    );
    const files = await collect(zip);
    expect(files).toContain("a.ts");
  });

  it("rejects traversal, absolute, and symlink entries and never yields them", async () => {
    const zip = new ZipSource(
      buildZip([
        { name: "ok/a.ts", data: "x" },
        { name: "ok/../../evil.js", data: "x" },
        { name: "/etc/cron.d/evil", data: "x" },
        { name: "C:\\Windows\\evil.js", data: "x" },
        { name: "ok/link", data: "../../etc/passwd", mode: 0o120777 },
      ]),
      limits,
    );
    const files = await collect(zip);
    expect(files).toEqual(["a.ts"]);
    for (const f of files) {
      expect(f.split("/")).not.toContain("..");
      expect(f.startsWith("/")).toBe(false);
    }
    const reasons = zip.rejected.map((r) => r.reason).sort();
    expect(reasons).toEqual(["absolute path", "absolute path", "path traversal", "symlink"]);
  });

  it("keeps the first of duplicate names and reports the rest", async () => {
    const zip = new ZipSource(
      buildZip([
        { name: "a/x.js", data: "first" },
        { name: "a\\x.js", data: "second" }, // same path once separators are normalised
      ]),
      limits,
    );
    expect(zip.rejected.some((r) => r.reason === "duplicate entry")).toBe(true);
  });

  it("refuses an archive with too many entries", () => {
    const entries = Array.from({ length: 6 }, (_, i) => ({ name: `f${i}.js`, data: "x" }));
    expect(() => new ZipSource(buildZip(entries), { ...limits, maxEntries: 5 })).toThrow(SourceError);
  });

  it("refuses an archive that unpacks past the size cap (zip bomb guard)", async () => {
    const zip = new ZipSource(
      buildZip([
        { name: "a.txt", data: "x".repeat(600) },
        { name: "b.txt", data: "x".repeat(600) },
      ]),
      { ...limits, maxTotalBytes: 1000 },
    );
    await expect(collect(zip)).rejects.toMatchObject({ code: "ZIP_LIMIT" });
  });

  it("does not count directories pruned by shouldDescend towards the size cap", async () => {
    const zip = new ZipSource(
      buildZip([
        { name: "node_modules/big/x.js", data: "x".repeat(5000) },
        { name: "src/a.ts", data: "x" },
      ]),
      { ...limits, maxTotalBytes: 1000 },
    );
    const out: string[] = [];
    for await (const e of zip.list({ shouldDescend: (d) => d !== "node_modules" && !d.startsWith("node_modules/") })) out.push(e.path);
    expect(out).toEqual(["src/a.ts"]);
  });

  it("rejects something that is not a zip", () => {
    expect(() => new ZipSource(Buffer.from("definitely not a zip"), limits)).toThrow(SourceError);
  });

  it("throws for a file that is not in the archive", async () => {
    const zip = new ZipSource(buildZip([{ name: "a.ts", data: "x" }]), limits);
    await expect(zip.read("nope.ts")).rejects.toMatchObject({ code: "FILE_NOT_FOUND" });
  });
});

describe("DirectorySource", () => {
  let allowed: string;

  beforeEach(() => {
    allowed = fs.mkdtempSync(path.join(os.tmpdir(), "code-src-"));
    fs.mkdirSync(path.join(allowed, "repo", "src"), { recursive: true });
    fs.mkdirSync(path.join(allowed, "repo", "node_modules", "pkg"), { recursive: true });
    fs.writeFileSync(path.join(allowed, "repo", "src", "a.ts"), "export const a = 1;\n");
    fs.writeFileSync(path.join(allowed, "repo", "b.js"), "b");
    fs.writeFileSync(path.join(allowed, "repo", "node_modules", "pkg", "i.js"), "x");
    fs.mkdirSync(path.join(allowed, "outside-sibling"));
    fs.writeFileSync(path.join(allowed, "outside-sibling", "secret.txt"), "top secret");
  });

  afterEach(() => {
    fs.rmSync(allowed, { recursive: true, force: true });
  });

  it("is disabled when no allowed root is configured", async () => {
    await expect(DirectorySource.open({ root: "repo", allowedRoot: "" })).rejects.toMatchObject({ code: "ROOT_FORBIDDEN" });
  });

  it("lists files relative to the root, sorted, and reads them", async () => {
    const src = await DirectorySource.open({ root: "repo", allowedRoot: allowed });
    expect(await collect(src)).toEqual(["b.js", "node_modules/pkg/i.js", "src/a.ts"]);
    expect((await src.read("src/a.ts")).toString()).toBe("export const a = 1;\n");
  });

  it("prunes directories through shouldDescend", async () => {
    const src = await DirectorySource.open({ root: "repo", allowedRoot: allowed });
    const out: string[] = [];
    for await (const e of src.list({ shouldDescend: (d) => d !== "node_modules" })) out.push(e.path);
    expect(out).toEqual(["b.js", "src/a.ts"]);
  });

  it("refuses a root that escapes the allowed root", async () => {
    await expect(DirectorySource.open({ root: "../..", allowedRoot: path.join(allowed, "repo") }))
      .rejects.toMatchObject({ code: "ROOT_FORBIDDEN" });
    await expect(DirectorySource.open({ root: os.tmpdir(), allowedRoot: allowed }))
      .rejects.toMatchObject({ code: "ROOT_FORBIDDEN" });
  });

  it("reports a missing path", async () => {
    await expect(DirectorySource.open({ root: "nope", allowedRoot: allowed })).rejects.toMatchObject({ code: "ROOT_MISSING" });
  });

  it("refuses to read outside the root even with a crafted path", async () => {
    const src = await DirectorySource.open({ root: "repo", allowedRoot: allowed });
    await expect(src.read("../outside-sibling/secret.txt")).rejects.toBeInstanceOf(SourceError);
    await expect(src.read("/etc/passwd")).rejects.toBeInstanceOf(SourceError);
  });

  it("skips symlinks instead of following them", async () => {
    try {
      fs.symlinkSync(path.join(allowed, "outside-sibling"), path.join(allowed, "repo", "linked-dir"), "dir");
      fs.symlinkSync(path.join(allowed, "outside-sibling", "secret.txt"), path.join(allowed, "repo", "linked.txt"), "file");
    } catch (error) {
      // Creating symlinks on Windows needs elevated rights / developer mode.
      if ((error as NodeJS.ErrnoException).code === "EPERM") return;
      throw error;
    }
    const src = await DirectorySource.open({ root: "repo", allowedRoot: allowed });
    const files = await collect(src);
    expect(files.some((f) => f.startsWith("linked"))).toBe(false);
    expect(src.rejected.map((r) => r.reason)).toEqual(expect.arrayContaining(["symlink"]));
  });
});
