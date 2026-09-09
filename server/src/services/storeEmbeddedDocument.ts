import { generateEmbedding } from "../llmServices/generateEmbedding";

interface DocumentMetadata extends Record<string, any> {
  source: string;
  timestamp: string;
  chunkIndex?: number;
  totalChunks?: number;
  fileName: string;
}

type EmbedChunkType = {
  text: string;
  retryCount?: number;
  metadata: DocumentMetadata;
};

export type EmbeddedChunk = {
  embedding: number[];
  content: string;
  metadata: DocumentMetadata;
};

/**
 * Embed one chunk, retrying transient Ollama failures. Deliberately does NOT
 * write to Postgres itself: the caller collects every chunk's result and
 * inserts them in a single batch statement, so a failure partway through a
 * document never leaves some of its chunks indexed and others missing.
 */
export const embedChunkWithRetry = async ({
  text,
  metadata,
  retryCount = 3,
}: EmbedChunkType): Promise<EmbeddedChunk | null> => {
  if (!text.trim()) {
    console.warn("Skipping empty text document");
    return null;
  }

  for (let attempt = 1; attempt <= retryCount; attempt++) {
    try {
      const embedding = await generateEmbedding(text);
      if (attempt > 1) {
        console.log(`Chunk embedded successfully after ${attempt} attempts`);
      }
      return { embedding, content: text, metadata };
    } catch (error) {
      if (attempt === retryCount) {
        console.error(`Failed to embed chunk after ${retryCount} attempts`, {
          error: error instanceof Error ? error.message : String(error),
          textLength: text.length,
          metadata,
        });
        throw new Error("Document embedding failed");
      }
      // Exponential backoff
      await new Promise((resolve) => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
    }
  }

  // Unreachable — the loop always returns or throws — but keeps TS satisfied.
  return null;
};
