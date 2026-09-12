import { supabase } from "./supabase-client.js?v=8.3.0-web";
import { requestCloudImageAnalysis } from "./cloud-ai.js?v=8.3.0-web";

const BUILD_VERSION = "8.3.0-web";
const LOCAL_DB = "picklo-local-attachments-v1";
const LOCAL_STORE = "attachments";
const FILE_DB = "picklo-v3-files";
const FILE_STORE = "documents";
const GUEST_STATE_KEY = "picklo-v7-state";
const USER_STATE_PREFIX = "picklo-v7-state:user:";
const SYNTHETIC_IMAGE_PREFIX = "picklo-image-";
const MAX_LOCAL_FILE_BYTES = 24 * 1024 * 1024;
const MAX_IMAGE_EDGE = 1800;

let syntheticDispatch = false;
let mutationQueued = false;
let attachmentCache = new Map();
let localFileNames = new Set();
let activeOwnerId = "";
const objectUrls = new Map();

installFetchPrivacyGuard();
installVersionListener();

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", installEnhancements, { once: true });
} else {
  installEnhancements();
}

function installEnhancements() {
  document.documentElement.dataset.pickloEnhancements = BUILD_VERSION;
  document.title = "Picklo";

  const input = document.getElementById("fileInput");
  if (input) {
    const current = input.getAttribute("accept") || "";
    if (!current.includes("image/*")) input.setAttribute("accept", `${current},image/*`);
    input.addEventListener("change", interceptAttachmentSelection, true);
  }

  const observer = new MutationObserver(queueEnhanceDOM);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });

  window.addEventListener("storage", queueEnhanceDOM);
  window.addEventListener("pageshow", queueEnhanceDOM);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) queueEnhanceDOM();
  });

  window.addEventListener("picklo:local-chats-deleted", (event) => {
    const chatIds = Array.isArray(event.detail?.chatIds) ? event.detail.chatIds.filter(Boolean) : [];
    if (!chatIds.length) return;
    deleteLocalAttachmentsForChats(chatIds).catch((error) => {
      console.warn("Could not clear local attachments for deleted chats:", error);
    });
  });

  window.addEventListener("picklo:local-file-deleted", (event) => {
    const name = String(event.detail?.name || "");
    const size = Number(event.detail?.size || 0);
    if (!name || !activeOwnerId) return;
    deleteLocalAttachmentCopies(name, size).catch((error) => {
      console.warn("Could not clear the local attachment copy:", error);
    });
  });

  refreshAccountScope().finally(() => {
    Promise.all([refreshAttachmentCache(), refreshLocalFileNames()]).finally(queueEnhanceDOM);
  });

  supabase.auth.onAuthStateChange((_event, session) => {
    const user = session?.user;
    const nextOwner = user && !user.is_anonymous && user.email ? user.id : "";
    if (nextOwner === activeOwnerId) return;
    activeOwnerId = nextOwner;
    revokeObjectUrls();
    attachmentCache = new Map();
    localFileNames = new Set();
    Promise.all([refreshAttachmentCache(), refreshLocalFileNames()]).finally(queueEnhanceDOM);
  });

  queueEnhanceDOM();
}

async function refreshAccountScope() {
  try {
    const { data } = await supabase.auth.getSession();
    const user = data?.session?.user;
    activeOwnerId = user && !user.is_anonymous && user.email ? user.id : "";
  } catch {
    activeOwnerId = "";
  }
}

async function getRegisteredSession() {
  try {
    let { data, error } = await supabase.auth.getSession();
    if (error) return null;
    let session = data?.session || null;
    const valid = () => Boolean(session?.access_token && session?.user && !session.user.is_anonymous && session.user.email);
    if (!valid()) return null;
    const expiresAtMs = Number(session.expires_at || 0) * 1000;
    if (expiresAtMs && expiresAtMs <= Date.now() + 30000) {
      const refreshed = await supabase.auth.refreshSession();
      if (refreshed.error) return null;
      session = refreshed.data?.session || null;
    }
    return valid() ? session : null;
  } catch {
    return null;
  }
}

function revokeObjectUrls() {
  for (const url of objectUrls.values()) URL.revokeObjectURL(url);
  objectUrls.clear();
}

