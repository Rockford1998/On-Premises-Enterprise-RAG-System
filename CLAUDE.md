# On-Premises Enterprise RAG System — working guidelines

Self-hosted RAG platform. Users create bots, each with a private knowledge base
(pgvector) and optional HTTP tools; chat runs entirely against a local Ollama.

**Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) before changing anything
non-trivial** — it has the diagrams, the ingestion/query pipelines, the data model,
and a list of known gaps.

---

## Layout

```
client/app/     React 19 + Vite + TanStack Router + shadcn/ui + zustand
server/         Express 5 + TypeScript + mongoose + pg/pgvector
server/Endpoints/  .http request examples (VS Code REST Client) — keep in sync
docs/           architecture and long-form docs
temp project/   unrelated scratch app — ignore, do not extend
```

## Running it

```bash
# 1. databases
cd server/docker && docker compose up -d          # pgvector :5432, mongo :27017

# 2. models (Ollama must be reachable at OLLAMA_BASE_URL)
ollama pull nomic-embed-text
ollama pull mistral:latest

# 3. server  (reads .env.<NODE_ENV>, so pick a script — don't run src/index.ts bare)
#    Requires JWT_SECRET and JWT_REFRESH_SECRET; startup fails without them.
#    Generate: node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
cd server && npm install && npm run dev:start     # NODE_ENV=dev, nodemon, :3000

# 4. client
cd client/app && npm install && npm run dev       # :5173, VITE_BE_URL → :3000
```

`npm run test:start` / `npm run prod:start` swap in `.env.test` / `.env.prod`.
Build the server with `tsc` then `npm start`; build the client with `npm run build`.

First-time data setup: follow [server/Endpoints/demo.http](server/Endpoints/demo.http)
in order — create user → create bot → upload KB → chat. Bots need `llmModel`
documents matching `BASE_MODEL` / `EMBED_MODEL` to exist, or creation returns 400.

---

## Conventions

### Server

- **Layering is `controller → service → model`.** Controllers stay thin: parse the
  request, call one service, send a response. Never touch a mongoose model from a
  controller; never touch `req`/`res` from a service.
- **Every response goes through `sendResponse()`** ([util/sendResponse.ts](server/src/util/sendResponse.ts)).
  Don't hand-roll `res.json`. Paginated data uses `{ page, limit, total, data }`
  and passes `pagination: true`.
- **Controllers are classes with arrow-function properties.** Methods are passed
  directly to Express, so a regular method would lose `this`. Match the pattern.
- **All Ollama calls belong in `llmServices/`.** No `axios.post(.../api/generate)`
  scattered in controllers or services. Take the model name as a parameter —
  read it from the bot profile, fall back to env, never hard-code a model.
- **All raw SQL belongs in `VectorService`** ([services/vectors.service.ts](server/src/services/vectors.service.ts)).
  Parameterise values (`$1`, `$2`); table names are interpolated by necessity, so
  they must only ever come from `bot.vectorTable`, never from a request body,
  and must pass `assertSafeIdentifier` first.
