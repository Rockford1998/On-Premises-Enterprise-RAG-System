/**
 * Retrieval and the agent tools, against a real Postgres with the fixture
 * indexed by the real parsers. The embedding model is mocked with a small
 * deterministic bag-of-words vector — enough for "does the pipeline wire up"
 * without pretending it measures a real model's quality.
 *
 * Skipped unless TEST_DATABASE_URL is set.
 */
/* eslint-disable @typescript-eslint/no-var-requires */
import path from "path";
import { Pool } from "pg";
// Type-only: erased at runtime, so the modules still load lazily after the env is set.
import type { CodeSearchService as CodeSearchServiceType, SearchHit } from "../codeSearch.service";
import type { CodeChatService as CodeChatServiceType } from "../codeChat.service";

jest.mock("../../llmServices/generateCodeEmbeddings", () => ({
  generateCodeEmbeddings: jest.fn(),
  probeEmbeddingDimension: jest.fn(),
}));
jest.mock("../../llmServices/generateSummary", () => ({ generateSummary: jest.fn() }));
jest.mock("../../llmServices/generateCodeAnswer", () => ({
  generateCodeAnswer: jest.fn(),
  buildCodePrompt: jest.requireActual("../../llmServices/generateCodeAnswer").buildCodePrompt,
}));
jest.mock("../../llmServices/runCodeAgent", () => ({
  runToolLoop: jest.fn(),
  parseJsonToolCall: jest.requireActual("../../llmServices/runCodeAgent").parseJsonToolCall,
}));

jest.setTimeout(120_000);

const url = process.env.TEST_DATABASE_URL;
const describeDb = url ? describe : describe.skip;

const DIM = 64;
const BOT = "bot_search_AAAAAA";
const FIXTURES = path.resolve(__dirname, "../../../test-fixtures");

/** A crude but deterministic embedding: word presence hashed into buckets. */
const bagOfWords = (text: string): number[] => {
  const vector = new Array<number>(DIM).fill(0);
  for (const word of text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2)) {
    let hash = 0;
    for (const ch of word) hash = (hash * 31 + ch.charCodeAt(0)) % DIM;
    vector[hash] += 1;
  }
  const norm = Math.sqrt(vector.reduce((s, v) => s + v * v, 0));
  return norm > 0 ? vector.map((v) => v / norm) : vector.map(() => 1 / Math.sqrt(DIM));
};

