import AdmZip from "adm-zip";
import fs from "fs";
import path from "path";
import type { FileSource, SourceListOptions } from "../core/types";

/**
 * Where a repository's files come from. Both implementations expose the same
 * read-only view so the walker never cares which one it has.
 *
 * Safety rules that apply to every source:
 *  - nothing is ever written to disk under a name taken from the archive
 *    (zip entries are read in memory), so there is no zip-slip;
 *  - names that are absolute or contain `..` are rejected, not "fixed up";
 *  - symlinks are never followed or read.
 */

export type SourceErrorCode =
  | "ZIP_INVALID"
  | "ZIP_LIMIT"
  | "ROOT_FORBIDDEN"
  | "ROOT_MISSING"
  | "FILE_NOT_FOUND";

export class SourceError extends Error {
  constructor(message: string, public code: SourceErrorCode) {
    super(message);
    this.name = "SourceError";
  }
}

type Rejection = { path: string; reason: string };

/** Descend check for a file path: every ancestor directory must be allowed. */
const isUnderPrunedDir = (filePath: string, shouldDescend?: (dir: string) => boolean): boolean => {
  if (!shouldDescend) return false;
  const segments = filePath.split("/");
  let dir = "";
  for (let i = 0; i < segments.length - 1; i++) {
    dir = dir ? `${dir}/${segments[i]}` : segments[i];
    if (!shouldDescend(dir)) return true;
  }
  return false;
};

/** Reason a raw archive entry name is unsafe, or null when it is fine. */
export const unsafeEntryReason = (rawName: string): string | null => {
  if (rawName.includes("\0")) return "NUL byte in name";
  if (/^([a-zA-Z]:)?[\\/]/.test(rawName) || /^[a-zA-Z]:/.test(rawName)) return "absolute path";
  if (rawName.split(/[\\/]/).includes("..")) return "path traversal";
  return null;
};

const normaliseEntryName = (rawName: string): string =>
  rawName
    .replace(/\\/g, "/")
    .split("/")
    .filter((segment) => segment !== "" && segment !== ".")
    .join("/");

const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;
const isSymlinkEntry = (entry: AdmZip.IZipEntry): boolean =>
  (((entry.attr >>> 16) & S_IFMT) === S_IFLNK);

/** Archive junk that must not count when deciding whether there is one top-level folder. */
const isArchiveJunk = (name: string): boolean =>
  name.startsWith("__MACOSX/") || name.split("/").pop() === ".DS_Store";

/**
 * GitHub-style archives wrap everything in one `<repo>-<sha>/` folder. Strip
 * it so paths are repo-relative — but only when *every* file is inside it.
 */
const commonRoot = (names: string[]): string | null => {
  const real = names.filter((n) => !isArchiveJunk(n));
  if (real.length === 0) return null;
  const first = real[0].split("/");
  if (first.length < 2) return null;
  const root = first[0];
  return real.every((n) => n.split("/").length >= 2 && n.split("/")[0] === root) ? root : null;
};

export type ZipLimits = {
  /** Refuse archives with more entries than this (counts directories and skipped files too). */
  maxEntries: number;
  /** Zip-bomb guard: total declared uncompressed size of the files handed out by list(). */
  maxTotalBytes: number;
};

export class ZipSource implements FileSource {
  readonly rejected: Rejection[] = [];
  private files = new Map<string, { entry: AdmZip.IZipEntry; size: number }>();

  constructor(zip: string | Buffer, private limits: ZipLimits) {
    let archive: AdmZip;
    try {
      archive = new AdmZip(zip);
    } catch {
      throw new SourceError("The file is not a valid zip archive.", "ZIP_INVALID");
    }
    const entries = archive.getEntries();
    if (entries.length > limits.maxEntries) {
      throw new SourceError(
        `The archive has ${entries.length} entries; the limit is ${limits.maxEntries}. Remove build output and dependencies (node_modules) and try again.`,
        "ZIP_LIMIT",
      );
    }

    const candidates: { name: string; entry: AdmZip.IZipEntry }[] = [];
    for (const entry of entries) {
      if (entry.isDirectory) continue;
      const unsafe = unsafeEntryReason(entry.entryName);
      if (unsafe) {
        this.rejected.push({ path: entry.entryName, reason: unsafe });
        continue;
      }
      if (isSymlinkEntry(entry)) {
        this.rejected.push({ path: entry.entryName, reason: "symlink" });
        continue;
      }
      const name = normaliseEntryName(entry.entryName);
      if (!name) continue;
      candidates.push({ name, entry });
    }

    const root = commonRoot(candidates.map((c) => c.name));
    for (const { name, entry } of candidates) {
      const relative = root ? name.slice(root.length + 1) : name;
      if (!relative) continue;
      if (this.files.has(relative)) {
        this.rejected.push({ path: relative, reason: "duplicate entry" });
        continue;
      }
      this.files.set(relative, { entry, size: entry.header.size });
    }
  }

