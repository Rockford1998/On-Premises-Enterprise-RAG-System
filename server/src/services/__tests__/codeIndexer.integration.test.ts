/**
 * The indexing pipeline against a real Postgres, with the embedding model and
 * the summariser mocked so every call can be counted. Skipped unless
 * TEST_DATABASE_URL is set (see codeGraph.integration.test.ts).
 *
 * These run with the real tree-sitter adapters, so they are also the
 * end-to-end check that parsing, framework detection and cross-layer linking
 * work together on a realistic project.
 */
/* eslint-disable @typescript-eslint/no-var-requires */
import fs from "fs";
import os from "os";
import path from "path";
import { Pool } from "pg";

jest.mock("../../llmServices/generateCodeEmbeddings", () => ({
  generateCodeEmbeddings: jest.fn(),
  probeEmbeddingDimension: jest.fn(),
}));
jest.mock("../../llmServices/generateSummary", () => ({ generateSummary: jest.fn() }));

const url = process.env.TEST_DATABASE_URL;
// ts-jest compiles the DB modules on first require, which is slow when many suites run in parallel.
jest.setTimeout(60_000);
const describeDb = url ? describe : describe.skip;

const DIM = 8;
const BOT = "bot_idx_AAAAAA";
const FIXTURE = path.resolve(__dirname, "../../../test-fixtures/sample-mern");

