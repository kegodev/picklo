import * as webllm from "https://esm.run/@mlc-ai/web-llm";

const APP_VERSION = "2.0.0";
const STORAGE_KEY = "picklo-v2-state";

const BASE_SYSTEM_PROMPT = `
You are Picklo V2, an independent local-first AI assistant.
You are precise, useful, practical and honest about uncertainty.
You run an open language model locally in the user's browser through WebGPU.
You can use persistent memory supplied by the Picklo application.
Do not claim to be ChatGPT or OpenAI.
When asked about your identity, say you are Picklo V2.
Use Markdown when it improves readability, especially for headings, lists and code.
`.trim();

const PREFERRED_MODELS = [
  {
    id: "Llama-3.2-1B-Instruct-q4f16_1-MLC",
    label: "Llama 3.2 1B",
    tier: "Fast"
  },
  {
    id: "SmolLM2-1.7B-Instruct-q4f16_1-MLC",
    label: "SmolLM2 1.7B",
    tier: "Balanced"
  },
  {
    id: "Llama-3.2-3B-Instruct-q4f16_1-MLC",
    label: "Llama 3.2 3B",
    tier: "Stronger"
  },
  {
    id: "Phi-3.5-mini-instruct-q4f16_1-MLC",
    label: "Phi 3.5 Mini",
    tier: "Heavy"
  }
];

const defaultState = () => ({
  version: APP_VERSION,
  activeChatId: null,
  selectedModel: "Llama-3.2-1B-Instruct-q4f16_1-MLC",
  memories: [],
  chats: []
});

let state = loadState();
let engine = null;
let loadedModelId = null;
let isGenerating = false;
let generationWasStopped = false;

const $ = (id) => document.getElementById(id);

const sidebar = $("sidebar");
const menuBtn = $("menuBtn");
const sidebarCloseBtn = $("sidebarCloseBtn");
const newChatBtn = $("newChatBtn");
const clearChatsBtn = $("clearChatsBtn");
const chatList = $("chatList");
const memoryBtn = $("memoryBtn");
const dataBtn = $("dataBtn");
const memoryCount = $("memoryCount");
const memoryModal = $("memoryModal");
const dataModal = $("dataModal");
const overlay = $("overlay");
const memoryList = $("memoryList");
const memoryInput = $("memoryInput");
const addMemoryBtn = $("addMemoryBtn");
const clearMemoryBtn = $("clearMemoryBtn");
const exportDataBtn = $("exportDataBtn");
const importDataInput = $("importDataInput");

const activeChatTitle = $("activeChatTitle");
const topbarStatus = $("topbarStatus");
const modelSelect = $("modelSelect");
const loadModelBtn = $("loadModelBtn");
const progressWrap = $("progressWrap");
const progressBar = $("progressBar");
const progressText = $("progressText");
const progressPercent = $("progressPercent");
const messages = $("messages");
const welcomeTemplate = $("welcomeTemplate");

const chatForm = $("chatForm");
const messageInput = $("messageInput");
const sendBtn = $("sendBtn");
const stopBtn = $("stopBtn");
const storageStatus = $("storageStatus");

const statusDot = $("statusDot");
const runtimeStatus = $("runtimeStatus");
const runtimeDetail = $("runtimeDetail");

boot();

function boot() {
  populateModels();
  ensureActiveChat();
  renderAll();
  bindEvents();

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    });
  }
}

