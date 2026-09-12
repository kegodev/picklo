export const MODEL_IDS = Object.freeze({
  tiny: "SmolLM2-360M-Instruct-q4f16_1-MLC",
  fast: "Llama-3.2-1B-Instruct-q4f16_1-MLC",
  balanced: "SmolLM2-1.7B-Instruct-q4f16_1-MLC",
  quality: "Llama-3.2-3B-Instruct-q4f16_1-MLC"
});

const MODEL_ORDER = [
  MODEL_IDS.tiny,
  MODEL_IDS.fast,
  MODEL_IDS.balanced,
  MODEL_IDS.quality
];

const PROFILE_MODEL = Object.freeze({
  fast: MODEL_IDS.fast,
  balanced: MODEL_IDS.balanced,
  quality: MODEL_IDS.quality
});

const PHONE_PROFILE_MODEL = Object.freeze({
  fast: MODEL_IDS.fast,
  balanced: MODEL_IDS.fast,
  quality: MODEL_IDS.balanced
});

const CREATIVE_PATTERN = /\b(?:brainstorm|creative|fiction|imagine|poem|poetry|story|song|slogan|names?|jokes?|roleplay|rewrite creatively)\b/i;
const PRECISE_PATTERN = /\b(?:analy[sz]e|api|calculate|code|compare|current|data|debug|diagnose|equation|evaluate|evidence|explain|fact|financial|function|legal|medical|percent|price|research|solve|sql|statistics?|strategy|technical|today|verify|why)\b/i;
const REQUIREMENT_PATTERN = /\b(?:at least|at most|avoid|do not|don't|exactly|exclude|include|keep|limit|must|need(?:s)? to|never|no more than|only|please|should|use|without)\b/i;

function finitePositive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

export function detectRuntimeCapabilities(input = {}) {
  const deviceMemory = finitePositive(input.deviceMemory);
  const hardwareConcurrency = finitePositive(input.hardwareConcurrency);
  const viewportWidth = finitePositive(input.viewportWidth);
  const userAgent = String(input.userAgent || "");
  const platform = String(input.platform || "");
  const touchPoints = Number(input.maxTouchPoints) || 0;
  const hasWebGPU = Boolean(input.hasWebGPU);
  const mobileUserAgent = /Android.*Mobile|iPhone|iPod|Mobile|Windows Phone/i.test(userAgent);
  const narrowTouchDevice = Boolean((input.coarsePointer || touchPoints > 0) && viewportWidth && viewportWidth <= 820);
  const isPhone = mobileUserAgent || narrowTouchDevice;
  const ipadDesktopUserAgent = /Macintosh/i.test(userAgent) && platform === "MacIntel" && touchPoints > 1;
  const tabletUserAgent = /iPad|Tablet|PlayBook|Silk/i.test(userAgent) ||
    (/Android/i.test(userAgent) && !/Mobile/i.test(userAgent));
  const isTablet = !isPhone && (tabletUserAgent || ipadDesktopUserAgent);
  const isMobile = isPhone || isTablet;
  const isConstrained = Boolean(
    (deviceMemory && deviceMemory <= 4) ||
    (hardwareConcurrency && hardwareConcurrency <= 4)
  );
  const supportsLocalAI = Boolean(hasWebGPU && !isMobile && !isConstrained);

  return {
    deviceMemory,
    hardwareConcurrency,
    viewportWidth,
    hasWebGPU,
    isPhone,
    isTablet,
    isMobile,
    isConstrained,
    supportsLocalAI,
    tier: isPhone ? "phone" : isTablet ? "tablet" : isConstrained ? "constrained" : "desktop"
  };
}

export function selectInferenceMode(capabilities = {}) {
  if (capabilities.isPhone) return { mode: "cloud", reason: "phone" };
  if (capabilities.isTablet) return { mode: "cloud", reason: "tablet" };
  if (!capabilities.hasWebGPU) return { mode: "cloud", reason: "webgpu-unavailable" };
  if (capabilities.isConstrained) return { mode: "cloud", reason: "limited-hardware" };
  return { mode: "local", reason: "capable-desktop" };
}

function nearestAvailableModel(target, availableIds) {
  const available = new Set(availableIds || []);
  if (available.has(target)) return target;

  const targetIndex = MODEL_ORDER.indexOf(target);
  if (targetIndex >= 0) {
    for (let index = targetIndex - 1; index >= 0; index -= 1) {
      if (available.has(MODEL_ORDER[index])) return MODEL_ORDER[index];
    }
    for (let index = targetIndex + 1; index < MODEL_ORDER.length; index += 1) {
      if (available.has(MODEL_ORDER[index])) return MODEL_ORDER[index];
    }
  }

  return availableIds?.[0] || null;
}

export function recommendModelForDevice(profileName, availableIds, capabilities = {}) {
  const normalizedProfile = PROFILE_MODEL[profileName] ? profileName : "balanced";
  const target = capabilities.isConstrained
    ? MODEL_IDS.tiny
    : capabilities.isPhone
      ? PHONE_PROFILE_MODEL[normalizedProfile]
      : PROFILE_MODEL[normalizedProfile];

  return nearestAvailableModel(target, availableIds);
}

export function getModelLoadCandidates(selectedModel, availableIds) {
  const available = new Set(availableIds || []);
  const candidates = [];
  const add = (modelId) => {
    if (modelId && available.has(modelId) && !candidates.includes(modelId)) candidates.push(modelId);
  };

  add(selectedModel);

  const selectedIndex = MODEL_ORDER.indexOf(selectedModel);
  if (selectedIndex >= 0) {
    for (let index = selectedIndex - 1; index >= 0; index -= 1) add(MODEL_ORDER[index]);
  } else {
    add(MODEL_IDS.fast);
    add(MODEL_IDS.tiny);
  }

  return candidates;
}

function normalizeRequirement(value) {
  return String(value || "")
    .replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)/, "")
    .replace(/\s+/g, " ")
    .replace(/[.;:,]+$/, "")
    .trim()
    .slice(0, 180);
}

