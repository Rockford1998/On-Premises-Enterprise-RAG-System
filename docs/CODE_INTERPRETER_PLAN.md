# Code Interpreter Bot — Implementation Plan

> **For Claude Code:** Implement **one phase at a time, in order**. At the end of each phase run its acceptance checks plus `npm run build`, `npm run lint` and `npm test` in `server/`. Do not start the next phase until they pass. If this plan conflicts with what you find in the codebase, stop and ask rather than guess. Read [ARCHITECTURE.md](ARCHITECTURE.md) and the conventions in [CLAUDE.md](../CLAUDE.md) first — this plan was written against them.
>
> Keep all language- and framework-specific logic inside `codeIntel/adapters/`. Core, storage and retrieval must never import a language-specific module.

---

## 0. What this is

A new bot type, **`Code_Interpreter`**. A user creates one like any other bot, attaches one or more source repositories (zip upload first), and chats with it. The pipeline indexes the code into the existing Postgres/pgvector so the local Ollama model can answer questions about the codebase with `path:line` citations.

"Interpreter" means *reads and explains* code. It never executes it. Nothing in this plan runs user code.

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
- Fixing the unrelated `/chat` authorization gap — except that the Code_Interpreter branch must not widen it (Phase 6).

---

## 1. What changed from the original plan, and why

| Original | Now | Reason |
|---|---|---|
| Standalone `code-intel/` package, `cli.ts`, own `api/server.ts` | Module at `server/src/codeIntel/` + service/controller/routes in the existing layers | One deployable; CLAUDE.md layering (`controller → service → model`) |
| Global `repos/files/code_units/edges/embeddings` tables, no tenant column | Same tables with a **`bot_id`** column; embeddings live in the bot's existing **`vector_table_<botId>`** | Vector table per bot is the isolation boundary; bot delete already drops it |
| `migrations/*.sql` + `migrate.ts` | Idempotent `ensureCodeIntelSchema()` called from `db/init.ts` | The repo has no migration runner; tables are created on demand |
| `db/repositories/*` with raw SQL | New `services/codeGraph.service.ts` (+ small additions to `VectorService`) | CLAUDE.md: raw SQL lives in a service, parameterised, via `db/pgsql.ts` |
| `zod` config, `dotenv`, `pg` Pool | `config/env.ts` helpers, `query/withClient/withTransaction` | zod is not a dependency; never call `pool.connect()` directly |
| Provider interfaces, API keys, OpenAI-style providers, "never send to external model" | Functions in `llmServices/` taking a model name from the bot | All inference is local Ollama; model names are never hard-coded |
| `vitest` | **Jest** (`__tests__/*.test.ts`) | What the server already uses |
| Fake providers with call counters | `jest.mock` on `llmServices/*` with counters | Same effect, no new abstraction |
| `p-limit` | Tiny in-repo limiter (or `p-limit@3`) | `p-limit` ≥4 is ESM-only |
| `index_runs` in Postgres | `CodeIndexRun` in Mongo (`shared.model.ts`) | Status/log documents already live there; the UI polls them |
| Git commit diff drives incremental | **Content-hash diff** drives incremental; git optional | Zip uploads have no git history |
| Summaries mandatory, bottom-up | Summaries **opt-in**, off by default | Local 7B model over thousands of units is hours; retrieval must work without them |
| `read_file` reads from disk | `read_file` reads `code_files.content` | Deterministic, no path traversal, survives upload-dir cleanup |
| Agent tools at `/tools/*` | `/code/:botId/tools/*` | `/tools/:id` is the existing Tools CRUD; it would collide |
| Post-commit hook + CI job | Deferred | No non-interactive credential exists (15-min access token, httpOnly refresh cookie) |
| CLI-only UI | Small client UI (create option, Source tab, citations in chat) | It is a bot type in the product now |

---

## 2. Decisions to confirm before Phase 1

These are the assumptions the plan makes. Each has a default; change the plan if you disagree.

