import { Request, Response } from "express";
import { MCPService } from "../services/mcp.service";
import { sendResponse } from "../util/sendResponse";

export class MCPController {
    private MCPService = new MCPService()

    createMCP = async (req: Request, res: Response) => {
        try {
            const data = await this.MCPService.create(req.body)
            res.send(data)
        } catch (error) {
            console.error("Error finding user by username:", error);
            res.send("hello")
        }
    }
}