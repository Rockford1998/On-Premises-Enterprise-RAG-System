import { llmModel } from "../models/shared.model";

/**
 * Seed the llmModel registry from configuration.
 *
 * Bot creation resolves BASE_MODEL / TOOL_MODEL / EMBED_MODEL against this
 * collection, so on an empty database every attempt fails with "model not
 * registered" and there is no in-app way to fix it — the first-run experience
 * dead-ends unless you insert documents by hand.
 *
 * Seeding is idempotent and never overwrites an existing record, so operators
 * stay free to edit pricing, endpoints or isActive without those edits being
 * reverted on the next restart.
 */

type SeedModel = {
  name: string;
  provider: string;
  meta: {
    contextWindow: string;
    modelType: "chat" | "embedding" | "code";
    inputType: "text" | "image" | "text|image";
  };
};

const modelsFromEnv = (): SeedModel[] => {
  const provider = "ollama";
  const seeds: SeedModel[] = [];
  const seen = new Set<string>();

  const addChat = (name?: string) => {
    const trimmed = name?.trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    seeds.push({
      name: trimmed,
      provider,
      meta: { contextWindow: "8192", modelType: "chat", inputType: "text" },
    });
  };

  const addEmbedding = (name?: string) => {
    const trimmed = name?.trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    seeds.push({
      name: trimmed,
      provider,
      meta: { contextWindow: "8192", modelType: "embedding", inputType: "text" },
    });
  };

  addChat(process.env.BASE_MODEL);
  addChat(process.env.TOOL_MODEL);
  // bot.controller reads EMBED_MODEL; generateEmbedding reads EMBEDDING_MODEL.
  // Seed both so either spelling resolves.
  addEmbedding(process.env.EMBED_MODEL);
  addEmbedding(process.env.EMBEDDING_MODEL);

  return seeds;
};

export const seedLlmModels = async (): Promise<void> => {
  const seeds = modelsFromEnv();
  if (seeds.length === 0) return;

  const created: string[] = [];

  for (const seed of seeds) {
    // upsert with $setOnInsert: creates when absent, leaves existing rows alone.
    const result = await llmModel.updateOne(
      { name: seed.name },
      { $setOnInsert: { ...seed, isActive: true } },
      { upsert: true },
    );
    if (result.upsertedCount > 0) created.push(seed.name);
  }

  if (created.length > 0) {
    console.log(`[seed] registered LLM models: ${created.join(", ")}`);
  }
};
