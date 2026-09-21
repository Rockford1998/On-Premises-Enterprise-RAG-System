import fs from "fs";
import mongoose from "mongoose";
import { env } from "../config/env";
import { DirectorySource, SourceError, ZipSource } from "../codeIntel/extract/fileSource";
import { RepoLimitError } from "../codeIntel/extract/walker";
import type { FileSource } from "../codeIntel/core/types";
import { CodeIndexRun } from "../models/shared.model";
import { Actor, assertCanManage, assertCanView } from "../util/botAccess";
import { BotService } from "./bot.service";
import { CodeGraphService } from "./codeGraph.service";
import { CodeConfig, IndexParams, IndexProgress, indexRepository, NoFilesError } from "./codeIndexer.service";

/** A caller mistake that maps to a specific HTTP status (the controller does the mapping). */
export class CodeRequestError extends Error {
  constructor(message: string, public status: 400 | 404 | 409) {
    super(message);
    this.name = "CodeRequestError";
  }
}

const REPO_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** Repository names go into unit ids (`<repo>:<path>#<symbol>`), so they cannot contain `:` or `#`. */
export const validateRepoName = (name: string): string => {
  if (!REPO_NAME_PATTERN.test(name)) {
    throw new CodeRequestError(
      "Repository name must be 1–64 characters: letters, digits, '.', '_' or '-', starting with a letter or digit.",
      400,
    );
  }
  return name;
};

/** "my repo (v2).zip" → "my-repo-v2" */
export const deriveRepoName = (fileName: string): string => {
  const base = fileName.replace(/\.zip$/i, "").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  const name = (/^[A-Za-z0-9]/.test(base) ? base : `repo-${base}`).slice(0, 64);
  return name === "repo-" || name === "" ? "repository" : name;
};

const PROGRESS_THROTTLE_MS = 1000;

const friendlyFailure = (error: unknown): string => {
  if (error instanceof NoFilesError || error instanceof RepoLimitError || error instanceof SourceError) return error.message;
  return "Indexing failed. Check the server logs for details.";
};

/**
 * Run lifecycle for Code_Interpreter indexing. Runs execute in this process,
 * fire-and-forget (there is no job queue); the CodeIndexRun document's
 * "running" status — enforced unique per bot by a partial index — is what
 * stops two runs overlapping, and what the UI polls.
 */
export class CodeIndexService {
  botService = new BotService();

  /**
   * Mark every leftover "running" run as failed. Call once at startup, before
   * accepting traffic — nothing can legitimately be running at that point,
   * since runs live inside this process.
   */
  public static async sweepStaleRuns(): Promise<number> {
    const result = await CodeIndexRun.updateMany(
      { status: "running" },
      { $set: { status: "failed", finishedAt: new Date(), error: "Server restarted while this run was in progress." } },
    );
    if (result.modifiedCount > 0) {
      console.warn(`[code-index] marked ${result.modifiedCount} interrupted run(s) as failed`);
    }
    return result.modifiedCount;
  }

  /** Load the bot and check the caller may act on it. Also used as upload middleware, before a large file is accepted. */
  authorize = async ({ botId, actor, tier }: { botId: string; actor: Actor; tier: "view" | "manage" }) => {
    const bot = await this.botService.readByBotId(botId);
    if (!bot) throw new CodeRequestError("Bot not found.", 404);
    if (bot.botType !== "Code_Interpreter") throw new CodeRequestError("This bot is not a code interpreter bot.", 400);
    if (tier === "manage") assertCanManage(bot, actor);
    else assertCanView(bot, actor);
    const config = bot.codeConfig as CodeConfig | undefined;
    if (!config?.embedModel || !config.embedDim || !config.embedType) {
      throw new CodeRequestError("This bot has no code embedding configuration.", 400);
    }
    return { bot, codeConfig: config };
  };

  /**
   * Start indexing an uploaded zip. Takes ownership of `zipPath`: it is
   * deleted when the run ends, or straight away if the run cannot start.
   */
  startZipRun = async ({
    botId,
    actor,
    zipPath,
    originalName,
    repoName,
    summarize,
  }: {
    botId: string;
    actor: Actor;
    zipPath: string;
    originalName: string;
    repoName?: string;
    summarize?: boolean;
  }): Promise<{ runId: string; repoName: string }> => {
    const cleanup = () => fs.promises.rm(zipPath, { force: true }).catch(() => undefined);
    try {
      const authorized = await this.authorize({ botId, actor, tier: "manage" });
      const name = validateRepoName(repoName?.trim() || deriveRepoName(originalName));
      let source: ZipSource;
      try {
        source = new ZipSource(zipPath, {
          maxEntries: env.codeIntel.maxFiles * 5,
          maxTotalBytes: env.codeIntel.maxUncompressedBytes,
        });
      } catch (error) {
        if (error instanceof SourceError) throw new CodeRequestError(error.message, 400);
        throw error;
      }
      const runId = await this.begin({
        botId, actor, authorized, name, source, sourceType: "zip", sourceRef: null, summarize, onFinished: cleanup,
      });
      return { runId, repoName: name };
    } catch (error) {
      await cleanup();
      throw error;
    }
  };

