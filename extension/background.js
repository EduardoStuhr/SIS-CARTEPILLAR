import { sendCaptureToBackend, testBackendConnection } from "./api.js";
import {
  clearHistory,
  enqueueCapture,
  getConfig,
  getLastCapture,
  getQueue,
  getState,
  initializeStorage,
  removeQueuedCapture,
  saveConfig,
  upsertCapture,
} from "./storage.js";
import { MESSAGE_TYPES, SIS_URL_PATTERN, delay, normalizeCapture, serializeError } from "./utils.js";

const log = (...args) => console.log("[SIS]", ...args);
const CONTENT_SCRIPT_READY_DELAY_MS = 250;

function friendlyError(message, code = "CAT_COLLECTOR_ERROR") {
  return Object.assign(new Error(message), { code });
}

function isSisUrl(url) {
  return SIS_URL_PATTERN.test(String(url || ""));
}

function captureModeFromType(type) {
  if (type === MESSAGE_TYPES.CAPTURE_PART) return "part";
  if (type === MESSAGE_TYPES.CAPTURE_VISIBLE) return "visible";
  return "page";
}

function validateSisTab(tabId, tabUrl) {
  log("Aba usada na captura", { tabId, url: tabUrl });
  if (!tabId || !isSisUrl(tabUrl)) {
    throw friendlyError("Abra uma página do SIS 2.0 antes de capturar.", "INVALID_SIS_TAB");
  }
}

async function pingContentScript(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: MESSAGE_TYPES.PING });
    log("Content script respondeu ao ping", { tabId, ok: Boolean(response?.ok), response });
    return response?.ok ? response : null;
  } catch (error) {
    log("Content script nao respondeu ao ping", { tabId, error: error?.message });
    return null;
  }
}

async function ensureContentScript(tabId) {
  const firstPing = await pingContentScript(tabId);
  if (firstPing) return firstPing;

  log("Injetando content.css/content.js", { tabId });
  await chrome.scripting
    .insertCSS({ target: { tabId }, files: ["content.css"] })
    .catch((error) => log("content.css já injetado ou indisponível", error?.message));
  await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
  await delay(CONTENT_SCRIPT_READY_DELAY_MS);

  const secondPing = await pingContentScript(tabId);
  if (!secondPing) {
    throw friendlyError(
      "Não consegui ativar o CAT Collector nesta aba. Recarregue a página do SIS 2.0 e tente novamente.",
      "CONTENT_SCRIPT_UNAVAILABLE",
    );
  }
  return secondPing;
}

async function notifyTab(tabId, detail) {
  if (!tabId) return;
  await chrome.tabs
    .sendMessage(tabId, { type: MESSAGE_TYPES.STATUS, ...detail })
    .catch(() => undefined);
}

async function saveLocal(payload, source = "manual") {
  const normalized = normalizeCapture(payload);
  if (!normalized.parts.length) {
    throw friendlyError("Nenhuma peça válida encontrada.", "EMPTY_CAPTURE");
  }
  return upsertCapture(normalized, { sent: false, source });
}

async function sendCapture(payload, options = {}) {
  const storedCapture = payload ?? (await getLastCapture());
  if (!storedCapture) {
    throw friendlyError(
      "Nenhuma captura encontrada. Clique em Capturar Página antes de enviar.",
      "EMPTY_CAPTURE",
    );
  }

  const normalized = normalizeCapture(storedCapture);
  if (!normalized.parts.length) {
    throw friendlyError(
      "Nenhuma captura encontrada. Clique em Capturar Página antes de enviar.",
      "EMPTY_CAPTURE",
    );
  }

  const config = await getConfig();
  await upsertCapture(normalized, { sent: false, source: options.source ?? "manual" });

  try {
    const result = await sendCaptureToBackend(config, normalized);
    await upsertCapture(normalized, {
      sent: true,
      source: options.source ?? "manual",
      backendResponse: result.body,
    });
    if (options.queueId) await removeQueuedCapture(options.queueId);
    await notifyTab(options.tabId, {
      ok: true,
      message: `Captura salva: ${normalized.parts.length} peça(s).`,
    });
    return result;
  } catch (error) {
    await upsertCapture(normalized, {
      sent: false,
      source: options.source ?? "manual",
      error,
    });
    if (!options.queueId) await enqueueCapture(normalized, error);
    await notifyTab(options.tabId, {
      ok: false,
      message: error.message,
      error: serializeError(error),
    });
    throw error;
  }
}

