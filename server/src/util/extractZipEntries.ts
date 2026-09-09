import AdmZip from "adm-zip";

/**
 * Extensions treated as readable source/text when found inside an uploaded
 * .zip. Kept separate from SUPPORTED_UPLOAD_EXTENSIONS (uploadMiddleware.ts),
 * which gates the *outer* upload — this gates what's worth ingesting once
 * a zip has already been accepted.
 */
const CODE_TEXT_EXTENSIONS = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs",
  "py", "java", "go", "rb", "php", "c", "cpp", "h", "hpp", "cs",
  "rs", "kt", "swift", "scala",
  "md", "mdx", "txt", "rst",
  "json", "yml", "yaml", "toml", "ini", "env",
  "html", "css", "scss", "less",
  "sql", "sh", "bash",
  "xml", "vue", "svelte",
]);

/** Path segments that are never worth ingesting even if their contents match a text extension. */
const SKIP_DIR_SEGMENTS = new Set([
  "node_modules", ".git", "dist", "build", "vendor", ".next", ".venv", "venv",
  "__pycache__", "coverage", ".turbo", "target", ".idea", ".vscode",
]);

const MAX_ENTRY_BYTES = 2 * 1024 * 1024; // 2 MB — a single source file shouldn't exceed this
const MAX_ENTRIES = 500; // guards against a zip bomb of tiny files stalling ingestion

export type ExtractedZipEntry = {
  fileName: string; // the entry's path inside the zip, used as the KB fileName
  content: string;
};

const extensionOf = (name: string) => {
  const idx = name.lastIndexOf(".");
  return idx === -1 ? "" : name.slice(idx + 1).toLowerCase();
};

const isSkippedPath = (entryPath: string) =>
  entryPath.split("/").some((segment) => SKIP_DIR_SEGMENTS.has(segment));

/**
 * Reads every ingestible text/code file out of a .zip. Directories, binaries,
 * and noise directories (node_modules, .git, …) are skipped rather than
 * erroring — a code archive is expected to contain plenty of both.
 */
export const extractZipEntries = (zipFilePath: string): ExtractedZipEntry[] => {
  const zip = new AdmZip(zipFilePath);
  const entries = zip.getEntries();

  const results: ExtractedZipEntry[] = [];
  for (const entry of entries) {
    if (entry.isDirectory) continue;
    if (results.length >= MAX_ENTRIES) break;

    const entryPath = entry.entryName.replace(/\\/g, "/");
    if (isSkippedPath(entryPath)) continue;

    const ext = extensionOf(entryPath);
    if (!CODE_TEXT_EXTENSIONS.has(ext)) continue;

    if (entry.header.size > MAX_ENTRY_BYTES) continue;

    const buffer = entry.getData();
    // A NUL byte essentially never appears in real source/text — its
    // presence means this is a mis-tagged binary asset, so skip it rather
    // than embedding garbage.
    if (buffer.includes(0)) continue;

    results.push({ fileName: entryPath, content: buffer.toString("utf-8") });
  }

  return results;
};
