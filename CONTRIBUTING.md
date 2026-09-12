# Contributing to Picklo

Thank you for helping improve Picklo. Keep pull requests focused, testable, and safe for both mobile and desktop users.

## Development workflow

1. Fork the repository and create a branch from `main`.
2. Use a descriptive branch name such as `fix/mobile-composer` or `feature/local-file-preview`.
3. Serve the repository over HTTP:

   ```bash
   python -m http.server 8080
   ```

4. Make one focused change.
5. Run the repository checks:

   ```bash
   npm test
   ```

6. Test the affected interface on a narrow mobile viewport and a desktop viewport.
7. Open a pull request and complete the checklist.

## Required invariants

- Never add `PICKLO_API`, a Supabase service-role key, passwords, or private tokens to browser files, commits, screenshots, or test fixtures.
- Photos, uploaded documents, local filenames, and generated file contents must remain browser-only.
- Do not write attachment bytes to Supabase Database or Storage.
- Cloud conversation sync may contain text plus sanitized public web citations only; keep `attachments` empty and `artifact` null, and strip local filenames.
- No device may initialize or download a large WebLLM model automatically. Gemini remains the default runtime on capable desktops too.
- Google Search must run only through the Edge Function. Validate citation URLs as `http` or `https` before rendering or syncing them.
- Keep `index.html` and all public assets deployable as a static site without a build step.
- Treat AI and document output as untrusted text. Use DOM text APIs or explicit escaping, and allow only safe link protocols.

## Code style

- Use modern, dependency-light JavaScript and descriptive names.
- Preserve accessibility labels, keyboard navigation, reduced-motion behavior, and safe-area handling.
- Avoid adding visual clutter to the mobile header or composer.
- Keep code blocks fenced with a language identifier when changing prompts or response formatting.
- Prefer small functions with explicit validation at browser/server boundaries.

## Release changes

When publishing a new build, keep the release number and cache query consistent in:

- `app.js`
- `enhancements.js`
- `index.html`
- `sw.js`
- `version.json`
- `manifest.webmanifest` when its product version text changes
- `package.json`
- browser module query strings such as those in `cloud-ai.js`

Run `npm test` after any release-number update.

## Pull request scope

A good pull request explains the user-visible result, lists the browsers or devices tested, includes screenshots for layout changes, and calls out any privacy or Supabase impact. Do not combine unrelated redesigns, backend changes, and refactors in one pull request.