1. **Shared tables keyed by `bot_id`**, not five tables per bot. Every query in `CodeGraphService` must be predicated on `bot_id`. *(Alternative: per-bot tables — stronger isolation, much heavier DDL/teardown.)*
2. **SQL for the code graph goes in a new `CodeGraphService`**, which extends CLAUDE.md's "all raw SQL belongs in `VectorService`" rule. Update that line of CLAUDE.md when it lands.
3. **One bot ↔ many repos.** A React frontend and a Node backend are usually separate repos; cross-layer `calls_api` linking must work across repos in the same bot.
4. **Sources, in order:** zip upload → server-local path under an allow-listed `CODE_REPOS_ROOT` → git clone (Phase 8, optional).
5. **Summaries off by default** (`CODE_SUMMARIZE=false`).
6. **Embedding model `nomic-embed-text`, 768 dims** (already pulled, no new tables). Because vector tables are per bot, a code-specific embedding model with a different dimension is possible later for *new* Code_Interpreter bots without any migration — that is why the dimension comes from `CODE_EMBEDDING_DIM`, not a literal.

---

## 3. Architecture

```
 zip / path ─▶ EXTRACT ─────▶ TRANSFORM ──────────────────────▶ LOAD (per file, one tx)
              FileSource     parse (web-tree-sitter)             code_files / code_units /
              walk+hash      language adapter → symbols          code_edges  (shared, bot_id)
              classify       framework adapter → routes,         vector_table_<botId>
                             components, api calls               (embeddings + metadata)
                             link edges (cross-layer)
                             chunk + context header
                             embed (Ollama /api/embed)
                             [opt-in] summarize (bot.baseModel)

 POST /chat {botType: Code_Interpreter}
   └▶ CodeChatService: classify → hybrid (vector + FTS + trigram) → RRF → graph expand
      → [optional rerank] → context builder (path:line) → generateCodeAnswer (num_ctx set)
   └▶ mode:"agent" → tool loop over /code/:botId/tools/* handlers (max 10 calls)
```

Indexing runs in-process, fire-and-forget, tracked by a `CodeIndexRun` document. Parsing is CPU-bound and shares the event loop with the API — see Risks.

---

## 4. Project layout

```
server/
├── src/
│   ├── config/env.ts                    # + codeIntel block (§Phase 1)
│   ├── db/init.ts                       # + ensureCodeIntelSchema() (soft-fail)
│   ├── models/shared.model.ts           # + botType value, CodeIndexRun schema
│   ├── routes/app.routes.ts             # + "Code interpreter" block
│   ├── controller/codeIntel.controller.ts   # thin: parse req, call one service, sendResponse
│   ├── services/
│   │   ├── codeIndex.service.ts         # authz, source intake, run lifecycle, orchestration
│   │   ├── codeSearch.service.ts        # search + tool handlers (authz, then retrieval)
│   │   ├── codeChat.service.ts          # answer / agent loop glue for /chat
│   │   ├── codeGraph.service.ts         # ALL SQL for code_* tables, bot_id-scoped
│   │   └── vectors.service.ts           # + code metadata indexes, delete-by-uid
│   ├── llmServices/
│   │   ├── generateEmbedding.ts         # + optional { model, raw } — default behaviour unchanged
│   │   ├── generateEmbeddings.ts        # batch via /api/embed
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
```

Tests live in `codeIntel/**/__tests__/*.test.ts` (matches `jest.config.js`). Fixtures stay outside `src/` because `tsconfig.json` has `rootDir: ./src` and no `jsx` setting.

### Dependencies

Add: `web-tree-sitter` + WASM grammars (`tree-sitter-wasms` or vendored under `server/assets/grammars/`), `ignore`, `simple-git` (Phase 8). Already present and reused: `adm-zip`, `pg`, `pgvector`, `axios`, `multer`.
**Verify each is CommonJS-loadable in a spike before building on it** — especially `web-tree-sitter` (pin a version that ships a CJS entry). Do not add `zod`, `dotenv`, `commander`, `fastify`, `vitest`.

---

## 5. Data model

### 5.1 Postgres — `ensureCodeIntelSchema()`

Called from `db/init.ts` after `initPostgres()`. Idempotent (`IF NOT EXISTS`). **Soft-fail at startup** (log and continue) so a deployment that never uses Code_Interpreter is not blocked by a missing `pg_trgm`; the create-bot path for this type re-runs it and returns 400 with the reason if it still fails. `pgvector/pgvector:0.8.0-pg17` ships contrib, so `pg_trgm` should be available — confirm in Phase 1.

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS code_repos (
  id           BIGSERIAL PRIMARY KEY,
  bot_id       TEXT NOT NULL,                    -- botProfile.botId (Mongo); no FK possible
  name         TEXT NOT NULL,
  source_type  TEXT NOT NULL,                    -- zip | path | git
  source_ref   TEXT,                             -- path under CODE_REPOS_ROOT or git URL; null for zip
  last_commit  TEXT,
  summary      TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (bot_id, name)
);

