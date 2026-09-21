import path from "path";
import { fileUid, unitUid } from "../../core/ids";
import type { CodeUnit, FileRecord, LanguageAdapter, ParseResult, RawReference, RepoContext, UnitKind } from "../../core/types";
import {
  disposeTree, endLineOf, fieldText, grammarForPath, literalText, namedChildren, parseSource,
  startLineOf, SyntaxNode, walk,
} from "../../parse/treesitter";

/**
 * TypeScript / JavaScript, including JSX. Produces language-level facts only —
 * declarations, imports, calls, inheritance. Framework meaning (routes,
 * components, hooks, API calls) is added by the framework adapters, which read
 * the same tree.
 */

const EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];

/**
 * Callees that say nothing about this codebase. Without this filter every unit
 * gains edges to console.log and JSON.stringify, which crowd out the real ones.
 */
const IGNORED_CALLEES = new Set([
  "console", "JSON", "Math", "Object", "Array", "String", "Number", "Boolean", "Symbol",
  "Promise", "Date", "RegExp", "Error", "TypeError", "Map", "Set", "WeakMap", "WeakSet",
  "parseInt", "parseFloat", "isNaN", "isFinite", "encodeURIComponent", "decodeURIComponent",
  "setTimeout", "setInterval", "clearTimeout", "clearInterval", "queueMicrotask",
  "require", "process", "Buffer", "structuredClone", "super",
]);

const FUNCTION_VALUE_TYPES = new Set(["arrow_function", "function_expression", "function", "generator_function"]);

/** Dotted name of a callee: `foo`, `obj.method`, `a.b.c`; null when it is computed (`arr[i]()`). */
const calleeName = (node: SyntaxNode): string | null => {
  switch (node.type) {
    case "identifier":
    case "shorthand_property_identifier":
    case "property_identifier":
      return node.text;
    case "this":
      return "this";
    case "member_expression": {
      const object = node.childForFieldName("object");
      const property = node.childForFieldName("property");
      if (!object || !property || property.type !== "property_identifier") return null;
      const head = calleeName(object);
      return head ? `${head}.${property.text}` : null;
    }
    // `foo?.bar()` and `(await x).y()` — look through the wrapper.
    case "parenthesized_expression":
    case "non_null_expression":
      return namedChildren(node)[0] ? calleeName(namedChildren(node)[0]) : null;
    default:
      return null;
  }
};

/** A JSDoc block immediately above the declaration, cleaned of its comment markers. */
const docstringFor = (node: SyntaxNode): string | undefined => {
  const previous = node.previousNamedSibling;
  if (!previous || previous.type !== "comment") return undefined;
  const text = previous.text;
  if (!text.startsWith("/**")) return undefined;
  // Only when it sits directly above, not separated by blank lines.
  if (startLineOf(node) - endLineOf(previous) > 1) return undefined;
  const cleaned = text
    .replace(/^\/\*\*+/, "")
    .replace(/\*+\/$/, "")
    .split("\n")
    .map((line) => line.replace(/^\s*\*/, "").trim())
    .join("\n")
    .trim();
  return cleaned || undefined;
};

