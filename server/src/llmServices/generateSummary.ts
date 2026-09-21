import axios from "axios";
import { retry } from "../util/retry";

/**
 * One short completion from the bot's base model, used for the opt-in code
 * summaries. The model name is always the caller's (the bot's baseModel).
 * `num_ctx` is set explicitly: Ollama's default context is small and silently
 * truncates the start of a long prompt instead of failing.
 */
const isTransient = (error: unknown): boolean => {
  if (!axios.isAxiosError(error)) return false;
  const status = error.response?.status;
  return status === undefined || status === 429 || status >= 500;
};

export const generateSummary = async ({
  prompt,
  model,
  numCtx,
}: {
  prompt: string;
  model: string;
  numCtx: number;
}): Promise<string> => {
  const baseUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
  const res = await retry(
    () =>
      axios.post(
        `${baseUrl}/api/generate`,
        { model, prompt, stream: false, options: { temperature: 0.1, num_ctx: numCtx } },
        { timeout: 180_000 },
      ),
    { maxAttempts: 3, baseDelayMs: 1000, shouldRetry: isTransient },
  );
  const text = res.data?.response;
  if (typeof text !== "string" || !text.trim()) {
    throw new Error(`Empty summary from model "${model}"`);
  }
  return text.trim();
};
