import jwt from "jsonwebtoken";
import { Request, Response, NextFunction } from "express";
import { sendResponse } from "../util/sendResponse";
import { TokenService, type AccessTokenPayload } from "../services/token.service";

const tokenService = new TokenService();

/**
 * Routes reachable without an access token.
 *
 * /auth/refresh and /auth/logout are public because the caller's access token
 * has usually already expired by the time they are called; both authenticate
 * via the httpOnly refresh cookie instead.
 */
const PUBLIC_ROUTES: ReadonlyArray<{ method: string; path: string }> = [
  { method: "POST", path: "/users" },        // registration
  { method: "POST", path: "/auth" },         // deprecated login alias
  { method: "POST", path: "/auth/login" },
  { method: "POST", path: "/auth/refresh" },
  { method: "POST", path: "/auth/logout" },
];

const isPublic = (req: Request): boolean => {
  // Normalise trailing slashes before comparing; req.path excludes the query.
  const path = req.path.replace(/\/+$/, "") || "/";
  return PUBLIC_ROUTES.some(
    (route) => route.method === req.method && route.path === path,
  );
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AccessTokenPayload;
    }
  }
}

export const authenticateJWT = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (isPublic(req)) {
    return next();
  }

  const authHeader = req.headers["authorization"];

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    sendResponse({
      res,
      status: 401,
      message: "No token provided",
      success: false,
      code: "TOKEN_MISSING",
    });
    return;
  }

  const token = authHeader.slice("Bearer ".length).trim();

  try {
    req.user = tokenService.verifyAccessToken(token);
    next();
  } catch (err) {
    // Expiry is reported distinctly from invalidity so the client knows
    // whether to attempt a silent refresh or return the user to sign-in.
    if (err instanceof jwt.TokenExpiredError) {
      sendResponse({
        res,
        status: 401,
        message: "Access token expired",
        success: false,
        code: "TOKEN_EXPIRED",
      });
      return;
    }
    sendResponse({
      res,
      status: 401,
      message: "Invalid token",
      success: false,
      code: "TOKEN_INVALID",
    });
  }
};

/** Require one of the given roles. Use after authenticateJWT. */
export const requireRole =
  (...roles: string[]) =>
  (req: Request, res: Response, next: NextFunction) => {
    const claims = req.user;
    if (!claims) {
      sendResponse({
        res,
        status: 401,
        message: "Not authenticated",
        success: false,
        code: "TOKEN_MISSING",
      });
      return;
    }
    if (!roles.some((role) => claims.roles?.includes(role))) {
      sendResponse({
        res,
        status: 403,
        message: "Insufficient permissions",
        success: false,
      });
      return;
    }
    next();
  };
