import { Request, Response } from "express";
import { env } from "../config/env";

/**
 * Refresh-token cookie helpers.
 *
 * httpOnly  — unreadable from JavaScript, so XSS cannot exfiltrate the session
 * sameSite  — "strict" blocks the cookie on cross-site requests (CSRF defence)
 * path      — scoped to /auth so it is not attached to ordinary API calls
 */
export const setRefreshCookie = (
  res: Response,
  token: string,
  expiresAt: Date,
): void => {
  res.cookie(env.auth.cookieName, token, {
    httpOnly: true,
    secure: env.auth.cookieSecure,
    sameSite: "strict",
    path: env.auth.cookiePath,
    expires: expiresAt,
  });
};

export const clearRefreshCookie = (res: Response): void => {
  res.clearCookie(env.auth.cookieName, {
    httpOnly: true,
    secure: env.auth.cookieSecure,
    sameSite: "strict",
    path: env.auth.cookiePath,
  });
};

export const readRefreshCookie = (req: Request): string =>
  (req as any).cookies?.[env.auth.cookieName] ?? "";

/** Request metadata recorded against a session, for auditing. */
export const sessionContextFrom = (req: Request) => ({
  userAgent: req.headers["user-agent"] ?? "",
  ip: req.ip ?? req.socket.remoteAddress ?? "",
});
