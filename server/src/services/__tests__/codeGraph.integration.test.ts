/**
 * Runs against a real Postgres (pgvector image). Skipped unless
 * TEST_DATABASE_URL is set, so `npm test` stays green offline; CI provides one.
 *   TEST_DATABASE_URL=postgres://root:root@localhost:5432/poc_test npm test
 *
 * config/env.ts reads the DB_* variables at import time, so they are set in
 * beforeAll and the modules under test are required lazily afterwards.
 */
/* eslint-disable @typescript-eslint/no-var-requires */
import { Pool } from "pg";

const url = process.env.TEST_DATABASE_URL;
// ts-jest compiles the DB modules on first require, which is slow when many suites run in parallel.
jest.setTimeout(60_000);
const describeDb = url ? describe : describe.skip;

describeDb("CodeGraphService against Postgres", () => {
  let pool: Pool;
  const BOT_A = "bot_it_AAAAAA";
  const BOT_B = "bot_it_BBBBBB";
  const graph = () => require("../codeGraph.service");
  const tablesA = () => graph().codeTables(BOT_A);
  const tablesB = () => graph().codeTables(BOT_B);

  beforeAll(async () => {
    const parsed = new URL(url as string);
    process.env.DB_HOST = parsed.hostname;
    process.env.DB_PORT = parsed.port || "5432";
    process.env.DB_USER = decodeURIComponent(parsed.username);
    process.env.DB_PASSWORD = decodeURIComponent(parsed.password);
    process.env.DB_NAME = parsed.pathname.replace(/^\//, "");
    process.env.DB_AUTO_CREATE = "false";
    // Jest runs suites in parallel; a full-size pool per suite exhausts the
    // server's connection budget and each one then times out connecting.
    process.env.DB_POOL_MAX = "4";
    process.env.DB_POOL_CONNECT_TIMEOUT = "30000";
    delete process.env.DATABASE_URL;
    pool = new Pool({ connectionString: url, max: 3 });
    await require("../../db/pgsql").initPostgres();
  });

  afterAll(async () => {
    await graph().CodeGraphService.dropBotTables({ botId: BOT_A });
    await graph().CodeGraphService.dropBotTables({ botId: BOT_B });
    await require("../../db/pgsql").closePostgres();
    await pool?.end();
  });

  const tableNames = async (like: string): Promise<string[]> => {
    const { rows } = await pool.query(
      "SELECT table_name FROM information_schema.tables WHERE table_name LIKE $1 ORDER BY 1",
      [like],
    );
    return rows.map((r) => r.table_name);
  };

  const embeddingType = async (table: string): Promise<string> => {
    const { rows } = await pool.query(
      `SELECT format_type(a.atttypid, a.atttypmod) AS type
         FROM pg_attribute a WHERE a.attrelid = $1::regclass AND a.attname = 'embedding'`,
      [table],
    );
    return rows[0].type;
  };

  it("creates six tables per bot, idempotently, with the embedding column sized to the config", async () => {
    const { CodeGraphService } = graph();
    await CodeGraphService.createBotTables({ botId: BOT_A, embedDim: 1024, embedType: "vector" });
    await CodeGraphService.createBotTables({ botId: BOT_A, embedDim: 1024, embedType: "vector" });
    expect(await tableNames("code_bot_it_aaaaaa_%")).toHaveLength(6);
    expect(await embeddingType(tablesA().embeddings)).toBe("vector(1024)");
  });

  it("supports halfvec for models above 2000 dimensions", async () => {
    await graph().CodeGraphService.createBotTables({ botId: BOT_B, embedDim: 2560, embedType: "halfvec" });
    expect(await embeddingType(tablesB().embeddings)).toBe("halfvec(2560)");
  });

  it("keeps bots isolated and drops only the target bot's tables", async () => {
    const { CodeGraphService } = graph();
    await pool.query(`INSERT INTO ${tablesA().repos} (name, source_type) VALUES ('r', 'zip')`);
    expect((await pool.query(`SELECT count(*)::int AS n FROM ${tablesB().repos}`)).rows[0].n).toBe(0);

    await CodeGraphService.dropBotTables({ botId: BOT_A });
    expect(await tableNames("code_bot_it_aaaaaa_%")).toHaveLength(0);
    expect(await tableNames("code_bot_it_bbbbbb_%")).toHaveLength(6);
    await expect(CodeGraphService.dropBotTables({ botId: BOT_A })).resolves.toBeUndefined();
  });

  it("cascades a repo delete through files, units, edges and embeddings", async () => {
    await graph().CodeGraphService.createBotTables({ botId: BOT_A, embedDim: 4, embedType: "vector" });
    const t = tablesA();
    const repo = (await pool.query(`INSERT INTO ${t.repos} (name, source_type) VALUES ('r','zip') RETURNING id`)).rows[0].id;
    const file = (await pool.query(
      `INSERT INTO ${t.files} (repo_id, path, category, content, content_hash, line_count)
       VALUES ($1,'a.ts','source','x','h',1) RETURNING id`, [repo])).rows[0].id;
    const unit = (await pool.query(
      `INSERT INTO ${t.units} (repo_id, file_id, uid, kind, name, qualified_name, code, start_line, end_line, content_hash, search_text)
       VALUES ($1,$2,'r:a.ts#f','function','f','f','x',1,1,'h','f') RETURNING id`, [repo, file])).rows[0].id;
    await pool.query(
      `INSERT INTO ${t.edges} (repo_id, from_id, to_external, type) VALUES ($1,$2,'npm:axios','imports')`, [repo, unit]);
    await pool.query(
      `INSERT INTO ${t.embeddings} (uid, unit_type, repo_id, model, content_hash, embedding)
       VALUES ('r:a.ts#f','code',$1,'m','h','[1,0,0,0]')`, [repo]);

    await pool.query(`DELETE FROM ${t.repos} WHERE id = $1`, [repo]);
    for (const table of [t.files, t.units, t.edges, t.embeddings]) {
      expect((await pool.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n).toBe(0);
    }
  });
});
