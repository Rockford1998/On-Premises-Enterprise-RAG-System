import crypto from "crypto";
import jwt from "jsonwebtoken";
import { user } from "../models/shared.model";
import { env } from "../config/env";

export type AccessTokenPayload = {
  sub: string;
  email: string;
  roles: string[];
  typ: "access";
};

export type IssuedTokens = {
  accessToken: string;
  refreshToken: string;
  /** Absolute expiry of the refresh token, for the cookie maxAge. */
  refreshExpiresAt: Date;
};

export type SessionContext = {
  userAgent?: string;
  ip?: string;
};

/** Raised when a revoked or already-rotated refresh token is presented. */
export class RefreshTokenReuseError extends Error {
  constructor() {
    super("Refresh token reuse detected");
    this.name = "RefreshTokenReuseError";
  }
}

export class InvalidRefreshTokenError extends Error {
  constructor(message = "Invalid or expired refresh token") {
    super(message);
    this.name = "InvalidRefreshTokenError";
  }
}

const sha256 = (value: string) =>
  crypto.createHash("sha256").update(value).digest("hex");

export class TokenService {
  /**
   * Short-lived JWT carrying identity. `typ` prevents a refresh token from
   * being replayed as an access token.
   */
  signAccessToken = ({
    userId,
    email,
    roles,
  }: {
    userId: string;
    email: string;
    roles: string[];
  }): string => {
    const payload: AccessTokenPayload = {
      sub: userId,
      email,
      roles,
      typ: "access",
    };
    return jwt.sign(payload, env.auth.accessSecret, {
      expiresIn: env.auth.accessTtlSeconds,
    });
  };

  verifyAccessToken = (token: string): AccessTokenPayload => {
    const decoded = jwt.verify(token, env.auth.accessSecret) as AccessTokenPayload;
    if (decoded.typ !== "access") {
      throw new jwt.JsonWebTokenError("Wrong token type");
    }
    return decoded;
  };

  /**
   * Refresh tokens are opaque random values, not JWTs: they carry no claims
   * and are only meaningful when matched against the stored hash, so a leaked
   * signing key cannot be used to mint one.
   */
  private generateRefreshToken = (): { raw: string; hash: string } => {
    const raw = crypto.randomBytes(48).toString("base64url");
    return { raw, hash: sha256(raw) };
  };

  /**
   * Drop entries that are no longer useful, then cap the number of live
   * sessions. Runs on every login/refresh because an embedded array cannot
   * carry a Mongo TTL index.
   *
   * Revoked entries are KEPT until they pass their original expiry: they are
   * the tombstones that make reuse detection possible. Deleting them on
   * rotation would make a replayed token indistinguishable from an unknown
   * one, silently disabling theft detection.
   *
   * @param reserve seats to leave free for tokens about to be appended
   */
  private prune = (tokens: any[], reserve = 0): any[] => {
    const now = Date.now();

    // Anything past its expiry is useless, revoked or not.
    const unexpired = tokens.filter(
      (t) => new Date(t.expiresAt).getTime() > now,
    );

    const byAge = (a: any, b: any) =>
      new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime();

    const live = unexpired.filter((t) => !t.revokedAt).sort(byAge);
    const tombstones = unexpired.filter((t) => t.revokedAt).sort(byAge);

    // Cap live sessions only; tombstones are not sessions.
    const allowed = Math.max(0, env.auth.maxSessionsPerUser - reserve);
    const overflow = live.length - allowed;
    const keptLive = overflow > 0 ? live.slice(overflow) : live;

    // Bound tombstone growth too, so the document cannot creep upward.
    const maxTombstones = env.auth.maxSessionsPerUser * 2;
    const keptTombstones =
      tombstones.length > maxTombstones
        ? tombstones.slice(tombstones.length - maxTombstones)
        : tombstones;

    return [...keptTombstones, ...keptLive];
  };

