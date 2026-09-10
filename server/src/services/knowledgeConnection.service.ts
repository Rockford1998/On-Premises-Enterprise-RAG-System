import fs from "fs";
import path from "path";
import crypto from "crypto";
import { KnowledgeBase, KnowledgeConnection, KnowledgeSyncLog } from "../models/shared.model";
import { BotService } from "./bot.service";
import { KnowledgeBaseService } from "./knowledgebase.service";
import { Actor, assertCanManage, assertCanView } from "../util/botAccess";
import { generateFileHash } from "../util/generateFileHash";
import { readFile } from "../util/readFile";
import {
  getAuthUrl,
  exchangeCodeForTokens,
  driveClientFor,
  listFolderFiles,
  downloadFileBuffer,
  DriveFileMeta,
} from "../util/googleDrive";
import { encryptSecret } from "../util/crypto";

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes to complete the consent screen

class NotFoundError extends Error {
  constructor(message = "Not found") {
    super(message);
    this.name = "NotFoundError";
  }
}

export class KnowledgeConnectionService {
  botService = new BotService();
  knowledgeBaseService = new KnowledgeBaseService();

  private loadBotForConnection = async (botId: string) => {
    const bot = await this.botService.readByBotId(botId);
    if (!bot || typeof bot.vectorTable !== "string") {
      throw new NotFoundError("Bot not found or vectorTable is invalid");
    }
    return bot;
  };

  startConnect = async ({ botId, actor }: { botId: string; actor: Actor }) => {
    const bot = await this.loadBotForConnection(botId);
    assertCanManage(bot, actor);

    const stateToken = crypto.randomBytes(32).toString("hex");
    const connection = await KnowledgeConnection.create({
      botId,
      provider: "google_drive",
      status: "pending",
      stateToken,
      stateExpiresAt: new Date(Date.now() + STATE_TTL_MS),
      createdBy: actor.email,
    });

    return { connectionId: connection._id.toString(), authUrl: getAuthUrl(stateToken) };
  };

  // Public endpoint (Google redirects the bare browser here — no bearer
  // token available), so the stateToken match is the CSRF defense: only the
  // request that started this specific connect flow knows it.
  completeConnect = async ({ code, state }: { code: string; state: string }) => {
    const connection = await KnowledgeConnection.findOne({ stateToken: state, status: "pending" })
      .select("+stateToken +stateExpiresAt")
      .exec();

    if (!connection) {
      throw new NotFoundError("No matching pending connection for this callback");
    }
    if (!connection.stateExpiresAt || connection.stateExpiresAt.getTime() < Date.now()) {
      connection.status = "error";
      connection.stateToken = undefined;
      connection.stateExpiresAt = undefined;
      await connection.save();
      throw new Error("Connection attempt expired — please try connecting again.");
    }

    const { refreshToken, accountEmail } = await exchangeCodeForTokens(code);

    connection.status = "connected";
    connection.accountEmail = accountEmail;
    connection.refreshTokenEncrypted = encryptSecret(refreshToken);
    connection.stateToken = undefined;
    connection.stateExpiresAt = undefined;
    await connection.save();

    return connection;
  };

  setFolder = async ({ connectionId, folderId, actor }: { connectionId: string; folderId: string; actor: Actor }) => {
    const connection = await KnowledgeConnection.findById(connectionId).exec();
    if (!connection) throw new NotFoundError("Connection not found");
    const bot = await this.loadBotForConnection(connection.botId);
    assertCanManage(bot, actor);

    connection.folderId = folderId;
    await connection.save();
    return connection;
  };

  listConnections = async ({ botId, actor }: { botId: string; actor: Actor }) => {
    const bot = await this.loadBotForConnection(botId);
    assertCanView(bot, actor);
    return KnowledgeConnection.find({ botId }).exec();
  };

  disconnect = async ({ connectionId, actor }: { connectionId: string; actor: Actor }) => {
    const connection = await KnowledgeConnection.findById(connectionId).exec();
    if (!connection) throw new NotFoundError("Connection not found");
    const bot = await this.loadBotForConnection(connection.botId);
    assertCanManage(bot, actor);

    // Stops future syncs and drops the credential; deliberately does not
    // touch already-synced KnowledgeBase rows — disconnecting a source isn't
    // the same request as deleting the content it already produced.
    connection.status = "disconnected";
    connection.refreshTokenEncrypted = undefined;
    await connection.save();
    return connection;
  };