CREATE TABLE IF NOT EXISTS code_files (
  id            BIGSERIAL PRIMARY KEY,
  repo_id       BIGINT NOT NULL REFERENCES code_repos(id) ON DELETE CASCADE,
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

CREATE TABLE IF NOT EXISTS code_modules (
  id       BIGSERIAL PRIMARY KEY,
  repo_id  BIGINT NOT NULL REFERENCES code_repos(id) ON DELETE CASCADE,
  path     TEXT NOT NULL,                        -- '' = repo root
  summary  TEXT,
  UNIQUE (repo_id, path)
);

CREATE TABLE IF NOT EXISTS code_units (
  id             BIGSERIAL PRIMARY KEY,          -- internal; stable across re-index (upsert by uid)
  bot_id         TEXT NOT NULL,                  -- denormalised: every query filters on it
  repo_id        BIGINT NOT NULL REFERENCES code_repos(id) ON DELETE CASCADE,
  file_id        BIGINT NOT NULL REFERENCES code_files(id) ON DELETE CASCADE,
  uid            TEXT NOT NULL,                  -- stable id, §6.3
  parent_id      BIGINT REFERENCES code_units(id) ON DELETE CASCADE,
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
  search_tsv     TSVECTOR GENERATED ALWAYS AS (to_tsvector('simple', search_text)) STORED,
  UNIQUE (bot_id, uid)
);

CREATE TABLE IF NOT EXISTS code_edges (
  id          BIGSERIAL PRIMARY KEY,
  bot_id      TEXT NOT NULL,
  repo_id     BIGINT NOT NULL REFERENCES code_repos(id) ON DELETE CASCADE,
  from_id     BIGINT NOT NULL REFERENCES code_units(id) ON DELETE CASCADE,
  to_id       BIGINT REFERENCES code_units(id) ON DELETE CASCADE,   -- null when unresolved
  to_external TEXT,                              -- 'npm:axios' or an unresolved symbol name
  type        TEXT NOT NULL,                     -- imports|calls|renders|handles_route|calls_api|uses_entity|extends|implements|uses_hook
  metadata    JSONB NOT NULL DEFAULT '{}',
  CHECK (to_id IS NOT NULL OR to_external IS NOT NULL)
);

-- indexes (all IF NOT EXISTS, named)
-- code_units: (bot_id, kind), (file_id), GIN(search_tsv), GIN(name gin_trgm_ops),
--             GIN(qualified_name gin_trgm_ops), GIN(metadata jsonb_path_ops)
-- code_edges: (from_id, type), (to_id, type), (bot_id, type)
-- code_repos: (bot_id)
```

**Embeddings** are not a new table. They go in the bot's existing `vector_table_<botId>` (created by `BotController.create` for every non-`General_Purpose` type, so Code_Interpreter already gets one). Each row's `metadata`:

```json
{ "kind": "code|file_summary|module_summary|repo_summary",
  "uid": "shop:src/services/user.ts#UserService.getUser",   // or file:/module:/repo: prefixed
  "contentHash": "<sha256 of the embedded text>", "model": "nomic-embed-text" }
```

`VectorService` gains `ensureCodeMetadataIndexes(tableName)` — btree on `(metadata->>'uid')` and `(metadata->>'kind')` — and `deleteByUids({ tableName, uids })`, both through `assertSafeIdentifier`. Vector search reuses `VectorService.searchVectors` with its `filter`/`filterParams` (e.g. `metadata->>'kind' = ANY($3)`).

Because embeddings and code rows are both in Postgres, a file's units, edges and vectors are written in **one `withTransaction`** — the cross-store atomicity gap the KB path has does not apply here.

**Deleting a bot** must also `DELETE FROM code_repos WHERE bot_id = $1` (cascades files/units/edges/modules). `BotController.delete` currently only drops the vector table — add the call, and remove any stored source under `CODE_REPOS_ROOT/<botId>`.

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

`uid = "<repoName>:<path>#<qualifiedName>"` — routes `#route:GET /api/users/:id`, files `#<file>`; collisions append `@<startLine>`. `(bot_id, uid)` is unique. Loading **upserts by uid** (`ON CONFLICT (bot_id, uid) DO UPDATE`) so a unit's `id` survives re-indexing and edges pointing at it from *unchanged* files are not cascade-deleted. Units whose uid disappeared from a file are deleted explicitly.

---

## 7. Phases

### Phase 1 — Foundation and bot-type plumbing

1. `botType` gains `Code_Interpreter`; add a `case` in `getBotInstructionByBotRequest.ts` (answer only from retrieved code, cite `path:line`, say "not found in indexed code" otherwise).
2. **Audit every `General_Purpose` check** — several silently treat "not GP" as "KB bot":
   - server: `bot.controller.ts:188` (creates vector table — correct for this type, keep), `bot.controller.ts:298` (drops it — keep, and add code-row cleanup), `chat.controller.ts:70` (would run plain KB retrieval — must branch first, Phase 6).
   - client: `TabAgent.tsx` (four checks show Knowledge/Connections tabs — hide both for Code_Interpreter), `agent-overview.tsx:69`, `-CreateBotDialog.tsx` (add the select option; the list is hard-coded, not read from `/metadata/bot-type`).
3. `config/env.ts`: a `codeIntel` block using the existing `optional`/`integer` helpers: `CODE_REPOS_ROOT` (unset = path sources disabled), `CODE_MAX_UPLOAD_BYTES` (default 200 MB), `CODE_MAX_FILES` (20 000), `CODE_MAX_FILE_BYTES` (1 MB), `CODE_MAX_CONCURRENCY` (2), `CODE_MAX_CHUNK_TOKENS` (800), `CODE_EMBEDDING_DIM` (768), `CODE_NUM_CTX` (8192), `CODE_SUMMARIZE` (false), `CODE_EXCLUDE_GLOBS`. All optional with defaults — like Drive config, a deployment that never uses this must still start.
4. `ensureCodeIntelSchema()` (§5.1), `CodeGraphService` skeleton, `VectorService` additions, `CodeIndexRun` model with the partial unique index and startup sweep.
5. `codeIntel/core/{types,ids,registry}.ts`.
6. Fixture `server/test-fixtures/sample-mern/`:
   - Express: `server.js`, `routes/users.js` (GET/POST), `controllers/userController.js`, `services/userService.js`, `models/User.js`
   - React (TSX): `App.tsx` with React Router, `pages/UsersPage.tsx`, `components/UserCard.tsx`, `hooks/useUsers.ts` calling `axios.get('/api/users')`
   - `package.json` (express, react, axios), `tsconfig.json` with `@/*` alias
   - a `.env` file containing a fake secret — used to prove it is never indexed.
7. Test setup: unit tests as `__tests__/*.test.ts`. **DB integration tests** run only when `TEST_DATABASE_URL` is set (skipped otherwise, so `npm test` stays green offline). Add a `pgvector/pgvector:pg17` service container to `.github/workflows/ci.yml` and set that variable.
8. Client: create-dialog option; hide Knowledge/Connections/Tools tabs for the new type; a stub "Sources" tab.

**Acceptance**
- Creating a `Code_Interpreter` bot succeeds and creates `vector_table_<botId>`; `GET /metadata/bot-type` lists it.
- Server start with a fresh DB creates all `code_*` tables idempotently (run twice); with `pg_trgm` unavailable the server still starts and logs why.
- Deleting the bot removes its vector table and all `code_*` rows.
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
   - The existing `generateEmbedding` lowercases and strips everything except `\w\s.-`, which destroys code (`::`, `()`, `/`, casing). Add an optional `{ model, raw }` second argument; `raw: true` skips `preprocessText`. Default behaviour is unchanged, so KB bots are unaffected. **Documents and queries must use the same mode** or distances are meaningless.
   - New `generateEmbeddings({ texts, model, raw })` using Ollama `/api/embed` (batched); confirm the installed Ollama supports it, else fall back to per-text calls.
   - `nomic-embed-text` expects task prefixes: `search_document: ` when indexing, `search_query: ` when querying. Apply both in the code path only.
   - Model name comes from `bot.embedModel.name` (existing code reads a global env var instead — do not copy that).
   - Retry with `util/retry` and a `shouldRetry` predicate (connection resets, timeouts, 5xx) — not the current `embedChunkWithRetry`, which retries everything.
   - Concurrency capped by `CODE_MAX_CONCURRENCY`; a call counter for tests.
4. **Summaries — opt-in.** When `CODE_SUMMARIZE` or the run's `summarize: true` is set, `summarizer.ts` + `generateSummary.ts` (using `bot.baseModel.name`) run bottom-up: unit → file → module → repo, skipping unchanged `content_hash` and `test`/`generated` files. When off, retrieval works from code + context header alone.
5. **Load — two passes, per-file transactions** (`CodeIndexService`, SQL in `CodeGraphService`):
   - Pass 1, per file: embed in memory *first*, then one `withTransaction` that upserts the file row, upserts units by uid, deletes vanished units and their vectors, and upserts vectors. Same "embed everything, then write once" rule as `ingestText`.
   - Pass 2, per file: resolve references to ids and replace that file's outgoing edges.
   - A file that fails is recorded in `fileErrors` and skipped (like a zip entry); the run finishes `partial`. Nothing half-written per file.
   - Transactions use `withTransaction`; bulk statements may `SET LOCAL statement_timeout` above the 30 s default.
6. **Run lifecycle:** `POST /code/:botId/repos` (zip) → `assertCanManage` → create the `CodeIndexRun` (partial unique index rejects a second concurrent run with 409) → `void this.run(id).catch(...)`, return `{ runId }` immediately. Every error inside the run is caught; per-phase stats and durations go into `stats`.
7. Client: the **Sources tab** (`TabCodeSources.tsx`, using `starGate`, react-hook-form + zod wrappers): upload zip, list repos, trigger re-index, poll the latest `CodeIndexRun`, show file errors.

**Acceptance**
- Indexing the fixture (LLM/embedding mocked) completes; DB checks:
  - edge `useUsers --calls_api--> route:GET /api/users` exists;
  - edge `route:GET /api/users --handles_route--> <controller function>` exists;
  - every non-test code unit has a vector row; with summaries enabled, a summary too;
  - the fixture `.env` appears nowhere in `code_files`.
- Re-running with no changes makes **zero** embedding and zero LLM calls.
- A second concurrent index request for the same bot returns 409; a run killed mid-way is marked `failed` after restart.

---

### Phase 6 — Retrieval and chat

1. `queryClassifier.ts`: `symbol` / `flow` / `impact` / `config` / `conceptual` (default); rule-based only for now.
2. Hybrid search in `CodeSearchService` (SQL in `CodeGraphService`), each leg top 50, **all filtered by `bot_id`**:
   - vector: `VectorService.searchVectors` with `metadata->>'kind'` filter;
   - full text: `ts_rank_cd(search_tsv, websearch_to_tsquery('simple', $q))`;
   - trigram: `similarity(name, $q)` / `qualified_name % $q` for identifier-like tokens.
   - Fuse with **RRF (k = 60)** in `retrieve/rrf.ts` (pure, unit-tested); weight trigram higher for `symbol` queries. Summary hits map back to units.
3. `graphExpand.ts`: recursive CTE over `code_edges` from the top N (default 8) — `flow` follows `calls_api → handles_route → calls` ≤ 3 hops downstream; `impact` follows edges in reverse ≤ 2 hops; default 1 hop both ways over `calls`, `handles_route`, `calls_api`, `renders`. Cap 40 expanded units.
4. `rerank.ts`: interface + no-op (**default**) + optional LLM implementation. A local 7B model scoring dozens of candidates per question is slow; enable only if the eval shows it earns it.
5. `contextBuilder.ts`: repo summary (if any) → file/module summaries → code grouped by file, ordered by line, each prefixed `// path:start-end` → for `flow` queries an ordered chain (`UsersPage → useUsers → GET /api/users → userController.list → userService.findAll`). Budget derived from the model's context window (`bot.baseModel.meta.contextWindow` is a **string** — parse it, cap at `CODE_NUM_CTX`), leaving room for the answer.
6. `llmServices/generateCodeAnswer.ts`: like `generateAnswer` but **sets `options.num_ctx`**. Ollama's default context is small and silently truncates the *start* of the prompt; without this the retrieved code would be dropped without any error. System prompt requires `path:line` citations and "not found in indexed code" when context is insufficient.
7. **`/chat` integration** (fold into the existing endpoint, per CLAUDE.md): at the top of `ChatController.chatBot`, after loading the bot, `if (bot.botType === "Code_Interpreter") return codeChatService.answer(...)`. Skip tool detection for this type. Response adds `citations: [{ path, startLine, endLine, unitUid }]`.
8. **Authorization:** the Code_Interpreter branch calls `assertCanView(bot, req.user)`. This means threading `req.user` into this branch only; do not extend the fix to other bot types in this change.
9. `POST /code/:botId/search` — the retrieval step alone, for debugging and eval.
10. Client: chatbox renders `citations` as `path:start-end` chips under the answer.

**Acceptance**
- `search "fetch users list"` returns `useUsers` and the `GET /api/users` route in the top 5; `search "getUserById"` returns that function first.
- A `flow` question about loading the users page returns the chain from `UsersPage` to the service function.
- A user who cannot view the bot gets 403 from `/chat` and `/code/:botId/search`; a user of bot A can never receive a unit of bot B (test with two bots in the same DB).
- With a long context, the prompt actually reaches the model untruncated (assert `num_ctx` is sent).

---

### Phase 7 — Agent tools

Handlers live in `CodeSearchService` (authorised, `bot_id`-scoped); `codeIntel/agent/tools.ts` holds the JSON schemas and a name → handler map. Exposed as `POST /code/:botId/tools/<name>` — **not** `/tools/*`, which is the existing Tools CRUD.

| Tool | Input | Returns |
|---|---|---|
| `search_code` | `query, kind?, path_prefix?, limit?` | ranked units: uid, path, lines, signature, summary |
| `find_symbol` | `name` | exact/fuzzy matches by `qualified_name` |
| `get_unit` | `uid` | full code + metadata |
| `read_file` | `repo?, path, start_line?, end_line?` | slice of `code_files.content` |
| `get_callers` | `uid, depth?` | reverse `calls`/`imports`/`renders` |
| `get_callees` | `uid, depth?` | forward edges |
| `list_routes` | `method?, path_contains?` | route units + handler uids |
| `trace_feature` | `uid` | frontend → API → handler → service → entity chain |
| `get_summary` | `path` | stored file/folder summary (empty if summaries are off) |

Agent mode: `/chat` body `{ mode: "agent" }` for Code_Interpreter bots. `llmServices/runCodeAgent.ts` runs the loop (**max 10 tool calls**): native Ollama `/api/chat` with `tools` when `bot.toolModel.meta.supportsTools`, otherwise the JSON-action prompt style that `ToolService.detectToolUse` already uses. Tool results are truncated (cf. the 28 000-char cap on HTTP tools).

**Acceptance**
- Each tool has a test against the fixture DB and rejects a caller without view access.
- Agent mode on "what happens when the users page loads?" makes ≥ 1 `trace_feature` or `get_callees` call and answers with `path:line` citations.
- Tool-count cap enforced; a tool error is returned to the model, not thrown out of the request.

---

### Phase 8 — Incremental indexing and evaluation

1. `POST /code/:botId/repos/:repoId/update` — new zip for a zip repo, or a rescan for a `path` source. **Diff by `content_hash`** against `code_files`:
   - unchanged → skip (no parse, embed or LLM);
   - changed/added → re-parse, upsert (ids stable);
   - deleted → delete the file row and, **in the same transaction**, its vectors by uid (cascade removes units/edges; vectors have no FK);
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
- **Every SQL statement in `CodeGraphService` filters on `bot_id`** (or on a `repo_id` already verified to belong to it). Values parameterised; the only interpolated identifier is `vector_table_<botId>`, from `bot.vectorTable`, through `assertSafeIdentifier`.
- All Ollama calls in `llmServices/`; model name is a parameter from the bot, falling back to env — never a literal.
- Retries only for transient failures, with a `shouldRetry` predicate.
- TypeScript strict; no `any` in `codeIntel/core` or `CodeGraphService`; param objects (`fn({ botId, query })`).
- Log per-phase stats into `CodeIndexRun.stats`.
- Tests mock `llmServices/*`; no network. DB tests are gated on `TEST_DATABASE_URL`.
- No new committed secrets; no `.env*` additions.

---

## 9. Docs to update when this lands

- `docs/ARCHITECTURE.md`: §3 (bot types), §5 (chat branch), §5/§7 (new tables and metadata), §8 endpoint map, §10 known gaps.
- `CLAUDE.md`: the raw-SQL rule (now `VectorService` **and** `CodeGraphService`), the `General_Purpose`-check audit note, `codeIntel/` in the layout.
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
3. `/chat` answers with `path:line` citations in one-shot and agent modes, and never crosses a bot or permission boundary.
4. `npm run code:eval` on the real project's question set reaches **recall@10 ≥ 0.8**, tuning chunking, headers, RRF weights and graph expansion, and recording each change's effect.
5. Build, lint and tests pass in CI, including the pgvector service container.
