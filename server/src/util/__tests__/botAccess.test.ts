import {
  canViewBot,
  canManageBot,
  canDeleteBot,
  assertCanView,
  assertCanManage,
  assertCanDelete,
  ForbiddenError,
} from "../botAccess";

describe("botAccess", () => {
  const owner = { email: "owner@example.com", roles: ["USER"] };
  const member = { email: "member@example.com", roles: ["USER"] };
  const stranger = { email: "stranger@example.com", roles: ["USER"] };
  const admin = { email: "admin@example.com", roles: ["CONFIG_ADMIN"] };

  const bot = {
    owner: { email: owner.email },
    botUsers: { users: [member.email] },
    publicAccess: false,
  };

  it("lets the owner view, manage, and delete", () => {
    expect(canViewBot(bot, owner)).toBe(true);
    expect(canManageBot(bot, owner)).toBe(true);
    expect(canDeleteBot(bot, owner)).toBe(true);
  });

  it("lets a botUsers member view and manage, but not delete", () => {
    expect(canViewBot(bot, member)).toBe(true);
    expect(canManageBot(bot, member)).toBe(true);
    expect(canDeleteBot(bot, member)).toBe(false);
  });

  it("denies a stranger everything on a private bot", () => {
    expect(canViewBot(bot, stranger)).toBe(false);
    expect(canManageBot(bot, stranger)).toBe(false);
    expect(canDeleteBot(bot, stranger)).toBe(false);
  });

  it("lets CONFIG_ADMIN do everything regardless of ownership", () => {
    expect(canViewBot(bot, admin)).toBe(true);
    expect(canManageBot(bot, admin)).toBe(true);
    expect(canDeleteBot(bot, admin)).toBe(true);
  });

  it("lets anyone view (but not manage or delete) a publicAccess bot", () => {
    const publicBot = { ...bot, publicAccess: true };
    expect(canViewBot(publicBot, stranger)).toBe(true);
    expect(canManageBot(publicBot, stranger)).toBe(false);
    expect(canDeleteBot(publicBot, stranger)).toBe(false);
  });

  it("assert helpers throw ForbiddenError instead of returning false", () => {
    expect(() => assertCanView(bot, stranger)).toThrow(ForbiddenError);
    expect(() => assertCanManage(bot, stranger)).toThrow(ForbiddenError);
    expect(() => assertCanDelete(bot, member)).toThrow(ForbiddenError);
    expect(() => assertCanView(bot, owner)).not.toThrow();
  });
});
