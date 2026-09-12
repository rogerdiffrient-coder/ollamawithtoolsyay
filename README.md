# Ollama Chat

A polished, dependency-free browser chat client for a local Ollama server.

## Features

- Automatically detects every installed Ollama model with `/api/tags`
- Streaming responses from `/api/chat`
- Multiple conversations
- Persistent chat history using browser `localStorage`
- Chat search
- Automatic chat titles from the first message
- Memory system:
  - The current conversation supplies its recent context
  - Older current-chat content is compressed into an AI-generated summary
  - Previous chats contribute their summaries
  - The `remember` tool searches saved chats and returns the nearby conversation around matches
- The AI is explicitly told that it can call `remember` when it needs older context
- Responsive desktop/mobile layout
- No Node.js, Python, packages, build step, or API key required

## Run

1. Start Ollama.
2. Open `index.html` in a browser.
3. The model selector automatically loads models from `http://localhost:11434/api/tags`.
4. Start chatting.

## Memory

Memory is stored locally in the browser that is running the app. Each chat stores its messages and a rolling summary of older messages.

For each request, the AI receives recent conversation context plus current/previous chat summaries. When it needs something more specific, it can call `remember(query)`; the app searches the saved conversations and gives the AI a small window around matching messages.

This is intentionally local: the memory is not uploaded to a third-party service by this app.

## Browser access / CORS

If the browser blocks requests because of CORS, configure Ollama's `OLLAMA_ORIGINS` to allow the origin where this page is being served, or serve the folder from a local web server and allow that origin. No API key is needed because the app talks directly to your local Ollama instance.
