import { registerBuiltinAdapters } from "../codeIntel/adapters";
import { recordMounts, resetMounts } from "../codeIntel/adapters/frameworks/express";
import { recordClientRoutes, resetClientRoutes } from "../codeIntel/adapters/frameworks/react";
import { adapterRegistry } from "../codeIntel/core/registry";
import { dedupeUids, fileUid, FILE_QUALIFIED_NAME, summaryUid } from "../codeIntel/core/ids";
import type { CodeUnit, FileRecord, FileSource, LanguageAdapter, ParseResult, RawReference } from "../codeIntel/core/types";
import { disposeTree } from "../codeIntel/parse/treesitter";
import { isManifestPath, buildRepoContext } from "../codeIntel/extract/repoContext";
import { SkippedFile, walkRepo } from "../codeIntel/extract/walker";
import { matchApiCall } from "../codeIntel/transform/apiMatch";
import { chunkUnit } from "../codeIntel/transform/chunker";
import { buildSummaryHeaderText, buildUnitHeaderText } from "../codeIntel/transform/contextHeader";
import { LinkedEdge, linkReferences } from "../codeIntel/transform/linker";
import { buildSearchText } from "../codeIntel/transform/searchText";
import {
  ancestorDirs,
  dirDepth,
  fileSummaryPrompt,
  moduleSummaryPrompt,
  repoSummaryPrompt,
  unitSummaryPrompt,
} from "../codeIntel/transform/summarizer";
import { sha256 } from "../codeIntel/util/hash";
import { createLimiter, yieldToEventLoop } from "../codeIntel/util/limit";
import { generateCodeEmbeddings } from "../llmServices/generateCodeEmbeddings";
import { generateSummary } from "../llmServices/generateSummary";
import { CodeGraphService, EmbeddingRow, UnitRow } from "./codeGraph.service";

/**
 * Indexes one repository into a bot's tables. Knows nothing about HTTP, Mongo
 * or the run document — CodeIndexService wraps it with those — which is what
 * lets it be tested against Postgres alone.
 *
 * Order matters:
 *   extract → parse → link (in memory) → per-file load → per-file edges →
 *   remove vanished files → [summaries] → cross-layer API linking.
 *
 * Per file, embeddings are computed in memory *first* and everything for the
 * file is then written in one transaction, so a failure never leaves a file
 * half-indexed. Edges are written in a second pass, once every unit exists.
 */

export type CodeConfig = { embedModel: string; embedDim: number; embedType: "vector" | "halfvec" };

export type IndexStats = {
  files: number;
  skipped: number;
  rejected: number;
  units: number;
  edges: number;
  filesChanged: number;
  filesUnchanged: number;
  filesRemoved: number;
  embedded: number;
  embedCalls: number;
  summarized: number;
  llmCalls: number;
  parseFallbacks: number;
  apiEdgesLinked: number;
  phaseMs: Record<string, number>;
};

export type IndexProgress = { phase: string; done?: number; total?: number; stats: IndexStats };

export type IndexResult = {
  stats: IndexStats;
  fileErrors: { path: string; reason: string }[];
  skipped: SkippedFile[];
  repoId: number;
};

export class NoFilesError extends Error {
  constructor() {
    super("No indexable source files were found in this repository.");
    this.name = "NoFilesError";
  }
}

export type IndexParams = {
  botId: string;
  codeConfig: CodeConfig;
  /** Bot's chat model, used for summaries only. */
  baseModel?: string;
  repoName: string;
  sourceType: "zip" | "path" | "git";
  sourceRef?: string | null;
  source: FileSource;
  summarize: boolean;
  limits: { maxFiles: number; maxFileBytes: number };
  excludeGlobs: string[];
  concurrency: number;
  maxChunkTokens: number;
  numCtx: number;
  onProgress?: (progress: IndexProgress) => void;
};

const EMBED_BATCH = 16;
const FILE_UNIT_CODE_LINES = 60;
const DOC_UNIT_CODE_LINES = 400;
const YIELD_EVERY = 25;

