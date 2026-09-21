/**
 * Stable unit ids: "<repoName>:<path>#<qualifiedName>".
 *
 * They must be deterministic so re-indexing upserts the same row instead of
 * inserting a duplicate, and so edges from unchanged files keep pointing at it.
 */

export const unitUid = ({ repoName, path, qualifiedName }: { repoName: string; path: string; qualifiedName: string }): string =>
  `${repoName}:${path}#${qualifiedName}`;

export const routeQualifiedName = ({ method, path }: { method: string; path: string }): string =>
  `route:${method.toUpperCase()} ${path}`;

export const FILE_QUALIFIED_NAME = "<file>";

export const fileUid = ({ repoName, path }: { repoName: string; path: string }): string =>
  unitUid({ repoName, path, qualifiedName: FILE_QUALIFIED_NAME });

/** Oversized units are split into parts that share the parent's id plus `#part<n>` (1-based). */
export const partUid = ({ uid, part }: { uid: string; part: number }): string => `${uid}#part${part}`;

/**
 * Give every uid in a file a unique value. The first occurrence keeps the
 * plain id; later collisions (overloads, duplicate anonymous functions) get
 * `@<startLine>`. If even that collides the line-suffixed id gets a counter.
 */
export const dedupeUids = <T extends { uid: string; startLine: number }>(units: T[]): T[] => {
  const seen = new Set<string>();
  return units.map((unit) => {
    let uid = unit.uid;
    if (seen.has(uid)) {
      uid = `${unit.uid}@${unit.startLine}`;
      let n = 2;
      while (seen.has(uid)) uid = `${unit.uid}@${unit.startLine}.${n++}`;
    }
    seen.add(uid);
    return uid === unit.uid ? unit : { ...unit, uid };
  });
};

/** Embedding rows for summaries are keyed by a prefixed uid so they can never collide with a unit uid. */
export const summaryUid = ({ kind, repoName, path }: { kind: "file" | "module" | "repo"; repoName: string; path?: string }): string =>
  kind === "repo" ? `repo:${repoName}` : `${kind}:${repoName}:${path ?? ""}`;
