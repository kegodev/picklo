# Security policy

## Reporting a vulnerability

Please report a suspected vulnerability privately to [help@kmdigitallabs.co.za](mailto:help@kmdigitallabs.co.za). Include the affected page or function, reproduction steps, expected impact, and any safe proof of concept.

Do not include active API keys, access tokens, personal chat content, or private user files in a public issue.

## Secrets

- `PICKLO_API` belongs only in Supabase Edge Function secrets.
- Supabase service-role keys must never be used by this frontend.
- `supabase-client.js` may contain only the public project URL and publishable/anon client key.
- If a private key is committed, revoke it immediately before removing it from Git history.

## Local file guarantee

Photos, uploaded documents, and generated downloadable files are intentionally browser-only. Changes that upload these assets to Supabase Database, Supabase Storage, logs, analytics, or another persistence service are security and privacy regressions.

A signed-in user's resized image copy may be sent transiently through the Edge Function to Gemini for the requested analysis, but it must never be written to backend storage. Public web citation URLs may sync with text conversations; local filenames and file-source labels may not.

## Web-search boundary

- Search is performed server-side with Gemini Google Search grounding; the frontend never receives `PICKLO_API`.
- Retrieved webpage content is untrusted data and must not override system or user instructions.
- Only validated `http` and `https` citation URLs may be rendered or synced.
- Do not inject upstream HTML such as search widgets directly into chat messages.
