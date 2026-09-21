import axios from "axios";
import { retry } from "../util/retry";

/**
 * The answer for a code question.
 *
 * `num_ctx` is always sent. Ollama's default context is small and it silently
 * drops the *start* of an over-long prompt rather than failing, which would
 * quietly remove the retrieved code and leave the model answering from memory.
 */

const SYSTEM_RULES = `You are a code assistant answering questions about a specific codebase.

Rules:
- Use only the code excerpts provided below. Do not rely on general knowledge about libraries to describe what this code does.
- Cite the source of every claim as path:startLine-endLine, exactly as shown in the "// path:start-end" header above each excerpt.
- If the excerpts do not contain the answer, reply exactly: Not found in indexed code.
- Be concise. Prefer naming real functions, files and routes over generic description.
- Never invent a file, function, route or line number that is not in the excerpts.`;

const isTransient = (error: unknown): boolean => {
  if (!axios.isAxiosError(error)) return false;
  const status = error.response?.status;
  return status === undefined || status === 429 || status >= 500;
};

export const buildCodePrompt = ({
  question,
  context,
  instruction,
}: {
  question: string;
  context: string;
  instruction?: string;
}): string =>
  [
    SYSTEM_RULES,
    instruction?.trim() ? `Additional instructions:\n${instruction.trim()}` : "",
    context ? `Code from the indexed repositories:\n\n${context}` : "No code was retrieved for this question.",
    `Question: ${question}`,
    "Answer (Markdown, with path:line citations):",
  ]
    .filter(Boolean)
    .join("\n\n");

export const generateCodeAnswer = async ({
  question,
  context,
  instruction,
  model,
  numCtx,
}: {
  question: string;
  context: string;
  instruction?: string;
  model: string;
  numCtx: number;
}): Promise<string> => {
  const baseUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
  const prompt = buildCodePrompt({ question, context, instruction });

  const res = await retry(
    () =>
      axios.post(
        `${baseUrl}/api/generate`,
        { model, prompt, stream: false, options: { temperature: 0.2, num_ctx: numCtx } },
        { timeout: 300_000 },
      ),
    { maxAttempts: 2, baseDelayMs: 1000, shouldRetry: isTransient },
  );

  const answer = res.data?.response;
  if (typeof answer !== "string" || !answer.trim()) {
    throw new Error(`Empty answer from model "${model}"`);
  }
  return answer.trim();
};
