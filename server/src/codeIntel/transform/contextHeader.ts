import type { CodeUnit } from "../core/types";
import type { Chunk } from "./chunker";

/**
 * The text that is actually embedded: a short header that says where the code
 * lives and what it is, followed by the code. A bare function body embeds far
 * worse than the same body with "Repo / File / Symbol / Route" around it,
 * because the header carries the words a question is likely to use.
 */

const MAX_IMPORTS = 8;

export const buildUnitHeaderText = ({
  repoName,
  unit,
  chunk,
  summary,
  importSpecifiers = [],
}: {
  repoName: string;
  unit: CodeUnit;
  chunk: Chunk;
  summary?: string | null;
  /** Module specifiers the unit's file imports. */
  importSpecifiers?: string[];
}): string => {
  const lines: string[] = [`Repo: ${repoName} | File: ${unit.path} | Kind: ${unit.kind}`];

  const dot = unit.qualifiedName.lastIndexOf(".");
  const owner = dot > 0 ? unit.qualifiedName.slice(0, dot) : "";
  lines.push(
    `Symbol: ${unit.name}${owner ? ` (in ${owner})` : ""} | Exports: ${unit.exported ? "yes" : "no"}` +
      (chunk.part ? ` | Part ${chunk.part.index}/${chunk.part.total}` : ""),
  );

  const method = unit.metadata.httpMethod;
  const routePath = unit.metadata.routePath;
  if (typeof routePath === "string") {
    lines.push(`Route: ${typeof method === "string" ? `${method} ` : ""}${routePath}`);
  }
  if (typeof unit.metadata.clientRoute === "string") lines.push(`Client route: ${unit.metadata.clientRoute}`);
  if (summary) lines.push(`Summary: ${summary}`);

  const imports = [...new Set(importSpecifiers)].slice(0, MAX_IMPORTS);
  if (imports.length > 0) lines.push(`Imports used: ${imports.join(", ")}`);

  return `${lines.join("\n")}\n---\n${chunk.code}`;
};

/** Header for file / module / repo summaries, which are embedded so "what does the billing module do" can be answered. */
export const buildSummaryHeaderText = ({
  repoName,
  level,
  path,
  summary,
}: {
  repoName: string;
  level: "file" | "module" | "repo";
  path?: string;
  summary: string;
}): string => {
  const where = level === "repo" ? `Repo: ${repoName}` : `Repo: ${repoName} | ${level === "file" ? "File" : "Folder"}: ${path || "/"}`;
  return `${where} | ${level} summary\n---\n${summary}`;
};