function bindEvents() {
  menuBtn.addEventListener("click", openSidebar);
  sidebarCloseBtn.addEventListener("click", closeSidebar);

  newChatBtn.addEventListener("click", () => {
    createNewChat();
    closeSidebar();
  });

  clearChatsBtn.addEventListener("click", () => {
    if (!state.chats.length) return;
    if (!window.confirm("Delete all saved chats from this browser?")) return;

    state.chats = [];
    state.activeChatId = null;
    ensureActiveChat();
    saveState();
    renderAll();
  });

  memoryBtn.addEventListener("click", () => {
    renderMemory();
    openModal(memoryModal);
  });

  dataBtn.addEventListener("click", () => openModal(dataModal));

  overlay.addEventListener("click", closeModals);

  document.querySelectorAll("[data-close-modal]").forEach((button) => {
    button.addEventListener("click", closeModals);
  });

  addMemoryBtn.addEventListener("click", () => {
    const text = memoryInput.value.trim();
    if (!text) return;

    addMemory(text);
    memoryInput.value = "";
    renderMemory();
    showStorageStatus("Memory saved");
  });

  clearMemoryBtn.addEventListener("click", () => {
    if (!state.memories.length) return;
    if (!window.confirm("Clear all persistent memory?")) return;

    state.memories = [];
    saveState();
    renderMemory();
    renderSidebar();
    showStorageStatus("Memory cleared");
  });

  exportDataBtn.addEventListener("click", exportData);
  importDataInput.addEventListener("change", importData);

  modelSelect.addEventListener("change", () => {
    state.selectedModel = modelSelect.value;
    saveState();

    if (loadedModelId && loadedModelId !== state.selectedModel) {
      loadModelBtn.textContent = "Switch model";
      setRuntime("Model change pending", "Press Switch model", "idle");
      messageInput.disabled = true;
      sendBtn.disabled = true;
    } else if (engine && loadedModelId === state.selectedModel && !isGenerating) {
      loadModelBtn.textContent = "AI ready";
      setRuntime("AI ready", friendlyModelName(loadedModelId), "ready");
      messageInput.disabled = false;
      sendBtn.disabled = false;
    }
  });

  loadModelBtn.addEventListener("click", loadSelectedModel);

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
      if (!engine) {
        loadModelBtn.focus();
        return;
      }
      messageInput.value = prompt.dataset.prompt || "";
      autoResize();
      messageInput.focus();
      return;
    }

    const copyButton = event.target.closest(".copy-code");
    if (copyButton) {
      const code = copyButton.closest(".code-block")?.querySelector("code")?.textContent || "";
      navigator.clipboard?.writeText(code).then(() => {
        const previous = copyButton.textContent;
        copyButton.textContent = "Copied";
        setTimeout(() => (copyButton.textContent = previous), 1100);
      });
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeModals();
      closeSidebar();
    }
  });

  window.addEventListener("resize", () => {
    if (window.innerWidth > 760) closeSidebar();
  });
}

function populateModels() {
  const availableIds = new Set(
    (webllm.prebuiltAppConfig?.model_list || []).map((record) => record.model_id)
  );

  let options = PREFERRED_MODELS.filter((model) => availableIds.has(model.id));

  if (!options.length) {
    options = (webllm.prebuiltAppConfig?.model_list || [])
      .filter((record) => !String(record.model_id).toLowerCase().includes("vision"))
      .slice(0, 8)
      .map((record) => ({
        id: record.model_id,
        label: friendlyModelName(record.model_id),
        tier: "Available"
      }));
  }

  modelSelect.innerHTML = "";

  for (const model of options) {
    const option = document.createElement("option");
    option.value = model.id;
    option.textContent = `${model.label} · ${model.tier}`;
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

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();

    const parsed = JSON.parse(raw);

    return {
      ...defaultState(),
      ...parsed,
      memories: Array.isArray(parsed.memories) ? parsed.memories : [],
      chats: Array.isArray(parsed.chats) ? parsed.chats : []
    };
  } catch {
    return defaultState();
  }
}

function saveState() {
  try {
    state.version = APP_VERSION;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.error("Could not save Picklo state:", error);
    showStorageStatus("Local storage is unavailable");
  }
}

function ensureActiveChat() {
  const activeExists = state.chats.some((chat) => chat.id === state.activeChatId);

  if (activeExists) return;

  if (state.chats.length) {
    state.activeChatId = state.chats[0].id;
  } else {
    const chat = makeChat();
    state.chats.unshift(chat);
    state.activeChatId = chat.id;
  }

  saveState();
}

function makeChat() {
  return {
    id: crypto.randomUUID ? crypto.randomUUID() : `chat-${Date.now()}-${Math.random()}`,
    title: "New chat",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: []
  };
}

function getActiveChat() {
  ensureActiveChat();
  return state.chats.find((chat) => chat.id === state.activeChatId);
}

function createNewChat() {
  const chat = makeChat();
  state.chats.unshift(chat);
  state.activeChatId = chat.id;
  saveState();
  renderAll();
  messageInput.value = "";
  autoResize();
  if (engine) messageInput.focus();
}

