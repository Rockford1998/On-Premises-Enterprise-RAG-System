import { toSql } from "pgvector/pg";
import { query, withTransaction } from "../db/pgsql";
import { assertSafeIdentifier } from "./vectors.service";

/**
 * Every SQL statement for Code_Interpreter bots lives here.
 *
 * Isolation is per bot, per table set — the same boundary the KB uses with
 * `vector_table_<botId>`. There is deliberately no `bot_id` column: a query can
 * only ever see the tables whose names `codeTables(botId)` built.
 *
 * Table names cannot be parameterised, so they are interpolated. They come
 * only from `codeTables`, which validates the (server-generated) botId, and
 * every name passes `assertSafeIdentifier`. The embedding type and dimension
 * are interpolated too, so they are checked here as well — never trust the
 * stored `codeConfig` blindly.
 */

/** Server-generated ids look like `bot_<base36>_<RANDOM>` (bot.controller.ts). */
const BOT_ID_PATTERN = /^bot_[A-Za-z0-9_]+$/;

/** Postgres silently truncates identifiers past this, which could make two bots share a table. */
const MAX_IDENTIFIER_LENGTH = 63;

/** pgvector's HNSW limits: `vector` up to 2000 dimensions, `halfvec` up to 4000. */
export const EMBED_TYPE_MAX_DIM = { vector: 2000, halfvec: 4000 } as const;
export type EmbedType = keyof typeof EMBED_TYPE_MAX_DIM;

export type CodeTables = {
  repos: string;
  files: string;
  modules: string;
  units: string;
  edges: string;
  embeddings: string;
};

const checkedIdentifier = (name: string): string => {
  if (name.length > MAX_IDENTIFIER_LENGTH) {
    throw new Error(`Identifier too long for Postgres (${name.length} > ${MAX_IDENTIFIER_LENGTH}): ${name}`);
  }
  return assertSafeIdentifier(name);
};

/** Names of a bot's tables. Lower-cased so unquoted DDL and queries always agree. */
export const codeTables = (botId: string): CodeTables => {
  if (!BOT_ID_PATTERN.test(botId)) {
    throw new Error(`Invalid botId for code tables: ${JSON.stringify(botId)}`);
  }
  const prefix = `code_${botId.toLowerCase()}`;
  return {
    repos: checkedIdentifier(`${prefix}_repos`),
    files: checkedIdentifier(`${prefix}_files`),
    modules: checkedIdentifier(`${prefix}_modules`),
    units: checkedIdentifier(`${prefix}_units`),
    edges: checkedIdentifier(`${prefix}_edges`),
    embeddings: checkedIdentifier(`${prefix}_embeddings`),
  };
};

/** `vector` while HNSW allows it, `halfvec` above that; throws when the model is too large for either. */
export const chooseEmbedType = (dim: number): EmbedType => {
  if (!Number.isInteger(dim) || dim <= 0) {
    throw new Error(`Invalid embedding dimension: ${dim}`);
  }
  if (dim <= EMBED_TYPE_MAX_DIM.vector) return "vector";
  if (dim <= EMBED_TYPE_MAX_DIM.halfvec) return "halfvec";
  throw new Error(
    `Embedding dimension ${dim} exceeds pgvector's HNSW limit of ${EMBED_TYPE_MAX_DIM.halfvec}.`,
  );
};

/** The type is interpolated into SQL (`x::vector`), so it must be exactly one of the two known values. */
const assertEmbedType = (embedType: string): EmbedType => {
  if (embedType !== "vector" && embedType !== "halfvec") {
    throw new Error(`Invalid embedding type: ${JSON.stringify(embedType)}`);
  }
  return embedType;
};

const assertEmbedConfig = ({ embedDim, embedType: rawType }: { embedDim: number; embedType: string }): EmbedType => {
  const embedType = assertEmbedType(rawType);
  if (!Number.isInteger(embedDim) || embedDim <= 0 || embedDim > EMBED_TYPE_MAX_DIM[embedType]) {
    throw new Error(`Invalid ${embedType} dimension: ${embedDim}`);
  }
  return embedType;
};

/**
 * The DDL for one bot, as separate statements (executed in one transaction).
 * Pure so it can be unit-tested without a database. Idempotent.
 */
