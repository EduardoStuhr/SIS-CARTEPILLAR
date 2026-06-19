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
import { MESSAGE_TYPES, normalizeCapture, serializeError } from "./utils.js";

const log = (...args) => console.log("[SIS]", ...args);

async function notifyTab(tabId, detail) {
  if (!tabId) return;
  await chrome.tabs
    .sendMessage(tabId, { type: MESSAGE_TYPES.STATUS, ...detail })
    .catch(() => undefined);
}

async function saveLocal(payload, source = "manual") {
  const normalized = normalizeCapture(payload);
  if (!normalized.parts.length) {
    throw Object.assign(new Error("Nenhuma peça válida encontrada."), { code: "EMPTY_CAPTURE" });
  }
  return upsertCapture(normalized, { sent: false, source });
}

async function sendCapture(payload, options = {}) {
  const normalized = normalizeCapture(payload ?? (await getLastCapture()));
  if (!normalized.parts.length) {
    throw Object.assign(new Error("Nenhuma captura válida disponível para envio."), {
      code: "EMPTY_CAPTURE",
    });
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

async function handleMessage(message, sender) {
  switch (message?.type) {
    case MESSAGE_TYPES.SAVE_CONFIG:
      return { ok: true, config: await saveConfig(message.config ?? {}) };
    case MESSAGE_TYPES.SAVE_CAPTURE: {
      const result = await saveLocal(message.payload, message.source ?? "popup");
      return { ok: true, ...result };
    }
    case MESSAGE_TYPES.SEND_CAPTURE:
      return {
        ok: true,
        result: await sendCapture(message.payload, {
          source: message.source ?? "popup",
          tabId: sender.tab?.id,
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
      throw Object.assign(new Error("Mensagem desconhecida."), { code: "UNKNOWN_MESSAGE" });
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
  if (!String(message?.type ?? "").startsWith("cat-collector:")) return false;

  handleMessage(message, sender)
    .then(sendResponse)
    .catch((error) => {
      console.error("[SIS]", error);
      sendResponse({ ok: false, error: serializeError(error) });
    });
  return true;
});

initializeStorage().catch((error) => console.error("[SIS] Falha ao preparar storage", error));
