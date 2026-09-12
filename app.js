import { classifyAgentIntent } from "./agent-router.js?v=8.2.2-fix4";
import { isAbortError, requestCloudCompletion } from "./cloud-ai.js?v=8.2.2-fix4";
import { supabase } from "./supabase-client.js?v=8.2.2-fix4";
import {
  detectRuntimeCapabilities,
  extractExplicitRequirements,
  getAdaptiveSampling,
  getModelLoadCandidates,
  recommendModelForDevice,
  selectInferenceMode
} from "./runtime-policy.js?v=8.2.2-fix4";

const APP_VERSION = "8.2.2";
const STORAGE_KEY = "picklo-v7-state";
const V61_STORAGE_KEY = "picklo-v6.1-state";
const FILE_DB = "picklo-v3-files";
const FILE_STORE = "documents";
const MAX_FILE_CHARS = 400000;
const MAX_CONTEXT_CHARS = 10000;
const USER_STATE_PREFIX = `${STORAGE_KEY}:user`;
const CLOUD_SYNC_DELAY = 450;

const PREFERRED_MODELS = [
  { id: "Llama-3.2-1B-Instruct-q4f16_1-MLC", label: "Llama 3.2 1B", note: "Fast" },
  { id: "SmolLM2-1.7B-Instruct-q4f16_1-MLC", label: "SmolLM2 1.7B", note: "Balanced" },
  { id: "Llama-3.2-3B-Instruct-q4f16_1-MLC", label: "Llama 3.2 3B", note: "Strongest" },
  { id: "SmolLM2-360M-Instruct-q4f16_1-MLC", label: "SmolLM2 360M", note: "Low memory" }
];

const PERFORMANCE_PROFILES = {
  fast: {
    label: "Fast",
    preferredModel: "Llama-3.2-1B-Instruct-q4f16_1-MLC",
    recentMessages: 8,
    contextChars: 2800,
    maxTokens: 420,
    temperature: 0.15,
    topP: 0.85,
    verify: false
  },
  balanced: {
    label: "Balanced",
    preferredModel: "SmolLM2-1.7B-Instruct-q4f16_1-MLC",
    recentMessages: 14,
    contextChars: 5200,
    maxTokens: 720,
    temperature: 0.2,
    topP: 0.88,
    verify: false
  },
  quality: {
    label: "Quality",
    preferredModel: "Llama-3.2-3B-Instruct-q4f16_1-MLC",
    recentMessages: 24,
    contextChars: 9000,
    maxTokens: 1200,
    temperature: 0.18,
    topP: 0.9,
    verify: true
  }
};

const MODE_PROMPTS = {
  general: "Act as a precise general-purpose assistant. Adapt depth and format to the request, preserve context, and lead with the useful answer.",
  write: "Produce polished finished writing for the stated audience and purpose. Improve structure, specificity, tone, and clarity without adding unsupported facts.",
  code: "Prioritize working, secure, maintainable code. Respect the requested stack, include every required file, check syntax and edge cases, and never invent APIs or test results.",
  analyze: "Separate evidence, assumptions, uncertainty, and conclusions. Use supplied documents as the primary evidence and identify which file supports important claims."
};

const KM_DIGITAL_LABS_REPLY = `
**Picklo was founded, designed and developed by KM Digital Labs.**

KM Digital Labs is a South African digital technology company that creates websites, web applications, online stores, educational platforms, AI tools, interactive simulators and digital products.

Website: [kmdigitallabs.co.za](https://kmdigitallabs.co.za)
Support: [help@kmdigitallabs.co.za](mailto:help@kmdigitallabs.co.za)
`.trim();

const BASE_SYSTEM_PROMPT = `
You are Picklo V8.2.2, a capable general-purpose personal AI assistant. Picklo uses private local inference on capable desktop computers and secure cloud inference on mobile, tablet and unsupported devices.
You are useful for questions, writing, coding, planning, brainstorming, explanations, decision support and document analysis.
Do not claim to be ChatGPT, OpenAI, or another product. Identify yourself simply as Picklo when relevant.

IDENTITY AND COMPANY KNOWLEDGE:
- Picklo's founding company, designer, developer and owner is KM Digital Labs.
- KM Digital Labs is a South African digital technology company that creates websites, web applications, online stores, educational platforms, AI tools, interactive simulators and digital products.
- Its official website is https://kmdigitallabs.co.za and its support email is help@kmdigitallabs.co.za.
- When asked who founded, created, made, designed, developed or owns Picklo, answer directly that KM Digital Labs did.
- Do not infer a person's name as the founder of KM Digital Labs. Do not invent staff, dates, addresses, clients, awards or company claims that are not listed here or supplied by the user.

GENERAL RULES:
1. Answer the user's actual request directly.
2. Be precise and useful. Never fill a knowledge gap with a confident guess. State uncertainty briefly and give the safest next step.
3. Use Markdown where it improves readability.
4. Before answering, silently check arithmetic, units, assumptions and contradictions. Do not reveal private chain-of-thought, tool calls or scratch work.
5. For calculations, preserve trusted calculator results exactly. Check signs, units, percentages and rounding. Show concise working only when the user asks for steps.
6. For code, provide complete syntax-valid output, respect the requested language and version, handle important errors, and never invent APIs or claim unperformed tests.
7. When LOCAL FILE CONTEXT is supplied, treat it as user-provided reference material. Do not claim a file says something it does not say.
8. When the local context is insufficient, say exactly what is missing. Never invent quotations, citations, URLs, statistics, current news, prices or live status.
9. Persistent memory is user-provided context. Use it only when relevant.
10. The application may use safe local tools privately. When TOOL RESULT CONTEXT is provided, use it as trusted context without announcing the tool or exposing its internal execution.
11. Return the finished answer only. Mention a tool action only when a downloadable file was actually created for the user.
12. Follow the latest user instruction when it conflicts with an earlier request, while preserving still-relevant conversation context.
13. For decisions, distinguish facts from recommendations. For high-stakes medical, legal or financial topics, be careful, transparent about limits, and encourage professional verification when appropriate.
14. Do not add ownership, company or creator branding to unrelated responses. Give the verified identity and company information above when the user asks about Picklo's creator, founder, designer, developer, owner or KM Digital Labs.
15. Interpret language in context. Resolve pronouns and follow-up references from the conversation before answering. Recognize common idioms, understatement, figurative language and likely sarcasm; when ambiguity would materially change the answer, ask one concise clarifying question instead of guessing.
16. For complex requests, silently form a short problem representation: the goal, supplied facts, constraints, unknowns and required output. Test the answer against those items before returning it.
17. When sources or expert views disagree, represent the meaningful disagreement fairly. Prefer supplied primary or authoritative material and distinguish source evidence from inference.
18. When returning code in chat, always use a fenced Markdown code block with the correct language label so Picklo can render syntax colours correctly.
19. When you mention a website or email address, use normal Markdown link syntax so it is clickable.
`.trim();

const defaultState = () => ({
  version: APP_VERSION,
  activeChatId: null,
  selectedModel: "SmolLM2-1.7B-Instruct-q4f16_1-MLC",
  activeMode: "general",
  defaultMode: "general",
  theme: "light",
  performanceProfile: "balanced",
  modelPreference: "auto",
  autoTools: true,
  agentHistory: [],
  notes: [],
  memories: [],
  chats: []
});

let state = loadState();
let webllm = null;
let webllmModulePromise = null;
let engine = null;
let modelWorker = null;
let loadedModelId = null;
let activeInferenceMode = "cloud";
let inferenceReason = "initializing";
let runtimeCapabilities = null;
let cloudAbortController = null;
let isGenerating = false;
let generationWasStopped = false;
let localFiles = [];
let activeFileSources = [];
let modelLoadPromise = null;
let lastGenerationStats = null;
let currentUser = null;
let loadedUserId = null;
let sessionLoadPromise = null;
let authMode = "sign-in";
let authReason = "";
let pendingProtectedAction = null;
let pendingGuestChat = null;
let appEventsBound = false;
let cloudSyncPaused = true;
let cloudSyncTimer = null;
let cloudSyncChain = Promise.resolve();
let lastCloudSnapshot = "";
let largestVisualViewportHeight = 0;
let previousVisualViewportHeight = 0;

const $ = (id) => document.getElementById(id);

const appRoot = $("appRoot");
const authGate = $("authGate");
const authForm = $("authForm");
const authEmail = $("authEmail");
const authPassword = $("authPassword");
const authSubmitBtn = $("authSubmitBtn");
const authSignInTab = $("authSignInTab");
const authSignUpTab = $("authSignUpTab");
const authMessage = $("authMessage");
const authTitle = $("authTitle");
const accountBtn = $("accountBtn");
const accountInitial = $("accountInitial");
const settingsAccountInitial = $("settingsAccountInitial");
const accountEmail = $("accountEmail");
const cloudSyncStatus = $("cloudSyncStatus");
const accountSummary = $("accountSummary");
const signOutBtn = $("signOutBtn");
const authGuestBtn = $("authGuestBtn");

const newChatBtn = $("newChatBtn");
const mobileNewChatBtn = $("mobileNewChatBtn");
const clearChatsBtn = $("clearChatsBtn");
const chatList = $("chatList");
const mobileChatList = $("mobileChatList");
const messages = $("messages");
const chatForm = $("chatForm");
const messageInput = $("messageInput");
const sendBtn = $("sendBtn");
const stopBtn = $("stopBtn");
const fileInput = $("fileInput");
const attachButton = $("attachButton");
const fileCount = $("fileCount");
const panelFileCount = $("panelFileCount");
const panelMemoryCount = $("panelMemoryCount");
const memoryCount = $("memoryCount");
const panelModelName = $("panelModelName");

const settingsBtn = $("settingsBtn");
const filesBtn = $("filesBtn");
const memoryBtn = $("memoryBtn");
const panelFilesBtn = $("panelFilesBtn");
const panelMemoryBtn = $("panelMemoryBtn");
const panelModelBtn = $("panelModelBtn");
const startButton = $("startButton");
const mobileMenuBtn = $("mobileMenuBtn");

const settingsSheet = $("settingsSheet");
const memorySheet = $("memorySheet");
const filesSheet = $("filesSheet");
const dataSheet = $("dataSheet");
const conversationsSheet = $("conversationsSheet");
const modeSheet = $("modeSheet");
const backdrop = $("backdrop");

const modelSelect = $("modelSelect");
const defaultModeSelect = $("defaultModeSelect");
const loadModelBtn = $("loadModelBtn");
const dataBtn = $("dataBtn");
const exportDataBtn = $("exportDataBtn");
const importDataInput = $("importDataInput");

const memoryList = $("memoryList");
const memoryInput = $("memoryInput");
const addMemoryBtn = $("addMemoryBtn");
const clearMemoryBtn = $("clearMemoryBtn");
const sheetFileList = $("sheetFileList");

const progressWrap = $("progressWrap");
const progressText = $("progressText");
const progressPercent = $("progressPercent");
const progressBar = $("progressBar");

const stateDot = $("stateDot");
const stateTitle = $("stateTitle");
const stateDetail = $("stateDetail");
const presence = $("presence");
const modelStatus = $("modelStatus");
const assistantSubtitle = $("assistantSubtitle");
const composerNote = $("composerNote");

const contextBanner = $("contextBanner");
const contextText = $("contextText");
const clearContextBtn = $("clearContextBtn");
const chatSearchInput = $("chatSearchInput");
const headerChatTitle = $("headerChatTitle");
const headerNewChatBtn = $("headerNewChatBtn");
const sidebarModelText = $("sidebarModelText");
const themeToggleBtn = $("themeToggleBtn");
const themeSelect = $("themeSelect");
const performanceSelect = $("performanceSelect");
const performanceStatus = $("performanceStatus");
const performanceHelp = $("performanceHelp");
const modelSettingGroup = $("modelSettingGroup");
const modelHelpText = $("modelHelpText");
const autoToolsSelect = $("autoToolsSelect");
const agentStatus = $("agentStatus");
const agentActivityBar = $("agentActivityBar");
const agentActivityText = $("agentActivityText");
const agentCardStatus = $("agentCardStatus");
const agentToolCount = $("agentToolCount");
const agentHistoryList = $("agentHistoryList");

const toolsBtn = $("toolsBtn");
const toolsSheet = $("toolsSheet");
const calculatorInput = $("calculatorInput");
const calculatorRunBtn = $("calculatorRunBtn");
const calculatorResult = $("calculatorResult");
const codeRunnerInput = $("codeRunnerInput");
const codeRunBtn = $("codeRunBtn");
const codeOutput = $("codeOutput");
const noteInput = $("noteInput");
const saveNoteBtn = $("saveNoteBtn");
const notesList = $("notesList");
const localTimeBtn = $("localTimeBtn");
const searchFilesToolBtn = $("searchFilesToolBtn");
const localToolOutput = $("localToolOutput");

boot();

async function boot() {
  applyTheme(state.theme || "light", false);
  bindVisualViewport();
  bindAuthEvents();
  registerPickloServiceWorker();

  const { data, error } = await supabase.auth.getSession();
  if (error) setAuthMessage(error.message);
  let initialSession = data?.session || null;
  if (initialSession?.user && !initialSession.user.is_anonymous) {
    const expiresAtMs = Number(initialSession.expires_at || 0) * 1000;
    if (expiresAtMs && expiresAtMs <= Date.now() + 30000) {
      initialSession = await getValidRegisteredSession();
    }
  }
  await handleAuthSession(initialSession);

  supabase.auth.onAuthStateChange((_event, session) => {
    setTimeout(() => {
      handleAuthSession(session).catch((sessionError) => {
        console.error("Picklo session update failed:", sessionError);
        setAuthMessage(sessionError?.message || "Could not open your Picklo account.");
      });
    }, 0);
  });
}

function bindVisualViewport() {
  const viewport = window.visualViewport;

  const update = () => {
    const height = Math.max(1, Math.round(viewport?.height || window.innerHeight));
    const top = Math.max(0, Math.round(viewport?.offsetTop || 0));
    const inputFocused = document.activeElement === messageInput;

    if (!inputFocused) largestVisualViewportHeight = Math.max(largestVisualViewportHeight, height);
    if (!largestVisualViewportHeight) largestVisualViewportHeight = height;

    document.documentElement.style.setProperty("--picklo-viewport-height", `${height}px`);
    document.documentElement.style.setProperty("--picklo-viewport-top", `${top}px`);
    document.documentElement.dataset.keyboard = inputFocused && largestVisualViewportHeight - height > 100
      ? "open"
      : "closed";

    if (inputFocused && Math.abs(previousVisualViewportHeight - height) > 24) {
      requestAnimationFrame(() => {
        scrollToBottom(false);
        // iOS Safari can keep the layout viewport tall while shrinking only visualViewport.
        // Keeping the app fixed to visualViewport plus resetting page scroll keeps the composer above the keyboard.
        if (window.scrollY !== 0) window.scrollTo(0, 0);
      });
    }
    previousVisualViewportHeight = height;
  };

  update();
  window.addEventListener("resize", update, { passive: true });
  window.addEventListener("orientationchange", () => {
    largestVisualViewportHeight = 0;
    setTimeout(update, 80);
  }, { passive: true });
  viewport?.addEventListener("resize", update, { passive: true });
  viewport?.addEventListener("scroll", update, { passive: true });
  messageInput.addEventListener("focus", () => {
    update();
    setTimeout(update, 80);
    setTimeout(update, 280);
  });
  messageInput.addEventListener("blur", () => setTimeout(update, 80));
}

function bindAuthEvents() {
  authSignInTab.addEventListener("click", () => setAuthMode("sign-in"));
  authSignUpTab.addEventListener("click", () => setAuthMode("sign-up"));
  authForm.addEventListener("submit", handleAuthSubmit);
  authGuestBtn?.addEventListener("click", () => {
    authReason = "";
    pendingProtectedAction = null;
    pendingGuestChat = null;
    setAuthGateOpen(false);
    // On mobile, do not immediately reopen the keyboard after dismissing login.
    if (window.matchMedia?.("(pointer: fine)")?.matches) messageInput?.focus();
  });
  signOutBtn.addEventListener("click", async () => {
    signOutBtn.disabled = true;
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
    } catch (error) {
      setCloudSyncStatus(error?.message || "Could not sign out.", true);
    } finally {
      signOutBtn.disabled = false;
    }
  });
}

