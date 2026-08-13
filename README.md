<div align="center">

<img src="assets/picklo-logo.svg" alt="Picklo" width="520">

# Picklo V6.1

### Performance Update

<img src="https://img.shields.io/badge/Release-V6.1.0-5F56C9?style=for-the-badge" alt="V6.1">
<img src="https://img.shields.io/badge/Startup-Automatic-2F8A5C?style=for-the-badge" alt="Automatic startup">
<img src="https://img.shields.io/badge/Inference-Web_Worker-202020?style=for-the-badge" alt="Web Worker">
<img src="https://img.shields.io/badge/Fast_Model-SmolLM2_360M-5367E8?style=for-the-badge" alt="Fast model">

</div>

---

## What changed

Picklo V6.1 is focused on one thing: **making local AI feel faster**.

### Automatic model startup

The user no longer has to open Settings and manually start a model.

Picklo now:

```text
Page opens
   ↓
Interface renders immediately
   ↓
Fast local model starts automatically in background
   ↓
Model is cached by the browser
   ↓
Composer becomes ready
```

The default Fast profile uses **SmolLM2 360M q4f16** when the current WebLLM runtime exposes it.

### Important first-run behavior

A browser-local model still has to be downloaded at least once. V6.1 cannot remove that network transfer, but it reduces the first-run cost by choosing a much smaller model and starts the download automatically instead of making the user initiate it manually.

After caching, later starts should reuse the browser cache.

## Performance profiles

### Fast

```text
Model preference   SmolLM2 360M
Recent messages    8
File context       ~2,400 characters
Max response       320 tokens
```

Designed for immediate everyday chat.

### Balanced

```text
Model preference   Llama 3.2 1B
Recent messages    14
File context       ~4,500 characters
Max response       600 tokens
```

Better answer quality while staying reasonably responsive.

### Quality

```text
Model preference   SmolLM2 1.7B
Recent messages    20
File context       ~7,000 characters
Max response       900 tokens
```

For tasks where response quality matters more than speed.

## Web Worker inference

V6.1 moves WebLLM inference into:

```text
webllm-worker.js
```

The worker performs the heavy model work away from the main UI thread.

This reduces competition between inference and:

- typing;
- scrolling;
- streaming updates;
- opening sheets;
- other Picklo interface interactions.

## Smarter document retrieval

V6 searched local files on every message.

V6.1 only retrieves local documents when:

- Analyze mode is active; or
- the message refers to files, PDFs, uploads, attachments or documents.

Normal chat therefore avoids unnecessary retrieval work.

## Shorter prompt processing

Prompt history is now determined by the selected performance profile rather than always sending a large fixed history.

This reduces the amount of conversation text the model must process before it can begin answering.

## Generation speed display

When WebLLM reports completion-token usage, Picklo displays an approximate:

```text
12.4 tok/s
```

next to the selected performance mode.

## Existing capabilities retained

V6.1 keeps:

- white light mode;
- charcoal dark mode;
- larger typography;
- flat non-neon UI;
- persistent chats;
- memory;
- notes;
- local files;
- file retrieval;
- Calculator;
- JavaScript sandbox;
- General / Write / Code / Analyze modes;
- Copy / Regenerate;
- fixed header and composer;
- streaming responses.

## V6 → V6.1 migration

When no V6.1 state exists, Picklo imports the existing V6 state.

Chats, memory, notes, theme, selected model and preferences remain available.

---

<div align="center">

<img src="assets/picklo-mark.svg" alt="Picklo" width="76">

### Picklo V6.1

**Open Picklo. The AI starts itself.**

</div>