export function extractExplicitRequirements(input, limit = 6) {
  const text = String(input || "").trim();
  if (!text) return [];

  const requirements = [];
  const seen = new Set();
  const add = (value) => {
    const normalized = normalizeRequirement(value);
    const key = normalized.toLowerCase();
    if (normalized.length < 3 || seen.has(key) || requirements.length >= limit) return;
    seen.add(key);
    requirements.push(normalized);
  };

  for (const line of text.split(/\r?\n/)) {
    if (/^\s*(?:[-*+]\s+|\d+[.)]\s+)/.test(line)) add(line);
  }

  const clauses = text
    .replace(/\r?\n/g, ". ")
    .split(/(?<=[.!?;])\s+|\s+\b(?:and|but)\s+(?=(?:do not|don't|never|only|include|exclude|avoid|without|must|use)\b)/i);

  for (const clause of clauses) {
    if (REQUIREMENT_PATTERN.test(clause)) add(clause);
  }

  return requirements;
}

export function getAdaptiveSampling(input, profile = {}, mode = "general") {
  const text = String(input || "");
  const baseTemperature = Number.isFinite(profile.temperature) ? profile.temperature : 0.2;
  const baseTopP = Number.isFinite(profile.topP) ? profile.topP : 0.9;
  const isCreative = mode === "write" && CREATIVE_PATTERN.test(text);
  const hasRequirements = extractExplicitRequirements(text, 3).length >= 2;
  const needsPrecision = ["code", "analyze"].includes(mode) || PRECISE_PATTERN.test(text) || hasRequirements;

  if (!isCreative && needsPrecision) {
    return {
      temperature: Math.min(baseTemperature, 0.1),
      topP: Math.min(baseTopP, 0.82)
    };
  }

  return { temperature: baseTemperature, topP: baseTopP };
}
