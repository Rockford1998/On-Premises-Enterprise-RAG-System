import { user } from "../models/shared.model";


export class UserService {
    static async read({ page, limit }: { page: number; limit: number }) {
        const skip = (page - 1) * limit;
        return await user.find().skip(skip).limit(limit).exec();
    }
    // Create a new user
    static async findByEmail(email: string) {
        return await user.findOne({ email }).exec();
    }
    // Find user by userName
    static async findByUserName(userName: string) {
        return await user.findOne({ userName }).exec();
    }

    // Create a new user
    static async create(userData: {
        firstName: string;
        lastName: string;
        userName: string;
        email: string;
        passwordHash: string;
    }) {
        const newUser = new user(userData);
        return await newUser.save();
    }

    // Update user by email
    static async updateByEmail(email: string, updateData: Partial<{
        firstName: string;
        lastName: string;
        userName: string;
        passwordHash: string;
        isActive: boolean;
    }>) {
        return await user.findOneAndUpdate({ email }, updateData, {
            new: true,  // Return the updated document
            runValidators: true,  // Validate the update against the schema
        }).exec();
    }

    // Delete user by email
    static async deleteByEmail(email: string) {
        return await user.findOneAndDelete({ email }).exec();
    }
} 