function installFetchPrivacyGuard() {
  if (window.__pickloLocalAttachmentFetchGuard) return;
  window.__pickloLocalAttachmentFetchGuard = true;
  const nativeFetch = window.fetch.bind(window);

  window.fetch = async (input, init = undefined) => {
    try {
      const request = input instanceof Request ? input : null;
      const url = request ? request.url : String(input || "");
      const method = String(init?.method || request?.method || "GET").toUpperCase();
      const isMessageWrite = /\/rest\/v1\/picklo_messages(?:\?|$)/.test(url) && ["POST", "PATCH", "PUT"].includes(method);

      if (isMessageWrite) {
        let body = init?.body;
        if (body == null && request) body = await request.clone().text();

        if (typeof body === "string" && body.trim()) {
          const parsed = JSON.parse(body);
          const sanitize = (row) => {
            if (!row || typeof row !== "object") return row;
            const clean = { ...row };
            const hadArtifact = clean.artifact != null;
            const hadAttachments = Array.isArray(clean.attachments) && clean.attachments.length > 0;
            clean.attachments = [];
            clean.artifact = null;
            clean.sources = sanitizeSyncedWebSources(clean.sources);
            if (hadArtifact) clean.model_content = null;
            if (hadArtifact || hadAttachments) clean.tool = "";
            return clean;
          };
          const nextBody = JSON.stringify(Array.isArray(parsed) ? parsed.map(sanitize) : sanitize(parsed));

          if (request && init?.body == null) {
            input = new Request(request, { body: nextBody });
          } else {
            init = { ...(init || {}), body: nextBody };
          }
        }
      }
    } catch (error) {
      console.warn("Picklo local attachment privacy guard skipped a request:", error);
    }

    return nativeFetch(input, init);
  };
}

function sanitizeSyncedWebSources(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const sources = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || item.kind !== "web") continue;
    try {
      const parsed = new URL(String(item.url || ""));
      if (!["http:", "https:"].includes(parsed.protocol) || seen.has(parsed.href)) continue;
      seen.add(parsed.href);
      sources.push({
        kind: "web",
        title: String(item.title || parsed.hostname).replace(/\s+/g, " ").trim().slice(0, 100) || parsed.hostname,
        url: parsed.href
      });
      if (sources.length >= 8) break;
    } catch {
      // Local filenames and malformed URLs must not leave this browser.
    }
  }
  return sources;
}

function installVersionListener() {
  if (!("serviceWorker" in navigator)) return;

  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data?.type !== "PICKLO_BUILD_VERSION") return;
    const incoming = String(event.data.version || "");
    if (!incoming) return;

    const previous = localStorage.getItem("picklo-last-build-version");
    localStorage.setItem("picklo-last-build-version", incoming);

    if (previous && previous !== incoming && !sessionStorage.getItem("picklo-version-reload")) {
      sessionStorage.setItem("picklo-version-reload", "1");
      location.reload();
    }
  });

  window.addEventListener("load", () => {
    sessionStorage.removeItem("picklo-version-reload");
  }, { once: true });
}

function queueEnhanceDOM() {
  if (mutationQueued) return;
  mutationQueued = true;
  requestAnimationFrame(async () => {
    mutationQueued = false;
    forceSimplifiedHeader();
    hideEmptyMessageRows();
    linkifyMessages();
    highlightCodeBlocks();
    await Promise.all([refreshAttachmentCache(), refreshLocalFileNames()]);
    renderLocalAttachments();
    rewriteLocalContextBanner();
  });
}

function forceSimplifiedHeader() {
  const title = document.getElementById("headerChatTitle");
  if (title && title.textContent !== "Picklo") title.textContent = "Picklo";
}

function hideEmptyMessageRows() {
  document.querySelectorAll("#messages .message-row.user").forEach((row) => {
    if (row.classList.contains("local-attachment-row")) return;
    const bubble = row.querySelector(".message-bubble");
    if (!bubble) return;
    const clone = bubble.cloneNode(true);
    clone.querySelectorAll(".message-time, .message-actions").forEach((node) => node.remove());
    const hasMeaningfulElement = clone.querySelector(".attachment-card, .artifact-card, img, a, code, pre");
    if (!hasMeaningfulElement && !clone.textContent.trim()) row.style.display = "none";
  });
}

function rewriteLocalContextBanner() {
  const context = document.getElementById("contextText");
  if (!context) return;
  if (/picklo-image-[a-f0-9-]+\.txt/i.test(context.textContent || "")) {
    context.textContent = "Using local image";
  }
}

