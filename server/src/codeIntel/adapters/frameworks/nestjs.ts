import { routeQualifiedName, unitUid } from "../../core/ids";
import type { CodeUnit, FrameworkAdapter, ParseResult, RawReference } from "../../core/types";
import { endLineOf, literalText, namedChildren, startLineOf, SyntaxNode } from "../../parse/treesitter";
import { callArguments, dependsOn, HTTP_METHODS, joinRoutePath } from "./shared";

/**
 * NestJS. Routes come from decorators rather than calls: `@Controller("users")`
 * on the class supplies the prefix and `@Get(":id")` on the method the rest, so
 * unlike Express the whole route is visible in one file.
 *
 * The decorated method is the handler, so each route unit links straight to it.
 */

const ROUTE_DECORATORS = new Map(HTTP_METHODS.map((m) => [`${m[0].toUpperCase()}${m.slice(1)}`, m.toUpperCase()]));
const ROLE_DECORATORS = new Set(["Injectable", "Service", "Repository", "Component", "Module", "Catch", "Global"]);

type Decorator = { name: string; args: SyntaxNode[] };

/**
 * Decorators attached to a node, with their call arguments.
 *
 * The grammar puts them *before* what they decorate rather than inside it: a
 * method's decorators are earlier children of the class body, and an exported
 * class's are earlier children of the export statement. So this walks
 * backwards over siblings, and also checks the node's own children for the
 * grammar versions that nest them.
 */
const decoratorsOf = (node: SyntaxNode): Decorator[] => {
  const out: Decorator[] = [];
  const add = (decorator: SyntaxNode) => {
    const inner = namedChildren(decorator)[0];
    if (!inner) return;
    if (inner.type === "call_expression") {
      const name = inner.childForFieldName("function")?.text;
      if (name) out.push({ name, args: callArguments(inner) });
    } else if (inner.type === "identifier") {
      out.push({ name: inner.text, args: [] });
    }
  };

  for (let previous = node.previousNamedSibling; previous?.type === "decorator"; previous = previous.previousNamedSibling) {
    add(previous);
  }
  for (const child of namedChildren(node)) {
    if (child.type === "decorator") add(child);
  }
  return out;
};

export const nestjsAdapter: FrameworkAdapter = {
  name: "nestjs",
  languages: ["typescript"],
  detect: (repo) => dependsOn(repo, "@nestjs/core", "@nestjs/common"),

  enrich: async ({ file, base, tree, repo }): Promise<ParseResult> => {
    const root = (tree as { rootNode?: SyntaxNode } | null)?.rootNode;
    if (!root) return base;

    const units: CodeUnit[] = base.units.map((u) => ({ ...u, metadata: { ...u.metadata } }));
    const references: RawReference[] = [...base.references];
    const unitByQualifiedName = new Map(units.map((u) => [u.qualifiedName, u]));

    const classNodes: SyntaxNode[] = [];
    const collectClasses = (node: SyntaxNode) => {
      for (const child of namedChildren(node)) {
        if (child.type === "class_declaration" || child.type === "abstract_class_declaration") classNodes.push(child);
        else if (child.type === "export_statement") collectClasses(child);
      }
    };
    collectClasses(root);

    for (const classNode of classNodes) {
      const className = classNode.childForFieldName("name")?.text;
      if (!className) continue;
      const decorators = decoratorsOf(classNode);
      const classUnit = unitByQualifiedName.get(className);

      const role = decorators.find((d) => ROLE_DECORATORS.has(d.name));
      if (role && classUnit) classUnit.metadata.nestRole = role.name;

      // Constructor injection: `constructor(private readonly users: UserService) {}`
      const body = classNode.childForFieldName("body");
      if (body && classUnit) {
        const constructor = namedChildren(body).find(
          (m) => m.type === "method_definition" && m.childForFieldName("name")?.text === "constructor",
        );
        const injected: string[] = [];
        for (const parameter of namedChildren(constructor?.childForFieldName("parameters") ?? constructor ?? classNode)) {
          const typeNode = parameter.descendantsOfType?.("type_identifier")?.[0];
          const typeName = typeNode?.text ?? /:\s*([A-Za-z_$][\w$]*)/.exec(parameter.text)?.[1];
          if (!typeName || injected.includes(typeName)) continue;
          injected.push(typeName);
          references.push({ fromUid: classUnit.uid, type: "calls", target: { kind: "symbol", name: typeName }, metadata: { injected: true } });
        }
        if (injected.length > 0) classUnit.metadata.injects = injected;
      }

      const controller = decorators.find((d) => d.name === "Controller");
      if (!controller) continue;
      const prefix = literalText(controller.args[0]) ?? "";
      if (classUnit) classUnit.metadata.nestRole = "Controller";

      if (!body) continue;
      for (const member of namedChildren(body)) {
        if (member.type !== "method_definition") continue;
        const methodName = member.childForFieldName("name")?.text;
        if (!methodName) continue;
        for (const decorator of decoratorsOf(member)) {
          const httpMethod = ROUTE_DECORATORS.get(decorator.name);
          if (!httpMethod) continue;
          const routePath = joinRoutePath(prefix, literalText(decorator.args[0]) ?? "");
          const qualifiedName = routeQualifiedName({ method: httpMethod, path: routePath });
          const uid = unitUid({ repoName: repo.name, path: file.path, qualifiedName });
          units.push({
            uid,
            path: file.path,
            kind: "route",
            name: qualifiedName,
            qualifiedName,
            signature: `${httpMethod} ${routePath}`,
            code: member.text.slice(0, 2000),
            startLine: startLineOf(member),
            endLine: endLineOf(member),
            exported: false,
            metadata: { httpMethod, routePath, framework: "nestjs", controller: className, handler: `${className}.${methodName}` },
          });
          references.push({ fromUid: uid, type: "handles_route", target: { kind: "symbol", name: `${className}.${methodName}` } });
        }
      }
    }

    return { units, references, tree: base.tree };
  },
};
