import * as webllm from "https://esm.run/@mlc-ai/web-llm";
import { classifyAgentIntent } from "./agent-router.js";

const APP_VERSION = "7.0.0";
const STORAGE_KEY = "picklo-v7-state";
const V61_STORAGE_KEY = "picklo-v6.1-state";
const FILE_DB = "picklo-v3-files";
const FILE_STORE = "documents";
const MAX_FILE_CHARS = 240000;
const MAX_CONTEXT_CHARS = 7000;

const PREFERRED_MODELS = [
  { id: "SmolLM2-360M-Instruct-q4f16_1-MLC", label: "SmolLM2 360M", note: "Instant" },
  { id: "Llama-3.2-1B-Instruct-q4f16_1-MLC", label: "Llama 3.2 1B", note: "Fast" },
  { id: "SmolLM2-1.7B-Instruct-q4f16_1-MLC", label: "SmolLM2 1.7B", note: "Balanced" },
  { id: "Llama-3.2-3B-Instruct-q4f16_1-MLC", label: "Llama 3.2 3B", note: "Quality" }
];

const PERFORMANCE_PROFILES = {
  fast: {
    label: "Fast",
    preferredModel: "SmolLM2-360M-Instruct-q4f16_1-MLC",
    recentMessages: 8,
    contextChars: 2400,
    maxTokens: 320,
    temperature: 0.65
  },
  balanced: {
    label: "Balanced",
    preferredModel: "Llama-3.2-1B-Instruct-q4f16_1-MLC",
    recentMessages: 14,
    contextChars: 4500,
    maxTokens: 600,
    temperature: 0.7
  },
  quality: {
    label: "Quality",
    preferredModel: "SmolLM2-1.7B-Instruct-q4f16_1-MLC",
    recentMessages: 20,
    contextChars: 7000,
    maxTokens: 900,
    temperature: 0.72
  }
};

const MODE_PROMPTS = {
  general: "Be a strong general-purpose assistant. Adapt to the user's task rather than forcing a particular format.",
  write: "Prioritize writing quality, structure, audience, tone, clarity and useful revision. Produce finished writing when the user asks for it.",
  code: "Prioritize correct software reasoning. Explain tradeoffs, provide complete code when appropriate, and avoid inventing APIs or behavior.",
  analyze: "Prioritize evidence, structure, comparisons, assumptions and careful reasoning. Use supplied file context when relevant."
};

const BASE_SYSTEM_PROMPT = `
You are Picklo V7, a general-purpose personal AI assistant that runs locally in the user's browser.
You are useful for questions, writing, coding, planning, brainstorming, explanations, decision support and document analysis.
Do not claim to be ChatGPT or OpenAI. When asked who you are, say you are Picklo.

GENERAL RULES:
1. Answer the user's actual request directly.
2. Be precise and useful. State uncertainty instead of inventing facts.
3. Use Markdown where it improves readability.
4. For calculations and technical reasoning, show important steps and units when relevant.
5. For code, prefer complete working examples and explain non-obvious decisions.
6. When LOCAL FILE CONTEXT is supplied, treat it as user-provided reference material. Do not claim a file says something it does not say.
7. When the local context is insufficient, say so.
8. Persistent memory is user-provided context. Use it only when relevant.
9. The Picklo application may execute safe local tools before you answer. When TOOL RESULT CONTEXT is provided, use that result as trusted application context and do not pretend you computed or retrieved it yourself.
`.trim();

const defaultState = () => ({
  version: APP_VERSION,
  activeChatId: null,
  selectedModel: "Llama-3.2-1B-Instruct-q4f16_1-MLC",
  activeMode: "general",
  defaultMode: "general",
  theme: "light",
  performanceProfile: "fast",
  autoTools: true,
  agentHistory: [],
  notes: [],
  memories: [],
  chats: []
});

let state = loadState();
let engine = null;
let loadedModelId = null;
let isGenerating = false;
let generationWasStopped = false;
let localFiles = [];
let activeFileSources = [];
let modelLoadPromise = null;
let lastGenerationStats = null;

