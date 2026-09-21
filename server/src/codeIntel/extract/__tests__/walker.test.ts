import fs from "fs";
import os from "os";
import path from "path";
import { DirectorySource, ZipSource } from "../fileSource";
import { isSecretFile, RepoLimitError, skipReasonForPath, SkippedFile, walkRepo } from "../walker";
import { buildZip } from "./zipBuilder";
import type { FileRecord } from "../../core/types";

const limits = { maxFiles: 1000, maxFileBytes: 1024 * 1024 };
const FIXTURES = path.resolve(__dirname, "../../../../test-fixtures");
const MERN = path.join(FIXTURES, "sample-mern");

const walk = async (
  source: Parameters<typeof walkRepo>[0]["source"],
  extra: Partial<Parameters<typeof walkRepo>[0]> = {},
) => {
  const files: FileRecord[] = [];
  const skipped: SkippedFile[] = [];
  for await (const file of walkRepo({ source, limits, onSkip: (s) => skipped.push(s), ...extra })) files.push(file);
  return { files, skipped };
};

const EXPECTED_MERN = [
  ".gitignore",
  "controllers/userController.js",
  "models/User.js",
  "package.json",
  "routes/users.js",
  "server.js",
  "services/userService.js",
  "src/App.tsx",
  "src/components/UserCard.tsx",
  "src/hooks/useUsers.ts",
  "src/pages/UsersPage.tsx",
  "tsconfig.json",
];

describe("skipReasonForPath", () => {
  it.each([
    ["node_modules/x/index.js", "skipped-directory"],
    ["a/dist/out.js", "skipped-directory"],
    ["build/x.js", "skipped-directory"],
    [".next/server.js", "skipped-directory"],
    ["coverage/lcov.info", "skipped-directory"],
    [".git/config", "skipped-directory"],
    ["package-lock.json", "lockfile"],
    ["web/yarn.lock", "lockfile"],
    ["pnpm-lock.yaml", "lockfile"],
    ["public/app.min.js", "minified-or-sourcemap"],
    ["dist-not/app.js.map", "minified-or-sourcemap"],
    ["logo.png", "binary-extension"],
    ["lib/thing.jar", "binary-extension"],
    [".env", "secret"],
    [".env.local", "secret"],
    ["config/server.pem", "secret"],
    ["keys/id_rsa", "secret"],
    ["credentials.json", "secret"],
    [".npmrc", "secret"],
  ])("%s -> %s", (p, reason) => {
    expect(skipReasonForPath(p)).toBe(reason);
  });

  it.each(["src/index.ts", ".env.example", ".env.sample", "package.json", "src/environment.ts", "docs/keys.md", "build-tools/a.js"])(
    "does not skip %s",
    (p) => {
      expect(skipReasonForPath(p)).toBeNull();
    },
  );

  it("knows which names are secrets", () => {
    expect(isSecretFile(".ENV")).toBe(true);
    expect(isSecretFile(".env.production")).toBe(true);
    expect(isSecretFile(".env.example")).toBe(false);
  });
});

