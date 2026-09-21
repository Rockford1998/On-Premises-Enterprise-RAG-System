import { Request, Response } from "express";
import { TOOL_NAMES } from "../codeIntel/agent/tools";
import { CodeChatService } from "../services/codeChat.service";
import { CodeRequestError } from "../services/codeIndex.service";
import { CodeSearchService } from "../services/codeSearch.service";
import { ForbiddenError } from "../util/botAccess";
import { sendResponse } from "../util/sendResponse";

const sendKnownError = (res: Response, error: unknown): boolean => {
  if (error instanceof ForbiddenError) {
    sendResponse({ res, success: false, message: error.message, status: 403 });
    return true;
  }
  if (error instanceof CodeRequestError) {
    sendResponse({ res, success: false, message: error.message, status: error.status });
    return true;
  }
  return false;
};

export class CodeChatController {
  chatService = new CodeChatService();
  searchService = new CodeSearchService();

  /** POST /code/:botId/chat — the code bot's own chat endpoint; /chat is the KB flow. */
  chat = async (req: Request, res: Response) => {
    try {
      if (!req.user) {
        sendResponse({ res, success: false, message: "Not authenticated", status: 401 });
        return;
      }
      const mode = req.body?.mode === "agent" ? "agent" : "answer";
      const result = await this.chatService.answer({
        botId: req.params.botId,
        actor: req.user,
        question: req.body?.question,
        mode,
      });
      sendResponse({ res, success: true, message: "Answer generated", data: result, status: 200 });
    } catch (error) {
      if (sendKnownError(res, error)) return;
      console.error("Code chat failed:", error instanceof Error ? error.message : error);
      sendResponse({ res, success: false, message: "Failed to answer the question", status: 500 });
    }
  };

  /** POST /code/:botId/search — retrieval only, for debugging and evaluation. */
  search = async (req: Request, res: Response) => {
    try {
      if (!req.user) {
        sendResponse({ res, success: false, message: "Not authenticated", status: 401 });
        return;
      }
      const { query, limit, kind, pathPrefix, expand } = req.body ?? {};
      const result = await this.searchService.search({
        botId: req.params.botId,
        actor: req.user,
        query,
        limit: Number(limit) || undefined,
        kind: typeof kind === "string" ? kind : undefined,
        pathPrefix: typeof pathPrefix === "string" ? pathPrefix : undefined,
        expand: expand !== false,
      });
      sendResponse({
        res,
        success: true,
        message: "Search complete",
        // The full code of every hit would dwarf the useful part of this response.
        data: {
          queryType: result.queryType,
          hits: result.hits.map(({ code, ...rest }) => ({ ...rest, codeLength: code.length })),
        },
        status: 200,
      });
    } catch (error) {
      if (sendKnownError(res, error)) return;
      console.error("Code search failed:", error instanceof Error ? error.message : error);
      sendResponse({ res, success: false, message: "Search failed", status: 500 });
    }
  };

  /** POST /code/:botId/tools/:tool — one agent tool, callable directly. */
  runTool = async (req: Request, res: Response) => {
    try {
      if (!req.user) {
        sendResponse({ res, success: false, message: "Not authenticated", status: 401 });
        return;
      }
      const tool = req.params.tool;
      if (!TOOL_NAMES.has(tool)) {
        sendResponse({ res, success: false, message: `Unknown tool "${tool}".`, status: 404 });
        return;
      }
      const result = await this.chatService.runTool({
        botId: req.params.botId,
        actor: req.user,
        call: { tool, arguments: (req.body ?? {}) as Record<string, unknown> },
      });
      sendResponse({ res, success: true, message: `${tool} complete`, data: result, status: 200 });
    } catch (error) {
      if (sendKnownError(res, error)) return;
      console.error("Code tool failed:", error instanceof Error ? error.message : error);
      sendResponse({ res, success: false, message: "Tool call failed", status: 500 });
    }
  };
}
