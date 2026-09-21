/**
 * Text for Postgres full-text search. Code names are identifiers, so a query
 * like "get user by id" only matches `getUserById` if the identifier is also
 * stored split into words.
 */

/** getUserById → "get user by id"; HTTPServer → "http server"; user_id / user-id / a.b → "user id" / "a b". */
export const splitIdentifier = (text: string): string =>
  text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/[_\-./:#$@\\]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

const MAX_SEARCH_TEXT = 4000;

export const buildSearchText = ({
  name,
  qualifiedName,
  docstring,
  summary,
  metadata,
}: {
  name: string;
  qualifiedName: string;
  docstring?: string | null;
  summary?: string | null;
  metadata?: Record<string, unknown>;
}): string => {
  const parts = [splitIdentifier(name), name];
  if (qualifiedName !== name) parts.push(splitIdentifier(qualifiedName), qualifiedName);

  // A route is found by "users" or "create user", not by its uid.
  const method = typeof metadata?.httpMethod === "string" ? metadata.httpMethod : "";
  const routePath = typeof metadata?.routePath === "string" ? metadata.routePath : "";
  if (routePath) parts.push(method, splitIdentifier(routePath), routePath);

  if (docstring) parts.push(docstring);
  if (summary) parts.push(summary);
  return parts.filter(Boolean).join(" ").slice(0, MAX_SEARCH_TEXT);
};
