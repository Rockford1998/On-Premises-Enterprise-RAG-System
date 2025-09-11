import { Request, Response } from "express";
import { AuthService } from "../services/auth.service";
import { sendResponse } from "../util/sendResponse";

const authService = new AuthService();

export class AuthController {
    // POST /auth/login
    login = async (req: Request, res: Response) => {
        try {
            const { email, password } = req.body;

            if (!email || !password) {
                sendResponse({ res, success: false, message: "Email/Username and password are required", status: 400 });

            }

            const { token, user } = await authService.login(email, password);
            sendResponse({
                res, success: true, message: "Logged in successfully", data: {
                    token, user
                }, status: 201
            });
        } catch (err: any) {
            sendResponse({ res, success: false, message: "Login failed", status: 500 });

        }
    };
}
