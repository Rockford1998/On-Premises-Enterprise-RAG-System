import type { RepoContext } from "../../core/types";
import { literalText, namedChildren, SyntaxNode } from "../../parse/treesitter";

/** Helpers shared by the framework adapters. */

type PackageJson = { dependencies?: Record<string, string>; devDependencies?: Record<string, string>; peerDependencies?: Record<string, string> };

/** Is `pkg` a dependency of any package.json in the repository (a monorepo has several)? */
export const dependsOn = (repo: RepoContext, ...packages: string[]): boolean => {
  for (const [manifestPath, manifest] of Object.entries(repo.manifests)) {
    if (!manifestPath.endsWith("package.json") || !manifest || typeof manifest !== "object") continue;
    const pkg = manifest as PackageJson;
    const all = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies };
    if (packages.some((name) => all[name] !== undefined)) return true;
  }
  return false;
};

/** The arguments of a call expression, as nodes. */
export const callArguments = (call: SyntaxNode): SyntaxNode[] => {
  const list = call.childForFieldName("arguments");
  return list ? namedChildren(list) : [];
};

/** `app.get` → { object: "app", property: "get" }; null when the callee is not a member expression. */
export const memberCallee = (call: SyntaxNode): { object: string; property: string } | null => {
  const callee = call.childForFieldName("function");
  if (!callee || callee.type !== "member_expression") return null;
  const object = callee.childForFieldName("object");
  const property = callee.childForFieldName("property");
  if (!object || !property) return null;
  return { object: object.text, property: property.text };
};

/** Join a mount prefix and a route path into one clean path: ("/api/users", "/") → "/api/users". */
export const joinRoutePath = (prefix: string, suffix: string): string => {
  const clean = (part: string) => part.trim().replace(/^\/+|\/+$/g, "");
  const joined = [clean(prefix), clean(suffix)].filter(Boolean).join("/");
  return `/${joined}`;
};

/** The name a function-valued node is known by, for a `handles_route` reference. */
export const handlerName = (node: SyntaxNode): string | null => {
  if (node.type === "identifier") return node.text;
  if (node.type === "member_expression") {
    const object = node.childForFieldName("object")?.text;
    const property = node.childForFieldName("property")?.text;
    return object && property ? `${object}.${property}` : null;
  }
  return null;
};

export const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "options", "head", "all"] as const;

/**
 * The URL a node describes, for a request path.
 *
 * Beyond a plain literal this understands concatenation — `"/orders/" + id`
 * becomes `/orders/${}`, which the API matcher already treats as a wildcard —
 * so a path built at runtime still links to its route.
 */
export const apiPathOf = (node: SyntaxNode | null | undefined): string | null => {
  if (!node) return null;
  const literal = literalText(node);
  if (literal !== null) return literal;
  if (node.type === "binary_expression") {
    const operator = node.childForFieldName("operator")?.text;
    if (operator !== "+") return null;
    const left = node.childForFieldName("left");
    const right = node.childForFieldName("right");
    const part = (side: SyntaxNode | null) => {
      if (!side) return "";
      const text = apiPathOf(side);
      // An unknown sub-expression becomes a wildcard rather than being guessed at.
      return text ?? "${}";
    };
    const joined = `${part(left)}${part(right)}`;
    return joined.replace(/^\$\{\}$/, "") || null;
  }
  return null;
};

/**
 * The unit a node sits inside — the innermost one, so a call in a method is
 * attributed to the method rather than to its class. Falls back to the file
 * unit so a reference is never lost.
 */
export const enclosingUnit = <T extends { kind: string; startLine: number; endLine: number }>(
  units: T[],
  node: SyntaxNode,
): T | null => {
  const line = node.startPosition.row + 1;
  let best: T | null = null;
  for (const unit of units) {
    if (unit.kind === "file" || line < unit.startLine || line > unit.endLine) continue;
    if (!best || unit.endLine - unit.startLine < best.endLine - best.startLine) best = unit;
  }
  return best ?? units.find((u) => u.kind === "file") ?? null;
};
