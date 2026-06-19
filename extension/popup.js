const $ = (id) => document.getElementById(id);

const TYPES = {
  SAVE_CONFIG: "cat-collector:save-config",
  GET_STATE: "cat-collector:get-state",
  SAVE_CAPTURE: "cat-collector:save-capture",
  SEND_CAPTURE: "cat-collector:send-capture",
  TEST_BACKEND: "cat-collector:test-backend",
};

const DEFAULT_BACKEND_URL = "http://localhost:8080";

function normalizeBackendUrl(value) {
  return String(value || DEFAULT_BACKEND_URL)
    .trim()
    .replace(/\/+$/, "");
}

function getCaptureEndpoint(backendUrl) {
  const normalized = normalizeBackendUrl(backendUrl);
  return normalized.endsWith("/api/sis-capture")
    ? normalized
    : `${normalized}/api/sis-capture`;
}

function setStatus(message, ok = true) {
  $("status").className = ok ? "status ok" : "status err";
  $("status").textContent = message;
}

function formatDate(value) {
  return value ? new Date(value).toLocaleString("pt-BR") : "—";
}

function renderHistory(history = []) {
  $("history").innerHTML = history.length
    ? history
        .map(
          (item) => `
      <li>
        <b>${item.machine || "—"}</b> <span class="${item.sent ? "ok" : "muted"}">● ${item.sent ? "enviado" : "local"}</span><br>
        <small>Grupo: ${item.group || "—"}</small><br>
        <small>${item.items || 0} peça(s) · ${formatDate(item.capturedAt)}</small>
      </li>`,
        )
        .join("")
    : "<li><small>Nenhuma captura ainda.</small></li>";
}

async function background(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok)
    throw new Error(response?.error?.message || "A extensão não concluiu a operação.");
  return response;
}

async function load() {
  const response = await background({ type: TYPES.GET_STATE });
  $("backendUrl").value = response.state.config.backendUrl || DEFAULT_BACKEND_URL;
  $("collectorKey").value = response.state.config.collectorKey || "";
  renderHistory(response.state.history);
}

async function saveConfig(showConfirmation = true) {
  const response = await background({
    type: TYPES.SAVE_CONFIG,
    config: {
      backendUrl: normalizeBackendUrl($("backendUrl").value),
      collectorKey: $("collectorKey").value.trim(),
      autoCapture: true,
    },
  });
  if (showConfirmation) setStatus("Configuração salva ✓");
  return response.config;
}

async function activeSisTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/^https:\/\/sis2\.cat\.com(?:\/|$)/i.test(tab.url || "")) {
    throw new Error("Abra uma página em https://sis2.cat.com para capturar.");
  }
  return tab;
}

async function sendToContent(message) {
  const tab = await activeSisTab();
  try {
    return await chrome.tabs.sendMessage(tab.id, message);
  } catch {
    await chrome.scripting
      .insertCSS({ target: { tabId: tab.id }, files: ["content.css"] })
      .catch(() => {});
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    return chrome.tabs.sendMessage(tab.id, message);
  }
}

async function capture(mode) {
  setStatus("[SIS] Captura iniciada...");
  const response = await sendToContent({ type: "cat-collector:capture", mode });
  if (!response?.ok) throw new Error(response?.error?.message || "Não foi possível ler a página.");
  await background({ type: TYPES.SAVE_CAPTURE, payload: response.data, source: "popup" });
  await load();
  setStatus(`[SIS] ${response.data.parts.length} peça(s) salvas localmente ✓`);
  return response.data;
}

async function sendLastCapture() {
  const config = await saveConfig(false);
  setStatus(`[SIS] Enviando para ${getCaptureEndpoint(config.backendUrl)}...`);
  await background({ type: TYPES.SEND_CAPTURE, source: "popup" });
  await load();
  setStatus("[SIS] Captura salva no backend ✓");
}

async function testExtension() {
  await saveConfig(false);
  const diagnostic = $("diagnostic");
  diagnostic.hidden = false;
  diagnostic.textContent = "Testando backend...";
  const response = await background({ type: TYPES.TEST_BACKEND });
  diagnostic.textContent = `✅ backend conectado\nHTTP ${response.result.status}\n${response.result.endpoint}`;
  setStatus("Diagnóstico concluído.");
}

$("save").addEventListener("click", () =>
  saveConfig().catch((error) => setStatus(error.message, false)),
);
$("capturePage").addEventListener("click", () =>
  capture("page").catch((error) => setStatus(error.message, false)),
);
$("capturePart").addEventListener("click", () =>
  capture("part").catch((error) => setStatus(error.message, false)),
);
$("captureVisible").addEventListener("click", () =>
  capture("visible").catch((error) => setStatus(error.message, false)),
);
$("sendBackend").addEventListener("click", () =>
  sendLastCapture().catch((error) => setStatus(error.message, false)),
);
$("testExtension").addEventListener("click", () =>
  testExtension().catch((error) => setStatus(error.message, false)),
);

load().catch((error) => setStatus(error.message, false));