function setAuthMode(mode) {
  authMode = mode === "sign-up" ? "sign-up" : "sign-in";
  const signingUp = authMode === "sign-up";
  authSignInTab.classList.toggle("active", !signingUp);
  authSignUpTab.classList.toggle("active", signingUp);
  authSignInTab.setAttribute("aria-selected", String(!signingUp));
  authSignUpTab.setAttribute("aria-selected", String(signingUp));
  authTitle.textContent = signingUp
    ? "Create your Picklo account"
    : (authReason || "Sign in to Picklo");
  authSubmitBtn.textContent = signingUp ? "Create account" : "Sign in";
  authPassword.autocomplete = signingUp ? "new-password" : "current-password";
  setAuthMessage("");
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  const email = authEmail.value.trim();
  const password = authPassword.value;
  if (!email || password.length < 6) return;

  setAuthBusy(true);
  setAuthMessage("");

  try {
    if (currentUser?.is_anonymous) {
      await supabase.auth.signOut();
      currentUser = null;
    }
    if (authMode === "sign-up") {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: new URL("./", window.location.href).href }
      });
      if (error) throw error;
      authPassword.value = "";
      if (!data.session) {
        setAuthMessage("Check your email to confirm the account, then sign in.", true);
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      authPassword.value = "";
    }
  } catch (error) {
    setAuthMessage(error?.message || "Authentication failed. Please try again.");
  } finally {
    setAuthBusy(false);
  }
}

function setAuthBusy(busy) {
  authSubmitBtn.disabled = busy;
  authSignInTab.disabled = busy;
  authSignUpTab.disabled = busy;
  if (busy) authSubmitBtn.textContent = authMode === "sign-up" ? "Creating account…" : "Signing in…";
  else authSubmitBtn.textContent = authMode === "sign-up" ? "Create account" : "Sign in";
}

function setAuthMessage(message, success = false) {
  authMessage.textContent = message || "";
  authMessage.classList.toggle("success", Boolean(success));
}

function isRegisteredUser() {
  return Boolean(currentUser && !currentUser.is_anonymous && currentUser.email);
}

function isGuestUser() {
  return !isRegisteredUser();
}

function setAuthGateOpen(open, { loading = false } = {}) {
  const shouldOpen = Boolean(open);
  authGate.hidden = !shouldOpen;
  authGate.classList.toggle("session-loading", shouldOpen && loading);
  document.documentElement.dataset.auth = shouldOpen ? "open" : "closed";

  if (shouldOpen) {
    messageInput?.blur();
    closeSheets();
    appRoot?.setAttribute("inert", "");
    appRoot?.setAttribute("aria-hidden", "true");
  } else {
    appRoot?.removeAttribute("inert");
    appRoot?.removeAttribute("aria-hidden");
  }
}

function showAuthGate(reason = "Sign in to continue") {
  authReason = reason;
  setAuthMode("sign-in");
  authGuestBtn?.classList.remove("hidden");
  setAuthMessage("");
  setAuthGateOpen(true);

  // Do not force the iPhone keyboard open when the account screen appears.
  const desktopPointer = window.matchMedia?.("(pointer: fine)")?.matches && window.innerWidth > 760;
  if (desktopPointer) setTimeout(() => authEmail?.focus(), 60);
}

function requireRegisteredAccount(action, payload = null) {
  if (isRegisteredUser()) return true;
  pendingProtectedAction = { action, payload };
  if (isGuestUser()) pendingGuestChat = cloneActiveGuestChat();
  const reason = action === "upload"
    ? "Sign in to attach photos or documents"
    : action === "download"
      ? "Sign in to download this file"
      : "Sign in to continue";
  showAuthGate(reason);
  return false;
}

async function getValidRegisteredSession() {
  try {
    let { data, error } = await supabase.auth.getSession();
    if (error) return null;
    let session = data?.session || null;
    const validUser = () => Boolean(session?.access_token && session?.user && !session.user.is_anonymous && session.user.email);
    if (!validUser()) return null;

    const expiresAtMs = Number(session.expires_at || 0) * 1000;
    if (expiresAtMs && expiresAtMs <= Date.now() + 30000) {
      const refreshed = await supabase.auth.refreshSession();
      if (refreshed.error) return null;
      session = refreshed.data?.session || null;
    }
    return validUser() ? session : null;
  } catch {
    return null;
  }
}

async function ensureRegisteredAccount(action, payload = null) {
  const session = await getValidRegisteredSession();
  if (session) {
    currentUser = session.user;
    if (!loadedUserId) loadedUserId = session.user.id;
    return true;
  }
  pendingProtectedAction = { action, payload };
  if (isGuestUser()) pendingGuestChat = cloneActiveGuestChat();
  const reason = action === "upload"
    ? "Sign in to attach photos or documents"
    : action === "download"
      ? "Sign in to download this file"
      : "Sign in to continue";
  showAuthGate(reason);
  return false;
}

function cloneActiveGuestChat() {
  try {
    const chat = getActiveChat();
    return JSON.parse(JSON.stringify(chat));
  } catch {
    return null;
  }
}

async function mergePendingGuestChatIntoAccount() {
  const guestChat = pendingGuestChat;
  if (!guestChat?.id) return;
  pendingGuestChat = null;

  const normalized = normalizeChat(guestChat);
  if (!normalized) return;
  const existingIndex = state.chats.findIndex((chat) => chat.id === normalized.id);
  if (existingIndex >= 0) state.chats[existingIndex] = normalized;
  else state.chats.unshift(normalized);
  state.activeChatId = normalized.id;
  state.activeMode = normalized.mode || state.defaultMode || "general";

  // Transfer generated-file payloads into this account's device-only asset store.
  for (const message of normalized.messages || []) {
    if (message.artifact || message.attachments?.length) await putLocalMessageAsset(message);
  }
}

async function resumePendingProtectedAction() {
  if (!isRegisteredUser() || !pendingProtectedAction) return;
  const pending = pendingProtectedAction;
  pendingProtectedAction = null;
  authReason = "";

  // iOS blocks file pickers/downloads that are launched long after the original
  // user gesture. Resume with a clear instruction instead of a fragile auto-click.
  if (pending.action === "upload") {
    composerNote.textContent = "Signed in. Tap the paperclip again to add your photo or document.";
    setTimeout(() => { composerNote.textContent = getDefaultComposerNote(); }, 3500);
  } else if (pending.action === "download") {
    composerNote.textContent = "Signed in. Tap Download again to save the file.";
    setTimeout(() => { composerNote.textContent = getDefaultComposerNote(); }, 3500);
  }
}

async function handleAuthSession(session) {
  const user = session?.user || null;

  if (!user || user.is_anonymous) {
    const leavingRegisteredScope = Boolean(loadedUserId);
    currentUser = user;
    loadedUserId = null;
    cloudSyncPaused = true;
    if (cloudSyncTimer) clearTimeout(cloudSyncTimer);
    cloudSyncTimer = null;
    lastCloudSnapshot = "";

    // On sign-out/session loss, always leave the previous account state behind.
    // Otherwise a registered user's chats could remain visible and then be saved
    // into the guest localStorage scope.
    if (leavingRegisteredScope || !appEventsBound || appRoot.hidden) {
      await startGuestApp();
    } else {
      renderAccount();
      setAuthGateOpen(false);
    }
    return;
  }

  if (loadedUserId === user.id && !appRoot.hidden) {
    currentUser = user;
    renderAccount();
    setAuthGateOpen(false);
    await resumePendingProtectedAction();
    return;
  }
  if (loadedUserId === user.id && sessionLoadPromise) return sessionLoadPromise;

  currentUser = user;
  loadedUserId = user.id;
  appRoot.hidden = true;
  authReason = "";
  setAuthMode("sign-in");
  authTitle.textContent = "Opening Picklo…";
  setAuthMessage("Loading your conversations…", true);
  setAuthGateOpen(true, { loading: true });
  sessionLoadPromise = startAuthenticatedApp(user).finally(() => {
    sessionLoadPromise = null;
  });
  return sessionLoadPromise;
}

async function startGuestApp() {
  cloudSyncPaused = true;
  state = loadState();
  applyTheme(state.theme || "light", false);
  await configureInferenceRuntime();
  applyPerformanceProfile(state.performanceProfile || "balanced", false, false);

  if (!appEventsBound) {
    bindEvents();
    appEventsBound = true;
  }

  // Attachments are account-gated and never exposed from another signed-in user's local file store.
  localFiles = [];
  ensureActiveChat();
  defaultModeSelect.value = state.defaultMode || "general";
  themeSelect.value = state.theme || "light";
  performanceSelect.value = state.performanceProfile || "balanced";
  autoToolsSelect.value = state.autoTools === false ? "off" : "on";
  renderAgentHistory();
  renderAccount();

  messageInput.disabled = false;
  sendBtn.disabled = false;
  messageInput.placeholder = "Message Picklo…";

  setMode(state.activeMode || state.defaultMode || "general", false);
  renderAll();
  appRoot.hidden = false;
  setAuthGateOpen(false);
  setAuthMessage("");
  saveState();

  if (activeInferenceMode === "local") {
    preserveLocalModelCache();
    autoStartModel().catch((error) => console.warn("Guest model warmup failed:", error));
  } else {
    setCloudRuntimeReady();
  }
}

async function startAuthenticatedApp(user) {
  cloudSyncPaused = true;
  state = loadStateForUser(user.id);
  applyTheme(state.theme || "light", false);
  await configureInferenceRuntime();
  applyPerformanceProfile(state.performanceProfile || "balanced", false, false);

  if (!appEventsBound) {
    bindEvents();
    appEventsBound = true;
  }

  localFiles = await listLocalFiles();
  let cloudLoaded = false;
  try {
    await loadChatsFromCloud();
    await rehydrateLocalMessageAssets();
    cloudLoaded = true;
    setCloudSyncStatus("Conversations saved to your account");
  } catch (error) {
    console.error("Picklo conversation load failed:", error);
    setCloudSyncStatus("Cloud sync unavailable — changes will retry", true);
  }

  await mergePendingGuestChatIntoAccount();
  ensureActiveChat();
  defaultModeSelect.value = state.defaultMode || "general";
  themeSelect.value = state.theme || "light";
  performanceSelect.value = state.performanceProfile || "balanced";
  autoToolsSelect.value = state.autoTools === false ? "off" : "on";
  renderAgentHistory();
  renderAccount();

  messageInput.disabled = false;
  sendBtn.disabled = false;
  messageInput.placeholder = "Message Picklo…";

  setMode(state.activeMode || state.defaultMode || "general", false);
  renderAll();
  appRoot.hidden = false;
  setAuthGateOpen(false);
  setAuthMessage("");
  authReason = "";

  cloudSyncPaused = false;
  if (!cloudLoaded) lastCloudSnapshot = "";
  saveState();

  if (activeInferenceMode === "local") {
    preserveLocalModelCache();
    autoStartModel().catch((error) => console.warn("Authenticated model warmup failed:", error));
  } else {
    setCloudRuntimeReady();
  }
  await resumePendingProtectedAction();
}

function renderAccount() {
  const registered = isRegisteredUser();
  document.documentElement.dataset.account = registered ? "registered" : "guest";
  const email = registered ? currentUser.email : "Guest mode";
  const initial = registered ? (email.trim().charAt(0).toUpperCase() || "U") : "G";
  accountEmail.textContent = email;
  accountInitial.textContent = initial;
  settingsAccountInitial.textContent = initial;
  signOutBtn.hidden = !registered;
  accountSummary?.classList.toggle("guest-account-link", !registered);
  if (accountSummary) {
    if (!registered) {
      accountSummary.setAttribute("role", "button");
      accountSummary.setAttribute("tabindex", "0");
      accountSummary.setAttribute("aria-label", "Sign in or create a Picklo account");
      accountSummary.title = "Sign in or create account";
    } else {
      accountSummary.removeAttribute("role");
      accountSummary.removeAttribute("tabindex");
      accountSummary.removeAttribute("aria-label");
      accountSummary.removeAttribute("title");
    }
  }
  if (!registered) setCloudSyncStatus("Guest mode — chats stay in this browser");
}

function setCloudSyncStatus(message, isError = false) {
  cloudSyncStatus.textContent = message;
  cloudSyncStatus.dataset.state = isError ? "error" : "ready";
}

function registerPickloServiceWorker() {
  if (!("serviceWorker" in navigator)) return;

  let refreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (refreshing) return;
    refreshing = true;
    location.reload();
  });

  navigator.serviceWorker.register("./sw.js?v=8.2.2-fix4", { updateViaCache: "none" }).then((registration) => {
    const check = () => registration.update().catch(() => {});
    check();
    window.addEventListener("pageshow", check);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) check(); });
    setInterval(check, 60000);
  }).catch(() => {});
}

async function preserveLocalModelCache() {
  try {
    if (navigator.storage?.persist) await navigator.storage.persist();
  } catch {
    // Persistence is a browser preference; model caching still works without it.
  }
}

function bindEvents() {
  window.addEventListener("picklo:account-required", (event) => {
    requireRegisteredAccount(event.detail?.action || "upload", event.detail?.payload || null);
  });
  window.addEventListener("picklo:local-files-mutated", async () => {
    localFiles = await listLocalFiles();
    renderFiles();
    renderStats();
  });
  newChatBtn.addEventListener("click", createNewChat);
  headerNewChatBtn.addEventListener("click", createNewChat);
  chatSearchInput.addEventListener("input", renderChats);

  mobileNewChatBtn.addEventListener("click", () => {
    createNewChat();
    closeSheets();
  });

  clearChatsBtn.addEventListener("click", async () => {
    if (!confirm(isRegisteredUser() ? "Delete every Picklo conversation saved to your account?" : "Delete every guest conversation stored in this browser?")) return;
    clearChatsBtn.disabled = true;
    try {
      if (isRegisteredUser()) {
        const { error } = await supabase
          .from("picklo_conversations")
          .delete()
          .eq("user_id", currentUser.id);
        if (error) throw error;
      }

      const removedChats = [...state.chats];
      cloudSyncPaused = true;
      state.chats = [];
      state.activeChatId = null;
      await deleteLocalMessageAssetsForChats(removedChats);
      window.dispatchEvent(new CustomEvent("picklo:local-chats-deleted", {
        detail: { chatIds: removedChats.map((chat) => chat.id).filter(Boolean) }
      }));
      ensureActiveChat();
      lastCloudSnapshot = "";
      cloudSyncPaused = false;
      saveState();
      renderAll();
    } catch (error) {
      setCloudSyncStatus(error?.message || "Could not clear conversations.", true);
    } finally {
      clearChatsBtn.disabled = false;
    }
  });

  settingsBtn.addEventListener("click", () => openSheet(settingsSheet));
  accountBtn.addEventListener("click", () => {
    if (isRegisteredUser()) openSheet(settingsSheet);
    else showAuthGate("Sign in to your Picklo account");
  });
  accountSummary?.addEventListener("click", () => {
    if (isRegisteredUser()) return;
    closeSheets();
    showAuthGate("Sign in to your Picklo account");
  });
  accountSummary?.addEventListener("keydown", (event) => {
    if (isRegisteredUser() || !["Enter", " "].includes(event.key)) return;
    event.preventDefault();
    closeSheets();
    showAuthGate("Sign in to your Picklo account");
  });
  panelModelBtn.addEventListener("click", () => openSheet(settingsSheet));
  startButton.addEventListener("click", () => openSheet(settingsSheet));

  toolsBtn.addEventListener("click", () => { renderNotes(); renderAgentHistory(); openSheet(toolsSheet); });
  document.querySelectorAll("[data-tool-tab]").forEach((button) => button.addEventListener("click", () => switchToolTab(button.dataset.toolTab)));
  calculatorRunBtn.addEventListener("click", runCalculator);
  calculatorInput.addEventListener("keydown", (event) => { if (event.key === "Enter") runCalculator(); });
  codeRunBtn.addEventListener("click", runSandboxedCode);
  saveNoteBtn.addEventListener("click", saveQuickNote);
  localTimeBtn.addEventListener("click", showLocalTime);
  searchFilesToolBtn.addEventListener("click", useFileSearchTool);

  filesBtn.addEventListener("click", () => openSheet(filesSheet));
  panelFilesBtn.addEventListener("click", () => openSheet(filesSheet));

  memoryBtn.addEventListener("click", () => {
    renderMemory();
    openSheet(memorySheet);
  });
  panelMemoryBtn.addEventListener("click", () => {
    renderMemory();
    openSheet(memorySheet);
  });

  mobileMenuBtn.addEventListener("click", () => openSheet(conversationsSheet));

  document.querySelectorAll("[data-close-sheet]").forEach((button) => {
    button.addEventListener("click", closeSheets);
  });
  backdrop.addEventListener("click", closeSheets);

  document.querySelectorAll("[data-mobile-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.dataset.mobileAction;
      if (action === "tools") { renderNotes(); renderAgentHistory(); openSheet(toolsSheet); }
      if (action === "files") openSheet(filesSheet);
      if (action === "memory") {
        renderMemory();
        openSheet(memorySheet);
      }
      if (action === "settings") openSheet(settingsSheet);
    });
  });

  document.querySelectorAll("[data-mode]").forEach((button) => {
    button.addEventListener("click", () => setMode(button.dataset.mode));
  });
  document.querySelectorAll("[data-sheet-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      setMode(button.dataset.sheetMode);
      closeSheets();
    });
  });

  modelSelect.addEventListener("change", () => {
    state.selectedModel = modelSelect.value;
    state.modelPreference = "manual";
    saveState();
    if (loadedModelId && loadedModelId !== state.selectedModel) {
      loadModelBtn.textContent = "Switch to selected model";
      setRuntime("Model change ready", "Start the selected model", "idle");
    }
  });

  defaultModeSelect.addEventListener("change", () => {
    state.defaultMode = defaultModeSelect.value;
    saveState();
  });

  themeToggleBtn.addEventListener("click", () => {
    const next = (state.theme || "light") === "dark" ? "light" : "dark";
    applyTheme(next, true);
  });

  themeSelect.addEventListener("change", () => {
    applyTheme(themeSelect.value, true);
  });

  autoToolsSelect.addEventListener("change", () => {
    state.autoTools = autoToolsSelect.value !== "off";
    saveState();
    renderAgentHistory();
    setAgentIdle();
  });

  performanceSelect.addEventListener("change", async () => {
    state.modelPreference = "auto";
    applyPerformanceProfile(performanceSelect.value, true, true);
    if (activeInferenceMode === "local") await loadSelectedModel({ automatic: true });
    else setCloudRuntimeReady();
  });

  loadModelBtn.addEventListener("click", () => loadSelectedModel({ automatic: false }));

  chatForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await sendMessage();
  });

  messageInput.addEventListener("input", autoResize);
  messageInput.addEventListener("keydown", async (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      await sendMessage();
    }
  });

  stopBtn.addEventListener("click", stopGeneration);

  messages.addEventListener("click", (event) => {
    const prompt = event.target.closest("[data-prompt]");
    if (prompt) {
      const mode = prompt.dataset.mode;
      if (mode) setMode(mode);
      messageInput.value = prompt.dataset.prompt || "";
      autoResize();
      messageInput.focus();
      return;
    }

    const copy = event.target.closest(".copy-code");
    if (copy) {
      const code = copy.closest(".code-block")?.querySelector("code")?.textContent || "";
      navigator.clipboard?.writeText(code).then(() => {
        const old = copy.textContent;
        copy.textContent = "Copied";
        setTimeout(() => (copy.textContent = old), 1000);
      });
    }
  });

  attachButton?.addEventListener("click", (event) => {
    event.preventDefault();
    // Keep fileInput.click() inside the original tap gesture so iOS Safari opens
    // the picker reliably. The change handler validates session freshness again.
    if (!requireRegisteredAccount("upload")) return;
    fileInput?.click();
  });

  document.querySelectorAll('label[for="fileInput"]').forEach((label) => {
    label.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!requireRegisteredAccount("upload")) return;
      fileInput?.click();
    }, true);
  });

  fileInput.addEventListener("change", async (event) => {
    if (!(await ensureRegisteredAccount("upload"))) {
      event.target.value = "";
      return;
    }
    await handleFiles(event);
  });
  clearContextBtn.addEventListener("click", () => {
    activeFileSources = [];
    renderContext();
  });

  addMemoryBtn.addEventListener("click", () => {
    const text = memoryInput.value.trim();
    if (!text) return;
    addMemory(text);
    memoryInput.value = "";
    renderMemory();
    renderStats();
  });

  clearMemoryBtn.addEventListener("click", () => {
    if (!state.memories.length) return;
    if (!confirm("Clear all Picklo memory?")) return;
    state.memories = [];
    saveState();
    renderMemory();
    renderStats();
  });

  dataBtn.addEventListener("click", () => openSheet(dataSheet));
  exportDataBtn.addEventListener("click", exportData);
  importDataInput.addEventListener("change", importData);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeSheets();
  });
}

