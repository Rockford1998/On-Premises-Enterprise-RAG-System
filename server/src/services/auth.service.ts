import { ObjectId } from "typeorm";
import { UserService } from "./user.service";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "your_jwt_secret";

export class AuthService {
    private userService = new UserService();

    // Login: validate credentials and return JWT if valid
    login = async (emailOrUserName: string, password: string) => {
        // Try to find user by email or username
        let user = await this.userService.findByEmail(emailOrUserName);
        if (!user) {
            user = await this.userService.findByUserName(emailOrUserName);
        }
        if (!user) {
            throw new Error("User not found");
        }
        // Compare password
        const isMatch = await this.comparePassword(password, user.password);
        if (!isMatch) {
            throw new Error("Invalid credentials");
        }
        // Generate JWT
        const token = this.generateJwtToken({ id: user._id, email: user.email })
        return { token, user };
    };

    // Compare password using bcrypt
    private comparePassword = async (plain: string, hash: string) => {
        const bcrypt = await import("bcryptjs");
        return bcrypt.compare(plain, hash);
    };
    generateJwtToken = ({ email, id }: {
        id: ObjectId,
        email: string
    }) => {
        const token = jwt.sign({
            id,
            email,
        }, JWT_SECRET, { expiresIn: "1d" });
        return token;
    }
}
