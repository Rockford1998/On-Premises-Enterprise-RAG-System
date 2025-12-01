// src/utils/auth.js
import { jwtDecode } from 'jwt-decode'; // Note: the import syntax may vary depending on the library version

export const verifyAccessToken = async (token: string) => {
    if (!token) return true;
    try {
        const decodedToken = jwtDecode(token);
        console.log(decodedToken)
        const currentTime = Date.now(); // current time in seconds
        console.log(decodedToken.exp && decodedToken.exp < currentTime)
        return decodedToken.exp && decodedToken.exp < currentTime;
    } catch (error) {
        console.error('Error decoding token:', error);
        return true; // Assume expired or invalid if decode fails
    }
};






