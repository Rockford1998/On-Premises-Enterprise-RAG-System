import { Request, Response } from "express";
import { UserService } from "../services/user.service";
import { sendResponse } from "../util/sendResponse";
import { AuthService, toPublicUser } from "../services/auth.service";
import { sessionContextFrom, setRefreshCookie } from "../util/authCookie";
import { env } from "../config/env";


export class UserController {
    AuthService = new AuthService()
    userService = new UserService();
    // Method to handle user-related requests

    readUser = async (req: Request, res: Response) => {
        try {
            const { page = 1, limit = 10 } = req.query;
            const users = await this.userService.read({ page: Number(page), limit: Number(limit) });
            sendResponse({
                res, success: true, pagination: true, message: "Users retrieved successfully", data: {
                    page: Number(page),
                    limit: Number(limit),
                    total: users.length,
                    data: users.map(toPublicUser)
                },
                status: 200
            });
        } catch (error: any) {
            console.error("Error reading users:", error);
            sendResponse({ res, success: false, message: "Failed to read users", status: 500 });
        }
    }

    findUserByEmail = async (req: Request, res: Response) => {
        try {
            const { email } = req.params;
            const user = await this.userService.findByEmail(email);
            if (!user) {
                sendResponse({ res, success: false, message: "User not found", status: 404 });
                return;
            }
            sendResponse({ res, success: true, message: "User found", data: toPublicUser(user), status: 200 });
        } catch (error) {
            console.error("Error finding user by email:", error);
            sendResponse({ res, success: false, message: "Failed to find user", status: 500 });
        }
    }

    findUserByUserName = async (req: Request, res: Response) => {
        try {
            const { userName } = req.params;
            const user = await this.userService.findByUserName(userName);
            if (!user) {
                sendResponse({ res, success: false, message: "User not found", status: 404 });
                return;
            }
            sendResponse({ res, success: true, message: "User found", data: toPublicUser(user), status: 200 });
        } catch (error) {
            console.error("Error finding user by username:", error);
            sendResponse({ res, success: false, message: "Failed to find user", status: 500 });
        }
    }

    createUser = async (req: Request, res: Response) => {
        try {
            const { email, ...restData } = req.body;

            // 1️⃣ Check if user already exists
            const existingUser = await this.userService.findByEmail(email);
            if (existingUser) {
                sendResponse({
                    res,
                    success: false,
                    message: "User with given email already exists.",
                    status: 409, // Conflict
                });
                return
            }

            // 2️⃣ Create user
            const newUser = await this.userService.create({ email, ...restData });

            // 3️⃣ Registration signs the user straight in: access token in the
            // body, refresh token in the httpOnly cookie.
            const { tokens, user } = await this.AuthService.issueForNewUser(
                newUser,
                sessionContextFrom(req),
            );
            setRefreshCookie(res, tokens.refreshToken, tokens.refreshExpiresAt);

            sendResponse({
                res,
                success: true,
                message: "User created successfully",
                data: {
                    user,
                    accessToken: tokens.accessToken,
                    expiresIn: env.auth.accessTtlSeconds,
                },
                status: 201,
            });
        } catch (error: any) {
            console.error("Error creating user:", error);
            sendResponse({
                res,
                success: false,
                message: error?.message || "Failed to create user",
                status: 500,
            });
        }
    };


    updateUserByEmail = async (req: Request, res: Response) => {
        try {
            const { email } = req.params;

            // Allow-list the updatable fields. Accepting req.body wholesale
            // would let a caller write an unhashed password, escalate roles,
            // or inject refreshTokens.
            const { firstName, lastName, isActive } = req.body ?? {};
            const updateData: Record<string, unknown> = {};
            if (typeof firstName === "string") updateData.firstName = firstName;
            if (typeof lastName === "string") updateData.lastName = lastName;
            if (typeof isActive === "boolean") updateData.isActive = isActive;

            if (Object.keys(updateData).length === 0) {
                sendResponse({ res, success: false, message: "No updatable fields provided", status: 400, code: "VALIDATION_ERROR" });
                return;
            }

            const updatedUser = await this.userService.updateByEmail(email, updateData);
            if (!updatedUser) {
                sendResponse({ res, success: false, message: "User not found", status: 404 });
                return;
            }
            sendResponse({ res, success: true, message: "User updated successfully", data: toPublicUser(updatedUser), status: 200 });
        } catch (error) {
            console.error("Error updating user:", error);
            sendResponse({ res, success: false, message: "Failed to update user", status: 500 });
        }
    }

    deleteUserByEmail = async (req: Request, res: Response) => {
        try {
            const { email } = req.params;
            const deletedUser = await this.userService.deleteByEmail(email);
            if (!deletedUser) {
                sendResponse({ res, success: false, message: "User not found", status: 404 });
                return;
            }
            sendResponse({ res, success: true, message: "User deleted successfully", data: null, status: 200 });
        } catch (error) {
            console.error("Error deleting user:", error);
            sendResponse({ res, success: false, message: "Failed to delete user", status: 500 });
        }
    }
}