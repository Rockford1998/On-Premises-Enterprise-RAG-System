import multer from "multer";
import fs from "fs";
import path from "path";
import { env } from "../config/env";

/**
 * Extensions the knowledge-base upload accepts. Everything but "zip" is
 * parsed by readFile() (keep those in step with util/readFile.ts) — "zip" is
 * handled separately in knowledgebase.service.ts's processZipFile, which
 * extracts and ingests each source/text file inside it individually.
 */
export const SUPPORTED_UPLOAD_EXTENSIONS = ["pdf", "docx", "doc", "pptx", "txt", "zip"] as const;

const MAX_FILE_BYTES = Number(process.env.MAX_UPLOAD_BYTES) || 25 * 1024 * 1024; // 25 MB

/** Raised for a rejected upload so the controller can answer 400, not 500. */
export class UnsupportedFileTypeError extends Error {
  constructor(public extension: string, supported: readonly string[] = SUPPORTED_UPLOAD_EXTENSIONS) {
    super(`Unsupported file type ".${extension}". Supported: ${supported.join(", ")}.`);
    this.name = "UnsupportedFileTypeError";
  }
}

const extensionOf = (filename: string) =>
  path.extname(filename).replace(/^\./, "").toLowerCase();

const storage = multer.diskStorage({
  destination: function (req, _file, cb) {
    // basename() strips any path components: a botId of "../../etc" would
    // otherwise escape the uploads directory.
    const botId = path.basename(req.params.botId ?? "");
    if (!botId || botId === "." || botId === "..") {
      cb(new Error("Invalid botId"), "");
      return;
    }

    const botDir = path.join("uploads", botId);
    if (!fs.existsSync(botDir)) {
      fs.mkdirSync(botDir, { recursive: true });
    }
    cb(null, botDir);
  },
  filename: function (_req, file, cb) {
    // Same reasoning as above — the client controls originalname.
    cb(null, path.basename(file.originalname));
  },
});

/**
 * Zip upload for Code_Interpreter repositories. A separate multer instance so
 * the 25 MB KB uploader stays as it is: source archives are much larger, and
 * only zip is accepted. Files land in uploads/<botId>/code/ and are deleted
 * once indexing has read them (the content is stored in Postgres).
 */
const codeStorage = multer.diskStorage({
  destination: function (req, _file, cb) {
    const botId = path.basename(req.params.botId ?? "");
    if (!botId || botId === "." || botId === "..") {
      cb(new Error("Invalid botId"), "");
      return;
    }
    const dir = path.join("uploads", botId, "code");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: function (_req, file, cb) {
    // Timestamp prefix: two uploads of "repo.zip" must not overwrite each other mid-index.
    cb(null, `${Date.now()}-${path.basename(file.originalname)}`);
  },
});

export const CODE_UPLOAD_EXTENSIONS = ["zip"] as const;

export const codeUpload = multer({
  storage: codeStorage,
  limits: { fileSize: env.codeIntel.maxUploadBytes, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ext = extensionOf(file.originalname);
    if (!CODE_UPLOAD_EXTENSIONS.includes(ext as never)) {
      cb(new UnsupportedFileTypeError(ext || "unknown", CODE_UPLOAD_EXTENSIONS));
      return;
    }
    cb(null, true);
  },
});

export const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_BYTES, files: 1 },
  /**
   * Reject unreadable types before anything is written. Previously the file
   * was saved first and only rejected during parsing, which returned a 500
   * and left the rejected file behind on every attempt.
   */
  fileFilter: (_req, file, cb) => {
    const ext = extensionOf(file.originalname);
    if (!SUPPORTED_UPLOAD_EXTENSIONS.includes(ext as never)) {
      cb(new UnsupportedFileTypeError(ext || "unknown"));
      return;
    }
    cb(null, true);
  },
});
