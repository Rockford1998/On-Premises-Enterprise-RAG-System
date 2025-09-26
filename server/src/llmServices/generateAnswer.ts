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
}: {
  question: string;
  contextChunks: Array<relevantChunks>;
  instruction: string;
}): Promise<string> => {
  try {
    const baseModel = process.env.BASE_MODEL || "gemma3:4b";
    console.log({ baseModel });
    const OLLAMA_BASE_URL =
      process.env.OLLAMA_BASE_URL || "http://localhost:11434";
    const context = contextChunks
      .map((c, i) => `[Context ${i + 1}]: ${c.content}`)
      .join("\n\n");

    const prompt = `
You are an expert AI assistant designed to provide clear, well-structured, and helpful responses.

## Response Formatting Guidelines

**Mandatory Markdown Formatting:**
- Use **bold text** for key terms, important concepts, and emphasis
- Use \`inline code\` for technical terms, variables, commands, file paths, and code references
- Use **bullet points** (\`-\` or \`*\`) for features, benefits, steps without strict sequence, and item lists
- Use **numbered lists** for sequential instructions, step-by-step guides, and ordered processes
- Use **tables** for comparisons, specifications, pros/cons, and structured data presentation
- Use **code blocks** with language specification for all code snippets:
  \`\`\`language
  // Your code here
  \`\`\`

## Content Structure Principles

**For Technical Explanations:**
- Start with a concise overview
- Break down complex concepts into digestible sections
- Provide practical examples with code when relevant
- Include relevant warnings or best practices

**Quality Standards:**
- Be direct and avoid unnecessary fluff
- Use clear, professional language
- Structure information hierarchically
- Provide complete, copy-paste ready code examples
- Maintain a professional yet approachable tone

Context:
${context}

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
      contextLength: contextChunks.length,
    });
    throw new Error("Failed to generate answer");
  }
};

export const generateStreamAnswer = async (
  query: string,
  contextChunks: Array<relevantChunks>,
  model: string = "llama3.2:latest",
): Promise<string> => {
  try {
    const baseModel = process.env.BASE_MODEL || "llama3.2:latest";
    const OLLAMA_BASE_URL =
      process.env.OLLAMA_BASE_URL || "http://localhost:11434";
    const context = contextChunks
      .map((c, i) => `[Context ${i + 1}]: ${c.content}`)
      .join("\n\n");

    const prompt = `
    You are a helpful assistant. Follow these rules carefully:

        1. Check the provided context for relevant information:
          - If the context contains relevant information, answer the question ONLY using the context.
          - If the context does not contain enough information, answer using your general knowledge.

        2. Always return your answer in **Markdown** format, using a fenced code block with the language set to 'json'.

          3. The JSON object must follow this exact structure:
          {
            "answerSource": "context" | "general",
            "answer": "string (can include markdown formatting such as **bold**, lists, or code blocks)",
            "metadata": {
              "confidence": "high" | "medium" | "low",
              "contextUsed": true | false
            }
          }

          4. Do not add any explanation outside the JSON block.
          5. Ensure the JSON is valid and properly escaped so it can be parsed by a frontend application.

          Context:
          ${context}

          Question:
          ${query}

          Answer:
    `;

    const res = await axios.post(
      `${OLLAMA_BASE_URL}/api/generate`,
      {
        model: baseModel,
        prompt,
        stream: true,
      },
      { responseType: "stream" },
    );

    if (!res.data?.response) {
      throw new Error("Invalid response format from Ollama");
    }

    return res.data.response.trim();
  } catch (error) {
    console.error("Answer generation failed:", {
      error: error instanceof Error ? error.message : String(error),
      query,
      contextLength: contextChunks.length,
    });
    throw new Error("Failed to generate answer");
  }
};