export const buildCreateTablesSql = ({
  botId,
  embedDim,
  embedType,
}: {
  botId: string;
  embedDim: number;
  embedType: string;
}): string[] => {
  const type = assertEmbedConfig({ embedDim, embedType });
  const t = codeTables(botId);
  const idx = (table: string, suffix: string) => checkedIdentifier(`idx_${table}_${suffix}`);

  return [
    `CREATE TABLE IF NOT EXISTS ${t.repos} (
      id           BIGSERIAL PRIMARY KEY,
      name         TEXT NOT NULL UNIQUE,
      source_type  TEXT NOT NULL,
      source_ref   TEXT,
      last_commit  TEXT,
      summary      TEXT,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS ${t.files} (
      id            BIGSERIAL PRIMARY KEY,
      repo_id       BIGINT NOT NULL REFERENCES ${t.repos}(id) ON DELETE CASCADE,
      path          TEXT NOT NULL,
      language      TEXT,
      category      TEXT NOT NULL,
      content       TEXT NOT NULL,
      content_hash  TEXT NOT NULL,
      line_count    INT NOT NULL,
      summary       TEXT,
      indexed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (repo_id, path)
    )`,
    `CREATE TABLE IF NOT EXISTS ${t.modules} (
      id       BIGSERIAL PRIMARY KEY,
      repo_id  BIGINT NOT NULL REFERENCES ${t.repos}(id) ON DELETE CASCADE,
      path     TEXT NOT NULL,
      summary  TEXT,
      UNIQUE (repo_id, path)
    )`,
    `CREATE TABLE IF NOT EXISTS ${t.units} (
      id              BIGSERIAL PRIMARY KEY,
      repo_id         BIGINT NOT NULL REFERENCES ${t.repos}(id) ON DELETE CASCADE,
      file_id         BIGINT NOT NULL REFERENCES ${t.files}(id) ON DELETE CASCADE,
      uid             TEXT NOT NULL UNIQUE,
      parent_id       BIGINT REFERENCES ${t.units}(id) ON DELETE CASCADE,
      kind            TEXT NOT NULL,
      name            TEXT NOT NULL,
      qualified_name  TEXT NOT NULL,
      signature       TEXT,
      code            TEXT NOT NULL,
      start_line      INT NOT NULL,
      end_line        INT NOT NULL,
      docstring       TEXT,
      summary         TEXT,
      exported        BOOLEAN NOT NULL DEFAULT false,
      metadata        JSONB NOT NULL DEFAULT '{}',
      content_hash    TEXT NOT NULL,
      search_text     TEXT NOT NULL,
      search_tsv      TSVECTOR GENERATED ALWAYS AS (to_tsvector('simple', search_text)) STORED
    )`,
    `CREATE TABLE IF NOT EXISTS ${t.edges} (
      id           BIGSERIAL PRIMARY KEY,
      repo_id      BIGINT NOT NULL REFERENCES ${t.repos}(id) ON DELETE CASCADE,
      from_id      BIGINT NOT NULL REFERENCES ${t.units}(id) ON DELETE CASCADE,
      to_id        BIGINT REFERENCES ${t.units}(id) ON DELETE CASCADE,
      to_external  TEXT,
      type         TEXT NOT NULL,
      metadata     JSONB NOT NULL DEFAULT '{}',
      CHECK (to_id IS NOT NULL OR to_external IS NOT NULL)
    )`,
    // Keyed by uid, not FK'd to units: summary rows (file/module/repo) have no unit.
    `CREATE TABLE IF NOT EXISTS ${t.embeddings} (
      uid           TEXT PRIMARY KEY,
      unit_type     TEXT NOT NULL,
      repo_id       BIGINT NOT NULL REFERENCES ${t.repos}(id) ON DELETE CASCADE,
      model         TEXT NOT NULL,
      content_hash  TEXT NOT NULL,
      embedding     ${type}(${embedDim}) NOT NULL
    )`,

    `CREATE INDEX IF NOT EXISTS ${idx(t.units, "kind")} ON ${t.units} (kind)`,
    `CREATE INDEX IF NOT EXISTS ${idx(t.units, "file")} ON ${t.units} (file_id)`,
    `CREATE INDEX IF NOT EXISTS ${idx(t.units, "tsv")} ON ${t.units} USING GIN (search_tsv)`,
    `CREATE INDEX IF NOT EXISTS ${idx(t.units, "name_trgm")} ON ${t.units} USING GIN (name gin_trgm_ops)`,
    `CREATE INDEX IF NOT EXISTS ${idx(t.units, "qname_trgm")} ON ${t.units} USING GIN (qualified_name gin_trgm_ops)`,
    `CREATE INDEX IF NOT EXISTS ${idx(t.units, "meta")} ON ${t.units} USING GIN (metadata jsonb_path_ops)`,
    `CREATE INDEX IF NOT EXISTS ${idx(t.edges, "from_type")} ON ${t.edges} (from_id, type)`,
    `CREATE INDEX IF NOT EXISTS ${idx(t.edges, "to_type")} ON ${t.edges} (to_id, type)`,
    `CREATE INDEX IF NOT EXISTS ${idx(t.edges, "type")} ON ${t.edges} (type)`,
    `CREATE INDEX IF NOT EXISTS ${idx(t.embeddings, "repo_type")} ON ${t.embeddings} (repo_id, unit_type)`,
    // Cosine ops, matching the `<=>` operator retrieval orders by (same tuning as the KB tables).
    `CREATE INDEX IF NOT EXISTS ${idx(t.embeddings, "hnsw")} ON ${t.embeddings}
       USING hnsw (embedding ${type}_cosine_ops) WITH (m = 16, ef_construction = 200)`,
  ];
};

export class CodeGraphService {
  /**
   * pg_trgm powers identifier search. Throws when it cannot be created (e.g.
   * a database role without the privilege); db/init.ts logs and carries on so
   * deployments that never use Code_Interpreter are not blocked, and bot
   * creation surfaces the reason.
   */
  public static async ensureExtensions(): Promise<void> {
    try {
      await query("CREATE EXTENSION IF NOT EXISTS pg_trgm");
    } catch (error) {
      // Same non-atomic IF NOT EXISTS race as the vector extension (db/pgsql.ts):
      // a concurrent creator already made it, which is the outcome we wanted.
      const code = (error as { code?: string }).code;
      if (code !== "23505" && code !== "42710") throw error;
    }
  }

  /** Create a bot's table set in one transaction — a bot never ends up with half of it. */
  public static async createBotTables({
    botId,
    embedDim,
    embedType,
  }: {
    botId: string;
    embedDim: number;
    embedType: string;
  }): Promise<void> {
    const statements = buildCreateTablesSql({ botId, embedDim, embedType });
    await this.ensureExtensions();
    await withTransaction(async (client) => {
      for (const sql of statements) {
        await client.query(sql);
      }
    });
  }

