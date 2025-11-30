import { Request, Response } from "express";
import { BotService } from "../services/bot.service";
import { UserService } from "../services/user.service";
import { VectorService } from "../services/vectors.service";
import { sendResponse } from "../util/sendResponse";
import { getBotInstructionByBotRequest } from "../util/getBotInstructionByBotRequest";
import { LlmModelService } from "../services/llmModel.service";

export class BotController {
    botService = new BotService();
    userService = new UserService();
    llmService = new LlmModelService()
    //
    readBots = async (req: Request, res: Response) => {
        try {
            const { page = 1, limit = 10, users } = req.query;

            const bots = await this.botService.read({
                page: Number(page),
                limit: Number(limit),
                users: typeof users === 'string' ? users : undefined,
            });

            sendResponse({
                res,
                success: true,
                pagination: true,
                message: "Bots retrieved successfully",
                data: {
                    data: bots,
                    page: Number(page),
                    limit: Number(limit),
                    total: bots.length,
                },
                status: 200,
            });
        } catch (error) {
            console.error("Error reading bots:", error);
            sendResponse({
                res,
                success: false,
                message: "Failed to read bots",
                status: 400,
            });
        }
    };

    //
    readBotById = async (req: Request, res: Response) => {
        try {
            const { botId } = req.params;
            const bot = await this.botService.readByBotId(botId);
            if (!bot) {
                sendResponse({ res, success: false, message: "Bot not found", status: 404 });
                return
            }
            sendResponse({ res, success: true, message: "Bot retrieved successfully", data: bot, status: 200 });
        } catch (error) {
            console.error("Error reading bot by ID:", error);
            sendResponse({ res, success: false, message: "Failed to read bot", status: 400 });
        }
    };

    readBotByOwner = async (req: Request, res: Response) => {
        try {

            const { owner } = req.params;
            console.log("Reading bot by owner field:", owner);
            const bot = await this.botService.readByBotOwner(owner);
            if (!bot) {
                sendResponse({ res, success: false, message: "Bot not found", status: 404 });
                return;
            }
            sendResponse({ res, success: true, message: "Bot retrieved successfully", data: bot, status: 200 });
        } catch (error) {
            console.error("Error reading bot by ID:", error);
            sendResponse({ res, success: false, message: "Failed to read bot", status: 400 });
        }
    };

    // Create a new bot
    create = async (req: Request, res: Response) => {
        let newBot = null;
        try {
            const botReq = req.body;
            const owner = await this.userService.findByEmail(botReq.owner);
            if (!owner) {
                sendResponse({ res, success: false, message: "Owner not found", status: 404 });
                return;
            }

            const timestamp = Date.now().toString(36); // base36 to shorten
            const random = Math.random().toString(36).substring(2, 8).toUpperCase(); // 6 random alphanumeric chars
            const botId = `bot_${timestamp}_${random}`;

            // create a new bot profile
            const baseModel = await this.llmService.readByName(process.env.BASE_MODEL || "mistral:latest")
            if (!baseModel) {
                sendResponse({ res, success: false, message: "Base model not found", status: 400 });
                return;
            }
            const embedModel = await this.llmService.readByName(process.env.EMBED_MODEL || "nomic-embed-text")
            if (!embedModel) {
                sendResponse({ res, success: false, message: "Embed model not found", status: 400 });
                return;
            }
            // const toolModel = await this.llmService.readByName(process.env.EMBED_MODEL || "nomic-embed-text")
            const toolModel = baseModel;
            const data = {
                botId,
                botName: botReq.botName,
                botDesc: botReq.botDesc,
                isActive: true,
                botType: botReq.botType,
                baseModel,
                embedModel,
                toolModel,
                instruction: getBotInstructionByBotRequest({ botReq, owner }),
                kbsearchMethod: "semantic",
                vectorTable: `vector_table_${botId}`,
                publicAccess: false,
                owner,
                botUsers: {
                    users: [owner.email],
                    totalUsersCount: 1,
                },
                stats: {
                    apiTokenCount: 0,
                    kbDocCount: 0,
                    kbDocSize: 0,
                    kbVectorCount: 0,
                    chatMsgCount: 0,           // message count in 30 days
                },
            };

            newBot = await this.botService.create(data);
            if (botReq.botType != "General_Purpose") {
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
            }

            sendResponse({ res, success: true, message: "Bot created successfully", data: newBot, status: 201 });
        } catch (error) {
            if (newBot && newBot.botId)
                await this.botService.deleteById(newBot.botId);
            console.error("Error creating bot:", error);
            sendResponse({ res, success: false, message: "Failed to create bot", status: 400 });
        }
    };

    update = async (req: Request, res: Response) => {
        try {
            const botId = req.params.botId;
            const botReq = req.body;
            const oldBot = await this.botService.readByBotId(botId);
            if (!oldBot) {
                sendResponse({
                    res,
                    success: false,
                    message: "Bot profile not found.",
                    status: 404,
                });
                return
            }
            const validateModel = async (modelName: string, fieldName: string) => {
                const model = await this.llmService.readByName(modelName);
                if (!model) {
                    throw new Error(`Invalid model for ${fieldName}: ${modelName}`);
                }
                return model;
            };
            console.log("baseModel", botReq.baseModel)
            console.log("baseModel", oldBot.baseModel?.name)
            if (
                botReq.baseModel &&
                oldBot.baseModel?.name !== botReq.baseModel
            ) {

                botReq.baseModel = await validateModel(botReq.baseModel, "baseModel");
            } else {
                delete botReq.baseModel
            }

            if (
                botReq.embedModel &&
                oldBot.embedModel?.name !== botReq.embedModel
            ) {
                botReq.embedModel = await validateModel(botReq.embedModel, "embedModel");
            } else {
                delete botReq.embedModel
            }

            if (
                botReq.toolModel &&
                oldBot.toolModel?.name !== botReq.toolModel
            ) {
                botReq.toolModel = await validateModel(botReq.toolModel, "toolModel");
            } else {
                delete botReq.toolModel
            }

            console.log(botReq.baseModel)
            const updatedBot = await this.botService.updateById(botId, botReq);

            sendResponse({
                res,
                success: true,
                message: "Bot updated successfully",
                data: updatedBot,
                status: 200,
            });
        } catch (error: any) {
            console.error(error);
            sendResponse({
                res,
                success: false,
                message: error.message || "Failed to update bot",
                status: 400, // 400 because user input invalid
            });
        }
    };


    delete = async (req: Request, res: Response) => {
        try {
            const botId = req.params.botId;
            await this.botService.deleteById(botId);
            await VectorService.deleteTable(`vector_table_${botId}`);
            sendResponse({ res, success: true, message: "Bot deleted successfully", status: 200 });
        } catch (error) {
            console.log(error);
            sendResponse({ res, success: false, message: "Failed to delete bot", status: 400 });
        }
    };
}
