import { Request, Response } from "express";
import { botType } from "../models/shared.model";
import { sendResponse } from "../util/sendResponse";

export class MatadataController {
    getBotType = async (req: Request, res: Response) => {
        try {

            sendResponse({
                res,
                success: true,
                message: "Bot types",
                status: 200,
                data: botType
            })
        } catch (error) {
            console.log("bot type retrival error", error)
        }
    }
}