function switchChat(chatId) {
  if (isGenerating) return;
  if (!state.chats.some((chat) => chat.id === chatId)) return;

  state.activeChatId = chatId;
  saveState();
  renderAll();
  closeSidebar();
}

function deleteChat(chatId) {
  if (isGenerating) return;

  state.chats = state.chats.filter((chat) => chat.id !== chatId);

  if (state.activeChatId === chatId) {
    state.activeChatId = state.chats[0]?.id || null;
  }

  ensureActiveChat();
  saveState();
  renderAll();
}

function renderAll() {
  renderSidebar();
  renderMessages();
  renderTopbar();
}

function renderSidebar() {
  chatList.innerHTML = "";

  const orderedChats = [...state.chats].sort((a, b) => b.updatedAt - a.updatedAt);

  if (!orderedChats.length) {
    const empty = document.createElement("div");
    empty.className = "empty-chats";
    empty.textContent = "Your saved chats will appear here.";
    chatList.appendChild(empty);
  }

  orderedChats.forEach((chat) => {
    const row = document.createElement("div");
    row.className = `chat-item${chat.id === state.activeChatId ? " active" : ""}`;

    const open = document.createElement("button");
    open.className = "chat-open";
    open.type = "button";
    open.textContent = chat.title || "Untitled chat";
    open.title = chat.title || "Untitled chat";
    open.addEventListener("click", () => switchChat(chat.id));

    const remove = document.createElement("button");
    remove.className = "chat-delete";
    remove.type = "button";
    remove.textContent = "×";
    remove.title = "Delete chat";
    remove.addEventListener("click", (event) => {
      event.stopPropagation();
      deleteChat(chat.id);
    });

    row.append(open, remove);
    chatList.appendChild(row);
  });

  memoryCount.textContent = `${state.memories.length} saved`;
}

function renderTopbar() {
  const chat = getActiveChat();
  activeChatTitle.textContent = chat.title || "New chat";

  if (loadedModelId) {
    topbarStatus.textContent =
      loadedModelId === state.selectedModel
        ? `${friendlyModelName(loadedModelId)} · local`
        : "Selected model not loaded";
  } else {
    topbarStatus.textContent = "Local-first AI";
  }
}

function renderMessages() {
  messages.innerHTML = "";
  const chat = getActiveChat();

  if (!chat.messages.length) {
    messages.appendChild(welcomeTemplate.content.cloneNode(true));
    return;
  }

  for (const message of chat.messages) {
    appendMessageToDOM(message.role, message.content, false);
  }

  scrollToBottom(false);
}

function appendMessageToDOM(role, content, shouldScroll = true) {
  const row = document.createElement("article");
  row.className = `message-row ${role}`;

  if (role === "assistant") {
    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.textContent = "AI";
    row.appendChild(avatar);
  }

  const body = document.createElement("div");
  body.className = "message-content";

  if (role === "assistant") {
    renderMarkdownInto(body, content);
  } else {
    body.textContent = content;
  }

  row.appendChild(body);
  messages.appendChild(row);

  if (shouldScroll) scrollToBottom();
  return body;
}

function addError(text) {
  const error = document.createElement("div");
  error.className = "message-error";
  error.textContent = text;
  messages.appendChild(error);
  scrollToBottom();
}

function addMemory(text) {
  const cleaned = text.trim();
  if (!cleaned) return;

  if (!state.memories.some((memory) => memory.text.toLowerCase() === cleaned.toLowerCase())) {
    state.memories.unshift({
      id: crypto.randomUUID ? crypto.randomUUID() : `memory-${Date.now()}-${Math.random()}`,
      text: cleaned,
      createdAt: Date.now()
    });
  }

  saveState();
  renderSidebar();
}

function renderMemory() {
  memoryList.innerHTML = "";

  if (!state.memories.length) {
    const empty = document.createElement("div");
    empty.className = "memory-empty";
    empty.textContent = 'No memory saved yet. You can also say "remember that ..." in chat.';
    memoryList.appendChild(empty);
  }

  for (const memory of state.memories) {
    const item = document.createElement("div");
    item.className = "memory-item";

    const text = document.createElement("p");
    text.textContent = memory.text;

    const remove = document.createElement("button");
    remove.className = "memory-delete";
    remove.type = "button";
    remove.textContent = "Delete";
    remove.addEventListener("click", () => {
      state.memories = state.memories.filter((entry) => entry.id !== memory.id);
      saveState();
      renderMemory();
      renderSidebar();
    });

    item.append(text, remove);
    memoryList.appendChild(item);
  }

  memoryCount.textContent = `${state.memories.length} saved`;
}

