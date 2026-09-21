/**
 * Contracts shared by the code-intelligence pipeline. Language and framework
 * adapters may only produce these types; the core, storage and retrieval code
 * never imports an adapter directly (it goes through the registry).
 */

export type UnitKind =
  | "function" | "method" | "class" | "component" | "hook" | "route"
  | "entity" | "interface" | "type" | "config" | "file";

export type EdgeType =
  | "imports" | "calls" | "renders" | "handles_route" | "calls_api"
  | "uses_entity" | "extends" | "implements" | "uses_hook";

export type FileCategory = "source" | "test" | "config" | "docs" | "schema" | "generated";

/** A file as the pipeline sees it. There is no absolute path: files may come from a zip and never touch disk. */
export interface FileRecord {
  /** Repo-relative, forward slashes. */
  path: string;
  language: string | null;
  category: FileCategory;
  content: string;
  contentHash: string;
  lineCount: number;
}

export interface CodeUnit {
  /** Stable id, see ids.ts. */
  uid: string;
  path: string;
  parentUid?: string;
  kind: UnitKind;
  name: string;
  qualifiedName: string;
  signature?: string;
  code: string;
  /** 1-based, inclusive. */
  startLine: number;
  endLine: number;
  docstring?: string;
  exported: boolean;
  metadata: Record<string, unknown>;
}

/** Before linking, references are symbolic; the linker resolves them to unit ids. */
export type ReferenceTarget =
  | { kind: "import"; specifier: string; importedName?: string }
  | { kind: "symbol"; name: string }
  | { kind: "api"; method: string; path: string }
  | { kind: "route"; method: string; path: string };

export interface RawReference {
  fromUid: string;
  type: EdgeType;
  target: ReferenceTarget;
  metadata?: Record<string, unknown>;
}

export interface ParseResult {
  units: CodeUnit[];
  references: RawReference[];
  /**
   * The syntax tree, when the adapter built one, so framework adapters can
   * enrich without re-parsing. It holds WASM memory: the pipeline owns it and
   * disposes of it once every enricher has run.
   */
  tree?: unknown;
}

export interface SourceListOptions {
  /** Return false to skip a directory (repo-relative, no trailing slash) without descending into it. */
  shouldDescend?: (dirPath: string) => boolean;
}

/** Read-only view of a repository's files; implemented for zip archives and server directories. */
export interface FileSource {
  /** Files only, repo-relative with forward slashes, in a deterministic (sorted) order. */
  list(options?: SourceListOptions): AsyncIterable<{ path: string; size: number }>;
  read(path: string): Promise<Buffer>;
  /** Entries the source itself refused (unsafe names, symlinks, duplicates), for the run report. */
  readonly rejected: ReadonlyArray<{ path: string; reason: string }>;
}

export interface RepoContext {
  name: string;
  /**
   * Manifests keyed by repo-relative path. JSON manifests (package.json,
   * tsconfig.json, jsconfig.json) are parsed; pom.xml, build.gradle* and
   * *.csproj are kept as raw text for their adapters to read.
   */
  manifests: Record<string, unknown>;
  /**
   * From tsconfig/jsconfig "paths", e.g. { "@/*": ["src/*"] }. Targets are
   * repo-relative; several targets can share a key when a monorepo has the
   * same alias in more than one package — resolveImport tries each in turn.
   */
  pathAliases: Record<string, string[]>;
  /** Workspace globs from the root package.json or pnpm-workspace.yaml; undefined when not a monorepo. */
  workspaces?: string[];
}

export interface LanguageAdapter {
  /** e.g. "typescript" */
  language: string;
  /** Lower-case, with the dot: [".ts", ".tsx", ".js"] */
  extensions: string[];
  /** `repo` supplies the repository name, which every unit id starts with (see ids.ts). */
  parse(args: { file: FileRecord; repo: RepoContext }): Promise<ParseResult>;
  /** Resolve an import specifier to a repo-relative path, or null when it is external. */
  resolveImport(args: { fromPath: string; specifier: string; repo: RepoContext; hasFile: (path: string) => boolean }): string | null;
}

export interface FrameworkAdapter {
  /** e.g. "express" */
  name: string;
  /** Language adapters this one augments. */
  languages: string[];
  detect(repo: RepoContext): boolean;
  /**
   * Receives the language adapter's output and syntax tree; returns extra
   * units/references (routes, components, API calls) and may enrich existing units.
   */
  enrich(args: { file: FileRecord; base: ParseResult; tree: unknown; repo: RepoContext }): Promise<ParseResult>;
}
