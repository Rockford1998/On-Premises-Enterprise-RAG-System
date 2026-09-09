# Tool Design

Working notes on the `Tools` feature: how a bot's HTTP/database tools are
configured, detected, and executed. Companion to
[ARCHITECTURE.md](ARCHITECTURE.md) — this file goes deeper on tools
specifically and tracks what's shipped vs. still designed-only.

---

## 1. Data model

`Tools` collection ([server/src/models/shared.model.ts](../server/src/models/shared.model.ts)):

```
botId, name, description, category
type: "API" | "DATABASE"
parameters: { type, properties, required }   // sent to the LLM for tool-detection
enabled, systemPrompt

// API tools
endpoint, method, headers
auth: { type: none|basic|bearer|apiKey, username, password, apiKey,
         apiKeyLocation, apiKeyName, fixedParams }
pathVariable[]:  { name, description, type, required }
queryParam[]:    { name, description, type, required, defaultValue }
requestBody:     { contentType, schema, example }
```

`pathVariable` / `queryParam` / `requestBody` declare **where** each
execution-time argument goes. `parameters.properties` is the flat shape sent
to the LLM for tool *detection* — it's derived from the three sections above,
not maintained separately (see §3).

---

## 2. Request flow

```
/chat  →  ChatController.chatBot
             │
             ├─ ToolService.detectToolUse(botId, query)
             │     asks TOOL_MODEL (Ollama) whether a configured tool
             │     applies, returns { tool, params } or null
             │
             ├─ ToolService.toolExecution({ tool, args: params })
             │     API  → routeToolArgs() + httpCall()
             │     DATABASE → not implemented (see §5)
             │
             ├─ improveTheToolAnswer(query, toolResponse.content, systemPrompt)
             │     turns the raw tool result into a chat answer
             │
             └─ on any tool failure → falls through to normal RAG
                (deliberate — see CLAUDE.md "Things to know")
```

---

## 3. API tool execution — shipped

Implemented in [server/src/services/tool.service.ts](../server/src/services/tool.service.ts).

**`detectToolUse`** sends the model the tool's `pathVariables`, `queryParams`,
and `requestBody` schema (previously only `parameters` was sent, so the model
had no idea these existed and routinely omitted required args). The prompt
asks for a single flat `params` object keyed by the argument names declared
across all three.

**`routeToolArgs({ tool, args })`** takes that flat object and routes each
value to where it actually belongs, by matching argument names against the
tool's own declarations:

- `pathVariable` matches → substituted into the endpoint (`:name` and
  `{name}` placeholder styles both supported)
- `queryParam` matches → appended to the query string; `defaultValue` fills
  in when the model omits an optional one
- `requestBody.schema.properties` matches → placed in the body
- anything unmatched → passed through as query (GET) or body (else), instead
  of silently dropped
- any field marked `required` that never got a value → collected into
  `missing[]`

**`toolExecution`** validates `missing` first (returns a clear error instead
of sending a malformed request, e.g. `/users/undefined`), builds auth headers
(`getToolAuthHeaders`), merges `tool.auth.fixedParams` (admin-configured
static values — was previously read from the wrong path, `tool.fixedParams`,
a silent no-op) with the routed query/body data, and calls `httpCall`. The
response is JSON-stringified and truncated to 28,000 chars before being
handed to `improveTheToolAnswer`.

If `toolResponse.error` is set, `chat.controller.ts` throws so the existing
catch block falls through to RAG, rather than answering from an error string.

**Tests:** [tool.service.routeToolArgs.test.ts](../server/src/services/__tests__/tool.service.routeToolArgs.test.ts)
— path substitution (both placeholder styles), missing required path/body
params, query `defaultValue`, unmatched-arg passthrough.

**Not yet done:** `DATABASE`-type tools return
`{ error: "Unsupported tool type" }` — see §5.

---

## 4. Tool configuration UI — shipped

[client/app/src/routes/(app)/(agents)/agent.tools.$toolId.tsx](../client/app/src/routes/(app)/(agents)/agent.tools.$toolId.tsx)