  /** Issue a fresh pair and persist the refresh hash against the user. */
  issueTokensForUser = async (
    userDoc: { _id: any; email: string; roles?: string[] },
    context: SessionContext = {},
  ): Promise<IssuedTokens> => {
    const { raw, hash } = this.generateRefreshToken();
    const refreshExpiresAt = new Date(
      Date.now() + env.auth.refreshTtlSeconds * 1000,
    );

    const current = await user
      .findById(userDoc._id)
      .select("+refreshTokens")
      .exec();
    if (!current) {
      throw new InvalidRefreshTokenError("User not found");
    }

    // reserve:1 — leave room for the session we are about to add.
    const kept = this.prune((current.get("refreshTokens") as any[]) ?? [], 1);
    kept.push({
      tokenHash: hash,
      expiresAt: refreshExpiresAt,
      revokedAt: null,
      userAgent: context.userAgent?.slice(0, 256) ?? "",
      ip: context.ip ?? "",
      createdAt: new Date(),
    });
    current.set("refreshTokens", kept);
    await current.save();

    const accessToken = this.signAccessToken({
      userId: String(userDoc._id),
      email: userDoc.email,
      roles: userDoc.roles ?? ["USER"],
    });

    return { accessToken, refreshToken: raw, refreshExpiresAt };
  };

  /**
   * Validate + rotate. The presented token is revoked and replaced.
   *
   * Presenting a token that exists but is already revoked means it was
   * captured and replayed after a legitimate rotation, so every session for
   * that user is killed.
   */
  rotate = async (
    rawToken: string,
    context: SessionContext = {},
  ): Promise<{ tokens: IssuedTokens; userDoc: any }> => {
    const hash = sha256(rawToken);

    const owner = await user
      .findOne({ "refreshTokens.tokenHash": hash })
      .select("+refreshTokens")
      .exec();

    if (!owner) {
      throw new InvalidRefreshTokenError();
    }

    const tokens = (owner.get("refreshTokens") as any[]) ?? [];
    const match = tokens.find((t) => t.tokenHash === hash);

    if (!match) {
      throw new InvalidRefreshTokenError();
    }

    if (match.revokedAt) {
      // Replay of a rotated token — assume theft and revoke everything.
      owner.set("refreshTokens", []);
      await owner.save();
      throw new RefreshTokenReuseError();
    }

    if (new Date(match.expiresAt).getTime() <= Date.now()) {
      match.revokedAt = new Date();
      owner.set("refreshTokens", this.prune(tokens));
      await owner.save();
      throw new InvalidRefreshTokenError();
    }

    if (owner.isActive === false) {
      throw new InvalidRefreshTokenError("Account is disabled");
    }

    // Rotate: mark the presented token spent, then mint a replacement.
    match.revokedAt = new Date();

    const { raw, hash: nextHash } = this.generateRefreshToken();
    const refreshExpiresAt = new Date(
      Date.now() + env.auth.refreshTtlSeconds * 1000,
    );

    // The just-revoked token stays as a tombstone (prune keeps revoked but
    // unexpired entries) so a replay is detectable as reuse.
    const kept = this.prune(tokens, 1);
    kept.push({
      tokenHash: nextHash,
      expiresAt: refreshExpiresAt,
      revokedAt: null,
      userAgent: context.userAgent?.slice(0, 256) ?? "",
      ip: context.ip ?? "",
      createdAt: new Date(),
    });
    owner.set("refreshTokens", kept);
    await owner.save();

    const accessToken = this.signAccessToken({
      userId: String(owner._id),
      email: owner.email,
      roles: (owner.roles as string[]) ?? ["USER"],
    });

    return {
      tokens: { accessToken, refreshToken: raw, refreshExpiresAt },
      userDoc: owner,
    };
  };

  /** Revoke a single session. Silent when the token is already gone. */
  revoke = async (rawToken: string): Promise<void> => {
    if (!rawToken) return;
    const hash = sha256(rawToken);
    const owner = await user
      .findOne({ "refreshTokens.tokenHash": hash })
      .select("+refreshTokens")
      .exec();
    if (!owner) return;

    // Deliberate logout: drop the entry outright rather than tombstoning it.
    // The user ended this session, so a later presentation of it is not
    // evidence of theft.
    const tokens = ((owner.get("refreshTokens") as any[]) ?? []).filter(
      (t) => t.tokenHash !== hash,
    );
    owner.set("refreshTokens", this.prune(tokens));
    await owner.save();
  };

  /** Revoke every session for a user (logout everywhere / password change). */
  revokeAllForUser = async (userId: string): Promise<void> => {
    await user
      .findByIdAndUpdate(userId, { $set: { refreshTokens: [] } })
      .exec();
  };
}
