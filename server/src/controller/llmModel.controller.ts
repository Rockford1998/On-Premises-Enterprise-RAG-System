import { Request, Response } from "express";
import { LlmModelService } from "../services/llmModel.service";
import { sendResponse } from "../util/sendResponse";

export class LlmModelController {

    llmModelService = new LlmModelService();

    // List models with pagination and optional filters
    read = async (req: Request, res: Response) => {
        try {
            const page = parseInt(req.query.page as string) || 1;
            const limit = parseInt(req.query.size as string) || 20;
            const provider = req.query.provider as string | undefined;
            const isActiveParam = req.query.isActive as string | undefined;
            const isActive = typeof isActiveParam === 'undefined' ? undefined : isActiveParam === 'true';

            if (page < 1 || limit < 1) {
                sendResponse({ res, success: false, message: "Page and limit must be positive integers", status: 400 });
                return;
            }

            const models = await this.llmModelService.read({ page, limit, provider, isActive });

            sendResponse({
                res,
                success: true,
                pagination: true,
                message: "LLM models retrieved successfully",
                data: { page, limit, total: models.length, data: models },
                status: 200,
            });
        } catch (error) {
            console.error("Error reading LLM models:", error);
            sendResponse({ res, success: false, message: "Failed to read LLM models", status: 500 });
        }
    };

    readAll = async (req: Request, res: Response) => {
        try {
            const models = await this.llmModelService.readAll()
            sendResponse({ res, success: true, message: "LLM model retrieved successfully", data: models, status: 200 })
        } catch (error) {
            console.error("Error reading LLM models:", error);
            sendResponse({ res, success: false, message: "Failed to read LLM models", status: 500 });
        }
    }
    readAvaibleModelsMetadata = async (req: Request, res: Response) => {
        try {
            console.log("call this service")
            const models = await this.llmModelService.readAllModelsMetadata()
            sendResponse({ res, success: true, message: "LLM models retrieved successfully", data: models, status: 200 })
        } catch (error) {
            console.error("Error reading LLM models:", error);
            sendResponse({ res, success: false, message: "Failed to read LLM models", status: 500 });
        }
    }
    //
    readById = async (req: Request, res: Response) => {
        try {
            const { id } = req.params;
            const model = await this.llmModelService.readById(id);
            if (!model) {
                sendResponse({ res, success: false, message: "LLM model not found", status: 404 });
                return;
            }
            sendResponse({ res, success: true, message: "LLM model retrieved successfully", data: model, status: 200 });
        } catch (error) {
            console.error("Error reading LLM model by ID:", error);
            sendResponse({ res, success: false, message: "Failed to read LLM model", status: 500 });
        }
    };

    readByName = async (req: Request, res: Response) => {
        try {
            const { name } = req.params;
            const model = await this.llmModelService.readByName(name);
            if (!model) {
                sendResponse({ res, success: false, message: "LLM model not found", status: 404 });
                return;
            }
            sendResponse({ res, success: true, message: "LLM model retrieved successfully", data: model, status: 200 });
        } catch (error) {
            console.error("Error reading LLM model by name:", error);
            sendResponse({ res, success: false, message: "Failed to read LLM model", status: 500 });
        }
    };

    create = async (req: Request, res: Response) => {
        try {
            const body = req.body;
            const created = await this.llmModelService.create(body);
            sendResponse({ res, success: true, message: "LLM model created successfully", data: created, status: 201 });
        } catch (error) {
            console.error("Error creating LLM model:", error);
            sendResponse({ res, success: false, message: error instanceof Error ? error.message : "Failed to create LLM model", status: 500 });
        }
    };

    update = async (req: Request, res: Response) => {
        try {
            const { id } = req.params;
            const body = req.body;
            const updated = await this.llmModelService.updateById(id, body);
            if (!updated) {
                sendResponse({ res, success: false, message: "LLM model not found to update", status: 404 });
                return;
            }
            sendResponse({ res, success: true, message: "LLM model updated successfully", data: updated, status: 200 });
        } catch (error) {
            console.error("Error updating LLM model:", error);
            sendResponse({ res, success: false, message: error instanceof Error ? error.message : "Failed to update LLM model", status: 500 });
        }
    };

    delete = async (req: Request, res: Response) => {
        try {
            const { id } = req.params;
            await this.llmModelService.deleteById(id);
            sendResponse({ res, success: true, message: "LLM model deleted successfully", status: 200 });
        } catch (error) {
            console.error("Error deleting LLM model:", error);
            sendResponse({ res, success: false, message: error instanceof Error ? error.message : "Failed to delete LLM model", status: 500 });
        }
    };

}