  /** Drop a bot's table set. Safe when the tables never existed. */
  public static async dropBotTables({ botId }: { botId: string }): Promise<void> {
    const t = codeTables(botId);
    await query(
      `DROP TABLE IF EXISTS ${t.embeddings}, ${t.edges}, ${t.units}, ${t.modules}, ${t.files}, ${t.repos} CASCADE`,
    );
  }

  // ---- repositories -------------------------------------------------------

  /** Create the repo row, or update it when a repository with this name is indexed again. */
  public static async upsertRepo({
    botId,
    name,
    sourceType,
    sourceRef,
  }: {
    botId: string;
    name: string;
    sourceType: "zip" | "path" | "git";
    sourceRef?: string | null;
  }): Promise<number> {
    const t = codeTables(botId);
    const { rows } = await query<{ id: string }>(
      `INSERT INTO ${t.repos} (name, source_type, source_ref) VALUES ($1, $2, $3)
       ON CONFLICT (name) DO UPDATE
         SET source_type = EXCLUDED.source_type, source_ref = EXCLUDED.source_ref, updated_at = NOW()
       RETURNING id`,
      [name, sourceType, sourceRef ?? null],
    );
    return Number(rows[0].id);
  }

  public static async listRepos({ botId }: { botId: string }): Promise<RepoSummary[]> {
    const t = codeTables(botId);
    const { rows } = await query<RepoSummary>(
      `SELECT r.id::int AS id, r.name, r.source_type AS "sourceType", r.source_ref AS "sourceRef",
              r.summary, r.created_at AS "createdAt", r.updated_at AS "updatedAt",
              (SELECT count(*)::int FROM ${t.files} f WHERE f.repo_id = r.id) AS files,
              (SELECT count(*)::int FROM ${t.units} u WHERE u.repo_id = r.id) AS units,
              (SELECT count(*)::int FROM ${t.edges} e WHERE e.repo_id = r.id) AS edges
         FROM ${t.repos} r ORDER BY r.name`,
    );
    return rows;
  }

  /** Delete a repo and, by cascade, its files, units, edges and embeddings. */
  public static async deleteRepo({ botId, repoId }: { botId: string; repoId: number }): Promise<boolean> {
    const t = codeTables(botId);
    const result = await query(`DELETE FROM ${t.repos} WHERE id = $1`, [repoId]);
    return (result.rowCount ?? 0) > 0;
  }

  /** Row counts, for the UI and for tests. */
  public static async countRows({ botId }: { botId: string }): Promise<Record<keyof CodeTables, number>> {
    const t = codeTables(botId);
    const { rows } = await query<Record<keyof CodeTables, number>>(
      `SELECT (SELECT count(*)::int FROM ${t.repos}) AS repos, (SELECT count(*)::int FROM ${t.files}) AS files,
              (SELECT count(*)::int FROM ${t.modules}) AS modules, (SELECT count(*)::int FROM ${t.units}) AS units,
              (SELECT count(*)::int FROM ${t.edges}) AS edges, (SELECT count(*)::int FROM ${t.embeddings}) AS embeddings`,
    );
    return rows[0];
  }

  // ---- loading a file -----------------------------------------------------

  /** Stored embedding text hashes, so unchanged chunks are not embedded again. */
  public static async getEmbeddingHashes({ botId, uids }: { botId: string; uids: string[] }): Promise<Map<string, string>> {
    if (uids.length === 0) return new Map();
    const t = codeTables(botId);
    const { rows } = await query<{ uid: string; content_hash: string }>(
      `SELECT uid, content_hash FROM ${t.embeddings} WHERE uid = ANY($1::text[])`,
      [uids],
    );
    return new Map(rows.map((r) => [r.uid, r.content_hash]));
  }

  /** Existing unit summaries with the hash they were written for, so an unchanged unit is not re-summarised. */
  public static async getUnitSummaries({
    botId,
    uids,
  }: {
    botId: string;
    uids: string[];
  }): Promise<Map<string, { contentHash: string; summary: string }>> {
    if (uids.length === 0) return new Map();
    const t = codeTables(botId);
    const { rows } = await query<{ uid: string; content_hash: string; summary: string }>(
      `SELECT uid, content_hash, summary FROM ${t.units} WHERE uid = ANY($1::text[]) AND summary IS NOT NULL`,
      [uids],
    );
    return new Map(rows.map((r) => [r.uid, { contentHash: r.content_hash, summary: r.summary }]));
  }

