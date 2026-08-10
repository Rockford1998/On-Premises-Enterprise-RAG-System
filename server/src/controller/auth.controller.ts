import { Request, Response } from "express";
import {
  AuthService,
  AccountDisabledError,
  InvalidCredentialsError,
  TooManyAttemptsError,
} from "../services/auth.service";
import {
  InvalidRefreshTokenError,
  RefreshTokenReuseError,
} from "../services/token.service";
import { sendResponse } from "../util/sendResponse";
import {
  clearRefreshCookie,
  readRefreshCookie,
  sessionContextFrom,
  setRefreshCookie,
} from "../util/authCookie";
import { env } from "../config/env";

const authService = new AuthService();

export class AuthController {
  /**
   * POST /auth/login
   * Body: { email, password }
   *
   * The access token is returned in the body (the client keeps it in memory);
   * the refresh token is set as an httpOnly cookie and never reaches JS.
   */
  login = async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body ?? {};

      if (
        typeof email !== "string" ||
        typeof password !== "string" ||
        !email.trim() ||
        !password
      ) {
        sendResponse({
          res,
          success: false,
          message: "Email and password are required",
          status: 400,
          code: "VALIDATION_ERROR",
        });
        return;
      }

      const { tokens, user } = await authService.login({
        email,
        password,
        context: sessionContextFrom(req),
      });

      setRefreshCookie(res, tokens.refreshToken, tokens.refreshExpiresAt);

      sendResponse({
        res,
        success: true,
        message: "Logged in successfully",
        data: {
          accessToken: tokens.accessToken,
          expiresIn: env.auth.accessTtlSeconds,
          user,
        },
        status: 200,
      });
    } catch (error) {
      if (error instanceof TooManyAttemptsError) {
        res.setHeader("Retry-After", String(error.retryAfterSeconds));
        sendResponse({
          res,
          success: false,
          message: `Too many login attempts. Try again in ${error.retryAfterSeconds}s.`,
          status: 429,
          code: "RATE_LIMITED",
        });
        return;
      }
      if (error instanceof AccountDisabledError) {
        sendResponse({
          res,
          success: false,
          message: "Account is disabled",
          status: 403,
          code: "ACCOUNT_DISABLED",
        });
        return;
      }
      if (error instanceof InvalidCredentialsError) {
        sendResponse({
          res,
          success: false,
          message: "Invalid email or password",
          status: 401,
          code: "INVALID_CREDENTIALS",
        });
        return;
      }
      console.error("Login failed:", error);
      sendResponse({ res, success: false, message: "Login failed", status: 500 });
    }
  };

  /**
   * POST /auth/refresh
   * Reads the refresh cookie, rotates it, returns a new access token.
   */
  refresh = async (req: Request, res: Response) => {
    const presented = readRefreshCookie(req);

    if (!presented) {
      sendResponse({
        res,
        success: false,
        message: "No session found",
        status: 401,
        code: "SESSION_EXPIRED",
      });
      return;
    }

    try {
      const { tokens, user } = await authService.refresh({
        refreshToken: presented,
        context: sessionContextFrom(req),
      });

      setRefreshCookie(res, tokens.refreshToken, tokens.refreshExpiresAt);

      sendResponse({
        res,
        success: true,
        message: "Session refreshed",
        data: {
          accessToken: tokens.accessToken,
          expiresIn: env.auth.accessTtlSeconds,
          user,
        },
        status: 200,
      });
    } catch (error) {
      clearRefreshCookie(res);

      if (error instanceof RefreshTokenReuseError) {
        // The token service has already revoked every session for this user.
        console.warn("Refresh token reuse detected — all sessions revoked");
        sendResponse({
          res,
          success: false,
          message: "Session invalidated. Please sign in again.",
          status: 401,
          code: "SESSION_REUSE_DETECTED",
        });
        return;
      }
      if (error instanceof InvalidRefreshTokenError) {
        sendResponse({
          res,
          success: false,
          message: "Session expired. Please sign in again.",
          status: 401,
          code: "SESSION_EXPIRED",
        });
        return;
      }
      console.error("Refresh failed:", error);
      sendResponse({ res, success: false, message: "Refresh failed", status: 500 });
    }
  };

  /** POST /auth/logout — revoke the current session. */
  logout = async (req: Request, res: Response) => {
    try {
      const presented = readRefreshCookie(req);
      await authService.logout(presented);
    } catch (error) {
      console.error("Logout error:", error);
    } finally {
      // Always clear the cookie, even if revocation failed.
      clearRefreshCookie(res);
    }

    sendResponse({ res, success: true, message: "Logged out", status: 200 });
  };

  /** POST /auth/logout-all — revoke every session for the caller. */
  logoutAll = async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.sub;
      if (!userId) {
        sendResponse({
          res,
          success: false,
          message: "Not authenticated",
          status: 401,
          code: "TOKEN_MISSING",
        });
        return;
      }
      await authService.logoutAll(userId);
      clearRefreshCookie(res);
      sendResponse({
        res,
        success: true,
        message: "Signed out of all sessions",
        status: 200,
      });
    } catch (error) {
      console.error("Logout-all error:", error);
      sendResponse({
        res,
        success: false,
        message: "Failed to sign out",
        status: 500,
      });
    }
  };

  /** GET /auth/me — identity of the current access-token holder. */
  me = async (req: Request, res: Response) => {
    const claims = (req as any).user;
    if (!claims) {
      sendResponse({
        res,
        success: false,
        message: "Not authenticated",
        status: 401,
        code: "TOKEN_MISSING",
      });
      return;
    }
    sendResponse({
      res,
      success: true,
      message: "Current user",
      data: { id: claims.sub, email: claims.email, roles: claims.roles },
      status: 200,
    });
  };
}