  async *list(options?: SourceListOptions): AsyncIterable<{ path: string; size: number }> {
    let total = 0;
    for (const p of [...this.files.keys()].sort()) {
      if (isUnderPrunedDir(p, options?.shouldDescend)) continue;
      const { size } = this.files.get(p)!;
      total += size;
      if (total > this.limits.maxTotalBytes) {
        throw new SourceError(
          `The archive unpacks to more than ${this.limits.maxTotalBytes} bytes.`,
          "ZIP_LIMIT",
        );
      }
      yield { path: p, size };
    }
  }

  async read(filePath: string): Promise<Buffer> {
    const found = this.files.get(filePath);
    if (!found) throw new SourceError(`No such file in archive: ${filePath}`, "FILE_NOT_FOUND");
    const data = found.entry.getData();
    // A forged header could declare a small size and inflate to something huge.
    if (data.length !== found.size) {
      throw new SourceError(`Corrupt entry (size mismatch): ${filePath}`, "ZIP_INVALID");
    }
    return data;
  }
}

/** True when `target` is `root` itself or somewhere beneath it. */
const isWithin = (root: string, target: string): boolean => {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
};

/**
 * A directory on the server. Only ever opened beneath an allow-listed root
 * (CODE_REPOS_ROOT); both paths are resolved through realpath first, so a
 * symlink or `..` cannot lead outside it.
 */
export class DirectorySource implements FileSource {
  readonly rejected: Rejection[] = [];

  private constructor(private root: string) {}

  static async open({ root, allowedRoot }: { root: string; allowedRoot: string }): Promise<DirectorySource> {
    if (!allowedRoot.trim()) {
      throw new SourceError("Server-path sources are disabled (CODE_REPOS_ROOT is not set).", "ROOT_FORBIDDEN");
    }
    let allowedReal: string;
    let rootReal: string;
    try {
      allowedReal = await fs.promises.realpath(allowedRoot);
      // path.resolve treats an absolute `root` as absolute and a relative one as inside allowedRoot.
      rootReal = await fs.promises.realpath(path.resolve(allowedReal, root));
    } catch {
      throw new SourceError("That path does not exist on the server.", "ROOT_MISSING");
    }
    if (!isWithin(allowedReal, rootReal)) {
      throw new SourceError("That path is outside the allowed repositories root.", "ROOT_FORBIDDEN");
    }
    const stat = await fs.promises.stat(rootReal);
    if (!stat.isDirectory()) {
      throw new SourceError("That path is not a directory.", "ROOT_MISSING");
    }
    return new DirectorySource(rootReal);
  }

  async *list(options?: SourceListOptions): AsyncIterable<{ path: string; size: number }> {
    const walk = async function* (
      self: DirectorySource,
      relDir: string,
    ): AsyncGenerator<{ path: string; size: number }> {
      const abs = relDir ? path.join(self.root, ...relDir.split("/")) : self.root;
      const dirents = await fs.promises.readdir(abs, { withFileTypes: true });
      dirents.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      for (const dirent of dirents) {
        const rel = relDir ? `${relDir}/${dirent.name}` : dirent.name;
        if (dirent.isSymbolicLink()) {
          self.rejected.push({ path: rel, reason: "symlink" });
        } else if (dirent.isDirectory()) {
          if (options?.shouldDescend && !options.shouldDescend(rel)) continue;
          yield* walk(self, rel);
        } else if (dirent.isFile()) {
          const stat = await fs.promises.stat(path.join(abs, dirent.name));
          yield { path: rel, size: stat.size };
        }
      }
    };
    yield* walk(this, "");
  }

  async read(filePath: string): Promise<Buffer> {
    if (unsafeEntryReason(filePath)) {
      throw new SourceError(`Unsafe path: ${filePath}`, "FILE_NOT_FOUND");
    }
    const abs = path.join(this.root, ...filePath.split("/"));
    let real: string;
    try {
      real = await fs.promises.realpath(abs);
    } catch {
      throw new SourceError(`No such file: ${filePath}`, "FILE_NOT_FOUND");
    }
    if (!isWithin(this.root, real)) {
      throw new SourceError(`Path escapes the repository root: ${filePath}`, "ROOT_FORBIDDEN");
    }
    return fs.promises.readFile(real);
  }
}
