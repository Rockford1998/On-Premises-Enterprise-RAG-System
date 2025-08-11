import axios from "axios";
//
export const generateEmbedding = async (text: string): Promise<number[]> => {
  try {
    const EmbeddingModel = process.env.EMBEDDING_MODEL || "nomic-embed-text";
    // Pre-process the text for better embeddings
    const processedText = preprocessText(text);

    const res = await axios.post("http://localhost:11434/api/embeddings", {
      model: EmbeddingModel,
      prompt: processedText,
      options: {
        temperature: 0.1, // More deterministic embeddings
        embedding_mode: "mean", // Better for retrieval tasks
        normalize_embeddings: true, // Important for similarity search
      },
    });

    if (!res.data?.embedding || !Array.isArray(res.data.embedding)) {
      throw new Error("Invalid embedding response from Ollama");
    }

    // Post-process embeddings if needed
    return normalizeVector(res.data.embedding);
  } catch (error: any) {
    console.error("Embedding failed:", {
      error: error.message,
      text: text.substring(0, 100) + (text.length > 100 ? "..." : ""),
    });
    throw error;
  }
};



// Helper functions
function preprocessText(text: string): string {
  return text
    .replace(/\s+/g, " ") // Normalize whitespace
    .replace(/[^\w\s.-]/g, "") // Remove special chars (keep basic punctuation)
    .trim()
    .toLowerCase(); // Optional: case normalization
}

function normalizeVector(vector: number[]): number[] {
  const norm = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
  return norm > 0 ? vector.map((v) => v / norm) : vector;
}
