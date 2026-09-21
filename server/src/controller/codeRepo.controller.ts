import fs from "fs";
import { NextFunction, Request, Response } from "express";
import { CodeIndexService, CodeRequestError } from "../services/codeIndex.service";
import { ForbiddenError } from "../util/botAccess";
import { sendResponse } from "../util/sendResponse";

const asBool = (value: unknown): boolean | undefined =>
  value === true || value === "true" ? true : value === false || value === "false" ? false : undefined;

/** Map the service's known errors to responses. Returns true when it handled the error. */
const sendKnownError = (res: Response, error: unknown): boolean => {
  if (error instanceof ForbiddenError) {
    sendResponse({ res, success: false, message: error.message, status: 403 });
    return true;
  }
  if (error instanceof CodeRequestError) {
    sendResponse({ res, success: false, message: error.message, status: error.status });
    return true;
  }
  return false;
};

export class CodeRepoController {
  service = new CodeIndexService();

  /**
   * Runs before multer, so a caller who may not manage this bot is refused
   * before a (potentially 200 MB) upload is written to disk.
   */
  authorizeUpload = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        sendResponse({ res, success: false, message: "Not authenticated", status: 401 });
        return;
      }
      await this.service.authorize({ botId: req.params.botId, actor: req.user, tier: "manage" });
      next();
    } catch (error) {
      if (sendKnownError(res, error)) return;
      console.error("Error authorising code upload:", error);
      sendResponse({ res, success: false, message: "Failed to start indexing", status: 500 });
    }
  };

  uploadRepo = async (req: Request, res: Response) => {
    const file = req.file;
    try {
      if (!req.user) {
        sendResponse({ res, success: false, message: "Not authenticated", status: 401 });
        if (file) await fs.promises.rm(file.path, { force: true });
        return;
      }
      if (!file) {
        sendResponse({ res, success: false, message: "No file uploaded. Send a .zip as the 'file' field.", status: 400, code: "VALIDATION_ERROR" });
        return;
      }
      // From here the service owns the uploaded file and deletes it when the run ends.
      const started = await this.service.startZipRun({
        botId: req.params.botId,
        actor: req.user,
        zipPath: file.path,
        originalName: file.originalname,
        repoName: typeof req.body?.name === "string" ? req.body.name : undefined,
        summarize: asBool(req.body?.summarize),
      });
      sendResponse({ res, success: true, message: "Indexing started", data: started, status: 202 });
    } catch (error) {
      if (sendKnownError(res, error)) return;
      console.error("Error starting code indexing:", error);
      sendResponse({ res, success: false, message: "Failed to start indexing", status: 500 });
    }
  };

  indexPath = async (req: Request, res: Response) => {
    try {
      if (!req.user) {
        sendResponse({ res, success: false, message: "Not authenticated", status: 401 });
        return;
      }
      const started = await this.service.startPathRun({
        botId: req.params.botId,
        actor: req.user,
        path: req.body?.path,
        repoName: typeof req.body?.name === "string" ? req.body.name : undefined,
        summarize: asBool(req.body?.summarize),
      });
      sendResponse({ res, success: true, message: "Indexing started", data: started, status: 202 });
    } catch (error) {
      if (sendKnownError(res, error)) return;
      console.error("Error starting code indexing from a path:", error);
      sendResponse({ res, success: false, message: "Failed to start indexing", status: 500 });
    }
  };

  listRepos = async (req: Request, res: Response) => {
    try {
      if (!req.user) {
        sendResponse({ res, success: false, message: "Not authenticated", status: 401 });
        return;
      }
      const repos = await this.service.listRepos({ botId: req.params.botId, actor: req.user });
      sendResponse({ res, success: true, message: "Repositories retrieved", data: repos, status: 200 });
    } catch (error) {
      if (sendKnownError(res, error)) return;
      console.error("Error listing repositories:", error);
      sendResponse({ res, success: false, message: "Failed to list repositories", status: 500 });
    }
  };

  deleteRepo = async (req: Request, res: Response) => {
    try {
      if (!req.user) {
        sendResponse({ res, success: false, message: "Not authenticated", status: 401 });
        return;
      }
      await this.service.deleteRepo({ botId: req.params.botId, repoId: Number(req.params.repoId), actor: req.user });
      sendResponse({ res, success: true, message: "Repository deleted", status: 200 });
    } catch (error) {
      if (sendKnownError(res, error)) return;
      console.error("Error deleting repository:", error);
      sendResponse({ res, success: false, message: "Failed to delete repository", status: 500 });
    }
  };

  listRuns = async (req: Request, res: Response) => {
    try {
      if (!req.user) {
        sendResponse({ res, success: false, message: "Not authenticated", status: 401 });
        return;
      }
      const limit = Number(req.query.limit) || 10;
      const runs = await this.service.listRuns({ botId: req.params.botId, actor: req.user, limit });
      sendResponse({ res, success: true, message: "Runs retrieved", data: runs, status: 200 });
    } catch (error) {
      if (sendKnownError(res, error)) return;
      console.error("Error listing index runs:", error);
      sendResponse({ res, success: false, message: "Failed to list runs", status: 500 });
    }
  };

  getRun = async (req: Request, res: Response) => {
    try {
      if (!req.user) {
        sendResponse({ res, success: false, message: "Not authenticated", status: 401 });
        return;
      }
      const run = await this.service.getRun({ botId: req.params.botId, runId: req.params.runId, actor: req.user });
      sendResponse({ res, success: true, message: "Run retrieved", data: run, status: 200 });
    } catch (error) {
      if (sendKnownError(res, error)) return;
      console.error("Error reading index run:", error);
      sendResponse({ res, success: false, message: "Failed to read run", status: 500 });
    }
  };
}