  /**
   * Write one file in a single transaction: the file row, its units (upserted
   * by uid so ids stay stable and edges from other files keep pointing at
   * them), removal of units that no longer exist, and the embedding rows.
   *
   * `embeddings` are the rows to write (changed chunks only); `keepEmbeddingUids`
   * is every chunk that should exist afterwards — anything else that used to
   * belong to this file's units is deleted.
   */
  public static async writeFile({
    botId,
    embedType,
    repoId,
    file,
    units,
    embeddings,
    keepEmbeddingUids,
  }: {
    botId: string;
    embedType: string;
    repoId: number;
    file: { path: string; language: string | null; category: string; content: string; contentHash: string; lineCount: number };
    units: UnitRow[];
    embeddings: EmbeddingRow[];
    keepEmbeddingUids: string[];
  }): Promise<{ fileId: number; previousContentHash: string | null }> {
    const t = codeTables(botId);
    const type = assertEmbedType(embedType);

    return withTransaction(async (client) => {
      const previous = await client.query<{ content_hash: string }>(
        `SELECT content_hash FROM ${t.files} WHERE repo_id = $1 AND path = $2`,
        [repoId, file.path],
      );
      const fileRow = await client.query<{ id: string }>(
        `INSERT INTO ${t.files} (repo_id, path, language, category, content, content_hash, line_count)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (repo_id, path) DO UPDATE SET
           language = EXCLUDED.language, category = EXCLUDED.category, content = EXCLUDED.content,
           line_count = EXCLUDED.line_count, indexed_at = NOW(),
           summary = CASE WHEN ${t.files}.content_hash = EXCLUDED.content_hash THEN ${t.files}.summary ELSE NULL END,
           content_hash = EXCLUDED.content_hash
         RETURNING id`,
        [repoId, file.path, file.language, file.category, file.content, file.contentHash, file.lineCount],
      );
      const fileId = Number(fileRow.rows[0].id);

      // Embedding rows that belong to this file's current units (before any change), including split parts.
      const existing = await client.query<{ uid: string }>(
        `SELECT e.uid FROM ${t.embeddings} e
           JOIN ${t.units} u ON u.file_id = $1 AND (e.uid = u.uid OR starts_with(e.uid, u.uid || '#part'))`,
        [fileId],
      );

      if (units.length > 0) {
        await client.query(
          `INSERT INTO ${t.units} (repo_id, file_id, uid, kind, name, qualified_name, signature, code, start_line, end_line,
                                    docstring, summary, exported, metadata, content_hash, search_text)
           SELECT $1, $2, x.uid, x.kind, x.name, x.qualified_name, x.signature, x.code, x.start_line, x.end_line,
                  x.docstring, x.summary, x.exported, COALESCE(x.metadata, '{}'::jsonb), x.content_hash, x.search_text
             FROM jsonb_to_recordset($3::jsonb) AS x(uid text, kind text, name text, qualified_name text, signature text,
                  code text, start_line int, end_line int, docstring text, summary text, exported boolean,
                  metadata jsonb, content_hash text, search_text text)
           ON CONFLICT (uid) DO UPDATE SET
             repo_id = EXCLUDED.repo_id, file_id = EXCLUDED.file_id, parent_id = NULL, kind = EXCLUDED.kind,
             name = EXCLUDED.name, qualified_name = EXCLUDED.qualified_name, signature = EXCLUDED.signature,
             code = EXCLUDED.code, start_line = EXCLUDED.start_line, end_line = EXCLUDED.end_line,
             docstring = EXCLUDED.docstring, summary = EXCLUDED.summary, exported = EXCLUDED.exported,
             metadata = EXCLUDED.metadata, content_hash = EXCLUDED.content_hash, search_text = EXCLUDED.search_text`,
          [
            repoId,
            fileId,
            JSON.stringify(
              units.map((u) => ({
                uid: u.uid, kind: u.kind, name: u.name, qualified_name: u.qualifiedName, signature: u.signature,
                code: u.code, start_line: u.startLine, end_line: u.endLine, docstring: u.docstring, summary: u.summary,
                exported: u.exported, metadata: u.metadata, content_hash: u.contentHash, search_text: u.searchText,
              })),
            ),
          ],
        );

        const links = units.filter((u) => u.parentUid).map((u) => ({ child: u.uid, parent: u.parentUid }));
        if (links.length > 0) {
          await client.query(
            `UPDATE ${t.units} c SET parent_id = p.id
               FROM jsonb_to_recordset($1::jsonb) AS m(child text, parent text), ${t.units} p
              WHERE c.uid = m.child AND p.uid = m.parent`,
            [JSON.stringify(links)],
          );
        }
      }

      await client.query(`DELETE FROM ${t.units} WHERE file_id = $1 AND uid <> ALL($2::text[])`, [
        fileId,
        units.map((u) => u.uid),
      ]);

      const keep = new Set(keepEmbeddingUids);
      const stale = existing.rows.map((r) => r.uid).filter((uid) => !keep.has(uid));
      if (stale.length > 0) {
        await client.query(`DELETE FROM ${t.embeddings} WHERE uid = ANY($1::text[])`, [stale]);
      }

      if (embeddings.length > 0) {
        await CodeGraphService.upsertEmbeddingRows(client.query.bind(client), { t, type, repoId, embeddings });
      }

      return { fileId, previousContentHash: previous.rows[0]?.content_hash ?? null };
    });
  }

  private static async upsertEmbeddingRows(
    run: (sql: string, params: unknown[]) => Promise<unknown>,
    { t, type, repoId, embeddings }: { t: CodeTables; type: EmbedType; repoId: number; embeddings: EmbeddingRow[] },
  ): Promise<void> {
    await run(
      `INSERT INTO ${t.embeddings} (uid, unit_type, repo_id, model, content_hash, embedding)
       SELECT x.uid, x.unit_type, $1, x.model, x.content_hash, x.embedding::${type}
         FROM jsonb_to_recordset($2::jsonb) AS x(uid text, unit_type text, model text, content_hash text, embedding text)
       ON CONFLICT (uid) DO UPDATE SET unit_type = EXCLUDED.unit_type, model = EXCLUDED.model,
         content_hash = EXCLUDED.content_hash, embedding = EXCLUDED.embedding`,
      [
        repoId,
        JSON.stringify(
          embeddings.map((e) => ({
            uid: e.uid, unit_type: e.unitType, model: e.model, content_hash: e.contentHash, embedding: toSql(e.embedding),
          })),
        ),
      ],
    );
  }

