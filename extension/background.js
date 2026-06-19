// Background service worker — centraliza envio HTTP, retry e diagnóstico.
const log = (...args) => console.log("[SIS]", ...args);

function candidateBackendUrls(backendUrl) {
  if (!backendUrl) throw new Error("Backend URL não configurada.");
  const base = backendUrl.replace(/\/$/, "");
  return [`${base}/api/sis-capture`, `${base}/api/public/sis-capture`];
}

function normalizePayload(payload) {
  const parts = payload.parts || payload.items || [];
  return {
    ...payload,
    sisUrl: payload.sisUrl || payload.url || null,
    url: payload.url || payload.sisUrl || null,
    model: payload.model || payload.machineModel || null,
    machineModel: payload.machineModel || payload.model || null,
    items: parts.map((part) => ({
      partNumber: part.partNumber,
      description: part.description || "",
      quantity: Number(part.quantity || 1),
      itemPosition: part.itemPosition || part.position || null,
      position: part.position || part.itemPosition || null,
      imageUrl: part.imageUrl || null,
    })),
    parts,
  };
}

async function saveHistory(payload, body) {
  const { history = [] } = await chrome.storage.local.get("history");
  const normalized = normalizePayload(payload);
  const next = [{
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    at: new Date().toISOString(),
    machine: normalized.machineModel || normalized.serialNumber || "Máquina não identificada",
    serialNumber: normalized.serialNumber || null,
    group: normalized.group || "Grupo não identificado",
    items: normalized.items.length,
    url: normalized.sisUrl || "",
    sent: true,
    captureId: body?.captureId || null,
  }, ...history].slice(0, 20);
  await chrome.storage.local.set({ history: next, lastCapture: normalized });
}

async function sendToBackend({ backendUrl, collectorKey, payload }) {
  if (!collectorKey) throw new Error("Collector Key não configurada.");
  const urls = candidateBackendUrls(backendUrl);
  const normalized = normalizePayload(payload);
  log("Enviando para backend");
  let lastErr = "";
  for (const url of urls) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${collectorKey}`,
            "Content-Type": "application/json",
            "x-collector-key": collectorKey,
          },
          body: JSON.stringify(normalized),
        });
        const body = await res.json().catch(() => ({}));
        if (res.ok) {
          await saveHistory(normalized, body);
          log("Captura salva");
          return { ok: true, body };
        }
        lastErr = body?.error || `HTTP ${res.status}`;
      } catch (e) {
        lastErr = e.message;
      }
      await new Promise((resolve) => setTimeout(resolve, 600 * attempt));
    }
  }
  return { ok: false, error: lastErr || "Falha desconhecida" };
}

async function testBackend({ backendUrl, collectorKey }) {
  try {
    if (!backendUrl || !collectorKey) throw new Error("Backend URL ou Collector Key ausente.");
    const res = await fetch(candidateBackendUrls(backendUrl)[0], {
      method: "OPTIONS",
      headers: {
        "Authorization": `Bearer ${collectorKey}`,
        "Content-Type": "application/json",
      },
    });
    return res.ok ? { ok: true } : { ok: false, error: `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg?.type) return false;
  (async () => {
    if (msg.type === "catc:send") {
      sendResponse(await sendToBackend(msg));
      return;
    }
    if (msg.type === "catc:testBackend") {
      sendResponse(await testBackend(msg));
      return;
    }
    sendResponse({ ok: false, error: "Mensagem desconhecida." });
  })();
  return true;
});
