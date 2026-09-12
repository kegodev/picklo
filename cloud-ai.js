import { supabase, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./supabase-client.js?v=8.2.2-fix4";

export const CLOUD_FUNCTION_NAME = "picklo-gemini";
const CLOUD_ENDPOINT = `${SUPABASE_URL}/functions/v1/${CLOUD_FUNCTION_NAME}`;
const REQUEST_TIMEOUT_MS = 75000;

export class CloudAIError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = "CloudAIError";
    this.status = status;
  }
}

export function isAbortError(error) {
  return error?.name === "AbortError" || /aborted|cancelled|canceled/i.test(String(error?.message || ""));
}

function isRegisteredSession(session) {
  const user = session?.user;
  return Boolean(session?.access_token && user && !user.is_anonymous && user.email);
}

async function getOptionalAccessToken({ refresh = false } = {}) {
  try {
    let result = refresh
      ? await supabase.auth.refreshSession()
      : await supabase.auth.getSession();

    if (result.error || !isRegisteredSession(result.data?.session)) return "";

    const session = result.data.session;
    const expiresAtMs = Number(session.expires_at || 0) * 1000;
    if (!refresh && expiresAtMs && expiresAtMs <= Date.now() + 15000) {
      result = await supabase.auth.refreshSession();
      if (result.error || !isRegisteredSession(result.data?.session)) return "";
      return result.data.session.access_token || "";
    }

    return session.access_token || "";
  } catch {
    // Guest chat must keep working even if Supabase auth storage contains an expired session.
    return "";
  }
}

function createRequestSignal(parentSignal) {
  const controller = new AbortController();
  const abortFromParent = () => controller.abort(parentSignal?.reason);
  if (parentSignal?.aborted) abortFromParent();
  else parentSignal?.addEventListener("abort", abortFromParent, { once: true });

  const timeout = setTimeout(
    () => controller.abort(new DOMException("Cloud request timed out", "TimeoutError")),
    REQUEST_TIMEOUT_MS
  );
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timeout);
      parentSignal?.removeEventListener("abort", abortFromParent);
    }
  };
}

async function parseResponse(response) {
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const fallback = response.status === 429
      ? "Picklo is receiving too many requests. Wait a moment and try again."
      : response.status === 401
        ? "Sign in to Picklo to use this protected feature."
        : "Picklo's cloud AI could not complete the request. Please try again.";
    throw new CloudAIError(String(data?.error || fallback), response.status);
  }

  const text = String(data?.text || "").trim();
  if (!text) throw new CloudAIError("Gemini returned an empty response. Please try again.", 502);
  return {
    text,
    model: String(data?.model || "Gemini"),
    usage: data?.usage && typeof data.usage === "object" ? data.usage : null,
    guest: Boolean(data?.guest)
  };
}

async function performRequest(payload, token, signal) {
  const headers = {
    "apikey": SUPABASE_PUBLISHABLE_KEY,
    "Content-Type": "application/json",
    "X-Client-Info": "picklo-web/8.2.2-fix4"
  };
  // The Edge Function is public for ordinary text chat. Only attach a bearer
  // token when a real registered session exists; protected image analysis is
  // rejected server-side without one.
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(CLOUD_ENDPOINT, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    signal
  });
  return parseResponse(response);
}

export async function requestCloudCompletion({
  messages,
  temperature = 0.15,
  topP = 0.85,
  maxTokens = 720,
  profile = "balanced",
  purpose = "answer",
  signal
}) {
  const request = createRequestSignal(signal);
  const payload = { messages, temperature, topP, maxTokens, profile, purpose };

  try {
    const token = await getOptionalAccessToken();
    try {
      return await performRequest(payload, token, request.signal);
    } catch (error) {
      if (!(error instanceof CloudAIError) || error.status !== 401 || request.signal.aborted) throw error;

      // A stale registered session must never break normal guest chat. Retry the
      // text request without Authorization. Protected image/file operations use
      // their own account-gated request path below.
      return await performRequest(payload, "", request.signal);
    }
  } finally {
    request.dispose();
  }
}

export async function requestCloudImageAnalysis({
  dataUrl,
  prompt = "Describe this image accurately for follow-up questions.",
  signal
}) {
  const sessionResult = await supabase.auth.getSession();
  let session = sessionResult.data?.session || null;

  if (!isRegisteredSession(session)) {
    throw new CloudAIError("Sign in to Picklo to analyze photos.", 401);
  }

  const expiresAtMs = Number(session.expires_at || 0) * 1000;
  if (expiresAtMs && expiresAtMs <= Date.now() + 15000) {
    const refreshed = await supabase.auth.refreshSession();
    session = refreshed.data?.session || null;
  }

  if (!isRegisteredSession(session)) {
    throw new CloudAIError("Sign in to Picklo to analyze photos.", 401);
  }

  const request = createRequestSignal(signal);
  try {
    return await performRequest({
      image: { dataUrl: String(dataUrl || "").slice(0, 4_000_000) },
      imagePrompt: prompt,
      profile: "balanced",
      purpose: "image-analysis"
    }, session.access_token, request.signal);
  } finally {
    request.dispose();
  }
}