const newStats = (): IndexStats => ({
  files: 0, skipped: 0, rejected: 0, units: 0, edges: 0, filesChanged: 0, filesUnchanged: 0, filesRemoved: 0,
  embedded: 0, embedCalls: 0, summarized: 0, llmCalls: 0, parseFallbacks: 0, apiEdgesLinked: 0, phaseMs: {},
});

const reasonOf = (error: unknown): string => (error instanceof Error ? error.message : String(error)).slice(0, 300);

const baseName = (path: string): string => path.split("/").pop() ?? path;

/** A `file` unit makes every file findable even when no adapter understands its language (README, package.json, SQL…). */
const fileUnitFor = (record: FileRecord, repoName: string): CodeUnit => {
  const cap = record.category === "source" || record.category === "test" || record.category === "generated" ? FILE_UNIT_CODE_LINES : DOC_UNIT_CODE_LINES;
  const lines = record.content.split("\n");
  return {
    uid: fileUid({ repoName, path: record.path }),
    path: record.path,
    kind: "file",
    name: baseName(record.path),
    qualifiedName: FILE_QUALIFIED_NAME,
    code: lines.slice(0, cap).join("\n"),
    startLine: 1,
    endLine: Math.max(1, Math.min(lines.length, cap)),
    exported: false,
    metadata: { category: record.category, language: record.language },
  };
};

type Parsed = { units: CodeUnit[]; references: RawReference[] };

