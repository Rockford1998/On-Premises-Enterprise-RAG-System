import { env } from "../config/env";
import { unitUidOfChunk } from "../codeIntel/transform/chunker";
import { classifyQuery, identifierTokens, QueryType } from "../codeIntel/retrieve/queryClassifier";
import { fuse, RankedList } from "../codeIntel/retrieve/rrf";
import { generateCodeEmbeddings } from "../llmServices/generateCodeEmbeddings";
import { Actor } from "../util/botAccess";
import { CodeGraphService, UnitDetail } from "./codeGraph.service";
import { CodeIndexService, CodeRequestError } from "./codeIndex.service";

/**
 * Retrieval over a bot's indexed code, and the handlers behind the agent tools.
 *
 * Three searches run in parallel and are fused with Reciprocal Rank Fusion:
 * vectors find code that means the same thing, full text finds the words a
 * question actually uses, and trigrams find a symbol even when it is
 * misspelled. Each is weak alone: vectors miss exact names, text search misses
 * paraphrase, trigrams know nothing about meaning.
 *
 * Then the code graph is walked from the best hits, because the answer to
 * "what happens when the page loads" is usually not in the file the question
 * matches — it is one or two calls further along.
 */

const CANDIDATES_PER_SOURCE = 50;
const DEFAULT_SEED_UNITS = 8;
const DEFAULT_EXPAND_LIMIT = 40;
const DEFAULT_RESULT_LIMIT = 12;

/** Weights per query type: a symbol lookup trusts the name index, a concept question trusts meaning. */
const WEIGHTS: Record<QueryType, { vector: number; text: number; trigram: number }> = {
  symbol: { vector: 0.6, text: 1.0, trigram: 2.0 },
  flow: { vector: 1.2, text: 1.0, trigram: 0.5 },
  impact: { vector: 0.8, text: 1.0, trigram: 1.5 },
  config: { vector: 1.0, text: 1.2, trigram: 0.8 },
  conceptual: { vector: 1.5, text: 1.0, trigram: 0.5 },
};

/**
 * How much being connected to a top match is worth, per query type.
 *
 * Scaled against RRF: a first-place finish in one list scores about 1/(60+1),
 * so 0.03 at depth 1 is roughly "as good as topping one search", and less
 * further out. Flow and impact questions lean on the graph; a symbol lookup
 * barely needs it.
 */
const GRAPH_BONUS: Record<QueryType, number> = {
  flow: 0.03,
  impact: 0.03,
  conceptual: 0.008,
  config: 0.005,
  symbol: 0.004,
};

/** How far to walk the graph, and along which edges, for each kind of question. */
const EXPANSION: Record<QueryType, { types: string[]; depth: number; direction: "out" | "in" | "both" }> = {
  // Four hops, because that is how long a real feature is: page → hook →
  // HTTP call → route → handler → service. Three stops one short of the
  // service layer, which is usually where the answer lives.
  flow: { types: ["calls", "calls_api", "handles_route", "renders", "uses_hook"], depth: 4, direction: "out" },
  impact: { types: ["calls", "imports", "renders", "uses_hook", "calls_api"], depth: 2, direction: "in" },
  symbol: { types: ["calls", "handles_route"], depth: 1, direction: "both" },
  config: { types: ["imports"], depth: 1, direction: "both" },
  conceptual: { types: ["calls", "handles_route", "calls_api", "renders"], depth: 1, direction: "both" },
};

export type SearchHit = UnitDetail & {
  score: number;
  /** Which searches found it, and where they ranked it. */
  matchedBy: { source: string; rank: number }[];
  /** Set when the unit came from walking the graph rather than from a search. */
  viaEdge?: { type: string; fromUid: string; depth: number };
};

export type SearchResult = { queryType: QueryType; hits: SearchHit[]; seedUids: string[] };

export class CodeSearchService {
  indexService = new CodeIndexService();

  /** Load the bot, check the caller may read it, and return its embedding config. */
  private context = async ({ botId, actor }: { botId: string; actor: Actor }) =>
    this.indexService.authorize({ botId, actor, tier: "view" });

