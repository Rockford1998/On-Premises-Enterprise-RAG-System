import axios from "axios";
import { retry } from "../util/retry";

/**
 * Embeddings for the Code_Interpreter flow. Separate from generateEmbedding.ts
 * on purpose: that one lowercases text and strips everything but `\w\s.-`,
 * which destroys code (`::`, `()`, `/`, casing). Text is embedded verbatim
 * here, and the model name always comes from the caller (the bot's
 * `codeConfig`), never from a global env var.
 */

export type EmbeddingRole = "document" | "query";

const QUERY_TASK = "Given a question about a codebase, retrieve the code that answers it";

/**
 * Embedding models expect different conventions for what is indexed versus
 * what is searched. Documents and queries must use matching conventions or
 * distances are meaningless. Unknown families are embedded verbatim.
 */
export const applyRole = ({ text, model, role }: { text: string; model: string; role: EmbeddingRole }): string => {
  const name = model.toLowerCase();
  if (name.startsWith("qwen3-embedding")) {
    return role === "query" ? `Instruct: ${QUERY_TASK}\nQuery: ${text}` : text;
  }
  if (name.startsWith("nomic-embed")) {
    return role === "query" ? `search_query: ${text}` : `search_document: ${text}`;
  }
  return text;
};

const normalise = (vector: number[]): number[] => {
  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  return norm > 0 ? vector.map((v) => v / norm) : vector;
};

/** Connection resets, timeouts, 429 and 5xx are worth retrying; a 400/404 (bad model name) is not. */
const isTransientEmbedError = (error: unknown): boolean => {
  if (!axios.isAxiosError(error)) return false;
  const status = error.response?.status;
  if (status === undefined) return true; // no response: network error / timeout
  return status === 429 || status >= 500;
};

/** Embed a batch through Ollama's /api/embed. Vectors are L2-normalised, as the KB path does. */
export const generateCodeEmbeddings = async ({
  texts,
  model,
  role,
}: {
  texts: string[];
  model: string;
  role: EmbeddingRole;
}): Promise<number[][]> => {
  if (texts.length === 0) return [];
  const baseUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
  const input = texts.map((text) => applyRole({ text, model, role }));

  const res = await retry(
    () => axios.post(`${baseUrl}/api/embed`, { model, input }, { timeout: 120_000 }),
    { maxAttempts: 3, baseDelayMs: 500, shouldRetry: isTransientEmbedError },
  );

  const embeddings = res.data?.embeddings;
  if (!Array.isArray(embeddings) || embeddings.length !== texts.length) {
    throw new Error(`Invalid embedding response from Ollama for model "${model}"`);
  }
  return embeddings.map((e: number[]) => normalise(e));
};

/**
 * Embed a short string and report the vector length. Bot creation uses this to
 * size the embedding column, so the table can never disagree with the model.
 */
export const probeEmbeddingDimension = async ({ model }: { model: string }): Promise<number> => {
  const [vector] = await generateCodeEmbeddings({ texts: ["function probe() {}"], model, role: "document" });
  if (!vector || vector.length === 0) {
    throw new Error(`Embedding model "${model}" returned an empty vector`);
  }
  return vector.length;
};