function applyTheme(theme, persist = true) {
  const normalized = theme === "dark" ? "dark" : "light";
  state.theme = normalized;

  document.documentElement.dataset.theme = normalized;

  if (themeSelect) {
    themeSelect.value = normalized;
  }

  if (themeToggleBtn) {
    const dark = normalized === "dark";
    themeToggleBtn.setAttribute(
      "aria-label",
      dark ? "Switch to light mode" : "Switch to dark mode"
    );
    themeToggleBtn.title = dark ? "Light mode" : "Dark mode";
  }

  if (persist) {
    saveState();
  }
}

function loadState() {
  try {
    const current = localStorage.getItem(STORAGE_KEY);
    if (current) return normalizeState(JSON.parse(current));

    const v61 = localStorage.getItem(V61_STORAGE_KEY);
    if (v61) {
      const migrated = normalizeState(JSON.parse(v61));
      if (!migrated.performanceProfile) migrated.performanceProfile = "balanced";
      if (typeof migrated.autoTools !== "boolean") migrated.autoTools = true;
      if (!Array.isArray(migrated.agentHistory)) migrated.agentHistory = [];
      migrated.version = APP_VERSION;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
      return migrated;
    }
  } catch (error) {
    console.warn("Picklo state load failed:", error);
  }
  return defaultState();
}

function normalizeState(parsed) {
  const chats = Array.isArray(parsed?.chats)
    ? parsed.chats.map(normalizeChat).filter(Boolean)
    : [];

  return {
    ...defaultState(),
    ...parsed,
    performanceProfile: PERFORMANCE_PROFILES[parsed?.performanceProfile] ? parsed.performanceProfile : "balanced",
    modelPreference: parsed?.modelPreference === "manual" ? "manual" : "auto",
    autoTools: typeof parsed?.autoTools === "boolean" ? parsed.autoTools : true,
    agentHistory: Array.isArray(parsed?.agentHistory) ? parsed.agentHistory.slice(0, 20) : [],
    notes: Array.isArray(parsed?.notes) ? parsed.notes : [],
    memories: Array.isArray(parsed?.memories) ? parsed.memories : [],
    chats
  };
}

function normalizeChat(chat) {
  if (!chat || typeof chat !== "object") return null;
  const createdAt = normalizeTimestamp(chat.createdAt);
  return {
    ...chat,
    id: isUuid(chat.id) ? chat.id : createId(),
    title: String(chat.title || "New chat").slice(0, 120),
    mode: MODE_PROMPTS[chat.mode] ? chat.mode : "general",
    createdAt,
    updatedAt: normalizeTimestamp(chat.updatedAt || createdAt),
    messages: Array.isArray(chat.messages)
      ? chat.messages.map(normalizeMessage).filter(Boolean)
      : []
  };
}

function normalizeMessage(message) {
  if (!message || !["user", "assistant"].includes(message.role)) return null;
  return {
    ...message,
    id: isUuid(message.id) ? message.id : createId(),
    role: message.role,
    content: String(message.content || ""),
    createdAt: normalizeTimestamp(message.createdAt)
  };
}

