import { env } from "../config/env";
import { TOOL_NAMES, ToolName, toolInstructions, TOOL_SCHEMAS } from "../codeIntel/agent/tools";
import { buildContext, Citation, ContextUnit } from "../codeIntel/retrieve/contextBuilder";
import { QueryType } from "../codeIntel/retrieve/queryClassifier";
import { generateCodeAnswer } from "../llmServices/generateCodeAnswer";
import { runToolLoop, ToolCall } from "../llmServices/runCodeAgent";
import { Actor } from "../util/botAccess";
import { CodeGraphService } from "./codeGraph.service";
import { CodeIndexService, CodeRequestError } from "./codeIndex.service";
import { CodeSearchService } from "./codeSearch.service";

/**
 * Answering a question about a bot's code.
 *
 * Two modes. "answer" retrieves once and asks the model — fast and
 * predictable. "agent" lets the model look things up itself, which handles
 * questions whose answer needs a second hop the retriever did not anticipate,
 * at the cost of several model round trips.
 */

const MAX_TOOL_CALLS = 10;
/** Leave room for the answer itself inside the model's context window. */
const ANSWER_HEADROOM = 1200;

export type ChatMode = "answer" | "agent";

export type ChatResult = {
  answer: string;
  mode: ChatMode;
  queryType?: QueryType;
  citations: Citation[];
  usedUnits: number;
  toolCalls?: { tool: string; arguments: Record<string, unknown> }[];
};

const asContextUnit = (unit: {
  uid: string; repo: string; path: string; kind: string; name: string; qualifiedName: string;
  signature: string | null; summary: string | null; code: string; startLine: number; endLine: number;
  metadata: Record<string, unknown>;
}): ContextUnit => unit;

export class CodeChatService {
  indexService = new CodeIndexService();
  searchService = new CodeSearchService();

  answer = async ({
    botId,
    actor,
    question,
    mode = "answer",
  }: {
    botId: string;
    actor: Actor;
    question: string;
    mode?: ChatMode;
  }): Promise<ChatResult> => {
    const { bot } = await this.indexService.authorize({ botId, actor, tier: "view" });
    if (typeof question !== "string" || !question.trim()) {
      throw new CodeRequestError("A question is required.", 400);
    }
    const model = bot.baseModel?.name;
    if (!model) throw new CodeRequestError("This bot has no answering model configured.", 400);

    const repos = await CodeGraphService.listRepos({ botId });
    if (repos.length === 0) {
      throw new CodeRequestError("No code has been indexed for this bot yet. Add a repository first.", 400);
    }

    const numCtx = CodeSearchService.contextWindowFor(bot.baseModel?.meta?.contextWindow);
    return mode === "agent"
      ? this.answerWithTools({ botId, actor, question, model, numCtx, instruction: bot.instruction ?? undefined })
      : this.answerOnce({ botId, actor, question, model, numCtx, instruction: bot.instruction ?? undefined });
  };

  /** One retrieval pass, then one model call. */
  private answerOnce = async ({
    botId,
    actor,
    question,
    model,
    numCtx,
    instruction,
  }: {
    botId: string;
    actor: Actor;
    question: string;
    model: string;
    numCtx: number;
    instruction?: string;
  }): Promise<ChatResult> => {
    const { hits, queryType, seedUids } = await this.searchService.search({ botId, actor, query: question });
    if (hits.length === 0) {
      return { answer: "Not found in indexed code.", mode: "answer", queryType, citations: [], usedUnits: 0 };
    }

    const repoSummaries = await this.searchService.repoSummaries({ botId });
    const fileSummaries = [...new Map(
      hits.filter((h) => h.summary).slice(0, 6).map((h) => [h.path, { path: h.path, summary: h.summary as string }]),
    ).values()];

    // For a flow question, show the order the code runs in, not just the ranking.
    const chain = queryType === "flow" || queryType === "impact"
      ? hits.filter((h) => seedUids.includes(h.uid) || h.viaEdge).sort((a, b) => (a.viaEdge?.depth ?? 0) - (b.viaEdge?.depth ?? 0))
      : [];

    const context = buildContext({
      units: hits.map(asContextUnit),
      repoSummaries,
      fileSummaries,
      chain: chain.map(asContextUnit),
      queryType,
      tokenBudget: Math.max(1000, numCtx - ANSWER_HEADROOM),
    });

    const answer = await generateCodeAnswer({ question, context: context.text, instruction, model, numCtx });
    return {
      answer,
      mode: "answer",
      queryType,
      // Only cite what actually reached the model.
      citations: context.citations,
      usedUnits: context.includedUids.length,
    };
  };

