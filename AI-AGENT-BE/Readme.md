# On-Premises Enterprise RAG System

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