async function interceptAttachmentSelection(event) {
  if (syntheticDispatch) return;
  const input = event.currentTarget;
  const files = [...(input.files || [])];
  if (!files.length) return;

  // Stop the native change event synchronously. Async capture listeners cannot
  // stop propagation after an await, which previously let images fall through
  // to the document parser before the account/vision path had finished.
  event.stopImmediatePropagation();
  event.preventDefault();
  input.value = "";

  const session = await getRegisteredSession();
  const user = session?.user;
  if (!user) {
    window.dispatchEvent(new CustomEvent("picklo:account-required", { detail: { action: "upload" } }));
    return;
  }

  activeOwnerId = user.id;
  const chatId = getActiveChatId();
  const orderIndex = document.querySelectorAll("#messages .message-row").length;
  const images = files.filter((file) => file.type.startsWith("image/"));
  const documents = files.filter((file) => !file.type.startsWith("image/"));

  for (const file of documents) {
    persistLocalAttachment(file, { chatId, kind: "file", orderIndex, ownerId: user.id }).catch((error) => {
      console.warn(`Could not keep ${file.name} locally:`, error);
    });
  }

  if (documents.length) redispatchFilesToPicklo(input, documents);

  for (const image of images) {
    handleLocalImage(image, { chatId, orderIndex, ownerId: user.id }).catch((error) => {
      console.error("Picklo local image handling failed:", error);
      setComposerStatus("The image was kept locally, but Picklo could not prepare it for analysis.");
    });
  }
}

async function handleLocalImage(file, { chatId, orderIndex, ownerId }) {
  if (!file.type.startsWith("image/")) return;
  if (file.size > MAX_LOCAL_FILE_BYTES) {
    setComposerStatus(`${file.name} is too large. Use an image under 24 MB.`);
    return;
  }

  const id = crypto.randomUUID ? crypto.randomUUID() : `img-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const storedBlob = await normalizeImageForStorage(file);
  const record = {
    id,
    ownerId: ownerId || activeOwnerId || "",
    chatId: chatId || null,
    kind: "image",
    name: file.name || "Image",
    type: storedBlob.type || file.type || "image/jpeg",
    size: storedBlob.size,
    blob: storedBlob,
    createdAt: Date.now(),
    orderIndex,
    status: "Reading image locally…",
    syntheticName: `${SYNTHETIC_IMAGE_PREFIX}${id}.txt`
  };

  await putLocalAttachment(record);
  attachmentCache.set(record.id, record);
  renderLocalAttachments();
  setComposerStatus("Image added locally. Gemini is reading a temporary resized copy…");

  let analysis = "";
  let method = "";

  try {
    const cloudImage = await prepareImageForCloud(file);
    const result = await requestCloudImageAnalysis({
      dataUrl: cloudImage,
      prompt: "Describe this image accurately and in enough detail for another assistant to answer follow-up questions. Include visible text, people, objects, layout, colours, quantities, charts and relevant spatial relationships. Do not guess hidden details."
    });
    analysis = String(result?.text || "").trim();
    if (analysis) method = "Gemini vision";
  } catch (error) {
    console.warn("Secure image analysis unavailable, trying OCR:", error);
  }

  if (!analysis.trim()) {
    try {
      const ocr = await analyzeWithOcr(file);
      if (ocr.trim()) {
        analysis = `Text detected in the image:\n${ocr.trim()}`;
        method = "local OCR";
      }
    } catch (error) {
      console.warn("Local OCR unavailable:", error);
    }
  }

  if (!analysis.trim()) {
    analysis = "The image is attached locally, but visual analysis was unavailable. Do not infer details that are not visible in the user's message.";
    method = "local attachment only";
  }

  record.analysis = analysis;
  record.analysisMethod = method;
  record.status = method === "Gemini vision" ? "Analyzed with Gemini" : method === "local OCR" ? "Text read locally" : "Stored locally";
  await putLocalAttachment(record);
  attachmentCache.set(record.id, record);
  renderLocalAttachments();

  const context = [
    "PICKLO LOCAL IMAGE CONTEXT",
    `Original image: ${record.name}`,
    `Processing: ${method}`,
    "The original image bytes remain only in this browser and are not included in cloud conversation sync.",
    "",
    analysis
  ].join("\n");

  const contextFile = new File([context], record.syntheticName, { type: "text/plain" });
  const input = document.getElementById("fileInput");
  if (input) redispatchFilesToPicklo(input, [contextFile]);
  setComposerStatus("Image ready. Ask Picklo about it.");
}

function redispatchFilesToPicklo(input, files) {
  if (!files.length) return;
  try {
    const transfer = new DataTransfer();
    files.forEach((file) => transfer.items.add(file));
    syntheticDispatch = true;
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  } catch (error) {
    console.warn("Could not hand a local attachment to Picklo:", error);
  } finally {
    syntheticDispatch = false;
  }
}

async function prepareImageForCloud(file) {
  try {
    const bitmap = await createImageBitmap(file);
    const maxEdge = 1280;
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d", { alpha: false });
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.78));
    return await fileToDataUrl(blob || file);
  } catch {
    return await fileToDataUrl(file);
  }
}

async function analyzeWithOcr(file) {
  if (!window.Tesseract) {
    await loadClassicScript("https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js", "Tesseract");
  }
  setComposerStatus("Reading visible text locally…");
  const result = await window.Tesseract.recognize(file, "eng", {
    logger: (message) => {
      if (message?.status === "recognizing text" && Number.isFinite(message.progress)) {
        setComposerStatus(`Reading visible text locally… ${Math.round(message.progress * 100)}%`);
      }
    }
  });
  return String(result?.data?.text || "").replace(/\n{3,}/g, "\n\n").trim();
}

function loadClassicScript(src, globalName) {
  return new Promise((resolve, reject) => {
    if (globalName && window[globalName]) return resolve();
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      existing.addEventListener("load", resolve, { once: true });
      existing.addEventListener("error", reject, { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Could not load ${globalName || "helper"}.`));
    document.head.appendChild(script);
  });
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Could not read image."));
    reader.readAsDataURL(file);
  });
}

