import { fileUid, unitUid } from "../../core/ids";
import type { CodeUnit, LanguageAdapter, RawReference, RepoContext, UnitKind } from "../../core/types";
import { LinkedEdge, linkReferences } from "../linker";

const REPO = "shop";
const repo: RepoContext = { name: REPO, manifests: {}, pathAliases: { "@/*": ["src/*"] } };

const u = (path: string, qualifiedName: string, kind: UnitKind, over: Partial<CodeUnit> = {}): CodeUnit => ({
  uid: unitUid({ repoName: REPO, path, qualifiedName }),
  path, kind, name: qualifiedName.split(".").pop()!, qualifiedName, code: "", startLine: 1, endLine: 1, exported: true, metadata: {}, ...over,
});
const fileU = (path: string): CodeUnit => ({
  uid: fileUid({ repoName: REPO, path }), path, kind: "file", name: path.split("/").pop()!, qualifiedName: "<file>",
  code: "", startLine: 1, endLine: 1, exported: false, metadata: {},
});
const sym = (from: CodeUnit, name: string, type: RawReference["type"] = "calls"): RawReference => ({ fromUid: from.uid, type, target: { kind: "symbol", name } });
const imp = (from: CodeUnit, specifier: string, importedName?: string, localName?: string): RawReference => ({
  fromUid: from.uid, type: "imports", target: { kind: "import", specifier, importedName }, metadata: localName ? { localName } : undefined,
});

/** Resolves "./x", "../x" and "@/x" against the files that exist, trying common extensions. */
const adapter = (files: Set<string>): LanguageAdapter => ({
  language: "typescript",
  extensions: [".ts", ".tsx", ".js"],
  parse: async () => ({ units: [], references: [] }),
  resolveImport: ({ fromPath, specifier, hasFile }) => {
    let base: string | null = null;
    if (specifier.startsWith("@/")) base = `src/${specifier.slice(2)}`;
    else if (specifier.startsWith(".")) {
      const parts = fromPath.split("/").slice(0, -1);
      for (const seg of specifier.split("/")) {
        if (seg === "..") parts.pop();
        else if (seg !== ".") parts.push(seg);
      }
      base = parts.join("/");
    }
    if (!base) return null;
    return ["", ".ts", ".tsx", ".js", "/index.ts"].map((ext) => base + ext).find((p) => hasFile(p) && files.has(p)) ?? null;
  },
});

const link = (units: CodeUnit[], references: RawReference[]): LinkedEdge[] => {
  const files = new Set(units.map((x) => x.path));
  const lang = adapter(files);
  return linkReferences({ repo, units, references, adapterForPath: () => lang, hasFile: (p) => files.has(p) });
};

const find = (edges: LinkedEdge[], from: CodeUnit, type: string) => edges.filter((e) => e.fromUid === from.uid && e.type === type);

// a small frontend + backend, the shape of the sample-mern fixture
const hookFile = fileU("src/hooks/useUsers.ts");
const useUsers = u("src/hooks/useUsers.ts", "useUsers", "hook");
const pageFile = fileU("src/pages/UsersPage.tsx");
const page = u("src/pages/UsersPage.tsx", "UsersPage", "component");
const cardFile = fileU("src/components/UserCard.tsx");
const card = u("src/components/UserCard.tsx", "UserCard", "component");
const ctrlFile = fileU("controllers/userController.js");
const listUsers = u("controllers/userController.js", "listUsers", "function");
const svcFile = fileU("services/userService.js");
const findAll = u("services/userService.js", "findAll", "function");
const helper = u("services/userService.js", "helper", "function", { exported: false });

const units = [hookFile, useUsers, pageFile, page, cardFile, card, ctrlFile, listUsers, svcFile, findAll, helper];

describe("linkReferences — imports", () => {
  it("resolves a named import (via an alias) to the exported unit", () => {
    const edges = link(units, [imp(pageFile, "@/hooks/useUsers", "useUsers")]);
    expect(find(edges, pageFile, "imports")).toEqual([
      { fromUid: pageFile.uid, toUid: useUsers.uid, type: "imports", metadata: { specifier: "@/hooks/useUsers", importedName: "useUsers" } },
    ]);
  });

  it("resolves a default / namespace import to the file unit", () => {
    const edges = link(units, [imp(pageFile, "@/components/UserCard", "default", "UserCard"), imp(ctrlFile, "../services/userService")]);
    expect(find(edges, pageFile, "imports")[0].toUid).toBe(cardFile.uid);
    expect(find(edges, ctrlFile, "imports")[0].toUid).toBe(svcFile.uid);
  });

  it("marks a package as external, using the package root", () => {
    const edges = link(units, [imp(hookFile, "axios"), imp(hookFile, "@tanstack/react-query/build/x"), imp(hookFile, "node:fs")]);
    expect(find(edges, hookFile, "imports").map((e) => e.toExternal)).toEqual(["external:axios", "external:@tanstack/react-query", "external:node:fs"]);
  });

  it("marks a relative or alias import that points at nothing as unresolved, not external", () => {
    const edges = link(units, [imp(hookFile, "./missing"), imp(hookFile, "@/nope/x")]);
    expect(find(edges, hookFile, "imports").map((e) => e.toExternal)).toEqual(["unresolved:./missing", "unresolved:@/nope/x"]);
  });
});

