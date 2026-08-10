import bcrypt from "bcryptjs";
import { user } from "../models/shared.model";
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
 * In-memory fixed-window throttle keyed on email+IP. Adequate for a
 * single-process on-prem deployment; move to a shared store if the API is
 * ever horizontally scaled.
 */
class LoginThrottle {
  private attempts = new Map<string, { count: number; resetAt: number }>();

  check(key: string): void {
    const entry = this.attempts.get(key);
    const now = Date.now();
    if (!entry || entry.resetAt <= now) return;
    if (entry.count >= env.auth.loginMaxAttempts) {
      throw new TooManyAttemptsError(Math.ceil((entry.resetAt - now) / 1000));
    }
  }

  fail(key: string): void {
    const now = Date.now();
    const entry = this.attempts.get(key);
    if (!entry || entry.resetAt <= now) {
      this.attempts.set(key, {
        count: 1,
        resetAt: now + env.auth.loginWindowSeconds * 1000,
      });
      return;
    }
    entry.count += 1;
  }

  clear(key: string): void {
    this.attempts.delete(key);
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
    this.throttle.check(throttleKey);

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
      this.throttle.fail(throttleKey);
      throw new InvalidCredentialsError();
    }

    if (found.isActive === false) {
      throw new AccountDisabledError();
    }

    this.throttle.clear(throttleKey);

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