  /**
   * Hybrid search, then graph expansion.
   *
   * Summary embeddings (file/module/repo) are searched too, but a summary is
   * not itself citable code: a file summary hit is turned into that file's
   * units, so the answer always quotes real lines.
   */
  search = async ({
    botId,
    actor,
    query,
    limit = DEFAULT_RESULT_LIMIT,
    kind,
    pathPrefix,
    expand = true,
  }: {
    botId: string;
    actor: Actor;
    query: string;
    limit?: number;
    kind?: string;
    pathPrefix?: string;
    expand?: boolean;
  }): Promise<SearchResult> => {
    const { codeConfig } = await this.context({ botId, actor });
    if (!query.trim()) throw new CodeRequestError("A question or search term is required.", 400);

    const queryType = classifyQuery(query);
    const weights = WEIGHTS[queryType];
    const tokens = identifierTokens(query);

    const [vector, text, trigram] = await Promise.all([
      (async () => {
        const [embedding] = await generateCodeEmbeddings({ texts: [query], model: codeConfig.embedModel, role: "query" });
        return CodeGraphService.searchByVector({
          botId, embedType: codeConfig.embedType, embedding, limit: CANDIDATES_PER_SOURCE,
        });
      })(),
      CodeGraphService.searchByText({ botId, text: query, limit: CANDIDATES_PER_SOURCE }),
      CodeGraphService.searchByTrigram({ botId, tokens, limit: CANDIDATES_PER_SOURCE }),
    ]);

    // A chunk id (`…#part2`) and a summary id both map back to real units.
    const summaryUids = vector.filter((v) => v.unitType !== "code").map((v) => v.uid);
    const summaryUnits = await this.unitsForSummaries({ botId, summaryUids });
    const vectorIds = vector.flatMap((v) => (v.unitType === "code" ? [unitUidOfChunk(v.uid)] : summaryUnits.get(v.uid) ?? []));

    const lists: RankedList[] = [
      { ids: dedupe(vectorIds), weight: weights.vector, source: "vector" },
      { ids: dedupe(text.map((t) => t.uid)), weight: weights.text, source: "text" },
      { ids: dedupe(trigram.map((t) => t.uid)), weight: weights.trigram, source: "trigram" },
    ];
    const fused = fuse(lists);

    const seedUids = fused.slice(0, DEFAULT_SEED_UNITS).map((f) => f.id);
    const expansion = expand && seedUids.length > 0
      ? await CodeGraphService.expandGraph({ botId, uids: seedUids, ...EXPANSION[queryType], limit: DEFAULT_EXPAND_LIMIT })
      : [];

    const allUids = dedupe([...fused.map((f) => f.id), ...expansion.map((e) => e.uid)]);
    const details = await CodeGraphService.getUnits({ botId, uids: allUids.slice(0, 200) });
    const byUid = new Map(details.map((d) => [d.uid, d]));
    const scoreByUid = new Map(fused.map((f) => [f.id, f]));
    const expansionByUid = new Map(expansion.map((e) => [e.uid, e]));

    const hits: SearchHit[] = allUids
      .flatMap((uid) => {
        const unit = byUid.get(uid);
        if (!unit) return [];
        if (kind && unit.kind !== kind) return [];
        if (pathPrefix && !unit.path.startsWith(pathPrefix)) return [];
        const fusedHit = scoreByUid.get(uid);
        const via = expansionByUid.get(uid);
        // Being reachable from the best matches is evidence in its own right:
        // for "what happens when…" the answer is usually a call or two past
        // whatever the words matched. The bonus decays with distance, and is
        // added to the text/vector score rather than replacing it, so a unit
        // that both matches and connects ranks highest.
        const graphBonus = via ? GRAPH_BONUS[queryType] / (1 + via.depth) : 0;
        return [{
          ...unit,
          score: (fusedHit?.score ?? 0) + graphBonus,
          matchedBy: fusedHit?.ranks ?? [],
          ...(via ? { viaEdge: { type: via.viaType, fromUid: via.fromUid, depth: via.depth } } : {}),
        } satisfies SearchHit];
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return { queryType, hits, seedUids };
  };

  /** File and module summary hits are replaced by the units of that file. */
  private unitsForSummaries = async ({ botId, summaryUids }: { botId: string; summaryUids: string[] }): Promise<Map<string, string[]>> => {
    const out = new Map<string, string[]>();
    if (summaryUids.length === 0) return out;
    for (const uid of summaryUids) {
      // `file:<repo>:<path>` / `module:<repo>:<path>` / `repo:<repo>`
      const match = /^(file|module):[^:]+:(.*)$/.exec(uid);
      if (!match) continue;
      const units = await CodeGraphService.listUnits({ botId, pathPrefix: match[2], limit: 5 });
      out.set(uid, units.map((u) => u.uid));
    }
    return out;
  };

  // ---- agent tool handlers (also the HTTP tool endpoints) ----

  findSymbol = async ({ botId, actor, name, limit = 20 }: { botId: string; actor: Actor; name: string; limit?: number }) => {
    await this.context({ botId, actor });
    if (!name?.trim()) throw new CodeRequestError("A symbol name is required.", 400);
    return CodeGraphService.findSymbol({ botId, name: name.trim(), limit });
  };

  getUnit = async ({ botId, actor, uid }: { botId: string; actor: Actor; uid: string }): Promise<UnitDetail> => {
    await this.context({ botId, actor });
    const [unit] = await CodeGraphService.getUnits({ botId, uids: [uid] });
    if (!unit) throw new CodeRequestError("No such code unit.", 404);
    return unit;
  };

  readFile = async ({
    botId,
    actor,
    path,
    repo,
    startLine,
    endLine,
  }: {
    botId: string;
    actor: Actor;
    path: string;
    repo?: string;
    startLine?: number;
    endLine?: number;
  }) => {
    await this.context({ botId, actor });
    const file = await CodeGraphService.readFile({ botId, path, repo });
    if (!file) throw new CodeRequestError("No such file in this bot's indexed code.", 404);
    const lines = file.content.split("\n");
    const from = Math.max(1, startLine ?? 1);
    const to = Math.min(lines.length, endLine ?? lines.length);
    return {
      repo: file.repo,
      path: file.path,
      startLine: from,
      endLine: to,
      lineCount: file.lineCount,
      content: lines.slice(from - 1, to).join("\n"),
    };
  };

  getCallers = async ({ botId, actor, uid }: { botId: string; actor: Actor; uid: string }) => {
    await this.context({ botId, actor });
    return CodeGraphService.neighbours({ botId, uid, direction: "in", types: ["calls", "imports", "renders", "uses_hook", "calls_api", "handles_route"] });
  };

  getCallees = async ({ botId, actor, uid }: { botId: string; actor: Actor; uid: string }) => {
    await this.context({ botId, actor });
    return CodeGraphService.neighbours({ botId, uid, direction: "out", types: ["calls", "imports", "renders", "uses_hook", "calls_api", "handles_route"] });
  };

  listRoutes = async ({ botId, actor, method, pathContains }: { botId: string; actor: Actor; method?: string; pathContains?: string }) => {
    await this.context({ botId, actor });
    return CodeGraphService.listRoutes({ botId, method, pathContains });
  };

  /** The whole chain from one unit: frontend → API → route → handler → service. */
  traceFeature = async ({ botId, actor, uid }: { botId: string; actor: Actor; uid: string }) => {
    await this.context({ botId, actor });
    const [start] = await CodeGraphService.getUnits({ botId, uids: [uid] });
    if (!start) throw new CodeRequestError("No such code unit.", 404);
    const walked = await CodeGraphService.expandGraph({
      botId, uids: [uid], types: ["calls", "calls_api", "handles_route", "renders", "uses_hook"],
      depth: 4, direction: "out", limit: 60,
    });
    const units = await CodeGraphService.getUnits({ botId, uids: walked.map((w) => w.uid) });
    const byUid = new Map(units.map((u) => [u.uid, u]));
    return {
      start,
      chain: walked
        .map((step) => {
          const unit = byUid.get(step.uid);
          return unit ? { ...unit, depth: step.depth, viaType: step.viaType, fromUid: step.fromUid } : null;
        })
        .filter((step): step is NonNullable<typeof step> => step !== null),
    };
  };

  getSummary = async ({ botId, actor, path }: { botId: string; actor: Actor; path: string }) => {
    await this.context({ botId, actor });
    const summary = await CodeGraphService.getSummary({ botId, path });
    if (!summary) {
      throw new CodeRequestError(
        "No summary is stored for that path. Summaries are optional — re-index with summaries enabled to generate them.",
        404,
      );
    }
    return summary;
  };

  repoSummaries = async ({ botId }: { botId: string }) => CodeGraphService.getRepoSummaries({ botId });

  /** Context window for answering, from the bot's model, capped by configuration. */
  static contextWindowFor = (contextWindow: unknown): number => {
    const parsed = Number(String(contextWindow ?? "").replace(/[^\d]/g, ""));
    const declared = Number.isFinite(parsed) && parsed > 0 ? parsed : env.codeIntel.numCtx;
    return Math.min(declared, env.codeIntel.numCtx);
  };
}

const dedupe = (ids: string[]): string[] => [...new Set(ids)];
