/**
 * Ownership checks for bot-scoped resources (the bot itself, its knowledge
 * base, its tools). `authenticateJWT` only proves who the caller is; nothing
 * previously checked that they were allowed to touch a given bot's data.
 *
 * Two tiers:
 *  - "view"   — read the bot, its KB entries, its tools: owner, a botUsers
 *               member, CONFIG_ADMIN, or anyone when the bot is publicAccess.
 *  - "manage" — mutate the bot or its KB/tools: owner, a botUsers member, or
 *               CONFIG_ADMIN. publicAccess does not grant this tier.
 *
 * Deleting/renaming the bot profile itself is intentionally tighter — see
 * assertCanDeleteBot — since a botUsers member is meant to use and configure
 * a bot's KB/tools, not remove the bot out from under its owner.
 */
import type { AccessTokenPayload } from "../services/token.service";

export class ForbiddenError extends Error {
  constructor(message = "You do not have access to this resource") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export type Actor = Pick<AccessTokenPayload, "email" | "roles">;

/** Bots are stored loosely-typed (see shared.model.ts); accept the shape we need. */
export type BotLike = {
  owner?: { email?: string } | null;
  botUsers?: { users?: unknown[] } | null;
  publicAccess?: boolean;
};

const isAdmin = (actor: Actor): boolean => actor.roles?.includes("CONFIG_ADMIN") ?? false;

const isOwner = (bot: BotLike, actor: Actor): boolean =>
  !!bot.owner?.email && bot.owner.email === actor.email;

const isMember = (bot: BotLike, actor: Actor): boolean =>
  (bot.botUsers?.users ?? []).some((u) => u === actor.email);

/** Can the caller read this bot / its KB / its tools? */
export const canViewBot = (bot: BotLike, actor: Actor): boolean =>
  isAdmin(actor) || isOwner(bot, actor) || isMember(bot, actor) || bot.publicAccess === true;

/** Can the caller mutate this bot's KB/tools, or the bot's own settings? */
export const canManageBot = (bot: BotLike, actor: Actor): boolean =>
  isAdmin(actor) || isOwner(bot, actor) || isMember(bot, actor);

/** Deleting the bot profile is owner/admin only — narrower than canManageBot. */
export const canDeleteBot = (bot: BotLike, actor: Actor): boolean =>
  isAdmin(actor) || isOwner(bot, actor);

export const assertCanView = (bot: BotLike, actor: Actor): void => {
  if (!canViewBot(bot, actor)) {
    throw new ForbiddenError();
  }
};

export const assertCanManage = (bot: BotLike, actor: Actor): void => {
  if (!canManageBot(bot, actor)) {
    throw new ForbiddenError();
  }
};

export const assertCanDelete = (bot: BotLike, actor: Actor): void => {
  if (!canDeleteBot(bot, actor)) {
    throw new ForbiddenError();
  }
};