describeDb("indexRepository against Postgres", () => {
  let pool: Pool;
  let tmp: string;
  const mods = () => ({
    graph: require("../codeGraph.service"),
    indexer: require("../codeIndexer.service"),
    sources: require("../../codeIntel/extract/fileSource"),
    registry: require("../../codeIntel/core/registry"),
    embed: require("../../llmServices/generateCodeEmbeddings").generateCodeEmbeddings as jest.Mock,
    summary: require("../../llmServices/generateSummary").generateSummary as jest.Mock,
  });
  const t = () => mods().graph.codeTables(BOT);

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
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "code-idx-"));
  });

  afterAll(async () => {
    await mods().graph.CodeGraphService.dropBotTables({ botId: BOT });
    await require("../../db/pgsql").closePostgres();
    require("../../codeIntel/parse/treesitter").disposeParsers();
    await pool?.end();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  beforeEach(async () => {
    const { graph, embed, summary } = mods();
    await graph.CodeGraphService.dropBotTables({ botId: BOT });
    await graph.CodeGraphService.createBotTables({ botId: BOT, embedDim: DIM, embedType: "vector" });
    // deterministic, non-zero, text-dependent vectors
    embed.mockImplementation(async ({ texts }: { texts: string[] }) =>
      texts.map((text) => {
        if (text.includes("EMBED_FAIL")) throw new Error("simulated embedding failure");
        return Array.from({ length: DIM }, (_, i) => ((text.charCodeAt(i % text.length) + i) % 17) + 1);
      }),
    );
    summary.mockImplementation(async ({ prompt }: { prompt: string }) => `Summary of: ${prompt.split("\n").find((l) => l.startsWith("Name:") || l.startsWith("File:") || l.startsWith("Folder:") || l.startsWith("Repository:")) ?? "x"}`);
  });

  /** A writable copy of a fixture, so a test can edit or delete files. */
  const copyFixture = (name: string, only?: string[]): string => {
    const dest = path.join(tmp, name);
    fs.rmSync(dest, { recursive: true, force: true });
    fs.cpSync(FIXTURE, dest, {
      recursive: true,
      filter: (src) => {
        if (!only) return true;
        const rel = path.relative(FIXTURE, src).split(path.sep).join("/");
        return rel === "" || only.some((o) => rel === o || rel.startsWith(`${o}/`) || o.startsWith(`${rel}/`));
      },
    });
    return dest;
  };

  const run = async (dir: string, over: Record<string, unknown> = {}) => {
    const { indexer, sources } = mods();
    const source = await sources.DirectorySource.open({ root: path.basename(dir), allowedRoot: path.dirname(dir) });
    return indexer.indexRepository({
      botId: BOT,
      codeConfig: { embedModel: "test-embed", embedDim: DIM, embedType: "vector" },
      baseModel: "test-chat",
      repoName: (over.repoName as string) ?? "shop",
      sourceType: "path",
      sourceRef: dir,
      source,
      summarize: false,
      limits: { maxFiles: 1000, maxFileBytes: 1 << 20 },
      excludeGlobs: [],
      concurrency: 2,
      maxChunkTokens: 800,
      numCtx: 8192,
      ...over,
    });
  };

  const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> => (await pool.query(sql, params)).rows as T[];

  const edge = async (fromName: string, type: string) =>
    q<{ to_uid: string | null; to_external: string | null }>(
      `SELECT tu.uid AS to_uid, e.to_external FROM ${t().edges} e
         JOIN ${t().units} f ON f.id = e.from_id LEFT JOIN ${t().units} tu ON tu.id = e.to_id
        WHERE f.name = $1 AND e.type = $2 ORDER BY 1, 2`,
      [fromName, type],
    );

  it("indexes the fixture: files, units, edges, embeddings — and never the .env", async () => {
    const copy = copyFixture("full");
    const result = await run(copy);

    expect(result.fileErrors).toEqual([]);
    const files = (await q<{ path: string }>(`SELECT path FROM ${t().files} ORDER BY path`)).map((r) => r.path);
    expect(files).toContain("services/userService.js");
    expect(files).toContain("package.json");
    expect(files).not.toContain(".env");
    expect(files).toHaveLength(12);
    expect(result.skipped).toContainEqual({ path: ".env", reason: "secret" });
    expect(JSON.stringify(await q(`SELECT content FROM ${t().files}`))).not.toContain("not-a-real-secret");

    // Units: real parsing gives functions, React components/hooks and Express routes.
    const names = (await q<{ name: string; kind: string }>(`SELECT name, kind FROM ${t().units}`)).map((r) => `${r.kind}:${r.name}`);
    expect(names).toEqual(expect.arrayContaining([
      "hook:useUsers", "component:UsersPage", "component:UserCard", "component:App",
      "function:listUsers", "function:createUser", "function:findAll", "function:getUserById",
      "route:route:GET /api/users", "route:route:POST /api/users",
    ]));
    const fileUnits = await q(`SELECT 1 FROM ${t().units} WHERE kind = 'file'`);
    expect(fileUnits).toHaveLength(12);

    // The mount prefix lives in server.js, the route in routes/users.js.
    const route = (await q<{ metadata: Record<string, unknown>; path: string }>(
      `SELECT u.metadata, f.path FROM ${t().units} u JOIN ${t().files} f ON f.id = u.file_id WHERE u.name = 'route:GET /api/users'`,
    ))[0];
    expect(route.path).toBe("routes/users.js");
    expect(route.metadata).toMatchObject({ httpMethod: "GET", routePath: "/api/users", framework: "express" });

    // The client route is declared in App.tsx but belongs to the page component.
    const page = (await q<{ metadata: Record<string, unknown> }>(`SELECT metadata FROM ${t().units} WHERE name = 'UsersPage'`))[0];
    expect(page.metadata.clientRoute).toBe("/users");

    // edges
    expect(await edge("route:GET /api/users", "handles_route")).toEqual([{ to_uid: "shop:controllers/userController.js#listUsers", to_external: null }]);
    expect(await edge("listUsers", "calls")).toEqual(expect.arrayContaining([{ to_uid: "shop:services/userService.js#findAll", to_external: null }]));
    expect(await edge("UsersPage", "uses_hook")).toEqual([{ to_uid: "shop:src/hooks/useUsers.ts#useUsers", to_external: null }]);
    expect(await edge("UsersPage", "renders")).toEqual([{ to_uid: "shop:src/components/UserCard.tsx#UserCard", to_external: null }]);
    // cross-layer: useUsers --calls_api--> route GET /api/users
    expect(await edge("useUsers", "calls_api")).toEqual([{ to_uid: "shop:routes/users.js#route:GET /api/users", to_external: null }]);
    expect(result.stats.apiEdgesLinked).toBe(1);

    // every unit has an embedding row; every embedding belongs to a unit
    const orphanUnits = await q(`SELECT u.uid FROM ${t().units} u WHERE NOT EXISTS
      (SELECT 1 FROM ${t().embeddings} e WHERE e.uid = u.uid OR starts_with(e.uid, u.uid || '#part'))`);
    expect(orphanUnits).toEqual([]);
    const orphanEmbeddings = await q(`SELECT e.uid FROM ${t().embeddings} e WHERE NOT EXISTS
      (SELECT 1 FROM ${t().units} u WHERE e.uid = u.uid OR starts_with(e.uid, u.uid || '#part'))`);
    expect(orphanEmbeddings).toEqual([]);

    // the header (repo, file, symbol, route) is what was embedded
    const texts: string[] = mods().embed.mock.calls.flatMap((c: [{ texts: string[] }]) => c[0].texts);
    expect(texts.some((x) => x.includes("Route: GET /api/users") && x.includes("Repo: shop"))).toBe(true);
    expect(texts.some((x) => x.includes("Symbol: findAll") && x.includes("File: services/userService.js"))).toBe(true);
  });

  it("re-indexing an unchanged repository makes no embedding or LLM calls and keeps ids", async () => {
    const copy = copyFixture("rerun");
    await run(copy, { summarize: true });
    const before = await q<{ id: string; uid: string }>(`SELECT id, uid FROM ${t().units} ORDER BY uid`);
    const { embed, summary } = mods();
    embed.mockClear();
    summary.mockClear();

    const again = await run(copy, { summarize: true });

    expect(embed).not.toHaveBeenCalled();
    expect(summary).not.toHaveBeenCalled();
    expect(again.stats.embedded).toBe(0);
    expect(again.stats.summarized).toBe(0);
    expect(again.stats.filesChanged).toBe(0);
    expect(again.stats.filesUnchanged).toBe(12);
    expect(await q<{ id: string; uid: string }>(`SELECT id, uid FROM ${t().units} ORDER BY uid`)).toEqual(before);
    expect((await mods().graph.CodeGraphService.countRows({ botId: BOT })).edges).toBeGreaterThan(0);
  });

  it("re-embeds only what changed, and edges from unchanged files survive", async () => {
    const copy = copyFixture("edit");
    await run(copy);
    const { embed } = mods();
    embed.mockClear();

    const file = path.join(copy, "services", "userService.js");
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("return User.find();", "return User.find().sort({ name: 1 });"));
    const again = await run(copy);

    const texts: string[] = embed.mock.calls.flatMap((c: [{ texts: string[] }]) => c[0].texts);
    expect(again.stats.filesChanged).toBe(1);
    expect(texts.length).toBeGreaterThan(0);
    expect(texts.every((x) => x.includes("File: services/userService.js"))).toBe(true);
    // the untouched controller still calls the (same-id) service function
    expect(await edge("listUsers", "calls")).toEqual(expect.arrayContaining([{ to_uid: "shop:services/userService.js#findAll", to_external: null }]));
    const stored = await q<{ code: string }>(`SELECT code FROM ${t().units} WHERE uid = 'shop:services/userService.js#findAll'`);
    expect(stored[0].code).toContain("sort({ name: 1 })");
  });

  it("removes a deleted file's units, edges and embeddings", async () => {
    const copy = copyFixture("delete");
    await run(copy);
    expect((await q(`SELECT 1 FROM ${t().units} WHERE uid LIKE 'shop:models/User.js#%'`)).length).toBeGreaterThan(0);
    expect((await q(`SELECT 1 FROM ${t().embeddings} WHERE uid LIKE 'shop:models/User.js#%'`)).length).toBeGreaterThan(0);

    fs.rmSync(path.join(copy, "models", "User.js"));
    const again = await run(copy);

    expect(again.stats.filesRemoved).toBe(1);
    expect(await q(`SELECT 1 FROM ${t().files} WHERE path = 'models/User.js'`)).toEqual([]);
    expect(await q(`SELECT 1 FROM ${t().units} WHERE uid LIKE 'shop:models/User.js#%'`)).toEqual([]);
    expect(await q(`SELECT 1 FROM ${t().embeddings} WHERE uid LIKE 'shop:models/User.js#%'`)).toEqual([]);
    const dangling = await q(`SELECT 1 FROM ${t().edges} e WHERE e.to_id IS NULL AND e.to_external IS NULL`);
    expect(dangling).toEqual([]);
  });

  it("keeps a file that fails to embed out of the database while the rest is indexed (partial)", async () => {
    const copy = copyFixture("fail");
    fs.appendFileSync(path.join(copy, "models", "User.js"), "\n// EMBED_FAIL\n");
    const result = await run(copy);

    expect(result.fileErrors.map((e: { path: string }) => e.path)).toEqual(["models/User.js"]);
    expect(await q(`SELECT 1 FROM ${t().files} WHERE path = 'models/User.js'`)).toEqual([]);
    expect(await q(`SELECT 1 FROM ${t().units} WHERE uid LIKE 'shop:models/User.js#%'`)).toEqual([]);
    expect(await q(`SELECT 1 FROM ${t().embeddings} WHERE uid LIKE 'shop:models/User.js#%'`)).toEqual([]);
    expect(await q(`SELECT 1 FROM ${t().files}`)).toHaveLength(11);
  });

  it("falls back to a single file unit when a file cannot be parsed", async () => {
    const copy = copyFixture("parsefail");
    // Past the parser's size limit — the file stays searchable, the run continues.
    fs.appendFileSync(path.join(copy, "server.js"), `\n${"const filler = 1;\n".repeat(40_000)}`);
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const result = await run(copy);
    warn.mockRestore();

    expect(result.stats.parseFallbacks).toBe(1);
    expect(result.fileErrors).toEqual([]);
    expect(await q(`SELECT kind FROM ${t().units} WHERE uid LIKE 'shop:server.js#%'`)).toEqual([{ kind: "file" }]);
    // the rest of the repository still parsed properly
    expect((await q(`SELECT 1 FROM ${t().units} WHERE kind = 'route'`)).length).toBeGreaterThan(0);
  });

  it("links the whole feature: page → hook → API call → route → controller → service", async () => {
    await run(copyFixture("chain"));
    const hop = async (fromName: string, type: string) =>
      (await q<{ name: string }>(
        `SELECT tu.name FROM ${t().edges} e JOIN ${t().units} f ON f.id = e.from_id
           JOIN ${t().units} tu ON tu.id = e.to_id WHERE f.name = $1 AND e.type = $2`,
        [fromName, type],
      )).map((r) => r.name);

    expect(await hop("UsersPage", "uses_hook")).toEqual(["useUsers"]);
    expect(await hop("UsersPage", "renders")).toEqual(["UserCard"]);
    expect(await hop("useUsers", "calls_api")).toEqual(["route:GET /api/users"]);
    expect(await hop("route:GET /api/users", "handles_route")).toEqual(["listUsers"]);
    expect(await hop("listUsers", "calls")).toEqual(expect.arrayContaining(["findAll"]));
  });

  it("refuses an empty repository and leaves existing data untouched", async () => {
    const copy = copyFixture("empty-first");
    await run(copy);
    const before = await mods().graph.CodeGraphService.countRows({ botId: BOT });

    const empty = path.join(tmp, "nothing");
    fs.rmSync(empty, { recursive: true, force: true });
    fs.mkdirSync(empty);
    fs.writeFileSync(path.join(empty, ".env"), "SECRET=1");
    await expect(run(empty)).rejects.toMatchObject({ name: "NoFilesError" });

    expect(await mods().graph.CodeGraphService.countRows({ botId: BOT })).toEqual(before);
  });

  it("links a frontend to a backend that lives in a different repository, in either order", async () => {
    const backend = copyFixture("backend", ["package.json", "server.js", "routes", "controllers", "services", "models"]);
    const frontend = copyFixture("frontend", ["package.json", "tsconfig.json", "src"]);

    await run(frontend, { repoName: "web" });
    expect(await edge("useUsers", "calls_api")).toEqual([{ to_uid: null, to_external: "api:GET /api/users" }]);

    const result = await run(backend, { repoName: "api" });
    expect(result.stats.apiEdgesLinked).toBe(1);
    expect(await edge("useUsers", "calls_api")).toEqual([{ to_uid: "api:routes/users.js#route:GET /api/users", to_external: null }]);
    expect((await mods().graph.CodeGraphService.listRepos({ botId: BOT })).map((r: { name: string }) => r.name)).toEqual(["api", "web"]);
  });

  it("deleting a repository removes only its own data", async () => {
    await run(copyFixture("backend2", ["package.json", "server.js", "routes", "controllers", "services", "models"]), { repoName: "api" });
    await run(copyFixture("frontend2", ["package.json", "tsconfig.json", "src"]), { repoName: "web" });
    const [api] = (await mods().graph.CodeGraphService.listRepos({ botId: BOT })).filter((r: { name: string }) => r.name === "api");

    expect(await mods().graph.CodeGraphService.deleteRepo({ botId: BOT, repoId: api.id })).toBe(true);

    expect(await q(`SELECT 1 FROM ${t().units} WHERE uid LIKE 'api:%'`)).toEqual([]);
    expect(await q(`SELECT 1 FROM ${t().embeddings} WHERE uid LIKE 'api:%'`)).toEqual([]);
    expect((await q(`SELECT 1 FROM ${t().units} WHERE uid LIKE 'web:%'`)).length).toBeGreaterThan(0);
  });

  describe("summaries (opt-in)", () => {
    it("are off by default: no LLM calls, and units have no summary", async () => {
      await run(copyFixture("nosum"));
      expect(mods().summary).not.toHaveBeenCalled();
      expect(await q(`SELECT 1 FROM ${t().units} WHERE summary IS NOT NULL`)).toEqual([]);
    });

    it("build bottom-up (unit → file → folder → repo), are embedded, and only changed parts are redone", async () => {
      const copy = copyFixture("sum");
      const first = await run(copy, { summarize: true });

      expect(first.stats.summarized).toBeGreaterThan(5);
      expect((await q(`SELECT 1 FROM ${t().units} WHERE summary IS NOT NULL AND kind <> 'file'`)).length).toBeGreaterThan(3);
      expect((await q(`SELECT 1 FROM ${t().files} WHERE summary IS NOT NULL`)).length).toBeGreaterThan(3);
      expect((await q(`SELECT 1 FROM ${t().modules} WHERE summary IS NOT NULL`)).length).toBeGreaterThan(2);
      expect((await q<{ summary: string | null }>(`SELECT summary FROM ${t().repos}`))[0].summary).toContain("Summary of:");
      const kinds = (await q<{ unit_type: string }>(`SELECT DISTINCT unit_type FROM ${t().embeddings} ORDER BY 1`)).map((r) => r.unit_type);
      expect(kinds).toEqual(["code", "file_summary", "module_summary", "repo_summary"]);
      // the unit summary is part of what is embedded
      const texts: string[] = mods().embed.mock.calls.flatMap((c: [{ texts: string[] }]) => c[0].texts);
      expect(texts.some((x) => x.includes("Summary: Summary of:"))).toBe(true);
      // and is searchable
      expect((await q(`SELECT 1 FROM ${t().units} WHERE search_tsv @@ to_tsquery('simple', 'summary')`)).length).toBeGreaterThan(0);

      mods().summary.mockClear();
      const file = path.join(copy, "services", "userService.js");
      fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("return User.find();", "return User.find().sort({ createdAt: -1 });"));
      const again = await run(copy, { summarize: true });

      const prompts: string[] = mods().summary.mock.calls.map((c: [{ prompt: string }]) => c[0].prompt);
      expect(again.stats.filesChanged).toBe(1);
      // the changed function, its file, its folders and the repo — nothing from other files
      expect(prompts.some((p) => p.includes("Name: findAll"))).toBe(true);
      expect(prompts.some((p) => p.includes("File: services/userService.js") && !p.includes("Name:"))).toBe(true);
      expect(prompts.some((p) => p.startsWith("Summarise what this repository"))).toBe(true);
      // findAll's siblings in the same file did not change, so their summaries are reused
      expect(prompts.some((p) => p.includes("Name: createUser"))).toBe(false);
      expect(prompts.some((p) => p.includes("Name: listUsers"))).toBe(false);
      expect(prompts.some((p) => p.includes("Name: UserCard"))).toBe(false);
      expect(prompts.length).toBeLessThan(first.stats.summarized);
    });

    it("keep a unit's stored summary when summaries are switched off later and the code is unchanged", async () => {
      const copy = copyFixture("keep");
      await run(copy, { summarize: true });
      await run(copy, { summarize: false });
      expect((await q(`SELECT 1 FROM ${t().units} WHERE summary IS NOT NULL AND kind <> 'file'`)).length).toBeGreaterThan(3);
    });

    it("do not stop the run when the summariser fails", async () => {
      mods().summary.mockRejectedValue(new Error("model offline"));
      const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
      const result = await run(copyFixture("sumfail"), { summarize: true });
      warn.mockRestore();
      expect(result.fileErrors).toEqual([]);
      expect(result.stats.units).toBeGreaterThan(10);
      expect(await q(`SELECT 1 FROM ${t().units} WHERE summary IS NOT NULL`)).toEqual([]);
    });
  });
});
