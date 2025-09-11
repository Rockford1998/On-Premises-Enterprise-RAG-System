import { jwtVerify } from "jose";

export const verifyAccessToken = async (token: string) => {
    const secret = new TextEncoder().encode(import.meta.env.VITE_JWT_SECRET);

    const { payload } = await jwtVerify(token, secret);
    return payload;
};
