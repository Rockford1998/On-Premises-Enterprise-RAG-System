import { Request, Response } from "express";
import { BotService } from "../services/bot.service";
import { UserService } from "../services/user.service";
import { VectorService } from "../services/vectors.service";

export class BotController {
    botService = new BotService();
    userService = new UserService();

    //
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
            res.status(400).json({ error: "Failed to read bots" });
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
            res.status(400).json({ error: "Failed to read bot" });
        }
    };

    // Create a new bot
    create = async (req: Request, res: Response) => {
        let newBot = null;
        try {

            // body will contains
            const test = {
                botName: "Mark1",
                botDesc: "Mark1 is a test bot",
                userName: "string",
                owner: "s.b@gmail.com.",
            }

            const botData = req.body;
            const owner = await this.userService.findByUserName(botData.userName);
            if (!owner) {
                res.status(404).json({ error: "Owner not found" });
                return;
            }

            const timestamp = Date.now().toString(36); // base36 to shorten
            const random = Math.random().toString(36).substring(2, 8).toUpperCase(); // 6 random alphanumeric chars
            const botId = `bot_${timestamp}_${random}`;
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
                owner,
                botUsers: {
                    users: [owner.email],
                    totalUsersCount: 1,
                },
            };

            newBot = await this.botService.create(data);
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
            if (newBot && newBot.botId)
                await this.botService.deleteById(newBot.botId);
            console.error("Error creating bot:", error);
            res.status(400).json({ error: "Failed to create bot" });
        }
    };

    // update user
    update = async (req: Request, res: Response) => {
        try {
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
            const botId = req.params.botId;
            await this.botService.deleteById(botId);
            await VectorService.deleteTable(`vector_table_${botId}`);
            res.status(200).json("Bot was deleted successfully.");
        } catch (error) {
            console.log(error);
            res.status(400).json({ error: "Failed to update bot" });
        }
    };
}