Previously the edit-tool form only exposed a generic `parametersList` (mapped
straight to `parameters.properties`) with no way to configure
`pathVariable`/`queryParam`/`requestBody` — so nothing the backend now routes
by declared name could actually be set through the UI.

Rebuilt as three typed `useFieldArray` sections mirroring the schema exactly:

- **Path Variables** — name / type / description / required
- **Query Parameters** — adds `defaultValue`
- **Request Body** — content-type selector + typed fields; only rendered for
  methods that carry a body (hidden for GET/DELETE)

`parameters.properties` (the LLM-facing shape) is derived from these three on
submit — one source of truth instead of a hand-maintained duplicate list.

Also fixed: the form's `type` enum was `"database"` (lowercase); the Mongoose
schema enum is `"DATABASE"`. This mismatch was the root cause of a cascading
`tsc` "two different types with this name exist" error across the whole file
(a `required?: boolean` vs `required: boolean` conflict from a zod
`.default(false)`, which zodResolver's inferred type didn't structurally
match against the shared `FormInput`/`FormSelect` components' plain
`UseFormReturn<T>`). Fixed by using a plain `z.boolean()` with explicit
defaults instead of `.default()`.

A `DATABASE`-type tool currently shows a notice that execution isn't
implemented yet, rather than presenting a form that silently does nothing.

---

## 5. DATABASE tool execution — designed, not built

### Why this is a different risk class than API tools

An API tool's worst case is hitting a URL with wrong params. A tool that lets
the model influence *SQL* opens directly onto injection and data
exfiltration — a chat message can be phrased to steer the model into reading
or touching rows well outside what the bot was meant to expose. This app also
has **no per-bot authorization yet** (see ARCHITECTURE.md "Known gaps") and
stores tool credentials in plaintext in Mongo — both existing gaps, not
things this feature should paper over or make worse.

### Chosen approach: free-form NL-to-SQL with enforced guardrails

(As opposed to a parameterized-template approach — admin pre-writes a fixed
query with named placeholders, model only fills in values — which would be
safe by construction but less flexible. Free-form was chosen; the guardrails
below exist because of that choice.)

**1. Connection config** — new fields on `Tools`, `type: "DATABASE"` only:

```
dbConnection: { host, port, database, user, password, ssl }
```

A **separate, tool-owned connection** — never the app's own `getPool()` /
pgvector database. The whole point is querying an external database (orders,
CRM, etc.), not the app's own internal tables (KB content, users, tools —
querying those via a chat-exposed tool would be a severe internal-data leak).

**2. Schema awareness** — on tool save, introspect the target DB's
`information_schema` for admin-allowlisted tables (or let the admin
select/paste which tables are in scope) and store a compact schema summary
on the tool. Only the allowlisted tables are ever shown to the model — not
the whole database.

**3. Guardrails enforced in code before execution** (not just prompted —
prompt instructions are not a security boundary):

- **Read-only DB role required.** A Postgres role with `SELECT`-only grants
  on the allowlisted tables. DB-side, not app-side — holds even if every
  other check below has a bug.
- **Statement allowlist.** Reject anything that isn't a single `SELECT`
  before it reaches `pg`: no `;` (multi-statement), no
  `INSERT/UPDATE/DELETE/DROP/ALTER/GRANT/COPY/pg_*`, case-insensitive.
- **Table allowlist.** Reject a query that references any table outside the
  tool's configured allowlist.
- **Row + time limits.** Force-append `LIMIT n` if the model's query didn't
  include one; reuse the `statement_timeout` pattern already established in
  [db/pgsql.ts](../server/src/db/pgsql.ts) for this tool's own pool.
- **Separate pool per external connection**, cached by connection string —
  reusing the *pattern* from `pgsql.ts` (`withClient`, mandatory pool `error`
  listener, retry-on-transient-only), not the app's own pool instance, since
  these are arbitrary external databases the app doesn't manage.

**4. Execution flow**, mirroring the API branch in `toolExecution`:

