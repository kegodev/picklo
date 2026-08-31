<div align="center">

<img src="assets/picklo-logo.svg" alt="Picklo" width="520">

# Picklo V8.1

<img src="https://img.shields.io/badge/Release-V8.1.0-5F56C9?style=for-the-badge" alt="V8.1">
<img src="https://img.shields.io/badge/Agent-Private_Tools-2F8A5C?style=for-the-badge" alt="Private agent tools">
<img src="https://img.shields.io/badge/Startup-Automatic-202020?style=for-the-badge" alt="Automatic startup">
<img src="https://img.shields.io/badge/Inference-Web_Worker-5367E8?style=for-the-badge" alt="Web Worker">

### [Open Picklo Live](https://kegodev.github.io/picklo/)

<br>

<img src="assets/picklo-v7-preview.png" alt="Picklo V7 interface" width="100%">

</div>

---

## V8.1 answer consistency and mobile startup update

Picklo V8.1 adapts local inference to the device and turns explicit user constraints into a checked response contract.

- **Required accounts:** users sign in or create an account with Supabase Auth before Picklo starts.
- **Per-user cloud chats:** conversations and messages sync through dedicated Picklo tables in the existing 015 Closet Supabase project.
- **Private row access:** row-level security limits every conversation and message to its authenticated owner.
- **Store isolation:** Picklo uses separate tables and does not read or change 015 Closet products, orders, customers or inventory.
- **Phone-adaptive models:** Balanced uses the capable 1B model on phones, while Quality uses 1.7B instead of forcing the 3B desktop default.
- **Low-memory fallback:** when an automatically selected model cannot start, Picklo retries progressively lighter available models instead of leaving the chat unusable.
- **Persistent manual override:** advanced users can still choose a model manually; the override remains until the Performance profile changes.
- **Requirement checklist:** explicit instructions such as “must,” “only,” “include,” “avoid,” and bulleted constraints are carried into generation and final verification.
- **Stable factual answers:** technical, analytical and constraint-heavy prompts use more deterministic sampling, while creative writing keeps its expressive settings.
- **Targeted Balanced verification:** complex constrained, code, analytical and high-stakes answers receive a private correction pass without doubling every ordinary phone response.

## V8 contextual intelligence update

Picklo V8 improves intelligence at the application layer while preserving private local inference.

- **Context-aware follow-ups:** a compact dialogue-state packet identifies recent goals and helps resolve references such as “it,” “that,” “continue,” and “same as before.”
- **Natural language nuance:** the model is explicitly guided to interpret idioms, figurative language, understatement, frustration and likely sarcasm from context.
- **Structured reasoning:** complex requests are internally represented as goals, facts, constraints, unknowns and required outputs before the final answer is checked.
- **Stronger inference:** analytical questions must consider a plausible alternative explanation and keep conclusions proportional to the available evidence.
- **Broader knowledge retrieval:** synonym-based query expansion finds relevant passages even when a book, article or expert source uses different terminology from the question.
- **Balanced sources:** conflicting expert views are represented fairly, with supplied primary or authoritative material preferred over unsupported claims.
- **Honest scope:** V8 does not claim that a browser app has retrained its foundation model; users broaden its working knowledge by adding local books, articles and documents.

## V7.4 intelligence, startup and PWA update

Picklo V7.4 strengthens the local assistant while keeping the app responsive on ordinary devices.

- **Authenticated model warmup:** model hydration starts automatically after the signed-in session and private conversations are restored.
- **Persistent model cache:** Picklo requests persistent browser storage and reuses WebLLM model files on later visits and home-screen launches.
- **Stronger defaults:** Fast uses a capable 1B model, Balanced uses 1.7B, and Quality uses the strongest preferred 3B model.
- **Quality verification:** complex answers in Quality mode receive a private second-pass review for missed requirements, contradictions, unsafe advice and incomplete code.
- **Honest current information:** Picklo no longer invents live news, prices, citations, URLs or other changing facts it cannot verify.
- **Better conversation context:** recent messages are selected using both message and character budgets, preserving useful continuity without uncontrolled prompt growth.
- **Improved document retrieval:** local file passages are ranked with BM25-style term weighting, phrase bonuses, filename relevance and upload priority.
- **Validated file generation:** invalid JSON, XML, SVG and unbalanced code artifacts can be repaired privately before the download card is returned.
- **Real Word files:** Word requests now produce `.docx` Open XML documents instead of only Word-compatible HTML files.
- **Home-screen identity:** Apple touch, 192px maskable and 512px maskable icons use the Picklo mascot when the PWA is installed.
- **Calmer interface:** improved reading width, typography, focus states, reduced-motion support, mobile safe-area handling and a copyright notice confined to Settings.

## V7.2 answer-quality and privacy update

Picklo now performs calculations and safe code preparation privately, then shows the finished answer instead of exposing tool status, scratch work, or execution badges.

- **More reliable answers:** lower sampling temperatures and stronger verification instructions reduce guessing.
- **Exact arithmetic:** percentage questions, word operations, exponent syntax and ordinary expressions route through the deterministic local calculator.
- **Private processing:** calculation, code and model activity stay hidden from the conversation.
- **File-only visibility:** tool activity is shown only when Picklo actually returns a downloadable file.
- **Cleaner code handling:** JavaScript can be prepared without automatically opening the sandbox.
- **Visible uploads:** attached documents appear as file cards in chat and update to show when they were analyzed.
- **Automatic document context:** newly uploaded PDF, Word, rich-text, text and code documents are included in the next response.
- **Downloadable results:** Picklo can return HTML, CSS, JavaScript, TypeScript, Python, PDF, Word-compatible, Markdown, JSON, CSV, XML, YAML, SQL and many other code/text files.
- **Refined dark mode:** a calm charcoal, soft-white and muted-grey palette replaces the previous robotic black-and-purple treatment.

