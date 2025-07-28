import { Request, Response } from "express";
import { UserService } from "../services/user.service";


export class UserController {

    readUser = async (req: Request, res: Response) => {
        try {
            const { page = 1, limit = 10 } = req.query;
            const users = await UserService.read({ page: Number(page), limit: Number(limit) });
            res.status(200).json(users);
        } catch (error) {
            console.error("Error reading users:", error);
            res.status(500).json({ error: "Failed to read users" });
        }
    }

    findUserByEmail = async (req: Request, res: Response) => {
        try {
            const { email } = req.params;
            const user = await UserService.findByEmail(email);
            if (!user) {
                res.status(404).json({ error: "User not found" });
                return;
            }
            res.status(200).json(user);
        } catch (error) {
            console.error("Error finding user by email:", error);
            res.status(500).json({ error: "Failed to find user" });
        }
    }




    findUserByUserName = async (req: Request, res: Response) => {
        try {
            const { userName } = req.params;
            const user = await UserService.findByUserName(userName);
            if (!user) {
                res.status(404).json({ error: "User not found" });
                return;
            }
            res.status(200).json(user);
        } catch (error) {
            console.error("Error finding user by username:", error);
            res.status(500).json({ error: "Failed to find user" });
        }
    }

    createUser = async (req: Request, res: Response) => {
        try {
            const userData = req.body;
            const newUser = await UserService.create(userData);
            res.status(201).json(newUser);
        } catch (error) {
            console.error("Error creating user:", error);
            res.status(500).json({ error: "Failed to create user" });
        }
    }

    updateUserByEmail = async (req: Request, res: Response) => {
        try {
            const { email } = req.params;
            const updateData = req.body;
            const updatedUser = await UserService.updateByEmail(email, updateData);
            if (!updatedUser) {
                res.status(404).json({ error: "User not found" });
                return;
            }
            res.status(200).json(updatedUser);
        } catch (error) {
            console.error("Error updating user:", error);
            res.status(500).json({ error: "Failed to update user" });
        }
    }
    deleteUserByEmail = async (req: Request, res: Response) => {
        try {
            const { email } = req.params;
            const deletedUser = await UserService.deleteByEmail(email);
            if (!deletedUser) {
                res.status(404).json({ error: "User not found" });
                return;
            }
            res.status(200).json({ message: "User deleted successfully" });
        } catch (error) {
            console.error("Error deleting user:", error);
            res.status(500).json({ error: "Failed to delete user" });
        }
    }

}