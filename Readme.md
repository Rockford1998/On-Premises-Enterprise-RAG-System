# On-Premises Enterprise RAG System

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — system architecture, ingestion and
  query pipelines, data model, endpoint map, known gaps
- [CLAUDE.md](CLAUDE.md) — how to run the stack and the conventions to follow when
  contributing

## Features

- **On-premises solution** - Deployed within your own infrastructure
- **User-specific bot profiles**:
  - Currently no limit (will be added in future)
  - Each user maintains their own vector table for data confidentiality
  - Bots can be shared by adding other users
- **Three model architecture**:
  1. **Base model**: Generates final answers using context from vector DB
  2. **Tool model**: Decides which model to call
  3. **Embedding model**: Generates vectors for storage in vector DB
- **Supported file formats**: PDF, DOCX, DOC, PPTX, and TXT
  - Only text content is vectorized and stored in knowledgebase

## Technology Stack

- **Node.js**: v21.7.3
- **AI Models**:
  - Ollama (mistral:latest and nomic-embed-text)
- **Databases**:
  - pgvector (for vector storage)
  - MongoDB (for document storage)

## Setup Instructions

### 1. Databases

```bash
cd server/docker
docker compose up -d          # pgvector on :5432, MongoDB on :27017
```

### 2. Ollama models

Ollama must be reachable at `OLLAMA_BASE_URL` (default `http://localhost:11434`),
either installed natively or as a container:

```bash
docker run -d --gpus all -v ollama:/root/.ollama -p 11434:11434 ollama/ollama
```

Pull the models. **These names must match `BASE_MODEL` and `EMBED_MODEL` in your
`.env` exactly** — the app looks them up by name:

```bash
ollama pull nomic-embed-text      # embedding model
ollama pull mistral:latest        # answer + tool model
ollama list                       # verify both are present
```

Skipping this is the most common first-run failure: document upload returns
`404` from the embeddings endpoint because the model was never pulled.

### 3. Server

```bash
cd server
npm install
cp .env.example .env.dev          # then fill it in
```

`JWT_SECRET` and `JWT_REFRESH_SECRET` are **required** — the server refuses to
start without them:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Then:

```bash
npm run dev:start                 # NODE_ENV=dev, http://localhost:3000
```

On startup the models named in your `.env` are auto-registered in the
`llmModel` collection, so bot creation works without any manual database setup.
Check `GET /health` — both dependencies should report `up`.

### 4. Client

```bash
cd client/app
npm install
npm run dev                       # http://localhost:5173
```

The client's `VITE_BE_URL` must point at the server, and the server's
`CLIENT_ORIGIN` must list the client's origin — credentialed CORS rejects a
wildcard, so a mismatch shows up as a failed login.

## Workflow of the application

Sign up → create a bot → upload documents → chat.

[server/Endpoints/demo.http](server/Endpoints/demo.http) walks the whole path as
runnable requests, including the prerequisites and the expected failure cases.

**Bot types**
- `KB_Bot` — gets its own vector table; answers only from uploaded documents and
  says so when it finds nothing relevant.
- `General_Purpose` — no retrieval; answers from the model's own knowledge.

**Troubleshooting**

| Symptom | Cause |
|---|---|
| `Base/Embedding model "x" is not registered` | `BASE_MODEL`/`EMBED_MODEL` names no record in `llmModel`. Check `GET /llm`. |
| Upload fails, log shows `404` from Ollama | Model not pulled. Run `ollama pull <name>`. |
| Server exits on startup | `JWT_SECRET` or `JWT_REFRESH_SECRET` missing from `.env.<NODE_ENV>`. |
| `/health` reports `degraded` | Postgres or MongoDB container is not running. |
| Login succeeds in curl but fails in the browser | `CLIENT_ORIGIN` does not match the client's origin. |

## Tools

### API tool

- api can have parameters (query params or path veriables)
- can have a authentication like "Api key" or "Basic Auth" or "Bearer token"

```json
{
  "botId": "bot_mfv2vn5t_ZTPOE4",
  "name": "get_weather",
  "description": "Fetches the current weather for a given city.",
  "type": "http",
  "endpoint": "http://api.weatherapi.com/v1/current.json",
  "method": "GET",
  "headers": {},
  "auth": {
    "type": "apiKey",
    "apiKey": "9dcc878a11b44fd7987194020252612",
    "apiKeyLocation": "query",
    "apiKeyName": "key"
  },
  "queryParam": {
    "name": "q",
    "description": "The city name to get weather for.",
    "type": "string",
    "required": true,
    "defaultValue": ""
  },
  "enabled": true,
  "systemPrompt": "You are a helpful assistant that explains weather information in a clear, conversational way.\nYou will be given raw weather API JSON data.\nYour job:\n- Summarize the weather conditions in a natural sentence.\n- Include location, temperature (in °C), condition (sunny, cloudy, rainy, etc.), wind speed & direction, and humidity.\n- Mention \"feels like\" temperature if it is different from actual.\n- If available, add air quality index in simple terms (e.g., \"Good\", \"Moderate\", \"Unhealthy\").\n- Do not show raw JSON or technical details.\n- Keep the response concise and friendly."
}
```