describe("linkReferences — symbols", () => {
  it("resolves a call through an imported module object (userService.findAll)", () => {
    const edges = link(units, [imp(ctrlFile, "../services/userService", undefined, "userService"), sym(listUsers, "userService.findAll")]);
    expect(find(edges, listUsers, "calls")).toEqual([{ fromUid: listUsers.uid, toUid: findAll.uid, type: "calls", metadata: {} }]);
  });

  it("resolves a call to a destructured import", () => {
    const edges = link(units, [imp(ctrlFile, "../services/userService", "findAll"), sym(listUsers, "findAll")]);
    expect(find(edges, listUsers, "calls")[0].toUid).toBe(findAll.uid);
  });

  it("honours the local alias of an import", () => {
    const edges = link(units, [imp(ctrlFile, "../services/userService", "findAll", "getAll"), sym(listUsers, "getAll")]);
    expect(find(edges, listUsers, "calls")[0].toUid).toBe(findAll.uid);
  });

  it("prefers a unit in the same file over anything else", () => {
    const local = u("controllers/userController.js", "findAll", "function");
    const edges = link([...units, local], [sym(listUsers, "findAll")]);
    expect(find(edges, listUsers, "calls")[0].toUid).toBe(local.uid);
  });

  it("falls back to a unique repo-wide name", () => {
    const edges = link(units, [sym(page, "helper")]);
    expect(find(edges, page, "calls")[0].toUid).toBe(helper.uid);
  });

  it("does not guess when the name is ambiguous", () => {
    const other = u("src/other.ts", "findAll", "function");
    const edges = link([...units, other, fileU("src/other.ts")], [sym(page, "findAll")]);
    expect(find(edges, page, "calls")).toEqual([{ fromUid: page.uid, toExternal: "findAll", type: "calls", metadata: {} }]);
  });

  it("records a call into a package as external, remembering the symbol", () => {
    const edges = link(units, [imp(hookFile, "axios", undefined, "axios"), sym(useUsers, "axios.get")]);
    expect(find(edges, useUsers, "calls")).toEqual([
      { fromUid: useUsers.uid, toExternal: "external:axios", type: "calls", metadata: { symbol: "axios.get" } },
    ]);
  });

  it("resolves this.method to a sibling in the same class", () => {
    const cls = u("src/svc.ts", "Svc", "class");
    const a = u("src/svc.ts", "Svc.a", "method", { parentUid: cls.uid });
    const b = u("src/svc.ts", "Svc.b", "method", { parentUid: cls.uid });
    const other = u("src/svc.ts", "Other.b", "method");
    const edges = link([fileU("src/svc.ts"), cls, a, b, other], [sym(a, "this.b")]);
    expect(find(edges, a, "calls")[0].toUid).toBe(b.uid);
  });

  it("uses the reference type to pick the right kind of unit", () => {
    const hookImpl = u("src/hooks/x.ts", "useThing", "hook");
    const fn = u("src/misc.ts", "useThing", "function"); // same name, wrong kind for uses_hook? both allowed; hook is preferred by uniqueness of kind
    const edges = link([...units, hookImpl, fileU("src/hooks/x.ts"), fn, fileU("src/misc.ts")], [sym(page, "useThing", "uses_hook")]);
    // both kinds are valid for uses_hook, so it is ambiguous and must stay unresolved
    expect(find(edges, page, "uses_hook")[0].toUid).toBeUndefined();
    const only = link([...units, hookImpl, fileU("src/hooks/x.ts")], [sym(page, "useThing", "uses_hook")]);
    expect(find(only, page, "uses_hook")[0].toUid).toBe(hookImpl.uid);
  });

  it("links renders and handles_route like calls", () => {
    const route = u("routes/users.js", "route:GET /api/users", "route");
    const edges = link([...units, route, fileU("routes/users.js")], [
      sym(page, "UserCard", "renders"),
      imp(pageFile, "@/components/UserCard", "default", "UserCard"),
      sym(route, "listUsers", "handles_route"),
    ]);
    expect(find(edges, page, "renders")[0].toUid).toBe(card.uid);
    expect(find(edges, route, "handles_route")[0].toUid).toBe(listUsers.uid);
  });

  it("skips self-edges (plain recursion)", () => {
    const edges = link(units, [sym(findAll, "findAll")]);
    expect(find(edges, findAll, "calls")).toEqual([]);
  });

  it("collapses duplicates and counts them", () => {
    const edges = link(units, [sym(page, "helper"), sym(page, "helper"), sym(page, "helper")]);
    const calls = find(edges, page, "calls");
    expect(calls).toHaveLength(1);
    expect(calls[0].metadata.count).toBe(3);
  });

  it("ignores references from unknown units", () => {
    expect(link(units, [{ fromUid: "ghost", type: "calls", target: { kind: "symbol", name: "helper" } }])).toEqual([]);
  });
});

describe("linkReferences — API calls", () => {
  it("stores a frontend call as an unresolved api edge for the bot-wide step to match", () => {
    const edges = link(units, [{ fromUid: useUsers.uid, type: "calls_api", target: { kind: "api", method: "get", path: "/api/users/${id}" } }]);
    expect(edges).toEqual([
      {
        fromUid: useUsers.uid,
        toExternal: "api:GET /api/users/:param",
        type: "calls_api",
        metadata: { method: "GET", path: "/api/users/${id}", normalizedPath: "/api/users/:param" },
      },
    ]);
  });
});