const $ = (id) => document.getElementById(id);

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
const quickActions = $("quickActions");
const fileInput = $("fileInput");
const fileCount = $("fileCount");
const panelFileCount = $("panelFileCount");
const panelMemoryCount = $("panelMemoryCount");
const memoryCount = $("memoryCount");
const panelModelName = $("panelModelName");
const activeModeLabel = $("activeModeLabel");
const modeButton = $("modeButton");

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
const autoToolsSelect = $("autoToolsSelect");
const agentStatus = $("agentStatus");
const agentActivityBar = $("agentActivityBar");
const agentActivityText = $("agentActivityText");
const agentCardStatus = $("agentCardStatus");
const agentToolCount = $("agentToolCount");
const agentHistoryList = $("agentHistoryList");

const toolsBtn = $("toolsBtn");
const composerToolsBtn = $("composerToolsBtn");
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
  populateModels();
  applyPerformanceProfile(state.performanceProfile || "fast", false, false);
  ensureActiveChat();
  localFiles = await listLocalFiles();
  bindEvents();

  defaultModeSelect.value = state.defaultMode || "general";
  themeSelect.value = state.theme || "light";
  performanceSelect.value = state.performanceProfile || "fast";
  autoToolsSelect.value = state.autoTools === false ? "off" : "on";
  renderAgentHistory();

  // V7 allows typing immediately. Safe local tools can answer while the model starts.
  messageInput.disabled = false;
  sendBtn.disabled = false;
  messageInput.placeholder = "Message Picklo…";

  setMode(state.activeMode || state.defaultMode || "general", false);
  renderAll();

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    });
  }

  // Show the interface first, then start the fastest local model automatically.
  const begin = () => autoStartModel().catch((error) => console.warn("Auto-start failed:", error));
  if ("requestIdleCallback" in window) {
    requestIdleCallback(begin, { timeout: 350 });
  } else {
    setTimeout(begin, 120);
  }
}