  /** Write embedding rows outside a file write (file / folder / repo summaries). */
  public static async upsertEmbeddings({
    botId,
    embedType,
    repoId,
    embeddings,
  }: {
    botId: string;
    embedType: string;
    repoId: number;
    embeddings: EmbeddingRow[];
  }): Promise<void> {
    if (embeddings.length === 0) return;
    const t = codeTables(botId);
    const type = assertEmbedType(embedType);
    await CodeGraphService.upsertEmbeddingRows((sql, params) => query(sql, params as unknown[]), { t, type, repoId, embeddings });
  }

  public static async deleteEmbeddings({ botId, uids }: { botId: string; uids: string[] }): Promise<void> {
    if (uids.length === 0) return;
    const t = codeTables(botId);
    await query(`DELETE FROM ${t.embeddings} WHERE uid = ANY($1::text[])`, [uids]);
  }

  /** Replace every outgoing edge of a file's units. Run after all files are loaded, so targets exist. */
  public static async replaceFileEdges({
    botId,
    repoId,
    fileId,
    edges,
  }: {
    botId: string;
    repoId: number;
    fileId: number;
    edges: { fromUid: string; toUid?: string; toExternal?: string; type: string; metadata: Record<string, unknown> }[];
  }): Promise<void> {
    const t = codeTables(botId);
    await withTransaction(async (client) => {
      await client.query(
        `DELETE FROM ${t.edges} USING ${t.units} u WHERE ${t.edges}.from_id = u.id AND u.file_id = $1`,
        [fileId],
      );
      if (edges.length === 0) return;
      await client.query(
        `INSERT INTO ${t.edges} (repo_id, from_id, to_id, to_external, type, metadata)
         SELECT $1, f.id, t.id, CASE WHEN t.id IS NULL THEN COALESCE(x.to_external, x.to_uid) END, x.type,
                COALESCE(x.metadata, '{}'::jsonb)
           FROM jsonb_to_recordset($2::jsonb) AS x(from_uid text, to_uid text, to_external text, type text, metadata jsonb)
           JOIN ${t.units} f ON f.uid = x.from_uid
           LEFT JOIN ${t.units} t ON t.uid = x.to_uid`,
        [
          repoId,
          JSON.stringify(
            edges.map((e) => ({
              from_uid: e.fromUid, to_uid: e.toUid ?? null, to_external: e.toExternal ?? null, type: e.type, metadata: e.metadata,
            })),
          ),
        ],
      );
    });
  }

  /**
   * Remove files that are no longer in the repository (a re-index is a
   * snapshot). Their units and edges go by cascade; embedding rows are keyed
   * by uid, so they are deleted explicitly in the same transaction.
   */
  public static async deleteFilesNotIn({
    botId,
    repoId,
    repoName,
    keepPaths,
  }: {
    botId: string;
    repoId: number;
    repoName: string;
    keepPaths: string[];
  }): Promise<string[]> {
    const t = codeTables(botId);
    return withTransaction(async (client) => {
      await client.query(
        `DELETE FROM ${t.embeddings} WHERE uid IN (
           SELECT e.uid FROM ${t.embeddings} e
             JOIN ${t.units} u ON (e.uid = u.uid OR starts_with(e.uid, u.uid || '#part'))
             JOIN ${t.files} f ON f.id = u.file_id
            WHERE f.repo_id = $1 AND f.path <> ALL($2::text[]))`,
        [repoId, keepPaths],
      );
      const removed = await client.query<{ path: string }>(
        `DELETE FROM ${t.files} WHERE repo_id = $1 AND path <> ALL($2::text[]) RETURNING path`,
        [repoId, keepPaths],
      );
      const paths = removed.rows.map((r) => r.path);
      if (paths.length > 0) {
        await client.query(`DELETE FROM ${t.embeddings} WHERE uid = ANY($1::text[])`, [
          paths.map((p) => `file:${repoName}:${p}`),
        ]);
      }
      return paths;
    });
  }

  // ---- summaries ----------------------------------------------------------

  public static async getFileSummaryState({
    botId,
    repoId,
  }: {
    botId: string;
    repoId: number;
  }): Promise<Map<string, { contentHash: string; summary: string | null }>> {
    const t = codeTables(botId);
    const { rows } = await query<{ path: string; content_hash: string; summary: string | null }>(
      `SELECT path, content_hash, summary FROM ${t.files} WHERE repo_id = $1`,
      [repoId],
    );
    return new Map(rows.map((r) => [r.path, { contentHash: r.content_hash, summary: r.summary }]));
  }

  public static async setFileSummary({ botId, repoId, path, summary }: { botId: string; repoId: number; path: string; summary: string }): Promise<void> {
    const t = codeTables(botId);
    await query(`UPDATE ${t.files} SET summary = $3 WHERE repo_id = $1 AND path = $2`, [repoId, path, summary]);
  }

  public static async getModuleSummaries({ botId, repoId }: { botId: string; repoId: number }): Promise<Map<string, string>> {
    const t = codeTables(botId);
    const { rows } = await query<{ path: string; summary: string }>(
      `SELECT path, summary FROM ${t.modules} WHERE repo_id = $1 AND summary IS NOT NULL`,
      [repoId],
    );
    return new Map(rows.map((r) => [r.path, r.summary]));
  }

  public static async setModuleSummary({ botId, repoId, path, summary }: { botId: string; repoId: number; path: string; summary: string }): Promise<void> {
    const t = codeTables(botId);
    await query(
      `INSERT INTO ${t.modules} (repo_id, path, summary) VALUES ($1, $2, $3)
       ON CONFLICT (repo_id, path) DO UPDATE SET summary = EXCLUDED.summary`,
      [repoId, path, summary],
    );
  }

