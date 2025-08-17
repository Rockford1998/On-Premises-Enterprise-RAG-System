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
    try {
        const baseModel = process.env.BASE_MODEL || "gemma3:4b";
        const prompt = `Answer the following question using only the context below. If the context does not contain the answer, say "I don't know."
        
                    ${systemPrompt}

                    Context:
                    ${context}

                    Question:
                    ${query}

                    Answer:
                    `;

        const res = await axios.post("http://localhost:11434/api/generate", {
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