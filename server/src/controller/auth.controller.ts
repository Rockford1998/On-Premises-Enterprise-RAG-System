import { Request, Response } from "express";
import { AuthService } from "../services/auth.service";

const authService = new AuthService();

export class AuthController {
    // POST /auth/login
    login = async (req: Request, res: Response) => {
        try {
            const { emailOrUserName, password } = req.body;
            if (!emailOrUserName || !password) {
                return res.status(400).json({ error: "Email/Username and password are required" });
            }
            const { token, user } = await authService.login(emailOrUserName, password);
            return res.status(200).json({ token, user });
        } catch (err: any) {
            return res.status(401).json({ error: err.message || "Login failed" });
        }
    };
}
