import { Request, Response } from "express";
import { KnowledgeBaseService } from "../services/knowledgebase.service";
import { BotService } from "../services/bot.service";
import { sendResponse } from "../util/sendResponse";
import path from "path";
import fs from "fs";


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
        sendResponse({ res, success: false, message: "No knowledge base entries found", status: 404 });
      }

      sendResponse({
        res, success: true, pagination: true, message: "Knowledge base retrieved successfully", data: {
          page,
          limit,
          total: knowledgeBase.length,
          data: knowledgeBase
        },
        status: 200
      });
    } catch (error) {
      console.error("Error reading knowledge base:", error);
      sendResponse({ res, success: false, message: "Failed to read knowledge base", status: 500 });
    }
  }

  readById = async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const knowledgeBaseEntry = await this.knowledgeBaseService.readById(id);
      if (!knowledgeBaseEntry) {
        sendResponse({ res, success: false, message: "Knowledge base entry not found", status: 404 });
        return;
      }
      sendResponse({ res, success: true, message: "Knowledge base entry retrieved successfully", data: knowledgeBaseEntry, status: 200 });
    } catch (error) {
      console.error("Error reading knowledge base entry by ID:", error);
      sendResponse({ res, success: false, message: "Failed to read knowledge base entry", status: 500 });
    }
  };

  readBybotId = async (req: Request, res: Response) => {
    try {
      const { botId } = req.params;
      const knowledgeBaseEntry = await this.knowledgeBaseService.readByBotId({ botId });
      sendResponse({ res, success: true, message: "Knowledge base entry retrieved successfully", data: knowledgeBaseEntry, status: 200 });
    } catch (error) {
      console.error("Error reading knowledge base entry by ID:", error);
      sendResponse({ res, success: false, message: "Failed to read knowledge base entry", status: 500 });
    }
  };

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
      const responseBody = { ...result.body, duration };
      sendResponse({
        res,
        success: true,
        message: "File added to knowledge base successfully.",
        data: responseBody,
        status: 201,
      });
    } catch (error) {
      const duration = (Date.now() - startTime) / 1000;
      console.error(`Training failed after ${duration} seconds:`, error);
      sendResponse({
        res,
        success: false,
        message: error instanceof Error ? error.message : `Training failed after ${duration} seconds`,
        status: 500,
      });
    }
  };

  downloadFile = async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const file = await this.knowledgeBaseService.readById(id)
      if (file) {
        const safeFilePath = path.join(__dirname, "..", "..", file?.downloadUrl);
        console.log(safeFilePath)
        if (!fs.existsSync(safeFilePath)) {
          sendResponse({
            res,
            success: false,
            message: "File not found.",
            status: 500,
          })
          return
        }

        const fileName = path.basename(safeFilePath);
        res.download(safeFilePath, fileName, (err) => {
          if (err) res.status(500).send({ message: "Error while downloading file." });
        });

      } else {
        sendResponse({
          res,
          success: false,
          message: "File not found.",
          status: 500,
        })
        return
      }
    } catch (error) {
      console.log(error)
      sendResponse({
        res,
        success: false,
        message: "Unable to download file currently.",
        status: 500,
      })

    }
  };



  //
  deleteKnowledgeBase = async (req: Request, res: Response) => {
    try {
      const { fileName, botId } = req.body;
      console.log("Received request to delete knowledge base:", { fileName, botId });
      // Validate input
      await this.knowledgeBaseService.deleteKnowledgeBase({ fileName, botId })
      sendResponse({
        res,
        success: true,
        message: `Knowledge base ${fileName} deleted successfully`,
        status: 200,
      });
      return;

    } catch (error) {
      console.error("Error deleting knowledge base:", error);
      sendResponse({
        res,
        success: false,
        message: error instanceof Error ? error.message : "Failed to delete knowledge base",
        status: 500,
      });
    }
  }


}