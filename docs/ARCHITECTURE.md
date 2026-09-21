# Architecture

On-Premises Enterprise RAG System — a self-hosted platform where each user creates
"bots" (agents), gives them a private knowledge base and optional HTTP tools, and
chats with them. No data or inference leaves the deployment: models run on a local
Ollama instance, vectors live in local pgvector, documents in local MongoDB.

---

## 1. High-level view

```
┌───────────────────────────────────────────────────────────────────────┐
│                          Browser (React SPA)                          │
│  client/app — Vite + React 19 + TanStack Router + shadcn/ui + zustand │
│                                                                       │
│   sign-in ──► hub-overview ──► agent-details ──► chatbox              │
│                (bot list)      (KB / tools /      (Q&A)               │
│                                 settings)                             │
└─────────────────────────────┬─────────────────────────────────────────┘
                              │ HTTPS/JSON, Bearer JWT
                              │ (axios instance: src/utils/starGate.ts)
┌─────────────────────────────▼─────────────────────────────────────────┐
│                     API server (Express 5 + TS)                       │
│                             server/src                                │
│                                                                       │
│   index.ts ─► authenticateJWT ─► app.routes.ts ─► controller ─► service│
│                                                                       │
│   controller/   thin HTTP layer, sendResponse() envelope              │
│   service/      business logic, owns the models                       │
│   llmServices/  every outbound call to Ollama                         │
│   util/         file reading, hashing, retry, response helper         │
└───────┬──────────────────────┬──────────────────────┬─────────────────┘
        │                      │                      │
        ▼                      ▼                      ▼
┌───────────────┐   ┌──────────────────┐   ┌──────────────────────────┐
│   MongoDB     │   │    PostgreSQL    │   │         Ollama           │
│  (mongoose)   │   │   + pgvector     │   │   :11434                 │
│               │   │                  │   │                          │
│ user          │   │ vector_table_    │   │ BASE_MODEL   (answers)   │
│ botProfile    │   │   <botId>        │   │ TOOL_MODEL   (routing)   │
│ KnowledgeBase │   │  (one table per  │   │ EMBEDDING_MODEL (vectors)│
│ Tools         │   │   bot, HNSW idx) │   │                          │
│ llmModel      │   │                  │   │                          │
└───────────────┘   └──────────────────┘   └──────────────────────────┘
        ▲
        │
┌───────┴────────┐
│  server/uploads│  original files on disk, one folder per botId
└────────────────┘
```

---

## 2. The three-model design

Every bot stores three model references (snapshots of `llmModel` documents,
embedded — not referenced by id — in `botProfile`):

| Field         | Purpose                                              | Called from                        |
|---------------|------------------------------------------------------|------------------------------------|
| `baseModel`   | Generates the final natural-language answer          | `llmServices/generateAnswer.ts`    |
| `toolModel`   | Decides *whether* a tool applies and extracts params | `services/tool.service.ts`         |
| `embedModel`  | Turns text into 768-dim vectors                      | `llmServices/generateEmbedding.ts` |

All three are served by the same Ollama endpoint (`OLLAMA_BASE_URL`). Defaults come
from `.env.<NODE_ENV>` (`BASE_MODEL`, `TOOL_MODEL`, `EMBEDDING_MODEL`) and are
resolved against the `llmModel` collection at bot-creation time
([bot.controller.ts](../server/src/controller/bot.controller.ts)).

---

## 3. Bot types

`botType` is one of `General_Purpose` | `KB_Bot` (see `botType` in
[shared.model.ts](../server/src/models/shared.model.ts), exposed at
`GET /metadata/bot-type`).

- **`KB_Bot`** — gets its own pgvector table (`vector_table_<botId>`) created on
  bot creation and dropped on delete. Retrieval runs on every chat turn; if
  nothing is retrieved the request returns "No relevant information found."
- **`General_Purpose`** — no vector table, no retrieval. The question goes
  straight to the base model with the bot's `instruction` as the system prompt.