  getLogs = async ({
    connectionId,
    actor,
    page = 1,
    limit = 20,
  }: {
    connectionId: string;
    actor: Actor;
    page?: number;
    limit?: number;
  }) => {
    const connection = await KnowledgeConnection.findById(connectionId).exec();
    if (!connection) throw new NotFoundError("Connection not found");
    const bot = await this.loadBotForConnection(connection.botId);
    assertCanView(bot, actor);

    const skip = (page - 1) * limit;
    const [logs, total] = await Promise.all([
      KnowledgeSyncLog.find({ connectionId }).sort({ createdAt: -1 }).skip(skip).limit(limit).exec(),
      KnowledgeSyncLog.countDocuments({ connectionId }),
    ]);
    return { logs, total };
  };

  triggerSync = async ({ connectionId, actor }: { connectionId: string; actor: Actor }) => {
    const connection = await KnowledgeConnection.findById(connectionId).exec();
    if (!connection) throw new NotFoundError("Connection not found");
    const bot = await this.loadBotForConnection(connection.botId);
    assertCanManage(bot, actor);

    if (connection.status !== "connected") {
      throw new Error("Connection is not active — reconnect before syncing.");
    }

    const alreadyRunning = await KnowledgeSyncLog.findOne({ connectionId, status: "running" }).exec();
    if (alreadyRunning) {
      throw new Error("A sync is already in progress for this connection.");
    }

    const log = await KnowledgeSyncLog.create({
      connectionId,
      botId: connection.botId,
      status: "running",
      startedAt: new Date(),
      triggeredBy: actor.email,
    });

    // Fired without awaiting: the request validates and returns immediately;
    // the actual sync happens after. Every error inside runSync must be
    // caught internally — an escaping rejection here would crash the process
    // (there's no queue/worker boundary to isolate it, same as the rest of
    // this codebase's background-work story).
    void this.runSync(log._id.toString()).catch((err) => {
      console.error(`Unexpected error running sync ${log._id}:`, err);
    });

    return log;
  };

  private ingestDriveFile = async ({
    botId,
    vectorTable,
    connectionId,
    file,
    drive,
  }: {
    botId: string;
    vectorTable: string;
    connectionId: string;
    file: DriveFileMeta;
    drive: ReturnType<typeof driveClientFor>;
  }): Promise<{ action: "created" | "skipped" | "failed"; reason?: string }> => {
    const safeName = path.basename(file.name);
    const botDir = path.join("uploads", path.basename(botId), "drive");
    if (!fs.existsSync(botDir)) fs.mkdirSync(botDir, { recursive: true });

    const filePath = path.join(botDir, safeName).split(path.sep).join("/");
    const buffer = await downloadFileBuffer(drive, file.id);
    fs.writeFileSync(filePath, buffer);

    try {
      const fileHash = await generateFileHash({ filePath });
      const docs = await readFile({ fileName: safeName, filePath });
      const rawText = docs.map((doc) => doc.pageContent).join("\n").trim();
      if (!rawText) {
        return { action: "failed", reason: "Extracted text is empty" };
      }

      const outcome = await this.knowledgeBaseService.ingestText({
        botId,
        vectorTable,
        fileName: safeName,
        fileType: file.mimeType,
        rawText,
        fileHash,
        fileSize: buffer.length,
        source: `google-drive:${file.id}`,
        downloadUrl: filePath,
        sourceType: "google_drive",
        connectionId,
        externalId: file.id,
        externalChecksum: file.md5Checksum,
      });

      if (outcome.status === "created") return { action: "created" };
      if (outcome.status === "duplicate") {
        // Content identical to something already indexed for this bot under
        // a different hash lookup — nothing new to store. No KnowledgeBase
        // row is created here, so this file will be re-evaluated (and
        // re-downloaded) on every future sync rather than converging to a
        // checksum-matched "skipped"; acceptable for how rarely two sources
        // hold byte-identical content.
        return { action: "skipped", reason: "Identical content already indexed" };
      }
      return { action: "failed", reason: outcome.status === "failed" ? outcome.reason : "Extracted text is empty" };
    } catch (error) {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      return { action: "failed", reason: error instanceof Error ? error.message : "Unable to process file" };
    }
  };