function buildSystemPrompt() {
  const memoryText = state.memories.length
    ? `\n\nPERSISTENT MEMORY FROM THE USER:\n${state.memories
        .map((memory, index) => `${index + 1}. ${memory.text}`)
        .join("\n")}\nUse this memory only when relevant.`
    : "";

  return BASE_SYSTEM_PROMPT + memoryText;
}

function buildMessagesForModel(chat) {
  const recent = chat.messages.slice(-24);

  return [
    { role: "system", content: buildSystemPrompt() },
    ...recent.map((message) => ({
      role: message.role,
      content: message.content
    }))
  ];
}

async function loadSelectedModel() {
  const selected = modelSelect.value;
  if (!selected || isGenerating) return;

  if (!("gpu" in navigator)) {
    setRuntime("WebGPU unavailable", "Use a WebGPU-capable browser", "error");
    addError(
      "WebGPU is unavailable in this browser. Open Picklo in a recent WebGPU-capable browser."
    );
    return;
  }

  loadModelBtn.disabled = true;
  modelSelect.disabled = true;
  messageInput.disabled = true;
  sendBtn.disabled = true;
  progressWrap.classList.remove("hidden");
  progressBar.style.width = "0%";
  progressPercent.textContent = "0%";
  setRuntime("Loading model", friendlyModelName(selected), "loading");
  loadModelBtn.textContent = loadedModelId ? "Switching…" : "Loading…";

  const onProgress = (report) => {
    const text = report?.text || "Preparing model…";
    const value =
      typeof report?.progress === "number"
        ? Math.round(report.progress * 100)
        : extractPercent(text) ?? 0;

    progressText.textContent = text;
    progressPercent.textContent = `${value}%`;
    progressBar.style.width = `${value}%`;
  };

  try {
    if (!engine) {
      engine = new webllm.MLCEngine({
        initProgressCallback: onProgress
      });
    } else if (typeof engine.setInitProgressCallback === "function") {
      engine.setInitProgressCallback(onProgress);
    }

    await engine.reload(selected);

    loadedModelId = selected;
    state.selectedModel = selected;
    saveState();

    progressBar.style.width = "100%";
    progressPercent.textContent = "100%";
    progressText.textContent = "Model ready";

    setRuntime("AI ready", friendlyModelName(selected), "ready");
    loadModelBtn.textContent = "AI ready";
    messageInput.disabled = false;
    sendBtn.disabled = false;
    messageInput.placeholder = "Message Picklo…";
    renderTopbar();

    setTimeout(() => {
      progressWrap.classList.add("hidden");
    }, 850);

    messageInput.focus();
  } catch (error) {
    console.error(error);
    loadedModelId = null;
    setRuntime("Load failed", "Model could not start", "error");
    loadModelBtn.textContent = "Try again";
    addError(`Could not load the selected model. ${error?.message || String(error)}`);
  } finally {
    loadModelBtn.disabled = false;
    modelSelect.disabled = false;
  }
}

