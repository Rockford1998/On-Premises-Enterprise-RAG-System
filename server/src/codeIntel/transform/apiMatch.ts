/**
 * Cross-layer linking: which backend route does a frontend `fetch`/`axios`
 * call reach? Matching is on HTTP method and a normalised path where any
 * parameter (`:id`, `{id}`, `${id}`, `<id>`) is a wildcard.
 */

const WILDCARD = ":param";

export const normalizeApiPath = (raw: string): string => {
  let path = raw.trim();
  path = path.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]+/i, ""); // scheme://host
  path = path.split(/[?#]/)[0];
  path = path
    .replace(/\$\{[^}]*\}/g, WILDCARD)
    .replace(/\{[^}/]+\}/g, WILDCARD)
    .replace(/<[^>/]+>/g, WILDCARD);
  const segments = path
    .split("/")
    .filter(Boolean)
    .map((segment) => (segment.startsWith(":") ? WILDCARD : segment));
  return `/${segments.join("/")}`;
};

const segmentsOf = (path: string): string[] => normalizeApiPath(path).split("/").filter(Boolean);

const segmentsMatch = (a: string, b: string): boolean => a === b || a === WILDCARD || b === WILDCARD;

export type ApiRoute = { uid: string; method: string; path: string };

const methodMatches = (routeMethod: string, callMethod: string): boolean => {
  const route = routeMethod.toUpperCase();
  return route === callMethod || route === "ALL" || route === "ANY";
};

/**
 * Best route for a call, or null when there is none or it is ambiguous —
 * a wrong edge is worse than a missing one.
 *
 * 1. Same number of segments, each equal or a wildcard. Most static matches wins.
 * 2. Otherwise treat a leading wildcard (`${API}/users`) or an absent base
 *    path (`baseURL: "/api"` + `/users`) as unknown, and accept a route that
 *    *ends with* the call's segments — but only if exactly one does.
 */
export const matchApiCall = ({
  method,
  path,
  routes,
}: {
  method: string;
  path: string;
  routes: ApiRoute[];
}): string | null => {
  const callMethod = method.toUpperCase();
  const call = segmentsOf(path);
  const candidates = routes.filter((route) => methodMatches(route.method, callMethod));

  const scored = candidates.map((route) => ({ route, segments: segmentsOf(route.path) }));

  const exact = scored
    .filter(({ segments }) => segments.length === call.length && segments.every((s, i) => segmentsMatch(s, call[i])))
    .map(({ route, segments }) => ({ route, score: scoreSegments(segments, call) }));
  if (exact.length > 0) return uniqueBest(exact);

  let start = 0;
  while (start < call.length - 1 && call[start] === WILDCARD) start++;
  const tail = call.slice(start);
  if (tail.length === 0 || (tail.length === 1 && tail[0] === WILDCARD)) return null;

  const suffix = scored
    .filter(({ segments }) => {
      if (segments.length < tail.length) return false;
      const offset = segments.length - tail.length;
      return tail.every((s, i) => segmentsMatch(segments[offset + i], s));
    })
    .map(({ route, segments }) => ({ route, score: scoreSegments(segments.slice(segments.length - tail.length), tail) }))
    // A match made only of wildcards-against-literals says nothing about the path.
    .filter(({ score }) => score > 0);
  return uniqueBest(suffix);
};

/** Literal = literal scores 2, parameter = parameter scores 1, parameter against a literal scores 0. */
const scoreSegments = (route: string[], call: string[]): number =>
  route.reduce((sum, s, i) => sum + (s === call[i] ? (s === WILDCARD ? 1 : 2) : 0), 0);

/** The top-scoring route if it is unique, otherwise null — two equally good candidates are a guess. */
const uniqueBest = (matches: { route: ApiRoute; score: number }[]): string | null => {
  if (matches.length === 0) return null;
  const best = Math.max(...matches.map((m) => m.score));
  const top = matches.filter((m) => m.score === best);
  return top.length === 1 ? top[0].route.uid : null;
};
