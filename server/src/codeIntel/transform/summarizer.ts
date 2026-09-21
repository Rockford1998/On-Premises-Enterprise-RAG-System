/**
 * Prompts for the opt-in, bottom-up summaries: unit → file → folder → repo.
 * Pure text building; the model call lives in llmServices/generateSummary.ts.
 * Each level is built from the level below it, so a folder summary never has
 * to read raw code.
 */

const RULES =
  "Reply with plain prose only: no markdown, no bullet lists, no preamble. Do not restate the file path. Do not invent behaviour that is not in the input.";

const clip = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max)}\n… (truncated)` : text);

export const unitSummaryPrompt = ({
  path,
  kind,
  qualifiedName,
  signature,
  docstring,
  code,
}: {
  path: string;
  kind: string;
  qualifiedName: string;
  signature?: string | null;
  docstring?: string | null;
  code: string;
}): string =>
  `Summarise this ${kind} in 1 to 3 sentences: its purpose, what it takes and returns, and any side effects (database writes, network calls, file access).
${RULES}

File: ${path}
Name: ${qualifiedName}
${signature ? `Signature: ${signature}\n` : ""}${docstring ? `Doc comment: ${docstring}\n` : ""}
Code:
${clip(code, 6000)}`;

export const fileSummaryPrompt = ({
  path,
  unitSummaries,
  headOfFile,
}: {
  path: string;
  unitSummaries: { name: string; summary: string }[];
  /** Used when the file has no summarised units (config, docs, schema). */
  headOfFile?: string;
}): string =>
  `Summarise what this source file is responsible for in 2 to 3 sentences.
${RULES}

File: ${path}
${
  unitSummaries.length > 0
    ? `What it contains:\n${unitSummaries.map((u) => `- ${u.name}: ${u.summary}`).join("\n")}`
    : `Start of the file:\n${clip(headOfFile ?? "", 4000)}`
}`;

export const moduleSummaryPrompt = ({
  path,
  children,
}: {
  path: string;
  children: { name: string; summary: string }[];
}): string =>
  `Summarise what this folder is responsible for in 2 to 3 sentences, from the summaries of what is inside it.
${RULES}

Folder: ${path || "(repository root)"}
${children.map((c) => `- ${c.name}: ${c.summary}`).join("\n")}`;

export const repoSummaryPrompt = ({
  name,
  description,
  readmeHead,
  modules,
}: {
  name: string;
  description?: string;
  readmeHead?: string;
  modules: { name: string; summary: string }[];
}): string =>
  `Summarise what this repository is and how it is organised in 3 to 5 sentences.
${RULES}

Repository: ${name}
${description ? `Package description: ${description}\n` : ""}${readmeHead ? `README (start):\n${clip(readmeHead, 2000)}\n` : ""}
Top-level folders and files:
${modules.map((m) => `- ${m.name}: ${m.summary}`).join("\n")}`;

/** "src/services/user.ts" → ["src/services", "src", ""] — the folders above a file, nearest first. */
export const ancestorDirs = (filePath: string): string[] => {
  const parts = filePath.split("/").slice(0, -1);
  const dirs: string[] = [];
  for (let i = parts.length; i >= 1; i--) dirs.push(parts.slice(0, i).join("/"));
  dirs.push("");
  return dirs;
};

/** Depth of a folder path ('' = 0), used to summarise deepest folders first. */
export const dirDepth = (dir: string): number => (dir === "" ? 0 : dir.split("/").length);