```
detectToolUse (DATABASE tool)
  → sends the allowlisted schema summary, asks the model for a single
    SQL SELECT string as the tool "param"

toolExecution (new DATABASE branch)
  → validate against statement + table allowlist  →  reject with a clear
    error if it fails (same "falls through to RAG" behavior as a missing
    required API param)
  → run via the tool's own pool, with statement_timeout
  → truncate/return results the same way API responses are truncated today
```

### Open questions before implementation starts

- Where do `dbConnection` credentials live — same plaintext-in-Mongo pattern
  as `auth.password`/`auth.apiKey` today, or does this feature earn fixing
  that properly (encryption at rest / secrets manager)?
- Is table-allowlist enforcement done by parsing the SQL (fragile — needs a
  real SQL parser, not regex) or by running every query through a DB role
  that can only see the allowlisted tables in the first place (`GRANT` at
  the Postgres level, `search_path` tricks, or per-table views)? The latter
  is more robust and pushes the boundary into the database itself rather
  than into app-side parsing.
- Does `LIMIT` injection need real SQL parsing too (a subquery or CTE can
  make naive string-append wrong), or is a simpler heuristic acceptable for
  a first version?

---

## 6. "Code interpreter" — shipped, but as Knowledge Base ingestion, not a Tool

Worth flagging explicitly: despite being requested as a "code interpreter
tool," this is **not** a `Tools` entry and doesn't go through
`detectToolUse`/`toolExecution` at all. It's a new *upload format* for the
existing Knowledge Base pipeline — the answer to "upload a codebase and ask
issue-resolution questions" turned out to be "let code be RAG context," not
"let the model execute code." No code from the archive is ever run.

**Flow:** upload a `.zip` via the same `/kb/upload/:botId` endpoint used for
PDFs/DOCX today → [uploadMiddleware.ts](../server/src/middlewares/uploadMiddleware.ts)
now accepts the `.zip` extension → `knowledgebase.service.ts`'s `processFile`
detects the `.zip` extension and branches to `processZipFile` instead of the
single-document `readFile` path.

**Extraction:** [util/extractZipEntries.ts](../server/src/util/extractZipEntries.ts)
reads every entry, keeping only common source/text extensions (`.ts .py .go
.md .json .css` etc.), and skips:

- noise directories — `node_modules`, `.git`, `dist`, `build`, `vendor`,
  `.next`, `venv`, `__pycache__`, `coverage`, `target`, `.idea`, `.vscode`
- entries over 2 MB
- entries whose content contains a NUL byte (mis-tagged binary asset)
- more than 500 entries total (zip-bomb guard)

**Ingestion:** each surviving entry becomes its **own independent KB
document** — same dedup-by-hash, chunk, embed, and store path a single
uploaded file goes through today, factored out of `processFile` into a
shared `ingestText` helper so both paths behave identically. The entry's
content is hashed directly (no on-disk file to hash, unlike a normal upload),
and its KB `fileName` is qualified as `<archive>.zip/<path-inside-zip>` so
two different zips can both contain `index.ts` without colliding.

**Per-entry failure isolation:** unlike a single-file upload (still
all-or-nothing — one failure rolls back the whole thing), one bad or
duplicate file inside a 200-file archive does **not** discard the 199 that
already succeeded. `processZipFile` aggregates `created`/`duplicate`/`failed`
counts and returns a summary message; the archive itself is only rolled back
if *nothing* in it landed.

**Chat-time behavior:** completely unchanged — extracted code is retrieved
through the bot's existing vector search / RAG flow in `chat.controller.ts`,
same as any other KB chunk. "What's the standard way to resolve X" works
because the model has the actual source in context, not because of any new
reasoning path.

**Tests:** [util/__tests__/extractZipEntries.test.ts](../server/src/util/__tests__/extractZipEntries.test.ts)
— extraction with relative paths, noise-dir skipping, extension allowlist,
binary detection, empty-archive handling.

**Dependency added:** `adm-zip` (+ `@types/adm-zip`).
