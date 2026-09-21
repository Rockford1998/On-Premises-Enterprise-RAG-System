import axios from "axios";
import { retry } from "../util/retry";
import type { ToolSchema } from "../codeIntel/agent/tools";
import { toOllamaTools } from "../codeIntel/agent/tools";

/**
 * The tool-use loop.
 *
 * Ollama's /api/chat supports native tool calling, but only some models do it,
 * and a model that does not will simply ignore the `tools` field. So the loop
 * reads either a native `tool_calls` array or a bare JSON object in the
 * message content, and stops as soon as the model replies with prose.
 *
 * A tool that throws is reported back to the model rather than aborting the
 * request: recovering from a bad unit id is exactly what the loop is for.
 */

export type ToolCall = { tool: string; arguments: Record<string, unknown> };

type ChatMessage = { role: "system" | "user" | "assistant" | "tool"; content: string; tool_calls?: unknown };

const MAX_TOOL_RESULT_CHARS = 8000;

const isTransient = (error: unknown): boolean => {
  if (!axios.isAxiosError(error)) return false;
  const status = error.response?.status;
  return status === undefined || status === 429 || status >= 500;
};

/** A bare JSON tool call in the message text, for models without native tool support. */
export const parseJsonToolCall = (content: string): ToolCall | null => {
  const text = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
  if (!text.startsWith("{")) return null;
  // Take the first balanced object, so trailing prose does not break parsing.
  let depth = 0;
  let end = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  if (end === -1) return null;
  try {
    const parsed = JSON.parse(text.slice(0, end)) as { tool?: unknown; name?: unknown; arguments?: unknown; parameters?: unknown };
    const tool = typeof parsed.tool === "string" ? parsed.tool : typeof parsed.name === "string" ? parsed.name : null;
    if (!tool) return null;
    const args = (parsed.arguments ?? parsed.parameters ?? {}) as Record<string, unknown>;
    return { tool, arguments: typeof args === "object" && args !== null ? args : {} };
  } catch {
    return null;
  }
};

const nativeToolCalls = (message: { tool_calls?: unknown }): ToolCall[] => {
  const calls = message.tool_calls;
  if (!Array.isArray(calls)) return [];
  return calls
    .map((call) => {
      const fn = (call as { function?: { name?: unknown; arguments?: unknown } }).function;
      if (!fn || typeof fn.name !== "string") return null;
      let args: Record<string, unknown> = {};
      if (typeof fn.arguments === "string") {
        try {
          args = JSON.parse(fn.arguments) as Record<string, unknown>;
        } catch {
          args = {};
        }
      } else if (fn.arguments && typeof fn.arguments === "object") {
        args = fn.arguments as Record<string, unknown>;
      }
      return { tool: fn.name, arguments: args };
    })
    .filter((call): call is ToolCall => call !== null);
};

export const runToolLoop = async ({
  model,
  numCtx,
  maxCalls,
  system,
  question,
  tools,
  runTool,
}: {
  model: string;
  numCtx: number;
  maxCalls: number;
  system: string;
  question: string;
  tools: ToolSchema[];
  runTool: (call: ToolCall) => Promise<unknown>;
}): Promise<{ answer: string; calls: ToolCall[] }> => {
  const baseUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
  const messages: ChatMessage[] = [
    { role: "system", content: system },
    { role: "user", content: question },
  ];
  const calls: ToolCall[] = [];

  for (let step = 0; step <= maxCalls; step++) {
    const body: Record<string, unknown> = {
      model,
      messages,
      stream: false,
      options: { temperature: 0.2, num_ctx: numCtx },
    };
    // Past the cap, stop offering tools so the model has to answer.
    if (step < maxCalls) body.tools = toOllamaTools().filter((t) => tools.some((s) => s.name === t.function.name));

    const res = await retry(() => axios.post(`${baseUrl}/api/chat`, body, { timeout: 300_000 }), {
      maxAttempts: 2,
      baseDelayMs: 1000,
      shouldRetry: isTransient,
    });

    const message = (res.data?.message ?? {}) as { content?: unknown; tool_calls?: unknown };
    const content = typeof message.content === "string" ? message.content : "";
    const requested = nativeToolCalls(message);
    const fallback = requested.length === 0 ? parseJsonToolCall(content) : null;
    const pending = requested.length > 0 ? requested : fallback ? [fallback] : [];

    if (pending.length === 0 || step === maxCalls) {
      const answer = content.trim();
      return {
        answer: answer || "Not found in indexed code.",
        calls,
      };
    }

    messages.push({ role: "assistant", content, ...(message.tool_calls ? { tool_calls: message.tool_calls } : {}) });

    for (const call of pending.slice(0, maxCalls - calls.length)) {
      calls.push(call);
      let resultText: string;
      try {
        const result = await runTool(call);
        resultText = JSON.stringify(result ?? null);
      } catch (error) {
        // Handing the error back lets the model correct itself and try again.
        resultText = JSON.stringify({ error: error instanceof Error ? error.message : String(error) });
      }
      if (resultText.length > MAX_TOOL_RESULT_CHARS) {
        resultText = `${resultText.slice(0, MAX_TOOL_RESULT_CHARS)}… (truncated)`;
      }
      messages.push({ role: "tool", content: `${call.tool} result: ${resultText}` });
    }

    if (calls.length >= maxCalls) {
      messages.push({ role: "user", content: "You have used all available tool calls. Answer now with what you have found, citing path:startLine-endLine." });
    }
  }

  return { answer: "Not found in indexed code.", calls };
};
