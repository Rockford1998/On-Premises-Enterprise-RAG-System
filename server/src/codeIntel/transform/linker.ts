import { fileUid } from "../core/ids";
import type { CodeUnit, EdgeType, LanguageAdapter, RawReference, RepoContext, UnitKind } from "../core/types";
import { normalizeApiPath } from "./apiMatch";

/**
 * Turns the adapters' symbolic references into resolved edges.
 *
 * Resolution never guesses: when a name could be several things, the edge is
 * stored as unresolved (`toExternal` = the name) rather than pointing at the
 * wrong unit. A missing edge costs a little recall; a wrong one sends the
 * model down the wrong code path.
 *
 * Import references may carry `metadata.localName` — the name the import is
 * bound to in the file (`import foo from "./x"` → foo; `const { a: b } = …` → b).
 * Without it the imported name is assumed.
 *
 * Cross-layer API edges (`calls_api`) are *not* resolved here: they are stored
 * unresolved (`api:GET /users`) and matched to routes bot-wide after the run,
 * because the backend is often a different repository.
 */

export type LinkedEdge = {
  fromUid: string;
  toUid?: string;
  toExternal?: string;
  type: EdgeType;
  metadata: Record<string, unknown>;
};

const CALLABLE: UnitKind[] = ["function", "method", "hook", "component", "class"];
const KINDS_FOR: Record<EdgeType, UnitKind[]> = {
  imports: [],
  calls: CALLABLE,
  renders: ["component", "function", "class"],
  uses_hook: ["hook", "function"],
  extends: ["class", "interface"],
  implements: ["interface", "class"],
  handles_route: ["function", "method", "component"],
  uses_entity: ["entity", "class", "interface", "type"],
  calls_api: [],
};

const isRelativeOrAlias = (specifier: string, repo: RepoContext): boolean =>
  specifier.startsWith(".") ||
  Object.keys(repo.pathAliases).some((alias) => {
    const prefix = alias.endsWith("*") ? alias.slice(0, -1) : alias;
    return specifier === alias || (prefix !== "" && specifier.startsWith(prefix));
  });

/** "@scope/pkg/deep/file" → "@scope/pkg"; "lodash/fp" → "lodash"; "node:fs" is kept whole. */
const packageRoot = (specifier: string): string => {
  if (specifier.startsWith("node:")) return specifier;
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
};

type BoundImport = { localName: string; importedName?: string; specifier: string; targetPath: string | null };