describeDb("code retrieval and agent tools", () => {
  let pool: Pool;
  const owner = { email: "owner@example.com", roles: ["USER"] };
  const stranger = { email: "stranger@example.com", roles: ["USER"] };

  const mods = () => ({
    graph: require("../codeGraph.service"),
    indexer: require("../codeIndexer.service"),
    sources: require("../../codeIntel/extract/fileSource"),
    search: require("../codeSearch.service"),
    chat: require("../codeChat.service"),
    answer: require("../../llmServices/generateCodeAnswer").generateCodeAnswer as jest.Mock,
    loop: require("../../llmServices/runCodeAgent").runToolLoop as jest.Mock,
  });

  /** The bot this suite pretends to have: owner can view, stranger cannot. */
  const bot = {
    botId: BOT,
    botType: "Code_Interpreter",
    owner: { email: owner.email },
    botUsers: { users: [owner.email] },
    publicAccess: false,
    instruction: "Be brief.",
    baseModel: { name: "test-chat", meta: { contextWindow: "8192" } },
    codeConfig: { embedModel: "test-embed", embedDim: DIM, embedType: "vector" },
  };

  let searchService: CodeSearchServiceType;
  let chatService: CodeChatServiceType;

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

    const embed = require("../../llmServices/generateCodeEmbeddings").generateCodeEmbeddings as jest.Mock;
    embed.mockImplementation(async ({ texts }: { texts: string[] }) => texts.map(bagOfWords));

    const { graph, indexer, sources, search, chat } = mods();
    await graph.CodeGraphService.dropBotTables({ botId: BOT });
    await graph.CodeGraphService.createBotTables({ botId: BOT, embedDim: DIM, embedType: "vector" });

    const source = await sources.DirectorySource.open({ root: "sample-mern", allowedRoot: FIXTURES });
    await indexer.indexRepository({
      botId: BOT,
      codeConfig: bot.codeConfig,
      baseModel: "test-chat",
      repoName: "shop",
      sourceType: "path",
      sourceRef: FIXTURES,
      source,
      summarize: false,
      limits: { maxFiles: 1000, maxFileBytes: 1 << 20 },
      excludeGlobs: [],
      concurrency: 2,
      maxChunkTokens: 800,
      numCtx: 8192,
    });

    searchService = new search.CodeSearchService();
    chatService = new chat.CodeChatService();
    // Both services reach the bot through CodeIndexService.authorize.
    const authorize = jest.fn(async ({ actor, tier }: { actor: { email: string }; tier: string }) => {
      const { ForbiddenError } = require("../../util/botAccess");
      const allowed = actor.email === owner.email;
      if (!allowed) throw new ForbiddenError();
      void tier;
      return { bot, codeConfig: bot.codeConfig };
    });
    // A stand-in for the Mongo lookup: the bot document is not what these tests exercise.
    const stub = authorize as unknown as CodeSearchServiceType["indexService"]["authorize"];
    searchService.indexService.authorize = stub;
    chatService.indexService.authorize = stub;
    chatService.searchService.indexService.authorize = stub;
  });

  afterAll(async () => {
    await mods().graph.CodeGraphService.dropBotTables({ botId: BOT });
    await require("../../db/pgsql").closePostgres();
    require("../../codeIntel/parse/treesitter").disposeParsers();
    await pool?.end();
  });

  const search = (query: string, extra: Record<string, unknown> = {}) =>
    searchService.search({ botId: BOT, actor: owner, query, ...extra });
  const names = (hits: SearchHit[]) => hits.map((h) => h.name);

  describe("hybrid search", () => {
    it("finds the hook and the route for a natural-language question", async () => {
      const { hits, queryType } = await search("fetch the users list");
      expect(queryType).toBe("conceptual");
      // Both ends of the feature are found. Exact ranking is not asserted here:
      // the embedding is a bag-of-words stand-in, so it cannot demonstrate the
      // semantic ordering a real model gives (see eval/ for that).
      expect(names(hits).slice(0, 5)).toEqual(expect.arrayContaining(["route:GET /api/users"]));
      expect(names(hits)).toEqual(expect.arrayContaining(["useUsers"]));
    });

    it("puts an exact symbol first when the query is that symbol", async () => {
      const { hits, queryType } = await search("getUserById");
      expect(queryType).toBe("symbol");
      expect(hits[0].name).toBe("getUserById");
      expect(hits[0].matchedBy.map((m) => m.source)).toEqual(expect.arrayContaining(["trigram"]));
    });

    it("still finds a symbol that is slightly misspelled", async () => {
      const { hits } = await search("getUserByID");
      expect(names(hits)).toContain("getUserById");
    });

    it("walks the graph from a flow question so the answer reaches the service", async () => {
      const { hits, queryType } = await search("what happens when the users page loads");
      expect(queryType).toBe("flow");
      // The whole chain has to come back, or the answer cannot describe what
      // happens: page → hook → HTTP route → controller → service.
      expect(names(hits)).toEqual(
        expect.arrayContaining(["UsersPage", "useUsers", "route:GET /api/users", "listUsers", "findAll"]),
      );

      // In this fixture almost every unit also matches the query directly, so
      // `viaEdge` (set only for units *nothing* matched) may be empty. Check
      // the walk itself to prove expansion is what reaches the service.
      const graph = require("../codeGraph.service").CodeGraphService;
      const walked = await graph.expandGraph({
        botId: BOT,
        uids: ["shop:src/pages/UsersPage.tsx#UsersPage"],
        types: ["calls", "calls_api", "handles_route", "renders", "uses_hook"],
        depth: 4,
        direction: "out",
        limit: 40,
      });
      expect(walked.map((w: { uid: string }) => w.uid.split("#").pop())).toEqual(
        expect.arrayContaining(["useUsers", "route:GET /api/users", "listUsers", "findAll"]),
      );
    });

    it("walks backwards for an impact question", async () => {
      const { hits, queryType } = await search("what breaks if I change findAll");
      expect(queryType).toBe("impact");
      expect(names(hits)).toEqual(expect.arrayContaining(["findAll"]));
      // listUsers calls findAll, so it is what would break.
      expect(names(hits)).toEqual(expect.arrayContaining(["listUsers"]));
    });

    it("applies kind and path filters", async () => {
      const routes = await search("users", { kind: "route" });
      expect(routes.hits.every((h) => h.kind === "route")).toBe(true);
      const frontend = await search("users", { pathPrefix: "src/" });
      expect(frontend.hits.every((h) => h.path.startsWith("src/"))).toBe(true);
    });

    it("returns every hit with the file and lines needed to cite it", async () => {
      const { hits } = await search("create a user");
      expect(hits.length).toBeGreaterThan(0);
      for (const hit of hits) {
        expect(hit.path).toBeTruthy();
        expect(hit.repo).toBe("shop");
        expect(hit.startLine).toBeGreaterThan(0);
        expect(hit.endLine).toBeGreaterThanOrEqual(hit.startLine);
      }
    });

    it("refuses a caller who cannot view the bot, and an empty query", async () => {
      await expect(searchService.search({ botId: BOT, actor: stranger, query: "users" })).rejects.toMatchObject({ name: "ForbiddenError" });
      await expect(search("   ")).rejects.toMatchObject({ status: 400 });
    });
  });

  describe("agent tools", () => {
    const run = (tool: string, args: Record<string, unknown>) =>
      chatService.runTool({ botId: BOT, actor: owner, call: { tool, arguments: args } });

    it("search_code returns citable units", async () => {
      const result = (await run("search_code", { query: "list users", limit: 5 })) as { path: string; lines: string }[];
      expect(result.length).toBeGreaterThan(0);
      expect(result[0]).toHaveProperty("uid");
      expect(result[0].lines).toMatch(/^\d+-\d+$/);
    });

    it("find_symbol, get_unit and read_file agree on where the code is", async () => {
      const found = (await run("find_symbol", { name: "findAll" })) as { uid: string; path: string; name: string }[];
      expect(found[0].uid).toBeTruthy();
      const unit = (await run("get_unit", { uid: found[0].uid })) as { code: string; path: string; lines: string };
      expect(unit.code).toContain("User.find()");
      const [start, end] = unit.lines.split("-").map(Number);
      const slice = (await run("read_file", { path: unit.path, start_line: start, end_line: end })) as { content: string };
      expect(slice.content).toContain("User.find()");
    });

    it("get_callers and get_callees follow the graph in both directions", async () => {
      const [service] = (await run("find_symbol", { name: "findAll" })) as { uid: string }[];
      const callers = (await run("get_callers", { uid: service.uid })) as { name: string | null }[];
      expect(callers.map((c) => c.name)).toContain("listUsers");
      const [controller] = (await run("find_symbol", { name: "listUsers" })) as { uid: string }[];
      const callees = (await run("get_callees", { uid: controller.uid })) as { name: string | null }[];
      expect(callees.map((c) => c.name)).toContain("findAll");
    });

    it("list_routes reports the endpoints and their handlers", async () => {
      const routes = (await run("list_routes", {})) as { method: string; path: string; handlerUid: string | null }[];
      expect(routes.map((r) => `${r.method} ${r.path}`).sort()).toEqual(["GET /api/users", "POST /api/users"]);
      expect(routes.every((r) => r.handlerUid)).toBe(true);
      const filtered = (await run("list_routes", { method: "post" })) as unknown[];
      expect(filtered).toHaveLength(1);
    });

    it("trace_feature follows the page all the way to the service", async () => {
      const [page] = (await run("find_symbol", { name: "UsersPage" })) as { uid: string }[];
      const traced = (await run("trace_feature", { uid: page.uid })) as { chain: { name: string; via: string }[] };
      const chain = traced.chain.map((c) => c.name);
      expect(chain).toEqual(expect.arrayContaining(["useUsers", "route:GET /api/users", "listUsers", "findAll"]));
      expect(traced.chain.find((c) => c.name === "route:GET /api/users")?.via).toBe("calls_api");
    });

    it("reports a clear error for an unknown tool, unit or file", async () => {
      await expect(run("nope", {})).rejects.toMatchObject({ status: 400 });
      await expect(run("get_unit", { uid: "shop:nope.ts#nothing" })).rejects.toMatchObject({ status: 404 });
      await expect(run("read_file", { path: "nope.ts" })).rejects.toMatchObject({ status: 404 });
      await expect(run("get_summary", { path: "src" })).rejects.toMatchObject({ status: 404 });
    });

    it("refuses every tool for a caller without access", async () => {
      for (const tool of ["search_code", "find_symbol", "list_routes", "read_file"]) {
        await expect(
          chatService.runTool({ botId: BOT, actor: stranger, call: { tool, arguments: { query: "x", name: "x", path: "server.js" } } }),
        ).rejects.toMatchObject({ name: "ForbiddenError" });
      }
    });
  });

  describe("chat", () => {
    it("answers with the retrieved code and returns citations for it", async () => {
      const { answer } = mods();
      answer.mockResolvedValue("Users are listed by `findAll` (services/userService.js:5-7).");
      const result = await chatService.answer({ botId: BOT, actor: owner, question: "how are users listed?" });

      expect(result.mode).toBe("answer");
      expect(result.citations.length).toBeGreaterThan(0);
      expect(result.usedUnits).toBe(result.citations.length);
      for (const citation of result.citations) {
        expect(citation.path).toBeTruthy();
        expect(citation.startLine).toBeGreaterThan(0);
      }
      // The prompt carried real code and the citation format the answer must use.
      const call = answer.mock.calls.at(-1)![0];
      expect(call.context).toContain("// services/userService.js:");
      expect(call.numCtx).toBe(8192);
      expect(call.instruction).toBe("Be brief.");
    });

    it("passes num_ctx so Ollama does not silently truncate the context", async () => {
      const { answer } = mods();
      answer.mockResolvedValue("ok");
      await chatService.answer({ botId: BOT, actor: owner, question: "what does the user service do?" });
      expect(answer.mock.calls.at(-1)![0].numCtx).toBeGreaterThan(0);
    });

    it("runs the tool loop in agent mode and cites what the tools returned", async () => {
      const { loop } = mods();
      loop.mockImplementation(async ({ runTool }: { runTool: (c: { tool: string; arguments: Record<string, unknown> }) => Promise<unknown> }) => {
        await runTool({ tool: "search_code", arguments: { query: "users page" } });
        await runTool({ tool: "list_routes", arguments: {} });
        return { answer: "The page loads users from GET /api/users (routes/users.js:6-6).", calls: [{ tool: "search_code", arguments: {} }, { tool: "list_routes", arguments: {} }] };
      });

      const result = await chatService.answer({ botId: BOT, actor: owner, question: "what happens when the users page loads?", mode: "agent" });
      expect(result.mode).toBe("agent");
      expect(result.toolCalls?.map((c) => c.tool)).toEqual(["search_code", "list_routes"]);
      expect(result.citations.length).toBeGreaterThan(0);
      // citations are unique
      expect(new Set(result.citations.map((c) => c.uid)).size).toBe(result.citations.length);
      expect(loop.mock.calls.at(-1)![0].maxCalls).toBe(10);
    });

    it("refuses an empty question and a caller without access", async () => {
      await expect(chatService.answer({ botId: BOT, actor: owner, question: "  " })).rejects.toMatchObject({ status: 400 });
      await expect(chatService.answer({ botId: BOT, actor: stranger, question: "hi" })).rejects.toMatchObject({ name: "ForbiddenError" });
    });
  });
});
