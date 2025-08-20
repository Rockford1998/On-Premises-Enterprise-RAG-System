import { Request, Response } from "express";
import { generateEmbedding } from "../llmServices/generateEmbedding";
import { BotService } from "../services/bot.service";
import { VectorService } from "../services/vectors.service";
import { generateAnswer } from "../llmServices/generateAnswer";
import axios from "axios";
import { ToolService } from "../services/tool.service";
import { improveTheToolAnswer } from "../llmServices/improveTheToolAnswer";

export class ChatController {
    botService = new BotService();
    toolService = new ToolService();

    // try quering the knowledge base with different questions
    chatBot = async (req: Request, res: Response) => {
        try {
            const { question, botId } = req.body;

            // Step 1: Check if this query requires a tool
            const toolRequest = await this.toolService.detectToolUse({ botId, query: question }) as any
            if (toolRequest) {
                try {
                    const toolResponse: any = await this.toolService.toolExecution({ toolId: toolRequest.id, args: toolRequest.params });
                    const answer = await improveTheToolAnswer({ query: question, context: toolResponse, systemPrompt: toolRequest.systemPrompt });
                    res.status(200).json({
                        success: true,
                        answer,
                        isToolResponse: true,
                        toolUsed: toolRequest.tool
                    });
                    return
                } catch (toolError) {
                    console.error("Tool execution failed:", toolError);
                    // Fall through to normal processing if tool fails
                }
            }

            // Step 2: Proceed with normal vector search flow if no tool was used
            const queryEmbedding = await generateEmbedding(question);
            const bot = await this.botService.readByBotId(botId);
            if (!bot || typeof bot.vectorTable !== 'string') {
                throw new Error("Bot not found or vectorTable is invalid");
            }

            const relevantChunks = await VectorService.searchVectors(
                {
                    tableName: bot.vectorTable,
                    queryEmbedding,
                    options: {}
                }
            );

            if (relevantChunks.length === 0) {
                res.status(200).json({
                    success: false,
                    message: "No relevant information found. Please try a different question.",
                });
                return
            }

            const answer = await generateAnswer(question, relevantChunks);
            res.status(200).json({
                success: true,
                answer: answer,
                isToolResponse: false,
                toolUsed: null,
            });
            return

        } catch (error) {
            console.error(
                "Chatbot error:",
                error instanceof Error ? error.message : String(error),
            );
            res.status(500).json({
                success: false,
                message: "An error occurred while processing your request"
            });
            return
        }
    };

    // Endpoint to handle streaming chat requests
    streamChatBot = async (req: Request, res: Response) => {
        try {
            const baseModel = process.env.BASE_MODEL || "gemma3:4b";
            const { question, botId } = req.body;

            const bot = await this.botService.readByBotId(botId);
            if (!bot || typeof bot.vectorTable !== 'string') {
                throw new Error("Bot not found or vectorTable is invalid");
            }
            // Set headers for streaming
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');

            const originalPrompt = req.body.prompt;

            // Validate input
            if (!originalPrompt?.trim()) {
                res.status(400).json({ error: "Prompt is required" });
                return;
            }

            const queryEmbedding = await generateEmbedding(question);
            const relevantChunks = await VectorService.searchVectors(
                {
                    tableName: bot.vectorTable,
                    queryEmbedding,
                    options: {}
                }
            );

            if (relevantChunks.length === 0) {
                res.write("data: No relevant information found\n\n");
                res.end();
                return;
            }

            // Build prompt with Markdown instructions
            const context = relevantChunks
                .map((c, i) => `### Context Source ${i + 1}\n${c.content}`)
                .join("\n\n");

            const prompt = `Respond using Markdown formatting with:
                    - **Bold** for key terms
                    - \`code\` for technical concepts
                    - Lists for steps
                    - Tables for comparisons

                    Context:
                    ${context}

                    Question:
                    ${originalPrompt}

                    Answer (in Markdown):
                    `;

            const ollamaStream = await axios.post(
                "http://localhost:11434/api/generate",
                {
                    model: baseModel,
                    prompt,
                    stream: true,
                    // Remove the 'format' parameter as Ollama doesn't support it directly
                    options: {
                        temperature: 0.7
                    }
                },
                {
                    responseType: "stream",
                }
            );

            ollamaStream.data.on("data", (chunk: Buffer) => {
                const lines = chunk.toString().split("\n").filter(Boolean);

                for (const line of lines) {
                    try {
                        const parsed = JSON.parse(line);

                        if (parsed.response) {
                            res.write(`data: ${JSON.stringify({ text: parsed.response })}\n\n`);
                        }

                        if (parsed.done) {
                            res.write("event: end\ndata: {}\n\n");
                            res.end();
                            return;
                        }
                    } catch (err) {
                        console.warn("Non-JSON chunk:", line);
                    }
                }
            });


            ollamaStream.data.on("end", () => {
                res.write("event: end\ndata: {}\n\n");
                res.end();
            });

            ollamaStream.data.on("error", (err: Error) => {
                console.error("Stream error:", err.message);
                res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
                res.end();
            });

        } catch (error) {
            console.error("Error in streamChatBot:", error);
            if (!res.headersSent) {
                res.status(500).json({
                    error: "Stream initialization failed",
                    details: error instanceof Error ? error.message : String(error)
                });
            } else {
                res.write(`event: error\ndata: ${JSON.stringify({ error: "Service unavailable" })}\n\n`);
                res.end();
            }
        }
    };

}