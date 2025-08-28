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
        const token = jwt.sign({
            id: user._id,
            email: user.email,
            userName: user.userName,
        }, JWT_SECRET, { expiresIn: "1d" });
        return { token, user };
    };

    // Compare password using bcrypt
    private comparePassword = async (plain: string, hash: string) => {
        const bcrypt = await import("bcryptjs");
        return bcrypt.compare(plain, hash);
    };
}