async function normalizeImageForStorage(file) {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height));
    if (scale >= 0.999 && file.size <= 4 * 1024 * 1024) {
      bitmap.close?.();
      return file;
    }

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d", { alpha: false });
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
    return blob || file;
  } catch {
    return file;
  }
}

async function persistLocalAttachment(file, { chatId, kind, orderIndex, ownerId }) {
  if (file.size > MAX_LOCAL_FILE_BYTES) return;
  const id = crypto.randomUUID ? crypto.randomUUID() : `file-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const record = {
    id,
    ownerId: ownerId || activeOwnerId || "",
    chatId: chatId || null,
    kind,
    name: file.name || "File",
    type: file.type || "application/octet-stream",
    size: file.size,
    blob: file,
    createdAt: Date.now(),
    orderIndex,
    status: "Stored only on this device"
  };
  await putLocalAttachment(record);
  attachmentCache.set(record.id, record);
}

function openLocalDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(LOCAL_DB, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(LOCAL_STORE)) {
        const store = db.createObjectStore(LOCAL_STORE, { keyPath: "id" });
        store.createIndex("chatId", "chatId", { unique: false });
        store.createIndex("createdAt", "createdAt", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function putLocalAttachment(record) {
  const db = await openLocalDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(LOCAL_STORE, "readwrite");
    tx.objectStore(LOCAL_STORE).put(record);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function deleteLocalAttachmentRows(predicate) {
  const db = await openLocalDB();
  const rows = await new Promise((resolve, reject) => {
    const tx = db.transaction(LOCAL_STORE, "readonly");
    const request = tx.objectStore(LOCAL_STORE).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
  const chosen = rows.filter((row) => row?.ownerId === activeOwnerId && predicate(row));
  if (!chosen.length) return [];
  await new Promise((resolve, reject) => {
    const tx = db.transaction(LOCAL_STORE, "readwrite");
    const store = tx.objectStore(LOCAL_STORE);
    chosen.forEach((row) => store.delete(row.id));
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  chosen.forEach((row) => {
    const url = objectUrls.get(row.id);
    if (url) URL.revokeObjectURL(url);
    objectUrls.delete(row.id);
    attachmentCache.delete(row.id);
  });
  return chosen;
}

async function deleteSyntheticContextFiles(names) {
  const wanted = new Set((names || []).filter(Boolean));
  if (!wanted.size || !activeOwnerId) return;
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open(FILE_DB, 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  if (!db.objectStoreNames.contains(FILE_STORE)) return;
  const rows = await new Promise((resolve, reject) => {
    const tx = db.transaction(FILE_STORE, "readonly");
    const request = tx.objectStore(FILE_STORE).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
  const ids = rows
    .filter((row) => row?.ownerId === activeOwnerId && wanted.has(row?.name))
    .map((row) => row.id)
    .filter(Boolean);
  if (!ids.length) return;
  await new Promise((resolve, reject) => {
    const tx = db.transaction(FILE_STORE, "readwrite");
    const store = tx.objectStore(FILE_STORE);
    ids.forEach((id) => store.delete(id));
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function deleteLocalAttachmentsForChats(chatIds) {
  if (!activeOwnerId) return;
  const ids = new Set(chatIds);
  const removed = await deleteLocalAttachmentRows((row) => ids.has(row.chatId));
  await deleteSyntheticContextFiles(removed.map((row) => row.syntheticName));
  await Promise.all([refreshAttachmentCache(), refreshLocalFileNames()]);
  window.dispatchEvent(new CustomEvent("picklo:local-files-mutated"));
  queueEnhanceDOM();
}

async function deleteLocalAttachmentCopies(name, size) {
  if (!activeOwnerId) return;
  await deleteLocalAttachmentRows((row) =>
    row.kind === "file" && row.name === name && (!size || Number(row.size || 0) === size)
  );
  await refreshAttachmentCache();
  queueEnhanceDOM();
}

async function listLocalAttachments() {
  try {
    const db = await openLocalDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(LOCAL_STORE, "readonly");
      const request = tx.objectStore(LOCAL_STORE).getAll();
      request.onsuccess = () => resolve(
        activeOwnerId
          ? (request.result || []).filter((row) => row?.ownerId === activeOwnerId)
          : []
      );
      request.onerror = () => reject(request.error);
    });
  } catch {
    return [];
  }
}

async function refreshAttachmentCache() {
  const rows = await listLocalAttachments();
  attachmentCache = new Map(rows.map((row) => [row.id, row]));
}

async function refreshLocalFileNames() {
  try {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(FILE_DB, 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const rows = await new Promise((resolve, reject) => {
      if (!db.objectStoreNames.contains(FILE_STORE)) return resolve([]);
      const tx = db.transaction(FILE_STORE, "readonly");
      const request = tx.objectStore(FILE_STORE).getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
    localFileNames = new Set(
      rows
        .filter((row) => activeOwnerId && row?.ownerId === activeOwnerId)
        .map((row) => String(row.name || "").trim())
        .filter(Boolean)
    );
  } catch {
    localFileNames = new Set();
  }
}

function getActiveState() {
  // Guest mode must never scan another account's browser cache. The account UI
  // is authoritative for the active scope; registered mode uses only that user's
  // exact local state key.
  const accountMode = document.documentElement.dataset.account || "guest";
  if (accountMode !== "registered" || !activeOwnerId) {
    try { return JSON.parse(localStorage.getItem(GUEST_STATE_KEY) || "null"); }
    catch { return null; }
  }

  try {
    return JSON.parse(localStorage.getItem(`${USER_STATE_PREFIX}${activeOwnerId}`) || "null");
  } catch {
    return null;
  }
}

function getActiveChatId() {
  return getActiveState()?.activeChatId || null;
}

function renderLocalAttachments() {
  const container = document.getElementById("messages");
  if (!container) return;
  const chatId = getActiveChatId();
  if (!chatId) return;

  hideUnavailableAttachmentRows(chatId);
  enhanceExistingFileCards(chatId);

  const rows = [...attachmentCache.values()]
    .filter((record) => record.chatId === chatId)
    .sort((a, b) => a.createdAt - b.createdAt);

  for (const record of rows) {
    if (record.kind === "file" && hasVisibleAttachmentNamed(record.name)) continue;
    if (container.querySelector(`[data-local-attachment-id="${cssEscape(record.id)}"]`)) continue;
    insertLocalAttachmentRow(container, record);
  }
}

function hideUnavailableAttachmentRows(chatId) {
  const localNames = new Set(
    [...attachmentCache.values()]
      .filter((record) => record.chatId === chatId)
      .map((record) => record.name)
  );

  document.querySelectorAll("#messages .attachment-card").forEach((card) => {
    const name = card.querySelector(".attachment-copy strong")?.textContent?.trim() || "";
    const synthetic = name.startsWith(SYNTHETIC_IMAGE_PREFIX) && name.endsWith(".txt");
    const available = localNames.has(name) || localFileNames.has(name);
    const row = card.closest(".message-row");
    if (row && (synthetic || !available)) row.style.display = "none";
  });
}

function enhanceExistingFileCards(chatId) {
  const localForChat = [...attachmentCache.values()].filter((record) => record.chatId === chatId && record.kind === "file");
  document.querySelectorAll("#messages .attachment-card").forEach((card) => {
    if (card.dataset.localEnhanced === "1") return;
    const name = card.querySelector(".attachment-copy strong")?.textContent?.trim() || "";
    const record = [...localForChat].reverse().find((item) => item.name === name);
    if (!record) return;
    card.dataset.localEnhanced = "1";
    card.dataset.localAttachmentId = record.id;
    addLocalDownloadButton(card, record);
  });
}

function hasVisibleAttachmentNamed(name) {
  return [...document.querySelectorAll("#messages .attachment-card .attachment-copy strong")]
    .some((node) => node.textContent?.trim() === name && node.closest(".message-row")?.style.display !== "none");
}

function insertLocalAttachmentRow(container, record) {
  const row = document.createElement("article");
  row.className = "message-row user local-attachment-row";
  row.dataset.localAttachmentId = record.id;

  const wrap = document.createElement("div");
  wrap.className = "message-wrap";
  const bubble = document.createElement("div");
  bubble.className = "message-bubble local-attachment-bubble";

  if (record.kind === "image") {
    const figure = document.createElement("figure");
    figure.className = "local-image-preview";
    const img = document.createElement("img");
    img.alt = record.name || "Attached image";
    img.loading = "lazy";
    img.src = getObjectUrl(record);
    const caption = document.createElement("figcaption");
    const strong = document.createElement("strong");
    strong.textContent = record.name || "Image";
    const small = document.createElement("small");
    small.textContent = record.status || "Stored locally";
    caption.append(strong, small);
    figure.append(img, caption);
    bubble.appendChild(figure);
  } else {
    const card = document.createElement("div");
    card.className = "attachment-card local-file-card";
    card.dataset.localAttachmentId = record.id;

    const icon = document.createElement("span");
    icon.className = "attachment-icon local-file-icon";
    icon.textContent = fileExtension(record.name).slice(0, 4).toUpperCase();

    const copy = document.createElement("span");
    copy.className = "attachment-copy";
    const strong = document.createElement("strong");
    strong.textContent = record.name;
    const small = document.createElement("small");
    small.textContent = `${formatBytes(record.size)} • Local only`;
    copy.append(strong, small);
    card.append(icon, copy);
    addLocalDownloadButton(card, record);
    bubble.appendChild(card);
  }

  const time = document.createElement("time");
  time.className = "message-time";
  time.textContent = new Date(record.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  bubble.appendChild(time);
  wrap.appendChild(bubble);
  row.appendChild(wrap);

  const rows = [...container.querySelectorAll(":scope > .message-row:not(.local-attachment-row)")];
  const target = rows[Math.min(record.orderIndex || rows.length, rows.length)] || null;
  if (target) container.insertBefore(row, target);
  else container.appendChild(row);
}

function addLocalDownloadButton(card, record) {
  if (card.querySelector(".local-file-download")) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "local-file-download";
  button.textContent = "Open";
  button.addEventListener("click", () => {
    if (document.documentElement.dataset.account !== "registered") {
      window.dispatchEvent(new CustomEvent("picklo:account-required", { detail: { action: "download" } }));
      return;
    }
    downloadLocalRecord(record);
  });
  card.appendChild(button);
}

function downloadLocalRecord(record) {
  if (!record?.blob) return;
  const url = getObjectUrl(record);
  const link = document.createElement("a");
  link.href = url;
  link.download = record.name || "picklo-file";
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function getObjectUrl(record) {
  if (objectUrls.has(record.id)) return objectUrls.get(record.id);
  const url = URL.createObjectURL(record.blob);
  objectUrls.set(record.id, url);
  return url;
}

function setComposerStatus(text) {
  const note = document.getElementById("composerNote");
  if (note) note.textContent = text;
}

function fileExtension(name) {
  return String(name || "file").split(".").pop() || "file";
}

function formatBytes(bytes = 0) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function cssEscape(value) {
  return window.CSS?.escape ? CSS.escape(String(value)) : String(value).replace(/[^a-z0-9_-]/gi, "\\$&");
}

function linkifyMessages() {
  document.querySelectorAll("#messages .message-bubble").forEach((bubble) => {
    const walker = document.createTreeWalker(bubble, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent || parent.closest("a, code, pre, button, .artifact-card, .attachment-card, .local-image-preview")) return NodeFilter.FILTER_REJECT;
        if (!node.nodeValue?.trim()) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(linkifyTextNode);
  });
}

function linkifyTextNode(node) {
  const text = node.nodeValue || "";
  const pattern = /(\[([^\]]+)\]\s*\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)|\bhttps?:\/\/[^\s<]+|\bwww\.[^\s<]+|\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b)/gi;
  if (!pattern.test(text)) return;
  pattern.lastIndex = 0;

  const frag = document.createDocumentFragment();
  let cursor = 0;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) frag.appendChild(document.createTextNode(text.slice(cursor, match.index)));

    const token = match[0];
    const markdownLabel = match[2];
    const markdownHref = match[3];
    const link = document.createElement("a");
    link.className = "picklo-link";

    if (markdownHref) {
      link.href = safeHref(markdownHref);
      link.textContent = markdownLabel;
    } else if (/^[\w.%+-]+@[\w.-]+\.[a-z]{2,}$/i.test(token)) {
      link.href = `mailto:${token}`;
      link.textContent = token;
    } else {
      const cleaned = token.replace(/[.,!?;:]+$/, "");
      link.href = safeHref(cleaned.startsWith("www.") ? `https://${cleaned}` : cleaned);
      link.textContent = cleaned;
      const trailing = token.slice(cleaned.length);
      if (trailing) {
        frag.appendChild(link);
        frag.appendChild(document.createTextNode(trailing));
        cursor = pattern.lastIndex;
        continue;
      }
    }

    if (link.href.startsWith("http")) {
      link.target = "_blank";
      link.rel = "noopener noreferrer";
    }
    frag.appendChild(link);
    cursor = pattern.lastIndex;
  }
  if (cursor < text.length) frag.appendChild(document.createTextNode(text.slice(cursor)));
  node.replaceWith(frag);
}

