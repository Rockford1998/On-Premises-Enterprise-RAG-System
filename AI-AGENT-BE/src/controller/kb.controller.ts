import { Request, Response } from "express";
import { KnowledgeBaseService } from "../services/knowledgebase.service";
import { BotService } from "../services/bot.service";


//  read knowledge base with pagination 
export class KnowledgeBaseController {

  knowledgeBaseService = new KnowledgeBaseService();
  botService = new BotService();
  // 
  readKnowledgeBase = async (req: Request, res: Response) => {
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
      const knowledgeBase = await this.knowledgeBaseService.readKnowledgeBase({ page, limit });

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
  addKnowledgeBase = async (req: Request, res: Response) => {
    const startTime = Date.now();
    try {
      const botId = req.params.botId;
      const result = await this.knowledgeBaseService.processFile({
        botId,
        file: req.file,
      });
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



  //
  deleteKnowledgeBase = async (req: Request, res: Response) => {
    try {
      const { fileName, botId } = req.body;
      console.log("Received request to delete knowledge base:", { fileName, botId });

      // Validate input
      await this.knowledgeBaseService.deleteKnowledgeBase({ fileName, botId })
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


}