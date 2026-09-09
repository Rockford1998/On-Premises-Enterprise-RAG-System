import axios from "axios";

type relevantChunks = {
  id: number;
  content: string;
  metadata: Record<string, any>;
  distance: number;
};

export const generateAnswer = async ({
  question,
  contextChunks,
  instruction,
  baseModel
}: {
  question: string;
  contextChunks: Array<relevantChunks> | null;
  instruction: string;
  baseModel: string
}): Promise<string> => {
  try {
    const OLLAMA_BASE_URL =
      process.env.OLLAMA_BASE_URL || "http://localhost:11434";
    let context = ""

    if (contextChunks) {
      context = contextChunks
        .map((c, i) => `[Context ${i + 1}]: ${c.content}`)
        .join("\n\n");
    }

    let prompt = `
        Instructions:
        ${instruction}
        `;

    if (context) {
      prompt += `
        Context:
        ${context}
        `;
    }

    prompt += `
        Question:
        ${question}

        Answer (in Markdown):
        `;

    const res = await axios.post(`${OLLAMA_BASE_URL}/api/generate`, {
      model: baseModel,
      prompt,
      stream: false,
    });
    if (!res.data?.response) {
      throw new Error("Invalid response format from Ollama");
    }
    return res.data.response.trim();
  } catch (error) {
    console.error("Answer generation failed:", {
      error: error instanceof Error ? error.message : String(error),
      question,
    });
    throw new Error("Failed to generate answer");
  }
};