async function sendMessage() {
  const content = messageInput.value.trim();
  if (!content || !engine || isGenerating) return;

  const chat = getActiveChat();

  isGenerating = true;
  generationWasStopped = false;
  setComposerGenerating(true);

  chat.messages.push({
    role: "user",
    content,
    createdAt: Date.now()
  });

  if (chat.title === "New chat") {
    chat.title = makeTitle(content);
  }

  chat.updatedAt = Date.now();
  state.chats.sort((a, b) => b.updatedAt - a.updatedAt);
  saveState();

  messages.innerHTML = "";
  for (const message of chat.messages) {
    appendMessageToDOM(message.role, message.content, false);
  }

  messageInput.value = "";
  autoResize();
  renderSidebar();
  renderTopbar();
  scrollToBottom();

  const remembered = parseRememberCommand(content);
  if (remembered) {
    addMemory(remembered);
  }

  const modelMessages = buildMessagesForModel(chat);
  const assistantBody = appendMessageToDOM("assistant", "");
  assistantBody.classList.add("typing-caret");
  assistantBody.textContent = "";

  let fullReply = "";

  try {
    const stream = await engine.chat.completions.create({
      messages: modelMessages,
      temperature: 0.7,
      top_p: 0.9,
      stream: true,
      stream_options: { include_usage: true }
    });

    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content || "";
      if (!delta) continue;

      fullReply += delta;
      assistantBody.textContent = fullReply;
      scrollToBottom();
    }

    assistantBody.classList.remove("typing-caret");

    if (generationWasStopped) {
      fullReply = fullReply.trim()
        ? `${fullReply.trim()}\n\n[Generation stopped]`
        : "[Generation stopped]";
    } else if (!fullReply.trim()) {
      fullReply = "I could not generate a response.";
    }

    renderMarkdownInto(assistantBody, fullReply);

    chat.messages.push({
      role: "assistant",
      content: fullReply,
      createdAt: Date.now()
    });

    chat.updatedAt = Date.now();
    saveState();
    renderSidebar();
  } catch (error) {
    assistantBody.classList.remove("typing-caret");

    if (generationWasStopped) {
      fullReply = fullReply.trim()
        ? `${fullReply.trim()}\n\n[Generation stopped]`
        : "[Generation stopped]";

      renderMarkdownInto(assistantBody, fullReply);

      chat.messages.push({
        role: "assistant",
        content: fullReply,
        createdAt: Date.now()
      });

      chat.updatedAt = Date.now();
      saveState();
    } else {
      assistantBody.remove();
      addError(`Generation failed. ${error?.message || String(error)}`);
    }
  } finally {
    isGenerating = false;
    setComposerGenerating(false);
    messageInput.focus();
  }
}

async function stopGeneration() {
  if (!isGenerating || !engine) return;

  generationWasStopped = true;
  stopBtn.disabled = true;
  stopBtn.textContent = "Stopping…";

  try {
    await engine.interruptGenerate();
  } catch (error) {
    console.warn("Could not interrupt generation:", error);
  }
}

function setComposerGenerating(generating) {
  messageInput.disabled = generating || !engine;
  sendBtn.disabled = generating || !engine;
  stopBtn.classList.toggle("hidden", !generating);
  stopBtn.disabled = false;
  stopBtn.textContent = "Stop";
}

function parseRememberCommand(content) {
  const match = content.match(/^\s*remember(?:\s+that)?\s+(.+)/is);
  return match?.[1]?.trim() || null;
}

function makeTitle(text) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= 42) return clean;
  return `${clean.slice(0, 42).trim()}…`;
}

function extractPercent(text) {
  const match = String(text || "").match(/(\d+(?:\.\d+)?)%/);
  if (!match) return null;
  return Math.max(0, Math.min(100, Math.round(Number(match[1]))));
}

function setRuntime(title, detail, status = "idle") {
  runtimeStatus.textContent = title;
  runtimeDetail.textContent = detail;
  statusDot.className = "status-dot";
  if (status !== "idle") statusDot.classList.add(status);
}

function autoResize() {
  messageInput.style.height = "auto";
  messageInput.style.height = `${Math.min(messageInput.scrollHeight, 170)}px`;
}

function scrollToBottom(smooth = true) {
  requestAnimationFrame(() => {
    messages.scrollTo({
      top: messages.scrollHeight,
      behavior: smooth ? "smooth" : "auto"
    });
  });
}

function openSidebar() {
  sidebar.classList.add("open");
  if (window.innerWidth <= 760) {
    overlay.classList.remove("hidden");
  }
}

function closeSidebar() {
  sidebar.classList.remove("open");
  if (!isAnyModalOpen()) {
    overlay.classList.add("hidden");
  }
}

function openModal(modal) {
  closeSidebar();
  memoryModal.classList.add("hidden");
  dataModal.classList.add("hidden");
  modal.classList.remove("hidden");
  overlay.classList.remove("hidden");
}

function closeModals() {
  memoryModal.classList.add("hidden");
  dataModal.classList.add("hidden");
  if (!sidebar.classList.contains("open")) {
    overlay.classList.add("hidden");
  }
}

