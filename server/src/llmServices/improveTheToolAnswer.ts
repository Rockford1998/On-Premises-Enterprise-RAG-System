import axios from "axios";

type relevantChunks = {
    id: number;
    content: string;
    metadata: Record<string, any>;
    distance: number;
};

export const improveTheToolAnswer = async (
    { query, context, systemPrompt, model = "llama3.2:latest" }: {
        query: string,
        context: any,
        model?: string,
        systemPrompt: string
    }
): Promise<string> => {
    const formattedContext =
        typeof context === "string"
            ? context
            : JSON.stringify(context, null, 2);

    try {
        const baseModel = process.env.BASE_MODEL || "gemma3:4b";
        const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
        const prompt = `
                        SYSTEM INSTRUCTIONS:
                        ${systemPrompt}

                        RULES:
                        - Use ONLY the provided context
                        - If a value is missing, say "I don't know"

                        Context:
                        ${formattedContext}

                        Question:
                        ${query}

                        Answer:
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
            query,
            contextLength: context.length,
        });
        throw new Error("Failed to generate answer");
    }
};