  /** Start indexing a directory under CODE_REPOS_ROOT. */
  startPathRun = async ({
    botId,
    actor,
    path,
    repoName,
    summarize,
  }: {
    botId: string;
    actor: Actor;
    path: string;
    repoName?: string;
    summarize?: boolean;
  }): Promise<{ runId: string; repoName: string }> => {
    const authorized = await this.authorize({ botId, actor, tier: "manage" });
    if (!env.codeIntel.reposRoot) {
      throw new CodeRequestError("Server-path sources are disabled on this deployment (CODE_REPOS_ROOT is not set).", 400);
    }
    if (typeof path !== "string" || !path.trim()) throw new CodeRequestError("A path is required.", 400);
    let source: DirectorySource;
    try {
      source = await DirectorySource.open({ root: path.trim(), allowedRoot: env.codeIntel.reposRoot });
    } catch (error) {
      if (error instanceof SourceError) throw new CodeRequestError(error.message, 400);
      throw error;
    }
    const name = validateRepoName(repoName?.trim() || deriveRepoName(path.trim().split(/[\\/]/).filter(Boolean).pop() ?? "repository"));
    const runId = await this.begin({
      botId, actor, authorized, name, source, sourceType: "path", sourceRef: path.trim(), summarize,
    });
    return { runId, repoName: name };
  };

  private begin = async ({
    botId,
    actor,
    authorized,
    name,
    source,
    sourceType,
    sourceRef,
    summarize,
    onFinished,
  }: {
    botId: string;
    actor: Actor;
    authorized: Awaited<ReturnType<CodeIndexService["authorize"]>>;
    name: string;
    source: FileSource;
    sourceType: "zip" | "path";
    sourceRef: string | null;
    summarize?: boolean;
    onFinished?: () => unknown;
  }): Promise<string> => {
    let run;
    try {
      run = await CodeIndexRun.create({ botId, repoName: name, mode: "full", status: "running", triggeredBy: actor.email });
    } catch (error) {
      // The partial unique index (one "running" run per bot) rejected a concurrent start.
      if ((error as { code?: number }).code === 11000) {
        throw new CodeRequestError("An indexing run is already in progress for this bot.", 409);
      }
      throw error;
    }

    const params: IndexParams = {
      botId,
      codeConfig: authorized.codeConfig,
      baseModel: authorized.bot.baseModel?.name,
      repoName: name,
      sourceType,
      sourceRef,
      source,
      summarize: summarize ?? env.codeIntel.summarize,
      limits: { maxFiles: env.codeIntel.maxFiles, maxFileBytes: env.codeIntel.maxFileBytes },
      excludeGlobs: [...env.codeIntel.excludeGlobs],
      concurrency: env.codeIntel.maxConcurrency,
      maxChunkTokens: env.codeIntel.maxChunkTokens,
      numCtx: env.codeIntel.numCtx,
    };

    // Deliberately not awaited: the request returns immediately and the UI polls the run.
    void this.execute({ runId: run._id, params, onFinished }).catch((error) => {
      console.error(`[code-index] unexpected error in run ${run._id}:`, error);
    });
    return run._id.toString();
  };

  /** Everything inside is caught: an escaping rejection would crash the process, as there is no worker boundary. */
  private execute = async ({
    runId,
    params,
    onFinished,
  }: {
    runId: mongoose.Types.ObjectId;
    params: IndexParams;
    onFinished?: () => unknown;
  }): Promise<void> => {
    let lastWrite = 0;
    const onProgress = (progress: IndexProgress) => {
      const now = Date.now();
      if (now - lastWrite < PROGRESS_THROTTLE_MS) return;
      lastWrite = now;
      const { stats, phase, done, total } = progress;
      void CodeIndexRun.updateOne({ _id: runId, status: "running" }, { $set: { stats: { ...stats, phase, done, total } } })
        .exec()
        .catch(() => undefined);
    };

    try {
      const result = await indexRepository({ ...params, onProgress });
      await CodeIndexRun.updateOne(
        { _id: runId },
        {
          $set: {
            status: result.fileErrors.length > 0 ? "partial" : "completed",
            finishedAt: new Date(),
            stats: { ...result.stats, phase: "done" },
            fileErrors: result.fileErrors.slice(0, 200),
          },
        },
      ).exec();
    } catch (error) {
      console.error(`[code-index] run ${runId} failed:`, error);
      await CodeIndexRun.updateOne(
        { _id: runId },
        { $set: { status: "failed", finishedAt: new Date(), error: friendlyFailure(error) } },
      )
        .exec()
        .catch(() => undefined);
    } finally {
      await Promise.resolve(onFinished?.()).catch(() => undefined);
    }
  };

  listRuns = async ({ botId, actor, limit = 10 }: { botId: string; actor: Actor; limit?: number }) => {
    await this.authorize({ botId, actor, tier: "view" });
    return CodeIndexRun.find({ botId }).sort({ createdAt: -1 }).limit(Math.min(Math.max(limit, 1), 50)).lean().exec();
  };

  getRun = async ({ botId, runId, actor }: { botId: string; runId: string; actor: Actor }) => {
    await this.authorize({ botId, actor, tier: "view" });
    if (!mongoose.isValidObjectId(runId)) throw new CodeRequestError("Run not found.", 404);
    const run = await CodeIndexRun.findOne({ _id: runId, botId }).lean().exec();
    if (!run) throw new CodeRequestError("Run not found.", 404);
    return run;
  };

  listRepos = async ({ botId, actor }: { botId: string; actor: Actor }) => {
    await this.authorize({ botId, actor, tier: "view" });
    return CodeGraphService.listRepos({ botId });
  };

  deleteRepo = async ({ botId, repoId, actor }: { botId: string; repoId: number; actor: Actor }) => {
    await this.authorize({ botId, actor, tier: "manage" });
    if (!Number.isInteger(repoId) || repoId <= 0) throw new CodeRequestError("Repository not found.", 404);
    // Deleting rows out from under a run that is writing them would only produce errors.
    if (await CodeIndexRun.exists({ botId, status: "running" })) {
      throw new CodeRequestError("An indexing run is in progress; try again when it has finished.", 409);
    }
    const deleted = await CodeGraphService.deleteRepo({ botId, repoId });
    if (!deleted) throw new CodeRequestError("Repository not found.", 404);
  };
}