  /** Drop folder summaries (and their embeddings) for folders that no longer exist. Returns the removed paths. */
  public static async deleteModulesNotIn({
    botId,
    repoId,
    repoName,
    keepPaths,
  }: {
    botId: string;
    repoId: number;
    repoName: string;
    keepPaths: string[];
  }): Promise<string[]> {
    const t = codeTables(botId);
    const removed = await query<{ path: string }>(
      `DELETE FROM ${t.modules} WHERE repo_id = $1 AND path <> ALL($2::text[]) RETURNING path`,
      [repoId, keepPaths],
    );
    const paths = removed.rows.map((r) => r.path);
    await CodeGraphService.deleteEmbeddings({ botId, uids: paths.map((p) => `module:${repoName}:${p}`) });
    return paths;
  }

  public static async setRepoSummary({ botId, repoId, summary }: { botId: string; repoId: number; summary: string }): Promise<void> {
    const t = codeTables(botId);
    await query(`UPDATE ${t.repos} SET summary = $2, updated_at = NOW() WHERE id = $1`, [repoId, summary]);
  }

  public static async touchRepo({ botId, repoId }: { botId: string; repoId: number }): Promise<void> {
    const t = codeTables(botId);
    await query(`UPDATE ${t.repos} SET updated_at = NOW() WHERE id = $1`, [repoId]);
  }

  // ---- cross-layer (frontend → backend) linking ---------------------------

  public static async listRouteUnits({ botId }: { botId: string }): Promise<{ uid: string; method: string; path: string }[]> {
    const t = codeTables(botId);
    const { rows } = await query<{ uid: string; method: string | null; path: string | null }>(
      `SELECT uid, metadata->>'httpMethod' AS method, metadata->>'routePath' AS path FROM ${t.units}
        WHERE kind = 'route' AND metadata->>'httpMethod' IS NOT NULL AND metadata->>'routePath' IS NOT NULL`,
    );
    return rows.map((r) => ({ uid: r.uid, method: r.method as string, path: r.path as string }));
  }

  public static async listUnresolvedApiEdges({ botId }: { botId: string }): Promise<{ id: number; method: string; path: string }[]> {
    const t = codeTables(botId);
    const { rows } = await query<{ id: string; method: string | null; path: string | null }>(
      `SELECT id, metadata->>'method' AS method, metadata->>'path' AS path FROM ${t.edges}
        WHERE type = 'calls_api' AND to_id IS NULL AND metadata->>'method' IS NOT NULL AND metadata->>'path' IS NOT NULL`,
    );
    return rows.map((r) => ({ id: Number(r.id), method: r.method as string, path: r.path as string }));
  }

  // ---- retrieval ----------------------------------------------------------
  //
  // Every read below goes through UNIT_SELECT so a unit always comes back with
  // the file and repository it belongs to — a citation is meaningless without
  // them. It ends in `WHERE true`, so callers append `AND …`.

  /**
   * Nearest neighbours by cosine distance.
   *
   * `ef_search` is set with SET LOCAL inside the transaction, so it applies to
   * the same connection the search runs on — through the pool it would land on
   * a different client and be silently ignored.
   */
  public static async searchByVector({
    botId,
    embedType,
    embedding,
    limit,
    unitTypes,
  }: {
    botId: string;
    embedType: string;
    embedding: number[];
    limit: number;
    unitTypes?: string[];
  }): Promise<{ uid: string; unitType: string; distance: number }[]> {
    const t = codeTables(botId);
    const type = assertEmbedType(embedType);
    const efSearch = Math.max(limit * 4, 40);
    return withTransaction(async (client) => {
      await client.query(`SET LOCAL hnsw.ef_search = ${Math.floor(efSearch)}`);
      const { rows } = await client.query<{ uid: string; unit_type: string; distance: number }>(
        `SELECT uid, unit_type, embedding <=> $1::${type} AS distance FROM ${t.embeddings}
          ${unitTypes?.length ? "WHERE unit_type = ANY($3::text[])" : ""}
          ORDER BY distance LIMIT $2`,
        unitTypes?.length ? [toSql(embedding), limit, unitTypes] : [toSql(embedding), limit],
      );
      return rows.map((r) => ({ uid: r.uid, unitType: r.unit_type, distance: Number(r.distance) }));
    });
  }

  /** Postgres full-text search over the split-identifier text. */
  public static async searchByText({ botId, text, limit }: { botId: string; text: string; limit: number }): Promise<{ uid: string; rank: number }[]> {
    const t = codeTables(botId);
    const { rows } = await query(
      `SELECT uid, ts_rank_cd(search_tsv, q) AS rank
         FROM ${t.units}, websearch_to_tsquery('simple', $1) AS q
        WHERE search_tsv @@ q ORDER BY rank DESC LIMIT $2`,
      [text, limit],
    );
    return rows.map((r) => ({ uid: r.uid as string, rank: Number(r.rank) }));
  }

  /** Fuzzy identifier lookup: `getUsr` still finds `getUser`. */
  public static async searchByTrigram({ botId, tokens, limit }: { botId: string; tokens: string[]; limit: number }): Promise<{ uid: string; similarity: number }[]> {
    if (tokens.length === 0) return [];
    const t = codeTables(botId);
    const { rows } = await query(
      `SELECT uid, MAX(GREATEST(similarity(name, token), similarity(qualified_name, token))) AS similarity
         FROM ${t.units}, unnest($1::text[]) AS token
        WHERE name % token OR qualified_name % token
        GROUP BY uid ORDER BY similarity DESC LIMIT $2`,
      [tokens, limit],
    );
    return rows.map((r) => ({ uid: r.uid as string, similarity: Number(r.similarity) }));
  }

