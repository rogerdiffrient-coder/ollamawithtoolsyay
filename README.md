# Ollama Chat

A tiny browser chat client for a local Ollama server.

## Run

1. Start Ollama.
2. Open `index.html` in a browser.
3. The app automatically reads `/api/tags` and fills the model dropdown with every installed model.
4. Pick a model and chat.

The app uses Ollama's local API at `http://localhost:11434` and streams responses from `/api/chat`.

### Browser access

If your browser blocks the page because of CORS, start Ollama with the page's origin allowed via `OLLAMA_ORIGINS`, or serve the folder from a local web server and allow that origin. No API key is needed because the app talks directly to your local Ollama instance.
