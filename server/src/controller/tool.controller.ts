import { Request, Response } from "express";
import { ToolService } from "../services/tool.service";
import { sendResponse } from "../util/sendResponse";
import { ForbiddenError } from "../util/botAccess";

const sendForbidden = (res: Response, error: unknown): boolean => {
    if (error instanceof ForbiddenError) {
        sendResponse({ res, success: false, message: error.message, status: 403 });
        return true;
    }
    return false;
};

export class ToolController {
    toolService = new ToolService();
    readToolsByBotId = async (req: Request, res: Response) => {
        try {
            if (!req.user) {
                sendResponse({ res, success: false, message: "Not authenticated", status: 401 });
                return;
            }
            const botId = req.params.botId;
            const tools = await this.toolService.readToolsByBotId({
                botId: botId as string,
                actor: req.user,
            });
            sendResponse({ res, success: true, message: "Tools retrieved successfully", data: tools, status: 200 });
        } catch (error) {
            if (sendForbidden(res, error)) return;
            console.error("Error reading tools:", error);
            sendResponse({ res, success: false, message: "Failed to read tools", status: 500 });
        }
    };


    readToolById = async (req: Request, res: Response) => {
        try {
            if (!req.user) {
                sendResponse({ res, success: false, message: "Not authenticated", status: 401 });
                return;
            }
            const { id } = req.params;
            const tool = await this.toolService.readToolById({ id, actor: req.user });
            if (!tool) {
                sendResponse({ res, success: false, message: "Tool not found", status: 404 });
                return;
            }
            sendResponse({ res, success: true, message: "Tool retrieved successfully", data: tool, status: 200 });
        } catch (error) {
            if (sendForbidden(res, error)) return;
            console.error("Error reading tool:", error);
            sendResponse({ res, success: false, message: "Failed to read tool", status: 500 });
        }
    };


    createTool = async (req: Request, res: Response) => {
        try {
            if (!req.user) {
                sendResponse({ res, success: false, message: "Not authenticated", status: 401 });
                return;
            }
            const toolData = req.body;
            const newTool = await this.toolService.create(toolData, req.user);
            sendResponse({ res, success: true, message: "Tool created successfully", data: newTool, status: 201 });
        } catch (error) {
            if (sendForbidden(res, error)) return;
            console.error("Error creating tool:", error);
            sendResponse({ res, success: false, message: "Failed to create tool", status: 500 });
        }

    }

    updateTool = async (req: Request, res: Response) => {
        try {
            if (!req.user) {
                sendResponse({ res, success: false, message: "Not authenticated", status: 401 });
                return;
            }
            const { id } = req.params;
            const toolData = req.body;
            const updatedTool = await this.toolService.update({ id, toolData, actor: req.user });
            if (!updatedTool) {
                sendResponse({ res, success: false, message: "Tool not found", status: 404 });
                return;
            }
            sendResponse({ res, success: true, message: "Tool updated successfully", data: updatedTool, status: 200 });
        } catch (error) {
            if (sendForbidden(res, error)) return;
            console.error("Error updating tool:", error);
            sendResponse({ res, success: false, message: "Failed to update tool", status: 500 });
        }
    }

    deleteTool = async (req: Request, res: Response) => {
        try {
            if (!req.user) {
                sendResponse({ res, success: false, message: "Not authenticated", status: 401 });
                return;
            }
            const { id } = req.params;
            await this.toolService.delete({ id, actor: req.user });
            sendResponse({ res, success: true, message: "Tool deleted successfully", status: 200 });
        } catch (error) {
            if (sendForbidden(res, error)) return;
            console.error("Error deleting tool:", error);
            sendResponse({ res, success: false, message: "Failed to delete tool", status: 500 });
        }
    }
}
