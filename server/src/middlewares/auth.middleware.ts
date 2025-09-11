import jwt from "jsonwebtoken";
import { Request, Response, NextFunction } from "express";
import { sendResponse } from "../util/sendResponse";

const JWT_SECRET = process.env.JWT_SECRET || "your_jwt_secret";

export const authenticateJWT = (req: Request, res: Response, next: NextFunction) => {
    // Skip auth for POST /users
    if (req.method === "POST" && (req.path === "/users" || req.path === "/auth")) {
        return next();

    }

    const authHeader = req.headers["authorization"];

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        sendResponse({ res, status: 401, message: "No token provided", success: false });
        return;
    }
    const token = authHeader.split(" ")[1];
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        // Attach user info to request
        (req as any).user = decoded;
        next();
    } catch (err) {
        sendResponse({ res, status: 401, message: "Invalid or expired token", success: false });
        return;
    }
};