function safeHref(value) {
  const text = String(value || "").trim();
  return /^(?:https?:|mailto:)/i.test(text) ? text : "#";
}

function highlightCodeBlocks() {
  document.querySelectorAll("#messages .code-block").forEach((block) => {
    const code = block.querySelector("code");
    if (!code || code.dataset.highlighted === "1") return;
    const language = block.querySelector(".code-head span")?.textContent?.trim().toLowerCase() || "code";
    const raw = code.textContent || "";
    code.innerHTML = syntaxHighlight(raw, language);
    code.dataset.highlighted = "1";
    block.dataset.language = language;
  });
}

function syntaxHighlight(source, language) {
  if (/^(html?|xml|svg)$/.test(language)) return highlightMarkup(source);
  if (/^(css|scss|sass)$/.test(language)) return highlightCss(source);
  if (/^(json|jsonc)$/.test(language)) return highlightJson(source);
  return highlightProgramming(source, language);
}

function highlightMarkup(source) {
  const escaped = escapeHtml(source);
  return escaped
    .replace(/(&lt;!--[\s\S]*?--&gt;)/g, '<span class="tok-comment">$1</span>')
    .replace(/(&lt;\/?)([\w:-]+)/g, '$1<span class="tok-tag">$2</span>')
    .replace(/\s([\w:-]+)(=)(?=&quot;|&#39;)/g, ' <span class="tok-attr">$1</span><span class="tok-punctuation">$2</span>')
    .replace(/(&quot;[^&]*?&quot;|&#39;[^&]*?&#39;)/g, '<span class="tok-string">$1</span>');
}

function highlightCss(source) {
  const escaped = escapeHtml(source);
  return escaped
    .replace(/(\/\*[\s\S]*?\*\/)/g, '<span class="tok-comment">$1</span>')
    .replace(/(^|[}\s])([.#]?[a-zA-Z][\w-]*(?:\s+[.#]?[\w-]+)*)(\s*\{)/gm, '$1<span class="tok-selector">$2</span>$3')
    .replace(/([\w-]+)(\s*:)/g, '<span class="tok-property">$1</span>$2')
    .replace(/(&quot;[^&]*?&quot;|&#39;[^&]*?&#39;)/g, '<span class="tok-string">$1</span>')
    .replace(/\b(-?\d+(?:\.\d+)?(?:px|rem|em|vh|vw|%|s|ms|deg)?)\b/g, '<span class="tok-number">$1</span>');
}

function highlightJson(source) {
  const escaped = escapeHtml(source);
  return escaped
    .replace(/(&quot;(?:\\.|[^&])*?&quot;)(\s*:)/g, '<span class="tok-property">$1</span>$2')
    .replace(/(:\s*)(&quot;(?:\\.|[^&])*?&quot;)/g, '$1<span class="tok-string">$2</span>')
    .replace(/\b(true|false|null)\b/g, '<span class="tok-keyword">$1</span>')
    .replace(/\b(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\b/gi, '<span class="tok-number">$1</span>');
}

function highlightProgramming(source, language) {
  const escaped = escapeHtml(source);
  const keywordSets = {
    python: "and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield",
    py: "and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield",
    javascript: "async await break case catch class const continue debugger default delete do else export extends finally for from function get if import in instanceof let new of return set static super switch this throw try typeof var void while with yield true false null undefined",
    js: "async await break case catch class const continue debugger default delete do else export extends finally for from function get if import in instanceof let new of return set static super switch this throw try typeof var void while with yield true false null undefined",
    typescript: "abstract any as async await boolean break case catch class const constructor continue declare default delete do else enum export extends false finally for from function get if implements import in infer instanceof interface keyof let namespace never new null number object of private protected public readonly return set static string super switch symbol this throw true try type typeof undefined unknown var void while with yield",
    ts: "abstract any as async await boolean break case catch class const constructor continue declare default delete do else enum export extends false finally for from function get if implements import in infer instanceof interface keyof let namespace never new null number object of private protected public readonly return set static string super switch symbol this throw true try type typeof undefined unknown var void while with yield",
    php: "abstract and array as break callable case catch class clone const continue declare default do echo else elseif empty enddeclare endfor endforeach endif endswitch endwhile eval exit extends final finally fn for foreach function global goto if implements include include_once instanceof insteadof interface isset list match namespace new or print private protected public readonly require require_once return static switch throw trait try unset use var while xor yield true false null",
    java: "abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while true false null",
    code: "if else for while return function class const let var import export from async await try catch throw new true false null"
  };
  const keyText = keywordSets[language] || keywordSets[language.replace(/[^a-z]/g, "")] || keywordSets.code;
  const keywords = keyText.split(/\s+/).join("|");

  const placeholders = [];
  const markerFor = (index) => {
    let value = index + 1;
    let letters = "";
    while (value > 0) {
      value -= 1;
      letters = String.fromCharCode(65 + (value % 26)) + letters;
      value = Math.floor(value / 26);
    }
    return `___PICKLO_TOKEN_${letters}___`;
  };
  const protect = (token, cls) => {
    const marker = markerFor(placeholders.length);
    placeholders.push(`<span class="${cls}">${token}</span>`);
    return marker;
  };

  let text = escaped.replace(/(\/\*[\s\S]*?\*\/|\/\/[^\n]*|#[^\n]*)|(&quot;(?:\\.|[^&])*?&quot;|&#39;(?:\\.|[^&])*?&#39;|`(?:\\.|[^`])*`)/g, (token, comment) =>
    protect(token, comment ? "tok-comment" : "tok-string")
  );

  // Protect declared/assigned variable names before adding keyword markup so
  // variable colouring remains visible instead of being swallowed by nested spans.
  text = text.replace(/\b(const|let|var)\s+([A-Za-z_$][\w$]*)/g, (_match, declaration, variable) =>
    `${declaration} ${protect(variable, "tok-variable")}`
  );
  if (/^(?:python|py)$/i.test(language)) {
    text = text.replace(/(^|\n)(\s*)([A-Za-z_][\w]*)(\s*=)/g, (_m, line, space, variable, equals) =>
      `${line}${space}${protect(variable, "tok-variable")}${equals}`
    );
  }

  text = text
    .replace(new RegExp(`\\b(${keywords})\\b`, "g"), '<span class="tok-keyword">$1</span>')
    .replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="tok-number">$1</span>')
    .replace(/\b([A-Za-z_$][\w$]*)(?=\s*\()/g, '<span class="tok-function">$1</span>')
    .replace(/\.([A-Za-z_$][\w$]*)/g, '.<span class="tok-property">$1</span>');

  placeholders.forEach((value, index) => {
    text = text.replace(markerFor(index), value);
  });
  return text;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
