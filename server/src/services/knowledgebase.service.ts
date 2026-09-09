import fs from 'fs';
import path from 'path';
import { VectorService } from './vectors.service';
import { generateFileHash } from '../util/generateFileHash';
import { readFile } from '../util/readFile';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import { embedChunkWithRetry, EmbeddedChunk } from './storeEmbeddedDocument';
import { KnowledgeBase } from '../models/shared.model';
import { BotService } from './bot.service';
import { Actor, assertCanManage, assertCanView } from '../util/botAccess';

export class KnowledgeBaseService {
    botService = new BotService();
    //
    readKnowledgeBase = async ({ page, limit }: { page: number; limit: number }) => {
        const skip = (page - 1) * limit;
        return await KnowledgeBase.find().skip(skip).limit(limit).exec();
    }

    // Resolves the entry's botId first so ownership can be checked even
    // though the caller only has the KB entry's own id.
    readById = async (id: string, actor: Actor) => {
        const entry = await KnowledgeBase.findById(id).exec();
        if (!entry) return null;
        const bot = await this.botService.readByBotId(entry.botId);
        if (!bot) return null;
        assertCanView(bot, actor);
        return entry;
    }

    readByBotId = async ({ botId, actor }: { botId: string; actor: Actor }) => {
        const bot = await this.botService.readByBotId(botId);
        if (!bot) return [];
        assertCanView(bot, actor);
        return await KnowledgeBase.find({ botId }).exec();
    }

    //
    deleteKnowledgeBase = async ({ fileName, botId, actor }: { fileName: string, botId: string, actor: Actor }): Promise<void> => {

        const bot = await this.botService.readByBotId(botId);
        console.log("Bot details:", bot);
        if (!bot || typeof bot.vectorTable !== 'string') {
            throw new Error("Bot not found or vectorTable is invalid");
        } else {
            assertCanManage(bot, actor);

            // Delete from vector DB
            await VectorService.deleteOutdatedKnowledgeByFileName({ fileName, tableName: bot.vectorTable });
            // Delete from MongoDB
            await KnowledgeBase.deleteMany({ fileName });
            // Delete from file system
            const safeFileName = path.basename(fileName);
            const safeBotId = path.basename(botId);
            const filePath = path.join(__dirname, '..', '..', 'uploads', safeBotId, safeFileName);


            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                console.log("File deleted.");
            } else {
                console.log("File does not exist.");
            }

        }

    }

    //
    processFile = async ({ botId, file, actor }: { botId: string, file: Express.Multer.File | undefined, actor: Actor }) => {
        if (!file) {
            return {
                status: 400,
                body: { success: false, message: "No file uploaded" },
            };
        }

        // path.basename mirrors what uploadMiddleware already applied when it
        // wrote the file — re-sanitising here keeps this path in sync with
        // where the file actually landed, instead of trusting the raw param.
        const safeBotId = path.basename(botId);
        const filePath = `uploads/${safeBotId}/${file.filename}`;
        const fileHash = await generateFileHash({ filePath });
        // bot for file
        const bot = await this.botService.readByBotId(botId);
        if (!bot || typeof bot.vectorTable !== 'string') {
            throw new Error("Bot not found or vectorTable is invalid");
        }
        assertCanManage(bot, actor);
        const vectorTable = bot.vectorTable;
        const alreadyExists = await VectorService.CheckIfkBPresentByFileHash({ fileHash, TABLE_NAME: vectorTable });
        if (alreadyExists) {
            return {
                status: 200,
                body: {
                    success: true,
                    message: "Knowledge base already exists for this file",
                },
            };
        }

        const docs = await readFile({ fileName: file.filename, filePath });

        const rawText = docs.map(doc => doc.pageContent).join("\n").trim();
        if (!rawText) throw new Error("Extracted text is empty");

        //
        const chunkSize = 400;
        const chunkOverlap = 20;
        const splitter = new RecursiveCharacterTextSplitter({ chunkSize, chunkOverlap });
        const chunks = await splitter.splitText(rawText);

        const batchSize = 5;

        // Embeddings only ever accumulate in memory here — nothing is written
        // to Postgres or Mongo until every chunk has embedded successfully, so
        // a failure partway through never leaves a document half-indexed.
        let embedded: EmbeddedChunk[];
        try {
            const collected: EmbeddedChunk[] = [];
            for (let i = 0; i < chunks.length; i += batchSize) {
                const batch = chunks.slice(i, i + batchSize);
                const results = await Promise.all(
                    batch.map((chunk, index) =>
                        embedChunkWithRetry({
                            text: chunk,
                            metadata: {
                                source: filePath,
                                timestamp: new Date().toISOString(),
                                chunkIndex: i + index,
                                totalChunks: chunks.length,
                                fileName: file.originalname,
                                fileHash,
                            },
                        }),
                    ),
                );
                for (const result of results) {
                    if (result) collected.push(result);
                }
            }
            embedded = collected;

            // One statement: either every chunk lands or none does. Replaces
            // the old per-chunk insert + delete-by-hash rollback dance.
            await VectorService.batchInsertVectors(vectorTable, embedded);
        } catch (error) {
            console.error(`Failed to process file ${file.originalname}:`, error);

            // Nothing reached Postgres or Mongo — only the uploaded file
            // itself needs cleaning up.
            const safeFileName = path.basename(file.originalname);
            const rollbackFilePath = path.join(__dirname, '..', '..', 'uploads', safeBotId, safeFileName);
            if (fs.existsSync(rollbackFilePath)) {
                fs.unlinkSync(rollbackFilePath);
                console.log("File deleted.");
            }

            return {
                status: 500,
                body: {
                    success: false,
                    message: `Unable to process file ${file.originalname}.`,
                    chunksTotal: chunks.length,
                },
            };
        }

        // Save the knowledge base entry to MongoDB
        await KnowledgeBase.create({
            botId: botId,
            fileSize: file.size,
            fileHash,
            fileName: file.originalname,
            type: file.mimetype,
            content: rawText,
            source: filePath,
            downloadUrl: filePath,
        });

        return {
            status: 200,
            body: {
                success: true,
                message: `Processed ${embedded.length}/${chunks.length} chunks successfully`,
                chunksTotal: chunks.length,
                chunksProcessed: embedded.length,
            },
        };
    }
}
