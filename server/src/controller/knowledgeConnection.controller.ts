import { Request, Response } from "express";
import { KnowledgeConnectionService, NotFoundError } from "../services/knowledgeConnection.service";
import { ForbiddenError } from "../util/botAccess";
import { sendResponse } from "../util/sendResponse";
import { env } from "../config/env";

const sendForbidden = (res: Response, error: unknown): boolean => {
  if (error instanceof ForbiddenError) {
    sendResponse({ res, success: false, message: error.message, status: 403 });
    return true;
  }
  if (error instanceof NotFoundError) {
    sendResponse({ res, success: false, message: error.message, status: 404 });
    return true;
  }
  return false;
};

// Where the OAuth callback redirects the browser back to once it's done —
// the client's connections tab, not a JSON response.
const clientRedirectBase = () => env.clientOrigins[0] ?? "http://localhost:5173";

export class KnowledgeConnectionController {
  service = new KnowledgeConnectionService();

  startConnect = async (req: Request, res: Response) => {
    try {
      if (!req.user) {
        sendResponse({ res, success: false, message: "Not authenticated", status: 401 });
        return;
      }
      const { botId } = req.params;
      const result = await this.service.startConnect({ botId, actor: req.user });
      sendResponse({ res, success: true, message: "Connect this bot to Google Drive by visiting authUrl", data: result, status: 201 });
    } catch (error) {
      if (sendForbidden(res, error)) return;
      console.error("Error starting Google Drive connection:", error);
      sendResponse({ res, success: false, message: error instanceof Error ? error.message : "Failed to start connection", status: 500 });
    }
  };

  // Public route — Google redirects the bare browser here with no auth
  // header, so this never renders JSON, only redirects onward.
  completeConnect = async (req: Request, res: Response) => {
    const { code, state, error: oauthError } = req.query as { code?: string; state?: string; error?: string };
    try {
      if (oauthError || !code || !state) {
        res.redirect(`${clientRedirectBase()}/?driveConnectionError=${encodeURIComponent(oauthError || "missing_code")}`);
        return;
      }
      const connection = await this.service.completeConnect({ code, state });
      res.redirect(`${clientRedirectBase()}/agent-details/${connection.botId}?connected=1`);
    } catch (error) {
      console.error("Error completing Google Drive connection:", error);
      res.redirect(`${clientRedirectBase()}/?driveConnectionError=${encodeURIComponent(error instanceof Error ? error.message : "unknown")}`);
    }
  };

  setFolder = async (req: Request, res: Response) => {
    try {
      if (!req.user) {
        sendResponse({ res, success: false, message: "Not authenticated", status: 401 });
        return;
      }
      const { connectionId } = req.params;
      const { folderId } = req.body;
      if (!folderId || typeof folderId !== "string") {
        sendResponse({ res, success: false, message: "folderId is required", status: 400 });
        return;
      }
      const connection = await this.service.setFolder({ connectionId, folderId, actor: req.user });
      sendResponse({ res, success: true, message: "Folder updated", data: connection, status: 200 });
    } catch (error) {
      if (sendForbidden(res, error)) return;
      console.error("Error setting Drive folder:", error);
      sendResponse({ res, success: false, message: error instanceof Error ? error.message : "Failed to update folder", status: 500 });
    }
  };

  listFolders = async (req: Request, res: Response) => {
    try {
      if (!req.user) {
        sendResponse({ res, success: false, message: "Not authenticated", status: 401 });
        return;
      }
      const { connectionId } = req.params;
      const folders = await this.service.listFolders({ connectionId, actor: req.user });
      sendResponse({ res, success: true, message: "Folders retrieved successfully", data: folders, status: 200 });
    } catch (error) {
      if (sendForbidden(res, error)) return;
      console.error("Error listing Drive folders:", error);
      sendResponse({ res, success: false, message: error instanceof Error ? error.message : "Failed to list folders", status: 500 });
    }
  };

  listConnections = async (req: Request, res: Response) => {
    try {
      if (!req.user) {
        sendResponse({ res, success: false, message: "Not authenticated", status: 401 });
        return;
      }
      const { botId } = req.params;
      const connections = await this.service.listConnections({ botId, actor: req.user });
      sendResponse({ res, success: true, message: "Connections retrieved successfully", data: connections, status: 200 });
    } catch (error) {
      if (sendForbidden(res, error)) return;
      console.error("Error listing connections:", error);
      sendResponse({ res, success: false, message: "Failed to list connections", status: 500 });
    }
  };

  disconnect = async (req: Request, res: Response) => {
    try {
      if (!req.user) {
        sendResponse({ res, success: false, message: "Not authenticated", status: 401 });
        return;
      }
      const { connectionId } = req.params;
      await this.service.disconnect({ connectionId, actor: req.user });
      sendResponse({ res, success: true, message: "Connection and its synced files deleted", status: 200 });
    } catch (error) {
      if (sendForbidden(res, error)) return;
      console.error("Error disconnecting connection:", error);
      sendResponse({ res, success: false, message: "Failed to disconnect connection", status: 500 });
    }
  };

  triggerSync = async (req: Request, res: Response) => {
    try {
      if (!req.user) {
        sendResponse({ res, success: false, message: "Not authenticated", status: 401 });
        return;
      }
      const { connectionId } = req.params;
      const log = await this.service.triggerSync({ connectionId, actor: req.user });
      sendResponse({ res, success: true, message: "Sync started", data: { logId: log._id, status: log.status }, status: 202 });
    } catch (error) {
      if (sendForbidden(res, error)) return;
      console.error("Error triggering sync:", error);
      sendResponse({ res, success: false, message: error instanceof Error ? error.message : "Failed to start sync", status: 500 });
    }
  };

  getLogs = async (req: Request, res: Response) => {
    try {
      if (!req.user) {
        sendResponse({ res, success: false, message: "Not authenticated", status: 401 });
        return;
      }
      const { connectionId } = req.params;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const { logs, total } = await this.service.getLogs({ connectionId, actor: req.user, page, limit });
      sendResponse({
        res,
        success: true,
        pagination: true,
        message: "Sync logs retrieved successfully",
        data: { page, limit, total, data: logs },
        status: 200,
      });
    } catch (error) {
      if (sendForbidden(res, error)) return;
      console.error("Error reading sync logs:", error);
      sendResponse({ res, success: false, message: "Failed to read sync logs", status: 500 });
    }
  };
}