export const indexRepository = async (params: IndexParams): Promise<IndexResult> => {
  const { botId, codeConfig, repoName, source, summarize, concurrency, maxChunkTokens, numCtx } = params;
  const stats = newStats();
  const fileErrors: { path: string; reason: string }[] = [];
  const skipped: SkippedFile[] = [];

  const progress = (phase: string, done?: number, total?: number) => params.onProgress?.({ phase, done, total, stats: { ...stats } });
  const phaseStart: Record<string, number> = {};
  const startPhase = (phase: string) => {
    phaseStart[phase] = Date.now();
    progress(phase);
  };
  const endPhase = (phase: string) => {
    stats.phaseMs[phase] = Date.now() - phaseStart[phase];
  };

  // Before extract, not just before parse: the walker asks the registry which
  // language each file is, and a file tagged `null` is never handed to a parser.
  registerBuiltinAdapters();

  // ---- extract ------------------------------------------------------------
  startPhase("extract");
  const records: FileRecord[] = [];
  for await (const record of walkRepo({
    source,
    limits: params.limits,
    excludeGlobs: params.excludeGlobs,
    onSkip: (s) => skipped.push(s),
  })) {
    records.push(record);
  }
  if (records.length === 0) throw new NoFilesError();
  stats.files = records.length;
  stats.skipped = skipped.length;
  stats.rejected = source.rejected.length;
  const recordsByPath = new Map(records.map((r) => [r.path, r]));
  const repo = buildRepoContext({ name: repoName, files: records.filter((r) => isManifestPath(r.path)) });
  endPhase("extract");

  const repoId = await CodeGraphService.upsertRepo({
    botId, name: repoName, sourceType: params.sourceType, sourceRef: params.sourceRef,
  });

  // ---- parse --------------------------------------------------------------
  //
  // Two passes over the syntax trees. An Express route's full path depends on
  // where its router is mounted, which is written in a different file
  // (`app.use("/api/users", usersRouter)`), so every mount has to be known
  // before any route unit is built. Pass 1 collects mounts, pass 2 enriches.
  startPhase("parse");
  resetMounts();
  resetClientRoutes();
  const parsedByPath = new Map<string, Parsed>();
  const trees = new Map<string, { tree: unknown; base: ParseResult; adapter: LanguageAdapter }>();
  let parsedCount = 0;

  try {
    for (const record of records) {
      const adapter = record.language && record.category !== "generated" ? adapterRegistry.language(record.language) : null;
      if (!adapter) continue;
      try {
        const base = await adapter.parse({ file: record, repo });
        if (base.tree) {
          trees.set(record.path, { tree: base.tree, base, adapter });
          // Facts that live in a different file from what they describe: an
          // Express mount prefix, and which component a client route shows.
          const resolveImport = (specifier: string) =>
            adapter.resolveImport({ fromPath: record.path, specifier, repo, hasFile: (p) => recordsByPath.has(p) });
          recordMounts({ file: record, tree: base.tree, resolveImport });
          recordClientRoutes({ file: record, tree: base.tree, resolveImport });
        } else {
          parsedByPath.set(record.path, normalise(record, base));
        }
      } catch (error) {
        // A file the parser chokes on must never stop the run: it stays searchable as a single file unit.
        console.warn(`[code-index] could not parse ${record.path}: ${reasonOf(error)}`);
        stats.parseFallbacks++;
        parsedByPath.set(record.path, fallbackParse(record));
      }
      if (++parsedCount % YIELD_EVERY === 0) {
        progress("parse", parsedCount, records.length);
        await yieldToEventLoop();
      }
    }

    let enriched = 0;
    for (const record of records) {
      const held = trees.get(record.path);
      if (!held) continue;
      try {
        let result = held.base;
        for (const framework of adapterRegistry.frameworksFor({ language: held.adapter.language, repo })) {
          result = await framework.enrich({ file: record, base: result, tree: held.tree, repo });
        }
        parsedByPath.set(record.path, normalise(record, result));
      } catch (error) {
        console.warn(`[code-index] could not enrich ${record.path}: ${reasonOf(error)}`);
        stats.parseFallbacks++;
        parsedByPath.set(record.path, normalise(record, held.base));
      }
      if (++enriched % YIELD_EVERY === 0) await yieldToEventLoop();
    }
  } finally {
    // Trees live on the WASM heap, which garbage collection does not reclaim.
    for (const held of trees.values()) disposeTree(held.tree);
    trees.clear();
  }

  for (const record of records) {
    if (!parsedByPath.has(record.path)) parsedByPath.set(record.path, fallbackParse(record));
  }
  endPhase("parse");

  function fallbackParse(record: FileRecord): Parsed {
    return { units: [fileUnitFor(record, repoName)], references: [] };
  }

  /** Add the file unit, make ids unique, and drop references whose source vanished. */
  function normalise(record: FileRecord, result: ParseResult): Parsed {
    const units = dedupeUids(result.units.map((u) => ({ ...u, path: record.path })));
    if (!units.some((u) => u.kind === "file")) units.unshift(fileUnitFor(record, repoName));
    const known = new Set(units.map((u) => u.uid));
    return {
      units: units.map((u) => (u.parentUid && !known.has(u.parentUid) ? { ...u, parentUid: undefined } : u)),
      references: result.references.filter((r) => known.has(r.fromUid)),
    };
  }

  // ---- link (in memory) ---------------------------------------------------
  startPhase("link");
  const allUnits = [...parsedByPath.values()].flatMap((p) => p.units);
  const allReferences = [...parsedByPath.values()].flatMap((p) => p.references);
  const unitByUid = new Map(allUnits.map((u) => [u.uid, u]));
  const linked = linkReferences({
    repo,
    units: allUnits,
    references: allReferences,
    adapterForPath: (path) => adapterRegistry.languageForPath(path),
    hasFile: (path) => recordsByPath.has(path),
  });
  const edgesByPath = new Map<string, LinkedEdge[]>();
  for (const edge of linked) {
    const path = unitByUid.get(edge.fromUid)?.path;
    if (path) (edgesByPath.get(path) ?? edgesByPath.set(path, []).get(path)!).push(edge);
  }
  const importsByPath = new Map<string, string[]>();
  for (const ref of allReferences) {
    if (ref.target.kind !== "import") continue;
    const path = unitByUid.get(ref.fromUid)?.path;
    if (path) (importsByPath.get(path) ?? importsByPath.set(path, []).get(path)!).push(ref.target.specifier);
  }
  endPhase("link");

  // ---- load: embed in memory, then one transaction per file ---------------
  startPhase("load");
  const limit = createLimiter(concurrency);
  const fileIds = new Map<string, number>();
  const changedPaths = new Set<string>();
  const unitSummariesByPath = new Map<string, { name: string; summary: string }[]>();

  const callLlm = async (prompt: string): Promise<string> => {
    stats.llmCalls++;
    return generateSummary({ prompt, model: params.baseModel ?? "", numCtx });
  };

  const embedTexts = async (texts: string[]): Promise<number[][]> => {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += EMBED_BATCH) {
      const vectors = await generateCodeEmbeddings({ texts: texts.slice(i, i + EMBED_BATCH), model: codeConfig.embedModel, role: "document" });
      stats.embedCalls++;
      for (const v of vectors) {
        if (v.length !== codeConfig.embedDim) {
          throw new Error(`Embedding has ${v.length} dimensions but this bot's tables expect ${codeConfig.embedDim}.`);
        }
      }
      out.push(...vectors);
    }
    return out;
  };

  const loadFile = async (record: FileRecord): Promise<void> => {
    const parsed = parsedByPath.get(record.path)!;
    const summarizable = summarize && record.category !== "test" && record.category !== "generated";
    const prior = await CodeGraphService.getUnitSummaries({ botId, uids: parsed.units.map((u) => u.uid) });

    const unitRows: UnitRow[] = [];
    const summaries = new Map<string, string>();
    for (const unit of parsed.units) {
      const contentHash = sha256(unit.code);
      let summary: string | null = null;
      const previous = prior.get(unit.uid);
      if (previous && previous.contentHash === contentHash) summary = previous.summary;
      else if (summarizable && unit.kind !== "file") {
        try {
          summary = await callLlm(unitSummaryPrompt({
            path: unit.path, kind: unit.kind, qualifiedName: unit.qualifiedName,
            signature: unit.signature, docstring: unit.docstring, code: unit.code,
          }));
          stats.summarized++;
        } catch (error) {
          console.warn(`[code-index] summary failed for ${unit.uid}: ${reasonOf(error)}`);
        }
      }
      if (summary) summaries.set(unit.uid, summary);
      unitRows.push({
        uid: unit.uid, parentUid: unit.parentUid ?? null, kind: unit.kind, name: unit.name, qualifiedName: unit.qualifiedName,
        signature: unit.signature ?? null, code: unit.code, startLine: unit.startLine, endLine: unit.endLine,
        docstring: unit.docstring ?? null, summary, exported: unit.exported, metadata: unit.metadata, contentHash,
        searchText: buildSearchText({ name: unit.name, qualifiedName: unit.qualifiedName, docstring: unit.docstring, summary, metadata: unit.metadata }),
      });
    }

    const chunks = parsed.units.flatMap((unit) => chunkUnit({ unit, maxTokens: maxChunkTokens }));
    const texts = chunks.map((chunk) =>
      buildUnitHeaderText({
        repoName, unit: unitByUid.get(chunk.unitUid)!, chunk,
        summary: summaries.get(chunk.unitUid), importSpecifiers: importsByPath.get(record.path),
      }),
    );
    const hashes = texts.map((text) => sha256(codeConfig.embedModel, text));
    const existing = await CodeGraphService.getEmbeddingHashes({ botId, uids: chunks.map((c) => c.uid) });
    const needed = chunks.map((_, i) => i).filter((i) => existing.get(chunks[i].uid) !== hashes[i]);
    const vectors = await embedTexts(needed.map((i) => texts[i]));
    const embeddings: EmbeddingRow[] = needed.map((i, n) => ({
      uid: chunks[i].uid, unitType: "code", model: codeConfig.embedModel, contentHash: hashes[i], embedding: vectors[n],
    }));

    const { fileId, previousContentHash } = await CodeGraphService.writeFile({
      botId, embedType: codeConfig.embedType, repoId,
      file: { path: record.path, language: record.language, category: record.category, content: record.content, contentHash: record.contentHash, lineCount: record.lineCount },
      units: unitRows, embeddings, keepEmbeddingUids: chunks.map((c) => c.uid),
    });

    fileIds.set(record.path, fileId);
    stats.units += unitRows.length;
    stats.embedded += embeddings.length;
    if (previousContentHash === record.contentHash) stats.filesUnchanged++;
    else {
      stats.filesChanged++;
      changedPaths.add(record.path);
    }
    unitSummariesByPath.set(
      record.path,
      parsed.units.filter((u) => summaries.has(u.uid)).map((u) => ({ name: u.qualifiedName, summary: summaries.get(u.uid)! })),
    );
  };

  let loaded = 0;
  await Promise.all(
    records.map((record) =>
      limit(async () => {
        try {
          await loadFile(record);
        } catch (error) {
          console.error(`[code-index] failed to index ${record.path}:`, reasonOf(error));
          fileErrors.push({ path: record.path, reason: reasonOf(error) });
        }
        progress("load", ++loaded, records.length);
      }),
    ),
  );
  endPhase("load");

  // ---- edges: second pass, every unit now exists --------------------------
  startPhase("edges");
  for (const record of records) {
    const fileId = fileIds.get(record.path);
    if (fileId === undefined) continue; // failed to load; keep its previous edges
    const edges = edgesByPath.get(record.path) ?? [];
    try {
      await CodeGraphService.replaceFileEdges({ botId, repoId, fileId, edges });
      stats.edges += edges.length;
    } catch (error) {
      console.error(`[code-index] failed to write edges for ${record.path}:`, reasonOf(error));
      fileErrors.push({ path: record.path, reason: `edges: ${reasonOf(error)}` });
    }
  }
  endPhase("edges");

  // ---- files that are gone from this snapshot -----------------------------
  const removed = await CodeGraphService.deleteFilesNotIn({ botId, repoId, repoName, keepPaths: records.map((r) => r.path) });
  stats.filesRemoved = removed.length;
  for (const path of removed) changedPaths.add(path);

  // ---- summaries (opt-in) -------------------------------------------------
  if (summarize) {
    startPhase("summaries");
    await summarizeHierarchy();
    endPhase("summaries");
  }

  async function summarizeHierarchy(): Promise<void> {
    const eligible = records.filter((r) => fileIds.has(r.path) && r.category !== "test" && r.category !== "generated");
    const fileState = await CodeGraphService.getFileSummaryState({ botId, repoId });
    const moduleState = await CodeGraphService.getModuleSummaries({ botId, repoId });
    const summaryRows: EmbeddingRow[] = [];
    const embedSummary = async (level: "file" | "module" | "repo", path: string | undefined, summary: string) => {
      const text = buildSummaryHeaderText({ repoName, level, path, summary });
      const [embedding] = await embedTexts([text]);
      const uid = summaryUid({ kind: level, repoName, path });
      summaryRows.push({
        uid, unitType: level === "file" ? "file_summary" : level === "module" ? "module_summary" : "repo_summary",
        model: codeConfig.embedModel, contentHash: sha256(codeConfig.embedModel, text), embedding,
      });
    };

    // files
    const fileSummaries = new Map<string, string>();
    for (const record of eligible) {
      const state = fileState.get(record.path);
      if (state?.summary) {
        fileSummaries.set(record.path, state.summary);
        continue;
      }
      try {
        const summary = await callLlm(fileSummaryPrompt({
          path: record.path,
          unitSummaries: unitSummariesByPath.get(record.path) ?? [],
          headOfFile: record.content.slice(0, 4000),
        }));
        stats.summarized++;
        await CodeGraphService.setFileSummary({ botId, repoId, path: record.path, summary });
        fileSummaries.set(record.path, summary);
        await embedSummary("file", record.path, summary);
      } catch (error) {
        console.warn(`[code-index] file summary failed for ${record.path}: ${reasonOf(error)}`);
      }
    }

    // folders, deepest first, each from its files and immediate subfolders
    const dirs = new Set<string>();
    for (const path of fileSummaries.keys()) ancestorDirs(path).forEach((d) => dirs.add(d));
    const moduleSummaries = new Map<string, string>();
    const anyChangedUnder = (dir: string) => [...changedPaths].some((p) => dir === "" || p.startsWith(`${dir}/`));
    for (const dir of [...dirs].sort((a, b) => dirDepth(b) - dirDepth(a))) {
      const stored = moduleState.get(dir);
      if (stored && !anyChangedUnder(dir)) {
        moduleSummaries.set(dir, stored);
        continue;
      }
      const parentOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
      const children: { name: string; summary: string }[] = [
        ...[...fileSummaries].filter(([p]) => parentOf(p) === dir).map(([p, summary]) => ({ name: baseName(p), summary })),
        ...[...moduleSummaries].filter(([d]) => d !== "" && parentOf(d) === dir).map(([d, summary]) => ({ name: `${baseName(d)}/`, summary })),
      ];
      if (children.length === 0) continue;
      try {
        const summary = await callLlm(moduleSummaryPrompt({ path: dir, children }));
        stats.summarized++;
        await CodeGraphService.setModuleSummary({ botId, repoId, path: dir, summary });
        moduleSummaries.set(dir, summary);
        await embedSummary("module", dir, summary);
      } catch (error) {
        console.warn(`[code-index] folder summary failed for ${dir || "/"}: ${reasonOf(error)}`);
      }
    }
    await CodeGraphService.deleteModulesNotIn({ botId, repoId, repoName, keepPaths: [...dirs] });

    // repository
    const current = (await CodeGraphService.listRepos({ botId })).find((r) => r.id === repoId);
    if (!current?.summary || changedPaths.size > 0) {
      const topLevel = [
        ...[...fileSummaries].filter(([p]) => !p.includes("/")).map(([p, summary]) => ({ name: p, summary })),
        ...[...moduleSummaries].filter(([d]) => d !== "" && !d.includes("/")).map(([d, summary]) => ({ name: `${d}/`, summary })),
      ];
      if (topLevel.length > 0) {
        try {
          const description = (repo.manifests["package.json"] as { description?: unknown } | undefined)?.description;
          const readme = records.find((r) => /^readme(\.md)?$/i.test(r.path));
          const summary = await callLlm(repoSummaryPrompt({
            name: repoName, description: typeof description === "string" ? description : undefined,
            readmeHead: readme?.content, modules: topLevel,
          }));
          stats.summarized++;
          await CodeGraphService.setRepoSummary({ botId, repoId, summary });
          await embedSummary("repo", undefined, summary);
        } catch (error) {
          console.warn(`[code-index] repository summary failed: ${reasonOf(error)}`);
        }
      }
    }
    await CodeGraphService.upsertEmbeddings({ botId, embedType: codeConfig.embedType, repoId, embeddings: summaryRows });
  }

  // ---- cross-layer: frontend calls → backend routes (bot-wide) ------------
  startPhase("api-links");
  stats.apiEdgesLinked = await linkApiCalls({ botId });
  endPhase("api-links");

  await CodeGraphService.touchRepo({ botId, repoId });
  progress("done");
  return { stats, fileErrors, skipped, repoId };
};

/**
 * Match unresolved `calls_api` edges to route units across every repository
 * in the bot. Run after each index so a frontend indexed before its backend
 * gets linked once the backend arrives.
 */
export const linkApiCalls = async ({ botId }: { botId: string }): Promise<number> => {
  const [routes, calls] = await Promise.all([
    CodeGraphService.listRouteUnits({ botId }),
    CodeGraphService.listUnresolvedApiEdges({ botId }),
  ]);
  if (routes.length === 0 || calls.length === 0) return 0;
  const matches: { edgeId: number; toUid: string }[] = [];
  for (const call of calls) {
    const toUid = matchApiCall({ method: call.method, path: call.path, routes });
    if (toUid) matches.push({ edgeId: call.id, toUid });
  }
  return CodeGraphService.resolveApiEdges({ botId, matches });
};