  /** Exact and prefix matches on a symbol name. */
  public static async findSymbol({ botId, name, limit }: { botId: string; name: string; limit: number }): Promise<UnitSummary[]> {
    const t = codeTables(botId);
    const { rows } = await query(
      `${UNIT_SELECT(t)}
          AND (u.name = $1 OR u.qualified_name = $1 OR u.name ILIKE $2 OR u.qualified_name ILIKE $2)
        ORDER BY (u.name = $1 OR u.qualified_name = $1) DESC, u.exported DESC, length(u.qualified_name) LIMIT $3`,
      [name, `%${name}%`, limit],
    );
    return rows as UnitSummary[];
  }

  /** Units by uid, in no particular order. */
  public static async getUnits({ botId, uids }: { botId: string; uids: string[] }): Promise<UnitDetail[]> {
    if (uids.length === 0) return [];
    const t = codeTables(botId);
    const { rows } = await query(`${UNIT_SELECT(t, true)} AND u.uid = ANY($1::text[])`, [uids]);
    return rows as UnitDetail[];
  }

  /** Units matching optional filters, for the search tool. */
  public static async listUnits({
    botId,
    kind,
    pathPrefix,
    limit,
  }: {
    botId: string;
    kind?: string;
    pathPrefix?: string;
    limit: number;
  }): Promise<UnitSummary[]> {
    const t = codeTables(botId);
    const { rows } = await query(
      `${UNIT_SELECT(t)} AND ($1::text IS NULL OR u.kind = $1) AND ($2::text IS NULL OR f.path LIKE $2 || '%')
        ORDER BY u.exported DESC, f.path, u.start_line LIMIT $3`,
      [kind ?? null, pathPrefix ?? null, limit],
    );
    return rows as UnitSummary[];
  }

  /** Backend routes, optionally filtered, with the unit each one hands off to. */
  public static async listRoutes({
    botId,
    method,
    pathContains,
  }: {
    botId: string;
    method?: string;
    pathContains?: string;
  }): Promise<(UnitSummary & { handlerUid: string | null })[]> {
    const t = codeTables(botId);
    const { rows } = await query(
      `${UNIT_SELECT(t)}
          AND u.kind = 'route'
          AND ($1::text IS NULL OR upper(u.metadata->>'httpMethod') = upper($1))
          AND ($2::text IS NULL OR u.metadata->>'routePath' ILIKE '%' || $2 || '%')
        ORDER BY u.metadata->>'routePath'`,
      [method ?? null, pathContains ?? null],
    );
    return rows as (UnitSummary & { handlerUid: string | null })[];
  }

  /**
   * Walk the graph out from some units.
   *
   * `direction` "out" follows callers → callees (how does this work), "in"
   * follows them backwards (what would break), "both" looks one hop each way.
   * The recursive CTE tracks visited ids so a cycle cannot loop forever.
   */
  public static async expandGraph({
    botId,
    uids,
    types,
    depth,
    direction,
    limit,
  }: {
    botId: string;
    uids: string[];
    types: string[];
    depth: number;
    direction: "out" | "in" | "both";
    limit: number;
  }): Promise<{ uid: string; depth: number; viaType: string; fromUid: string }[]> {
    if (uids.length === 0) return [];
    const t = codeTables(botId);

    // Postgres allows a recursive CTE to reference itself exactly once, so both
    // directions are handled by a single join: match an edge on either end and
    // step to whichever end is not the node we came from. `direction` is a
    // closed union, never user input, so it is safe to build the condition.
    const match =
      direction === "out" ? "e.from_id = w.id"
      : direction === "in" ? "e.to_id = w.id"
      : "(e.from_id = w.id OR e.to_id = w.id)";

    const { rows } = await query(
      `WITH RECURSIVE walk(id, depth, via_type, from_uid, seen) AS (
         SELECT u.id, 0, ''::text, u.uid, ARRAY[u.id]
           FROM ${t.units} u WHERE u.uid = ANY($1::text[])
         UNION ALL
         SELECT step.next_id, w.depth + 1, e.type, fu.uid, w.seen || step.next_id
           FROM walk w
           JOIN ${t.edges} e ON ${match}
           JOIN ${t.units} fu ON fu.id = w.id
           CROSS JOIN LATERAL (
             SELECT CASE WHEN e.from_id = w.id THEN e.to_id ELSE e.from_id END AS next_id
           ) AS step
          WHERE w.depth < $3
            AND e.type = ANY($2::text[])
            AND step.next_id IS NOT NULL
            AND NOT step.next_id = ANY(w.seen)
       )
       SELECT u.uid, MIN(w.depth)::int AS depth,
              (ARRAY_AGG(w.via_type ORDER BY w.depth))[1] AS "viaType",
              (ARRAY_AGG(w.from_uid ORDER BY w.depth))[1] AS "fromUid"
         FROM walk w JOIN ${t.units} u ON u.id = w.id
        WHERE w.depth > 0
        GROUP BY u.uid ORDER BY depth LIMIT $4`,
      [uids, types, depth, limit],
    );
    return rows.map((r) => ({ uid: r.uid as string, depth: Number(r.depth), viaType: r.viaType as string, fromUid: r.fromUid as string }));
  }

