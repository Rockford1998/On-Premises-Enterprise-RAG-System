import { generateEmbedding } from "../llmServices/generateEmbedding";
import { generateAnswer } from "../llmServices/generateAnswer";
import { Request, Response } from "express";
import axios from "axios";
import { VectorService } from "../services/vectorService";
import { KbService } from "../services/kb.service";


//  read knowledge base with pagination 
export const readKnowledgeBase = async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.size as string) || 10;

    // Validate pagination parameters
    if (page < 1 || limit < 1) {
      res.status(400).json({
        success: false,
        message: "Page and limit must be positive integers",
      });
      return
    }

    // Read knowledge base with pagination
    const knowledgeBase = await KbService.readKnowledgeBase({ page, limit });

    if (!knowledgeBase || knowledgeBase.length === 0) {
      res.status(404).json({
        success: false,
        message: "No knowledge base entries found",
      });
      return
    }

    res.status(200).json({
      success: true,
      data: knowledgeBase,
      page,
      limit,
    });
  } catch (error) {
    console.error("Error reading knowledge base:", error);
  }
}

//
export const addKnowledgeBase = async (req: Request, res: Response) => {
  const startTime = Date.now();
  try {
    const result = await KbService.processFile(req.file);

    const duration = (Date.now() - startTime) / 1000;
    res.status(result.status).json({
      ...result.body,
      duration: `${duration.toFixed(2)} seconds`,
    });
  } catch (error) {
    const duration = (Date.now() - startTime) / 1000;
    console.error("Training failed after", duration, "seconds:", error);
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : "Training failed",
      duration: `${duration.toFixed(2)} seconds`,
    });
  }
};

// try quering the knowledge base with different questions
export const chatBot = async (req: Request, res: Response) => {
  try {
    const originalPropmt = req.body.prompt;
    const queryEmbedding = await generateEmbedding(originalPropmt);

    // Get relevant chunks with threshold
    const relevantChunks = await VectorService.searchVectors(
      "document_embeddings",
      queryEmbedding,
    );

    if (relevantChunks.length === 0) {
      console.warn("No relevant chunks found above similarity threshold");
      return;
    }
    // Extract just the content for the answer generation
    const answer = await generateAnswer(originalPropmt, relevantChunks);
    res.status(200).json({
      success: true,
      answer: answer,
    });

    console.log("Answer:", answer);
  } catch (error) {
    console.error(
      "Test failed:",
      error instanceof Error ? error.message : String(error),
    );
  }
};

// Endpoint to handle streaming chat requests
export const streamChatBot = async (req: Request, res: Response) => {
  try {
    const baseModel = process.env.BASE_MODEL || "gemma3:4b";

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

    const queryEmbedding = await generateEmbedding(originalPrompt);
    const relevantChunks = await VectorService.searchVectors(
      "document_embeddings",
      queryEmbedding,
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

//
export const deleteKnowledgeBase = async (req: Request, res: Response) => {
  try {
    const { fileName } = req.params;
    await KbService.deleteKnowledgeBase({ fileName })
    res.status(200).json({
      success: true,
      message: `Knowledge base ${fileName} deleted successfully`,
    });
    return;

  } catch (error) {
    console.error("Error deleting knowledge base:", error);
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : "Failed to delete knowledge base",
    });
  }
}

