import bcrypt from "bcryptjs";
import { user, LoginAttempt } from "../models/shared.model";
import {
  TokenService,
  type IssuedTokens,
  type SessionContext,
} from "./token.service";
import { env } from "../config/env";

export class InvalidCredentialsError extends Error {
  constructor() {
    super("Invalid email or password");
    this.name = "InvalidCredentialsError";
  }
}

export class AccountDisabledError extends Error {
  constructor() {
    super("Account is disabled");
    this.name = "AccountDisabledError";
  }
}

export class TooManyAttemptsError extends Error {
  constructor(public retryAfterSeconds: number) {
    super("Too many login attempts");
    this.name = "TooManyAttemptsError";
  }
}

export type PublicUser = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  roles: string[];
  isActive: boolean;
};

export const toPublicUser = (doc: any): PublicUser => ({
  id: String(doc._id),
  firstName: doc.firstName,
  lastName: doc.lastName,
  email: doc.email,
  roles: doc.roles ?? ["USER"],
  isActive: doc.isActive !== false,
});

/**
 * Fixed-window throttle keyed on email+IP, persisted in Mongo so it survives
 * a restart and holds across replicas — a plain in-process Map only protects
 * a single, continuously-running process. The LoginAttempt TTL index (see
 * shared.model.ts) drops each document once its own window has passed, so
 * there is nothing to sweep manually.
 */
class LoginThrottle {
  async check(key: string): Promise<void> {
    const entry = await LoginAttempt.findOne({ key }).lean().exec();
    const now = Date.now();
    // Treat a not-yet-TTL-swept document as expired too — Mongo's TTL
    // monitor runs on its own cadence (~60s), not the instant resetAt passes.
    if (!entry || new Date(entry.resetAt).getTime() <= now) return;
    if (entry.count >= env.auth.loginMaxAttempts) {
      throw new TooManyAttemptsError(
        Math.ceil((new Date(entry.resetAt).getTime() - now) / 1000),
      );
    }
  }

  async fail(key: string): Promise<void> {
    const now = Date.now();
    const entry = await LoginAttempt.findOne({ key }).exec();
    if (!entry || entry.resetAt.getTime() <= now) {
      // Upsert is atomic, so concurrent first-failures for the same key
      // cannot race into a duplicate-key error on the unique `key` index.
      await LoginAttempt.findOneAndUpdate(
        { key },
        { key, count: 1, resetAt: new Date(now + env.auth.loginWindowSeconds * 1000) },
        { upsert: true },
      ).exec();
      return;
    }
    entry.count += 1;
    await entry.save();
  }

  async clear(key: string): Promise<void> {
    await LoginAttempt.deleteOne({ key }).exec();
  }
}

export class AuthService {
  private tokenService = new TokenService();
  private throttle = new LoginThrottle();

  /**
   * Verify credentials and open a session.
   *
   * Unknown email and wrong password produce the same error, and the bcrypt
   * comparison runs even when no user is found, so neither the message nor
   * the response timing reveals which accounts exist.
   */
  login = async ({
    email,
    password,
    context = {},
  }: {
    email: string;
    password: string;
    context?: SessionContext;
  }): Promise<{ tokens: IssuedTokens; user: PublicUser }> => {
    const normalisedEmail = email.trim().toLowerCase();
    const throttleKey = `${normalisedEmail}|${context.ip ?? "unknown"}`;
    await this.throttle.check(throttleKey);

    const found = await user
      .findOne({ email: normalisedEmail })
      .select("+password")
      .exec();

    // Dummy hash keeps the comparison cost constant when the user is missing.
    const hash =
      found?.password ??
      "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";
    const passwordMatches = await bcrypt.compare(password, hash);

    if (!found || !passwordMatches) {
      await this.throttle.fail(throttleKey);
      throw new InvalidCredentialsError();
    }

    if (found.isActive === false) {
      throw new AccountDisabledError();
    }

    await this.throttle.clear(throttleKey);

    const tokens = await this.tokenService.issueTokensForUser(
      { _id: found._id, email: found.email, roles: found.roles as string[] },
      context,
    );

    return { tokens, user: toPublicUser(found) };
  };

  /** Rotate a refresh token into a new pair. */
  refresh = async ({
    refreshToken,
    context = {},
  }: {
    refreshToken: string;
    context?: SessionContext;
  }): Promise<{ tokens: IssuedTokens; user: PublicUser }> => {
    const { tokens, userDoc } = await this.tokenService.rotate(
      refreshToken,
      context,
    );
    return { tokens, user: toPublicUser(userDoc) };
  };

  /** End the current session. */
  logout = async (refreshToken: string): Promise<void> => {
    await this.tokenService.revoke(refreshToken);
  };

  /** End every session for a user. */
  logoutAll = async (userId: string): Promise<void> => {
    await this.tokenService.revokeAllForUser(userId);
  };

  /** Issue a pair for a freshly registered user (signup auto-login). */
  issueForNewUser = async (
    userDoc: any,
    context: SessionContext = {},
  ): Promise<{ tokens: IssuedTokens; user: PublicUser }> => {
    const tokens = await this.tokenService.issueTokensForUser(
      {
        _id: userDoc._id,
        email: userDoc.email,
        roles: userDoc.roles as string[],
      },
      context,
    );
    return { tokens, user: toPublicUser(userDoc) };
  };
}