- **Database access goes through [db/pgsql.ts](server/src/db/pgsql.ts)**:
  `query()` for one-shot statements, `withClient()` when several statements
  need the same connection, `withTransaction()` for atomic work. Never call
  `pool.connect()` directly — a missed `release()` leaks a client, and `max`
  leaks deadlock the pool with no error. See
  [§7.1 of ARCHITECTURE.md](docs/ARCHITECTURE.md#71-database-access-layer).
- **New endpoints** go in [routes/app.routes.ts](server/src/routes/app.routes.ts)
  under the right comment block, and get a matching entry in `server/Endpoints/*.http`.
- **Mongoose schemas** all live in [models/shared.model.ts](server/src/models/shared.model.ts).
  Add indexes for any field you filter on. (`models/tool.schema.ts` is dead — leave
  it alone or delete it, don't build on it.)
- **Async errors**: wrap handler bodies in try/catch, `console.error` with context,
  and return a `sendResponse` with a non-leaking message. There is no global error
  middleware yet.

### Auth

Full design in [§8.1 of ARCHITECTURE.md](docs/ARCHITECTURE.md#81-authentication).
The rules that matter when editing:

- **Never put the refresh token where JavaScript can read it.** It is an
  httpOnly cookie scoped to `/auth`; the access token is memory-only in
  zustand. Do not add either to `localStorage`, and do not add `accessToken`
  to the store's `partialize`.
- **Secrets have no defaults.** `config/env.ts` throws when `JWT_SECRET` or
  `JWT_REFRESH_SECRET` is unset. Keep it that way — a fallback literal is how
  the old code shipped a forgeable signing key.
- **Refresh tokens are stored hashed** (SHA-256) on the user document, with
  `select: false`. Any new query that needs them must opt in with
  `.select("+refreshTokens")`, and must not return them to a client.
- **Rotation keeps tombstones.** `prune()` deliberately retains revoked but
  unexpired entries; they are what makes reuse detection work. Do not "clean
  up" by filtering revoked entries on rotation.
- **Keep the client's single-flight refresh.** Concurrent 401s must share one
  `/auth/refresh` call. Parallel rotations look like token theft and will log
  the user out.
- New public endpoints must be added to `PUBLIC_ROUTES` in
  [auth.middleware.ts](server/src/middlewares/auth.middleware.ts); everything
  else is authenticated by default.
- Error responses carry a `code` (`ApiErrorCode`); branch on that, never on
  message text.

### Client

- **All API calls use `starGate`** ([src/utils/starGate.ts](client/app/src/utils/starGate.ts)).
  Never import bare `axios` in a component — you lose the auth header, the
  refresh-and-retry, and `withCredentials` (so the refresh cookie won't be sent).
- **`routeTree.gen.ts` is generated.** Never edit it. Add a file under `src/routes/`
  and let the Vite plugin regenerate.
- **Route file conventions**: `(group)` = pathless, `-prefixed` = not a route
  (shared components), `$param` = dynamic. Feature-local components go in a
  `-components`/`-tabs` folder next to the route; genuinely shared ones in
  `src/routes/-components/`.
- **`src/shadcn/ui/` is generated** by the shadcn CLI (`components.json`,
  new-york style, aliases `@/shadcn/*`). Add primitives via the CLI; put custom
  behaviour in a wrapper rather than editing the primitive.
- **Forms**: react-hook-form + zod via `@hookform/resolvers`, using the shared
  `FormInput`/`FormSelect`/`FormSwitch`/`FormTextArea` wrappers.
- **State**: zustand. `useStoreAuth` is persisted to `localStorage` under
  `store-auth`; server data stays in component state fetched via `starGate`.
- Use the `@/` alias, not deep relative paths.

### Both

- TypeScript strict is on server-side. Prefer explicit param objects
  (`fn({ botId, query })`) over positional args — that is the house style.
- Don't commit new secrets. The existing committed `.env*` files are a known
  problem; don't add to it.

---

## Things to know before you touch them

- **Embedding dimension 768 is hard-coded** in `bot.controller.ts`. Switching
  embedding models means migrating every `vector_table_*`.
- **Never re-introduce hard-coded connection settings.** All of them come from
  [config/env.ts](server/src/config/env.ts), which prefers `DATABASE_URL` and
  falls back to the discrete `DB_*` vars. Config is validated at import, so a
  malformed URL or a missing secret stops startup rather than surfacing later.
- **Retry only transient failures.** `retry()` needs a `shouldRetry` predicate;
  for database work pass `isTransientDbError`. Retrying a constraint violation
  or syntax error just returns the same failure three times slower — and
  retrying a write that may have partially succeeded can double-apply it.
- **Pools must have an `error` listener.** An idle client emitting `error`
  without one takes the whole process down.
- **Vector table per bot** (`vector_table_<botId>`) is the data-isolation boundary.
  Created on bot create, dropped on bot delete — keep both sides in sync.
- **KB dedup is by file hash.** Re-uploading identical content is intentionally a
  no-op; changing that affects `CheckIfkBPresentByFileHash` and the rollback path.
- **Ingestion rolls back** if any chunk fails: vectors deleted by hash, file
  removed, 500 returned. Preserve that if you touch `processFile`.
- **Tool failure falls through to RAG** in `chat.controller.ts` — deliberate.
- **`/streamChat` is a divergent legacy path** (no tool detection, reads
  `req.body.prompt`). Don't copy it; fold changes into `/chat` first.
- **No authorization checks exist.** Authentication is solid; authorization is
  absent. Any authenticated user can read or mutate any bot. If you add
  ownership checks, do it in the service layer against
  `botProfile.owner.email` / `botUsers.users`. `requireRole(...)` in
  [auth.middleware.ts](server/src/middlewares/auth.middleware.ts) is ready to
  use but not yet applied to any route.

## Backlog

Open items are tracked informally in [todo.txt](todo.txt),
[server/improvement](server/improvement) and [server/tobe.md](server/tobe.md);
the "Known gaps" section of [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
consolidates what is actually missing in code.