---

## 4. Ingestion pipeline (knowledge base)

`POST /kb/upload/:botId` → [kb.controller.ts](../server/src/controller/kb.controller.ts)
→ [knowledgebase.service.ts](../server/src/services/knowledgebase.service.ts)

```
multipart upload
   │  multer diskStorage → uploads/<botId>/<originalname>
   ▼
generateFileHash(filePath)                       util/generateFileHash.ts
   │
   ├─► VectorService.CheckIfkBPresentByFileHash  ── already indexed? → early return
   ▼
readFile()  pdf | docx | doc | pptx | txt        util/readFile.ts (LangChain loaders)
   │
   ▼
RecursiveCharacterTextSplitter                   chunkSize 400, overlap 20
   │
   ▼
for each batch of 5 chunks (parallel):
      generateEmbedding(chunk)   ── Ollama /api/embeddings, normalised
      VectorService.insertVector ── INSERT INTO vector_table_<botId>
      metadata: { source, timestamp, chunkIndex, totalChunks, fileName, fileHash }
   │
   ├─ any chunk failed? → delete vectors by fileHash + delete file  (rollback)
   ▼
KnowledgeBase.create({ botId, fileName, fileSize, fileHash, type,
                       content, source, downloadUrl })
```

Deduplication is by **content hash**, so re-uploading an unchanged file is a no-op.
Deletion (`POST /kb/delete`) removes all three copies: vectors, the Mongo document,
and the file on disk.

### 4.1 Google Drive sync (connections)

A second, persistent ingestion path alongside manual upload: a bot can hold one
or more **connections** to an external source (today: Google Drive only) that
get re-synced on demand rather than imported once.

```
POST /kb/connections/:botId                     KnowledgeConnectionController.startConnect
   │  creates KnowledgeConnection{status:"pending", stateToken}
   ▼
{ authUrl }  ──► browser ──► Google consent screen ──► redirect
   │
   ▼
GET /kb/connections/google/callback  (PUBLIC — see auth.middleware.ts)
   │  looks up the connection by stateToken (CSRF defense: no bearer token
   │  is available on this request), exchanges the code, encrypts the
   │  refresh token (util/crypto.ts, AES-256-GCM)
   ▼
KnowledgeConnection{status:"connected", accountEmail, refreshTokenEncrypted}

PUT /kb/connections/:connectionId/folders  { folderIds }   — Drive folders to sync

POST /kb/connections/:connectionId/sync                  KnowledgeConnectionService.triggerSync
   │  refuses if a KnowledgeSyncLog with status:"running" already exists for
   │  this connection (that status *is* the concurrency guard — no separate
   │  boolean)
   │  creates the "running" log, fires runSync() WITHOUT awaiting, returns
   │  { logId } immediately — same no-queue background-work pattern used
   │  nowhere else in this codebase today, because there is no queue
   ▼
runSync(): list the Drive folders → diff against existing KnowledgeBase rows
for this connectionId, keyed by externalId (the Drive file id):
   • new Drive file                          → download, readFile(), ingestText()  → "created"
   • existing row, md5Checksum changed        → delete old vectors+row, re-ingest    → "updated"
   • existing row, md5Checksum unchanged      → nothing to do                       → "skipped"
   • existing row, file gone from the folder  → delete vectors+row+cached file      → "deleted"
   (each file wrapped in its own try/catch, same isolation as processZipFile)
   ▼
KnowledgeSyncLog{status:"completed", summary, fileResults}
KnowledgeConnection{lastSyncAt, lastSyncStatus, lastSyncSummary}
```

