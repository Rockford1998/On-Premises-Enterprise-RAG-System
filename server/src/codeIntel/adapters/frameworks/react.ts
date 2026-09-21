import type { CodeUnit, FrameworkAdapter, ParseResult, RawReference } from "../../core/types";
import { literalText, namedChildren, SyntaxNode, walk } from "../../parse/treesitter";
import { apiPathOf, callArguments, dependsOn, enclosingUnit, memberCallee } from "./shared";

/**
 * React: components, hooks, what renders what, which client route shows which
 * page, and which backend endpoints the frontend calls.
 *
 * The `calls_api` references are half of the cross-layer link — the linker
 * stores them unresolved and `linkApiCalls` matches them to backend route
 * units afterwards, which is what lets a question about a page reach the
 * service behind it.
 */

const JSX_ELEMENTS = new Set(["jsx_element", "jsx_self_closing_element", "jsx_fragment"]);
const HOOK_NAME = /^use[A-Z]/;
const COMPONENT_NAME = /^[A-Z]/;

/**
 * Which client route shows which component.
 *
 * The routes are declared in one file (`App.tsx`) and the components live in
 * others, so this is filled during the pipeline's first pass — the same
 * two-pass arrangement Express mounts need — and read during enrichment.
 *
 * Keys are `<file>#<component>` when the import could be resolved, and the
 * bare component name otherwise.
 */
const clientRoutes = new Map<string, string>();

export const resetClientRoutes = (): void => clientRoutes.clear();

/** `<UserCard/>` is a component; `<div/>` is not. A dotted tag (`<Icons.Star/>`) counts by its last part. */
const componentTagName = (element: SyntaxNode): string | null => {
  const opening = element.type === "jsx_self_closing_element" ? element : namedChildren(element).find((c) => c.type === "jsx_opening_element");
  const name = opening?.childForFieldName("name");
  if (!name) return null;
  if (name.type === "identifier" || name.type === "jsx_identifier") {
    return COMPONENT_NAME.test(name.text) ? name.text : null;
  }
  if (name.type === "member_expression" || name.type === "nested_identifier" || name.type === "jsx_namespace_name") {
    const text = name.text;
    const last = text.split(".").pop() ?? "";
    return COMPONENT_NAME.test(last) ? text : null;
  }
  return null;
};

/** Does this subtree produce JSX? That is what makes a capitalised function a component. */
const containsJsx = (node: SyntaxNode): boolean => {
  let found = false;
  walk(node, (child) => {
    if (found) return false;
    if (JSX_ELEMENTS.has(child.type)) {
      found = true;
      return false;
    }
    return;
  });
  return found;
};

/** The node holding a unit's body, found by line range (units come from the language adapter, not the tree). */
const nodeForUnit = (root: SyntaxNode, unit: CodeUnit): SyntaxNode | null => {
  let best: SyntaxNode | null = null;
  walk(root, (node) => {
    const start = node.startPosition.row + 1;
    const end = node.endPosition.row + 1;
    if (start > unit.endLine || end < unit.startLine) return false;
    if (start === unit.startLine && end === unit.endLine) {
      if (!best) best = node;
    }
    return;
  });
  return best;
};

/** The component named inside a `element={<X/>}` / `Component: X` value. */
const componentInValue = (value: SyntaxNode): string | null => {
  let found: string | null = null;
  walk(value, (inner) => {
    if (found) return false;
    if (JSX_ELEMENTS.has(inner.type)) {
      found = componentTagName(inner);
      return false;
    }
    if (inner.type === "identifier" && COMPONENT_NAME.test(inner.text)) found = inner.text;
    return;
  });
  return found;
};

