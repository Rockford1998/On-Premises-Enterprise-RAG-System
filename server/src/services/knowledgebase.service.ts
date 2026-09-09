import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { VectorService } from './vectors.service';
import { generateFileHash } from '../util/generateFileHash';
import { readFile } from '../util/readFile';
import { extractZipEntries } from '../util/extractZipEntries';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import { embedChunkWithRetry, EmbeddedChunk } from './storeEmbeddedDocument';
import { KnowledgeBase } from '../models/shared.model';
import { BotService } from './bot.service';
import { Actor, assertCanManage, assertCanView } from '../util/botAccess';

type IngestOutcome =
    | { status: "created"; fileName: string; chunksTotal: number; chunksProcessed: number }
    | { status: "duplicate"; fileName: string }
    | { status: "empty"; fileName: string }
    | { status: "failed"; fileName: string; reason: string };

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

    // Shared chunk → embed → store core. Used for both a single uploaded
    // file and each individual file extracted from a .zip, so both paths
    // get identical dedup, chunking, and rollback behaviour.
    private ingestText = async ({
        botId,
        vectorTable,
        fileName,
        fileType,
        rawText,
        fileHash,
        fileSize,
        source,
        downloadUrl,
    }: {
        botId: string;
        vectorTable: string;
        fileName: string;
        fileType: string;
        rawText: string;
        fileHash: string;
        fileSize: number;
        source: string;
        downloadUrl: string;
    }): Promise<IngestOutcome> => {
        const alreadyExists = await VectorService.CheckIfkBPresentByFileHash({ fileHash, TABLE_NAME: vectorTable });
        if (alreadyExists) {
            return { status: "duplicate", fileName };
        }

        if (!rawText.trim()) {
            return { status: "empty", fileName };
        }

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
                                source,
                                timestamp: new Date().toISOString(),
                                chunkIndex: i + index,
                                totalChunks: chunks.length,
                                fileName,
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
            console.error(`Failed to process file ${fileName}:`, error);
            return {
                status: "failed",
                fileName,
                reason: error instanceof Error ? error.message : "Unable to process file.",
            };
        }

        await KnowledgeBase.create({
            botId,
            fileSize,
            fileHash,
            fileName,
            type: fileType,
            content: rawText,
            source,
            downloadUrl,
            chunksTotal: embedded.length,
        });

        return {
            status: "created",
            fileName,
            chunksTotal: chunks.length,
            chunksProcessed: embedded.length,
        };
    };

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

        const bot = await this.botService.readByBotId(botId);
        if (!bot || typeof bot.vectorTable !== 'string') {
            throw new Error("Bot not found or vectorTable is invalid");
        }
        assertCanManage(bot, actor);
        const vectorTable = bot.vectorTable;

        const isZip = path.extname(file.originalname).toLowerCase() === ".zip";

        if (isZip) {
            return this.processZipFile({ botId, vectorTable, file, filePath, safeBotId });
        }

        const fileHash = await generateFileHash({ filePath });
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

        const outcome = await this.ingestText({
            botId,
            vectorTable,
            fileName: file.originalname,
            fileType: file.mimetype,
            rawText,
            fileHash,
            fileSize: file.size,
            source: filePath,
            downloadUrl: filePath,
        });

        if (outcome.status === "failed") {
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
                body: { success: false, message: `Unable to process file ${file.originalname}.` },
            };
        }

        if (outcome.status === "created") {
            return {
                status: 200,
                body: {
                    success: true,
                    message: `Processed ${outcome.chunksProcessed}/${outcome.chunksTotal} chunks successfully`,
                    chunksTotal: outcome.chunksTotal,
                    chunksProcessed: outcome.chunksProcessed,
                },
            };
        }

        // "empty" can't actually be reached here (readFile already throws above
        // when rawText is blank), kept only so ingestText's return type is total.
        return {
            status: 200,
            body: { success: true, message: "Knowledge base already exists for this file" },
        };
    }

    // A zip's individual entries are ingested independently: one bad or
    // duplicate file inside a 200-file archive shouldn't discard the other
    // 199 that already succeeded, unlike the single-file path's all-or-nothing
    // rollback.
    private processZipFile = async ({
        botId,
        vectorTable,
        file,
        filePath,
        safeBotId,
    }: {
        botId: string;
        vectorTable: string;
        file: Express.Multer.File;
        filePath: string;
        safeBotId: string;
    }) => {
        const entries = extractZipEntries(filePath);

        if (entries.length === 0) {
            return {
                status: 400,
                body: {
                    success: false,
                    message: "No ingestible source/text files were found in this archive.",
                },
            };
        }

        const created: string[] = [];
        const duplicate: string[] = [];
        const failed: { fileName: string; reason: string }[] = [];

        for (const entry of entries) {
            const entryHash = crypto.createHash("sha256").update(entry.content).digest("hex");
            // Keep each entry's KB fileName unique within the bot by qualifying
            // it with the archive name — two zips can both contain "index.ts".
            const qualifiedName = `${file.originalname}/${entry.fileName}`;

            const outcome = await this.ingestText({
                botId,
                vectorTable,
                fileName: qualifiedName,
                fileType: "text/plain",
                rawText: entry.content,
                fileHash: entryHash,
                fileSize: Buffer.byteLength(entry.content, "utf-8"),
                source: `${filePath}#${entry.fileName}`,
                downloadUrl: filePath,
            });

            if (outcome.status === "created") created.push(outcome.fileName);
            else if (outcome.status === "duplicate") duplicate.push(outcome.fileName);
            else if (outcome.status === "failed") failed.push({ fileName: outcome.fileName, reason: outcome.reason });
            // "empty" entries are silently skipped — extractZipEntries already
            // filters to non-empty text/code files, so this is defensive only.
        }

        if (created.length === 0 && duplicate.length === 0) {
            // Nothing landed in Mongo/Postgres — clean up the uploaded archive
            // itself, same as the single-file failure path.
            const safeFileName = path.basename(file.originalname);
            const rollbackFilePath = path.join(__dirname, '..', '..', 'uploads', safeBotId, safeFileName);
            if (fs.existsSync(rollbackFilePath)) {
                fs.unlinkSync(rollbackFilePath);
            }
            return {
                status: 500,
                body: {
                    success: false,
                    message: `Unable to process any file in ${file.originalname}.`,
                    failed,
                },
            };
        }

        return {
            status: 200,
            body: {
                success: true,
                message: `Processed ${created.length}/${entries.length} file(s) from ${file.originalname}` +
                    (duplicate.length ? `, ${duplicate.length} already existed` : "") +
                    (failed.length ? `, ${failed.length} failed` : ""),
                filesTotal: entries.length,
                filesProcessed: created.length,
                filesDuplicate: duplicate.length,
                filesFailed: failed.length,
                failed,
            },
        };
    };
}
