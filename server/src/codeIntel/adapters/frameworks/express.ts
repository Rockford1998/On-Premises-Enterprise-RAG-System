import { routeQualifiedName, unitUid } from "../../core/ids";
import type { CodeUnit, FrameworkAdapter, ParseResult, RawReference } from "../../core/types";
import { literalText, namedChildren, startLineOf, endLineOf, SyntaxNode, walk } from "../../parse/treesitter";
import { callArguments, dependsOn, handlerName, HTTP_METHODS, joinRoutePath, memberCallee } from "./shared";

/**
 * Express routes.
 *
 * The hard part is the mount prefix: `router.get("/:id")` in routes/users.js
 * is only `GET /api/users/:id` because server.js says
 * `app.use("/api/users", usersRouter)`. The prefix therefore lives in a
 * different file from the route.
 *
 * This runs per file, so it does two things:
 *   - records the mounts it sees, keyed by the file the router came from, in a
 *     module-level table (`mountsByFile`);
 *   - reads that table for the file it is currently enriching.
 *
 * Files are enriched in the pipeline's order, so a route file parsed before
 * its mounting file gets no prefix on the first pass. `indexRepository` calls
 * `resetMounts()` at the start of a run and enriches in two passes, so the
 * second pass always sees every mount.
 */

type Mount = { prefix: string; sourceFile: string };

/** Mount prefixes that apply to a file's routers, keyed by repo-relative path. */
const mountsByFile = new Map<string, Mount[]>();

export const resetMounts = (): void => mountsByFile.clear();

/** What `app.use(...)`/`router.use(...)` mounts, recorded for the file the router lives in. */
export const recordMounts = ({
  file,
  tree,
  resolveImport,
}: {
  file: { path: string };
  tree: unknown;
  /** Resolve a module specifier from this file to a repo-relative path. */
  resolveImport: (specifier: string) => string | null;
}): void => {
  const root = (tree as { rootNode?: SyntaxNode } | null)?.rootNode;
  if (!root) return;

  // Which local name came from which module: `const usersRouter = require("./routes/users")`.
  const moduleOfLocal = new Map<string, string>();
  walk(root, (node) => {
    if (node.type === "variable_declarator") {
      const name = node.childForFieldName("name");
      const value = node.childForFieldName("value");
      if (name?.type === "identifier" && value?.type === "call_expression" && value.childForFieldName("function")?.text === "require") {
        const specifier = literalText(callArguments(value)[0]);
        if (specifier) moduleOfLocal.set(name.text, specifier);
      }
      return;
    }
    if (node.type === "import_statement") {
      const specifier = literalText(node.childForFieldName("source"));
      const clause = namedChildren(node).find((c) => c.type === "import_clause");
      if (!specifier || !clause) return false;
      for (const part of namedChildren(clause)) {
        if (part.type === "identifier") moduleOfLocal.set(part.text, specifier);
      }
      return false;
    }
    return;
  });

  walk(root, (node) => {
    if (node.type !== "call_expression") return;
    const callee = memberCallee(node);
    if (!callee || callee.property !== "use") return;
    const args = callArguments(node);
    const prefix = literalText(args[0]);
    if (prefix === null || !prefix.startsWith("/")) return; // app.use(express.json()) and friends
    for (const argument of args.slice(1)) {
      if (argument.type !== "identifier") continue;
      const specifier = moduleOfLocal.get(argument.text);
      if (!specifier) continue;
      const target = resolveImport(specifier);
      if (!target) continue;
      const list = mountsByFile.get(target) ?? [];
      list.push({ prefix, sourceFile: file.path });
      mountsByFile.set(target, list);
    }
  });
};

export const expressAdapter: FrameworkAdapter = {
  name: "express",
  languages: ["typescript"],
  detect: (repo) => dependsOn(repo, "express"),

  enrich: async ({ file, base, tree, repo }): Promise<ParseResult> => {
    const root = (tree as { rootNode?: SyntaxNode } | null)?.rootNode;
    if (!root) return base;

    const units: CodeUnit[] = [...base.units];
    const references: RawReference[] = [...base.references];
    const prefixes = (mountsByFile.get(file.path) ?? []).map((m) => m.prefix);
    // A router with no recorded mount is reachable at its own path.
    const effectivePrefixes = prefixes.length > 0 ? prefixes : [""];
    const seen = new Set<string>();

    walk(root, (node) => {
      if (node.type !== "call_expression") return;
      const callee = memberCallee(node);
      if (!callee) return;
      const method = callee.property.toLowerCase();
      if (!HTTP_METHODS.includes(method as (typeof HTTP_METHODS)[number])) return;
      // `app`, `router`, `apiRouter`… but not `axios.get` or `this.http.get`.
      if (!/^(app|router|api|server)[A-Za-z0-9_]*$/i.test(callee.object)) return;

      const args = callArguments(node);
      const routePath = literalText(args[0]);
      if (routePath === null || !routePath.startsWith("/")) return;

      const handlers = args.slice(1);
      if (handlers.length === 0) return;

      for (const prefix of effectivePrefixes) {
        const fullPath = joinRoutePath(prefix, routePath);
        const httpMethod = method.toUpperCase();
        const qualifiedName = routeQualifiedName({ method: httpMethod, path: fullPath });
        if (seen.has(qualifiedName)) continue;
        seen.add(qualifiedName);

        const uid = unitUid({ repoName: repo.name, path: file.path, qualifiedName });
        const middleware = handlers.slice(0, -1).map((h) => handlerName(h)).filter((n): n is string => Boolean(n));
        units.push({
          uid,
          path: file.path,
          kind: "route",
          name: qualifiedName,
          qualifiedName,
          signature: `${httpMethod} ${fullPath}`,
          code: node.text.slice(0, 2000),
          startLine: startLineOf(node),
          endLine: endLineOf(node),
          exported: false,
          metadata: {
            httpMethod,
            routePath: fullPath,
            framework: "express",
            ...(middleware.length > 0 ? { middleware } : {}),
            ...(prefix ? { mountPrefix: prefix } : {}),
          },
        });

        // The last argument is the handler; earlier ones are middleware.
        const last = handlers[handlers.length - 1];
        const name = handlerName(last);
        if (name) {
          references.push({ fromUid: uid, type: "handles_route", target: { kind: "symbol", name } });
        } else if (last.type === "arrow_function" || last.type === "function_expression") {
          // An inline handler has nothing to link to — the route unit's own code
          // is the handler — so record the fact instead of a dangling edge, and
          // attribute the calls it makes to the route.
          units[units.length - 1].metadata.inlineHandler = true;
          walk(last, (inner) => {
            if (inner.type !== "call_expression") return;
            const innerCallee = inner.childForFieldName("function");
            const innerName = innerCallee ? handlerName(innerCallee) : null;
            if (innerName && !/^(res|req|next)\b/.test(innerName)) {
              references.push({ fromUid: uid, type: "calls", target: { kind: "symbol", name: innerName } });
            }
          });
        }
        for (const name of middleware) {
          references.push({ fromUid: uid, type: "calls", target: { kind: "symbol", name }, metadata: { middleware: true } });
        }
      }
    });

    return { units, references, tree: base.tree };
  },
};
