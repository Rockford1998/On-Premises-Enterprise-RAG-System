import fs from 'fs';
import path from 'path';
import { VectorService } from './vectors.service';
import { generateFileHash } from '../util/generateFileHash';
import { readFile } from '../util/readFile';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import { storeEmbeddedDocument } from './storeEmbeddedDocument';
import { KnowledgeBase } from '../models/shared.model';
import { BotService } from './bot.service';

export class KnowledgeBaseService {
    botService = new BotService();
    //
    readKnowledgeBase = async ({ page, limit }: { page: number; limit: number }) => {
        const skip = (page - 1) * limit;
        return await KnowledgeBase.find().skip(skip).limit(limit).exec();
    }

    //
    deleteKnowledgeBase = async ({ fileName, botId }: { fileName: string, botId: string }): Promise<void> => {

        const bot = await this.botService.readByBotId(botId);
        console.log("Bot details:", bot);
        if (!bot || typeof bot.vectorTable !== 'string') {
            throw new Error("Bot not found or vectorTable is invalid");
        } else {

            // Delete from vector DB
            await VectorService.deleteOutdatedKnowledgeByFileName({ fileName, tableName: bot.vectorTable });
            // Delete from MongoDB
            await KnowledgeBase.deleteMany({ fileName });
            // Delete from file system
            const safeFileName = path.basename(fileName);
            const safeBotId = path.basename(botId);
            const filePath = path.join(__dirname, '..', 'uploads', safeBotId, safeFileName);

            console.log("Trying to delete file:", filePath);

            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                console.log("File deleted.");
            } else {
                console.log("File does not exist.");
            }

        }

    }

    //
    processFile = async ({ botId, file }: { botId: string, file: Express.Multer.File | undefined }) => {
        if (!file) {
            return {
                status: 400,
                body: { success: false, message: "No file uploaded" },
            };
        }

        const filePath = `uploads/${botId}/${file.filename}`;
        const fileHash = await generateFileHash({ filePath });
        // bot for file 
        const bot = await this.botService.readByBotId(botId);
        if (!bot || typeof bot.vectorTable !== 'string') {
            throw new Error("Bot not found or vectorTable is invalid");
        }
        const alreadyExists = await VectorService.CheckIfkBPresentByFileHash({ fileHash, TABLE_NAME: bot.vectorTable });
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

        let successCount = 0;
        const batchSize = 5;

        for (let i = 0; i < chunks.length; i += batchSize) {
            const batch = chunks.slice(i, i + batchSize);
            await Promise.all(
                batch.map(async (chunk, index) => {
                    try {
                        await storeEmbeddedDocument({
                            tableName: bot.vectorTable as string,
                            text: chunk,
                            metadata: {
                                source: filePath,
                                timestamp: new Date().toISOString(),
                                chunkIndex: i + index,
                                totalChunks: chunks.length,
                                fileName: file.originalname,
                                fileHash,
                            },
                        });
                        successCount++;
                    } catch (error) {
                        console.error(`Failed to process chunk ${i + index}:`, error);
                    }
                }),
            );
        }


        // fall back if not all chunks were processed successfully
        if (successCount < chunks.length) {
            if (!bot || typeof bot.vectorTable !== 'string') {
                throw new Error("Bot not found or vectorTable is invalid");
            } else {

                await VectorService.deleteOutdatedKnowledgeByFileHash({ fileHash, tableName: bot.vectorTable });
                return {
                    status: 500,
                    body: {
                        success: false,
                        message: `Unable to process file ${file.originalname}.`,
                        chunksTotal: chunks.length,
                        chunksProcessed: successCount,
                    },
                };
            }
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
                message: `Processed ${successCount}/${chunks.length} chunks successfully`,
                chunksTotal: chunks.length,
                chunksProcessed: successCount,
            },
        };
    }
}