async function retryQueue() {
  const config = await getConfig();
  if (!config.backendUrl || !config.collectorKey) return { processed: 0, remaining: 0 };

  const queue = await getQueue();
  let processed = 0;
  for (const item of queue.slice().reverse()) {
    try {
      await sendCapture(item.capture, { queueId: item.id, source: "retry" });
      processed += 1;
    } catch (error) {
      log("Falha ao reenviar fila", item.id, error.message);
      if (error.code === "AUTHENTICATION_ERROR") break;
    }
  }
  return { processed, remaining: (await getQueue()).length };
}

async function handleAutoCapture(message, sender) {
  const config = await getConfig();
  const saved = await saveLocal(message.payload, "automatic");
  if (!config.autoCapture || !config.backendUrl || !config.collectorKey) {
    return { ok: true, saved: true, sent: false, capture: saved.capture };
  }

  try {
    const result = await sendCapture(saved.capture, {
      source: "automatic",
      tabId: sender.tab?.id,
    });
    return { ok: true, saved: true, sent: true, result };
  } catch (error) {
    return {
      ok: false,
      saved: true,
      sent: false,
      error: serializeError(error),
    };
  }
}

async function handleCaptureFromPopup(message) {
  const tabId = message.tabId;
  const tabUrl = message.tabUrl;
  validateSisTab(tabId, tabUrl);
  await ensureContentScript(tabId);

  const mode = message.mode ?? captureModeFromType(message.type);
  const response = await chrome.tabs.sendMessage(tabId, {
    type: MESSAGE_TYPES.CAPTURE_PAGE,
    mode,
  });
  if (!response?.ok) {
    throw friendlyError(
      response?.error?.message || "Não foi possível ler a página do SIS 2.0.",
      response?.error?.code || "CAPTURE_FAILED",
    );
  }

  const capture = normalizeCapture(response.capture ?? response.data);
  log("Quantidade de peças capturadas", { tabId, mode, parts: capture.parts.length });
  const saved = await saveLocal(capture, message.source ?? "popup");
  return { ok: true, capture: saved.capture, historyEntry: saved.historyEntry };
}

async function handleMessage(message, sender) {
  switch (message?.type) {
    case MESSAGE_TYPES.PING:
      return { ok: true };
    case MESSAGE_TYPES.SAVE_CONFIG:
      return { ok: true, config: await saveConfig(message.config ?? {}) };
    case MESSAGE_TYPES.CAPTURE_PAGE:
    case MESSAGE_TYPES.CAPTURE_PART:
    case MESSAGE_TYPES.CAPTURE_VISIBLE:
      return handleCaptureFromPopup(message);
    case MESSAGE_TYPES.SAVE_CAPTURE: {
      const result = await saveLocal(message.payload, message.source ?? "popup");
      return { ok: true, ...result };
    }
    case MESSAGE_TYPES.SEND_BACKEND:
      return {
        ok: true,
        result: await sendCapture(message.payload, {
          source: message.source ?? "popup",
          tabId: message.tabId ?? sender.tab?.id,
        }),
      };
    case MESSAGE_TYPES.AUTO_CAPTURE:
      return handleAutoCapture(message, sender);
    case MESSAGE_TYPES.TEST_BACKEND:
      return { ok: true, result: await testBackendConnection(await getConfig()) };
    case MESSAGE_TYPES.GET_STATE:
      return { ok: true, state: await getState() };
    case MESSAGE_TYPES.CLEAR_HISTORY:
      await clearHistory();
      return { ok: true };
    case MESSAGE_TYPES.RETRY_QUEUE:
      return { ok: true, result: await retryQueue() };
    default:
      throw friendlyError("Mensagem desconhecida.", "UNKNOWN_MESSAGE");
  }
}

chrome.runtime.onInstalled.addListener(() => {
  initializeStorage()
    .then(() => retryQueue())
    .catch((error) => console.error("[SIS] Falha na inicialização", error));
});

chrome.runtime.onStartup.addListener(() => {
  initializeStorage()
    .then(() => retryQueue())
    .catch((error) => console.error("[SIS] Falha ao processar fila", error));
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!String(message?.type ?? "").startsWith("CAT_COLLECTOR_")) return false;

  handleMessage(message, sender)
    .then(sendResponse)
    .catch((error) => {
      console.error("[SIS]", error);
      sendResponse({ ok: false, error: serializeError(error) });
    });
  return true;
});

initializeStorage().catch((error) => console.error("[SIS] Falha ao preparar storage", error));
