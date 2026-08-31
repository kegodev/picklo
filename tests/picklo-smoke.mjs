import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const app = read("app.js");
const html = read("index.html");
const styles = read("styles.css");
const manifest = JSON.parse(read("manifest.webmanifest"));
const serviceWorker = read("sw.js");
const runtimePolicy = read("runtime-policy.js");
const supabaseClient = read("supabase-client.js");

assert.match(app, /APP_VERSION = "8\.1\.0"/);
assert.match(html, /Picklo V8\.1/);
assert.match(html, /class="copyright-card"/);
assert.equal((html.match(/KM Digital Labs/g) || []).length, 2, "Ownership should appear only in the Settings copyright card");
assert.doesNotMatch(app, /KM Digital Labs/);
assert.doesNotMatch(JSON.stringify(manifest), /KM Digital Labs/);

assert.equal(manifest.name, "Picklo");
assert.ok(manifest.icons.some((icon) => icon.sizes === "192x192" && /maskable/.test(icon.purpose)));
assert.ok(manifest.icons.some((icon) => icon.sizes === "512x512" && /maskable/.test(icon.purpose)));
for (const path of ["assets/apple-touch-icon.png", "assets/picklo-192.png", "assets/picklo-512.png", "assets/favicon-32.png"]) {
  assert.ok(statSync(new URL(`../${path}`, import.meta.url)).size > 500, `${path} should be a rendered PNG icon`);
}

assert.match(app, /buildDocxBlob/);
assert.match(app, /reviewAnswer/);
assert.match(app, /repairArtifactIfNeeded/);
assert.match(app, /documentFrequency/);
assert.match(app, /buildDialogueState/);
assert.match(app, /expandQueryTokens/);
assert.match(app, /alternative explanation/);
assert.match(app, /extractExplicitRequirements/);
assert.match(app, /getAdaptiveSampling/);
assert.match(app, /getModelLoadCandidates/);
assert.match(runtimePolicy, /recommendModelForDevice/);
assert.match(serviceWorker, /picklo-v8\.1-shell-v2/);
assert.match(serviceWorker, /runtime-policy\.js/);
assert.match(serviceWorker, /supabase-client\.js/);
assert.match(app, /signInWithPassword/);
assert.match(app, /picklo_conversations/);
assert.match(app, /picklo_messages/);
assert.match(html, /id="authGate"/);
assert.match(html, /id="signOutBtn"/);
assert.match(supabaseClient, /@supabase\/supabase-js@2\.112\.4/);
assert.match(supabaseClient, /sb_publishable_/);
assert.doesNotMatch(supabaseClient, /service_role|sb_secret_/);
assert.match(styles, /Final V7\.4 cascade safeguards/);

console.log("Picklo V8.1 smoke checks passed.");
