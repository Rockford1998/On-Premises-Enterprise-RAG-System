import { estimateTokens } from "../transform/chunker";
import type { QueryType } from "./queryClassifier";

/**
 * Assemble the code that goes to the model, within a token budget.
 *
 * Every excerpt is prefixed with `// path:start-end` because the answer is
 * required to cite that exact form — the model can only cite what it can see,
 * so the citation is part of the context rather than something inferred later.
 */

export type ContextUnit = {
  uid: string;
  repo: string;
  path: string;
  kind: string;
  name: string;
  qualifiedName: string;
  signature: string | null;
  summary: string | null;
  code: string;
  startLine: number;
  endLine: number;
  metadata: Record<string, unknown>;
};

export type Citation = { uid: string; repo: string; path: string; startLine: number; endLine: number; name: string; kind: string };

export type BuiltContext = { text: string; citations: Citation[]; includedUids: string[]; droppedForBudget: number };

const MIN_UNIT_TOKENS = 40;

/** A one-line description used in the chain summary and when a unit is truncated. */
const describe = (unit: ContextUnit): string => {
  const route = typeof unit.metadata.routePath === "string"
    ? `${String(unit.metadata.httpMethod ?? "")} ${unit.metadata.routePath}`.trim()
    : null;
  return route ?? unit.qualifiedName;
};

/** Trim an excerpt to fit, keeping the start (signature and first statements). */
const clipCode = (code: string, tokenBudget: number): { text: string; clipped: boolean } => {
  const maxChars = Math.max(200, Math.floor(tokenBudget * 3.5));
  if (code.length <= maxChars) return { text: code, clipped: false };
  const cut = code.slice(0, maxChars);
  const lastNewline = cut.lastIndexOf("\n");
  return { text: `${cut.slice(0, lastNewline > 200 ? lastNewline : cut.length)}\n// … truncated`, clipped: true };
};

export const buildContext = ({
  units,
  repoSummaries = [],
  fileSummaries = [],
  chain = [],
  queryType,
  tokenBudget,
}: {
  /** Ranked best-first; the order decides what survives the budget. */
  units: ContextUnit[];
  repoSummaries?: { name: string; summary: string }[];
  fileSummaries?: { path: string; summary: string }[];
  /** For flow questions: the ordered path through the code, as unit ids. */
  chain?: ContextUnit[];
  queryType: QueryType;
  tokenBudget: number;
}): BuiltContext => {
  const sections: string[] = [];
  let used = 0;
  const spend = (text: string): boolean => {
    const cost = estimateTokens(text);
    if (used + cost > tokenBudget) return false;
    used += cost;
    sections.push(text);
    return true;
  };

  if (repoSummaries.length > 0) {
    spend(`## Repositories\n${repoSummaries.map((r) => `- ${r.name}: ${r.summary}`).join("\n")}`);
  }
  if (fileSummaries.length > 0) {
    spend(`## Relevant files\n${fileSummaries.map((f) => `- ${f.path}: ${f.summary}`).join("\n")}`);
  }
  if (chain.length > 1 && (queryType === "flow" || queryType === "impact")) {
    spend(`## Path through the code\n${chain.map(describe).join(" → ")}`);
  }

  // Group by file and order by line, so the model reads a file top to bottom.
  const chosen: ContextUnit[] = [];
  const citations: Citation[] = [];
  let dropped = 0;
  const remaining = () => tokenBudget - used;

  for (const unit of units) {
    const left = remaining();
    if (left < MIN_UNIT_TOKENS) {
      dropped++;
      continue;
    }
    // Give no single excerpt more than half of what is left, so one huge unit
    // cannot crowd out everything ranked below it.
    const { text: code } = clipCode(unit.code, Math.max(MIN_UNIT_TOKENS, Math.floor(left / 2)));
    const header = `// ${unit.path}:${unit.startLine}-${unit.endLine}${unit.summary ? `  — ${unit.summary}` : ""}`;
    const block = `${header}\n${code}`;
    const cost = estimateTokens(block);
    if (cost > left) {
      dropped++;
      continue;
    }
    used += cost;
    chosen.push(unit);
    citations.push({
      uid: unit.uid, repo: unit.repo, path: unit.path,
      startLine: unit.startLine, endLine: unit.endLine, name: unit.name, kind: unit.kind,
    });
  }

  const byFile = new Map<string, ContextUnit[]>();
  for (const unit of chosen) {
    const key = `${unit.repo}/${unit.path}`;
    (byFile.get(key) ?? byFile.set(key, []).get(key)!).push(unit);
  }
  const codeSections = [...byFile.entries()].map(([key, fileUnits]) => {
    const ordered = [...fileUnits].sort((a, b) => a.startLine - b.startLine);
    const blocks = ordered.map((unit) => {
      const { text } = clipCode(unit.code, Math.floor(tokenBudget / 2));
      return `// ${unit.path}:${unit.startLine}-${unit.endLine}${unit.summary ? `  — ${unit.summary}` : ""}\n${text}`;
    });
    return `### ${key}\n${blocks.join("\n\n")}`;
  });

  const text = [...sections, codeSections.length > 0 ? `## Code\n${codeSections.join("\n\n")}` : ""].filter(Boolean).join("\n\n");
  return { text, citations, includedUids: chosen.map((u) => u.uid), droppedForBudget: dropped };
};
