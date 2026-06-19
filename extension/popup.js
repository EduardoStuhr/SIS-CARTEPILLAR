const $ = (id) => document.getElementById(id);

function setStatus(message, ok = true) {
  $("status").className = ok ? "status ok" : "status err";
  $("status").textContent = message;
}

function formatDate(value) {
  try {
    return new Date(value).toLocaleString();
  } catch (_e) {
    return value || "—";
  }
}

function summarizeCapture(payload, sent = false, backendResponse = null) {
  return {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    at: new Date().toISOString(),
    machine: payload.machineModel || payload.model || payload.serialNumber || "Máquina não identificada",
    serialNumber: payload.serialNumber || null,
    group: payload.group || "Grupo não identificado",
    items: (payload.parts || payload.items || []).length,
    url: payload.url || payload.sisUrl || "",
    sent,
    captureId: backendResponse?.captureId || null,
  };
}

async function addHistory(payload, sent = false, backendResponse = null) {
  const { history = [] } = await chrome.storage.local.get("history");
  const next = [summarizeCapture(payload, sent, backendResponse), ...history].slice(0, 20);
  await chrome.storage.local.set({ history: next });
  renderHistory(next);
}

function renderHistory(history = []) {
  $("history").innerHTML = history.length
    ? history.map((h) => `
        <li>
          <b>${h.machine || "—"}</b> ${h.sent ? "<span class='ok'>● enviado</span>" : "<span class='muted'>● local</span>"}<br>
          <small>Grupo: ${h.group || "—"}</small><br>
          <small>${h.items || 0} peça(s) · ${formatDate(h.at)}</small>
        </li>`).join("")
    : "<li><small>Nenhuma captura ainda.</small></li>";
}

async function load() {
  const { backendUrl = "", collectorKey = "", history = [] } =
    await chrome.storage.local.get(["backendUrl", "collectorKey", "history"]);
  $("backendUrl").value = backendUrl;
  $("collectorKey").value = collectorKey;
  renderHistory(history);
}

async function saveConfig() {
  await chrome.storage.local.set({
    backendUrl: $("backendUrl").value.trim(),
    collectorKey: $("collectorKey").value.trim(),
  });
  setStatus("Configuração salva ✓");
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs?.[0];
  if (!tab?.id) throw new Error("Nenhuma aba ativa encontrada.");
  return tab;
}

async function injectContent(tabId) {
  await chrome.scripting.insertCSS({ target: { tabId }, files: ["content.css"] }).catch(() => {});
  await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
}

async function sendToContent(message) {
  const tab = await getActiveTab();
  if (!/^https:\/\/sis2\.cat\.com\//i.test(tab.url || "")) {
    throw new Error("Abra uma página em https://sis2.cat.com/* para capturar.");
  }

  const send = () => new Promise((resolve, reject) => {
    chrome.tabs.query(
      { active: true, currentWindow: true },
      (tabs) => {
        chrome.tabs.sendMessage(
          tabs[0].id,
          message,
          (response) => {
            console.log(response);
            const err = chrome.runtime.lastError;
            if (err) reject(new Error(err.message));
            else resolve(response);
          }
        );
      }
    );
  });

  try {
    return await send();
  } catch (_firstError) {
    await injectContent(tab.id);
    return await send();
  }
}

async function capture(mode) {
  setStatus("[SIS] Captura iniciada...");
  const response = await sendToContent({ action: "capture", mode });
  if (!response?.ok) throw new Error(response?.error || "content.js não retornou dados.");
  const payload = response.data;
  const count = (payload.parts || []).length;
  await chrome.storage.local.set({ lastCapture: payload });
  await addHistory(payload, false);
  setStatus(`[SIS] ${count} peça(s) encontradas. Captura local salva ✓`);
  return payload;
}

async function sendPayload(payload) {
  const backendUrl = $("backendUrl").value.trim();
  const collectorKey = $("collectorKey").value.trim();
  if (!backendUrl || !collectorKey) throw new Error("Configure Backend URL e Collector Key.");
  await saveConfig();
  setStatus("[SIS] Enviando para backend...");
  const response = await chrome.runtime.sendMessage({
    type: "catc:send",
    backendUrl,
    collectorKey,
    payload,
  });
  if (!response?.ok) throw new Error(response?.error || "Falha ao enviar captura.");
  await addHistory(payload, true, response.body);
  setStatus("[SIS] Captura salva ✓");
}

async function sendLastCapture() {
  const { lastCapture = null } = await chrome.storage.local.get("lastCapture");
  const payload = lastCapture || await capture("page");
  await sendPayload(payload);
}

async function testExtension() {
  const lines = [];
  const diagnostic = $("diagnostic");
  diagnostic.hidden = false;
  diagnostic.textContent = "Testando...";
  try {
    const ping = await sendToContent({ action: "ping" });
    lines.push(ping?.loaded ? "✅ content.js carregado" : "❌ content.js não carregado");
    lines.push(ping?.ok ? "✅ comunicação popup → content" : "❌ comunicação popup → content falhou");
    lines.push(ping?.isSisPage ? "✅ página SIS detectada" : "❌ página SIS não detectada");

    const captureResponse = await sendToContent({ action: "capture", mode: "visible" });
    const partsFound = captureResponse?.data?.parts?.length || 0;
    lines.push(partsFound > 0 ? `✅ peças encontradas: ${partsFound}` : "❌ peças encontradas: 0");

    const backendUrl = $("backendUrl").value.trim();
    const collectorKey = $("collectorKey").value.trim();
    const backend = await chrome.runtime.sendMessage({
      type: "catc:testBackend",
      backendUrl,
      collectorKey,
    });
    lines.push(backend?.ok ? "✅ backend conectado" : `❌ backend: ${backend?.error || "não testado"}`);
    diagnostic.textContent = lines.join("\n");
    setStatus("Diagnóstico concluído.", backend?.ok && partsFound > 0);
  } catch (e) {
    lines.push(`❌ erro detalhado: ${e.message}`);
    diagnostic.textContent = lines.join("\n");
    setStatus("Diagnóstico encontrou erro.", false);
  }
}

$("save").addEventListener("click", () => saveConfig().catch((e) => setStatus(e.message, false)));
$("capturePage").addEventListener("click", () => capture("page").catch((e) => setStatus(e.message, false)));
$("capturePart").addEventListener("click", () => capture("part").catch((e) => setStatus(e.message, false)));
$("captureVisible").addEventListener("click", () => capture("visible").catch((e) => setStatus(e.message, false)));
$("sendBackend").addEventListener("click", () => sendLastCapture().catch((e) => setStatus(e.message, false)));
$("testExtension").addEventListener("click", () => testExtension());

load();