  /** Outgoing or incoming edges of one unit, for the callers/callees tools. */
  public static async neighbours({
    botId,
    uid,
    direction,
    types,
  }: {
    botId: string;
    uid: string;
    direction: "out" | "in";
    types: string[];
  }): Promise<{ uid: string | null; external: string | null; type: string; name: string | null; path: string | null; startLine: number | null }[]> {
    const t = codeTables(botId);
    const joinOn = direction === "out" ? "e.from_id = src.id" : "e.to_id = src.id";
    const otherId = direction === "out" ? "e.to_id" : "e.from_id";
    const { rows } = await query(
      `SELECT o.uid, e.to_external AS external, e.type, o.name, f.path, o.start_line AS "startLine"
         FROM ${t.units} src JOIN ${t.edges} e ON ${joinOn}
         LEFT JOIN ${t.units} o ON o.id = ${otherId}
         LEFT JOIN ${t.files} f ON f.id = o.file_id
        WHERE src.uid = $1 AND e.type = ANY($2::text[])
        ORDER BY e.type, o.name NULLS LAST`,
      [uid, types],
    );
    return rows as { uid: string | null; external: string | null; type: string; name: string | null; path: string | null; startLine: number | null }[];
  }

  /** One file's stored content, for the read_file tool. */
  public static async readFile({ botId, path, repo }: { botId: string; path: string; repo?: string }): Promise<{ path: string; repo: string; content: string; lineCount: number } | null> {
    const t = codeTables(botId);
    const { rows } = await query(
      `SELECT f.path, r.name AS repo, f.content, f.line_count AS "lineCount"
         FROM ${t.files} f JOIN ${t.repos} r ON r.id = f.repo_id
        WHERE f.path = $1 AND ($2::text IS NULL OR r.name = $2) LIMIT 1`,
      [path, repo ?? null],
    );
    return (rows[0] as { path: string; repo: string; content: string; lineCount: number }) ?? null;
  }

  /** Stored summaries for a file or folder path. */
  public static async getSummary({ botId, path }: { botId: string; path: string }): Promise<{ level: "file" | "module"; path: string; summary: string } | null> {
    const t = codeTables(botId);
    const file = await query(`SELECT path, summary FROM ${t.files} WHERE path = $1 AND summary IS NOT NULL LIMIT 1`, [path]);
    if (file.rows[0]) return { level: "file", path: file.rows[0].path as string, summary: file.rows[0].summary as string };
    const module = await query(`SELECT path, summary FROM ${t.modules} WHERE path = $1 AND summary IS NOT NULL LIMIT 1`, [path.replace(/\/$/, "")]);
    if (module.rows[0]) return { level: "module", path: module.rows[0].path as string, summary: module.rows[0].summary as string };
    return null;
  }

  /** Repository summaries, for the top of the answer context. */
  public static async getRepoSummaries({ botId }: { botId: string }): Promise<{ name: string; summary: string }[]> {
    const t = codeTables(botId);
    const { rows } = await query(`SELECT name, summary FROM ${t.repos} WHERE summary IS NOT NULL ORDER BY name`);
    return rows as { name: string; summary: string }[];
  }

  public static async resolveApiEdges({ botId, matches }: { botId: string; matches: { edgeId: number; toUid: string }[] }): Promise<number> {
    if (matches.length === 0) return 0;
    const t = codeTables(botId);
    const result = await query(
      `UPDATE ${t.edges} e SET to_id = u.id, to_external = NULL
         FROM jsonb_to_recordset($1::jsonb) AS m(edge_id bigint, to_uid text)
         JOIN ${t.units} u ON u.uid = m.to_uid
        WHERE e.id = m.edge_id`,
      [JSON.stringify(matches.map((m) => ({ edge_id: m.edgeId, to_uid: m.toUid })))],
    );
    return result.rowCount ?? 0;
  }
}

export type RepoSummary = {
  id: number;
  name: string;
  sourceType: string;
  sourceRef: string | null;
  summary: string | null;
  createdAt: string;
  updatedAt: string;
  files: number;
  units: number;
  edges: number;
};

/** What a unit looks like to retrieval: enough to rank it and cite it. */
export type UnitSummary = {
  uid: string;
  repo: string;
  path: string;
  kind: string;
  name: string;
  qualifiedName: string;
  signature: string | null;
  summary: string | null;
  docstring: string | null;
  startLine: number;
  endLine: number;
  exported: boolean;
  metadata: Record<string, unknown>;
  handlerUid: string | null;
};

export type UnitDetail = UnitSummary & { code: string };

const UNIT_SELECT = (t: CodeTables, withCode = false): string => `
  SELECT u.uid, r.name AS repo, f.path, u.kind, u.name, u.qualified_name AS "qualifiedName",
         u.signature, u.summary, u.docstring, u.start_line AS "startLine", u.end_line AS "endLine",
         u.exported, u.metadata${withCode ? ", u.code" : ""},
         (SELECT h.uid FROM ${t.edges} e JOIN ${t.units} h ON h.id = e.to_id
           WHERE e.from_id = u.id AND e.type = 'handles_route' LIMIT 1) AS "handlerUid"
    FROM ${t.units} u
    JOIN ${t.files} f ON f.id = u.file_id
    JOIN ${t.repos} r ON r.id = u.repo_id
   WHERE true`;

export type UnitRow = {
  uid: string;
  parentUid: string | null;
  kind: string;
  name: string;
  qualifiedName: string;
  signature: string | null;
  code: string;
  startLine: number;
  endLine: number;
  docstring: string | null;
  summary: string | null;
  exported: boolean;
  metadata: Record<string, unknown>;
  contentHash: string;
  searchText: string;
};

export type EmbeddingRow = {
  uid: string;
  unitType: "code" | "file_summary" | "module_summary" | "repo_summary";
  model: string;
  contentHash: string;
  embedding: number[];
};
