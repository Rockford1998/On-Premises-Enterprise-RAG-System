import path from "path";
import type { RepoContext } from "../core/types";
import { stripBom } from "./text";

/**
 * Repository-wide facts the adapters need: which frameworks a project uses
 * (from manifests) and how import aliases map to folders (from tsconfig).
 * Built from the manifest files the walker already read, so nothing here
 * touches the disk.
 */

const posix = path.posix;

const isTsLikeConfig = (name: string): boolean => /^(tsconfig|jsconfig).*\.json$/.test(name);

/** Manifests worth reading. JSON ones are parsed; the rest are kept as raw text for their adapters. */
export const isManifestPath = (p: string): boolean => {
  const name = posix.basename(p);
  return (
    name === "package.json" ||
    isTsLikeConfig(name) ||
    name === "pnpm-workspace.yaml" ||
    name === "pom.xml" ||
    name === "build.gradle" ||
    name === "build.gradle.kts" ||
    name.endsWith(".csproj")
  );
};

/**
 * JSON with comments and trailing commas — what tsconfig.json actually is.
 * A small state machine rather than a regex, so `"//"` inside a string (a URL,
 * a glob) survives.
 */
export const parseJsonc = (text: string): unknown => {
  let out = "";
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < n && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < n && text[i] !== "\n") i++;
    } else if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end === -1 ? n : end + 2;
    } else {
      out += c;
      i++;
    }
  }
  return JSON.parse(stripBom(stripTrailingCommas(out)));
};

/** Drop a comma that is directly followed (ignoring whitespace) by `}` or `]`, outside strings. */
const stripTrailingCommas = (text: string): string => {
  let out = "";
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < n && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (c === ",") {
      let k = i + 1;
      while (k < n && /\s/.test(text[k])) k++;
      if (text[k] !== "}" && text[k] !== "]") out += c;
      i++;
    } else {
      out += c;
      i++;
    }
  }
  return out;
};

type PathsDecl = { dir: string; value: Record<string, string[]> };
type BaseUrlDecl = { dir: string; value: string };
type Effective = { baseUrl?: BaseUrlDecl; paths?: PathsDecl };

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

/** Resolve a tsconfig with its `extends` chain (relative extends only; packages like @tsconfig/node are outside the repo). */
const effectiveConfig = (
  configPath: string,
  manifests: Record<string, unknown>,
  seen: Set<string> = new Set(),
): Effective => {
  if (seen.has(configPath)) return {};
  seen.add(configPath);
  const config = asRecord(manifests[configPath]);
  if (!config) return {};

  const dir = posix.dirname(configPath);
  let effective: Effective = {};

  const extendsValue = config.extends;
  const parents = Array.isArray(extendsValue) ? extendsValue : extendsValue ? [extendsValue] : [];
  for (const parent of parents) {
    if (typeof parent !== "string" || !parent.startsWith(".")) continue;
    const base = posix.normalize(posix.join(dir, parent));
    const found = [base, `${base}.json`].find((candidate) => manifests[candidate] !== undefined);
    if (found) effective = { ...effective, ...effectiveConfig(found, manifests, seen) };
  }

  const options = asRecord(config.compilerOptions);
  if (options) {
    if (typeof options.baseUrl === "string") effective.baseUrl = { dir, value: options.baseUrl };
    const paths = asRecord(options.paths);
    if (paths) {
      const value: Record<string, string[]> = {};
      for (const [alias, targets] of Object.entries(paths)) {
        if (Array.isArray(targets)) value[alias] = targets.filter((t): t is string => typeof t === "string");
      }
      effective.paths = { dir, value };
    }
  }
  return effective;
};

const workspacesOf = (manifests: Record<string, unknown>): string[] | undefined => {
  const root = asRecord(manifests["package.json"]);
  const declared = root?.workspaces;
  const fromPackageJson = Array.isArray(declared)
    ? declared
    : Array.isArray(asRecord(declared)?.packages)
      ? (asRecord(declared)!.packages as unknown[])
      : [];
  const globs = fromPackageJson.filter((g): g is string => typeof g === "string");

  const pnpm = manifests["pnpm-workspace.yaml"];
  if (typeof pnpm === "string") {
    // Only the `packages:` list matters; a full YAML parser is not worth a dependency for it.
    const block = pnpm.split(/\r?\n/);
    let inPackages = false;
    for (const line of block) {
      if (/^packages\s*:/.test(line)) inPackages = true;
      else if (inPackages && /^\s*-\s+/.test(line)) {
        globs.push(line.replace(/^\s*-\s+/, "").trim().replace(/^['"]|['"]$/g, ""));
      } else if (inPackages && /^\S/.test(line)) inPackages = false;
    }
  }
  return globs.length > 0 ? [...new Set(globs)] : undefined;
};

export const buildRepoContext = ({
  name,
  files,
}: {
  name: string;
  /** Only the manifest files (see isManifestPath); others are ignored. */
  files: { path: string; content: string }[];
}): RepoContext => {
  const manifests: Record<string, unknown> = {};
  for (const file of files) {
    if (!isManifestPath(file.path)) continue;
    const base = posix.basename(file.path);
    if (base.endsWith(".json")) {
      try {
        manifests[file.path] = isTsLikeConfig(base) ? parseJsonc(file.content) : JSON.parse(file.content);
      } catch (error) {
        // One malformed manifest must not stop the run; adapters just see less.
        console.warn(`[code-index] could not parse ${file.path}: ${error instanceof Error ? error.message : error}`);
      }
    } else {
      manifests[file.path] = file.content;
    }
  }

  const pathAliases: Record<string, string[]> = {};
  for (const configPath of Object.keys(manifests).sort()) {
    if (!isTsLikeConfig(posix.basename(configPath))) continue;
    const { baseUrl, paths } = effectiveConfig(configPath, manifests);
    if (!paths) continue;
    // TypeScript resolves `paths` against baseUrl when there is one, otherwise against the declaring config.
    const base = baseUrl ? posix.join(baseUrl.dir, baseUrl.value) : paths.dir;
    for (const [alias, targets] of Object.entries(paths.value)) {
      for (const target of targets) {
        const resolved = posix.normalize(posix.join(base, target));
        if (resolved.startsWith("..") || posix.isAbsolute(resolved)) continue;
        const list = (pathAliases[alias] ??= []);
        if (!list.includes(resolved)) list.push(resolved);
      }
    }
  }

  return { name, manifests, pathAliases, workspaces: workspacesOf(manifests) };
};