  private runSync = async (logId: string) => {
    const log = await KnowledgeSyncLog.findById(logId).exec();
    if (!log) return;

    const connection = await KnowledgeConnection.findById(log.connectionId)
      .select("+refreshTokenEncrypted")
      .exec();
    if (!connection || !connection.refreshTokenEncrypted || !connection.folderId) {
      log.status = "failed";
      log.finishedAt = new Date();
      log.error = "Connection is missing its folder or credentials.";
      await log.save();
      return;
    }

    const bot = await this.botService.readByBotId(connection.botId);
    if (!bot || typeof bot.vectorTable !== "string") {
      log.status = "failed";
      log.finishedAt = new Date();
      log.error = "Bot not found or vectorTable is invalid.";
      await log.save();
      return;
    }
    const vectorTable = bot.vectorTable;

    let driveFiles: DriveFileMeta[];
    let drive: ReturnType<typeof driveClientFor>;
    try {
      drive = driveClientFor(connection.refreshTokenEncrypted);
      driveFiles = await listFolderFiles(drive, connection.folderId);
    } catch (error) {
      log.status = "failed";
      log.finishedAt = new Date();
      log.error = error instanceof Error ? error.message : "Unable to list the Drive folder.";
      await log.save();

      connection.lastSyncAt = new Date();
      connection.lastSyncStatus = "failed";
      await connection.save();
      return;
    }

    const existingRows = await KnowledgeBase.find({ connectionId: log.connectionId }).exec();
    const existingByExternalId = new Map(existingRows.map((row) => [row.externalId, row]));
    const driveIds = new Set(driveFiles.map((f) => f.id));

    const summary = { filesTotal: driveFiles.length, filesCreated: 0, filesUpdated: 0, filesDeleted: 0, filesSkipped: 0, filesFailed: 0 };
    const fileResults: { externalId: string; fileName: string; action: string; reason?: string }[] = [];

    for (const file of driveFiles) {
      const existing = existingByExternalId.get(file.id);
      try {
        if (existing && existing.externalChecksum === file.md5Checksum) {
          summary.filesSkipped += 1;
          fileResults.push({ externalId: file.id, fileName: file.name, action: "skipped" });
          continue;
        }

        if (existing) {
          await this.knowledgeBaseService.deleteSyncedEntry({
            connectionId: log.connectionId,
            externalId: file.id,
            vectorTable,
          });
        }

        const result = await this.ingestDriveFile({
          botId: connection.botId,
          vectorTable,
          connectionId: log.connectionId,
          file,
          drive,
        });

        if (result.action === "created") {
          summary[existing ? "filesUpdated" : "filesCreated"] += 1;
          fileResults.push({ externalId: file.id, fileName: file.name, action: existing ? "updated" : "created" });
        } else if (result.action === "skipped") {
          summary.filesSkipped += 1;
          fileResults.push({ externalId: file.id, fileName: file.name, action: "skipped", reason: result.reason });
        } else {
          summary.filesFailed += 1;
          fileResults.push({ externalId: file.id, fileName: file.name, action: "failed", reason: result.reason });
        }
      } catch (error) {
        summary.filesFailed += 1;
        fileResults.push({
          externalId: file.id,
          fileName: file.name,
          action: "failed",
          reason: error instanceof Error ? error.message : "Unable to process file",
        });
      }
    }

    for (const row of existingRows) {
      if (row.externalId && !driveIds.has(row.externalId)) {
        try {
          await this.knowledgeBaseService.deleteSyncedEntry({
            connectionId: log.connectionId,
            externalId: row.externalId,
            vectorTable,
          });
          summary.filesDeleted += 1;
          fileResults.push({ externalId: row.externalId, fileName: row.fileName, action: "deleted" });
        } catch (error) {
          summary.filesFailed += 1;
          fileResults.push({
            externalId: row.externalId,
            fileName: row.fileName,
            action: "failed",
            reason: error instanceof Error ? error.message : "Unable to delete removed file",
          });
        }
      }
    }

    log.status = "completed";
    log.finishedAt = new Date();
    log.summary = summary;
    // Mongoose's generated subdocument-array type doesn't structurally accept
    // a plain array literal under strict mode; the schema is the actual
    // source of truth for shape here.
    log.fileResults = fileResults as unknown as typeof log.fileResults;
    await log.save();

    connection.lastSyncAt = new Date();
    connection.lastSyncStatus = summary.filesFailed === 0 ? "success" : summary.filesFailed === driveFiles.length ? "failed" : "partial";
    connection.lastSyncSummary = {
      filesCreated: summary.filesCreated,
      filesUpdated: summary.filesUpdated,
      filesDeleted: summary.filesDeleted,
      filesSkipped: summary.filesSkipped,
      filesFailed: summary.filesFailed,
    };
    await connection.save();
  };
}

export { NotFoundError };
