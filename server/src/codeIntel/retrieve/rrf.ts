/**
 * Reciprocal Rank Fusion: combine several ranked lists into one.
 *
 * Each list contributes `weight / (k + rank)`, so a result near the top of any
 * list scores well and one near the top of several scores best. Ranks are
 * compared, not scores, which is what makes it safe to fuse a cosine distance
 * with a text-search rank and a trigram similarity — three numbers that are
 * not otherwise comparable.
 */

export const RRF_K = 60;

export type RankedList<T extends string = string> = {
  /** Ids, best first. */
  ids: T[];
  /** How much this list counts; 1 is neutral. */
  weight?: number;
  /** Where each id came from, for explaining a result. */
  source: string;
};

export type FusedResult<T extends string = string> = {
  id: T;
  score: number;
  /** Sources that ranked this id, with the rank each gave it (1-based). */
  ranks: { source: string; rank: number }[];
};

export const fuse = <T extends string = string>(lists: RankedList<T>[], k: number = RRF_K): FusedResult<T>[] => {
  const byId = new Map<T, FusedResult<T>>();
  for (const list of lists) {
    const weight = list.weight ?? 1;
    list.ids.forEach((id, index) => {
      const rank = index + 1;
      const existing = byId.get(id) ?? { id, score: 0, ranks: [] };
      existing.score += weight / (k + rank);
      existing.ranks.push({ source: list.source, rank });
      byId.set(id, existing);
    });
  }
  return [...byId.values()].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
};