/** The declaration line(s) up to (but not including) the body. */
const signatureOf = (node: SyntaxNode): string | undefined => {
  const body = node.childForFieldName("body");
  const text = body ? node.text.slice(0, body.startIndex - node.startIndex) : node.text;
  const signature = text.trim().replace(/\s*[{=]$/, "").replace(/\s+/g, " ").trim();
  return signature ? signature.slice(0, 400) : undefined;
};

/**
 * A class unit's body is condensed to field and method signatures: the methods
 * are units of their own, so repeating their bodies here would embed the same
 * code twice and crowd out other results.
 */
const condensedClassCode = (node: SyntaxNode): string => {
  const body = node.childForFieldName("body");
  if (!body) return node.text;
  const header = node.text.slice(0, body.startIndex - node.startIndex).trim();
  const members = namedChildren(body)
    .map((member) => {
      if (member.type === "method_definition") return `  ${signatureOf(member)} { … }`;
      if (member.type === "public_field_definition" || member.type === "property_signature" || member.type === "field_definition") {
        const line = member.text.split("\n")[0].trim();
        return `  ${line.endsWith(";") ? line : `${line};`}`;
      }
      return null;
    })
    .filter((line): line is string => Boolean(line));
  return `${header} {\n${members.join("\n")}\n}`;
};

type Collected = { units: CodeUnit[]; references: RawReference[] };

/** Names a file exports through `export { … }`, `module.exports` or `exports.x`. */
const collectExportedNames = (root: SyntaxNode): Set<string> => {
  const names = new Set<string>();
  walk(root, (node) => {
    if (node.type === "export_statement") {
      for (const child of namedChildren(node)) {
        if (child.type !== "export_clause") continue;
        for (const specifier of namedChildren(child)) {
          const local = specifier.childForFieldName("name")?.text;
          if (local) names.add(local);
        }
      }
      return;
    }
    if (node.type !== "assignment_expression") return;
    const left = node.childForFieldName("left");
    const right = node.childForFieldName("right");
    if (!left) return;
    const target = calleeName(left);
    if (target === "module.exports" || target === "exports") {
      // module.exports = { a, b } / module.exports = foo
      if (right?.type === "object") {
        for (const property of namedChildren(right)) {
          const name =
            property.type === "shorthand_property_identifier" ? property.text : property.childForFieldName("key")?.text;
          if (name) names.add(name);
        }
      } else if (right) {
        const name = calleeName(right);
        if (name) names.add(name);
      }
      return;
    }
    // module.exports.foo = … / exports.foo = …
    if (target?.startsWith("module.exports.") || target?.startsWith("exports.")) {
      names.add(target.slice(target.lastIndexOf(".") + 1));
    }
  });
  return names;
};

export const typescriptAdapter: LanguageAdapter = {
  language: "typescript",
  extensions: EXTENSIONS,

  parse: async ({ file, repo }): Promise<ParseResult> => {
    const grammar = grammarForPath(file.path);
    if (!grammar) return { units: [], references: [] };
    const tree = await parseSource({ content: file.content, grammar });

    try {
      const root = tree.rootNode;
      const collected: Collected = { units: [], references: [] };
      const uidOf = (qualifiedName: string) => unitUid({ repoName: repo.name, path: file.path, qualifiedName });
      const fileUnitUid = fileUid({ repoName: repo.name, path: file.path });
      const exportedNames = collectExportedNames(root);

      const addUnit = ({
        node,
        kind,
        name,
        qualifiedName,
        exported,
        parentUid,
        code,
        docNode,
      }: {
        node: SyntaxNode;
        kind: UnitKind;
        name: string;
        qualifiedName: string;
        exported: boolean;
        parentUid?: string;
        code?: string;
        /**
         * The outermost node this declaration belongs to — the `export`
         * statement, when there is one. A doc comment sits above it, and its
         * text is what gets stored, so the stored code keeps the `export`
         * keyword and still matches the reported line range.
         */
        docNode?: SyntaxNode;
      }): CodeUnit => {
        // Only when the wrapper holds this declaration alone; `export const a = …, b = …`
        // would otherwise store the whole statement twice.
        const outer = docNode && docNode.type === "export_statement" && namedChildren(node).filter((c) => c.type === "variable_declarator").length <= 1
          ? docNode
          : node;
        const unit: CodeUnit = {
          uid: uidOf(qualifiedName),
          path: file.path,
          parentUid,
          kind,
          name,
          qualifiedName,
          signature: signatureOf(node),
          code: code ?? outer.text,
          startLine: startLineOf(outer),
          endLine: endLineOf(outer),
          docstring: docstringFor(docNode ?? node),
          exported,
          metadata: {},
        };
        collected.units.push(unit);
        return unit;
      };

      /** Calls made inside a unit's body, attributed to that unit. */
      const collectCalls = (bodyNode: SyntaxNode, fromUid: string): void => {
        walk(bodyNode, (node) => {
          if (node.type !== "call_expression" && node.type !== "new_expression") return;
          const callee = node.childForFieldName("function") ?? node.childForFieldName("constructor");
          if (!callee) return;
          const name = calleeName(callee);
          if (!name) return;
          const head = name.split(".")[0];
          if (IGNORED_CALLEES.has(head) || IGNORED_CALLEES.has(name)) return;
          collected.references.push({ fromUid, type: "calls", target: { kind: "symbol", name } });
        });
      };

      const collectHeritage = (node: SyntaxNode, fromUid: string): void => {
        for (const child of namedChildren(node)) {
          if (child.type === "class_heritage") {
            for (const clause of namedChildren(child)) {
              const type = clause.type === "implements_clause" ? "implements" : "extends";
              for (const target of namedChildren(clause)) {
                const name = calleeName(target) ?? target.text;
                if (name) collected.references.push({ fromUid, type, target: { kind: "symbol", name } });
              }
            }
          } else if (child.type === "extends_type_clause" || child.type === "extends_clause") {
            for (const target of namedChildren(child)) {
              const name = calleeName(target) ?? target.text;
              if (name) collected.references.push({ fromUid, type: "extends", target: { kind: "symbol", name } });
            }
          }
        }
      };

      const addClass = (node: SyntaxNode, name: string, exported: boolean, docNode: SyntaxNode): void => {
        const classUnit = addUnit({
          node, kind: "class", name, qualifiedName: name, exported, code: condensedClassCode(node), docNode,
        });
        collectHeritage(node, classUnit.uid);
        const body = node.childForFieldName("body");
        if (!body) return;
        for (const member of namedChildren(body)) {
          const isMethod = member.type === "method_definition";
          const value = member.childForFieldName("value");
          const isFieldFunction =
            (member.type === "public_field_definition" || member.type === "field_definition") &&
            value && FUNCTION_VALUE_TYPES.has(value.type);
          if (!isMethod && !isFieldFunction) continue;
          const memberName = fieldText(member, "name");
          if (!memberName) continue;
          const method = addUnit({
            node: member, kind: "method", name: memberName, qualifiedName: `${name}.${memberName}`,
            exported, parentUid: classUnit.uid, docNode: member,
          });
          const memberBody = (isMethod ? member.childForFieldName("body") : value) ?? member;
          collectCalls(memberBody, method.uid);
        }
      };

      /** One top-level declaration. `exported` comes from an enclosing `export`. */
      const addDeclaration = (node: SyntaxNode, exported: boolean, docNode: SyntaxNode): void => {
        switch (node.type) {
          case "function_declaration":
          case "generator_function_declaration": {
            const name = fieldText(node, "name");
            if (!name) return;
            const unit = addUnit({ node, kind: "function", name, qualifiedName: name, exported: exported || exportedNames.has(name), docNode });
            const body = node.childForFieldName("body");
            if (body) collectCalls(body, unit.uid);
            return;
          }
          case "class_declaration":
          case "abstract_class_declaration": {
            const name = fieldText(node, "name");
            if (name) addClass(node, name, exported || exportedNames.has(name), docNode);
            return;
          }
          case "interface_declaration": {
            const name = fieldText(node, "name");
            if (!name) return;
            const unit = addUnit({ node, kind: "interface", name, qualifiedName: name, exported: exported || exportedNames.has(name), docNode });
            collectHeritage(node, unit.uid);
            return;
          }
          case "type_alias_declaration":
          case "enum_declaration": {
            const name = fieldText(node, "name");
            if (!name) return;
            // Enums and type aliases are both "type" units: they describe shapes, not behaviour.
            addUnit({ node, kind: "type", name, qualifiedName: name, exported: exported || exportedNames.has(name), docNode });
            return;
          }
          case "lexical_declaration":
          case "variable_declaration": {
            for (const declarator of namedChildren(node)) {
              if (declarator.type !== "variable_declarator") continue;
              const name = fieldText(declarator, "name");
              const value = declarator.childForFieldName("value");
              if (!name || !value) continue;
              // Only function-valued declarations become units; plain constants do not.
              if (!FUNCTION_VALUE_TYPES.has(value.type)) continue;
              const unit = addUnit({
                node, kind: "function", name, qualifiedName: name,
                exported: exported || exportedNames.has(name), docNode,
              });
              const body = value.childForFieldName("body") ?? value;
              collectCalls(body, unit.uid);
            }
            return;
          }
          default:
        }
      };

      // ---- imports (attributed to the file unit) ----
      const addImport = (specifier: string, importedName?: string, localName?: string): void => {
        collected.references.push({
          fromUid: fileUnitUid,
          type: "imports",
          target: { kind: "import", specifier, importedName },
          ...(localName ? { metadata: { localName } } : {}),
        });
      };

      walk(root, (node) => {
        if (node.type === "import_statement") {
          const specifier = literalText(node.childForFieldName("source"));
          if (!specifier) return false;
          const clause = namedChildren(node).find((c) => c.type === "import_clause");
          if (!clause) {
            addImport(specifier); // side-effect import: import "./styles.css"
            return false;
          }
          for (const part of namedChildren(clause)) {
            if (part.type === "identifier") addImport(specifier, "default", part.text);
            else if (part.type === "namespace_import") {
              const alias = namedChildren(part).find((c) => c.type === "identifier");
              addImport(specifier, "*", alias?.text);
            } else if (part.type === "named_imports") {
              for (const spec of namedChildren(part)) {
                const imported = fieldText(spec, "name");
                const alias = fieldText(spec, "alias");
                if (imported) addImport(specifier, imported, alias ?? imported);
              }
            }
          }
          return false;
        }

        // CommonJS: const x = require("y") / const { a, b: c } = require("y")
        if (node.type === "variable_declarator") {
          const value = node.childForFieldName("value");
          if (!value || value.type !== "call_expression") return;
          if (value.childForFieldName("function")?.text !== "require") return;
          const argument = namedChildren(value.childForFieldName("arguments") ?? value)[0];
          const specifier = literalText(argument);
          if (!specifier) return;
          const name = node.childForFieldName("name");
          if (!name) return;
          if (name.type === "identifier") addImport(specifier, undefined, name.text);
          else if (name.type === "object_pattern") {
            for (const property of namedChildren(name)) {
              if (property.type === "shorthand_property_identifier_pattern" || property.type === "shorthand_property_identifier") {
                addImport(specifier, property.text, property.text);
              } else if (property.type === "pair_pattern") {
                const key = fieldText(property, "key");
                const bound = fieldText(property, "value");
                if (key) addImport(specifier, key, bound ?? key);
              }
            }
          }
          return;
        }
        return;
      });

      // ---- top-level declarations ----
      for (const statement of namedChildren(root)) {
        if (statement.type === "export_statement") {
          const declaration = statement.childForFieldName("declaration");
          if (declaration) {
            addDeclaration(declaration, true, statement);
            continue;
          }
          // export default <function|class|identifier>
          const value = statement.childForFieldName("value");
          if (value && (value.type === "function_declaration" || value.type === "function_expression" || value.type === "arrow_function")) {
            const name = fieldText(value, "name") ?? defaultExportName(file.path);
            const unit = addUnit({ node: value, kind: "function", name, qualifiedName: name, exported: true, docNode: statement });
            const body = value.childForFieldName("body");
            if (body) collectCalls(body, unit.uid);
          } else if (value && (value.type === "class_declaration" || value.type === "class")) {
            addClass(value, fieldText(value, "name") ?? defaultExportName(file.path), true, statement);
          }
          continue;
        }
        addDeclaration(statement, false, statement);
      }

      return { units: collected.units, references: collected.references, tree };
    } catch (error) {
      disposeTree(tree);
      throw error;
    }
  },

  resolveImport: ({ fromPath, specifier, repo, hasFile }) => {
    const candidates: string[] = [];
    if (specifier.startsWith(".")) {
      candidates.push(path.posix.normalize(path.posix.join(path.posix.dirname(fromPath), specifier)));
    } else {
      for (const target of aliasTargets(specifier, repo)) candidates.push(target);
    }
    for (const base of candidates) {
      if (base.startsWith("..")) continue;
      const resolved = resolveWithExtensions(base, hasFile);
      if (resolved) return resolved;
    }
    return null;
  },
};

/** A default-exported anonymous function is named after its file: `UserCard.tsx` → `UserCard`. */
const defaultExportName = (filePath: string): string => path.posix.basename(filePath).replace(/\.[^.]+$/, "") || "default";

/** Candidate repo-relative paths for an aliased specifier (`@/hooks/useUsers` → `src/hooks/useUsers`). */
const aliasTargets = (specifier: string, repo: RepoContext): string[] => {
  const out: string[] = [];
  for (const [alias, targets] of Object.entries(repo.pathAliases)) {
    if (alias.endsWith("*")) {
      const prefix = alias.slice(0, -1);
      if (!specifier.startsWith(prefix)) continue;
      const rest = specifier.slice(prefix.length);
      for (const target of targets) out.push(path.posix.normalize(target.replace(/\*$/, "") + rest));
    } else if (specifier === alias) {
      out.push(...targets.map((t) => path.posix.normalize(t)));
    }
  }
  return out;
};

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".d.ts", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"];

/** TypeScript-style resolution: exact, then `.ts`/`.tsx`/…, then `/index.*`. */
const resolveWithExtensions = (base: string, hasFile: (path: string) => boolean): string | null => {
  if (hasFile(base)) return base;
  // "./user.js" in TypeScript source usually means "./user.ts".
  const withoutJs = base.replace(/\.(m|c)?js$/, "");
  for (const candidate of [base, withoutJs]) {
    for (const ext of SOURCE_EXTENSIONS) {
      if (hasFile(candidate + ext)) return candidate + ext;
    }
    for (const ext of SOURCE_EXTENSIONS) {
      if (hasFile(`${candidate}/index${ext}`)) return `${candidate}/index${ext}`;
    }
  }
  return null;
};

/** Files this adapter should parse; used by the registry through `extensions`. */
export const isTypeScriptLike = (file: FileRecord): boolean => EXTENSIONS.includes(path.extname(file.path).toLowerCase());