function bindEvents() {
  newChatBtn.addEventListener("click", createNewChat);
  headerNewChatBtn.addEventListener("click", createNewChat);
  chatSearchInput.addEventListener("input", renderChats);

  mobileNewChatBtn.addEventListener("click", () => {
    createNewChat();
    closeSheets();
  });

  clearChatsBtn.addEventListener("click", () => {
    if (!confirm("Delete every saved Picklo conversation from this browser?")) return;
    state.chats = [];
    state.activeChatId = null;
    ensureActiveChat();
    saveState();
    renderAll();
  });

  settingsBtn.addEventListener("click", () => openSheet(settingsSheet));
  panelModelBtn.addEventListener("click", () => openSheet(settingsSheet));
  startButton.addEventListener("click", () => openSheet(settingsSheet));

  toolsBtn.addEventListener("click", () => { renderNotes(); renderAgentHistory(); openSheet(toolsSheet); });
  composerToolsBtn.addEventListener("click", () => { renderNotes(); renderAgentHistory(); openSheet(toolsSheet); });
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
  modeButton.addEventListener("click", () => openSheet(modeSheet));

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
    applyPerformanceProfile(performanceSelect.value, true, true);
    await loadSelectedModel({ automatic: true });
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

  quickActions.addEventListener("click", (event) => {
    const button = event.target.closest("[data-followup]");
    if (!button || !engine || isGenerating) return;
    messageInput.value = button.dataset.followup || "";
    autoResize();
    messageInput.focus();
  });

  stopBtn.addEventListener("click", stopGeneration);

  messages.addEventListener("click", (event) => {
    const prompt = event.target.closest("[data-prompt]");
    if (prompt) {
      if (!engine) {
        openSheet(settingsSheet);
        return;
      }
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

  fileInput.addEventListener("change", handleFiles);
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
      if (!migrated.performanceProfile) migrated.performanceProfile = "fast";
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
  return {
    ...defaultState(),
    ...parsed,
    performanceProfile: PERFORMANCE_PROFILES[parsed?.performanceProfile] ? parsed.performanceProfile : "fast",
    autoTools: typeof parsed?.autoTools === "boolean" ? parsed.autoTools : true,
    agentHistory: Array.isArray(parsed?.agentHistory) ? parsed.agentHistory.slice(0, 20) : [],
    notes: Array.isArray(parsed?.notes) ? parsed.notes : [],
    memories: Array.isArray(parsed?.memories) ? parsed.memories : [],
    chats: Array.isArray(parsed?.chats) ? parsed.chats : []
  };
}

function saveState() {
  try {
    state.version = APP_VERSION;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.warn("Picklo state save failed:", error);
  }
}

function makeChat() {
  return {
    id: crypto.randomUUID ? crypto.randomUUID() : `chat-${Date.now()}-${Math.random()}`,
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
  if (engine) messageInput.focus();
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

function deleteChat(id) {
  if (isGenerating) return;
  state.chats = state.chats.filter((chat) => chat.id !== id);
  if (state.activeChatId === id) state.activeChatId = state.chats[0]?.id || null;
  ensureActiveChat();
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

  const label = mode.charAt(0).toUpperCase() + mode.slice(1);
  activeModeLabel.textContent = label;
  assistantSubtitle.textContent = {
    general: "Your general-purpose personal AI",
    write: "Writing, drafting and refinement",
    code: "Building, debugging and software reasoning",
    analyze: "Documents, comparisons and structured reasoning"
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
  const chat = getActiveChat();
  headerChatTitle.textContent = chat.title || "New chat";
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
      deleteChat(chat.id);
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

  if (!chat.messages.length) {
    messages.innerHTML = `
      <div class="welcome">
        <img class="welcome-mark" src="assets/picklo-mark.svg" alt="" />
        <h2>How can I help?</h2>
        <p>Talk to Picklo naturally. Ask a question, work through an idea, write something, code, or attach a file.</p>

        <div class="starter-grid">
          <button data-mode="general" data-prompt="Help me think through something. Ask only the questions you genuinely need." type="button">
            <span class="starter-icon ask-icon">A</span>
            <span class="starter-copy"><strong>Think with me</strong><span>Questions, ideas and decisions</span></span>
          </button>
          <button data-mode="write" data-prompt="Help me write something. Focus on the audience, purpose and strongest structure." type="button">
            <span class="starter-icon write-icon">W</span>
            <span class="starter-copy"><strong>Write something</strong><span>Draft, rewrite and improve</span></span>
          </button>
          <button data-mode="code" data-prompt="Help me build or debug some code. Prioritize a working solution and explain the important choices." type="button">
            <span class="starter-icon code-icon">C</span>
            <span class="starter-copy"><strong>Code together</strong><span>Build, debug and explain</span></span>
          </button>
          <button data-mode="analyze" data-prompt="I want to analyze a document or problem carefully. Help me separate evidence, assumptions and conclusions." type="button">
            <span class="starter-icon analyze-icon">F</span>
            <span class="starter-copy"><strong>Analyze something</strong><span>Files, evidence and reasoning</span></span>
          </button>
        </div>
      </div>`;
    return;
  }

  for (const message of chat.messages) {
    appendMessageToDOM(message.role, message.content, {
      time: message.createdAt,
      sources: message.sources || [],
      tool: message.tool || "",
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
  else bubble.textContent = content;

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

  if (options.tool) {
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
  if (role === "assistant") {
    const regenerateAction = document.createElement("button");
    regenerateAction.type = "button";
    regenerateAction.className = "message-action";
    regenerateAction.textContent = "Regenerate";
    regenerateAction.addEventListener("click", regenerateLastAssistant);
    actions.appendChild(regenerateAction);
  }
  wrap.appendChild(actions);
  row.appendChild(wrap);
  messages.appendChild(row);

  if (options.scroll !== false) scrollToBottom();
  return bubble;
}

function formatTime(value) {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function renderStats() {
  memoryCount.textContent = `${state.memories.length} saved`;
  panelMemoryCount.textContent = `${state.memories.length} saved`;

  const fileLabel = `${localFiles.length} ${localFiles.length === 1 ? "local file" : "local files"}`;
  fileCount.textContent = fileLabel;
  panelFileCount.textContent = `${localFiles.length} available`;
}

function getPerformanceProfile() {
  return PERFORMANCE_PROFILES[state.performanceProfile] || PERFORMANCE_PROFILES.fast;
}

function applyPerformanceProfile(profileName, persist = true, updateModel = true) {
  const normalized = PERFORMANCE_PROFILES[profileName] ? profileName : "fast";
  const profile = PERFORMANCE_PROFILES[normalized];

  state.performanceProfile = normalized;
  performanceStatus.textContent = profile.label;

  if (performanceSelect) performanceSelect.value = normalized;

  if (updateModel) {
    const available = [...modelSelect.options].some((option) => option.value === profile.preferredModel);
    if (available) {
      state.selectedModel = profile.preferredModel;
      modelSelect.value = profile.preferredModel;
    }
  }

  if (persist) saveState();
}

async function autoStartModel() {
  if (engine) return engine;
  if (modelLoadPromise) return modelLoadPromise;

  if (!("gpu" in navigator)) {
    setRuntime("WebGPU unavailable", "Use a WebGPU-capable browser", "error");
    return;
  }

  const profile = getPerformanceProfile();
  const preferredAvailable = [...modelSelect.options].some(
    (option) => option.value === profile.preferredModel
  );

  if (preferredAvailable) {
    state.selectedModel = profile.preferredModel;
    modelSelect.value = profile.preferredModel;
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

async function loadSelectedModel(options = {}) {
  const { automatic = false } = options;
  const selected = modelSelect.value || state.selectedModel;

  if (!selected || isGenerating) return;
  if (loadedModelId === selected && engine) return;
  if (modelLoadPromise) return modelLoadPromise;

  if (!("gpu" in navigator)) {
    setRuntime("WebGPU unavailable", "Use a WebGPU-capable browser", "error");
    if (!automatic) {
      closeSheets();
      addError("WebGPU is unavailable in this browser. Picklo V6.1 needs a WebGPU-capable browser for local inference.");
    }
    return;
  }

  loadModelBtn.disabled = true;
  progressWrap.classList.remove("hidden");
  progressBar.style.width = "0%";
  progressPercent.textContent = "0%";

  const profile = getPerformanceProfile();
  setRuntime(
    automatic ? "Starting automatically" : "Starting Picklo",
    `${friendlyModelName(selected)} • ${profile.label}`,
    "loading"
  );

  loadModelBtn.textContent = loadedModelId ? "Switching…" : "Loading…";
  messageInput.placeholder = "Picklo is starting in the background…";

  const onProgress = (report) => {
    const text = report?.text || "Preparing Picklo…";
    const percent = typeof report?.progress === "number"
      ? Math.round(report.progress * 100)
      : extractPercent(text) ?? 0;

    progressText.textContent = automatic ? `Starting automatically • ${text}` : text;
    progressPercent.textContent = `${percent}%`;
    progressBar.style.width = `${percent}%`;
  };

  modelLoadPromise = (async () => {
    try {
      if (!engine) {
        const worker = new Worker("./webllm-worker.js", { type: "module" });
        engine = await webllm.CreateWebWorkerMLCEngine(
          worker,
          selected,
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
        await engine.reload(selected);
      }

      loadedModelId = selected;
      state.selectedModel = selected;
      saveState();

      progressBar.style.width = "100%";
      progressPercent.textContent = "100%";
      progressText.textContent = "Picklo is ready";

      setRuntime("Picklo is ready", `${friendlyModelName(selected)} • ${profile.label}`, "ready");

      messageInput.disabled = false;
      sendBtn.disabled = false;
      messageInput.placeholder = "Message Picklo…";
      loadModelBtn.textContent = "Model ready";

      setTimeout(() => progressWrap.classList.add("hidden"), 700);
      if (!automatic) setTimeout(closeSheets, 160);
      messageInput.focus();
    } catch (error) {
      console.error(error);
      engine = null;
      loadedModelId = null;

      setRuntime("Picklo could not start", "Try Fast mode or another model", "error");
      loadModelBtn.textContent = "Try again";
      messageInput.placeholder = "Picklo could not start";

      if (!automatic) {
        addError(`The selected model could not start. ${error?.message || String(error)}`);
      }
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
    const modelName = friendlyModelName(loadedModelId || state.selectedModel);
    modelStatus.textContent = `${modelName} • Local`;
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
    const shouldRetrieve = forceFiles || shouldUseLocalFiles(content);

    let retrieved = [];
    if (shouldRetrieve) {
      setAgentActivity("Searching local files", "File search");
      retrieved = await retrieveLocalContext(route?.query || content);
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

    if (!engine) {
      setAgentActivity("Waiting for the local model to finish starting", "Model");
      try {
        await autoStartModel();
      } catch (error) {
        console.warn("Model startup while sending failed:", error);
      }
    }

    if (!engine) {
      chat.messages.push({
        role: "assistant",
        content: "I could not start the local language model on this device. My built-in local tools still work, but normal AI replies need a WebGPU-compatible model to finish loading.",
        createdAt: Date.now(),
        tool: "Runtime"
      });
      chat.updatedAt = Date.now();
      saveState();
      renderMessages();
      renderChats();
      setAgentIdleSoon();
      return;
    }

    setAgentActivity(
      route?.toolName ? `Using ${route.toolName} and answering` : "Thinking",
      route?.toolName || "Model"
    );

    const assistantBubble = appendMessageToDOM("assistant", "", {
      time: Date.now(),
      tool: route?.toolName || (retrieved.length ? "File search" : "")
    });
    assistantBubble.classList.add("typing");
    assistantBubble.textContent = "";

    let fullReply = "";
    let completionTokens = 0;
    const generationStartedAt = performance.now();
    const profile = getPerformanceProfile();

    const stream = await engine.chat.completions.create({
      messages: buildModelMessages(chat, retrieved, route?.toolContext || ""),
      temperature: profile.temperature,
      top_p: 0.9,
      max_tokens: profile.maxTokens,
      stream: true,
      stream_options: { include_usage: true }
    });

    let receivedFirstToken = false;

    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content || "";

      if (chunk.usage?.completion_tokens) {
        completionTokens = chunk.usage.completion_tokens;
      }

      if (!delta) continue;

      if (!receivedFirstToken) {
        receivedFirstToken = true;
        setAgentActivity("Answering", route?.toolName || "Model");
      }

      fullReply += delta;
      assistantBubble.textContent = fullReply;
      scrollToBottom();
    }

    const elapsedSeconds = Math.max((performance.now() - generationStartedAt) / 1000, 0.001);
    lastGenerationStats = {
      tokens: completionTokens,
      seconds: elapsedSeconds,
      tokensPerSecond: completionTokens ? completionTokens / elapsedSeconds : null
    };

    if (lastGenerationStats.tokensPerSecond) {
      performanceStatus.textContent =
        `${profile.label} • ${lastGenerationStats.tokensPerSecond.toFixed(1)} tok/s`;
    } else {
      performanceStatus.textContent = profile.label;
    }

    assistantBubble.classList.remove("typing");

    if (generationWasStopped) {
      fullReply = fullReply.trim()
        ? `${fullReply.trim()}\n\n[Generation stopped]`
        : "[Generation stopped]";
    } else if (!fullReply.trim()) {
      fullReply = "I could not complete that response.";
    }

    chat.messages.push({
      role: "assistant",
      content: fullReply,
      createdAt: Date.now(),
      sources: sourceNames,
      tool: route?.toolName || (retrieved.length ? "File search" : "")
    });
    chat.updatedAt = Date.now();

    saveState();
    renderMessages();
    renderChats();
    renderHeader();
  } catch (error) {
    console.error(error);

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

function buildModelMessages(chat, retrieved, toolContext = "") {
  const memoryBlock = state.memories.length
    ? `PERSISTENT MEMORY:\n${state.memories.map((item, index) => `${index + 1}. ${item.text}`).join("\n")}`
    : "";

  const localContext = retrieved.length
    ? `LOCAL FILE CONTEXT:\n${retrieved.map((item, index) => `[${index + 1}] Source: ${item.name}\n${item.text}`).join("\n\n")}`
    : "";

  const system = [
    BASE_SYSTEM_PROMPT,
    `CURRENT MODE:\n${MODE_PROMPTS[state.activeMode] || MODE_PROMPTS.general}`,
    memoryBlock,
    localContext,
    toolContext ? `TOOL RESULT CONTEXT:\n${toolContext}` : ""
  ].filter(Boolean).join("\n\n");

  return [
    { role: "system", content: system },
    ...chat.messages.slice(-getPerformanceProfile().recentMessages).map((message) => ({
      role: message.role,
      content: message.content
    }))
  ];
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
  if (!isGenerating || !engine) return;
  generationWasStopped = true;
  stopBtn.disabled = true;
  stopBtn.textContent = "Stopping…";
  try {
    await engine.interruptGenerate();
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
  const files = [...(event.target.files || [])];
  event.target.value = "";
  if (!files.length) return;

  composerNote.textContent = "Adding files locally…";

  for (const file of files) {
    try {
      const text = await extractFileText(file);
      const cleaned = text.replace(/\u0000/g, "").trim().slice(0, MAX_FILE_CHARS);
      if (!cleaned) throw new Error("No readable text was found.");

      await putLocalFile({
        id: crypto.randomUUID ? crypto.randomUUID() : `file-${Date.now()}-${Math.random()}`,
        name: file.name,
        type: file.type || file.name.split(".").pop() || "text",
        size: file.size,
        text: cleaned,
        createdAt: Date.now()
      });
    } catch (error) {
      alert(`${file.name}: ${error?.message || "Could not read this file."}`);
    }
  }

  localFiles = await listLocalFiles();
  renderFiles();
  renderStats();
  composerNote.textContent = "Files added. Picklo can now retrieve them when relevant.";
  setTimeout(() => {
    composerNote.textContent = "Chats, memory and files stay in this browser.";
  }, 2500);
}

async function extractFileText(file) {
  const lower = file.name.toLowerCase();
  if (file.type === "application/pdf" || lower.endsWith(".pdf")) {
    return extractPdfText(file);
  }
  return file.text();
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
    const db = await openFileDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(FILE_STORE, "readonly");
      const request = tx.objectStore(FILE_STORE).getAll();
      request.onsuccess = () => resolve((request.result || []).sort((a, b) => b.createdAt - a.createdAt));
      request.onerror = () => reject(request.error);
    });
  } catch {
    return [];
  }
}

async function deleteLocalFile(id) {
  const db = await openFileDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(FILE_STORE, "readwrite");
    tx.objectStore(FILE_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

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

async function retrieveLocalContext(query) {
  if (!localFiles.length) return [];

  const tokens = tokenSet(query);
  if (!tokens.size) return [];

  const scored = [];

  for (const file of localFiles) {
    const chunks = chunkText(file.text);
    chunks.forEach((chunk, index) => {
      const lower = chunk.toLowerCase();
      let score = 0;

      for (const token of tokens) {
        if (token.length < 3) continue;
        const hits = lower.split(token).length - 1;
        score += Math.min(hits, 5) * (token.length >= 7 ? 2.2 : 1);
        if (file.name.toLowerCase().includes(token)) score += 2.5;
      }

      if (score > 0) {
        scored.push({ name: file.name, text: chunk, score, index });
      }
    });
  }

  scored.sort((a, b) => b.score - a.score);

  const chosen = [];
  let chars = 0;

  for (const item of scored) {
    if (chosen.length >= 5) break;
    const contextLimit = Math.min(MAX_CONTEXT_CHARS, getPerformanceProfile().contextChars);
    if (chars + item.text.length > contextLimit && chosen.length) continue;
    chosen.push(item);
    chars += item.text.length;
  }

  return chosen;
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

function setAgentActivity(text, toolName = "") {
  agentActivityText.textContent = text;
  agentActivityBar.classList.remove("hidden");
  agentStatus.textContent = toolName ? `Using ${toolName}` : "Working";
}

function setAgentIdle() {
  agentActivityBar.classList.add("hidden");
  agentStatus.textContent = state.autoTools === false ? "Agent off" : "Agent ready";
}

function setAgentIdleSoon() {
  setTimeout(setAgentIdle, 650);
}

function recordAgentActivity(tool, detail) {
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
  agentCardStatus.textContent = enabled ? "Agent routing is on" : "Agent routing is off";
  agentStatus.textContent = enabled ? "Agent ready" : "Agent off";

  const count = state.agentHistory.length;
  agentToolCount.textContent = `${count} call${count === 1 ? "" : "s"}`;

  agentHistoryList.innerHTML = "";

  if (!count) {
    const empty = document.createElement("div");
    empty.className = "agent-history-empty";
    empty.textContent = "No automatic tool activity yet.";
    agentHistoryList.appendChild(empty);
    return;
  }

  for (const entry of state.agentHistory.slice(0, 5)) {
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
          handled: false,
          toolName: "Calculator",
          toolContext: `The calculator evaluated "${intent.expression}" and returned ${formatted}. Explain this result to the user without changing the computed value.`
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
    switchToolTab("code");
    renderNotes();
    openSheet(toolsSheet);
    recordAgentActivity("Code sandbox", "Loaded JavaScript for manual execution");

    return {
      handled: true,
      tool: "Code sandbox",
      reply: "I loaded that JavaScript into the local sandbox. Review it, then press **Run code** when you want to execute it."
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
  if(!engine||isGenerating)return;const chat=getActiveChat();let index=-1;for(let i=chat.messages.length-1;i>=0;i--){if(chat.messages[i].role==="assistant"){index=i;break;}}if(index<0)return;let user=null;for(let i=index-1;i>=0;i--){if(chat.messages[i].role==="user"){user=chat.messages[i];break;}}if(!user)return;chat.messages=chat.messages.slice(0,index);if(chat.messages.at(-1)?.role==="user")chat.messages.pop();saveState();renderMessages();messageInput.value=user.content;autoResize();await sendMessage();
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
  link.download = `picklo-v7-backup-${new Date().toISOString().slice(0, 10)}.json`;
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
    populateModels();
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
  const fence = /```([^\n`]*)\n?([\s\S]*?)```/g;
  let index = 0;
  let match;

  while ((match = fence.exec(source)) !== null) {
    renderTextMarkdown(container, source.slice(index, match.index));

    const block = document.createElement("div");
    block.className = "code-block";

    const head = document.createElement("div");
    head.className = "code-head";

    const language = document.createElement("span");
    language.textContent = (match[1] || "code").trim() || "code";

    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "copy-code";
    copy.textContent = "Copy";

    const pre = document.createElement("pre");
    const code = document.createElement("code");
    code.textContent = match[2].replace(/\n$/, "");
    pre.appendChild(code);

    head.append(language, copy);
    block.append(head, pre);
    container.appendChild(block);
    index = fence.lastIndex;
  }

  renderTextMarkdown(container, source.slice(index));
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
  const regex = /(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*)/g;
  let index = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > index) {
      parent.appendChild(document.createTextNode(text.slice(index, match.index)));
    }

    const token = match[0];

    if (token.startsWith("`")) {
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

  if (index < text.length) {
    parent.appendChild(document.createTextNode(text.slice(index)));
  }
}