describe("walkRepo on the sample-mern fixture", () => {
  it("returns exactly the expected files, with categories, and not the .env", async () => {
    const source = await DirectorySource.open({ root: "sample-mern", allowedRoot: FIXTURES });
    const { files, skipped } = await walk(source);

    expect(files.map((f) => f.path)).toEqual(EXPECTED_MERN);
    expect(files.some((f) => f.path.includes("node_modules"))).toBe(false);
    expect(files.some((f) => f.path === ".env")).toBe(false);
    expect(skipped).toContainEqual({ path: ".env", reason: "secret" });
    expect(fs.existsSync(path.join(MERN, ".env"))).toBe(true); // the file is really there, and was still not read

    const category = Object.fromEntries(files.map((f) => [f.path, f.category]));
    expect(category["package.json"]).toBe("config");
    expect(category["tsconfig.json"]).toBe("config");
    expect(category["services/userService.js"]).toBe("source");
    expect(category["src/components/UserCard.tsx"]).toBe("source");
  });

  it("fills in hashes, line counts and normalised content", async () => {
    const source = await DirectorySource.open({ root: "sample-mern", allowedRoot: FIXTURES });
    const { files } = await walk(source);
    const card = files.find((f) => f.path === "src/components/UserCard.tsx")!;
    expect(card.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(card.lineCount).toBe(card.content.trimEnd().split("\n").length);
    expect(card.content.charCodeAt(0)).not.toBe(0xfeff);
  });

  it("gives the same result from a zip of the same files (with a wrapping folder)", async () => {
    const entries = EXPECTED_MERN.concat([".env"]).map((p) => ({
      name: `sample-mern-main/${p}`,
      data: fs.readFileSync(path.join(MERN, p)),
    }));
    entries.push({ name: "sample-mern-main/node_modules/left-pad/index.js", data: Buffer.from("module.exports = 1") });
    const zip = new ZipSource(buildZip(entries), { maxEntries: 1000, maxTotalBytes: 50 * 1024 * 1024 });
    const { files } = await walk(zip);
    expect(files.map((f) => f.path)).toEqual(EXPECTED_MERN);
  });

  it("uses the injected language lookup and never reads the adapter registry itself", async () => {
    const source = await DirectorySource.open({ root: "sample-mern", allowedRoot: FIXTURES });
    const { files } = await walk(source, { languageFor: (p) => (/\.(ts|tsx|js)$/.test(p) ? "typescript" : null) });
    expect(files.find((f) => f.path === "server.js")!.language).toBe("typescript");
    expect(files.find((f) => f.path === "package.json")!.language).toBeNull();
  });
});

describe("walkRepo filtering", () => {
  let dir: string;
  let source: DirectorySource;

  const write = (rel: string, content: string | Buffer) => {
    const abs = path.join(dir, "repo", ...rel.split("/"));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "code-walk-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const open = async () => {
    source = await DirectorySource.open({ root: "repo", allowedRoot: dir });
    return source;
  };

  it("honours root and nested .gitignore files, each scoped to its own folder", async () => {
    write(".gitignore", "*.log\nout/\n");
    write("a.ts", "export {}");
    write("debug.log", "x");
    write("out/bundle.js", "x");
    write("pkg/.gitignore", "generated-here.ts\n!keep.log\n");
    write("pkg/generated-here.ts", "x");
    write("pkg/real.ts", "export {}");
    write("pkg/keep.log", "kept");        // negated by the nested file
    write("other/generated-here.ts", "x"); // the nested rule must NOT apply here
    const { files, skipped } = await walk(await open());
    expect(files.map((f) => f.path)).toEqual([
      ".gitignore", "a.ts", "other/generated-here.ts", "pkg/.gitignore", "pkg/keep.log", "pkg/real.ts",
    ]);
    expect(skipped.filter((s) => s.reason === "gitignored").map((s) => s.path).sort())
      .toEqual(["debug.log", "out/bundle.js", "pkg/generated-here.ts"]);
  });

  it("applies extra exclude globs", async () => {
    write("a.ts", "export {}");
    write("fixtures/big.ts", "export {}");
    write("secrets/thing.ts", "export {}");
    const { files, skipped } = await walk(await open(), { excludeGlobs: ["fixtures/", "secrets/**"] });
    expect(files.map((f) => f.path)).toEqual(["a.ts"]);
    expect(skipped.map((s) => s.reason)).toEqual(["excluded-glob", "excluded-glob"]);
  });

  it("skips empty, oversized and binary-content files and says why", async () => {
    write("ok.ts", "export {}");
    write("empty.ts", "");
    write("huge.ts", "x".repeat(2048));
    write("fake.js", Buffer.from([0x61, 0x00, 0x62]));
    const { files, skipped } = await walk(await open(), { limits: { maxFiles: 100, maxFileBytes: 1000 } });
    expect(files.map((f) => f.path)).toEqual(["ok.ts"]);
    const byPath = Object.fromEntries(skipped.map((s) => [s.path, s.reason]));
    expect(byPath).toMatchObject({ "empty.ts": "empty", "huge.ts": "too-large", "fake.js": "binary-content" });
  });

  it("flags generated files by header without dropping them", async () => {
    write("gen.ts", "// AUTO-GENERATED. DO NOT EDIT.\nexport const x = 1;\n");
    write("real.ts", "export const y = 2;\n");
    const { files } = await walk(await open());
    expect(Object.fromEntries(files.map((f) => [f.path, f.category]))).toEqual({ "gen.ts": "generated", "real.ts": "source" });
  });

  it("strips a UTF-8 BOM and counts lines the way an editor does", async () => {
    write("bom.ts", "﻿line1\nline2\n");
    write("noeol.ts", "a\nb");
    const { files } = await walk(await open());
    const byPath = Object.fromEntries(files.map((f) => [f.path, f]));
    expect(byPath["bom.ts"].content.startsWith("line1")).toBe(true);
    expect(byPath["bom.ts"].lineCount).toBe(2);
    expect(byPath["noeol.ts"].lineCount).toBe(2);
  });

  it("stops with a clear error when the file cap is exceeded, instead of indexing a partial repo", async () => {
    for (let i = 0; i < 5; i++) write(`f${i}.ts`, "export {}");
    await expect(walk(await open(), { limits: { maxFiles: 3, maxFileBytes: 1000 } })).rejects.toBeInstanceOf(RepoLimitError);
  });

  it("is deterministic: same input, same order and hashes", async () => {
    write("b.ts", "b");
    write("a.ts", "a");
    write("dir/c.ts", "c");
    const first = await walk(await open());
    const second = await walk(await open());
    expect(first.files.map((f) => [f.path, f.contentHash])).toEqual(second.files.map((f) => [f.path, f.contentHash]));
    expect(first.files.map((f) => f.path)).toEqual(["a.ts", "b.ts", "dir/c.ts"]);
  });
});
