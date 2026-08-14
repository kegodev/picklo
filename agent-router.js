const FILE_WORDS = /\b(file|files|document|documents|pdf|uploaded|upload|attachment|attached)\b/i;

export function classifyAgentIntent(input, options = {}) {
  const text = String(input || "").trim();
  const hasFiles = Boolean(options.hasFiles);
  if (!text) return null;

  const remember = text.match(/^\s*remember(?:\s+that)?\s+(.+)/is);
  if (remember?.[1]?.trim()) return { type: "memory_save", value: remember[1].trim() };

  const noteSave =
    text.match(/^\s*(?:save|add|create)\s+(?:a\s+)?note\s*[:\-]?\s+(.+)/is) ||
    text.match(/^\s*note(?:\s+this)?\s*[:\-]\s*(.+)/is);
  if (noteSave?.[1]?.trim()) return { type: "note_save", value: noteSave[1].trim() };

  if (/^\s*(?:show|list|read)\s+(?:my\s+)?notes?\b/i.test(text)) return { type: "notes_list" };

  if (/\b(?:what(?:'s| is)\s+(?:the\s+)?(?:current\s+)?time|current\s+time|time\s+is\s+it)\b/i.test(text))
    return { type: "time" };

  if (/\b(?:what(?:'s| is)\s+(?:today'?s?\s+)?date|current\s+date|what\s+day\s+is\s+it|today'?s?\s+date)\b/i.test(text))
    return { type: "date" };

  if (
    /\b(?:search|find|look\s+for|look\s+up)\b.*\b(?:my|local)\b.*\b(?:file|files|document|documents|pdfs?)\b/i.test(text) ||
    /\b(?:in|from|inside|according\s+to)\s+(?:my\s+)?(?:file|files|document|documents|pdfs?)\b/i.test(text)
  ) return { type: "file_search", query: cleanFileQuery(text), hasFiles };

  const codePrepare = text.match(/^\s*(?:run|execute|test)\s+(?:this\s+)?(?:javascript|js)\s*[:\-]\s*([\s\S]+)/i);
  if (codePrepare?.[1]?.trim()) return { type: "code_prepare", code: codePrepare[1].trim() };

  const math = extractMathExpression(text);
  if (math) return { type: "calculator", expression: math.expression, explain: math.explain };

  return null;
}

export function extractMathExpression(input) {
  let text = String(input || "").trim();
  if (!text) return null;
  const explain = /\b(explain|show\s+me|steps?|why)\b/i.test(text);
  text = text
    .replace(/^\s*(?:calculate|compute|evaluate)\s*[:\-]?\s*/i, "")
    .replace(/^\s*what(?:'s| is)\s+/i, "")
    .replace(/\s*(?:and\s+)?(?:explain(?:\s+it)?|show\s+(?:me\s+)?(?:the\s+)?steps?|step\s+by\s+step|why)\s*\??\s*$/i, "")
    .replace(/\s*(?:please|\?)\s*$/i, "")
    .trim();
  if (text.includes("=") || !/[0-9]/.test(text)) return null;
  const allowed = /^(?:[\d\s.+\-*/%^(),]|sqrt|abs|sin|cos|tan|log|ln|exp|pi|e)+$/i;
  if (!allowed.test(text)) return null;
  if (!/[+\-*/%^()]|\b(?:sqrt|abs|sin|cos|tan|log|ln|exp)\b/i.test(text)) return null;
  return { expression: text, explain };
}

function cleanFileQuery(text) {
  return String(text)
    .replace(/\b(?:search|find|look\s+for|look\s+up)\b(?:\s+in)?\s+(?:my|local)?\s*(?:file|files|document|documents|pdfs?)?\s*(?:for|about|on)?\s*/i, "")
    .replace(/\b(?:in|from|inside|according\s+to)\s+(?:my\s+)?(?:file|files|document|documents|pdfs?)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}
