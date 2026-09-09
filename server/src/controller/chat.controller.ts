import { Request, Response } from "express";
import { generateEmbedding } from "../llmServices/generateEmbedding";
import { BotService } from "../services/bot.service";
import { VectorService } from "../services/vectors.service";
import { generateAnswer } from "../llmServices/generateAnswer";
import { ToolService } from "../services/tool.service";
import { improveTheToolAnswer } from "../llmServices/improveTheToolAnswer";

const parsePositiveInt = (raw: string | undefined, fallback: number): number => {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const parsePositiveFloat = (raw: string | undefined): number | undefined => {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

// Retrieval tuning. TOP_K bounds how many chunks reach the model; KB_MAX_DISTANCE
// (cosine distance, lower = closer) drops chunks that matched but aren't
// actually relevant — previously every search used LIMIT 10 with no cutoff.
const TOP_K = parsePositiveInt(process.env.TOP_K, 5);
const KB_MAX_DISTANCE = parsePositiveFloat(process.env.KB_MAX_DISTANCE);
// ef_search should exceed the requested limit for HNSW to have room to find
// the true nearest neighbours rather than just the first ones it walks past.
const EF_SEARCH = Math.max(TOP_K * 4, 40);

export class ChatController {
  botService = new BotService();
  toolService = new ToolService();

  // try quering the knowledge base with different questions
  chatBot = async (req: Request, res: Response) => {
    try {
      const { question, botId } = req.body;
      // Step 1: Check if this query requires a tool
      const tool = (await this.toolService.detectToolUse({
        botId,
        query: question,
      })) as any;
      if (tool) {
        try {
          const toolResponse: any = await this.toolService.toolExecution({
            tool: tool.toolData,
            args: tool.params,
          });
          if (toolResponse?.error) {
            throw new Error(toolResponse.content || "Tool execution failed");
          }
          const answer = await improveTheToolAnswer({
            query: question,
            context: toolResponse.content,
            systemPrompt: tool.toolData.systemPrompt,
          });
          res.status(200).json({
            success: true,
            answer,
            isToolResponse: true,
            toolUsed: tool.toolData.name,
          });
          return;
        } catch (toolError) {
          console.error("Tool execution failed:", toolError);
          // Fall through to normal processing if tool fails
        }
      }

      const bot = await this.botService.readByBotId(botId);
      let contextChunks = null
      if (bot?.botType !== "General_Purpose") {
        // Proceed with normal vector search flow if no tool was used
        const queryEmbedding = await generateEmbedding(question);
        if (!bot || typeof bot?.vectorTable !== "string") {
          throw new Error("Bot not found or vectorTable is invalid");
        }

        const rawChunks = await VectorService.searchVectors({
          tableName: bot?.vectorTable || "",
          queryEmbedding,
          options: { limit: TOP_K, efSearch: EF_SEARCH },
        });

        contextChunks =
          KB_MAX_DISTANCE !== undefined
            ? rawChunks.filter((c) => c.distance <= KB_MAX_DISTANCE)
            : rawChunks;

        if (contextChunks.length === 0 && bot?.botType == "KB_Bot") {
          res.status(200).json({
            success: false,
            message:
              "No relevant information found.",
          });
          return;
        }
      }
      const answer = await generateAnswer({
        question,
        contextChunks,
        instruction: bot?.instruction || "",
        baseModel: bot?.baseModel?.name || "default"
      });
      res.status(200).json({
        success: true,
        answer: answer,
        isToolResponse: false,
        toolUsed: null,
      });
      return;
    } catch (error) {
      console.error(
        "Chatbot error:",
        error instanceof Error ? error.message : String(error),
      );
      res.status(500).json({
        success: false,
        message: "An error occurred while processing your request",
      });
      return;
    }
  };
}
