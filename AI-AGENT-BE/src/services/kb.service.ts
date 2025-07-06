import fs from 'fs';
import path from 'path';
import { VectorService } from './vectorService';
import { KnowledgeBase } from '../models/kb';
import { generateFileHash } from '../util/generateFileHash';
import { readFile } from '../util/readFile';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import { storeEmbeddedDocument } from './storeEmbeddedDocument';

interface DeleteKnowledgeBase {
    fileName: string;
}

export class KbService {
    //
    static async readKnowledgeBase({ page, limit }: { page: number; limit: number }) {
        const skip = (page - 1) * limit;
        return await KnowledgeBase.find().skip(skip).limit(limit).exec();
    }

    //
    static async deleteKnowledgeBase({ fileName }: DeleteKnowledgeBase): Promise<void> {
        // Delete from vector DB
        await VectorService.deleteOutdatedKnowledgeByFileName({ fileName });
        // Delete from MongoDB
        await KnowledgeBase.deleteMany({ fileName });
        // Delete from file system
        const filePath = path.join(__dirname, '..', 'uploads', fileName);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
    }

    //
    static async processFile(file: Express.Multer.File | undefined) {
        if (!file) {
            return {
                status: 400,
                body: { success: false, message: "No file uploaded" },
            };
        }

        const filePath = `uploads/${file.filename}`;
        const fileHash = await generateFileHash({ filePath });

        const alreadyExists = await VectorService.CheckIfkBPresentByFileHash({ fileHash });
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

        if (successCount < chunks.length) {
            await VectorService.deleteOutdatedKnowledgeByFileHash({ fileHash });
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

        // Save the knowledge base entry to MongoDB
        await KnowledgeBase.create({
            fileName: file.originalname,
            type: file.mimetype,
            content: rawText,
            source: filePath,
            fileHash,
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
