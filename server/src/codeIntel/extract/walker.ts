import crypto from "crypto";
import ignore, { Ignore } from "ignore";
import { adapterRegistry } from "../core/registry";
import type { FileRecord, FileSource } from "../core/types";
import { classifyFile } from "./classify";
import { stripBom } from "./text";

/**
 * Turns a FileSource into the FileRecords worth indexing.
 *
 * What is skipped, and why it is *reported* rather than silently dropped: a
 * user who uploads a repo and finds a file missing from answers needs to be
 * able to see that it was skipped and for what reason.
 */

export type SkipReason =
  | "skipped-directory"
  | "lockfile"
  | "minified-or-sourcemap"
  | "binary-extension"
  | "secret"
  | "excluded-glob"
  | "gitignored"
  | "empty"
  | "too-large"
  | "binary-content";

export type SkippedFile = { path: string; reason: SkipReason };

export type WalkLimits = { maxFiles: number; maxFileBytes: number };

export class RepoLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RepoLimitError";
  }
}

const SKIP_DIRS = new Set([
  "node_modules", "dist", "build", ".next", ".nuxt", ".turbo", "coverage",
  ".git", ".svn", ".hg", "__MACOSX",
]);

export const shouldDescendDir = (dirPath: string): boolean => {
  const name = dirPath.split("/").pop() ?? dirPath;
  return !SKIP_DIRS.has(name);
};

const LOCKFILES = new Set([
  "package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "pnpm-lock.yaml", "bun.lockb", "bun.lock",
  "composer.lock", "gemfile.lock", "poetry.lock", "cargo.lock", "go.sum",
]);

const BINARY_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "ico", "webp", "bmp", "svg", "avif",
  "pdf", "zip", "gz", "tgz", "tar", "rar", "7z", "jar", "war", "class", "dll", "exe", "so", "dylib", "bin",
  "woff", "woff2", "ttf", "eot", "otf", "mp3", "mp4", "mov", "avi", "webm", "wav",
]);

const SECRET_EXTENSIONS = /\.(pem|key|p12|pfx|jks|keystore)$/;
const SAFE_ENV_TEMPLATES = /^\.env\.(example|sample|template|dist)$/;

/** Files that commonly hold credentials. Stored content is readable by everyone who can view the bot, so these are never stored. */
export const isSecretFile = (name: string): boolean => {
  const n = name.toLowerCase();
  if (n === ".env" || n.startsWith(".env.")) return !SAFE_ENV_TEMPLATES.test(n);
  if (SECRET_EXTENSIONS.test(n)) return true;
  if (/^id_(rsa|dsa|ecdsa|ed25519)/.test(n)) return true;
  if (/^credentials/.test(n) || /^secrets?\./.test(n)) return true;
  if (/service[-_]?account.*\.json$/.test(n)) return true;
  return n === ".npmrc" || n === ".netrc" || n === ".pypirc";
};

/** Path-only checks, cheapest first. Directory pruning happens earlier, in shouldDescendDir. */
export const skipReasonForPath = (path: string): SkipReason | null => {
  const segments = path.split("/");
  const name = segments[segments.length - 1];
  const lower = name.toLowerCase();
  if (segments.slice(0, -1).some((s) => SKIP_DIRS.has(s))) return "skipped-directory";
  if (LOCKFILES.has(lower)) return "lockfile";
  if (/\.min\.(js|css|mjs)$/.test(lower) || /\.map$/.test(lower)) return "minified-or-sourcemap";
  const ext = lower.includes(".") ? lower.split(".").pop() ?? "" : "";
  if (BINARY_EXTENSIONS.has(ext)) return "binary-extension";
  if (isSecretFile(name)) return "secret";
  return null;
};

const defaultLanguageFor = (path: string): string | null =>
  adapterRegistry.languageForPath(path)?.language ?? null;

const dirOf = (path: string): string => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");

/**
 * Is `path` ignored by the .gitignore files above it (root included)? As in
 * git, a deeper file overrides a shallower one, and a `!negation` re-includes.
 * So this walks from the root down and lets the last matching rule decide.
 */
const isGitIgnored = (path: string, byDir: Map<string, Ignore>): boolean => {
  if (byDir.size === 0) return false;
  const parts = path.split("/");
  let ignored = false;
  let dir = "";
  for (let i = 0; i <= parts.length - 1; i++) {
    const matcher = byDir.get(dir);
    if (matcher) {
      const relative = dir ? path.slice(dir.length + 1) : path;
      if (relative) {
        const result = matcher.test(relative);
        if (result.ignored) ignored = true;
        else if (result.unignored) ignored = false;
      }
    }
    if (i < parts.length - 1) dir = dir ? `${dir}/${parts[i]}` : parts[i];
  }
  return ignored;
};

const countLines = (content: string): number => {
  if (content.length === 0) return 0;
  const n = content.split("\n").length;
  return content.endsWith("\n") ? n - 1 : n;
};

export async function* walkRepo({
  source,
  limits,
  excludeGlobs = [],
  languageFor = defaultLanguageFor,
  onSkip = () => undefined,
}: {
  source: FileSource;
  limits: WalkLimits;
  /** gitignore-style patterns (CODE_EXCLUDE_GLOBS). */
  excludeGlobs?: string[];
  /** Language of a path, or null. Defaults to the adapter registry; injectable so this module has no adapter knowledge. */
  languageFor?: (path: string) => string | null;
  onSkip?: (skipped: SkippedFile) => void;
}): AsyncGenerator<FileRecord> {
  // Pass 1: names and sizes only. Directories like node_modules are pruned here.
  const entries: { path: string; size: number }[] = [];
  for await (const entry of source.list({ shouldDescend: shouldDescendDir })) entries.push(entry);
  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  // .gitignore files (root and nested), each scoped to its own directory.
  const gitignores = new Map<string, Ignore>();
  for (const entry of entries) {
    if (entry.path.split("/").pop() !== ".gitignore" || entry.size > limits.maxFileBytes) continue;
    const text = (await source.read(entry.path)).toString("utf8");
    gitignores.set(dirOf(entry.path), ignore().add(text));
  }
  const excluded = excludeGlobs.length > 0 ? ignore().add(excludeGlobs) : null;

  // Pass 2: filter, then read only what survives.
  let accepted = 0;
  for (const { path, size } of entries) {
    const byPath = skipReasonForPath(path);
    if (byPath) {
      onSkip({ path, reason: byPath });
      continue;
    }
    if (excluded?.ignores(path)) {
      onSkip({ path, reason: "excluded-glob" });
      continue;
    }
    if (isGitIgnored(path, gitignores)) {
      onSkip({ path, reason: "gitignored" });
      continue;
    }
    if (size === 0) {
      onSkip({ path, reason: "empty" });
      continue;
    }
    if (size > limits.maxFileBytes) {
      onSkip({ path, reason: "too-large" });
      continue;
    }

    const buffer = await source.read(path);
    // A NUL byte essentially never appears in real source; its presence means a binary with a code-like extension.
    if (buffer.includes(0)) {
      onSkip({ path, reason: "binary-content" });
      continue;
    }

    accepted++;
    if (accepted > limits.maxFiles) {
      throw new RepoLimitError(
        `The repository has more than ${limits.maxFiles} indexable files. Exclude generated or vendored folders and try again.`,
      );
    }

    const content = stripBom(buffer.toString("utf8"));
    yield {
      path,
      language: languageFor(path),
      category: classifyFile({ path, content }),
      content,
      contentHash: crypto.createHash("sha256").update(buffer).digest("hex"),
      lineCount: countLines(content),
    };
  }
}
