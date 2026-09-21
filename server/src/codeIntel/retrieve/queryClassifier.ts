/**
 * What kind of question is this? The answer decides how retrieval is weighted
 * and how far the code graph is walked, so it is rule-based and predictable
 * rather than another model call in the hot path.
 */

export type QueryType = "symbol" | "flow" | "impact" | "config" | "conceptual";

const FLOW = /\b(how does|how do|end[- ]to[- ]end|what happens when|walk me through|flow|lifecycle|pipeline|trace|step by step|when (?:a|the) user|after (?:i|the user)|from .+ to )\b/i;
const IMPACT = /\b(what breaks|what would break|impact|affected|who calls|what calls|where is .+ used|used by|callers?|depend(?:s|ents?) on|safe to (?:remove|delete|rename|change))\b/i;
const CONFIG = /\b(config|configuration|env|environment variable|\.env|settings?|setup|install|deploy|docker|port|secret|credential)\b/i;
const SYMBOL_HINT = /\b(function|class|method|component|hook|route|endpoint|interface|type)\b/i;

/** `getUserById`, `UserService.getUser`, `user_service`, `"quoted name"`. */
const IDENTIFIER = /^[`'"]?[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*[`'"]?$/;
const LOOKS_LIKE_CODE = /[a-z][A-Z]|_[a-z]|\(\)|::|\.\w+\(/;

/**
 * Does this token look like code rather than a word? Plain lowercase words
 * ("show", "users") do not, which is what keeps a short phrase like "show
 * users" out of the symbol branch.
 */
const isCodeLike = (token: string): boolean => {
  const bare = token.replace(/^[`'"]|[`'"]$/g, "");
  return LOOKS_LIKE_CODE.test(bare) || bare.includes(".") || bare.includes("_") || /^[A-Z]/.test(bare);
};

export const classifyQuery = (query: string): QueryType => {
  const trimmed = query.trim();
  const words = trimmed.split(/\s+/).filter(Boolean);

  // One or two identifier-shaped tokens, at least one of which actually looks
  // like code: the user is hunting a specific symbol.
  if (words.length <= 2 && words.every((w) => IDENTIFIER.test(w)) && words.some(isCodeLike)) return "symbol";
  if (words.length <= 6 && SYMBOL_HINT.test(trimmed) && words.some((w) => LOOKS_LIKE_CODE.test(w))) return "symbol";

  // Impact before flow: "what calls X" is about callers, even though it reads like a flow question.
  if (IMPACT.test(trimmed)) return "impact";
  if (FLOW.test(trimmed)) return "flow";
  if (CONFIG.test(trimmed)) return "config";
  return "conceptual";
};

/** Identifier-ish tokens worth a trigram lookup, longest first. */
export const identifierTokens = (query: string): string[] =>
  [...new Set(
    query
      .split(/[^\w$.]+/)
      .map((token) => token.replace(/^[.]+|[.]+$/g, ""))
      .filter((token) => token.length >= 3 && (LOOKS_LIKE_CODE.test(token) || /^[A-Z]/.test(token) || token.includes("."))),
  )].sort((a, b) => b.length - a.length).slice(0, 5);