/** Find every `<Route path element>` and `{ path, element }` pair in a tree. */
const scanClientRoutes = (root: SyntaxNode, onRoute: (component: string, routePath: string) => void): void => {
  walk(root, (node) => {
    if (JSX_ELEMENTS.has(node.type) && componentTagName(node) === "Route") {
      const opening = node.type === "jsx_self_closing_element" ? node : namedChildren(node).find((c) => c.type === "jsx_opening_element");
      let routePath: string | null = null;
      let component: string | null = null;
      for (const attribute of namedChildren(opening ?? node)) {
        if (attribute.type !== "jsx_attribute") continue;
        const key = namedChildren(attribute)[0]?.text;
        const valueNode = namedChildren(attribute)[1];
        if (!valueNode) continue;
        if (key === "path") routePath = literalText(valueNode) ?? valueNode.text.replace(/^["'{}]+|["'{}]+$/g, "");
        if (key === "element" || key === "component") component ??= componentInValue(valueNode);
      }
      if (routePath && component) onRoute(component, routePath);
      return;
    }
    // createBrowserRouter([{ path: "/users", element: <UsersPage/> }])
    if (node.type === "object") {
      let routePath: string | null = null;
      let component: string | null = null;
      for (const property of namedChildren(node)) {
        const key = property.childForFieldName("key")?.text;
        const value = property.childForFieldName("value");
        if (!value) continue;
        if (key === "path") routePath = literalText(value);
        if (key === "element" || key === "Component" || key === "component") component ??= componentInValue(value);
      }
      if (routePath && component) onRoute(component, routePath);
    }
    return;
  });
};

/**
 * Pass 1 of the pipeline: record which component each client route shows, so
 * enrichment can tag a component declared in a different file from its route.
 */
export const recordClientRoutes = ({
  file,
  tree,
  resolveImport,
}: {
  file: { path: string };
  tree: unknown;
  resolveImport: (specifier: string) => string | null;
}): void => {
  const root = (tree as { rootNode?: SyntaxNode } | null)?.rootNode;
  if (!root) return;

  // Where each imported component comes from, so a route can be tied to one file.
  const sourceOfLocal = new Map<string, string>();
  walk(root, (node) => {
    if (node.type !== "import_statement") return;
    const specifier = literalText(node.childForFieldName("source"));
    const clause = namedChildren(node).find((c) => c.type === "import_clause");
    if (!specifier || !clause) return false;
    const target = resolveImport(specifier);
    if (!target) return false;
    for (const part of namedChildren(clause)) {
      if (part.type === "identifier") sourceOfLocal.set(part.text, target);
      else if (part.type === "named_imports") {
        for (const spec of namedChildren(part)) {
          const local = spec.childForFieldName("alias")?.text ?? spec.childForFieldName("name")?.text;
          if (local) sourceOfLocal.set(local, target);
        }
      }
    }
    return false;
  });

  scanClientRoutes(root, (component, routePath) => {
    const source = sourceOfLocal.get(component);
    if (source) clientRoutes.set(`${source}#${component}`, routePath);
    // Also keyed by bare name, for a component defined in this same file.
    clientRoutes.set(`${file.path}#${component}`, routePath);
    if (!clientRoutes.has(component)) clientRoutes.set(component, routePath);
  });
};

type ApiCall = { method: string; path: string };

/** `fetch("/api/users", { method: "POST" })` → POST /api/users. */
const fetchCall = (call: SyntaxNode): ApiCall | null => {
  const callee = call.childForFieldName("function");
  if (!callee || callee.text !== "fetch") return null;
  const args = callArguments(call);
  const path = apiPathOf(args[0]);
  if (!path) return null;
  let method = "GET";
  const options = args[1];
  if (options?.type === "object") {
    for (const property of namedChildren(options)) {
      if (property.childForFieldName("key")?.text !== "method") continue;
      const value = literalText(property.childForFieldName("value"));
      if (value) method = value.toUpperCase();
    }
  }
  return { method, path };
};

/** `axios({ url, method })` — the object form. */
const axiosObjectCall = (call: SyntaxNode, instances: Set<string>): ApiCall | null => {
  const callee = call.childForFieldName("function");
  if (!callee || (callee.text !== "axios" && !instances.has(callee.text))) return null;
  const options = callArguments(call)[0];
  if (options?.type !== "object") return null;
  let path: string | null = null;
  let method = "GET";
  for (const property of namedChildren(options)) {
    const key = property.childForFieldName("key")?.text;
    const value = literalText(property.childForFieldName("value"));
    if (key === "url" && value) path = value;
    if (key === "method" && value) method = value.toUpperCase();
  }
  return path ? { method, path } : null;
};

export const reactAdapter: FrameworkAdapter = {
  name: "react",
  languages: ["typescript"],
  detect: (repo) => dependsOn(repo, "react", "react-dom", "next"),

  enrich: async ({ file, base, tree }): Promise<ParseResult> => {
    const root = (tree as { rootNode?: SyntaxNode } | null)?.rootNode;
    if (!root) return base;

    const units = base.units.map((u) => ({ ...u, metadata: { ...u.metadata } }));
    const references: RawReference[] = [...base.references];

    // ---- axios instances: `const api = axios.create({ baseURL: "/api" })` ----
    const instanceBaseUrl = new Map<string, string>();
    walk(root, (node) => {
      if (node.type !== "variable_declarator") return;
      const name = node.childForFieldName("name");
      const value = node.childForFieldName("value");
      if (name?.type !== "identifier" || value?.type !== "call_expression") return;
      const callee = memberCallee(value);
      if (!callee || callee.object !== "axios" || callee.property !== "create") return;
      let baseUrl = "";
      const options = callArguments(value)[0];
      if (options?.type === "object") {
        for (const property of namedChildren(options)) {
          if (property.childForFieldName("key")?.text !== "baseURL") continue;
          baseUrl = literalText(property.childForFieldName("value")) ?? "";
        }
      }
      instanceBaseUrl.set(name.text, baseUrl);
    });

    // ---- re-classify units, and record props / client routes ----
    // Routes declared in this file are recorded too, so a router that sits
    // beside its components still works without the cross-file pass.
    scanClientRoutes(root, (component, routePath) => clientRoutes.set(component, routePath));

    for (const unit of units) {
      if (unit.kind !== "function" && unit.kind !== "method") continue;
      const node = nodeForUnit(root, unit);

      if (HOOK_NAME.test(unit.name)) {
        unit.kind = "hook";
      } else if (COMPONENT_NAME.test(unit.name) && node && containsJsx(node)) {
        unit.kind = "component";
        // A component's props type is usually its first parameter's type.
        const propsType = /:\s*([A-Za-z_$][\w$]*)(?:\s*[),])/.exec(unit.signature ?? "")?.[1];
        if (propsType) unit.metadata.props = propsType;
      } else if (COMPONENT_NAME.test(unit.name) && /React\.FC|FunctionComponent/.test(unit.signature ?? "")) {
        unit.kind = "component";
      }
      // Prefer the route recorded against this exact file; fall back to the name.
      const clientRoute = clientRoutes.get(`${file.path}#${unit.name}`) ?? clientRoutes.get(unit.name);
      if (clientRoute) unit.metadata.clientRoute = clientRoute;
    }

    // ---- references: renders, uses_hook, calls_api ----
    const attribute = (node: SyntaxNode): string | null => enclosingUnit(units, node)?.uid ?? null;

    walk(root, (node) => {
      if (JSX_ELEMENTS.has(node.type)) {
        const tag = componentTagName(node);
        const fromUid = attribute(node);
        if (tag && fromUid && tag !== "Route") {
          references.push({ fromUid, type: "renders", target: { kind: "symbol", name: tag } });
        }
        return;
      }
      if (node.type !== "call_expression") return;

      const fromUid = attribute(node);
      if (!fromUid) return;

      // useSomething()
      const callee = node.childForFieldName("function");
      if (callee?.type === "identifier" && HOOK_NAME.test(callee.text)) {
        references.push({ fromUid, type: "uses_hook", target: { kind: "symbol", name: callee.text } });
        return;
      }

      const asFetch = fetchCall(node);
      if (asFetch) {
        references.push({ fromUid, type: "calls_api", target: { kind: "api", ...asFetch }, metadata: { via: "fetch" } });
        return;
      }
      const asAxiosObject = axiosObjectCall(node, new Set(instanceBaseUrl.keys()));
      if (asAxiosObject) {
        references.push({ fromUid, type: "calls_api", target: { kind: "api", ...asAxiosObject }, metadata: { via: "axios" } });
        return;
      }

      // axios.get("/api/users") / api.post("/users")
      const member = memberCallee(node);
      if (!member) return;
      const method = member.property.toLowerCase();
      if (!["get", "post", "put", "patch", "delete", "head", "options"].includes(method)) return;
      const isAxios = member.object === "axios";
      const baseUrl = instanceBaseUrl.get(member.object);
      if (!isAxios && baseUrl === undefined) return;
      const path = apiPathOf(callArguments(node)[0]);
      if (!path) return;
      references.push({
        fromUid,
        type: "calls_api",
        target: { kind: "api", method: method.toUpperCase(), path: `${baseUrl ?? ""}${path}` },
        metadata: { via: isAxios ? "axios" : `axios:${member.object}` },
      });
    });

    return { units, references, tree: base.tree };
  },
};