export const linkReferences = ({
  repo,
  units,
  references,
  adapterForPath,
  hasFile,
}: {
  repo: RepoContext;
  units: CodeUnit[];
  references: RawReference[];
  adapterForPath: (path: string) => LanguageAdapter | null;
  hasFile: (path: string) => boolean;
}): LinkedEdge[] => {
  const byUid = new Map(units.map((u) => [u.uid, u]));
  const byPath = new Map<string, CodeUnit[]>();
  const byName = new Map<string, CodeUnit[]>();
  for (const unit of units) {
    (byPath.get(unit.path) ?? byPath.set(unit.path, []).get(unit.path)!).push(unit);
    if (unit.kind !== "file") (byName.get(unit.name) ?? byName.set(unit.name, []).get(unit.name)!).push(unit);
  }

  const edges = new Map<string, LinkedEdge>();
  const addEdge = (edge: Omit<LinkedEdge, "metadata"> & { metadata?: Record<string, unknown> }) => {
    if (edge.toUid && edge.toUid === edge.fromUid) return; // a recursive call is not interesting
    const key = `${edge.fromUid}|${edge.type}|${edge.toUid ?? edge.toExternal}`;
    const existing = edges.get(key);
    if (existing) {
      existing.metadata.count = ((existing.metadata.count as number) ?? 1) + 1;
      return;
    }
    edges.set(key, { ...edge, metadata: { ...(edge.metadata ?? {}) } });
  };

  const fileUnitUid = (path: string): string => fileUid({ repoName: repo.name, path });
  const findInFile = (path: string, name: string): CodeUnit | undefined => {
    const inFile = (byPath.get(path) ?? []).filter((u) => u.kind !== "file" && (u.name === name || u.qualifiedName === name));
    return inFile.find((u) => u.exported) ?? inFile[0];
  };

  // Pass 1: imports. Each file's bound names are remembered for pass 2.
  const importsByPath = new Map<string, BoundImport[]>();
  for (const ref of references) {
    if (ref.target.kind !== "import") continue;
    const from = byUid.get(ref.fromUid);
    if (!from) continue;
    const { specifier, importedName } = ref.target;
    const adapter = adapterForPath(from.path);
    const targetPath = adapter?.resolveImport({ fromPath: from.path, specifier, repo, hasFile }) ?? null;

    const localName = typeof ref.metadata?.localName === "string" ? ref.metadata.localName : importedName ?? "";
    (importsByPath.get(from.path) ?? importsByPath.set(from.path, []).get(from.path)!).push({
      localName,
      importedName,
      specifier,
      targetPath,
    });

    if (targetPath) {
      const named = importedName && importedName !== "default" && importedName !== "*" ? findInFile(targetPath, importedName) : undefined;
      const toUid = named?.uid ?? (byPath.has(targetPath) ? fileUnitUid(targetPath) : undefined);
      if (toUid) addEdge({ fromUid: ref.fromUid, toUid, type: "imports", metadata: { specifier, ...(importedName ? { importedName } : {}) } });
      else addEdge({ fromUid: ref.fromUid, toExternal: `unresolved:${specifier}`, type: "imports", metadata: { specifier } });
    } else if (isRelativeOrAlias(specifier, repo)) {
      addEdge({ fromUid: ref.fromUid, toExternal: `unresolved:${specifier}`, type: "imports", metadata: { specifier } });
    } else {
      addEdge({ fromUid: ref.fromUid, toExternal: `external:${packageRoot(specifier)}`, type: "imports", metadata: { specifier } });
    }
  }

  type Resolution = { toUid: string } | { toExternal: string; metadata?: Record<string, unknown> };

  const resolveSymbol = (from: CodeUnit, name: string, type: EdgeType): Resolution => {
    const kinds = KINDS_FOR[type];
    const matchesKind = (u: CodeUnit) => kinds.length === 0 || kinds.includes(u.kind);
    const parts = name.split(".").filter(Boolean);
    if (parts.length === 0) return { toExternal: name };
    const fileUnits = (byPath.get(from.path) ?? []).filter((u) => u.kind !== "file");

    // this.foo(): a sibling method, preferring the same class.
    if (parts[0] === "this" && parts.length >= 2) {
      const siblings = fileUnits.filter((u) => u.name === parts[1] && matchesKind(u));
      const same = siblings.find((u) => u.parentUid === from.parentUid || u.parentUid === from.uid);
      const hit = same ?? siblings[0];
      if (hit) return { toUid: hit.uid };
    }

    // (a) local scope — a plain name defined in the same file.
    if (parts.length === 1) {
      const local = fileUnits.filter((u) => u.name === parts[0] && matchesKind(u));
      const sibling = local.find((u) => u.parentUid === from.parentUid) ?? local.find((u) => !u.parentUid) ?? local[0];
      if (sibling) return { toUid: sibling.uid };
    }

    // (b) a name bound by one of this file's imports.
    const head = parts[0];
    const bound = (importsByPath.get(from.path) ?? []).find((imp) => imp.localName === head);
    if (bound) {
      if (!bound.targetPath) {
        return isRelativeOrAlias(bound.specifier, repo)
          ? { toExternal: name }
          : { toExternal: `external:${packageRoot(bound.specifier)}`, metadata: { symbol: name } };
      }
      const member = parts.length === 1 ? bound.importedName && bound.importedName !== "default" ? bound.importedName : head : parts[1];
      const target = findInFile(bound.targetPath, member) ?? (parts.length === 1 ? undefined : findInFile(bound.targetPath, `${head}.${parts[1]}`));
      if (target && matchesKind(target)) return { toUid: target.uid };
      if (byPath.has(bound.targetPath)) return { toUid: fileUnitUid(bound.targetPath) };
    }

    // (c) exactly one unit of the right kind with that name anywhere in the repo.
    const last = parts[parts.length - 1];
    const global = (byName.get(last) ?? []).filter(matchesKind);
    if (global.length === 1) return { toUid: global[0].uid };

    return { toExternal: name };
  };

  // Pass 2: everything else.
  for (const ref of references) {
    const from = byUid.get(ref.fromUid);
    if (!from) continue;
    const target = ref.target;
    if (target.kind === "api") {
      const method = target.method.toUpperCase();
      const normalised = normalizeApiPath(target.path);
      addEdge({
        fromUid: ref.fromUid,
        toExternal: `api:${method} ${normalised}`,
        type: "calls_api",
        metadata: { method, path: target.path, normalizedPath: normalised, ...(ref.metadata ?? {}) },
      });
    } else if (target.kind === "symbol") {
      const resolved = resolveSymbol(from, target.name, ref.type);
      if ("toUid" in resolved) addEdge({ fromUid: ref.fromUid, toUid: resolved.toUid, type: ref.type, metadata: ref.metadata });
      else addEdge({ fromUid: ref.fromUid, toExternal: resolved.toExternal, type: ref.type, metadata: { ...(resolved.metadata ?? {}), ...(ref.metadata ?? {}) } });
    }
    // "import" was handled above; "route" declarations are route units, not edges.
  }

  return [...edges.values()];
};
