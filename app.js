import * as webllm from "https://esm.run/@mlc-ai/web-llm";

const MODEL_ID = "Llama-3.2-1B-Instruct-q4f16_1-MLC";

const SYSTEM_PROMPT = `
You are Own AI, an independent local-first AI assistant.
You are helpful, precise, concise when possible, and honest about uncertainty.
You run locally in the user's browser using an open language model.
Do not claim to be ChatGPT or OpenAI.
When asked about your identity, say you are Own AI v0.1.
`;

let engine = null;
let isGenerating = false;

let chatHistory = [
  { role: "system", content: SYSTEM_PROMPT.trim() }
];

const sidebar = document.getElementById("sidebar");
const menuBtn = document.getElementById("menuBtn");
const loadModelBtn = document.getElementById("loadModelBtn");
const newChatBtn = document.getElementById("newChatBtn");
const chatForm = document.getElementById("chatForm");
const messageInput = document.getElementById("messageInput");
const sendBtn = document.getElementById("sendBtn");
const messages = document.getElementById("messages");
const welcome = document.getElementById("welcome");
const progressWrap = document.getElementById("progressWrap");
const progressBar = document.getElementById("progressBar");
const progressText = document.getElementById("progressText");
const runtimeStatus = document.getElementById("runtimeStatus");
const runtimeDetail = document.getElementById("runtimeDetail");
const statusDot = document.getElementById("statusDot");

menuBtn.addEventListener("click", () => {
  sidebar.classList.toggle("open");
});

document.addEventListener("click", (event) => {
  if (
    window.innerWidth <= 760 &&
    sidebar.classList.contains("open") &&
    !sidebar.contains(event.target) &&
    !menuBtn.contains(event.target)
  ) {
    sidebar.classList.remove("open");
  }
});

document.querySelectorAll(".suggestion").forEach((button) => {
  button.addEventListener("click", () => {
    if (!engine) return;
    messageInput.value = button.dataset.prompt;
    autoResize();
    messageInput.focus();
  });
});

function setRuntime(status, detail, state = "idle") {
  runtimeStatus.textContent = status;
  runtimeDetail.textContent = detail;
  statusDot.classList.remove("ready", "error");
  if (state === "ready") statusDot.classList.add("ready");
  if (state === "error") statusDot.classList.add("error");
}

function extractPercent(text) {
  const match = String(text || "").match(/(\d+(?:\.\d+)?)%/);
  return match ? Math.max(0, Math.min(100, Number(match[1]))) : null;
}

async function loadModel() {
  if (engine) return;

  if (!("gpu" in navigator)) {
    setRuntime("WebGPU unavailable", "Use a recent WebGPU-capable browser", "error");
    addError(
      "This browser does not expose WebGPU. Try a recent version of Chrome or another WebGPU-compatible browser."
    );
    return;
  }

  loadModelBtn.disabled = true;
  loadModelBtn.textContent = "Loading…";
  progressWrap.classList.remove("hidden");
  setRuntime("Loading model", "First load can be large");

  try {
    engine = await webllm.CreateMLCEngine(MODEL_ID, {
      initProgressCallback: (report) => {
        const text = report.text || "Preparing model…";
        progressText.textContent = text;

        const percent = report.progress != null
          ? Math.round(report.progress * 100)
          : extractPercent(text);

        if (percent != null) {
          progressBar.style.width = `${percent}%`;
        }
      }
    });

    progressBar.style.width = "100%";
    progressText.textContent = "AI ready";
    setRuntime("Ready", "Running locally", "ready");

    messageInput.disabled = false;
    sendBtn.disabled = false;
    messageInput.placeholder = "Message Own AI…";
    loadModelBtn.textContent = "AI Ready";

    setTimeout(() => {
      progressWrap.classList.add("hidden");
    }, 900);

    messageInput.focus();
  } catch (error) {
    console.error(error);
    engine = null;
    loadModelBtn.disabled = false;
    loadModelBtn.textContent = "Try again";
    setRuntime("Load failed", "See error in chat", "error");
    addError(`Could not load the AI model. ${error?.message || error}`);
  }
}

loadModelBtn.addEventListener("click", loadModel);

newChatBtn.addEventListener("click", async () => {
  chatHistory = [{ role: "system", content: SYSTEM_PROMPT.trim() }];

  if (engine && typeof engine.resetChat === "function") {
    try {
      await engine.resetChat();
    } catch (_) {}
  }

  messages.innerHTML = "";
  messages.appendChild(welcome);
  welcome.classList.remove("hidden");
  messageInput.value = "";
  autoResize();

  if (window.innerWidth <= 760) {
    sidebar.classList.remove("open");
  }
});

function addError(text) {
  welcome?.classList.add("hidden");
  const div = document.createElement("div");
  div.className = "error-message";
  div.textContent = text;
  messages.appendChild(div);
  scrollToBottom();
}

function createMessage(role, text = "") {
  welcome?.classList.add("hidden");

  const row = document.createElement("div");
  row.className = `message ${role}`;

  if (role === "assistant") {
    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.textContent = "AI";
    row.appendChild(avatar);
  }

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = text;
  row.appendChild(bubble);

  messages.appendChild(row);
  scrollToBottom();

  return bubble;
}

function scrollToBottom() {
  requestAnimationFrame(() => {
    messages.scrollTop = messages.scrollHeight;
    window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
  });
}

chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await sendMessage();
});

messageInput.addEventListener("keydown", async (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    await sendMessage();
  }
});

messageInput.addEventListener("input", autoResize);

function autoResize() {
  messageInput.style.height = "auto";
  messageInput.style.height = `${Math.min(messageInput.scrollHeight, 180)}px`;
}

async function sendMessage() {
  const content = messageInput.value.trim();

  if (!content || !engine || isGenerating) return;

  isGenerating = true;
  sendBtn.disabled = true;
  messageInput.disabled = true;

  createMessage("user", content);
  chatHistory.push({ role: "user", content });

  messageInput.value = "";
  autoResize();

  const assistantBubble = createMessage("assistant", "");
  assistantBubble.classList.add("typing");

  let fullReply = "";

  try {
    const chunks = await engine.chat.completions.create({
      messages: chatHistory,
      temperature: 0.7,
      top_p: 0.9,
      stream: true,
      stream_options: { include_usage: true }
    });

    for await (const chunk of chunks) {
      const delta = chunk.choices?.[0]?.delta?.content || "";
      fullReply += delta;
      assistantBubble.textContent = fullReply;
      scrollToBottom();
    }

    assistantBubble.classList.remove("typing");

    if (!fullReply.trim()) {
      fullReply = "I could not generate a response.";
      assistantBubble.textContent = fullReply;
    }

    chatHistory.push({ role: "assistant", content: fullReply });

    // Keep the local context from growing forever.
    if (chatHistory.length > 19) {
      chatHistory = [
        chatHistory[0],
        ...chatHistory.slice(-18)
      ];
    }
  } catch (error) {
    console.error(error);
    assistantBubble.classList.remove("typing");
    assistantBubble.textContent =
      `Generation failed: ${error?.message || error}`;
  } finally {
    isGenerating = false;
    sendBtn.disabled = false;
    messageInput.disabled = false;
    messageInput.focus();
  }
}
