# Picklo V2

Picklo V2 is a local-first browser AI built with vanilla HTML, CSS and JavaScript on top of WebLLM.

## V2 features

- Local in-browser LLM inference through WebGPU
- Runtime-aware model selector
- Model switching with `MLCEngine.reload()`
- Streaming responses
- Stop generation
- Multiple saved conversations
- Automatic local chat titles
- Persistent editable memory
- `remember that ...` memory capture
- Markdown rendering
- Formatted code blocks with copy buttons
- Export / import local AI data
- Installable PWA shell
- Responsive desktop and mobile UI
- GitHub Pages compatible
- No application backend required
- No OpenAI API key required

## Run in VS Code

Do not open `index.html` directly with a `file://` URL.

Use a local web server such as VS Code Live Server:

1. Open this project folder in VS Code.
2. Install the **Live Server** extension if necessary.
3. Right-click `index.html`.
4. Choose **Open with Live Server**.
5. Select a model.
6. Press **Load AI**.

A WebGPU-capable browser is required.

## Deploy to GitHub Pages

1. Create a GitHub repository.
2. Upload the project files to the repository root.
3. Open **Settings → Pages**.
4. Set **Source** to **Deploy from a branch**.
5. Select `main` and `/ (root)`.
6. Save.

## How memory works

V2 stores explicit memory in browser `localStorage`. Saved memory is added to the system prompt before generation.

You can either:

- Open **Memory** from the sidebar and add or delete notes.
- Type a chat message beginning with `remember that ...`.

Memory is local to that browser profile. It is not synced to a server.

## How chat persistence works

Each conversation is stored in browser `localStorage`. The sidebar lets you reopen and delete chats.

Use **Data → Export data** to create a JSON backup.

## Models

V2 checks `webllm.prebuiltAppConfig.model_list` at runtime and only shows preferred models that are actually available in the WebLLM build loaded by the page.

The default preferred list includes:

- Llama 3.2 1B
- SmolLM2 1.7B
- Llama 3.2 3B
- Phi 3.5 Mini

Larger models require substantially more GPU memory.

## Project structure

```text
picklo-v2/
├── index.html
├── styles.css
├── app.js
├── app-icon.svg
├── manifest.webmanifest
├── sw.js
└── README.md
```

## Recommended V3 direction

V3 should move from **chat AI** to **AI agent**:

- File uploads and document Q&A
- Local RAG / knowledge base
- Tool registry
- Calculator tool
- Browser search connector
- Code/file generation tools
- Agent planning loop
- Task execution history
- Permission system for actions