function normalizeTimestamp(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

function createId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function loadStateForUser(userId) {
  try {
    const saved = localStorage.getItem(`${USER_STATE_PREFIX}:${userId}`);
    if (saved) return normalizeState(JSON.parse(saved));
  } catch (error) {
    console.warn("Picklo user cache load failed:", error);
  }

  const previous = loadState();
  return normalizeState({ ...previous, activeChatId: null, chats: [] });
}

function saveState() {
  try {
    state.version = APP_VERSION;
    const key = isRegisteredUser() ? `${USER_STATE_PREFIX}:${currentUser.id}` : STORAGE_KEY;
    localStorage.setItem(key, JSON.stringify(state));
  } catch (error) {
    console.warn("Picklo state save failed:", error);
  }

  scheduleCloudSync();
}

function createCloudSnapshot() {
  for (const chat of state.chats) {
    if (!isUuid(chat.id)) chat.id = createId();
    chat.messages = (chat.messages || []).map(normalizeMessage).filter(Boolean);
  }

  return JSON.stringify(state.chats.map((chat) => ({
    id: chat.id,
    title: String(chat.title || "New chat").slice(0, 120),
    mode: MODE_PROMPTS[chat.mode] ? chat.mode : "general",
    createdAt: normalizeTimestamp(chat.createdAt),
    updatedAt: normalizeTimestamp(chat.updatedAt),
    messages: chat.messages
      .filter((message) => String(message.content || "").trim() || (!message.attachments?.length && !message.artifact))
      .map((message) => ({
        id: message.id,
        role: message.role,
        content: String(message.content || ""),
        // A generated file's full source lives only in the local artifact record.
        modelContent: message.artifact ? null : (message.modelContent ? String(message.modelContent) : null),
        // Local filenames/source chips are device-only metadata.
        sources: [],
        tool: message.artifact || message.attachments?.length ? "" : String(message.tool || ""),
        attachments: [],
        artifact: null,
        createdAt: normalizeTimestamp(message.createdAt)
      }))
  })));
}

function scheduleCloudSync() {
  if (cloudSyncPaused || !isRegisteredUser()) return;
  const snapshot = createCloudSnapshot();
  if (snapshot === lastCloudSnapshot) return;

  if (cloudSyncTimer) clearTimeout(cloudSyncTimer);
  setCloudSyncStatus("Saving conversations…");
  const userId = currentUser.id;

  cloudSyncTimer = setTimeout(() => {
    cloudSyncTimer = null;
    cloudSyncChain = cloudSyncChain
      .catch(() => {})
      .then(() => flushCloudSync(snapshot, userId))
      .catch((error) => {
        console.error("Picklo cloud sync failed:", error);
        setCloudSyncStatus("Could not save — retrying", true);
        if (currentUser?.id === userId) setTimeout(scheduleCloudSync, 5000);
      });
  }, CLOUD_SYNC_DELAY);
}

async function flushCloudSync(snapshot, userId) {
  if (!isRegisteredUser() || currentUser.id !== userId) return;
  const chats = JSON.parse(snapshot);
  if (!chats.length) return;

  const conversationRows = chats.map((chat) => ({
    id: chat.id,
    user_id: userId,
    title: chat.title,
    mode: chat.mode,
    created_at: new Date(chat.createdAt).toISOString(),
    updated_at: new Date(chat.updatedAt).toISOString()
  }));
  const { error: conversationError } = await supabase
    .from("picklo_conversations")
    .upsert(conversationRows, { onConflict: "id" });
  if (conversationError) throw conversationError;

  const messageRows = chats.flatMap((chat) => chat.messages.map((message) => ({
    id: message.id,
    conversation_id: chat.id,
    user_id: userId,
    role: message.role,
    content: message.content,
    model_content: message.modelContent,
    sources: message.sources,
    tool: message.tool,
    attachments: message.attachments,
    artifact: message.artifact,
    created_at: new Date(message.createdAt).toISOString()
  })));

  for (let index = 0; index < messageRows.length; index += 100) {
    const { error: messageError } = await supabase
      .from("picklo_messages")
      .upsert(messageRows.slice(index, index + 100), { onConflict: "id" });
    if (messageError) throw messageError;
  }

  lastCloudSnapshot = snapshot;
  setCloudSyncStatus("Conversations saved to your account");
}

async function loadChatsFromCloud() {
  if (!isRegisteredUser()) return;
  const [conversationResult, messageResult] = await Promise.all([
    supabase
      .from("picklo_conversations")
      .select("id,title,mode,created_at,updated_at")
      .order("updated_at", { ascending: false }),
    supabase
      .from("picklo_messages")
      .select("id,conversation_id,role,content,model_content,sources,tool,attachments,artifact,created_at")
      .order("created_at", { ascending: true })
  ]);

  if (conversationResult.error) throw conversationResult.error;
  if (messageResult.error) throw messageResult.error;

  const messagesByChat = new Map();
  for (const row of messageResult.data || []) {
    const list = messagesByChat.get(row.conversation_id) || [];
    list.push(normalizeMessage({
      id: row.id,
      role: row.role,
      content: row.content,
      modelContent: row.model_content,
      sources: Array.isArray(row.sources) ? row.sources : [],
      tool: row.tool || "",
      attachments: [],
      artifact: null,
      createdAt: row.created_at
    }));
    messagesByChat.set(row.conversation_id, list);
  }

  state.chats = (conversationResult.data || []).map((row) => normalizeChat({
    id: row.id,
    title: row.title,
    mode: row.mode,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    messages: messagesByChat.get(row.id) || []
  }));
  if (!state.chats.some((chat) => chat.id === state.activeChatId)) {
    state.activeChatId = state.chats[0]?.id || null;
  }
  const active = state.chats.find((chat) => chat.id === state.activeChatId);
  if (active) state.activeMode = active.mode || state.defaultMode || "general";
  lastCloudSnapshot = createCloudSnapshot();
}

const MESSAGE_ASSET_DB = "picklo-local-message-assets-v1";
const MESSAGE_ASSET_STORE = "assets";

function openMessageAssetDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(MESSAGE_ASSET_DB, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(MESSAGE_ASSET_STORE)) {
        db.createObjectStore(MESSAGE_ASSET_STORE, { keyPath: "messageId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function putLocalMessageAsset(message) {
  if (!message?.id || (!message.artifact && !message.attachments?.length)) return;
  try {
    const db = await openMessageAssetDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(MESSAGE_ASSET_STORE, "readwrite");
      tx.objectStore(MESSAGE_ASSET_STORE).put({
        messageId: message.id,
        ownerId: isRegisteredUser() ? currentUser.id : "guest",
        attachments: Array.isArray(message.attachments) ? message.attachments : [],
        artifact: message.artifact || null,
        createdAt: Date.now()
      });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch (error) {
    console.warn("Could not persist local message asset:", error);
  }
}

async function rehydrateLocalMessageAssets() {
  try {
    const db = await openMessageAssetDB();
    const rows = await new Promise((resolve, reject) => {
      const tx = db.transaction(MESSAGE_ASSET_STORE, "readonly");
      const req = tx.objectStore(MESSAGE_ASSET_STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
    const ownerId = isRegisteredUser() ? currentUser.id : "guest";
    const byId = new Map(rows.filter((row) => row?.ownerId === ownerId).map((row) => [row.messageId, row]));
    for (const chat of state.chats) {
      for (const message of chat.messages || []) {
        const local = byId.get(message.id);
        if (!local) continue;
        if (local.attachments?.length) message.attachments = local.attachments;
        if (local.artifact) message.artifact = local.artifact;
      }
    }
  } catch (error) {
    console.warn("Could not restore local message assets:", error);
  }
}

async function deleteLocalMessageAssetsForChat(chat) {
  const ids = new Set((chat?.messages || []).map((message) => message?.id).filter(Boolean));
  if (!ids.size) return;
  try {
    const db = await openMessageAssetDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(MESSAGE_ASSET_STORE, "readwrite");
      const store = tx.objectStore(MESSAGE_ASSET_STORE);
      ids.forEach((id) => store.delete(id));
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch (error) {
    console.warn("Could not remove local message assets for deleted chat:", error);
  }
}

async function deleteLocalMessageAssetsForChats(chats) {
  for (const chat of chats || []) await deleteLocalMessageAssetsForChat(chat);
}

function makeChat() {
  return {
    id: createId(),
    title: "New chat",
    mode: state.defaultMode || "general",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: []
  };
}

function ensureActiveChat() {
  if (state.chats.some((chat) => chat.id === state.activeChatId)) return;

  if (state.chats.length) {
    state.activeChatId = state.chats[0].id;
  } else {
    const chat = makeChat();
    state.chats.unshift(chat);
    state.activeChatId = chat.id;
  }
  saveState();
}

function getActiveChat() {
  ensureActiveChat();
  return state.chats.find((chat) => chat.id === state.activeChatId);
}

function createNewChat() {
  if (isGenerating) return;
  const chat = makeChat();
  state.chats.unshift(chat);
  state.activeChatId = chat.id;
  state.activeMode = chat.mode || state.defaultMode || "general";
  activeFileSources = [];
  saveState();
  messageInput.value = "";
  autoResize();
  setMode(state.activeMode, false);
  renderAll();
  messageInput.focus();
}

function switchChat(id) {
  if (isGenerating) return;
  const chat = state.chats.find((item) => item.id === id);
  if (!chat) return;
  state.activeChatId = id;
  state.activeMode = chat.mode || "general";
  activeFileSources = [];
  saveState();
  setMode(state.activeMode, false);
  renderAll();
  closeSheets();
}

async function deleteChat(id) {
  if (isGenerating) return;
  if (isRegisteredUser()) {
    const { error } = await supabase
      .from("picklo_conversations")
      .delete()
      .eq("id", id)
      .eq("user_id", currentUser.id);
    if (error) {
      setCloudSyncStatus(error.message || "Could not delete the conversation.", true);
      return;
    }
  }

  const removedChat = state.chats.find((chat) => chat.id === id) || null;
  cloudSyncPaused = true;
  if (removedChat) await deleteLocalMessageAssetsForChat(removedChat);
  window.dispatchEvent(new CustomEvent("picklo:local-chats-deleted", { detail: { chatIds: [id] } }));
  state.chats = state.chats.filter((chat) => chat.id !== id);
  if (state.activeChatId === id) state.activeChatId = state.chats[0]?.id || null;
  ensureActiveChat();
  lastCloudSnapshot = "";
  cloudSyncPaused = !isRegisteredUser();
  saveState();
  renderAll();
}

function setMode(mode, persist = true) {
  if (!MODE_PROMPTS[mode]) mode = "general";
  state.activeMode = mode;

  const activeChat = state.chats.find((chat) => chat.id === state.activeChatId);
  if (activeChat) activeChat.mode = mode;

  document.querySelectorAll("[data-mode]").forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === mode);
  });

  assistantSubtitle.textContent = {
    general: activeInferenceMode === "cloud" ? "Cloud AI for this device" : "Local, private and ready",
    write: "Writing and refinement",
    code: "Software reasoning",
    analyze: "Document analysis"
  }[mode];

  if (persist) saveState();
}

function renderAll() {
  renderChats();
  renderHeader();
  renderMessages();
  renderFiles();
  renderStats();
  renderContext();
}

function renderHeader() {
  headerChatTitle.textContent = "Picklo";
}

function renderChats() {
  const query = (chatSearchInput?.value || "").trim().toLowerCase();

  const ordered = [...state.chats]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .filter((chat) => {
      if (!query) return true;
      const haystack = [
        chat.title || "",
        ...(chat.messages || []).slice(-3).map((message) => message.content || "")
      ].join(" ").toLowerCase();
      return haystack.includes(query);
    });

  renderChatList(chatList, ordered);
  renderChatList(mobileChatList, ordered);
}

function renderChatList(container, chats) {
  container.innerHTML = "";

  if (!chats.length) {
    const empty = document.createElement("div");
    empty.className = "chat-empty";
    empty.textContent = chatSearchInput?.value
      ? "No conversations match your search."
      : "Your conversations will appear here.";
    container.appendChild(empty);
    return;
  }

  for (const chat of chats) {
    const row = document.createElement("div");
    row.className = `chat-item${chat.id === state.activeChatId ? " active" : ""}`;

    const open = document.createElement("button");
    open.type = "button";
    open.className = "chat-open";
    open.title = chat.title || "Untitled chat";

    const primary = document.createElement("span");
    primary.className = "chat-primary";
    primary.textContent = chat.title || "Untitled chat";

    const secondary = document.createElement("span");
    secondary.className = "chat-secondary";

    const last = [...(chat.messages || [])]
      .reverse()
      .find((message) => message.content)?.content || "No messages yet";

    const preview = document.createElement("span");
    preview.className = "chat-preview";
    preview.textContent = last.replace(/\s+/g, " ");

    const time = document.createElement("time");
    time.textContent = formatConversationTime(chat.updatedAt);

    secondary.append(preview, time);
    open.append(primary, secondary);
    open.addEventListener("click", () => switchChat(chat.id));

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "chat-delete";
    remove.textContent = "×";
    remove.title = "Delete chat";
    remove.addEventListener("click", (event) => {
      event.stopPropagation();
      deleteChat(chat.id).catch((error) => {
        console.error("Picklo conversation delete failed:", error);
        setCloudSyncStatus("Could not delete the conversation.", true);
      });
    });

    row.append(open, remove);
    container.appendChild(row);
  }
}

function formatConversationTime(value) {
  const date = new Date(value || Date.now());
  const now = new Date();

  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";

  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function renderMessages() {
  const chat = getActiveChat();
  messages.innerHTML = "";
  messages.classList.toggle("has-chat", Boolean(chat.messages.length));

  if (!chat.messages.length) {
    messages.innerHTML = `
      <div class="welcome">
        <img class="welcome-mark" src="assets/picklo-mark.svg" alt="" />
        <h2>How can I help?</h2>
        <p>Talk to Picklo naturally. Ask a question, work through an idea, write something, code, or attach a file.</p>
      </div>`;
    return;
  }

  for (const message of chat.messages) {
    appendMessageToDOM(message.role, message.content, {
      time: message.createdAt,
      sources: message.sources || [],
      tool: message.tool || "",
      attachments: message.attachments || [],
      artifact: message.artifact || null,
      fileArtifact: Boolean(message.artifact),
      scroll: false
    });
  }
  scrollToBottom(false);
}

function appendMessageToDOM(role, content, options = {}) {
  const row = document.createElement("article");
  row.className = `message-row ${role}`;

  if (role === "assistant") {
    const avatar = document.createElement("div");
    avatar.className = "message-avatar";
    avatar.innerHTML = `<img src="assets/picklo-mark.svg" alt="" />`;
    row.appendChild(avatar);
  }

  const wrap = document.createElement("div");
  wrap.className = "message-wrap";

  if (role === "assistant") {
    const name = document.createElement("div");
    name.className = "message-name";
    name.textContent = "Picklo";
    wrap.appendChild(name);
  }

  const bubble = document.createElement("div");
  bubble.className = "message-bubble";

  if (role === "assistant") renderMarkdownInto(bubble, content);
  else if (content) bubble.textContent = content;

  if (options.attachments?.length) {
    renderAttachmentCards(bubble, options.attachments);
  }

  if (options.artifact) {
    renderArtifactCard(bubble, options.artifact);
  }

  if (options.sources?.length) {
    const sources = document.createElement("div");
    sources.className = "source-line";
    options.sources.forEach((source) => {
      const chip = document.createElement("span");
      chip.className = "source-chip";
      chip.textContent = source;
      sources.appendChild(chip);
    });
    bubble.appendChild(sources);
  }

  if (options.tool && shouldExposeToolActivity(options.tool, options)) {
    const usedTool = document.createElement("span");
    usedTool.className = "tool-used";
    usedTool.textContent = `Used ${options.tool}`;
    bubble.appendChild(usedTool);
  }

  const time = document.createElement("time");
  time.className = "message-time";
  time.textContent = formatTime(options.time || Date.now());
  bubble.appendChild(time);

  wrap.appendChild(bubble);

  const actions = document.createElement("div");
  actions.className = "message-actions";
  if (String(content || "").trim()) {
    const copyAction = document.createElement("button");
    copyAction.type = "button";
    copyAction.className = "message-action";
    copyAction.textContent = "Copy";
    copyAction.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(content); copyAction.textContent = "Copied"; }
      catch { copyAction.textContent = "Unavailable"; }
      setTimeout(() => (copyAction.textContent = "Copy"), 1000);
    });
    actions.appendChild(copyAction);
  }
  if (role === "assistant") {
    const regenerateAction = document.createElement("button");
    regenerateAction.type = "button";
    regenerateAction.className = "message-action";
    regenerateAction.textContent = "Regenerate";
    regenerateAction.addEventListener("click", regenerateLastAssistant);
    actions.appendChild(regenerateAction);
  }
  if (actions.childElementCount) wrap.appendChild(actions);
  row.appendChild(wrap);
  messages.appendChild(row);

  if (options.scroll !== false) scrollToBottom();
  return bubble;
}

function formatTime(value) {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function renderAttachmentCards(container, attachments) {
  const group = document.createElement("div");
  group.className = "message-attachments";

  for (const attachment of attachments) {
    const card = document.createElement("div");
    card.className = "attachment-card";

    const icon = document.createElement("span");
    icon.className = "attachment-icon";
    icon.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h6"/></svg>';

    const copy = document.createElement("span");
    copy.className = "attachment-copy";
    const name = document.createElement("strong");
    name.textContent = attachment.name || "Document";
    const status = document.createElement("small");
    status.textContent = `${formatFileSize(attachment.size)} • ${attachment.status || "Ready for analysis"}`;
    copy.append(name, status);

    card.append(icon, copy);
    group.appendChild(card);
  }

  container.appendChild(group);
}

function renderArtifactCard(container, artifact) {
  const card = document.createElement("div");
  card.className = "artifact-card";

  const icon = document.createElement("span");
  icon.className = "artifact-icon";
  icon.textContent = String(artifact.extension || "file").slice(0, 4).toUpperCase();

  const copy = document.createElement("span");
  copy.className = "artifact-copy";
  const name = document.createElement("strong");
  name.textContent = artifact.name;
  const detail = document.createElement("small");
  detail.textContent = `${artifact.label} • ${formatFileSize(new Blob([artifact.content || ""]).size)}`;
  copy.append(name, detail);

  const download = document.createElement("button");
  download.type = "button";
  download.className = "artifact-download";
  download.textContent = "Download";
  download.addEventListener("click", async () => {
    if (!requireRegisteredAccount("download", artifact)) return;
    download.disabled = true;
    download.textContent = "Preparing…";
    try {
      await downloadArtifact(artifact);
      download.textContent = "Downloaded";
    } catch (error) {
      console.error(error);
      download.textContent = "Try again";
    } finally {
      download.disabled = false;
      setTimeout(() => (download.textContent = "Download"), 1400);
    }
  });

  card.append(icon, copy, download);
  container.appendChild(card);
}

function formatFileSize(bytes = 0) {
  const size = Number(bytes) || 0;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function detectRequestedArtifact(input) {
  const text = String(input || "").trim();
  const explicitName = text.match(/\b([a-z0-9][a-z0-9._-]{0,80}\.(?:html?|css|m?js|cjs|ts|tsx|jsx|py|pdf|docx?|txt|md|json|csv|tsv|xml|ya?ml|toml|ini|sql|java|c|cpp|h|hpp|cs|php|rb|go|rs|swift|kt|kts|sh|bash|ps1|rtf|svg|tex))\b/i)?.[1];
  const hasFileVerb = /\b(?:return|give|send|download|export|save|create|make|generate|provide|build)\b/i.test(text);
  const hasFileFormat = /\b(?:file|document|pdf|word|docx?|html|css|javascript|typescript|python|markdown|text|json|csv|xml|yaml|code|website|webpage)\b/i.test(text);

  if (!explicitName && !(hasFileVerb && hasFileFormat)) return null;

  let extension = explicitName?.split(".").pop()?.toLowerCase() || inferArtifactExtension(text);
  if (extension === "htm") extension = "html";
  if (!extension) extension = "txt";

  const format = getArtifactFormat(extension);
  let name = explicitName ? sanitizeArtifactName(explicitName) : defaultArtifactName(text, extension);
  if (!name.toLowerCase().endsWith(`.${extension}`)) name = `${name.replace(/\.[^.]+$/, "")}.${extension}`;

  return { name, extension, ...format };
}

function inferArtifactExtension(text) {
  const formats = [
    ["pdf", /\bpdf\b/i], ["docx", /\b(?:word|microsoft word|docx?|word document)\b/i],
    ["html", /\b(?:html|webpage|website)\b/i], ["css", /\bcss\b/i],
    ["js", /\b(?:javascript|js file)\b/i], ["ts", /\b(?:typescript|ts file)\b/i],
    ["py", /\b(?:python|py file)\b/i], ["json", /\bjson\b/i], ["csv", /\bcsv\b/i],
    ["md", /\b(?:markdown|md file)\b/i], ["xml", /\bxml\b/i], ["yaml", /\bya?ml\b/i],
    ["sql", /\bsql\b/i], ["svg", /\bsvg\b/i], ["txt", /\b(?:plain text|text file|document)\b/i]
  ];
  return formats.find(([, pattern]) => pattern.test(text))?.[0] || "txt";
}

function getArtifactFormat(extension) {
  const formats = {
    pdf: ["PDF document", "application/pdf"],
    docx: ["Word document", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    doc: ["Legacy Word document", "application/msword"],
    html: ["HTML", "text/html"], css: ["CSS", "text/css"], js: ["JavaScript", "text/javascript"],
    mjs: ["JavaScript module", "text/javascript"], cjs: ["JavaScript", "text/javascript"],
    ts: ["TypeScript", "text/typescript"], tsx: ["TypeScript React", "text/typescript"],
    jsx: ["JavaScript React", "text/javascript"], py: ["Python", "text/x-python"],
    json: ["JSON", "application/json"], csv: ["CSV", "text/csv"], tsv: ["TSV", "text/tab-separated-values"],
    md: ["Markdown", "text/markdown"], xml: ["XML", "application/xml"], yaml: ["YAML", "text/yaml"], yml: ["YAML", "text/yaml"],
    svg: ["SVG", "image/svg+xml"], rtf: ["Rich Text", "application/rtf"],
    sql: ["SQL", "text/plain"], java: ["Java", "text/plain"], c: ["C", "text/plain"], cpp: ["C++", "text/plain"],
    h: ["C header", "text/plain"], hpp: ["C++ header", "text/plain"], cs: ["C#", "text/plain"],
    php: ["PHP", "text/plain"], rb: ["Ruby", "text/plain"], go: ["Go", "text/plain"], rs: ["Rust", "text/plain"],
    swift: ["Swift", "text/plain"], kt: ["Kotlin", "text/plain"], kts: ["Kotlin script", "text/plain"],
    sh: ["Shell script", "text/plain"], bash: ["Bash script", "text/plain"], ps1: ["PowerShell", "text/plain"],
    toml: ["TOML", "text/plain"], ini: ["INI", "text/plain"], tex: ["LaTeX", "text/plain"], txt: ["Text document", "text/plain"]
  };
  const [label, mime] = formats[extension] || [`${extension.toUpperCase()} file`, "text/plain"];
  return { label, mime };
}

function defaultArtifactName(text, extension) {
  const slug = String(text)
    .toLowerCase()
    .replace(/\b(?:return|give|send|download|export|save|create|make|generate|provide|build|as|a|an|the|file|document|please)\b/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 42) || "picklo-file";
  return `${slug}.${extension}`;
}

function sanitizeArtifactName(name) {
  return String(name).replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+/, "").slice(0, 100) || "picklo-file.txt";
}

function createArtifactDescriptor(request, reply) {
  const content = extractArtifactContent(reply, request.extension);
  return {
    ...request,
    content: content.slice(0, 600000),
    createdAt: Date.now()
  };
}

function extractArtifactContent(reply, extension) {
  const source = String(reply || "").trim();
  const fences = [...source.matchAll(/```([^\n`]*)\n?([\s\S]*?)```/g)];
  if (!fences.length || ["pdf", "doc", "docx", "txt", "md", "rtf"].includes(extension)) return source;

  const aliases = new Set([extension]);
  if (["js", "mjs", "cjs", "jsx"].includes(extension)) aliases.add("javascript");
  if (["ts", "tsx"].includes(extension)) aliases.add("typescript");
  if (extension === "py") aliases.add("python");
  const preferred = fences.find((match) => aliases.has(String(match[1] || "").trim().toLowerCase()));
  return String((preferred || fences[0])[2] || "").trim();
}

async function downloadArtifact(artifact) {
  let blob;
  if (artifact.extension === "pdf") blob = buildSimplePdfBlob(artifact.content);
  else if (artifact.extension === "docx") blob = await buildDocxBlob(artifact.content);
  else if (artifact.extension === "doc") blob = buildWordCompatibleBlob(artifact.content);
  else blob = new Blob([artifact.content || ""], { type: `${artifact.mime || "text/plain"};charset=utf-8` });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = artifact.name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function buildWordCompatibleBlob(content) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Picklo document</title></head><body><pre style="white-space:pre-wrap;font:11pt/1.5 Arial,sans-serif">${escapeHtmlText(content)}</pre></body></html>`;
  return new Blob([html], { type: "application/msword" });
}

async function buildDocxBlob(content) {
  if (!window.JSZip) {
    await loadExternalScript("https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js", "JSZip");
  }

  const zip = new window.JSZip();
  const paragraphs = String(content || "")
    .replace(/```[^\n]*\n?/g, "")
    .replace(/```/g, "")
    .split(/\r?\n/)
    .map((line) => {
      const clean = line
        .replace(/^\s{0,3}#{1,6}\s+/, "")
        .replace(/^\s*[-*+]\s+/, "• ")
        .replace(/^\s*\d+\.\s+/, (match) => match.trim() + " ")
        .replace(/[*_`]/g, "");
      return `<w:p><w:r><w:t xml:space="preserve">${escapeXmlText(clean || " ")}</w:t></w:r></w:p>`;
    })
    .join("");

  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`);
  zip.folder("_rels").file(".rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`);
  zip.folder("word").file("document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`);
  zip.folder("word").folder("_rels").file("document.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`);
  zip.folder("docProps").file("core.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>Picklo document</dc:title><dc:creator>Picklo</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created></cp:coreProperties>`);
  zip.folder("docProps").file("app.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Picklo</Application></Properties>`);

  return zip.generateAsync({
    type: "blob",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    compression: "DEFLATE"
  });
}

function buildSimplePdfBlob(content) {
  const plain = String(content || "")
    .replace(/```[^\n]*\n?/g, "")
    .replace(/```/g, "")
    .replace(/[*_#>`]/g, "")
    .normalize("NFKD")
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "?");
  const lines = wrapPdfText(plain, 88);
  const pages = [];
  for (let i = 0; i < Math.max(lines.length, 1); i += 52) pages.push(lines.slice(i, i + 52));

  const pageCount = pages.length;
  const fontId = 3 + pageCount * 2;
  const objects = [];
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  const kids = pages.map((_, index) => `${3 + index * 2} 0 R`).join(" ");
  objects[2] = `<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`;

  pages.forEach((pageLines, index) => {
    const pageId = 3 + index * 2;
    const contentId = pageId + 1;
    const commands = pageLines.map((line) => `(${escapePdfText(line)}) Tj T*`).join("\n");
    const stream = `BT\n/F1 10 Tf\n12 TL\n50 790 Td\n${commands}\nET`;
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });
  objects[fontId] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";

  let pdf = "%PDF-1.4\n% Picklo\n";
  const offsets = [0];
  for (let id = 1; id <= fontId; id++) {
    offsets[id] = pdf.length;
    pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${fontId + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= fontId; id++) pdf += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${fontId + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new Blob([pdf], { type: "application/pdf" });
}

function wrapPdfText(text, width) {
  const lines = [];
  for (const paragraph of String(text).replace(/\r/g, "").split("\n")) {
    if (!paragraph.trim()) { lines.push(""); continue; }
    const words = paragraph.trim().split(/\s+/);
    let line = "";
    for (const word of words) {
      if (!line) line = word;
      else if (`${line} ${word}`.length <= width) line += ` ${word}`;
      else { lines.push(line); line = word; }
    }
    if (line) lines.push(line);
  }
  return lines;
}

function escapePdfText(text) {
  return String(text).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function escapeHtmlText(text) {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function escapeXmlText(text) {
  return escapeHtmlText(text).replace(/'/g, "&apos;");
}

function renderStats() {
  memoryCount.textContent = `${state.memories.length} saved`;
  panelMemoryCount.textContent = `${state.memories.length} saved`;

  const fileLabel = `${localFiles.length} ${localFiles.length === 1 ? "local file" : "local files"}`;
  fileCount.textContent = fileLabel;
  panelFileCount.textContent = `${localFiles.length} available`;
}

function getPerformanceProfile() {
  return PERFORMANCE_PROFILES[state.performanceProfile] || PERFORMANCE_PROFILES.balanced;
}

function getAvailableModelIds() {
  return [...modelSelect.options].map((option) => option.value).filter(Boolean);
}

function getRuntimeCapabilities() {
  return detectRuntimeCapabilities({
    deviceMemory: navigator.deviceMemory,
    hardwareConcurrency: navigator.hardwareConcurrency,
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    viewportWidth: window.innerWidth,
    maxTouchPoints: navigator.maxTouchPoints,
    coarsePointer: window.matchMedia?.("(pointer: coarse)")?.matches || false,
    hasWebGPU: "gpu" in navigator
  });
}

async function ensureWebLLMModule() {
  if (webllm) return webllm;
  if (!webllmModulePromise) {
    webllmModulePromise = import("https://esm.run/@mlc-ai/web-llm")
      .then((module) => {
        webllm = module;
        return module;
      })
      .catch((error) => {
        webllmModulePromise = null;
        throw error;
      });
  }
  return webllmModulePromise;
}

async function configureInferenceRuntime() {
  runtimeCapabilities = getRuntimeCapabilities();
  const decision = selectInferenceMode(runtimeCapabilities);
  activeInferenceMode = decision.mode;
  inferenceReason = decision.reason;

  if (activeInferenceMode === "local") {
    try {
      await ensureWebLLMModule();
      populateModels();
      modelSettingGroup.hidden = false;
      modelSelect.disabled = false;
      loadModelBtn.disabled = false;
      performanceHelp.textContent = "Capable desktop computers use a private local model. Picklo falls back to Gemini automatically if local AI cannot start.";
      modelHelpText.textContent = "Advanced local override. Changing the model manually can use more memory and make responses slower.";
      return;
    } catch (error) {
      console.warn("The local AI module could not load; using cloud fallback:", error);
      activeInferenceMode = "cloud";
      inferenceReason = "module-unavailable";
    }
  }

  configureCloudControls();
}

function configureCloudControls() {
  modelSettingGroup.hidden = true;
  modelSelect.disabled = true;
  loadModelBtn.disabled = true;
  performanceHelp.textContent = "Picklo uses Gemini on this device, so no large AI model is downloaded. Performance changes response length and depth.";
  composerNote.textContent = getDefaultComposerNote();
}

function switchToCloudRuntime(reason = "local-fallback") {
  activeInferenceMode = "cloud";
  inferenceReason = reason;
  runtimeCapabilities = getRuntimeCapabilities();
  configureCloudControls();
  setCloudRuntimeReady();
}

function setCloudRuntimeReady() {
  const detail = {
    phone: "Gemini • no phone model download",
    tablet: "Gemini • no tablet model download",
    "webgpu-unavailable": "Gemini • WebGPU not required",
    "limited-hardware": "Gemini • optimized for this computer",
    "module-unavailable": "Gemini • local module fallback",
    "local-fallback": "Gemini • local model fallback"
  }[inferenceReason] || "Gemini • cloud AI";
  setRuntime("Picklo is ready", detail, "ready");
  performanceStatus.textContent = `${getPerformanceProfile().label} • cloud`;
  composerNote.textContent = getDefaultComposerNote();
}

function getDefaultComposerNote() {
  if (!isRegisteredUser()) {
    return activeInferenceMode === "cloud"
      ? "Guest chat stays in this browser. Sign in only to attach photos/documents or download files."
      : "Guest chat stays in this browser. Sign in only to attach photos/documents or download files.";
  }
  return activeInferenceMode === "cloud"
    ? "Chats sync to your account. Files and photos stay only in this browser; Gemini processes them transiently when needed."
    : "Chats sync to your account. The AI model, files and photos stay on this device.";
}

function applyPerformanceProfile(profileName, persist = true, updateModel = true) {
  const normalized = PERFORMANCE_PROFILES[profileName] ? profileName : "fast";
  const profile = PERFORMANCE_PROFILES[normalized];

  state.performanceProfile = normalized;
  const capabilities = runtimeCapabilities || getRuntimeCapabilities();
  performanceStatus.textContent = activeInferenceMode === "cloud" ? `${profile.label} • cloud` : profile.label;

  if (performanceSelect) performanceSelect.value = normalized;

  if (updateModel && activeInferenceMode === "local") {
    const recommended = recommendModelForDevice(normalized, getAvailableModelIds(), capabilities);
    if (recommended) {
      state.selectedModel = recommended;
      modelSelect.value = recommended;
    }
  }

  if (persist) saveState();
}

async function autoStartModel() {
  if (activeInferenceMode === "cloud") {
    setCloudRuntimeReady();
    return null;
  }
  if (engine) return engine;
  if (modelLoadPromise) return modelLoadPromise;

  if (!("gpu" in navigator)) {
    switchToCloudRuntime("webgpu-unavailable");
    return null;
  }

  if (state.modelPreference !== "manual") {
    const recommended = recommendModelForDevice(
      state.performanceProfile,
      getAvailableModelIds(),
      getRuntimeCapabilities()
    );
    if (recommended) {
      state.selectedModel = recommended;
      modelSelect.value = recommended;
      saveState();
    }
  }

  return loadSelectedModel({ automatic: true });
}

function populateModels() {
  const records = webllm.prebuiltAppConfig?.model_list || [];
  const available = new Set(records.map((record) => record.model_id));

  let options = PREFERRED_MODELS.filter((model) => available.has(model.id));

  if (!options.length) {
    options = records
      .filter((record) => !String(record.model_id).toLowerCase().includes("vision"))
      .slice(0, 10)
      .map((record) => ({
        id: record.model_id,
        label: friendlyModelName(record.model_id),
        note: "Available"
      }));
  }

  modelSelect.innerHTML = "";
  for (const model of options) {
    const option = document.createElement("option");
    option.value = model.id;
    option.textContent = `${model.label} — ${model.note}`;
    modelSelect.appendChild(option);
  }

  if (options.some((model) => model.id === state.selectedModel)) {
    modelSelect.value = state.selectedModel;
  } else if (options[0]) {
    state.selectedModel = options[0].id;
    state.modelPreference = "auto";
    modelSelect.value = options[0].id;
    saveState();
  }
}

function friendlyModelName(id) {
  return String(id)
    .replace(/-q\d+f\d+_\d+-MLC.*$/i, "")
    .replace(/-MLC.*$/i, "")
    .replaceAll("-", " ");
}

async function resetModelRuntime() {
  const previousEngine = engine;
  const previousWorker = modelWorker;
  engine = null;
  modelWorker = null;
  loadedModelId = null;

  try {
    await previousEngine?.unload?.();
  } catch (error) {
    console.warn("Model cleanup was incomplete:", error);
  }
  previousWorker?.terminate();
}

async function loadSelectedModel(options = {}) {
  const { automatic = false } = options;
  if (activeInferenceMode === "cloud") {
    setCloudRuntimeReady();
    return null;
  }
  const selected = modelSelect.value || state.selectedModel;

  if (!selected || isGenerating) return;
  if (loadedModelId === selected && engine) return engine;
  if (modelLoadPromise) return modelLoadPromise;

  if (!("gpu" in navigator)) {
    switchToCloudRuntime("webgpu-unavailable");
    if (!automatic) closeSheets();
    return null;
  }

  const profile = getPerformanceProfile();
  const capabilities = getRuntimeCapabilities();
  const allowFallback = state.modelPreference !== "manual";
  const candidates = allowFallback
    ? getModelLoadCandidates(selected, getAvailableModelIds())
    : [selected];

  if (!candidates.length) return;

  loadModelBtn.disabled = true;
  progressWrap.classList.remove("hidden");
  progressBar.style.width = "0%";
  progressPercent.textContent = "0%";

  setRuntime(
    automatic ? "Starting automatically" : "Starting Picklo",
    `${friendlyModelName(selected)} • ${profile.label}${capabilities.isPhone ? " • phone optimized" : ""}`,
    "loading"
  );

  loadModelBtn.textContent = loadedModelId ? "Switching…" : "Loading…";
  messageInput.placeholder = "Picklo is starting in the background…";

  let currentCandidate = selected;
  const onProgress = (report) => {
    const reportText = report?.text || "Preparing Picklo…";
    const percent = typeof report?.progress === "number"
      ? Math.round(report.progress * 100)
      : extractPercent(reportText) ?? 0;
    const prefix = currentCandidate === selected
      ? automatic ? "Starting automatically" : "Starting Picklo"
      : "Trying a lighter model";

    progressText.textContent = `${prefix} • ${reportText}`;
    progressPercent.textContent = `${percent}%`;
    progressBar.style.width = `${percent}%`;
  };

  modelLoadPromise = (async () => {
    let lastError = null;

    try {
      for (let index = 0; index < candidates.length; index += 1) {
        currentCandidate = candidates[index];

        if (index > 0) {
          progressBar.style.width = "0%";
          progressPercent.textContent = "0%";
          progressText.textContent = `Trying a lighter model • ${friendlyModelName(currentCandidate)}`;
          setRuntime(
            "Optimizing for this device",
            `Trying ${friendlyModelName(currentCandidate)}`,
            "loading"
          );
        }

        try {
          if (!engine) {
            modelWorker = new Worker("./webllm-worker.js", { type: "module", name: "picklo-webllm" });
            engine = await webllm.CreateWebWorkerMLCEngine(
              modelWorker,
              currentCandidate,
              {
                initProgressCallback: onProgress,
                appConfig: {
                  ...webllm.prebuiltAppConfig,
                  cacheBackend: "cache"
                }
              }
            );
          } else {
            if (typeof engine.setInitProgressCallback === "function") {
              engine.setInitProgressCallback(onProgress);
            }
            await engine.reload(currentCandidate);
          }

          loadedModelId = currentCandidate;
          state.selectedModel = currentCandidate;
          modelSelect.value = currentCandidate;
          saveState();

          progressBar.style.width = "100%";
          progressPercent.textContent = "100%";
          progressText.textContent = currentCandidate === selected
            ? "Picklo is ready"
            : "Picklo is ready with a lighter model";

          const runtimeNotes = [profile.label];
          if (capabilities.isPhone) runtimeNotes.push("phone optimized");
          if (currentCandidate !== selected) runtimeNotes.push("lighter fallback");
          setRuntime("Picklo is ready", `${friendlyModelName(currentCandidate)} • ${runtimeNotes.join(" • ")}`, "ready");

          messageInput.disabled = false;
          sendBtn.disabled = false;
          messageInput.placeholder = "Message Picklo…";
          loadModelBtn.textContent = "Model ready";

          setTimeout(() => progressWrap.classList.add("hidden"), 700);
          if (!automatic) setTimeout(closeSheets, 160);
          messageInput.focus();
          return engine;
        } catch (error) {
          lastError = error;
          console.warn(`Could not start ${currentCandidate}:`, error);
          await resetModelRuntime();
        }
      }

      console.warn("All local model candidates failed; switching to Gemini:", lastError);
      switchToCloudRuntime("local-fallback");
      loadModelBtn.textContent = "Cloud AI active";
      messageInput.placeholder = "Message Picklo…";
      if (!automatic) closeSheets();
      return null;
    } finally {
      loadModelBtn.disabled = false;
      modelLoadPromise = null;
    }
  })();

  return modelLoadPromise;
}

function extractPercent(text) {
  const match = String(text || "").match(/(\d+(?:\.\d+)?)%/);
  return match ? Math.max(0, Math.min(100, Math.round(Number(match[1])))) : null;
}

function setRuntime(title, detail, stateName = "idle") {
  stateTitle.textContent = title;
  stateDetail.textContent = detail;
  stateDot.className = "state-dot";
  presence.className = "presence";

  if (stateName !== "idle") {
    stateDot.classList.add(stateName);
    presence.classList.add(stateName);
  }

  if (stateName === "ready") {
    const modelName = activeInferenceMode === "cloud"
      ? "Gemini Cloud"
      : friendlyModelName(loadedModelId || state.selectedModel);
    modelStatus.textContent = activeInferenceMode === "cloud" ? "Gemini • Cloud" : `${modelName} • Local`;
    panelModelName.textContent = modelName;
    sidebarModelText.textContent = modelName;
    startButton.title = "Picklo settings";
    startButton.classList.add("ready");
  } else {
    modelStatus.textContent = detail;
    panelModelName.textContent = detail;
    sidebarModelText.textContent = detail;
    startButton.title = stateName === "loading" ? "Picklo is starting" : "Picklo settings";
    startButton.classList.remove("ready");
  }
}

async function generatePrimaryCompletion(messagesForModel, sampling, profile, activityLabel) {
  if (activeInferenceMode === "cloud") {
    const controller = new AbortController();
    cloudAbortController = controller;
    try {
      const result = await requestCloudCompletion({
        messages: messagesForModel,
        temperature: sampling.temperature,
        topP: sampling.topP,
        maxTokens: profile.maxTokens,
        profile: state.performanceProfile,
        purpose: "answer",
        signal: controller.signal
      });
      setAgentActivity("Preparing the answer", activityLabel);
      return {
        text: result.text,
        completionTokens: Number(result.usage?.candidatesTokenCount || result.usage?.totalOutputTokens || 0)
      };
    } catch (error) {
      if (!isRegisteredUser() && Number(error?.status || 0) === 401) {
        throw new Error("Guest cloud chat is temporarily unavailable. Please try again in a moment.");
      }
      throw error;
    } finally {
      if (cloudAbortController === controller) cloudAbortController = null;
    }
  }

  if (!engine) throw new Error("The local AI model is not ready.");
  const stream = await engine.chat.completions.create({
    messages: messagesForModel,
    temperature: sampling.temperature,
    top_p: sampling.topP,
    max_tokens: profile.maxTokens,
    stream: true,
    stream_options: { include_usage: true }
  });

  let text = "";
  let completionTokens = 0;
  let receivedFirstToken = false;
  for await (const chunk of stream) {
    const delta = chunk.choices?.[0]?.delta?.content || "";
    if (chunk.usage?.completion_tokens) completionTokens = chunk.usage.completion_tokens;
    if (!delta) continue;
    if (!receivedFirstToken) {
      receivedFirstToken = true;
      setAgentActivity("Preparing the answer", activityLabel);
    }
    text += delta;
  }
  return { text, completionTokens };
}

async function generateOneShotCompletion(messagesForModel, options = {}) {
  const { temperature = 0.1, topP = 0.8, maxTokens = 800, purpose = "review" } = options;
  if (activeInferenceMode === "cloud") {
    const controller = new AbortController();
    cloudAbortController = controller;
    try {
      const result = await requestCloudCompletion({
        messages: messagesForModel,
        temperature,
        topP,
        maxTokens,
        profile: state.performanceProfile,
        purpose,
        signal: controller.signal
      });
      return result.text;
    } finally {
      if (cloudAbortController === controller) cloudAbortController = null;
    }
  }

  if (!engine) throw new Error("The local AI model is not ready.");
  const result = await engine.chat.completions.create({
    messages: messagesForModel,
    temperature,
    top_p: topP,
    max_tokens: maxTokens,
    stream: false
  });
  return String(result?.choices?.[0]?.message?.content || "");
}

async function sendMessage() {
  const content = messageInput.value.trim();
  if (!content || isGenerating) return;

  const chat = getActiveChat();
  isGenerating = true;
  generationWasStopped = false;
  setGeneratingUI(true);

  const userMessage = { role: "user", content, createdAt: Date.now() };
  chat.messages.push(userMessage);
  chat.mode = state.activeMode;

  if (chat.title === "New chat") chat.title = makeTitle(content);
  chat.updatedAt = Date.now();

  saveState();
  renderChats();
  renderHeader();
  renderMessages();

  messageInput.value = "";
  autoResize();

  let route = null;
  const requestedArtifact = detectRequestedArtifact(content);
  const pendingFileIds = Array.isArray(chat.pendingFileIds) ? chat.pendingFileIds : [];

  try {
    route = state.autoTools ? await routeAgentTool(content) : null;

    if (route?.handled) {
      chat.messages.push({
        role: "assistant",
        content: route.reply,
        createdAt: Date.now(),
        tool: route.tool || ""
      });
      chat.updatedAt = Date.now();

      saveState();
      renderMessages();
      renderChats();
      renderHeader();
      setAgentIdleSoon();
      return;
    }

    const forceFiles = Boolean(route?.forceFiles);
    const shouldRetrieve = pendingFileIds.length > 0 || forceFiles || shouldUseLocalFiles(content);

    let retrieved = [];
    if (shouldRetrieve) {
      setAgentActivity("Searching local files", "File search");
      retrieved = await retrieveLocalContext(route?.query || content, pendingFileIds);
      recordAgentActivity(
        "File search",
        retrieved.length
          ? `Found ${retrieved.length} relevant passage${retrieved.length === 1 ? "" : "s"}`
          : "No relevant passages found"
      );
    }

    const sourceNames = [...new Set(retrieved.map((item) => item.name))];
    activeFileSources = sourceNames;
    renderContext();

    if (activeInferenceMode === "local" && !engine) {
      setAgentActivity("Waiting for the local model to finish starting", "Model");
      try {
        await autoStartModel();
      } catch (error) {
        console.warn("Model startup while sending failed:", error);
      }
    }

    if (activeInferenceMode === "local" && !engine) switchToCloudRuntime("local-fallback");

    setAgentActivity(
      route?.toolName ? `Using ${route.toolName} and answering` : "Thinking",
      route?.toolName || (activeInferenceMode === "cloud" ? "Cloud AI" : "Model")
    );

    const assistantBubble = appendMessageToDOM("assistant", "", {
      time: Date.now(),
      tool: route?.toolName || (retrieved.length ? "File search" : "")
    });
    assistantBubble.classList.add("typing");
    assistantBubble.textContent = "";

    let fullReply = "";
    const generationStartedAt = performance.now();
    const profile = getPerformanceProfile();
    const sampling = getAdaptiveSampling(content, profile, state.activeMode);
    const completion = await generatePrimaryCompletion(
      buildModelMessages(chat, retrieved, route?.toolContext || "", requestedArtifact),
      sampling,
      profile,
      route?.toolName || (activeInferenceMode === "cloud" ? "Cloud AI" : "Model")
    );
    const completionTokens = completion.completionTokens;
    fullReply = completion.text;

    fullReply = cleanAssistantReply(fullReply);

    if (!generationWasStopped && requestedArtifact) {
      fullReply = await repairArtifactIfNeeded(content, requestedArtifact, fullReply, profile);
    } else if (!generationWasStopped && shouldVerifyAnswer(content, profile)) {
      fullReply = await reviewAnswer(content, fullReply, profile);
    }

    const elapsedSeconds = Math.max((performance.now() - generationStartedAt) / 1000, 0.001);
    lastGenerationStats = {
      tokens: completionTokens,
      seconds: elapsedSeconds,
      tokensPerSecond: completionTokens ? completionTokens / elapsedSeconds : null
    };

    if (activeInferenceMode === "local" && lastGenerationStats.tokensPerSecond) {
      performanceStatus.textContent =
        `${profile.label} • ${lastGenerationStats.tokensPerSecond.toFixed(1)} tok/s`;
    } else {
      performanceStatus.textContent = activeInferenceMode === "cloud" ? `${profile.label} • cloud` : profile.label;
    }

    assistantBubble.classList.remove("typing");

    if (generationWasStopped) {
      fullReply = fullReply.trim()
        ? `${fullReply.trim()}\n\n[Generation stopped]`
        : "[Generation stopped]";
    } else if (!fullReply.trim()) {
      fullReply = "I could not complete that response.";
    }

    const artifact = !generationWasStopped && requestedArtifact
      ? createArtifactDescriptor(requestedArtifact, fullReply)
      : null;
    const displayReply = artifact ? `Your **${artifact.label}** file is ready.` : fullReply;

    assistantBubble.textContent = artifact ? `Your ${artifact.label} file is ready.` : fullReply;
    scrollToBottom();

    const assistantMessage = {
      id: createId(),
      role: "assistant",
      content: displayReply,
      modelContent: fullReply,
      createdAt: Date.now(),
      sources: sourceNames,
      tool: artifact ? "File created" : route?.toolName || (retrieved.length ? "File search" : ""),
      artifact
    };
    chat.messages.push(assistantMessage);
    if (artifact) await putLocalMessageAsset(assistantMessage);
    if (pendingFileIds.length) {
      const analyzedIds = new Set(pendingFileIds);
      for (const message of chat.messages) {
        if (!Array.isArray(message.attachments)) continue;
        message.attachments = message.attachments.map((attachment) =>
          analyzedIds.has(attachment.id)
            ? { ...attachment, status: "Analyzed for this response" }
            : attachment
        );
      }
    }
    chat.pendingFileIds = [];
    chat.updatedAt = Date.now();

    if (artifact) {
      setAgentActivity("Returning file", "File created");
      recordAgentActivity("File created", artifact.name);
    }

    saveState();
    renderMessages();
    renderChats();
    renderHeader();
  } catch (error) {
    console.error(error);

    if (isAbortError(error)) generationWasStopped = true;

    chat.messages.push({
      role: "assistant",
      content: generationWasStopped
        ? "[Generation stopped]"
        : `I could not complete that request. ${error?.message || String(error)}`,
      createdAt: Date.now(),
      tool: route?.toolName || ""
    });
    chat.updatedAt = Date.now();
    saveState();
    renderMessages();
    renderChats();
  } finally {
    isGenerating = false;
    setGeneratingUI(false);
    setAgentIdleSoon();
    messageInput.focus();
  }
}

function buildModelMessages(chat, retrieved, toolContext = "", requestedArtifact = null) {
  const memoryBlock = state.memories.length
    ? `PERSISTENT MEMORY:\n${state.memories.map((item, index) => `${index + 1}. ${item.text}`).join("\n")}`
    : "";

  const localContext = retrieved.length
    ? `LOCAL FILE CONTEXT:\n${retrieved.map((item, index) => `[${index + 1}] Source: ${item.name}\n${item.text}`).join("\n\n")}`
    : "";

  const artifactContext = requestedArtifact
    ? `FILE RETURN REQUEST:\nCreate the complete contents for ${requestedArtifact.name}. Return the finished content only. For code files, use one complete fenced code block in the correct language. For JSON, XML, YAML and CSV, return valid parseable data. Do not describe tool usage or omit required sections.`
    : "";

  const latestUserInput = [...chat.messages].reverse().find((message) => message.role === "user" && message.content)?.content || "";
  const dialogueState = buildDialogueState(chat, latestUserInput);
  const responseContract = buildResponseContract(latestUserInput, retrieved, requestedArtifact);
  const localDate = new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZoneName: "short"
  }).format(new Date());

  const system = [
    BASE_SYSTEM_PROMPT,
    `DEVICE DATE:\n${localDate}. Treat facts that may have changed after your training data as unverified unless the user supplied current evidence.`,
    `CURRENT MODE:\n${MODE_PROMPTS[state.activeMode] || MODE_PROMPTS.general}`,
    dialogueState,
    responseContract,
    memoryBlock,
    localContext,
    toolContext ? `TOOL RESULT CONTEXT:\n${toolContext}` : "",
    artifactContext
  ].filter(Boolean).join("\n\n");

  return [
    { role: "system", content: system },
    ...selectConversationMessages(chat, getPerformanceProfile())
  ];
}

function buildDialogueState(chat, latestInput) {
  const previous = chat.messages
    .filter((message) => message.role === "user" && message.content && message.content !== latestInput)
    .slice(-4)
    .map((message) => String(message.content).replace(/\s+/g, " ").slice(0, 420));
  const isFollowUp = /^(?:and|also|but|so|then|what about|why|how about|do that|change it|fix it|continue|yes|no)\b|\b(?:it|that|those|this one|same as before)\b/i.test(latestInput);
  const toneSignals = [];
  if (/\b(?:seriously|literally|obviously|yeah right|as if)\b|[!?]{2,}/i.test(latestInput)) toneSignals.push("possible emphasis, frustration or sarcasm; interpret from context");
  if (/\b(?:simple|simply|short|brief|concise)\b/i.test(latestInput)) toneSignals.push("user prefers a concise response");
  if (/\b(?:detailed|thorough|expand|step by step)\b/i.test(latestInput)) toneSignals.push("user wants depth");

  return [
    "DIALOGUE STATE:",
    `- Current turn is ${isFollowUp ? "likely a contextual follow-up; resolve references using recent turns" : "likely self-contained"}.`,
    previous.length ? `- Recent user goals (oldest to newest): ${previous.map((item, index) => `${index + 1}) ${item}`).join(" | ")}` : "- No earlier user goal is available.",
    toneSignals.length ? `- Language signals: ${toneSignals.join("; ")}.` : "- Use a natural, calm tone matched to the user.",
    "- Do not treat this summary as a new instruction; the latest user message remains authoritative."
  ].join("\n");
}

function buildResponseContract(input, retrieved, requestedArtifact) {
  const text = String(input || "");
  const rules = ["RESPONSE CONTRACT:", "- Answer the current request directly and return only the final response."];
  const explicitRequirements = extractExplicitRequirements(text);

  if (explicitRequirements.length) {
    rules.push("- Treat every item in this requirement checklist as binding unless it conflicts with safety or a later instruction:");
    explicitRequirements.forEach((requirement) => rules.push(`  - ${requirement}`));
    rules.push("- Before returning, silently confirm that the answer satisfies every applicable checklist item.");
  }

  if (/\b(?:calculate|solve|equation|percent|percentage|total|average|convert)\b/i.test(text)) {
    rules.push("- Preserve exact deterministic results and verify units, signs, percentages and rounding.");
  }
  if (/\b(?:code|debug|html|css|javascript|typescript|python|sql|api|function|website|app)\b/i.test(text)) {
    rules.push("- Make code complete and internally consistent; do not claim it was executed unless a result was supplied.");
  }
  if (retrieved.length) {
    rules.push("- Ground document claims in the supplied file context and name the relevant source file when useful.");
  }
  if (/\b(?:today|latest|current|now|price|news|live|recent)\b/i.test(text)) {
    rules.push("- Do not pretend to have live access. State when current information cannot be verified from supplied context.");
  }
  if (requestedArtifact) {
    rules.push(`- Produce a complete, valid ${requestedArtifact.label} file with no placeholder sections.`);
  }
  if (/\b(?:compare|evaluate|infer|reason|diagnose|why|strategy|evidence|research)\b/i.test(text)) {
    rules.push("- Check at least one plausible alternative explanation and make the conclusion proportional to the evidence.");
  }
  return rules.join("\n");
}

function selectConversationMessages(chat, profile) {
  const selected = [];
  const messages = chat.messages
    .filter((message) => String(message.modelContent || message.content || "").trim())
    .slice(-profile.recentMessages);
  const budget = Math.max(profile.contextChars * 2, 6500);
  let used = 0;

  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    const content = String(message.modelContent || message.content || "");
    if (selected.length && used + content.length > budget) break;
    selected.unshift({ role: message.role, content });
    used += content.length;
  }
  return selected;
}

function shouldReviewAnswer(input) {
  const text = String(input || "");
  if (text.length >= 90) return true;
  if (extractExplicitRequirements(text).length >= 2) return true;
  if (["code", "analyze"].includes(state.activeMode)) return true;
  return /\b(?:compare|evaluate|explain|why|plan|strategy|medical|legal|financial|research|debug|build|analyze)\b/i.test(text);
}

function shouldVerifyAnswer(input, profile) {
  if (!shouldReviewAnswer(input)) return false;
  if (activeInferenceMode === "cloud") return Boolean(profile.verify);
  if (profile.verify) return true;
  if (state.performanceProfile !== "balanced") return false;

  const text = String(input || "");
  const highRiskOrTechnical = ["code", "analyze"].includes(state.activeMode) ||
    /\b(?:medical|legal|financial|security|privacy|research|debug|code|api|sql|calculate)\b/i.test(text);
  const requirementCount = extractExplicitRequirements(text).length;

  if (highRiskOrTechnical || requirementCount >= 2) return true;
  return !getRuntimeCapabilities().isPhone && text.length >= 140;
}

async function reviewAnswer(input, draft, profile) {
  if (!draft.trim()) return draft;
  try {
    const reviewed = await generateOneShotCompletion([
        {
          role: "system",
          content: "You are Picklo's final-answer verifier. Silently inspect the draft for factual overconfidence, contradictions, missed requirements, unsafe advice, calculation errors and incomplete code. Enforce the supplied response contract exactly. Return a corrected final answer only. Preserve correct content and do not mention reviewing, tools, policies or internal reasoning."
        },
        {
          role: "user",
          content: `Original request:\n${input}\n\n${buildResponseContract(input, [], null)}\n\nDraft answer:\n${draft}`
        }
      ], {
      temperature: 0.1,
      topP: 0.8,
      maxTokens: Math.min(profile.maxTokens, 1000),
      purpose: "review"
    });
    const cleaned = cleanAssistantReply(reviewed);
    return cleaned.trim() || draft;
  } catch (error) {
    console.warn("Answer verification skipped:", error);
    return draft;
  }
}

async function repairArtifactIfNeeded(input, request, draft, profile) {
  const extracted = extractArtifactContent(draft, request.extension);
  const validationError = validateArtifactContent(extracted, request.extension);
  if (!validationError) return draft;

  try {
    const repaired = await generateOneShotCompletion([
        {
          role: "system",
          content: `Repair the requested ${request.label}. Return the complete corrected file content only. Do not explain the repair or include placeholders.`
        },
        {
          role: "user",
          content: `Original request:\n${input}\n\nValidation problem:\n${validationError}\n\nDraft file:\n${draft}`
        }
      ], {
      temperature: 0.08,
      topP: 0.8,
      maxTokens: profile.maxTokens,
      purpose: "repair"
    });
    const cleaned = cleanAssistantReply(repaired);
    return cleaned.trim() || draft;
  } catch (error) {
    console.warn("Artifact repair skipped:", error);
    return draft;
  }
}

function validateArtifactContent(content, extension) {
  const text = String(content || "").trim();
  if (!text) return "The generated file is empty.";

  try {
    if (extension === "json") JSON.parse(text);
    if (extension === "html" && !/<(?:!doctype\s+html|html)\b/i.test(text)) return "The HTML document is missing its document root.";
    if (extension === "svg") {
      const documentNode = new DOMParser().parseFromString(text, "image/svg+xml");
      if (documentNode.querySelector("parsererror")) return "The SVG contains invalid XML.";
    }
    if (extension === "xml") {
      const documentNode = new DOMParser().parseFromString(text, "application/xml");
      if (documentNode.querySelector("parsererror")) return "The XML is not well formed.";
    }
    if (["css", "js", "ts", "jsx", "tsx", "java", "c", "cpp", "cs", "php", "go", "rs"].includes(extension)) {
      const opens = (text.match(/{/g) || []).length;
      const closes = (text.match(/}/g) || []).length;
      if (opens !== closes) return "The file has unbalanced braces.";
    }
  } catch (error) {
    return error?.message || "The generated file is not valid.";
  }
  return "";
}

function makeTitle(text) {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= 43 ? clean : `${clean.slice(0, 43).trim()}…`;
}

function parseRememberCommand(text) {
  const match = text.match(/^\s*remember(?:\s+that)?\s+(.+)/is);
  return match?.[1]?.trim() || null;
}

async function stopGeneration() {
  if (!isGenerating) return;
  generationWasStopped = true;
  stopBtn.disabled = true;
  stopBtn.textContent = "Stopping…";
  cloudAbortController?.abort();
  try {
    if (engine && activeInferenceMode === "local") await engine.interruptGenerate();
  } catch (error) {
    console.warn("Picklo generation interruption failed:", error);
  }
}

function setGeneratingUI(generating) {
  messageInput.disabled = generating;
  sendBtn.disabled = generating;
  stopBtn.classList.toggle("hidden", !generating);
  stopBtn.disabled = false;
  stopBtn.textContent = "Stop";
}

function addError(text) {
  const card = document.createElement("div");
  card.className = "error-card";
  card.textContent = text;
  messages.appendChild(card);
  scrollToBottom();
}

function addMemory(text) {
  const cleaned = text.trim();
  if (!cleaned) return;

  if (!state.memories.some((item) => item.text.toLowerCase() === cleaned.toLowerCase())) {
    state.memories.unshift({
      id: crypto.randomUUID ? crypto.randomUUID() : `memory-${Date.now()}`,
      text: cleaned,
      createdAt: Date.now()
    });
  }
  saveState();
  renderStats();
}

function renderMemory() {
  memoryList.innerHTML = "";

  if (!state.memories.length) {
    const empty = document.createElement("div");
    empty.className = "memory-empty";
    empty.textContent = 'No memory saved yet. You can also type "remember that ..." in a chat.';
    memoryList.appendChild(empty);
    return;
  }

  for (const memory of state.memories) {
    const item = document.createElement("div");
    item.className = "memory-item";

    const copy = document.createElement("p");
    copy.textContent = memory.text;

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "memory-delete";
    remove.textContent = "Delete";
    remove.addEventListener("click", () => {
      state.memories = state.memories.filter((entry) => entry.id !== memory.id);
      saveState();
      renderMemory();
      renderStats();
    });

    item.append(copy, remove);
    memoryList.appendChild(item);
  }
}

async function handleFiles(event) {
  if (!(await ensureRegisteredAccount("upload"))) {
    event.target.value = "";
    return;
  }
  const files = [...(event.target.files || [])];
  event.target.value = "";
  if (!files.length) return;

  composerNote.textContent = "Adding files locally…";
  const uploaded = [];

  for (const file of files) {
    try {
      const text = await extractFileText(file);
      const cleaned = text.replace(/\u0000/g, "").trim().slice(0, MAX_FILE_CHARS);
      if (!cleaned) throw new Error("No readable text was found.");

      const document = {
        id: crypto.randomUUID ? crypto.randomUUID() : `file-${Date.now()}-${Math.random()}`,
        name: file.name,
        type: file.type || file.name.split(".").pop() || "text",
        size: file.size,
        text: cleaned,
        blob: file,
        ownerId: currentUser?.id || null,
        createdAt: Date.now()
      };
      await putLocalFile(document);
      uploaded.push({
        id: document.id,
        name: document.name,
        type: document.type,
        size: document.size,
        status: "Uploaded and ready for analysis",
        createdAt: document.createdAt
      });
    } catch (error) {
      alert(`${file.name}: ${error?.message || "Could not read this file."}`);
    }
  }

  localFiles = await listLocalFiles();
  if (uploaded.length) {
    const chat = getActiveChat();
    const attachmentMessage = {
      id: createId(),
      role: "user",
      content: "",
      attachments: uploaded,
      createdAt: Date.now()
    };
    chat.messages.push(attachmentMessage);
    await putLocalMessageAsset(attachmentMessage);
    chat.pendingFileIds = [...new Set([...(chat.pendingFileIds || []), ...uploaded.map((file) => file.id)])];
    chat.mode = "analyze";
    chat.updatedAt = Date.now();
    if (chat.title === "New chat") chat.title = `Analyze ${uploaded[0].name}`.slice(0, 48);
    activeFileSources = uploaded.map((file) => file.name);
    setMode("analyze", false);
    saveState();
    renderMessages();
    renderChats();
    renderHeader();
    renderContext();
  }
  renderFiles();
  renderStats();
  composerNote.textContent = uploaded.length
    ? `${uploaded.length} document${uploaded.length === 1 ? "" : "s"} uploaded and ready for your next question.`
    : "No readable documents were added.";
  setTimeout(() => {
    composerNote.textContent = getDefaultComposerNote();
  }, 2500);
}

async function extractFileText(file) {
  const lower = file.name.toLowerCase();
  if (file.type === "application/pdf" || lower.endsWith(".pdf")) {
    return extractPdfText(file);
  }
  if (lower.endsWith(".docx")) return extractDocxText(file);
  if (lower.endsWith(".doc")) return extractLegacyDocText(file);
  if (lower.endsWith(".rtf")) return extractRtfText(await file.text());
  return file.text();
}

async function extractDocxText(file) {
  if (!window.mammoth) {
    await loadExternalScript("https://cdn.jsdelivr.net/npm/mammoth@1.9.1/mammoth.browser.min.js", "mammoth");
  }
  const result = await window.mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  return result.value || "";
}

async function extractLegacyDocText(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const isBinaryWord = bytes.length >= 8 && [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]
    .every((value, index) => bytes[index] === value);

  if (isBinaryWord) {
    throw new Error("This older binary .doc format cannot be read safely in the browser. Open it in Word and save it as .docx or PDF.");
  }

  const source = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  if (/^\s*{\\rtf/i.test(source)) return extractRtfText(source);
  if (/<(?:html|body|p|div|table)\b/i.test(source)) {
    const parsed = new DOMParser().parseFromString(source, "text/html");
    return parsed.body?.innerText || parsed.body?.textContent || "";
  }
  return source;
}

function extractRtfText(source) {
  return String(source)
    .replace(/\\par[d]?/g, "\n")
    .replace(/\\'[0-9a-f]{2}/gi, " ")
    .replace(/\\[a-z]+-?\d* ?/gi, "")
    .replace(/[{}]/g, "")
    .replace(/\n{3,}/g, "\n\n");
}

function loadExternalScript(src, globalName = "") {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      if (!globalName || window[globalName]) resolve();
      else existing.addEventListener("load", resolve, { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error("The Word document reader could not load."));
    document.head.appendChild(script);
  });
}

async function extractPdfText(file) {
  const pdfjsLib = await import("https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs");
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";

  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const pages = [];
  let totalChars = 0;

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items.map((item) => item.str).join(" ");
    const pageText = `Page ${pageNumber}\n${text}`;
    pages.push(pageText);
    totalChars += pageText.length;
    if (totalChars >= MAX_FILE_CHARS) break;
  }

  return pages.join("\n\n");
}

function openFileDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(FILE_DB, 1);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(FILE_STORE)) {
        db.createObjectStore(FILE_STORE, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function putLocalFile(doc) {
  const db = await openFileDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(FILE_STORE, "readwrite");
    tx.objectStore(FILE_STORE).put(doc);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function listLocalFiles() {
  try {
    if (!isRegisteredUser()) return [];
    const ownerId = currentUser.id;
    const db = await openFileDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(FILE_STORE, "readonly");
      const request = tx.objectStore(FILE_STORE).getAll();
      request.onsuccess = () => resolve(
        (request.result || [])
          .filter((file) => file?.ownerId === ownerId)
          .sort((a, b) => b.createdAt - a.createdAt)
      );
      request.onerror = () => reject(request.error);
    });
  } catch {
    return [];
  }
}

async function deleteLocalFile(id) {
  if (!isRegisteredUser()) return;
  const record = localFiles.find((file) => file?.id === id && file?.ownerId === currentUser.id);
  if (!record) return;
  const db = await openFileDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(FILE_STORE, "readwrite");
    tx.objectStore(FILE_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  window.dispatchEvent(new CustomEvent("picklo:local-file-deleted", {
    detail: { name: record.name, size: record.size, ownerId: currentUser.id }
  }));

  localFiles = await listLocalFiles();
  renderFiles();
  renderStats();
}

function renderFiles() {
  sheetFileList.innerHTML = "";

  if (!localFiles.length) {
    const empty = document.createElement("div");
    empty.className = "file-empty";
    empty.textContent = "No local files yet.";
    sheetFileList.appendChild(empty);
    return;
  }

  for (const file of localFiles) {
    const row = document.createElement("div");
    row.className = "file-item";

    const badge = document.createElement("div");
    badge.className = "file-badge";
    badge.textContent = fileLabel(file.name);

    const copy = document.createElement("div");
    copy.className = "file-copy";
    const strong = document.createElement("strong");
    strong.textContent = file.name;
    const small = document.createElement("small");
    small.textContent = `${Math.round(file.text.length / 1000)}k characters • ${new Date(file.createdAt).toLocaleDateString()}`;
    copy.append(strong, small);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "file-remove";
    remove.textContent = "×";
    remove.title = "Remove file";
    remove.addEventListener("click", () => deleteLocalFile(file.id));

    row.append(badge, copy, remove);
    sheetFileList.appendChild(row);
  }
}

function fileLabel(name) {
  const ext = String(name).split(".").pop()?.toUpperCase() || "TXT";
  return ext.slice(0, 3);
}

function shouldUseLocalFiles(text) {
  if (!localFiles.length) return false;
  if (state.activeMode === "analyze") return true;

  return /\b(file|files|document|documents|pdf|uploaded|upload|attachment|attached|notes?|read this|according to|in my)\b/i.test(text);
}

async function retrieveLocalContext(query, preferredFileIds = []) {
  if (!localFiles.length) return [];

  const tokens = [...expandQueryTokens(query)];
  const preferred = new Set(preferredFileIds || []);
  if (!tokens.length && !preferred.size) return [];

  const allChunks = [];
  for (const file of localFiles) {
    chunkText(file.text).forEach((text, index) => {
      const terms = String(text).toLowerCase().match(/[a-z0-9][a-z0-9_-]{2,}/g) || [];
      allChunks.push({ file, text, index, terms, unique: new Set(terms) });
    });
  }

  const documentFrequency = new Map();
  for (const token of tokens) {
    documentFrequency.set(token, allChunks.reduce((count, chunk) => count + (chunk.unique.has(token) ? 1 : 0), 0));
  }

  const averageLength = allChunks.reduce((sum, chunk) => sum + chunk.terms.length, 0) / Math.max(allChunks.length, 1);
  const queryPhrase = tokens.slice(0, 5).join(" ");

  const scored = [];

  for (const chunk of allChunks) {
    const isPreferred = preferred.has(chunk.file.id);
    const counts = new Map();
    for (const term of chunk.terms) counts.set(term, (counts.get(term) || 0) + 1);
    let score = isPreferred ? 9 - Math.min(chunk.index, 5) : 0;

    for (const token of tokens) {
      const frequency = counts.get(token) || 0;
      const df = documentFrequency.get(token) || 0;
      const idf = Math.log(1 + (allChunks.length - df + 0.5) / (df + 0.5));
      const normalized = frequency
        ? (frequency * 2.2) / (frequency + 1.2 * (0.25 + 0.75 * (chunk.terms.length / Math.max(averageLength, 1))))
        : 0;
      score += idf * normalized * (token.length >= 7 ? 1.35 : 1);
      if (chunk.file.name.toLowerCase().includes(token)) score += 3;
    }

    if (queryPhrase.length >= 7 && chunk.text.toLowerCase().includes(queryPhrase)) score += 7;

    if (score > 0) {
      scored.push({
        id: chunk.file.id,
        name: chunk.file.name,
        text: chunk.text,
        score,
        index: chunk.index
      });
    }
  }

  scored.sort((a, b) => b.score - a.score);

  const chosen = [];
  let chars = 0;

  for (const item of scored) {
    if (chosen.length >= 7) break;
    const contextLimit = Math.min(MAX_CONTEXT_CHARS, getPerformanceProfile().contextChars);
    if (chars + item.text.length > contextLimit && chosen.length) continue;
    chosen.push(item);
    chars += item.text.length;
  }

  return chosen;
}

function expandQueryTokens(text) {
  const tokens = tokenSet(text);
  const groups = [
    ["cost", "price", "pricing", "fee", "budget"],
    ["error", "bug", "issue", "failure", "problem"],
    ["result", "finding", "outcome", "conclusion"],
    ["method", "procedure", "process", "steps"],
    ["risk", "danger", "hazard", "safety"],
    ["benefit", "advantage", "strength", "value"],
    ["limit", "limitation", "weakness", "constraint"],
    ["study", "research", "paper", "article", "evidence"],
    ["author", "expert", "opinion", "view", "perspective"]
  ];
  for (const group of groups) {
    if (group.some((word) => tokens.has(word))) group.forEach((word) => tokens.add(word));
  }
  return tokens;
}

function tokenSet(text) {
  const stop = new Set([
    "the","and","that","this","with","from","what","when","where","which","would",
    "could","should","have","has","had","into","about","your","you","are","was",
    "were","for","but","not","can","how","why","who","their","there","than","then"
  ]);

  return new Set(
    String(text)
      .toLowerCase()
      .match(/[a-z0-9][a-z0-9_-]{2,}/g)
      ?.filter((token) => !stop.has(token)) || []
  );
}

function chunkText(text) {
  const size = 1500;
  const overlap = 220;
  const chunks = [];

  for (let start = 0; start < text.length; start += size - overlap) {
    chunks.push(text.slice(start, start + size));
    if (start + size >= text.length) break;
  }

  return chunks;
}

function renderContext() {
  if (!activeFileSources.length) {
    contextBanner.classList.add("hidden");
    return;
  }

  contextText.textContent = `Using ${activeFileSources.join(", ")}`;
  contextBanner.classList.remove("hidden");
}

function shouldExposeToolActivity(toolName = "", metadata = {}) {
  if (metadata.fileArtifact === true) return true;
  return /^(?:file delivery|file export|file created)$/i.test(String(toolName).trim());
}

function cleanAssistantReply(reply) {
  return String(reply || "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<analysis>[\s\S]*?<\/analysis>/gi, "")
    .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, "")
    .replace(/^\s*\[(?:tool|calculator|code sandbox|internal)\][^\n]*\n?/gim, "")
    .trim();
}

function setAgentActivity(text, toolName = "") {
  if (!shouldExposeToolActivity(toolName)) {
    agentActivityBar.classList.add("hidden");
    agentStatus.textContent = state.autoTools === false ? "Agent off" : "Agent ready";
    return;
  }

  agentActivityText.textContent = text;
  agentActivityBar.classList.remove("hidden");
  agentStatus.textContent = "Returning file";
}

function setAgentIdle() {
  agentActivityBar.classList.add("hidden");
  agentStatus.textContent = state.autoTools === false ? "Agent off" : "Agent ready";
}

function setAgentIdleSoon() {
  setTimeout(setAgentIdle, 650);
}

function recordAgentActivity(tool, detail) {
  if (!shouldExposeToolActivity(tool)) return;

  const entry = {
    id: crypto.randomUUID ? crypto.randomUUID() : `tool-${Date.now()}-${Math.random()}`,
    tool,
    detail,
    createdAt: Date.now()
  };
  state.agentHistory.unshift(entry);
  state.agentHistory = state.agentHistory.slice(0, 20);
  saveState();
  renderAgentHistory();
}

function renderAgentHistory() {
  if (!agentHistoryList) return;

  const enabled = state.autoTools !== false;
  agentCardStatus.textContent = enabled ? "Private processing is on" : "Private processing is off";
  agentStatus.textContent = enabled ? "Agent ready" : "Agent off";

  const visibleHistory = state.agentHistory.filter((entry) => shouldExposeToolActivity(entry.tool));
  const count = visibleHistory.length;
  agentToolCount.textContent = `${count} file${count === 1 ? "" : "s"}`;

  agentHistoryList.innerHTML = "";

  if (!count) {
    const empty = document.createElement("div");
    empty.className = "agent-history-empty";
    empty.textContent = "No files returned yet.";
    agentHistoryList.appendChild(empty);
    return;
  }

  for (const entry of visibleHistory.slice(0, 5)) {
    const row = document.createElement("div");
    row.className = "agent-history-row";

    const text = document.createElement("div");
    const strong = document.createElement("strong");
    strong.textContent = entry.tool;
    const small = document.createElement("small");
    small.textContent = entry.detail || "Completed";
    text.append(strong, small);

    const time = document.createElement("time");
    time.textContent = new Date(entry.createdAt).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit"
    });

    row.append(text, time);
    agentHistoryList.appendChild(row);
  }
}

async function routeAgentTool(content) {
  const intent = classifyAgentIntent(content, { hasFiles: localFiles.length > 0 });
  if (!intent) return null;

  if (intent.type === "picklo_identity" || intent.type === "km_digital_labs") {
    return {
      handled: true,
      tool: "",
      reply: KM_DIGITAL_LABS_REPLY
    };
  }

  if (intent.type === "memory_save") {
    setAgentActivity("Saving memory", "Memory");
    addMemory(intent.value);
    recordAgentActivity("Memory", "Saved a persistent memory");
    return {
      handled: true,
      tool: "Memory",
      reply: `Saved to memory: **${intent.value}**`
    };
  }

  if (intent.type === "note_save") {
    setAgentActivity("Saving quick note", "Notes");
    state.notes.unshift({
      id: crypto.randomUUID ? crypto.randomUUID() : `note-${Date.now()}`,
      text: intent.value,
      createdAt: Date.now()
    });
    saveState();
    renderNotes();
    recordAgentActivity("Notes", "Saved a quick note");
    return {
      handled: true,
      tool: "Notes",
      reply: `Saved as a quick note: **${intent.value}**`
    };
  }

  if (intent.type === "notes_list") {
    setAgentActivity("Reading local notes", "Notes");
    recordAgentActivity("Notes", `Read ${state.notes.length} note${state.notes.length === 1 ? "" : "s"}`);

    if (!state.notes.length) {
      return {
        handled: true,
        tool: "Notes",
        reply: "You do not have any quick notes saved yet."
      };
    }

    return {
      handled: true,
      tool: "Notes",
      reply: state.notes
        .slice(0, 12)
        .map((note, index) => `${index + 1}. ${note.text}`)
        .join("\n")
    };
  }

  if (intent.type === "time") {
    setAgentActivity("Reading device time", "Local time");
    const now = new Date();
    const reply = now.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
    recordAgentActivity("Local time", reply);
    return {
      handled: true,
      tool: "Local time",
      reply: `Your device time is **${reply}**.`
    };
  }

  if (intent.type === "date") {
    setAgentActivity("Reading device date", "Local date");
    const now = new Date();
    const reply = now.toLocaleDateString([], {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric"
    });
    recordAgentActivity("Local date", reply);
    return {
      handled: true,
      tool: "Local date",
      reply: `Your device date is **${reply}**.`
    };
  }

  if (intent.type === "calculator") {
    setAgentActivity("Calculating", "Calculator");

    try {
      const value = evaluateMathExpression(intent.expression);
      const formatted = Number.isFinite(value)
        ? String(Number(value.toPrecision(12)))
        : String(value);

      recordAgentActivity("Calculator", `${intent.expression} = ${formatted}`);

      if (intent.explain) {
        return {
          handled: true,
          tool: "Calculator",
          reply: `**${formatted}**\n\nCalculation: \`${intent.expression}\``
        };
      }

      return {
        handled: true,
        tool: "Calculator",
        reply: `**${intent.expression} = ${formatted}**`
      };
    } catch (error) {
      recordAgentActivity("Calculator", "Expression could not be evaluated");
      return {
        handled: true,
        tool: "Calculator",
        reply: `I could not calculate that expression: ${error?.message || "invalid expression"}.`
      };
    }
  }

  if (intent.type === "file_search") {
    setAgentActivity("Preparing local file search", "File search");

    if (!localFiles.length) {
      recordAgentActivity("File search", "No local files available");
      return {
        handled: true,
        tool: "File search",
        reply: "There are no local files in Picklo yet. Attach a PDF, text file, or code file first."
      };
    }

    return {
      handled: false,
      forceFiles: true,
      query: intent.query || content,
      toolName: "File search"
    };
  }

  if (intent.type === "code_prepare") {
    setAgentActivity("Preparing JavaScript sandbox", "Code sandbox");
    codeRunnerInput.value = intent.code;
    recordAgentActivity("Code sandbox", "Loaded JavaScript for manual execution");

    return {
      handled: true,
      tool: "Code sandbox",
      reply: "The JavaScript is ready in **Tools → Code**. Open it when you want to review and run it."
    };
  }

  return null;
}

function switchToolTab(tab) {
  document.querySelectorAll("[data-tool-tab]").forEach((button) => button.classList.toggle("active", button.dataset.toolTab === tab));
  document.querySelectorAll("[data-tool-panel]").forEach((panel) => panel.classList.toggle("hidden", panel.dataset.toolPanel !== tab));
}

function runCalculator() {
  const expression = calculatorInput.value.trim();
  const output = calculatorResult.querySelector("strong");
  if (!expression) { output.textContent = "Enter an expression"; return; }
  try { const value = evaluateMathExpression(expression); output.textContent = Number.isFinite(value) ? String(Number(value.toPrecision(12))) : String(value); }
  catch (error) { output.textContent = error?.message || "Invalid expression"; }
}

function evaluateMathExpression(source) {
  const tokens = tokenizeMath(source); let i = 0;
  const peek = () => tokens[i];
  const take = (v) => { if (v !== undefined && peek()?.value !== v) throw new Error(`Expected "${v}"`); return tokens[i++]; };
  const expr = () => { let v = term(); while (peek() && ["+","-"].includes(peek().value)) { const op=take().value, r=term(); v=op==="+"?v+r:v-r; } return v; };
  const term = () => { let v = power(); while (peek() && ["*","/","%"].includes(peek().value)) { const op=take().value, r=power(); if(op==="*")v*=r; if(op==="/")v/=r; if(op==="%")v%=r; } return v; };
  const power = () => { let v=unary(); if(peek()?.value==="^"){take("^"); v=Math.pow(v,power());} return v; };
  const unary = () => { if(peek()?.value==="+"){take("+");return unary();} if(peek()?.value==="-"){take("-");return -unary();} return primary(); };
  const primary = () => { const t=peek(); if(!t)throw new Error("Unexpected end of expression"); if(t.type==="number"){take();return Number(t.value);} if(t.type==="name"){const n=take().value.toLowerCase(); if(n==="pi")return Math.PI;if(n==="e")return Math.E;take("(");const x=expr();take(")");const f={sqrt:Math.sqrt,abs:Math.abs,sin:Math.sin,cos:Math.cos,tan:Math.tan,log:Math.log10,ln:Math.log,exp:Math.exp};if(!f[n])throw new Error(`Unknown function: ${n}`);return f[n](x);} if(t.value==="("){take("(");const v=expr();take(")");return v;} throw new Error(`Unexpected token: ${t.value}`); };
  const result=expr(); if(i<tokens.length)throw new Error(`Unexpected token: ${tokens[i].value}`); return result;
}

function tokenizeMath(source) {
  const out=[]; let i=0; while(i<source.length){const ch=source[i]; if(/\s/.test(ch)){i++;continue;} if(/[0-9.]/.test(ch)){const m=source.slice(i).match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i); if(!m)throw new Error("Invalid number");out.push({type:"number",value:m[0]});i+=m[0].length;continue;} if(/[a-z]/i.test(ch)){const m=source.slice(i).match(/^[a-z]+/i);out.push({type:"name",value:m[0]});i+=m[0].length;continue;} if("+-*/%^()".includes(ch)){out.push({type:"symbol",value:ch});i++;continue;} throw new Error(`Unsupported character: ${ch}`);} return out;
}

function runSandboxedCode() {
  const code=codeRunnerInput.value; codeOutput.textContent="Running…";
  const iframe=document.createElement("iframe"); iframe.setAttribute("sandbox","allow-scripts"); iframe.style.display="none";
  const runId=`picklo-${Date.now()}-${Math.random()}`;
  const handler=(event)=>{const data=event.data;if(!data||data.runId!==runId)return;window.removeEventListener("message",handler);iframe.remove();const lines=[...(data.logs||[])];if(data.error)lines.push(`Error: ${data.error}`);if(data.hasResult)lines.push(`Result: ${data.result}`);codeOutput.textContent=lines.length?lines.join("\n"):"Finished with no output.";};
  window.addEventListener("message",handler);
  iframe.srcdoc=`<!doctype html><script>const runId=${JSON.stringify(runId)},logs=[];const s=v=>{try{return typeof v==='string'?v:JSON.stringify(v)}catch{return String(v)}};console.log=(...a)=>logs.push(a.map(s).join(' '));console.warn=(...a)=>logs.push('Warning: '+a.map(s).join(' '));console.error=(...a)=>logs.push('Error: '+a.map(s).join(' '));try{const fn=new Function(${JSON.stringify(code)});const result=fn();parent.postMessage({runId,logs,hasResult:result!==undefined,result:s(result)},'*')}catch(e){parent.postMessage({runId,logs,error:e?.message||String(e)},'*')}<\/script>`;
  document.body.appendChild(iframe);
  setTimeout(()=>{if(document.body.contains(iframe)){window.removeEventListener("message",handler);iframe.remove();codeOutput.textContent="Execution timed out after 3 seconds.";}},3000);
}

function saveQuickNote() { const text=noteInput.value.trim(); if(!text)return; state.notes.unshift({id:crypto.randomUUID?crypto.randomUUID():`note-${Date.now()}`,text,createdAt:Date.now()});noteInput.value="";saveState();renderNotes(); }
function renderNotes() { notesList.innerHTML=""; if(!state.notes.length){const e=document.createElement("div");e.className="memory-empty";e.textContent="No quick notes yet.";notesList.appendChild(e);return;} for(const note of state.notes){const item=document.createElement("div");item.className="note-item";const p=document.createElement("p");p.textContent=note.text;const b=document.createElement("button");b.type="button";b.textContent="Delete";b.addEventListener("click",()=>{state.notes=state.notes.filter(n=>n.id!==note.id);saveState();renderNotes();});item.append(p,b);notesList.appendChild(item);} }
function showLocalTime() { const now=new Date();localToolOutput.textContent=`${now.toLocaleDateString([], {weekday:"long",year:"numeric",month:"long",day:"numeric"})} • ${now.toLocaleTimeString([], {hour:"2-digit",minute:"2-digit",second:"2-digit"})}`; }
function useFileSearchTool() { closeSheets(); if(!localFiles.length){messageInput.value="I want to search my local files, but I have not added any yet.";} else {setMode("analyze",true);messageInput.value="Search my local files for: ";} autoResize();messageInput.focus(); }

async function regenerateLastAssistant() {
  if(!currentUser||isGenerating)return;const chat=getActiveChat();let index=-1;for(let i=chat.messages.length-1;i>=0;i--){if(chat.messages[i].role==="assistant"){index=i;break;}}if(index<0)return;let user=null;for(let i=index-1;i>=0;i--){if(chat.messages[i].role==="user"){user=chat.messages[i];break;}}if(!user)return;chat.messages=chat.messages.slice(0,index);if(chat.messages.at(-1)?.role==="user")chat.messages.pop();saveState();renderMessages();messageInput.value=user.content;autoResize();await sendMessage();
}

async function exportData() {
  const docs = await listLocalFiles();
  const payload = {
    app: "Picklo",
    version: APP_VERSION,
    exportedAt: new Date().toISOString(),
    state,
    files: docs
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `picklo-v8.2.2-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function importData(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;

  try {
    const parsed = JSON.parse(await file.text());
    const importedState = parsed.state || parsed;

    if (!Array.isArray(importedState.chats) || !Array.isArray(importedState.memories)) {
      throw new Error("This is not a valid Picklo V7 backup.");
    }

    if (!confirm("Replace this browser's current Picklo data with the imported backup?")) return;

    state = normalizeState(importedState);
    ensureActiveChat();
    saveState();

    if (Array.isArray(parsed.files)) {
      for (const doc of parsed.files) {
        if (doc?.id && typeof doc.text === "string") await putLocalFile(doc);
      }
    }

    localFiles = await listLocalFiles();
    if (activeInferenceMode === "local") populateModels();
    else setCloudRuntimeReady();
    setMode(state.activeMode || state.defaultMode || "general", false);
    renderAll();
    closeSheets();
  } catch (error) {
    alert(error?.message || "Could not import this Picklo backup.");
  }
}

function openSheet(sheet) {
  [settingsSheet, memorySheet, filesSheet, toolsSheet, dataSheet, conversationsSheet, modeSheet]
    .forEach((item) => item.classList.add("hidden"));

  sheet.classList.remove("hidden");
  backdrop.classList.remove("hidden");
}

function closeSheets() {
  [settingsSheet, memorySheet, filesSheet, toolsSheet, dataSheet, conversationsSheet, modeSheet]
    .forEach((item) => item.classList.add("hidden"));
  backdrop.classList.add("hidden");
}

function autoResize() {
  messageInput.style.height = "auto";
  messageInput.style.height = `${Math.min(messageInput.scrollHeight, 135)}px`;
}

function scrollToBottom(smooth = true) {
  requestAnimationFrame(() => {
    messages.scrollTo({
      top: messages.scrollHeight,
      behavior: smooth ? "smooth" : "auto"
    });
  });
}

function renderMarkdownInto(container, markdown) {
  container.innerHTML = "";
  const source = String(markdown || "");
  const plainLanguage = detectPlainCodeLanguage(source);
  if (!source.includes("```") && plainLanguage) {
    appendCodeBlock(container, plainLanguage, source);
    return;
  }

  const fence = /```([^\n`]*)\n?([\s\S]*?)```/g;
  let index = 0;
  let match;

  while ((match = fence.exec(source)) !== null) {
    renderTextMarkdown(container, source.slice(index, match.index));
    appendCodeBlock(container, (match[1] || "code").trim() || "code", match[2].replace(/\n$/, ""));
    index = fence.lastIndex;
  }

  renderTextMarkdown(container, source.slice(index));
}

function appendCodeBlock(container, languageName, value) {
  const block = document.createElement("div");
  block.className = "code-block";

  const head = document.createElement("div");
  head.className = "code-head";
  const language = document.createElement("span");
  language.textContent = languageName || "code";
  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "copy-code";
  copy.textContent = "Copy";

  const pre = document.createElement("pre");
  const code = document.createElement("code");
  code.textContent = String(value || "");
  pre.appendChild(code);
  head.append(language, copy);
  block.append(head, pre);
  container.appendChild(block);
}

function detectPlainCodeLanguage(source) {
  const text = String(source || "").trim();
  if (text.length < 40 || !text.includes("\n")) return "";
  if (/<!doctype\s+html|<html\b|<body\b|<style\b|<script\b/i.test(text)) return "html";
  const tagCount = (text.match(/<\/?[a-z][^>]*>/gi) || []).length;
  if (tagCount >= 4) return "html";
  const cssSignals = (text.match(/[.#]?[a-z][\w-]*(?:\s+[.#]?[\w-]+)*\s*\{|[\w-]+\s*:\s*[^;{}]+;/gi) || []).length;
  if (cssSignals >= 5) return "css";
  if (/\b(?:const|let|var)\s+[A-Za-z_$]|\bfunction\s+[A-Za-z_$]|=>\s*\{/m.test(text) && (text.match(/[{};]/g) || []).length >= 6) return "javascript";
  if (/^(?:from\s+\S+\s+import|import\s+\S+|def\s+\w+\s*\(|class\s+\w+\s*:)/m.test(text)) return "python";
  if (/^(?:SELECT|INSERT|UPDATE|DELETE|CREATE\s+TABLE|ALTER\s+TABLE)\b/im.test(text)) return "sql";
  return "";
}

function renderTextMarkdown(container, text) {
  if (!text) return;

  const lines = text.replace(/\r/g, "").split("\n");
  let paragraph = [];
  let list = null;
  let listType = null;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    const p = document.createElement("p");
    appendInline(p, paragraph.join(" "));
    container.appendChild(p);
    paragraph = [];
  };

  const resetList = () => {
    list = null;
    listType = null;
  };

  for (const raw of lines) {
    const trimmed = raw.trim();

    if (!trimmed) {
      flushParagraph();
      resetList();
      continue;
    }

    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      resetList();
      const h = document.createElement(`h${Math.min(3, heading[1].length)}`);
      appendInline(h, heading[2]);
      container.appendChild(h);
      continue;
    }

    const unordered = trimmed.match(/^[-*]\s+(.+)$/);
    const ordered = trimmed.match(/^\d+\.\s+(.+)$/);

    if (unordered || ordered) {
      flushParagraph();
      const wanted = ordered ? "ol" : "ul";

      if (!list || listType !== wanted) {
        resetList();
        list = document.createElement(wanted);
        listType = wanted;
        container.appendChild(list);
      }

      const li = document.createElement("li");
      appendInline(li, (unordered || ordered)[1]);
      list.appendChild(li);
      continue;
    }

    resetList();
    paragraph.push(trimmed);
  }

  flushParagraph();
}

function appendInline(parent, text) {
  const source = String(text || "");
  const regex = /(\[([^\]]+)\]\s*\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)|https?:\/\/[^\s<]+|www\.[^\s<]+|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*)/gi;
  let index = 0;
  let match;

  while ((match = regex.exec(source)) !== null) {
    if (match.index > index) parent.appendChild(document.createTextNode(source.slice(index, match.index)));

    const token = match[0];
    const markdownLabel = match[2];
    const markdownHref = match[3];

    if (markdownHref || /^https?:\/\//i.test(token) || /^www\./i.test(token) || /^[\w.%+-]+@[\w.-]+\.[a-z]{2,}$/i.test(token)) {
      const link = document.createElement("a");
      link.className = "picklo-link";
      let href = markdownHref || token;
      let label = markdownLabel || token;
      let trailing = "";

      if (!markdownHref && !/^[\w.%+-]+@[\w.-]+\.[a-z]{2,}$/i.test(token)) {
        const cleaned = token.replace(/[.,!?;:]+$/, "");
        trailing = token.slice(cleaned.length);
        href = cleaned.startsWith("www.") ? `https://${cleaned}` : cleaned;
        label = cleaned;
      } else if (!markdownHref && /^[\w.%+-]+@[\w.-]+\.[a-z]{2,}$/i.test(token)) {
        href = `mailto:${token}`;
      }

      if (/^(?:https?:|mailto:)/i.test(href)) {
        link.href = href;
        link.textContent = label;
        if (/^https?:/i.test(href)) {
          link.target = "_blank";
          link.rel = "noopener noreferrer";
        }
        parent.appendChild(link);
        if (trailing) parent.appendChild(document.createTextNode(trailing));
      } else {
        parent.appendChild(document.createTextNode(token));
      }
    } else if (token.startsWith("`")) {
      const code = document.createElement("code");
      code.textContent = token.slice(1, -1);
      parent.appendChild(code);
    } else if (token.startsWith("**") || token.startsWith("__")) {
      const strong = document.createElement("strong");
      strong.textContent = token.slice(2, -2);
      parent.appendChild(strong);
    } else {
      const em = document.createElement("em");
      em.textContent = token.slice(1, -1);
      parent.appendChild(em);
    }

    index = regex.lastIndex;
  }

  if (index < source.length) parent.appendChild(document.createTextNode(source.slice(index)));
}

