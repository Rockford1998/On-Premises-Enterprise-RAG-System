import { Request, Response } from "express";
import { BotService } from "../services/bot.service";
import { UserService } from "../services/user.service";
import { generateBotId } from "../services/shared.service";
import { VectorService } from "../services/vectorService";
import { table } from "console";

export class BotController {
  botService = new BotService();
  userService = new UserService();
  readBots = async (req: Request, res: Response) => {
    try {
      const { page = 1, limit = 10 } = req.query;
      const bots = await this.botService.read({
        page: Number(page),
        limit: Number(limit),
      });
      res.status(200).json(bots);
    } catch (error) {
      console.error("Error reading bots:", error);
      res.status(500).json({ error: "Failed to read bots" });
    }
  };

  //
  readBotById = async (req: Request, res: Response) => {
    try {
      const { botId } = req.params;
      const bot = await this.botService.readById(botId);
      if (!bot) {
        res.status(404).json({ error: "Bot not found" });
        return;
      }
      res.status(200).json(bot);
    } catch (error) {
      console.error("Error reading bot by ID:", error);
      res.status(500).json({ error: "Failed to read bot" });
    }
  };

  // Create a new bot
  create = async (req: Request, res: Response) => {
    try {
      // body will contains
      // {
      //     botName: string
      //     botDesc : string;
      //     userName : string;
      //     owner: string
      // }

      const botData = req.body;
      const owner = await this.userService.findByUserName(botData.userName);
      if (!owner) {
        res.status(404).json({ error: "Owner not found" });
        return;
      }

      const botId = generateBotId();
      // create a new bot profile
      const data = {
        botId,
        botName: botData.botName,
        botDesc: botData.botDesc,
        isActive: true,
        baseModel: process.env.BASE_MODEL || "mistral:latest",
        embedModel: process.env.EMBED_MODEL || "BASE_EMBEDDING_MODEL",
        toolModel: process.env.TOOL_MODEL || "mistral:latest",
        instruction: "You are a helpful assistant.",
        kbsearchMethod: "semantic",
        vectorTable: `vector_table_${botId}`,
        publicAccess: false,
        owner: owner,
        botUsers: {
          users: [owner.email],
          totalUsersCount: 1,
        },
      };

      const newBot = await this.botService.create(botData);
      // create a vector table for the bot
      const vectorTableName = data.vectorTable;
      await VectorService.createTableWithIndex({
        tableName: vectorTableName,
        dimensions: 768,
        indexParams: {
          type: "hnsw",
          m: 16,
          efConstruction: 200,
        },
      });
      res.status(201).json(newBot);
    } catch (error) {
      console.error("Error creating bot:", error);
      res.status(500).json({ error: "Failed to create bot" });
    }
  };

  // update user
  update = async (req: Request, res: Response) => {
    try {
      //   botId,
      //   botName: botData.botName,
      //   botDesc: botData.botDesc,
      //   isActive: true,
      //   baseModel: process.env.BASE_MODEL || "mistral:latest",
      //   embedModel: process.env.EMBED_MODEL || "BASE_EMBEDDING_MODEL",
      //   toolModel: process.env.TOOL_MODEL || "mistral:latest",
      //   instruction: "You are a helpful assistant.",
      //   kbsearchMethod: "semantic",
      //   publicAccess: false,
      //   owner: owner,
      //   botUsers: {
      //     users: [owner.email],
      //     totalUsersCount: 1,
      //   },
      const botID = req.params.botId;
      const botData = req.body;
      const updatedBotInfo = await this.botService.updateById(botID, botData);
      res.status(201).json(updatedBotInfo);
    } catch (error: any) {
      console.log(error);
      res.status(400).json({ error: "Failed to update bot" });
    }
  };

  delete = async (req: Request, res: Response) => {
    try {
      const botId = req.body.botId;
      await this.botService.deleteById(botId);
      res.status(200).json("Bot was deleted successfully.");
    } catch (error) {
      console.log(error);
      res.status(400).json({ error: "Failed to update bot" });
    }
  };
}
