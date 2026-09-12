# Picklo

![Picklo interface](assets/picklo-v7-preview.png)

Picklo is a responsive personal AI web app by KM Digital Labs. Version 8.3 uses Gemini by default on every phone, tablet, and computer, and can ground answers in current public information with Google Search.

## What is included

- Mobile-first chat interface and installable PWA.
- Gemini cloud intelligence is the default on every device; no large local model downloads automatically.
- Google Search grounding for current information, with safe clickable source links below the answer.
- Gemini requests pass through a Supabase Edge Function; the Gemini key never reaches browser code.
- Short live work notes such as “Thinking…”, “Searching the web…”, “Reading files…”, and “Preparing code…”. They disappear when the answer is ready and are not saved in chat history.
- Clickable Markdown links and safe automatic link detection.
- Fenced code blocks with language labels, copy controls, and syntax colours for tags, attributes, variables, keywords, strings, numbers, comments, selectors, and properties.
- Photo messages displayed directly in chat, with Gemini vision analysis and browser OCR fallback.
- Local document reading for PDF, Word, RTF, text, Markdown, CSV, JSON, HTML, CSS, JavaScript, TypeScript, Python, and other text/code formats.
- Downloadable chat files including HTML, CSS, JavaScript, TypeScript, Python, PDF, DOC, DOCX, TXT, Markdown, JSON, CSV, XML, YAML, SVG, SQL, and many common source-code formats.
- Supabase Auth and per-user text conversation sync.
- Automatic cache-version checks so repeat visitors receive the latest release.

## Privacy model

| Data | Location | Cross-browser sync |
| --- | --- | --- |
| Text conversations | Browser and the signed-in user's Supabase rows | Yes |
| Original photos and documents | Browser IndexedDB only | No |
| Generated downloadable files | Browser storage only | No |
| Public web citation links | Browser and the signed-in user's Supabase message row | Yes |
| Gemini API key | Supabase Edge Function secret `PICKLO_API` | Never exposed |

When a signed-in user asks Picklo to inspect a photo, a resized copy is sent transiently to the Edge Function and Gemini for that response. Picklo does not write the photo to Supabase Database or Storage. Attachment fields, generated artifacts, local filenames, and local file-source labels are stripped from conversation sync requests. Only sanitized public `http`/`https` citation links may sync with the text conversation.

## Inference policy

| Device | Default AI runtime | Automatic large model download |
| --- | --- | --- |
| Phone or tablet | Gemini | No |
| PC without WebGPU | Gemini | No |
| Low-memory or low-core PC | Gemini | No |
| Capable WebGPU desktop | Gemini | No |

The WebLLM files remain in the repository for future/manual offline work, but V8.3 does not import or start them during normal use. This keeps the same lightweight startup on strong and weak devices.

## Web intelligence

Requests for current, changing, explicitly searched, or purchase-sensitive information enable Gemini's Google Search grounding tool. Gemini combines relevant public results with its model knowledge and returns grounding metadata. Picklo validates those URLs and renders them as source chips below the answer. Stable writing, coding, and general-knowledge requests use Gemini without an unnecessary search.

Review passes, artifact-repair passes, and image analysis do not enable web search, avoiding duplicate searches. Search-grounding usage can add Gemini API cost, so the Edge Function applies stricter per-minute limits to grounded requests. See Google's current [Google Search grounding documentation](https://ai.google.dev/gemini-api/docs/google-search) and pricing before production launch.

## Run locally

This is a static ES-module app, so it must be served over HTTP rather than opened directly as a `file://` page.

```bash
git clone https://github.com/kegodev/picklo.git
cd picklo
python -m http.server 8080
```

Open `http://localhost:8080`.

No frontend build step is required. An internet connection is required for Gemini, web search, authentication, and first-time loading of optional browser helpers.

## Supabase configuration

The browser configuration is in [`supabase-client.js`](supabase-client.js). A Supabase URL and publishable/anon key are public client configuration; never place a service-role key or Gemini key there.

The frontend expects Supabase Auth plus the existing `picklo_conversations` and `picklo_messages` tables with row-level security restricting rows to their owner. The app deliberately writes empty `attachments` and `artifact` values to cloud message rows.

### Gemini secret and Edge Function

1. Link the Supabase CLI to the intended project.
2. Add the Gemini API key as an Edge Function secret:

```bash
supabase secrets set PICKLO_API=your_gemini_key
```

3. Deploy the included function:

```bash
supabase functions deploy picklo-gemini --no-verify-jwt
```

The function uses custom authentication because guest text chat is supported. Image analysis still requires a real registered Supabase session. It validates request sizes, applies separate search rate limits, reads `PICKLO_API` only from `Deno.env`, extracts grounded citations, and does not persist request bodies.

If you set the optional `PICKLO_GEMINI_MODEL` secret, choose a model that supports Google Search grounding. Otherwise, the function uses search-capable Gemini Flash aliases and 2.5 fallbacks.

If ordinary Gemini chat works but grounded requests return HTTP `429`, check the Google AI project attached to `PICKLO_API` for Google Search grounding quota and billing. Picklo will try a safe non-search Gemini answer so chat remains available, and it will not claim that changing facts were verified live.

## InfinityFree deployment

Upload the public web files to `htdocs` with `index.html` directly inside `htdocs`:

- `index.html`
- `app.js`, `enhancements.js`, `cloud-ai.js`, `agent-router.js`, `runtime-policy.js`, `supabase-client.js`, `webllm-worker.js`, and `sw.js`
- `styles.css` and `enhancements.css`
- `manifest.webmanifest` and `version.json`
- the complete `assets/` folder

Repository-only paths such as `.github/`, `scripts/`, `supabase/`, and Markdown documentation do not need to be uploaded to InfinityFree.

Use HTTPS in production. WebGPU, service workers, secure authentication, clipboard access, and PWA installation depend on a secure context.

## Repository structure

```text
picklo/
├── .github/
│   ├── PULL_REQUEST_TEMPLATE.md
│   └── workflows/validate.yml
├── assets/
├── CHANGELOG.md
├── scripts/validate.mjs
├── supabase/functions/picklo-gemini/index.ts
├── agent-router.js
├── app.js
├── cloud-ai.js
├── enhancements.css
├── enhancements.js
├── index.html
├── manifest.webmanifest
├── runtime-policy.js
├── styles.css
├── supabase-client.js
├── sw.js
├── version.json
└── webllm-worker.js
```

## Validate a change

```bash
npm test
```

The validation checks JavaScript syntax, release-version consistency, Gemini-default routing, search grounding and citations, transient activity notes, required hosting files, browser-only attachment protections, and accidental secret exposure. The same checks run automatically on every pull request.

See [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. Security issues should follow [SECURITY.md](SECURITY.md).

## Ownership

Picklo is designed and maintained by [KM Digital Labs](https://kmdigitallabs.co.za).
