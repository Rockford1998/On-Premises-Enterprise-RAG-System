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

1.  Install dependencies:
    ```bash
    npm install
    ```
2.  Start database containers:
    ```bash
    cd docker
    docker-compose up -d
    ```
3.  Set up Ollama AI models:

- # Start Ollama container

  ```
  docker run --gpus all -v ollama:/root/.ollama -p 11434:11434 ollama/ollama
  ```

- # In container bash (or using docker exec):

  ```
  ollama pull nomic-embed-text
  ollama pull mistral:7b
  ```

4.  Launch application:

    ```
    npm run dev
    ```

## Workflow of the application

- please follow the demo.http endpoints and accordingly setup the user profile -> bot profile -> knowledge base

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
