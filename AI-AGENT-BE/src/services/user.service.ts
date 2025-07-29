import { user } from "../models/shared.model";


export class UserService {
    read = async ({ page, limit }: { page: number; limit: number }) => {
        const skip = (page - 1) * limit;
        return await user.find().skip(skip).limit(limit).exec();
    };

    // Find user by email
    findByEmail = async (email: string) => {
        return await user.findOne({ email }).exec();
    };

    // Find user by userName
    findByUserName = async (userName: string) => {
        return await user.findOne({ userName }).exec();
    };

    // Create a new user
    create = async (userData: {
        firstName: string;
        lastName: string;
        userName: string;
        email: string;
        passwordHash: string;
    }) => {
        const newUser = new user(userData);
        return await newUser.save();
    };

    // Update user by email
    updateByEmail = async (
        email: string,
        updateData: Partial<{
            firstName: string;
            lastName: string;
            userName: string;
            passwordHash: string;
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