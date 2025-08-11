import { Request, Response } from "express";
import { ToolService } from "../services/tool.service";

export class ToolController {
    toolService = new ToolService();


    readToolsByBotId = async (req: Request, res: Response) => {
        try {
            const { botId } = req.query;
            const tools = await this.toolService.readToolsByBotId({
                botId: botId as string
            });
            res.status(200).json(tools);
        } catch (error) {
            console.error("Error reading tools:", error);
            res.status(400).json({ error: "Failed to read tools" });
        }
    };


    readToolById = async (req: Request, res: Response) => {
        try {
            const { id } = req.params;
            const tool = await this.toolService.readToolById({ id });
            res.status(200).json(tool);
        } catch (error) {
            console.error("Error reading tool:", error);
            res.status(400).json({ error: "Failed to read tool" });
        }
    };


    createTool = async (req: Request, res: Response) => {
        try {
            const toolData = req.body;
            const newTool = await this.toolService.create(toolData);
            res.status(201).json(newTool);
        } catch (error) {
            console.error("Error creating tool:", error);
            res.status(400).json({ error: "Failed to create tool" });
        }

    }
    updateTool = async (req: Request, res: Response) => {
        try {
            const { id } = req.params;
            const toolData = req.body;
            const updatedTool = await this.toolService.update({ id, toolData });
            res.status(200).json(updatedTool);
        } catch (error) {
            console.error("Error updating tool:", error);
            res.status(400).json({ error: "Failed to update tool" });
        }
    }

    deleteTool = async (req: Request, res: Response) => {
        try {
            const { id } = req.params;
            await this.toolService.delete({ id });
            res.status(204).send();
        } catch (error) {
            console.error("Error deleting tool:", error);
            res.status(400).json({ error: "Failed to delete tool" });
        }
    }
}