  /** The model drives: it calls tools until it can answer, or until the cap. */
  private answerWithTools = async ({
    botId,
    actor,
    question,
    model,
    numCtx,
    instruction,
  }: {
    botId: string;
    actor: Actor;
    question: string;
    model: string;
    numCtx: number;
    instruction?: string;
  }): Promise<ChatResult> => {
    const citations: Citation[] = [];
    const used = new Set<string>();

    const result = await runToolLoop({
      model,
      numCtx,
      maxCalls: MAX_TOOL_CALLS,
      system: [
        "You are a code assistant answering questions about a specific codebase.",
        instruction?.trim() ?? "",
        toolInstructions(),
        "Cite path:startLine-endLine for every claim. If the code does not answer the question, reply exactly: Not found in indexed code.",
      ].filter(Boolean).join("\n\n"),
      question,
      tools: TOOL_SCHEMAS,
      runTool: async (call: ToolCall) => this.runTool({ botId, actor, call, onCite: (c) => {
        if (used.has(c.uid)) return;
        used.add(c.uid);
        citations.push(c);
      } }),
    });

    return {
      answer: result.answer,
      mode: "agent",
      citations,
      usedUnits: used.size,
      toolCalls: result.calls,
    };
  };

  /**
   * Run one tool call. Every handler re-checks access, so a model that invents
   * a bot id or unit id cannot reach another bot's code.
   */
  runTool = async ({
    botId,
    actor,
    call,
    onCite,
  }: {
    botId: string;
    actor: Actor;
    call: ToolCall;
    onCite?: (citation: Citation) => void;
  }): Promise<unknown> => {
    const args = call.arguments ?? {};
    const str = (key: string): string | undefined => (typeof args[key] === "string" ? (args[key] as string) : undefined);
    const num = (key: string): number | undefined => {
      const value = Number(args[key]);
      return Number.isFinite(value) ? value : undefined;
    };
    const cite = (units: { uid: string; repo: string; path: string; startLine: number; endLine: number; name: string; kind: string }[]) => {
      for (const u of units) onCite?.({ uid: u.uid, repo: u.repo, path: u.path, startLine: u.startLine, endLine: u.endLine, name: u.name, kind: u.kind });
    };

    if (!TOOL_NAMES.has(call.tool)) throw new CodeRequestError(`Unknown tool: ${call.tool}`, 400);
    const tool = call.tool as ToolName;

    switch (tool) {
      case "search_code": {
        const { hits } = await this.searchService.search({
          botId, actor, query: str("query") ?? "", kind: str("kind"), pathPrefix: str("path_prefix"), limit: num("limit") ?? 12,
        });
        cite(hits);
        return hits.map((h) => ({
          uid: h.uid, repo: h.repo, path: h.path, lines: `${h.startLine}-${h.endLine}`,
          kind: h.kind, name: h.qualifiedName, signature: h.signature, summary: h.summary,
        }));
      }
      case "find_symbol": {
        const units = await this.searchService.findSymbol({ botId, actor, name: str("name") ?? "" });
        cite(units);
        return units.map((u) => ({ uid: u.uid, repo: u.repo, path: u.path, lines: `${u.startLine}-${u.endLine}`, kind: u.kind, name: u.qualifiedName, signature: u.signature }));
      }
      case "get_unit": {
        const unit = await this.searchService.getUnit({ botId, actor, uid: str("uid") ?? "" });
        cite([unit]);
        return { uid: unit.uid, repo: unit.repo, path: unit.path, lines: `${unit.startLine}-${unit.endLine}`, kind: unit.kind, name: unit.qualifiedName, metadata: unit.metadata, code: unit.code };
      }
      case "read_file": {
        const slice = await this.searchService.readFile({
          botId, actor, path: str("path") ?? "", repo: str("repo"), startLine: num("start_line"), endLine: num("end_line"),
        });
        return slice;
      }
      case "get_callers":
        return this.searchService.getCallers({ botId, actor, uid: str("uid") ?? "" });
      case "get_callees":
        return this.searchService.getCallees({ botId, actor, uid: str("uid") ?? "" });
      case "list_routes": {
        const routes = await this.searchService.listRoutes({ botId, actor, method: str("method"), pathContains: str("path_contains") });
        cite(routes);
        return routes.map((r) => ({
          uid: r.uid, method: r.metadata.httpMethod, path: r.metadata.routePath,
          file: `${r.path}:${r.startLine}-${r.endLine}`, handlerUid: r.handlerUid,
        }));
      }
      case "trace_feature": {
        const traced = await this.searchService.traceFeature({ botId, actor, uid: str("uid") ?? "" });
        cite([traced.start, ...traced.chain]);
        return {
          start: { uid: traced.start.uid, name: traced.start.qualifiedName, path: `${traced.start.path}:${traced.start.startLine}-${traced.start.endLine}` },
          chain: traced.chain.map((step) => ({
            uid: step.uid, name: step.qualifiedName, kind: step.kind, via: step.viaType, depth: step.depth,
            path: `${step.path}:${step.startLine}-${step.endLine}`, summary: step.summary,
          })),
        };
      }
      case "get_summary":
        return this.searchService.getSummary({ botId, actor, path: str("path") ?? "" });
      default: {
        const exhaustive: never = tool;
        throw new CodeRequestError(`Unknown tool: ${String(exhaustive)}`, 400);
      }
    }
  };
}

export const CODE_AGENT_MAX_CALLS = MAX_TOOL_CALLS;
export const codeChatDefaults = { numCtx: env.codeIntel.numCtx };
