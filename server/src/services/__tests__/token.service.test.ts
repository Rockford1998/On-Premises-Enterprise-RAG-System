jest.mock("../../models/shared.model", () => ({
  user: {
    findById: jest.fn(),
    findOne: jest.fn(),
    findByIdAndUpdate: jest.fn(),
  },
}));

import { user } from "../../models/shared.model";
import {
  TokenService,
  RefreshTokenReuseError,
  InvalidRefreshTokenError,
} from "../token.service";

const mockedUser = user as unknown as {
  findById: jest.Mock;
  findOne: jest.Mock;
  findByIdAndUpdate: jest.Mock;
};

/** Mimics the `.select(...).exec()` chain every real call in token.service makes. */
function makeQuery(resolvedValue: unknown) {
  const query: any = {};
  query.select = jest.fn(() => query);
  query.exec = jest.fn(() => Promise.resolve(resolvedValue));
  return query;
}

/** A minimal stand-in for a mongoose user document, matching the get/set/save
 * surface token.service.ts actually uses. */
function makeUserDoc(fields: { _id: string; email: string; roles: string[]; isActive?: boolean }) {
  const state: Record<string, any> = { refreshTokens: [] };
  return {
    _id: fields._id,
    email: fields.email,
    roles: fields.roles,
    isActive: fields.isActive ?? true,
    get: (key: string) => state[key],
    set: (key: string, value: any) => {
      state[key] = value;
    },
    save: jest.fn(async () => undefined),
  };
}

describe("TokenService", () => {
  const tokenService = new TokenService();
  const baseUser = { _id: "user1", email: "a@b.com", roles: ["USER"] };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("issues an access+refresh pair and persists the refresh hash", async () => {
    const doc = makeUserDoc(baseUser);
    mockedUser.findById.mockReturnValue(makeQuery(doc));

    const tokens = await tokenService.issueTokensForUser(baseUser);

    expect(tokens.accessToken).toEqual(expect.any(String));
    expect(tokens.refreshToken).toEqual(expect.any(String));
    expect(doc.save).toHaveBeenCalledTimes(1);
    expect(doc.get("refreshTokens")).toHaveLength(1);
    // The raw token is never what gets stored.
    expect(doc.get("refreshTokens")[0].tokenHash).not.toEqual(tokens.refreshToken);
  });

  it("rotates a valid refresh token into a new pair and tombstones the old one", async () => {
    const doc = makeUserDoc(baseUser);
    mockedUser.findById.mockReturnValue(makeQuery(doc));
    const issued = await tokenService.issueTokensForUser(baseUser);

    mockedUser.findOne.mockReturnValue(makeQuery(doc));
    const { tokens } = await tokenService.rotate(issued.refreshToken);

    expect(tokens.refreshToken).not.toEqual(issued.refreshToken);

    const stored = doc.get("refreshTokens");
    expect(stored).toHaveLength(2); // spent tombstone + new live entry
    expect(stored.some((t: any) => t.revokedAt !== null)).toBe(true);
    expect(stored.some((t: any) => t.revokedAt === null)).toBe(true);
  });

  it("detects reuse of an already-rotated refresh token and revokes every session", async () => {
    const doc = makeUserDoc(baseUser);
    mockedUser.findById.mockReturnValue(makeQuery(doc));
    const issued = await tokenService.issueTokensForUser(baseUser);

    mockedUser.findOne.mockReturnValue(makeQuery(doc));
    await tokenService.rotate(issued.refreshToken); // spends the first token

    // Replaying the now-spent token is theft, not a normal rotation.
    mockedUser.findOne.mockReturnValue(makeQuery(doc));
    await expect(tokenService.rotate(issued.refreshToken)).rejects.toBeInstanceOf(
      RefreshTokenReuseError,
    );
    expect(doc.get("refreshTokens")).toHaveLength(0);
  });

  it("rejects an unknown refresh token", async () => {
    mockedUser.findOne.mockReturnValue(makeQuery(null));
    await expect(tokenService.rotate("not-a-real-token")).rejects.toBeInstanceOf(
      InvalidRefreshTokenError,
    );
  });

  it("rejects rotation for a disabled account", async () => {
    const doc = makeUserDoc(baseUser);
    mockedUser.findById.mockReturnValue(makeQuery(doc));
    const issued = await tokenService.issueTokensForUser(baseUser);

    doc.isActive = false;
    mockedUser.findOne.mockReturnValue(makeQuery(doc));

    await expect(tokenService.rotate(issued.refreshToken)).rejects.toBeInstanceOf(
      InvalidRefreshTokenError,
    );
  });
});
