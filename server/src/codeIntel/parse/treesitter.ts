import fs from "fs";
import path from "path";
import { Language, Node, Parser, Tree } from "web-tree-sitter";

/**
 * tree-sitter loading, once per process.
 *
 * The WASM grammars ship inside @vscode/tree-sitter-wasm and are located with
 * require.resolve, so the path works the same under ts-node (src/) and the
 * compiled build (dist/) — a path relative to __dirname would not.
 *
 * Trees hold memory on the WASM heap that garbage collection does not reclaim.
 * Every tree this module hands out must be passed to `disposeTree`.
 */

export type GrammarName = "typescript" | "tsx" | "javascript" | "java" | "c-sharp";

const GRAMMAR_BY_EXTENSION: Record<string, GrammarName> = {
  ".ts": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".tsx": "tsx",
  // JSX in a .js file is common (Create React App, older React); the tsx grammar
  // reads plain JavaScript too, so it is the safer choice for both.
  ".js": "tsx",
  ".jsx": "tsx",
  ".mjs": "tsx",
  ".cjs": "tsx",
  ".java": "java",
  ".cs": "c-sharp",
};

export const grammarForPath = (filePath: string): GrammarName | null => {
  const ext = path.extname(filePath).toLowerCase();
  return GRAMMAR_BY_EXTENSION[ext] ?? null;
};

/** Files past this size are not worth parsing: they are generated or vendored, and parse time grows with them. */
export const MAX_PARSE_BYTES = 600_000;

let initPromise: Promise<void> | null = null;
const languages = new Map<GrammarName, Promise<Language>>();
const parsers = new Map<GrammarName, Parser>();

const wasmDir = (): string => path.dirname(require.resolve("@vscode/tree-sitter-wasm/wasm/tree-sitter-typescript.wasm"));

const initOnce = (): Promise<void> => {
  initPromise ??= Parser.init();
  return initPromise;
};

const loadLanguage = async (grammar: GrammarName): Promise<Language> => {
  await initOnce();
  let pending = languages.get(grammar);
  if (!pending) {
    // The bytes are read here rather than passing the path to Language.load:
    // that overload resolves the file through a dynamic import, which Jest's
    // module environment rejects ("dynamic import callback was invoked
    // without --experimental-vm-modules").
    const bytes = fs.readFileSync(path.join(wasmDir(), `tree-sitter-${grammar}.wasm`));
    pending = Language.load(new Uint8Array(bytes));
    languages.set(grammar, pending);
  }
  return pending;
};

/**
 * One parser per grammar, reused across files: constructing a parser is
 * expensive, and parsing is synchronous so two files can never share one.
 */
const parserFor = async (grammar: GrammarName): Promise<Parser> => {
  const existing = parsers.get(grammar);
  if (existing) return existing;
  const language = await loadLanguage(grammar);
  const parser = new Parser();
  parser.setLanguage(language);
  parsers.set(grammar, parser);
  return parser;
};

export class ParseTooLargeError extends Error {
  constructor(bytes: number) {
    super(`File is too large to parse (${bytes} bytes)`);
    this.name = "ParseTooLargeError";
  }
}

/** Parse source text. The caller owns the tree and must call `disposeTree`. */
export const parseSource = async ({ content, grammar }: { content: string; grammar: GrammarName }): Promise<Tree> => {
  if (content.length > MAX_PARSE_BYTES) throw new ParseTooLargeError(content.length);
  const parser = await parserFor(grammar);
  const tree = parser.parse(content);
  if (!tree) throw new Error("Parser returned no tree");
  return tree;
};

export const disposeTree = (tree: unknown): void => {
  const disposable = tree as { delete?: () => void } | null;
  if (disposable && typeof disposable.delete === "function") {
    try {
      disposable.delete();
    } catch {
      // Already disposed; nothing to do.
    }
  }
};

/** Release every parser and grammar. Only used so tests can exit cleanly. */
export const disposeParsers = (): void => {
  for (const parser of parsers.values()) parser.delete();
  parsers.clear();
  languages.clear();
};

// ---- tree helpers -------------------------------------------------------

export type SyntaxNode = Node;

/** Named children of a node, skipping anonymous tokens like punctuation. */
export const namedChildren = (node: SyntaxNode): SyntaxNode[] => {
  const out: SyntaxNode[] = [];
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (child) out.push(child);
  }
  return out;
};

/** Depth-first walk over named nodes. Return false from `visit` to skip a subtree. */
export const walk = (node: SyntaxNode, visit: (node: SyntaxNode) => boolean | void): void => {
  const stack: SyntaxNode[] = [node];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (visit(current) === false) continue;
    const children = namedChildren(current);
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
  }
};

export const fieldText = (node: SyntaxNode, field: string): string | null =>
  node.childForFieldName(field)?.text ?? null;

/** tree-sitter rows are 0-based; unit line numbers are 1-based and inclusive. */
export const startLineOf = (node: SyntaxNode): number => node.startPosition.row + 1;
export const endLineOf = (node: SyntaxNode): number => node.endPosition.row + 1;

/** Text of a string literal node, without its quotes; null when it is not a plain literal. */
export const literalText = (node: SyntaxNode | null | undefined): string | null => {
  if (!node) return null;
  if (node.type === "string" || node.type === "string_literal") {
    const fragment = namedChildren(node).find((c) => c.type === "string_fragment");
    if (fragment) return fragment.text;
    const raw = node.text;
    return raw.length >= 2 ? raw.slice(1, -1) : raw;
  }
  if (node.type === "template_string") {
    // `/api/users/${id}` keeps its ${…} markers, which the API matcher treats as wildcards.
    const raw = node.text;
    return raw.length >= 2 ? raw.slice(1, -1) : raw;
  }
  return null;
};
