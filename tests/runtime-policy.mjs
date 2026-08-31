import assert from "node:assert/strict";
import {
  MODEL_IDS,
  detectRuntimeCapabilities,
  extractExplicitRequirements,
  getAdaptiveSampling,
  getModelLoadCandidates,
  recommendModelForDevice
} from "../runtime-policy.js";

const allModels = [MODEL_IDS.tiny, MODEL_IDS.fast, MODEL_IDS.balanced, MODEL_IDS.quality];

const phone = detectRuntimeCapabilities({
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile",
  viewportWidth: 390,
  hardwareConcurrency: 6,
  maxTouchPoints: 5
});
assert.equal(phone.isPhone, true);
assert.equal(phone.isConstrained, false);
assert.equal(recommendModelForDevice("balanced", allModels, phone), MODEL_IDS.fast);
assert.equal(recommendModelForDevice("quality", allModels, phone), MODEL_IDS.balanced);

const constrainedPhone = detectRuntimeCapabilities({
  userAgent: "Mozilla/5.0 (Linux; Android 12; Mobile)",
  viewportWidth: 412,
  deviceMemory: 2,
  hardwareConcurrency: 4
});
assert.equal(constrainedPhone.tier, "constrained");
assert.equal(recommendModelForDevice("quality", allModels, constrainedPhone), MODEL_IDS.tiny);

const desktop = detectRuntimeCapabilities({
  userAgent: "Mozilla/5.0 (X11; Linux x86_64)",
  viewportWidth: 1440,
  deviceMemory: 16,
  hardwareConcurrency: 12
});
assert.equal(desktop.tier, "desktop");
assert.equal(recommendModelForDevice("balanced", allModels, desktop), MODEL_IDS.balanced);
assert.equal(recommendModelForDevice("quality", allModels, desktop), MODEL_IDS.quality);

assert.deepEqual(
  getModelLoadCandidates(MODEL_IDS.quality, allModels),
  [MODEL_IDS.quality, MODEL_IDS.balanced, MODEL_IDS.fast, MODEL_IDS.tiny]
);
assert.deepEqual(
  getModelLoadCandidates(MODEL_IDS.fast, allModels),
  [MODEL_IDS.fast, MODEL_IDS.tiny]
);

const requirements = extractExplicitRequirements(`Build the page with these constraints:
- Use TypeScript
- Do not use external libraries
Return exactly 3 files.`);
assert.deepEqual(requirements.slice(0, 2), ["Use TypeScript", "Do not use external libraries"]);
assert.ok(requirements.some((item) => /exactly 3 files/i.test(item)));

const precise = getAdaptiveSampling(
  "Compare the API responses and explain why they differ.",
  { temperature: 0.2, topP: 0.88 },
  "analyze"
);
assert.deepEqual(precise, { temperature: 0.1, topP: 0.82 });

const creative = getAdaptiveSampling(
  "Write a creative story about a friendly robot.",
  { temperature: 0.2, topP: 0.88 },
  "write"
);
assert.deepEqual(creative, { temperature: 0.2, topP: 0.88 });

console.log("Picklo V8.1 runtime policy checks passed.");
