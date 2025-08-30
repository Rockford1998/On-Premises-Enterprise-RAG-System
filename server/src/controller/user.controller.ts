import { Request, Response } from "express";
import { UserService } from "../services/user.service";
import { sendResponse } from "../util/sendResponse";


export class UserController {
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
                    data: users
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
            }
            sendResponse({ res, success: true, message: "User found", data: user, status: 200 });
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
            }
            sendResponse({ res, success: true, message: "User found", data: user, status: 200 });
        } catch (error) {
            console.error("Error finding user by username:", error);
            sendResponse({ res, success: false, message: "Failed to find user", status: 500 });
        }
    }

    createUser = async (req: Request, res: Response) => {
        try {
            const userData = req.body;
            const newUser = await this.userService.create(userData);
            sendResponse({ res, success: true, message: "User created successfully", data: newUser, status: 201 });
        } catch (error) {
            console.error("Error creating user:", error);
            sendResponse({ res, success: false, message: "Failed to create user", status: 500 });
        }
    }

    updateUserByEmail = async (req: Request, res: Response) => {
        try {
            const { email } = req.params;
            const updateData = req.body;
            const updatedUser = await this.userService.updateByEmail(email, updateData);
            if (!updatedUser) {
                sendResponse({ res, success: false, message: "User not found", status: 404 });
                return;
            }
            sendResponse({ res, success: true, message: "User updated successfully", data: updatedUser, status: 200 });
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