## V7.1 performance update

Picklo now starts its local model immediately after the first painted frame, keeps repeat visits fast with a stale-while-revalidate app shell, uses leaner prompt budgets, and batches streamed text updates to reduce main-thread work.

- **Faster startup:** no browser-idle delay before model loading.
- **Faster repeat visits:** cached app files render immediately while updates refresh in the background.
- **Smoother streaming:** the interface redraws at a controlled interval instead of once per token.
- **Leaner inference:** Fast, Balanced and Quality modes send smaller histories and response budgets.

## V7 is the agent foundation

V6.1 made Picklo faster. V7 adds a controlled routing layer that decides when a safe built-in tool should handle part of a request.

The default router is intentionally application-level. Small fast models do not need to produce tool-call JSON for basic tasks such as arithmetic, date/time, notes, memory, or local-file retrieval.

```text
User message
    │
    ▼
Picklo Agent Router
    │
    ├── Calculator ───────────────► direct result
    ├── Local date/time ──────────► direct result
    ├── Notes ────────────────────► save/read locally
    ├── Memory ───────────────────► save locally
    ├── File search ──────────────► retrieve context
    ├── Code request ─────────────► prepare sandbox
    │
    └── General request
             │
             ▼
       Local language model
```

## Automatic safe tools

With **Agent tools = On**, normal chat can now invoke supported local tools automatically.

### Calculator

```text
sqrt(144) + 12 * 3
```

Picklo routes the expression to its local calculator parser instead of asking the language model to guess the arithmetic.

### Local date and time

```text
what time is it?
what is today's date?
```

Picklo reads the browser device's local clock directly.

### Memory

```text
remember that I prefer concise answers
```

V7 saves the detail to persistent Picklo memory immediately.

### Quick notes

```text
save a note: redesign the landing page tomorrow
show my notes
```

Quick notes remain separate from AI memory.

### Local file search

```text
search my files for nitrate results
according to my PDF, what was the conclusion?
```

V7 invokes local document retrieval first and then gives the relevant passages to the language model.

### JavaScript preparation

```text
run javascript: console.log("hello")
```

The router loads explicit JavaScript into the existing local sandbox but does **not** execute it automatically. The user still presses **Run**.

## Private agent activity

Picklo keeps calculation, code and model activity behind the finished answer. It does not display states such as:

```text
Agent ready
Using Calculator
Searching local files
Waiting for local model
Thinking
Answering
```

Tool badges and recent activity are reserved for files that Picklo returns to the user.

## Tools can work before the model is ready

The composer is available immediately.

Calculator, date/time, notes and memory can respond even while the local language model is still loading.

For ordinary AI requests, Picklo waits for the automatically starting model and then continues the pending request.

## Agent controls

Open **Settings → Agent tools**.

```text
On  — safe local tools can route automatically
Off — chat only
```

The choice is stored locally.

## Performance retained

V7.4 keeps and strengthens the V6.1 performance architecture:

- model warmup at the earliest safe startup point;
- persistent browser caching for downloaded model files;
- Fast / Balanced / Quality modes with larger quality budgets;
- Web Worker inference;
- batched streaming UI updates;
- BM25-style document retrieval;
- network-first navigation with cached offline fallback;
- browser model caching;
- tokens-per-second display when available.

## Visual system retained

### Light

```text
Background   #FFFFFF
Text         #1F1F1F
```

### Dark

```text
Background   #141714
Surface      #20241F
Text         #F6F6F2
```

V7 keeps the flat, high-contrast V6 styling without neon effects.

## V6.1 → V7 migration

When V7 has no existing local state, it checks for V6.1 data and imports supported values:

- conversations;
- memories;
- notes;
- theme;
- model selection;
- performance profile;
- response mode.

## Project structure

```text
picklo-v7.4/
├── .github/
│   └── workflows/
│       └── deploy-pages.yml
├── assets/
│   ├── picklo-logo.svg
│   ├── picklo-mark.svg
│   ├── apple-touch-icon.png
│   ├── favicon-32.png
│   ├── picklo-192.png
│   ├── picklo-512.png
│   └── picklo-v7-preview.png
├── agent-router.js
├── app.js
├── index.html
├── manifest.webmanifest
├── runtime-policy.js
├── supabase-client.js
├── styles.css
├── sw.js
├── webllm-worker.js
└── README.md
```

## Evolution

```text
V1  Browser AI
 ↓
V2  Memory + saved chats
 ↓
V3  Local document retrieval
 ↓
V4  Real chat interface
 ↓
V5  Built-in tools
 ↓
V6  Readability
 ↓
V6.1 Automatic fast startup
 ↓
V7  Automatic safe tool routing
 ↓
V7.1 Faster startup, caching and streaming
 ↓
V7.2 More accurate answers and private processing
 ↓
V7.4 Stronger reasoning, verified files and installable app icons
 ↓
V8 Contextual intelligence
 ↓
V8.1 Account sync, consistent answers and phone-adaptive startup
```

## Boundaries

V7.4 does not silently give the AI unrestricted control of the browser or device.

It does not automatically:

- browse arbitrary websites;
- access the operating-system filesystem;
- execute shell commands;
- execute JavaScript without explicit user confirmation;
- send prompts or attached file contents to a remote AI model.

Conversation titles and messages are intentionally synced to Supabase for the signed-in user. Model inference, uploaded file text, memories, notes and downloaded model files remain on the device.

The agent layer is intentionally constrained.

---

<div align="center">

<img src="assets/picklo-mark.svg" alt="Picklo" width="76">

### Picklo V7.4

**Chat normally. Picklo checks privately and returns the finished answer.**

</div>