function isAnyModalOpen() {
  return !memoryModal.classList.contains("hidden") || !dataModal.classList.contains("hidden");
}

function exportData() {
  const payload = {
    app: "Picklo",
    version: APP_VERSION,
    exportedAt: new Date().toISOString(),
    state
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json"
  });

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `picklo-v2-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);

  showStorageStatus("Backup exported");
}

async function importData(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;

  try {
    const parsed = JSON.parse(await file.text());
    const imported = parsed.state || parsed;

    if (!Array.isArray(imported.chats) || !Array.isArray(imported.memories)) {
      throw new Error("This is not a valid Picklo V2 backup.");
    }

    if (!window.confirm("Replace this browser's current Picklo V2 data with the imported backup?")) {
      return;
    }

    state = {
      ...defaultState(),
      ...imported,
      chats: imported.chats,
      memories: imported.memories
    };

    ensureActiveChat();
    saveState();
    populateModels();
    renderAll();
    closeModals();
    showStorageStatus("Backup imported");
  } catch (error) {
    window.alert(error?.message || "Could not import that file.");
  }
}

function showStorageStatus(text) {
  storageStatus.textContent = text;
  clearTimeout(showStorageStatus.timer);
  showStorageStatus.timer = setTimeout(() => {
    storageStatus.textContent = "Chats and memory stay in this browser";
  }, 2200);
}

function renderMarkdownInto(container, markdown) {
  container.innerHTML = "";

  const source = String(markdown || "");
  const fenceRegex = /```([^\n`]*)\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let match;

  while ((match = fenceRegex.exec(source)) !== null) {
    renderTextMarkdown(container, source.slice(lastIndex, match.index));

    const language = (match[1] || "code").trim() || "code";
    const code = match[2].replace(/\n$/, "");

    const block = document.createElement("div");
    block.className = "code-block";

    const header = document.createElement("div");
    header.className = "code-header";

    const label = document.createElement("span");
    label.textContent = language;

    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "copy-code";
    copy.textContent = "Copy";

    const pre = document.createElement("pre");
    const codeEl = document.createElement("code");
    codeEl.textContent = code;
    pre.appendChild(codeEl);

    header.append(label, copy);
    block.append(header, pre);
    container.appendChild(block);

    lastIndex = fenceRegex.lastIndex;
  }

  renderTextMarkdown(container, source.slice(lastIndex));
}

function renderTextMarkdown(container, text) {
  if (!text) return;

  const lines = text.replace(/\r/g, "").split("\n");
  let list = null;
  let listType = null;
  let paragraphLines = [];

  const flushParagraph = () => {
    if (!paragraphLines.length) return;
    const paragraph = document.createElement("p");
    appendInlineMarkdown(paragraph, paragraphLines.join(" "));
    container.appendChild(paragraph);
    paragraphLines = [];
  };

  const flushList = () => {
    list = null;
    listType = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();

      const level = Math.min(3, heading[1].length);
      const element = document.createElement(`h${level}`);
      appendInlineMarkdown(element, heading[2]);
      container.appendChild(element);
      continue;
    }

    const unordered = trimmed.match(/^[-*]\s+(.+)$/);
    const ordered = trimmed.match(/^\d+\.\s+(.+)$/);

    if (unordered || ordered) {
      flushParagraph();

      const wantedType = ordered ? "ol" : "ul";
      if (!list || listType !== wantedType) {
        flushList();
        list = document.createElement(wantedType);
        listType = wantedType;
        container.appendChild(list);
      }

      const item = document.createElement("li");
      appendInlineMarkdown(item, (ordered || unordered)[1]);
      list.appendChild(item);
      continue;
    }

    flushList();
    paragraphLines.push(trimmed);
  }

  flushParagraph();
}

function appendInlineMarkdown(parent, text) {
  const tokenRegex = /(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*)/g;
  let index = 0;
  let match;

  while ((match = tokenRegex.exec(text)) !== null) {
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
    } else if (token.startsWith("*")) {
      const em = document.createElement("em");
      em.textContent = token.slice(1, -1);
      parent.appendChild(em);
    }

    index = tokenRegex.lastIndex;
  }

  if (index < text.length) {
    parent.appendChild(document.createTextNode(text.slice(index)));
  }
}
