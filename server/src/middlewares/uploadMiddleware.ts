import multer from "multer";
import fs from "fs";
import path from "path";

/** Extensions readFile() can actually parse. Keep in step with util/readFile.ts. */
export const SUPPORTED_UPLOAD_EXTENSIONS = ["pdf", "docx", "doc", "pptx", "txt"] as const;

const MAX_FILE_BYTES = Number(process.env.MAX_UPLOAD_BYTES) || 25 * 1024 * 1024; // 25 MB

/** Raised for a rejected upload so the controller can answer 400, not 500. */
export class UnsupportedFileTypeError extends Error {
  constructor(public extension: string) {
    super(
      `Unsupported file type ".${extension}". Supported: ${SUPPORTED_UPLOAD_EXTENSIONS.join(", ")}.`,
    );
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