Every Drive-sourced `KnowledgeBase` row carries `sourceType:"google_drive"`,
`connectionId`, `externalId` and `externalChecksum` (Drive's `md5Checksum`) —
manual uploads default to `sourceType:"upload"` and leave the rest unset.
Downloaded files land under `uploads/<botId>/drive/`, kept separate from
manual uploads so same-named files can't collide, then go through the same
`readFile()` → `ingestText()` path as a manual upload.

Credentials are per-connection (each goes through its own OAuth consent, not
one shared service-account key), so different connections on the same
deployment can point at different Google accounts. Disconnecting a
connection (`DELETE /kb/connections/:connectionId`) stops future syncs and
drops the stored credential; it does **not** cascade-delete content that
connection already synced — that only happens via the normal delete path or
automatically on a later sync if the source file is gone from Drive.

Requires `GOOGLE_OAUTH_CLIENT_ID`/`GOOGLE_OAUTH_CLIENT_SECRET`/
`GOOGLE_OAUTH_REDIRECT_URI` and `CREDENTIALS_ENCRYPTION_KEY` (see
`.env.example`); unset by default so a deployment that never connects a
Drive source isn't forced to configure it — `util/googleDrive.ts` throws a
clear error the moment a connection endpoint is actually used without them.

---

## 5. Query pipeline (chat)

`POST /chat` → [chat.controller.ts](../server/src/controller/chat.controller.ts)

```
                      { botId, question }
                              │
                              ▼
        ┌─────────────────────────────────────────┐
        │ ToolService.detectToolUse(botId, query) │   TOOL_MODEL, format:"json"
        │ prompt lists {id,name,description,      │
        │ parameters} of the bot's enabled tools  │
        └──────────────┬──────────────────────────┘
                       │
         tool matched? ├──── yes ──► ToolService.toolExecution()
                       │              • build auth headers (basic/bearer/apiKey)
                       │              • renderTemplateByData() fills ${placeholders}
                       │              • axios request, response capped at 28 000 chars
                       │                     │
                       │                     ▼
                       │              improveTheToolAnswer()   BASE_MODEL
                       │              tool.systemPrompt + raw JSON → prose
                       │                     │
                       │                     ▼
                       │              { answer, isToolResponse: true, toolUsed }
                       │
                       └──── no (or tool threw) ──┐
                                                  ▼
                              botType === "General_Purpose" ?
                                  │                     │
                                 yes                   no
                                  │                     ▼
                                  │        generateEmbedding(question)
                                  │        VectorService.searchVectors()
                                  │          cosine `<=>`, ORDER BY distance
                                  │          limit = TOP_K (env, default 5),
                                  │          efSearch = max(TOP_K*4, 40);
                                  │          KB_MAX_DISTANCE (env, optional)
                                  │          drops chunks past that distance
                                  │                     │
                                  │        0 chunks && KB_Bot → 200 { success:false }
                                  │                     │
                                  └──────────┬──────────┘
                                             ▼
                                  generateAnswer({ question, contextChunks,
                                                   instruction, baseModel })
                                             ▼
                                  { answer, isToolResponse: false }
```

Tool failure is non-fatal: the catch block falls through to normal RAG.

`POST /streamChat` (the older SSE path that bypassed tool detection and read
`req.body.prompt` instead of `question`) has been removed — it was unused by
the client and diverged from `/chat`. Streaming support would need to be
rebuilt as part of `/chat` itself rather than as a second path.

---

## 6. Tools

A tool is an HTTP endpoint description stored per bot (`Tools` collection). The
tool model reads its `name`/`description`/`parameters` to decide relevance, then
`toolExecution` performs the call.

Supported auth (`auth.type`): `none`, `basic`, `bearer`, `apiKey`
(`apiKeyLocation`: `header` | `query`). Path variables, query params, headers and
fixed params all go through `renderTemplateByData()`, which substitutes
`${dot.path}` placeholders from the LLM-extracted args and appends any unused args
to the request payload.

`tool.type` is `API` | `DATABASE` in the schema, but only `API` is implemented —
`DATABASE` returns `{ error: "Unsupported tool type" }`.

> Note: [models/tool.schema.ts](../server/src/models/tool.schema.ts) is an older,
> unused variant of the tool shape. The live schema is `ToolSchema` inside
> [shared.model.ts](../server/src/models/shared.model.ts).

---

## 7. Data model (MongoDB)

All schemas live in one file: [server/src/models/shared.model.ts](../server/src/models/shared.model.ts).

| Collection      | Key fields                                                                 |
|-----------------|----------------------------------------------------------------------------|
| `user`          | firstName, lastName, email (unique, lowercased), password (bcrypt, `select:false`), roles `USER`/`CONFIG_ADMIN`, refreshTokens[] (`select:false`) |
| `botProfile`    | botId, botName, botType, baseModel/embedModel/toolModel (embedded), instruction, vectorTable, kbsearchMethod, owner (embedded user), botUsers.users[], stats |
| `KnowledgeBase` | botId, fileName, fileSize, fileHash, type, content, source, downloadUrl     |
| `Tools`         | botId, name, description, type, endpoint, method, auth, pathVariable[], queryParam[], requestBody, systemPrompt, enabled |
| `llmModel`      | name (unique), provider, endpoint, meta.{contextWindow, modelType, inputPrice, outputPrice, inputType} |

### Vector table (PostgreSQL, per bot)

```sql
CREATE TABLE vector_table_<botId> (
  id         BIGSERIAL PRIMARY KEY,
  embedding  vector(768) NOT NULL,
  content    TEXT,
  metadata   JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()   -- maintained by trigger
);
CREATE INDEX ... USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 200);
```

768 dimensions is hard-coded to match `nomic-embed-text`. Changing the embedding
model to one with a different dimensionality requires recreating every table
(`bot.controller.ts` carries the literal `768`) — this is not a hypothetical:
pointing `EMBEDDING_MODEL` at a model with a different output size (e.g.
`qwen3-embedding:4b`, 2560-dim) without migrating existing tables produces a
`different vector dimensions` error the moment a query embedding is compared
against previously-stored 768-dim rows.

`vector_cosine_ops` (not `vector_l2_ops`) is required for the index to actually
be used: `searchVectors` orders by the `<=>` (cosine) operator, and Postgres
cannot satisfy a cosine ordering from an L2 index — every search was a
sequential scan until this was fixed. Existing tables need reindexing; run
`npm run migrate:hnsw-cosine` once (see
[migrations/rebuild-hnsw-cosine-indexes.ts](../server/src/migrations/rebuild-hnsw-cosine-indexes.ts)).

Isolation is **per bot, per table** — that is the confidentiality boundary.

---

## 7.1 Database access layer

```
src/config/env.ts     typed config; secrets and DB settings, validated at import
src/db/
  ├── pgsql.ts        pool lifecycle, withClient / withTransaction / query
  ├── errors.ts       transient vs deterministic Postgres error classification
  ├── init.ts         startup entry point (calls initPostgres)
  └── mongo.ts        mongoose connect/disconnect, pool + timeout options
src/util/retry.ts     generic backoff-with-jitter helper
```

### Configuration

All connection settings come from the environment. `DATABASE_URL` takes
precedence when set; otherwise the discrete `DB_HOST` / `DB_PORT` / `DB_USER` /
`DB_PASSWORD` / `DB_NAME` vars are used. Nothing is hard-coded — previously
`root/root@localhost:5432/poc` was baked into three places in `pgsql.ts`, which
made the app undeployable anywhere but a dev laptop.

Tunables (all optional, with defaults): `DB_POOL_MAX` (10),
`DB_POOL_IDLE_TIMEOUT` (30s), `DB_POOL_CONNECT_TIMEOUT` (10s),
`DB_STATEMENT_TIMEOUT` (30s), `DB_SSL`, `DB_AUTO_CREATE`,
`DB_RETRY_ATTEMPTS` (3), `MONGO_POOL_MAX` (10),
`MONGO_SERVER_SELECTION_TIMEOUT` (10s).

### Postgres API

| Helper | Use for |
|---|---|
| `query(sql, params)` | one-shot statements; retries transient failures |
| `withClient(fn)` | several statements needing the same connection |
| `withTransaction(fn)` | atomic work — BEGIN/COMMIT, ROLLBACK on throw |
| `getPool()` | escape hatch; throws if init has not run |

The pool is module-private. `getPool()` replaced the old
`export let appPool`, which consumers imported as a value — that only worked
because TypeScript emits CommonJS here and property access observed the
reassignment. Switching `module` to `esnext` would have silently broken every
vector query.

Both pools register an `error` listener. An idle client emitting `error`
without one **terminates the Node process**, and a Postgres restart triggers
exactly that.

### Retry policy

`retry()` takes a `shouldRetry` predicate; the DB layer passes
`isTransientDbError`, which allows connection failures (`ECONNRESET`, class 08),
deadlock and serialization failures (`40001`, `40P01`), resource exhaustion
(`53300`) and operator intervention (`57P0x`). Syntax errors, constraint
violations and data-type errors are **not** retried — unrecognised codes default
to no-retry so a real bug fails fast instead of hiding behind backoff.

Each attempt acquires a fresh client. The previous implementation retried on a
single already-acquired client, so a dropped connection failed all three
attempts identically — the retry could never help the one case it existed for.
Backoff is exponential with full jitter, so simultaneous failures do not
stampede a recovering server on wake.

### Identifier safety

Table names cannot be parameterised, so `vectors.service.ts` validates every
one against `/^[A-Za-z_][A-Za-z0-9_]*$/` before interpolation. Callers derive
names from `bot.vectorTable` (server-generated), never from a request body;
the guard is defence in depth. `dimensions` and `efSearch` are likewise checked
to be integers before being embedded in SQL.

---

## 8. Request lifecycle & conventions (server)

```
index.ts
  dotenv.config({ path: `.env.${NODE_ENV}` })
  express.json() → urlencoded → cookieParser() → cors(CLIENT_ORIGIN, credentials)
  GET /health                                ← public, reports dependency state
  app.use("/", authenticateJWT, router)      ← auth is global
  start(): await mongoCnnection() → await init() → listen()
  SIGTERM/SIGINT → close server → closePostgres() + closeMongo()
```

- **Auth**: see [§8.1](#81-authentication) below.
- **Responses**: always via `sendResponse({ res, success, message, data, status })`
  from [util/sendResponse.ts](../server/src/util/sendResponse.ts). Discriminated
  union types force `success: true` responses to use success status codes.
  Paginated payloads use `{ page, limit, total, data }`.
- **Controllers** are classes with arrow-function properties (so `this` survives
  being passed as an Express handler) and are instantiated once in
  [app.routes.ts](../server/src/routes/app.routes.ts).
- **Services** own the mongoose models; controllers never touch them directly
  (except `metadata.controller.ts`, which only reads the `botType` constant).

### 8.1 Authentication

Email + password login issuing a **short-lived access token** plus a **rotating
refresh token**. Implemented in
[token.service.ts](../server/src/services/token.service.ts),
[auth.service.ts](../server/src/services/auth.service.ts) and
[auth.controller.ts](../server/src/controller/auth.controller.ts).

| | Access token | Refresh token |
|---|---|---|
| Format | JWT, claims `{ sub, email, roles, typ:"access" }` | opaque 48-byte random value |
| Lifetime | 15 min (`ACCESS_TOKEN_TTL`) | 7 days (`REFRESH_TOKEN_TTL`) |
| Transport | `Authorization: Bearer` header | `httpOnly; SameSite=Strict; Path=/auth` cookie |
| Client storage | memory only (zustand, not persisted) | unreachable from JavaScript |
| Server storage | none (stateless) | SHA-256 hash in `user.refreshTokens[]` |

Why this split: an XSS payload can read anything in `localStorage`, so the
long-lived credential is kept in a cookie JS cannot touch, and the token that
*is* reachable expires in 15 minutes.

```
POST /auth/login  { email, password }
   │  bcrypt compare (runs even for unknown emails — constant-time-ish,
   │  so responses do not reveal which accounts exist)
   │  throttle: 10 failures per email+IP per 15 min → 429
   ▼
   ├─► body:   { accessToken, expiresIn, user }
   └─► cookie: rag_rt = <opaque>   httpOnly, SameSite=Strict, Path=/auth

… 15 minutes later, any API call ─► 401 { code: "TOKEN_EXPIRED" }
   │
   ▼
POST /auth/refresh          (cookie only; no Authorization header)
   │
   ├─ hash not found          → 401 SESSION_EXPIRED
   ├─ found but already spent → REUSE: revoke every session for that user
   │                            → 401 SESSION_REUSE_DETECTED
   ├─ past expiry             → 401 SESSION_EXPIRED
   └─ valid → mark spent (tombstone), issue a new pair, reset the cookie
```

**Rotation and reuse detection.** Each refresh consumes its token and returns a
new one. The consumed entry is kept as a *tombstone* until its original expiry
rather than deleted — that is what makes a replay distinguishable from an
unknown token. Presenting a spent token means it was captured, so every session
for that user is revoked.

**Session bookkeeping.** Tokens live in an array on the user document, so there
is no TTL index; `TokenService.prune` runs on every login and refresh to drop
expired entries. Live sessions are capped at `MAX_SESSIONS_PER_USER` (default 5,
oldest evicted) and tombstones at twice that, keeping the document bounded.

**Client integration** ([starGate.ts](../client/app/src/utils/starGate.ts)):
a response interceptor catches `TOKEN_EXPIRED`, refreshes once, and replays the
original request. Concurrent 401s are coalesced onto a **single in-flight
refresh** — without that, N parallel requests would trigger N rotations and all
but one would be rejected as reuse, logging the user out during normal use.
On page load `bootstrapSession()` performs one silent refresh, since the
in-memory access token does not survive a reload but the cookie does.

**Error codes** (`code` field on error responses): `TOKEN_MISSING`,
`TOKEN_EXPIRED`, `TOKEN_INVALID`, `INVALID_CREDENTIALS`, `ACCOUNT_DISABLED`,
`SESSION_EXPIRED`, `SESSION_REUSE_DETECTED`, `RATE_LIMITED`, `VALIDATION_ERROR`.

**Public routes** (no access token): `POST /users`, `POST /auth`,
`POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`. Everything else
requires a valid Bearer token.

> Authentication proves identity. Authorization (does this caller own this
> bot?) is a separate layer — see §8.2.

### 8.2 Authorization

[util/botAccess.ts](../server/src/util/botAccess.ts) is the ownership check
for bot-scoped resources (the bot itself, its KB entries, its tools). It is
called from the **service** layer, not controllers, matching this repo's
"services own the models" convention — a controller loads `req.user` (set by
`authenticateJWT`) and passes it through as `actor`; the service throws
`ForbiddenError` (mapped to 403) if the actor isn't allowed.

Two tiers:

| Tier | Who | Grants |
|---|---|---|
| **view** | owner, a `botUsers` member, `CONFIG_ADMIN`, or anyone when `bot.publicAccess` | read the bot, its KB entries, its tools |
| **manage** | owner, a `botUsers` member, or `CONFIG_ADMIN` | mutate the bot's KB/tools, and the bot's own settings |

Deleting the bot profile itself is narrower than "manage" — owner or admin
only, so a shared `botUsers` member can use and configure a bot's KB/tools but
cannot remove the bot out from under its owner (`assertCanDelete`).

Applied to: `bots` (create requires `owner` to match the caller unless admin;
read/update/delete check the target bot), `kb` (per-file and per-bot reads,
uploads, deletes — `GET /kb`, the unscoped list-all across every bot, is
`CONFIG_ADMIN`-only instead, since it has no single bot to check ownership
against), `tools` (reading a tool is treated as sensitive as reading the bot,
since a tool's stored `auth` can hold plaintext API keys/credentials).

**Not covered**: `/chat` and `/streamChat`'s removal aside, chatting with a
bot is still unauthenticated-by-bot — any authenticated user can converse
with any bot regardless of `publicAccess`/`botUsers`. This was left out of
this pass deliberately to avoid changing the primary demo flow's behavior;
closing it would mean threading `req.user` through
`ChatController.chatBot` → `ToolService.detectToolUse` /
`BotService.readByBotId` the same way the CRUD routes do.

### Endpoint map

| Area     | Endpoints |
|----------|-----------|
| Auth     | `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `POST /auth/logout-all`, `GET /auth/me`, `POST /auth` (deprecated alias) |
| Users    | `GET /users`, `GET /users/email/:email`, `GET /users/username/:userName`, `POST /users`, `PUT /users/email/:email`, `DELETE /users/email/:email` |
| Bots     | `GET /bots`, `GET /bots/:botId`, `GET /bots/owner/:owner`, `POST /bots`, `PUT /bots/:botId`, `DELETE /bots/:botId` |
| LLM      | `GET /llm`, `GET /llm/:llmId`, `POST /llm`, `PUT /llm/:botId`, `DELETE /llm/:botId` |
| KB       | `GET /kb` (CONFIG_ADMIN only — unscoped across every bot), `GET /kb/:id`, `GET /kb/bot-id/:botId`, `GET /kb/download/:id`, `POST /kb/upload/:botId`, `POST /kb/delete` |
| Chat     | `POST /chat` |
| Tools    | `GET /tools/bot/:botId`, `GET /tools/:id`, `POST /tools`, `PUT /tools/:id`, `DELETE /tools/:id` |
| Metadata | `GET /metadata/bot-type`, `GET /metadata/models` |

Runnable examples for each live in [server/Endpoints/](../server/Endpoints/)
(`.http` files — VS Code REST Client). Start with `demo.http` for the happy path.

---

## 9. Client architecture

```
client/app/src
├── main.tsx / App.tsx          RouterProvider over generated routeTree
├── routeTree.gen.ts            GENERATED by @tanstack/router-plugin — never edit
├── routes/
│   ├── __root.tsx              bare <Outlet/>
│   ├── (auth)/                 sign-in, sign-up   (public)
│   ├── (app)/
│   │   ├── route.tsx           sidebar shell + beforeLoad: ProtectedRoute
│   │   ├── (hub)/              hub-overview — bot cards, create-bot dialog
│   │   ├── (agents)/           agent-overview, agent-details/$botId (+ -tabs/),
│   │   │                       agent/tools/$toolId
│   │   └── (chat)/             chatbox/$botId — markdown + highlight.js rendering
│   └── -components/            shared app components (layout, formfields,
│                               dialogs, ai/ chat primitives)
├── shadcn/ui/                  generated shadcn primitives — regenerate, don't hand-edit
├── store/                      zustand: useStoreAuth, useThemeStore
└── utils/
    ├── starGate.ts             the axios instance + refresh interceptor —
    │                           all API calls go through it
    ├── AxiosInterceptor.tsx    (legacy, global axios; starGate is the live path)
    └── verifyAccessToken.ts    isAccessTokenValid() — jwt-decode expiry check
```

Routing follows TanStack file-based conventions:
- `(group)` — pathless grouping, does not appear in the URL.
- `-prefixed` folders/files (`-components`, `-tabs`) are **excluded** from routing.
- `$param` — dynamic segment, read with `Route.useParams()`.

Auth flow:
1. `App.tsx` calls `bootstrapSession()` before rendering the router — one silent
   `/auth/refresh` to recover the in-memory token after a reload.
2. `sign-in` posts to `/auth/login` and calls `setSession({ accessToken, user })`.
   Only `userProfile` is persisted to `localStorage` (`partialize`); the token
   stays in memory.
3. `starGate` attaches the token, and on `TOKEN_EXPIRED` refreshes once and
   replays the request, coalescing concurrent refreshes.
4. `(app)/route.tsx` blocks unauthenticated navigation in `beforeLoad` via
   `ProtectedRoute`, which retries a refresh before redirecting.
5. Logout posts to `/auth/logout` so the server revokes the token and clears
   the cookie, then clears local state.

---

## 10. Known gaps

Things the code does not yet do; useful context before extending it (see also
[todo.txt](../todo.txt), [server/improvement](../server/improvement),
[server/tobe.md](../server/tobe.md)).

### Still open

- **Secrets in the repo** — `.env.dev/.env.prod/.env.test` and `client/app/.env`
  are still tracked by git (a `.env.example` and `.gitignore` rules now exist,
  but the files were not untracked, and dev is actively depending on the
  tracked `.env.dev` right now — untracking/rotating needs a deliberate pass,
  not a drive-by edit). The WeatherAPI key in `.env.dev` and `Readme.md` should
  be rotated once that happens. Tool credentials are stored plaintext in Mongo.
- **Refresh tokens are per-user-document**, not a separate collection, so
  expiry relies on `prune` running rather than a Mongo TTL index. Sessions are
  therefore only cleaned up when that user next logs in or refreshes.
- **Ingestion rollback is not fully atomic.** The Postgres half now is — every
  chunk is embedded in memory first and written in a single
  `batchInsertVectors` statement, so a partway failure leaves nothing in
  Postgres to clean up (see §4). What's left: a crash between that insert
  committing and the Mongo `KnowledgeBase.create()` call still leaves vectors
  indexed with no corresponding Mongo record. Closing that fully would need a
  saga/outbox pattern across Mongo and Postgres, which don't share a
  transaction.
- **`/chat` has no per-bot authorization** — see §8.2's "Not covered".
- **No test framework, no linting, no CI on the client.** The server now has
  all three (§10 "Fixed", below); the client still has neither, and ~60
  pre-existing type errors (mostly in `agent.tools.$toolId.tsx` and the
  vendored `shadcn-io/ai` components) that `npm run build` will trip over.
- **`temp project/`** is an unrelated Postgres scratch app, not part of the system.

### Fixed

- **HNSW index now uses `vector_cosine_ops`**, matching the `<=>` operator
  `searchVectors` orders by — previously every similarity search was a
  sequential scan regardless of the index. New tables get this automatically;
  existing ones need `npm run migrate:hnsw-cosine` once (§7 has the details).
- **`TOP_K` and a distance cutoff are wired in** — `chat.controller.ts` passes
  `limit: TOP_K` (env, default 5) and `efSearch` to `searchVectors`, and drops
  chunks past `KB_MAX_DISTANCE` (env, optional) before they reach the model.
- **Authorization** — `util/botAccess.ts` + service-layer checks now cover
  bot/KB/tool CRUD; see §8.2.
- **Login throttling is Mongo-backed** (`LoginAttempt`, TTL-indexed on
  `resetAt`), not an in-process `Map` — a restart or a second instance no
  longer resets every lockout.
- **Upload filenames are sanitised consistently** — `uploadMiddleware.ts`
  already ran `path.basename` on both `botId` and the filename when writing;
  `knowledgebase.service.ts`'s `processFile` now does the same before it
  re-derives the file path for hashing, instead of trusting the raw param.
- **Dead code removed** — `models/tool.schema.ts`, `utils/AxiosInterceptor.tsx`,
  `generateStreamAnswer`, `promptImprovement`, and the `/streamChat` path
  itself are all gone.
- **Server has tests, linting, and CI** — Jest (`npm test`, mocked-model unit
  tests for `TokenService` rotation/reuse-detection and `botAccess`, plus pure
  tests for `renderTemplateByData`), ESLint (`npm run lint`), and
  `.github/workflows/ci.yml` running typecheck + lint + test on push/PR.
