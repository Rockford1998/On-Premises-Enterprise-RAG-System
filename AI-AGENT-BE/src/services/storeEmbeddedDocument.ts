//

import { generateEmbedding } from "../llmServices/generateEmbedding";
import { VectorService } from "./vectors.service";

interface DocumentMetadata extends Record<string, any> {
  source: string;
  timestamp: string;
  chunkIndex?: number;
  totalChunks?: number;
  fileName: string;
}

type StoreEmbeddedDocumentType = {
  text: string;
  retryCount?: number;
  metadata: DocumentMetadata;
};

// Function to store an embedded document with retry logic
export const storeEmbeddedDocument = async ({
  text,
  metadata,
  retryCount = 3,
}: StoreEmbeddedDocumentType): Promise<void> => {
  for (let attempt = 1; attempt <= retryCount; attempt++) {
    try {
      if (!text.trim()) {
        console.warn("Skipping empty text document");
        return;
      }
      const embedding = await generateEmbedding(text);
      await VectorService.insertVector("document_embeddings", {
        embedding,
        content: text,
        metadata,
      });

      if (attempt > 1) {
        console.log(`Document stored successfully after ${attempt} attempts`);
      }

      return;
    } catch (error) {
      if (attempt === retryCount) {
        console.error(`Failed to store document after ${retryCount} attempts`, {
          error: error instanceof Error ? error.message : String(error),
          textLength: text.length,
          metadata,
        });
        throw new Error("Document storage failed");
      }

      // Exponential backoff
      await new Promise((resolve) =>
        setTimeout(resolve, 1000 * Math.pow(2, attempt))
      );
    }
  }
};
