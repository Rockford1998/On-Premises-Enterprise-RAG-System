# Code Interpreter Bot — Implementation Plan

> **For Claude Code:** Implement **one phase at a time, in order**. At the end of each phase run its acceptance checks plus `npm run build`, `npm run lint` and `npm test` in `server/`. Do not start the next phase until they pass. If this plan conflicts with what you find in the codebase, stop and ask rather than guess. Read [ARCHITECTURE.md](ARCHITECTURE.md) and the conventions in [CLAUDE.md](../CLAUDE.md) first — this plan was written against them.
>
> Keep all language- and framework-specific logic inside `codeIntel/adapters/`. Core, storage and retrieval must never import a language-specific module.

> **Status: Phases 1–8 implemented and verified.** Phase 9 (Java/Spring, C#/ASP.NET) is not started — the grammars for both already ship with the parser, so it is adapter work only.
>
> Verified on 2026-09-22 against the real stack (server, Mongo, Postgres 17 + pgvector 0.8, Ollama with `qwen3-embedding:4b` and `gpt-oss:120b-cloud`):
> - **411 unit and integration tests**, 26 suites. DB-backed suites are skipped unless `TEST_DATABASE_URL` is set.
> - **49/49 end-to-end HTTP checks**: bot creation → zip upload → indexing → search → tools → chat → deletion, with authorization and rejection cases.
> - **Retrieval eval** on the fixture: recall@10 **1.000**, recall@5 0.938, MRR 0.809 (`npm run code:eval -- --bot <botId>`). The fixture is 12 files, so treat these as an upper bound; run the eval against a real repository before trusting the numbers.
>
> **Deviations from the plan as written**, all deliberate:
> - `LanguageAdapter.parse` takes `{ file, repo }` (unit ids need the repository name), and `ParseResult` carries an optional `tree` so framework adapters enrich without re-parsing.
> - Parsing runs in **two passes** over the trees. An Express route's full path and a React route's component both live in a *different file* from the thing they describe, so every mount and client route must be known before any unit is built.
> - Graph expansion **scores** rather than reserves slots: a unit reachable from a top match gets a bonus that decays with distance. Flow expansion is 4 hops, not 3 — page → hook → HTTP call → route → handler → service is genuinely that long.
> - `rerank.ts` was not built. The no-op was the default anyway, and the eval hits its target without it; adding an LLM rerank would cost a model call per query for no measured gain.
> - Incremental indexing is by content hash on every run (Phase 8), so there is no separate "update" endpoint — re-uploading a repository *is* the update, and re-embeds only what changed.
>
> **Pre-existing bugs found and fixed along the way** (all in shared code, not just the new flow):
> - Mongo schema indexes were **never built on a fresh database** — `bufferCommands` is off and models compile before `connect()`, so mongoose's automatic build failed silently. That included the unique `user.email` index. Fixed by `ensureIndexes()` in `db/mongo.ts`.
> - `CREATE EXTENSION IF NOT EXISTS` is not atomic; two servers starting against one fresh database could crash on the unique violation. Both call sites now tolerate it.
> - The `ignore` dependency added in Phase 2 conflicted with langchain's peer range and would have broken `npm install`; pinned to v5. Phase 1: bot type, config, per-bot tables, embedding probe, run model + sweep, core types/ids/registry, fixture, CI, client stubs. Phase 2: `FileSource` (zip + allow-listed directory), walker, classifier, repo context, `codeUpload` middleware (not yet routed — Phase 5). Phases 3–9 not started. The dev machine uses `qwen3-embedding:4b` (set `CODE_EMBEDDING_MODEL`; 2560 dims → `halfvec`).
>
> Phase 2 decisions worth knowing: skipped files are *reported with a reason* rather than silently dropped; the walker never imports an adapter (language comes from an injected lookup, defaulting to the registry); `.gitignore` nesting follows git semantics (deeper file wins, `!negation` re-includes); tsconfig `extends` chains and monorepo alias collisions are handled (one alias can map to several folders); `RepoContext` gained an optional `workspaces` field and `FileSource` gained `rejected`; a new `CODE_MAX_UNCOMPRESSED_BYTES` guards against zip bombs.

---

## 0. What this is

A new bot type, **`Code_Interpreter`**. A user creates one like any other bot, attaches one or more source repositories (zip upload first), and chats with it. The pipeline indexes the code into the existing Postgres/pgvector so the local Ollama model can answer questions about the codebase with `path:line` citations.

"Interpreter" means *reads and explains* code. It never executes it. Nothing in this plan runs user code.

**Separate integration, own flow.** Bots are still created through `POST /bots` (so ownership, sharing and the bot list keep working), but from that point the type has its own tables, its own endpoints under `/code/:botId/*`, its own chat endpoint and its own UI. The existing `/chat`, `/kb/*` and `/tools/*` paths are not extended — `/chat` only gains a guard that rejects this bot type.

### Constraints inherited from the current system

- Everything is on-prem: chat, embeddings and summaries all go through the local Ollama. **No external LLM/embedding providers.**
- Postgres + pgvector is the only new store; MongoDB keeps bots, users and run/status records, as it does today.
- One Express process. There is **no job queue**; long work is fire-and-forget with a status document (the Drive-sync pattern, [§4.1 of ARCHITECTURE.md](ARCHITECTURE.md)).
- Server is CommonJS (`module: commonjs`, ES2020). ESM-only dependencies will not import — check before adding any.
- Authorization exists ([§8.2](ARCHITECTURE.md)); source code is sensitive, so every new endpoint uses it.

### Targets

- **First:** Node.js (Express/NestJS) backend and React frontend, JS and TS.
- **Later:** Spring Boot (Java) and .NET (C#), addable by writing adapters only.

### Non-goals

- Executing code, sandboxes, or shell access.
- Fine-tuning; file watching; a standalone CLI/package (the existing server and client are the product surface).
- Fixing the unrelated `/chat` authorization gap. The code chat endpoint is new and is authorised from day one.

---

## 1. What changed from the original plan, and why

| Original | Now | Reason |
|---|---|---|
| Standalone `code-intel/` package, `cli.ts`, own `api/server.ts` | Module at `server/src/codeIntel/` + service/controller/routes in the existing layers | One deployable; CLAUDE.md layering (`controller → service → model`) |
| Global `repos/files/code_units/edges/embeddings` tables | **Six tables per bot**, `code_<botId>_repos/files/modules/units/edges/embeddings`, created on bot create and dropped on bot delete | Table-per-bot is this repo's isolation boundary (`vector_table_<botId>`); same rule, same lifecycle |
| Fixed embedding dimension | Per-bot dimension, probed from the embedding model at bot creation | A code-suited model has a different size than the KB's 768 |
| `/ask`, CLI | Own `POST /code/:botId/chat` and UI route; `/chat` untouched except a guard | Own flow; nothing shared with the KB path to break |
| `migrations/*.sql` + `migrate.ts` | Idempotent `CodeGraphService.createBotTables()` at bot creation (+ `ensureCodeIntelExtensions()` at startup) | The repo has no migration runner; per-bot tables are created on demand |
| `db/repositories/*` with raw SQL | New `services/codeGraph.service.ts` (+ small additions to `VectorService`) | CLAUDE.md: raw SQL lives in a service, parameterised, via `db/pgsql.ts` |
| `zod` config, `dotenv`, `pg` Pool | `config/env.ts` helpers, `query/withClient/withTransaction` | zod is not a dependency; never call `pool.connect()` directly |
| Provider interfaces, API keys, OpenAI-style providers, "never send to external model" | Functions in `llmServices/` taking a model name from the bot | All inference is local Ollama; model names are never hard-coded |
| `vitest` | **Jest** (`__tests__/*.test.ts`) | What the server already uses |
| Fake providers with call counters | `jest.mock` on `llmServices/*` with counters | Same effect, no new abstraction |
| `p-limit` | Tiny in-repo limiter (or `p-limit@3`) | `p-limit` ≥4 is ESM-only |
| `index_runs` in Postgres | `CodeIndexRun` in Mongo (`shared.model.ts`) | Status/log documents already live there; the UI polls them |
| Git commit diff drives incremental | **Content-hash diff** drives incremental; git optional | Zip uploads have no git history |
| Summaries mandatory, bottom-up | Summaries **opt-in**, off by default | Local 7B model over thousands of units is hours; retrieval must work without them |
| `read_file` reads from disk | `read_file` reads the stored file content (files table) | Deterministic, no path traversal, survives upload-dir cleanup |
| Agent tools at `/tools/*` | `/code/:botId/tools/*` | `/tools/:id` is the existing Tools CRUD; it would collide |
| Post-commit hook + CI job | Deferred | No non-interactive credential exists (15-min access token, httpOnly refresh cookie) |
| CLI-only UI | Small client UI (create option, Source tab, citations in chat) | It is a bot type in the product now |

---

## 2. Decisions (confirmed)

1. **Separate flow.** Own endpoints, chat, services and UI (§0).
2. **Separate tables per bot.** No `bot_id` column; isolation is the table set itself. Names come from one helper, `codeTables(botId)`, which validates `botId` against `^bot_[A-Za-z0-9_]+$`, builds the names, and asserts each is ≤ 63 characters (Postgres silently truncates longer identifiers, which could make two bots collide). Names derive from the server-generated `botId`, never from a request body.
3. **SQL lives in a new `CodeGraphService`.** Update CLAUDE.md: "All raw SQL belongs in `VectorService` (KB vectors) or `CodeGraphService` (code-intel tables). Table names come from `bot.vectorTable` or `codeTables(botId)` and pass `assertSafeIdentifier`."
4. **One bot ↔ many repos.** A React frontend and a Node backend are usually separate repos; cross-layer `calls_api` linking works across all repos in the bot.
5. **Sources, in order:** zip upload → server-local path under an allow-listed `CODE_REPOS_ROOT` → git clone.
6. **Summaries off by default** (`CODE_SUMMARIZE=false`).
7. **Embedding dimension follows the model.** Default model **`qwen3-embedding:0.6b`** (1024 dims, strong on code retrieval, long context). The dimension is **probed** at bot creation by embedding a test string and measuring the vector, then stored on the bot as `codeConfig.embedDim` / `embedType`, so table DDL and queries can never disagree with the model.
   - Up to 2000 dims: `vector` + HNSW. Above 2000 (e.g. `qwen3-embedding:4b`, 2560): `halfvec` + `halfvec_cosine_ops` (HNSW limit 4000).
   - The model must be registered as an `llmModel` with `modelType: "embedding"` (same rule the KB path uses) and pulled in Ollama — verify `ollama pull qwen3-embedding:0.6b` in Phase 1. If it is unavailable, `nomic-embed-text` (768) is the fallback and needs no other change.
   - Switching a bot's model later means dropping and rebuilding its embeddings table (a full re-embed). Bots can differ from each other.

---

## 3. Architecture

```
 zip / path ─▶ EXTRACT ─────▶ TRANSFORM ──────────────────────▶ LOAD (per file, one tx)
              FileSource     parse (web-tree-sitter)             code_<botId>_files / _units /
              walk+hash      language adapter → symbols          _edges / _embeddings
              classify       framework adapter → routes,         (per-bot tables)
                             components, api calls
                             link edges (cross-layer)
                             chunk + context header
                             embed (Ollama /api/embed, bot's own model + dimension)
                             [opt-in] summarize (bot.baseModel)

 POST /code/:botId/chat            (own endpoint; /chat is not involved)
   └▶ CodeChatService: classify → hybrid (vector + FTS + trigram) → RRF → graph expand
      → [optional rerank] → context builder (path:line) → generateCodeAnswer (num_ctx set)
   └▶ mode:"agent" → tool loop over the same handlers as /code/:botId/tools/* (max 10 calls)
```

Indexing runs in-process, fire-and-forget, tracked by a `CodeIndexRun` document. Parsing is CPU-bound and shares the event loop with the API — see Risks.

---

## 4. Project layout

```
server/
├── src/
│   ├── config/env.ts                    # + codeIntel block (§Phase 1)
│   ├── db/init.ts                       # + ensureCodeIntelExtensions() (soft-fail)
│   ├── models/shared.model.ts           # + botType value, CodeIndexRun schema
│   ├── routes/app.routes.ts             # + "Code interpreter" block
│   ├── controller/
│   │   ├── codeRepo.controller.ts       # repos, index/update runs, run status
│   │   └── codeChat.controller.ts       # /code/:botId/chat, /search, /tools/:name
│   ├── services/                        # no req/res; every method takes an actor
│   │   ├── codeIndex.service.ts         # authz, source intake, run lifecycle, orchestration
│   │   ├── codeSearch.service.ts        # search + tool handlers (authz, then retrieval)
│   │   ├── codeChat.service.ts          # answer / agent loop glue
│   │   └── codeGraph.service.ts         # ALL SQL for code_<botId>_* tables + codeTables(botId)
│   ├── llmServices/
│   │   ├── generateCodeEmbeddings.ts    # batch via /api/embed; model, prefixes, dim probe;
│   │   │                                # the KB's generateEmbedding.ts is NOT modified
│   │   ├── generateCodeAnswer.ts        # sets options.num_ctx
│   │   ├── generateSummary.ts           # opt-in summaries
│   │   └── runCodeAgent.ts              # tool-use loop
│   ├── middlewares/uploadMiddleware.ts  # + codeUpload (bigger limit, zip only)
│   └── codeIntel/                       # pure modules: no req/res, no mongoose, no SQL
│       ├── core/        types.ts  ids.ts  registry.ts
│       ├── extract/     fileSource.ts (Zip/Directory)  walker.ts  classify.ts  repoContext.ts
│       ├── parse/       treesitter.ts
│       ├── adapters/
│       │   ├── languages/   typescript.ts  java.ts (P9)  csharp.ts (P9)
│       │   └── frameworks/  express.ts  nestjs.ts  react.ts  spring.ts (P9)  aspnet.ts (P9)
│       ├── transform/   chunker.ts  contextHeader.ts  linker.ts  summarizer.ts
│       ├── retrieve/    queryClassifier.ts  rrf.ts  graphExpand.ts  rerank.ts  contextBuilder.ts
│       └── agent/       tools.ts     # tool JSON schemas + name → handler map
├── test-fixtures/sample-mern/           # OUTSIDE src/: tsconfig compiles src/**, eslint lints src/**
├── eval/                                # questions.json, runEval.ts, results/ (gitignored)
└── Endpoints/code.http                  # keep in sync with routes
client/app/src/routes/(app)/(agents)/-tabs/TabCodeSources.tsx
client/app/src/routes/(app)/(code)/code-chat.$botId.tsx      # own chat route (+ -components/)
```

Tests live in `codeIntel/**/__tests__/*.test.ts` (matches `jest.config.js`). Fixtures stay outside `src/` because `tsconfig.json` has `rootDir: ./src` and no `jsx` setting.

### Dependencies

Add: `web-tree-sitter` + WASM grammars (`tree-sitter-wasms` or vendored under `server/assets/grammars/`), `ignore`, `simple-git` (Phase 8). Already present and reused: `adm-zip`, `pg`, `pgvector`, `axios`, `multer`.
**Verify each is CommonJS-loadable in a spike before building on it** — especially `web-tree-sitter` (pin a version that ships a CJS entry). Do not add `zod`, `dotenv`, `commander`, `fastify`, `vitest`.

---

## 5. Data model

### 5.1 Postgres — per-bot tables

`CodeGraphService.createBotTables({ botId, embedDim, embedType })` runs when a Code_Interpreter bot is created; `dropBotTables({ botId })` when it is deleted. Both are idempotent (`IF NOT EXISTS` / `DROP … IF EXISTS … CASCADE`) and run in one `withTransaction`, like `createTableWithIndex`. `ensureCodeIntelExtensions()` (called from `db/init.ts`, **soft-fail**: log and continue) creates `pg_trgm` once; the create-bot path re-runs it and returns 400 with the reason if it still fails, so a deployment that never uses this type is not blocked. `pgvector/pgvector:0.8.0-pg17` ships contrib — confirm in Phase 1.

`codeTables(botId)` returns `{ repos, files, modules, units, edges, embeddings }` = `code_<botId>_repos` etc. Below `T` stands for the bot's table set, e.g. `code_bot_lk3f_AB12CD_units`. Isolation is the table itself — there is no `bot_id` column.

```sql
CREATE TABLE T.repos (
  id           BIGSERIAL PRIMARY KEY,
  name         TEXT NOT NULL UNIQUE,
  source_type  TEXT NOT NULL,                    -- zip | path | git
  source_ref   TEXT,                             -- path under CODE_REPOS_ROOT or git URL; null for zip
  last_commit  TEXT,
  summary      TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE T.files (
  id            BIGSERIAL PRIMARY KEY,
  repo_id       BIGINT NOT NULL REFERENCES T.repos(id) ON DELETE CASCADE,
  path          TEXT NOT NULL,                   -- repo-relative, forward slashes
  language      TEXT,
  category      TEXT NOT NULL,                   -- source|test|config|docs|schema|generated
  content       TEXT NOT NULL,                   -- stored so read_file / incremental need no disk
  content_hash  TEXT NOT NULL,                   -- sha256
  line_count    INT NOT NULL,
  summary       TEXT,
  indexed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (repo_id, path)
);

CREATE TABLE T.modules (
  id       BIGSERIAL PRIMARY KEY,
  repo_id  BIGINT NOT NULL REFERENCES T.repos(id) ON DELETE CASCADE,
  path     TEXT NOT NULL,                        -- '' = repo root
  summary  TEXT,
  UNIQUE (repo_id, path)
);

CREATE TABLE T.units (
  id             BIGSERIAL PRIMARY KEY,          -- internal; stable across re-index (upsert by uid)
  repo_id        BIGINT NOT NULL REFERENCES T.repos(id) ON DELETE CASCADE,
  file_id        BIGINT NOT NULL REFERENCES T.files(id) ON DELETE CASCADE,
  uid            TEXT NOT NULL UNIQUE,           -- stable id, §6.3
  parent_id      BIGINT REFERENCES T.units(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL,
  name           TEXT NOT NULL,
  qualified_name TEXT NOT NULL,
  signature      TEXT,
  code           TEXT NOT NULL,
  start_line     INT NOT NULL,
  end_line       INT NOT NULL,
  docstring      TEXT,
  summary        TEXT,
  exported       BOOLEAN NOT NULL DEFAULT false,
  metadata       JSONB NOT NULL DEFAULT '{}',
  content_hash   TEXT NOT NULL,                  -- hash of code; skips re-summarise/re-embed
  search_text    TEXT NOT NULL,                  -- identifiers split camel/snake + docstring + summary
  search_tsv     TSVECTOR GENERATED ALWAYS AS (to_tsvector('simple', search_text)) STORED
);

CREATE TABLE T.edges (
  id          BIGSERIAL PRIMARY KEY,
  repo_id     BIGINT NOT NULL REFERENCES T.repos(id) ON DELETE CASCADE,
  from_id     BIGINT NOT NULL REFERENCES T.units(id) ON DELETE CASCADE,
  to_id       BIGINT REFERENCES T.units(id) ON DELETE CASCADE,     -- null when unresolved
  to_external TEXT,                              -- 'npm:axios' or an unresolved symbol name
  type        TEXT NOT NULL,                     -- imports|calls|renders|handles_route|calls_api|uses_entity|extends|implements|uses_hook
  metadata    JSONB NOT NULL DEFAULT '{}',
  CHECK (to_id IS NOT NULL OR to_external IS NOT NULL)
);

-- Embeddings are their own table so the dimension is per bot.
-- {{DIM}} = codeConfig.embedDim; {{VEC}} = 'vector' (dim <= 2000) or 'halfvec' (dim <= 4000).
CREATE TABLE T.embeddings (
  uid           TEXT PRIMARY KEY,                -- unit uid, or 'file:<repo>:<path>' / 'module:…' / 'repo:<repo>'
  unit_type     TEXT NOT NULL,                   -- code|file_summary|module_summary|repo_summary
  repo_id       BIGINT NOT NULL REFERENCES T.repos(id) ON DELETE CASCADE,
  model         TEXT NOT NULL,
  content_hash  TEXT NOT NULL,                   -- hash of the embedded text
  embedding     {{VEC}}({{DIM}}) NOT NULL
);
```

Indexes (all named, `IF NOT EXISTS`): `units(kind)`, `units(file_id)`, GIN `units(search_tsv)`, GIN `units(name gin_trgm_ops)`, GIN `units(qualified_name gin_trgm_ops)`, GIN `units(metadata jsonb_path_ops)`, `edges(from_id, type)`, `edges(to_id, type)`, `edges(type)`, `embeddings(repo_id, unit_type)`, and HNSW on `embeddings(embedding {{VEC}}_cosine_ops)` with `m = 16, ef_construction = 200` (same tuning as the KB tables). Vector search sets `hnsw.ef_search` with `SET LOCAL` inside a transaction on the same client, as `VectorService.searchVectors` does.

Because units, edges and embeddings are all in Postgres, a file's rows are written in **one `withTransaction`** — the cross-store atomicity gap the KB path has does not apply.

`VectorService` and the KB `vector_table_<botId>` are **not touched**. Code_Interpreter bots do not get a KB vector table (`BotController.create` skips it for this type — Phase 1).

`search_text` must contain identifiers split into words (`getUserById` → `get user by id getUserById`) so full-text search can match natural language against names.

### 5.2 Mongo — `CodeIndexRun` (in `shared.model.ts`)

```ts
{ botId, repoName, mode: "full"|"incremental", status: "running"|"completed"|"partial"|"failed",
  startedAt, finishedAt, triggeredBy,
  stats: { files, skipped, units, edges, embedded, summarized, embedCalls, llmCalls, phaseMs: {...} },
  fileErrors: [{ path, reason }], error }
// indexes: { botId: 1, createdAt: -1 }
//          { botId: 1 } unique, partialFilterExpression: { status: "running" }
```

The **partial unique index is the concurrency guard** — atomic, unlike the find-then-create the Drive sync uses. Also add a **startup sweep** that marks leftover `running` runs `failed` ("server restarted"), since a crash otherwise leaves the guard stuck.

### 5.3 Bot type

`botType` in `shared.model.ts` becomes `["General_Purpose", "KB_Bot", "Code_Interpreter"]` (also served by `GET /metadata/bot-type`).

`botProfileSchema` gains an optional `codeConfig: { embedModel, embedDim, embedType: "vector"|"halfvec" }`, written once at creation from the probed model. Every code query reads the dimension and model from here, never from env.

---

## 6. Core contracts (`codeIntel/core`)

Unchanged from the original plan except where noted. Adapters produce only these types.

### 6.1 Data types

```ts
export type UnitKind =
  | "function" | "method" | "class" | "component" | "hook" | "route"
  | "entity" | "interface" | "type" | "config" | "file";

export type EdgeType =
  | "imports" | "calls" | "renders" | "handles_route" | "calls_api"
  | "uses_entity" | "extends" | "implements" | "uses_hook";

export interface FileRecord {
  path: string;                 // repo-relative, forward slashes
  language: string | null;
  category: "source" | "test" | "config" | "docs" | "schema" | "generated";
  content: string;
  contentHash: string;
  lineCount: number;
  // no absPath: files may come from a zip and never exist on disk
}

export interface CodeUnit {
  uid: string; path: string; parentUid?: string;
  kind: UnitKind; name: string; qualifiedName: string; signature?: string;
  code: string; startLine: number; endLine: number;   // 1-based, inclusive
  docstring?: string; exported: boolean; metadata: Record<string, unknown>;
}

export interface RawReference {
  fromUid: string; type: EdgeType;
  target:
    | { kind: "import"; specifier: string; importedName?: string }
    | { kind: "symbol"; name: string }
    | { kind: "api"; method: string; path: string }
    | { kind: "route"; method: string; path: string };
  metadata?: Record<string, unknown>;
}

export interface ParseResult { units: CodeUnit[]; references: RawReference[]; }
```

### 6.2 Adapter interfaces

Same as the original (`LanguageAdapter`, `FrameworkAdapter`, `RepoContext`), with two changes: `parse`/`enrich` take the `FileRecord` (no disk access), and `RepoContext` is built from the `FileSource` (manifests are read from its files, not `rootPath`). New:

```ts
export interface FileSource {          // extract/fileSource.ts
  list(): AsyncIterable<{ path: string; size: number }>;
  read(path: string): Promise<Buffer>;
}
```

### 6.3 Stable ids

`uid = "<repoName>:<path>#<qualifiedName>"` — routes `#route:GET /api/users/:id`, files `#<file>`; collisions append `@<startLine>`. `uid` is unique within the bot's units table. Loading **upserts by uid** (`ON CONFLICT (uid) DO UPDATE`) so a unit's `id` survives re-indexing and edges pointing at it from *unchanged* files are not cascade-deleted. Units whose uid disappeared from a file are deleted explicitly.

---

## 7. Phases

### Phase 1 — Foundation and bot-type plumbing

1. `botType` gains `Code_Interpreter`; add a `case` in `getBotInstructionByBotRequest.ts` (answer only from retrieved code, cite `path:line`, say "not found in indexed code" otherwise).
2. **Audit every `General_Purpose` check** — several silently treat "not GP" as "KB bot":
   - server: `bot.controller.ts:188` (creates the KB vector table for every non-GP type — **skip it for Code_Interpreter** and call `CodeGraphService.createBotTables` instead, after probing the embedding model and writing `codeConfig`; roll the bot back on failure as the existing catch does), `bot.controller.ts:298` (drops the KB table — also call `dropBotTables`, and remove stored source under `CODE_REPOS_ROOT/<botId>`), `chat.controller.ts:70` (would run KB retrieval against a table that does not exist — add an early `400 "Use /code/:botId/chat"` for this type; that is the only change to `/chat`).
   - client: `TabAgent.tsx` (four checks show Knowledge/Connections tabs — Code_Interpreter gets its own tab set: Details + Sources), `agent-overview.tsx:69` and wherever a bot card links to `chatbox` (link code bots to `code-chat/$botId`), `-CreateBotDialog.tsx` (add the select option; the list is hard-coded, not read from `/metadata/bot-type`).
3. `config/env.ts`: a `codeIntel` block using the existing `optional`/`integer` helpers: `CODE_REPOS_ROOT` (unset = path sources disabled), `CODE_MAX_UPLOAD_BYTES` (default 200 MB), `CODE_MAX_FILES` (20 000), `CODE_MAX_FILE_BYTES` (1 MB), `CODE_MAX_CONCURRENCY` (2), `CODE_MAX_CHUNK_TOKENS` (800), `CODE_EMBEDDING_MODEL` (`qwen3-embedding:0.6b`), `CODE_NUM_CTX` (8192), `CODE_SUMMARIZE` (false), `CODE_EXCLUDE_GLOBS`. All optional with defaults — like Drive config, a deployment that never uses this must still start.
4. `ensureCodeIntelExtensions()` and `CodeGraphService` with `codeTables`, `createBotTables`, `dropBotTables` (§5.1); the embedding-dimension probe in `generateCodeEmbeddings.ts`; `codeConfig` on the bot schema; `CodeIndexRun` model with the partial unique index and startup sweep.
5. `codeIntel/core/{types,ids,registry}.ts`.
6. Fixture `server/test-fixtures/sample-mern/`:
   - Express: `server.js`, `routes/users.js` (GET/POST), `controllers/userController.js`, `services/userService.js`, `models/User.js`
   - React (TSX): `App.tsx` with React Router, `pages/UsersPage.tsx`, `components/UserCard.tsx`, `hooks/useUsers.ts` calling `axios.get('/api/users')`
   - `package.json` (express, react, axios), `tsconfig.json` with `@/*` alias
   - a `.env` file containing a fake secret — used to prove it is never indexed.
7. Test setup: unit tests as `__tests__/*.test.ts`. **DB integration tests** run only when `TEST_DATABASE_URL` is set (skipped otherwise, so `npm test` stays green offline). Add a `pgvector/pgvector:pg17` service container to `.github/workflows/ci.yml` and set that variable.
8. Client: create-dialog option; Code_Interpreter tab set (Details + a stub Sources tab); stub `code-chat.$botId.tsx` route.
9. Update CLAUDE.md's raw-SQL rule now (§2, decision 3), since Phase 1 introduces the service.

**Acceptance**
- Creating a `Code_Interpreter` bot succeeds, creates its six `code_<botId>_*` tables (embedding column sized to the probed dimension: `vector(1024)` for the default model) and **no** `vector_table_<botId>`; `GET /metadata/bot-type` lists it. An unregistered or unpulled embedding model returns 400 naming the model, like the KB path.
- A model over 2000 dims (e.g. `qwen3-embedding:4b`) yields a `halfvec` column and a working HNSW index.
- Table creation is idempotent (run twice); with `pg_trgm` unavailable the server still starts and logs why.
- Two bots' tables are disjoint; deleting one drops only its tables.
- `POST /chat` with a code bot returns 400 pointing at `/code/:botId/chat`.
- The client shows no KB tabs for the new type. Jest, lint, build pass.

---

### Phase 2 — Extract

1. **Do not reuse `extractZipEntries`.** It caps at 500 entries and 2 MB, flattens paths into KB file names, lacks `.prisma/.graphql`, and its allow-list contains **`env`** — it would ingest `.env` secrets. Write `extract/fileSource.ts` instead:
   - `ZipSource`: reads entries **in memory** with `adm-zip` and never writes entries to disk by name (no zip-slip); rejects entry names that are absolute or contain `..`; strips a single top-level folder (GitHub-style archives); enforces `CODE_MAX_FILES` and a total-uncompressed-bytes cap (zip-bomb guard).
   - `DirectorySource`: only under `CODE_REPOS_ROOT`; `realpath` both sides and verify containment; never follow symlinks out.
2. `walker.ts`: honour root and nested `.gitignore` (`ignore` package). Always skip `node_modules`, `dist`, `build`, `.next`, `coverage`, `.git`, lockfiles, `*.min.js`, `*.map`, files over `CODE_MAX_FILE_BYTES`, and binaries (NUL byte).
3. **Secrets:** always skip `.env*` (except `.env.example`), `*.pem`, `*.key`, `id_rsa*`, `*.p12`, `credentials*`, plus `CODE_EXCLUDE_GLOBS`. Stored content is readable by everyone who can view the bot, so this is a storage rule, not just an external-model rule.
4. `classify.ts`: same categories/rules as the original (`test`, `config`, `docs`, `schema`, `generated`, else `source`).
5. `repoContext.ts`: parse `package.json`(s), `tsconfig`/`jsconfig` `paths`, workspaces.
6. Upload route: `codeUpload` in `uploadMiddleware.ts` — a separate multer instance (zip only, `CODE_MAX_UPLOAD_BYTES`), leaving the 25 MB KB uploader untouched. Reuse `handleUploadErrors`.

**Acceptance**
- Walking the fixture returns the expected files and categories, nothing from `node_modules`, **and not the `.env`**.
- `pathAliases` contains `@/*`.
- A zip containing `../evil`, an absolute path, and a symlink-style entry is rejected/skipped with nothing written outside memory; a `DirectorySource` given `../..` throws.

---

### Phase 3 — Parse (TypeScript/JavaScript adapter)

Tasks and acceptance as in the original plan (units for functions, classes/methods, interfaces, types, enums, a per-file unit; JSDoc; `exported`; `imports`/`calls`/`extends`/`implements` references; `resolveImport` with extension/index resolution and tsconfig aliases; parse errors fall back to a single `file` unit and never crash the run). Adjustments:

1. **Start with a spike:** load `web-tree-sitter` and the `javascript`/`typescript`/`tsx` WASM grammars under `ts-node` *and* compiled `node dist/index.js`, from a path that works in both. Decide grammar location and record it. If the CJS load fails, stop and ask.
2. Adapters and the parser are pure: input `FileRecord`, output `ParseResult`. No `fs`.
3. The parse loop yields to the event loop (`setImmediate`) between files so indexing does not starve the API.

**Acceptance:** as original — `userService.js` functions with correct line ranges, `UserCard.tsx` yields a function unit, imports resolve including via `@/`, and a deliberately broken file yields a `file` unit and a logged warning.

---

### Phase 4 — Framework adapters (Express, NestJS, React)

Unchanged from the original plan: Express routes with mount-prefix resolution and `handles_route` references; NestJS `@Controller`/`@Get` routes; React component/hook classification, `renders`/`uses_hook` references, React Router `clientRoute` metadata, and `calls_api` extraction (`fetch`, `axios.*`, `axios.create` instances, template literals → `:param`). Detection reads `RepoContext.manifests` (no disk).

**Acceptance:** fixture yields `GET /api/users` and `POST /api/users` route units with handler references; `UsersPage` is a `component` with `clientRoute: "/users"`; `useUsers` is a `hook` with a `calls_api` reference `GET /api/users`.

---

### Phase 5 — Transform, embed, load, and the indexing run

1. `linker.ts`: as original — imports → target file/named export; calls resolved by local scope, then imports, then unique repo-wide name, else `to_external`; **cross-layer** `calls_api` ↔ `route` matching by normalised path (strip base URL; `:param`, `{param}`, `${…}` are wildcards). Matching is **bot-wide**, across repos.
2. `chunker.ts` and `contextHeader.ts`: as original (one chunk per unit; oversize units split at statement boundaries with `#part<n>`; header with repo/file/kind/symbol/route/summary/imports). Token count is approximated as `chars / 3.5` — there is no tokenizer.
3. **Embeddings** (`llmServices/`):
   - The KB's `generateEmbedding` lowercases and strips everything except `\w\s.-`, which destroys code (`::`, `()`, `/`, casing). The code flow therefore has its own `generateCodeEmbeddings.ts` and **never calls it**; `generateEmbedding.ts` stays as is. Text is embedded verbatim.
   - `generateCodeEmbeddings({ texts, model, role })` uses Ollama `/api/embed` (batched); confirm the installed Ollama supports it, else fall back to per-text calls. `role` is `"document"` or `"query"`, and a small per-model-family map applies the model's expected convention (Qwen3-Embedding: raw documents, queries wrapped as `Instruct: <task>\nQuery: <q>`; nomic: `search_document: ` / `search_query: `). Documents and queries must use matching conventions or distances are meaningless.
   - `probeEmbeddingDimension({ model })` embeds a short string and returns the vector length; Phase 1 uses it to choose `vector` vs `halfvec` and the column size.
   - Model name and dimension come from `bot.codeConfig` (the KB code reads a global env var instead — do not copy that). Vectors are L2-normalised before insert, as the KB path does.
   - Retry with `util/retry` and a `shouldRetry` predicate (connection resets, timeouts, 5xx) — not the current `embedChunkWithRetry`, which retries everything.
   - Concurrency capped by `CODE_MAX_CONCURRENCY`; a call counter for tests.
4. **Summaries — opt-in.** When `CODE_SUMMARIZE` or the run's `summarize: true` is set, `summarizer.ts` + `generateSummary.ts` (using `bot.baseModel.name`) run bottom-up: unit → file → module → repo, skipping unchanged `content_hash` and `test`/`generated` files. When off, retrieval works from code + context header alone.
5. **Load — two passes, per-file transactions** (`CodeIndexService`, SQL in `CodeGraphService`):
   - Pass 1, per file: embed in memory *first*, then one `withTransaction` that upserts the file row, upserts units by uid, deletes vanished units and their embedding rows, and upserts embeddings (all in the bot's own tables). Same "embed everything, then write once" rule as `ingestText`.
   - Pass 2, per file: resolve references to ids and replace that file's outgoing edges.
   - A file that fails is recorded in `fileErrors` and skipped (like a zip entry); the run finishes `partial`. Nothing half-written per file.
   - Transactions use `withTransaction`; bulk statements may `SET LOCAL statement_timeout` above the 30 s default.
6. **Run lifecycle:** `POST /code/:botId/repos` (zip; `POST /code/:botId/repos/path` for a server path under `CODE_REPOS_ROOT`) → `assertCanManage` → create the `CodeIndexRun` (partial unique index rejects a second concurrent run with 409) → `void this.run(id).catch(...)`, return `{ runId }` immediately. Every error inside the run is caught; per-phase stats and durations go into `stats`.
7. Client: the **Sources tab** (`TabCodeSources.tsx`, using `starGate`, react-hook-form + zod wrappers): upload zip, list repos, trigger re-index, poll the latest `CodeIndexRun`, show file errors.

**Acceptance**
- Indexing the fixture (LLM/embedding mocked) completes; DB checks:
  - edge `useUsers --calls_api--> route:GET /api/users` exists;
  - edge `route:GET /api/users --handles_route--> <controller function>` exists;
  - every non-test code unit has a vector row; with summaries enabled, a summary too;
  - the fixture `.env` appears nowhere in the bot's files table.
- Indexing two repos into one bot (the fixture's frontend and backend as separate zips) still produces the cross-repo `calls_api` edge.
- Re-running with no changes makes **zero** embedding and zero LLM calls.
- A second concurrent index request for the same bot returns 409; a run killed mid-way is marked `failed` after restart.

---

### Phase 6 — Retrieval and chat

1. `queryClassifier.ts`: `symbol` / `flow` / `impact` / `config` / `conceptual` (default); rule-based only for now.
2. Hybrid search in `CodeSearchService` (SQL in `CodeGraphService`, against the bot's own tables), each leg top 50:
   - vector: `ORDER BY embedding <=> $1` on `T.embeddings` (cosine; `SET LOCAL hnsw.ef_search` in a transaction), query embedded with `role: "query"`;
   - full text: `ts_rank_cd(search_tsv, websearch_to_tsquery('simple', $q))`;
   - trigram: `similarity(name, $q)` / `qualified_name % $q` for identifier-like tokens.
   - Fuse with **RRF (k = 60)** in `retrieve/rrf.ts` (pure, unit-tested); weight trigram higher for `symbol` queries. Summary hits map back to units.
3. `graphExpand.ts`: recursive CTE over the bot's edges table from the top N (default 8) — `flow` follows `calls_api → handles_route → calls` ≤ 3 hops downstream; `impact` follows edges in reverse ≤ 2 hops; default 1 hop both ways over `calls`, `handles_route`, `calls_api`, `renders`. Cap 40 expanded units.
4. `rerank.ts`: interface + no-op (**default**) + optional LLM implementation. A local 7B model scoring dozens of candidates per question is slow; enable only if the eval shows it earns it.
5. `contextBuilder.ts`: repo summary (if any) → file/module summaries → code grouped by file, ordered by line, each prefixed `// path:start-end` → for `flow` queries an ordered chain (`UsersPage → useUsers → GET /api/users → userController.list → userService.findAll`). Budget derived from the model's context window (`bot.baseModel.meta.contextWindow` is a **string** — parse it, cap at `CODE_NUM_CTX`), leaving room for the answer.
6. `llmServices/generateCodeAnswer.ts`: like `generateAnswer` but **sets `options.num_ctx`**. Ollama's default context is small and silently truncates the *start* of the prompt; without this the retrieved code would be dropped without any error. System prompt requires `path:line` citations and "not found in indexed code" when context is insufficient.
7. **Own chat endpoint:** `POST /code/:botId/chat` `{ question, mode?: "answer" | "agent" }` → `CodeChatController` → `CodeChatService`. No tool detection, no KB retrieval, no shared code with `ChatController`. Response: `{ success, answer, citations: [{ path, repo, startLine, endLine, unitUid }], mode }`. (This deliberately does not follow CLAUDE.md's "fold changes into `/chat`" — that note was about the removed legacy stream path, and this is a separate product flow.)
8. **Authorization:** `CodeChatService` calls `assertCanView(bot, actor)` first (`actor` from `req.user`, 401 if absent). Unlike `/chat`, this endpoint is authorised from day one.
9. `POST /code/:botId/search` — the retrieval step alone, for debugging and eval.
10. Client: `code-chat.$botId.tsx` (own route, `starGate`): message list, a mode toggle (answer/agent), and `citations` rendered as `path:start-end` chips under each answer; bot cards for this type link here.

**Acceptance**
- `search "fetch users list"` returns `useUsers` and the `GET /api/users` route in the top 5; `search "getUserById"` returns that function first.
- A `flow` question about loading the users page returns the chain from `UsersPage` to the service function.
- A user who cannot view the bot gets 403 from `/code/:botId/chat` and `/code/:botId/search`; a query against bot A never returns a unit of bot B (two bots, same DB — guaranteed by separate tables, but test it).
- With a long context, the prompt actually reaches the model untruncated (assert `num_ctx` is sent).

---

### Phase 7 — Agent tools

Handlers live in `CodeSearchService` (authorised, operating only on the bot's own tables); `codeIntel/agent/tools.ts` holds the JSON schemas and a name → handler map. Exposed as `POST /code/:botId/tools/<name>` — **not** `/tools/*`, which is the existing Tools CRUD.

| Tool | Input | Returns |
|---|---|---|
| `search_code` | `query, kind?, path_prefix?, limit?` | ranked units: uid, path, lines, signature, summary |
| `find_symbol` | `name` | exact/fuzzy matches by `qualified_name` |
| `get_unit` | `uid` | full code + metadata |
| `read_file` | `repo?, path, start_line?, end_line?` | slice of the stored file content |
| `get_callers` | `uid, depth?` | reverse `calls`/`imports`/`renders` |
| `get_callees` | `uid, depth?` | forward edges |
| `list_routes` | `method?, path_contains?` | route units + handler uids |
| `trace_feature` | `uid` | frontend → API → handler → service → entity chain |
| `get_summary` | `path` | stored file/folder summary (empty if summaries are off) |

Agent mode: `POST /code/:botId/chat` with `{ mode: "agent" }`. `llmServices/runCodeAgent.ts` runs the loop (**max 10 tool calls**): native Ollama `/api/chat` with `tools` when `bot.toolModel.meta.supportsTools`, otherwise the JSON-action prompt style that `ToolService.detectToolUse` already uses. Tool results are truncated (cf. the 28 000-char cap on HTTP tools).

**Acceptance**
- Each tool has a test against the fixture DB and rejects a caller without view access.
- Agent mode on "what happens when the users page loads?" makes ≥ 1 `trace_feature` or `get_callees` call and answers with `path:line` citations.
- Tool-count cap enforced; a tool error is returned to the model, not thrown out of the request.

---

### Phase 8 — Incremental indexing and evaluation

1. `POST /code/:botId/repos/:repoId/update` — new zip for a zip repo, or a rescan for a `path` source. **Diff by `content_hash`** against the bot's files table:
   - unchanged → skip (no parse, embed or LLM);
   - changed/added → re-parse, upsert (ids stable);
   - deleted → delete the file row and, **in the same transaction**, its embedding rows by uid (cascade removes units/edges; embeddings are keyed by uid, not FK'd to units);
   - renamed → delete + add.
2. Re-link edges for changed files *and* files that import or call into them; re-run cross-layer `calls_api` linking bot-wide (cheap).
3. Re-summarise (if enabled) only changed units, then their file, ancestor modules, repo. Re-embed only rows whose text hash changed.
4. *Optional:* `git` sources via `simple-git` (clone under `CODE_REPOS_ROOT/<botId>/<repo>`, https only, no credentials stored in this phase); `last_commit` and `git diff --name-status` become a fast path over hashing.
5. `eval/questions.json` (≥ 30 questions, expected uids or paths) and `eval/runEval.ts`, run via `npm run code:eval -- --bot <botId>` (ts-node script like `migrate:hnsw-cosine`; connects Mongo + Postgres itself). Reports recall@5, recall@10, MRR overall and per query type; writes timestamped JSON to `eval/results/` (gitignored).
6. **Deferred:** post-commit hook and CI job. They need a non-interactive credential; today there is only a 15-minute access token and an httpOnly refresh cookie. Track as "per-bot API keys" in the backlog.

**Acceptance**
- Changing one function and re-running update re-embeds only that unit (call counters).
- Deleting a file removes its units, edges **and vector rows**.
- `npm run code:eval` prints the metrics table.

---

### Phase 9 — Spring Boot and .NET adapters (future)

Only adapters are added. **If core, storage or retrieval must change, that is a leak in the abstraction — fix the abstraction and note it.** Scope and framework behaviour are as in the original plan:

- **Java / Spring Boot:** `languages/java.ts` (classes, interfaces, enums, records, methods with `@line` overload suffix, Javadoc, imports via package → directory); `frameworks/spring.ts` (`@RestController` + `@RequestMapping` + `@GetMapping`… → routes; `@Service/@Repository/@Component` roles and injection edges; `@Entity` → `entity` + `uses_entity` via `JpaRepository<User, Long>`; `application.yml/.properties` → `config`). Fixture `test-fixtures/sample-spring/`.
- **C# / ASP.NET Core:** `languages/csharp.ts` (namespaces, classes, interfaces, records, methods, properties, XML docs, `using` via namespace index); `frameworks/aspnet.ts` (`[ApiController]` + `[Route("api/[controller]")]` + `[HttpGet]` → routes with `[controller]` expansion; minimal APIs `MapGet`; DI registrations → interface→implementation edges; EF Core `DbSet<T>` → `entity` + `uses_entity`; `appsettings*.json` → `config`). Fixture `test-fixtures/sample-dotnet/`.
- **Cross-stack:** a React frontend calling a Spring or .NET backend must link through the same `calls_api` matching, in one bot with two repos — add a fixture test.

**Acceptance:** each fixture passes the Phase 3–6 style of tests; `git diff` touches only `codeIntel/adapters/`, tests/fixtures, registry wiring and grammar assets.

---

## 8. Engineering rules

- Layering and response rules from CLAUDE.md apply: controllers are classes with arrow-function properties and call one service; every response is `sendResponse()`; async handlers wrap in try/catch and return non-leaking messages; new routes go under a "Code interpreter" comment block in `app.routes.ts` **and** get entries in `server/Endpoints/code.http`. None of the new endpoints are public.
- Every service method that touches a bot takes an `actor` and calls `assertCanView` / `assertCanManage` first (`ForbiddenError` → 403, as in `KnowledgeBaseService`).
- **SQL lives in `CodeGraphService` only.** Values are parameterised. The only interpolated identifiers are the table names returned by `codeTables(botId)` (validated `botId`, ≤ 63 chars, `assertSafeIdentifier`) and the embedding type/dimension read from `bot.codeConfig` (checked to be `vector`/`halfvec` and an integer). Never from a request body. `botId` in a route is resolved to a bot document (and authorised) before any table name is built.
- All Ollama calls in `llmServices/`; model name is a parameter from the bot, falling back to env — never a literal.
- Retries only for transient failures, with a `shouldRetry` predicate.
- TypeScript strict; no `any` in `codeIntel/core` or `CodeGraphService`; param objects (`fn({ botId, query })`).
- Log per-phase stats into `CodeIndexRun.stats`.
- Tests mock `llmServices/*`; no network. DB tests are gated on `TEST_DATABASE_URL`.
- No new committed secrets; no `.env*` additions.

---

## 9. Docs to update when this lands

- `docs/ARCHITECTURE.md`: §3 (bot types), a new section for the code-intel flow (ingest, query, tables), §7 (per-bot code tables, `codeConfig`), §8 endpoint map, §10 known gaps.
- `CLAUDE.md`: the raw-SQL rule (`VectorService` **and** `CodeGraphService`; table names from `bot.vectorTable` or `codeTables(botId)`), the "embedding dimension 768 is hard-coded" note (code bots are per-bot), `/chat` guard, `codeIntel/` in the layout.
- `Readme.md` bot-type list, `server/Endpoints/demo.http` (optional code-bot walkthrough), `.env.example` (new `CODE_*` variables).

## 10. Risks

- **Event-loop starvation.** Parsing and linking are CPU-bound in the API process. Mitigate with yields between files and low concurrency; if unrelated endpoints slow down during indexing, move the run into a `worker_threads` worker (it needs its own Postgres pool and Mongo connection).
- **Answer quality on a general 7B model.** `mistral:latest` is not code-specialised. `llmModel.meta.modelType` already allows `"code"`; register a coder model and select it per bot via the existing bot update, rather than hard-coding one.
- **Silent context truncation** if `num_ctx` is not set (Phase 6, item 6).
- **Stuck "running" state** after a crash — covered by the startup sweep.
- **Stored source visibility.** Anyone who can view the bot can read its source through chat/tools. Set `publicAccess` deliberately and keep secret-file exclusion strict.

## 11. Definition of done (Phases 1–8)

1. Creating a Code_Interpreter bot, uploading a zip of a real Node/React project, and indexing it completes end to end from the UI.
2. Updating with a changed zip handles changed, added, deleted and renamed files correctly.
3. `/code/:botId/chat` answers with `path:line` citations in one-shot and agent modes, and never crosses a bot or permission boundary.
4. `npm run code:eval` on the real project's question set reaches **recall@10 ≥ 0.8**, tuning chunking, headers, RRF weights and graph expansion, and recording each change's effect.
5. Build, lint and tests pass in CI, including the pgvector service container.
