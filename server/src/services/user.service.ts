import { user } from "../models/shared.model";
import bcrypt from "bcryptjs";


export class UserService {
    read = async ({ page, limit }: { page: number; limit: number }) => {
        const skip = (page - 1) * limit;
        return await user.find().skip(skip).limit(limit).exec();
    };

    // Find user by email. Password and refresh tokens are select:false, so
    // this never returns credentials — AuthService opts in explicitly.
    findByEmail = async (email: string) => {
        return await user.findOne({ email: email.trim().toLowerCase() }).exec();
    };

    // Find user by userName
    findByUserName = async (userName: string) => {
        return await user.findOne({ userName }).exec();
    };

    // Create a new user
    create = async (userData: {
        firstName: string;
        lastName: string;
        email: string;
        password?: string;
    }) => {
        if (!userData.password || userData.password.length < 8) {
            throw new Error("Password must be at least 8 characters long");
        }
        const salt = await bcrypt.genSalt(10);
        const newUser = new user({
            ...userData,
            email: userData.email.trim().toLowerCase(),
            password: await bcrypt.hash(userData.password, salt),
        });
        return await newUser.save();
    };

    // Update user by email
    updateByEmail = async (
        email: string,
        updateData: Partial<{
            firstName: string;
            lastName: string;
            userName: string;
            password: string;
            isActive: boolean;
        }>
    ) => {
        return await user.findOneAndUpdate({ email }, updateData, {
            new: true, // Return the updated document
            runValidators: true, // Validate the update against the schema
        }).exec();
    };

    // Delete user by email
    deleteByEmail = async (email: string) => {
        return await user.findOneAndDelete({ email }).exec();
    };
}