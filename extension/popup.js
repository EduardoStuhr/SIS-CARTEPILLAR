const $ = (id) => document.getElementById(id);

const TYPES = Object.freeze({
  SAVE_CONFIG: "CAT_COLLECTOR_SAVE_CONFIG",
  GET_STATE: "CAT_COLLECTOR_GET_STATE",
  CAPTURE_PAGE: "CAT_COLLECTOR_CAPTURE_PAGE",
  CAPTURE_PART: "CAT_COLLECTOR_CAPTURE_PART",
  CAPTURE_VISIBLE: "CAT_COLLECTOR_CAPTURE_VISIBLE",
  SEND_BACKEND: "CAT_COLLECTOR_SEND_BACKEND",
  TEST_BACKEND: "CAT_COLLECTOR_TEST_BACKEND",
});

const DEFAULT_BACKEND_URL = "http://localhost:8080";
const SIS_URL_PATTERN = /^https:\/\/sis2\.cat\.com(?:\/|$)/i;

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

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character]);
}

function setStatus(message, ok = true) {
  $("status").className = ok ? "status ok" : "status err";
  $("status").textContent = message;
}

function formatDate(value) {
  const fallback = new Date().toISOString();
  const date = new Date(value || fallback);
  return Number.isNaN(date.valueOf()) ? new Date(fallback).toLocaleString("pt-BR") : date.toLocaleString("pt-BR");
}

function renderHistory(history = []) {
  const safeHistory = Array.isArray(history) ? history.filter(Boolean) : [];
  $("history").innerHTML = safeHistory.length
    ? safeHistory
        .map((item) => {
          const capturedAt = item?.capturedAt || new Date().toISOString();
          const statusClass = item?.sent ? "ok" : "muted";
          const statusText = item?.sent ? "enviado" : "local";
          return `
      <li>
        <b>${escapeHtml(item?.machine || "-")}</b> <span class="${statusClass}">* ${statusText}</span><br>
        <small>Grupo: ${escapeHtml(item?.group || "-")}</small><br>
        <small>${Number(item?.items) || 0} peça(s) · ${formatDate(capturedAt)}</small>
      </li>`;
        })
        .join("")
    : "<li><small>Nenhuma captura ainda.</small></li>";
}

async function background(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) {
    throw new Error(response?.error?.message || "A extensão não concluiu a operação.");
  }
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
  if (showConfirmation) setStatus("Configuração salva");
  return response.config;
}

async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ?? null;
}

async function activeSisTab() {
  const tab = await getCurrentTab();
  if (!tab?.id || !SIS_URL_PATTERN.test(tab.url || "")) {
    throw new Error("Abra uma página do SIS 2.0 antes de capturar.");
  }
  return tab;
}

async function capture(type) {
  setStatus("[SIS] Captura iniciada...");
  const tab = await activeSisTab();
  const response = await background({
    type,
    tabId: tab.id,
    tabUrl: tab.url,
    source: "popup",
  });
  const capture = response.capture;
  if (!capture) {
    throw new Error("Nenhuma captura encontrada. Clique em Capturar Página antes de enviar.");
  }
  await load();
  setStatus(`[SIS] ${capture.parts?.length || 0} peça(s) salvas localmente`);
  return capture;
}

async function sendLastCapture() {
  const config = await saveConfig(false);
  const tab = await getCurrentTab().catch(() => null);
  setStatus(`[SIS] Enviando para ${getCaptureEndpoint(config.backendUrl)}...`);
  await background({
    type: TYPES.SEND_BACKEND,
    source: "popup",
    tabId: tab?.id,
  });
  await load();
  setStatus("[SIS] Captura salva no backend");
}

async function testExtension() {
  await saveConfig(false);
  const diagnostic = $("diagnostic");
  diagnostic.hidden = false;
  diagnostic.textContent = "Testando backend...";
  const response = await background({ type: TYPES.TEST_BACKEND });
  diagnostic.textContent = `backend conectado\nHTTP ${response.result.status}\n${response.result.endpoint}`;
  setStatus("Diagnóstico concluído.");
}

$("save").addEventListener("click", () =>
  saveConfig().catch((error) => setStatus(error.message, false)),
);
$("capturePage").addEventListener("click", () =>
  capture(TYPES.CAPTURE_PAGE).catch((error) => setStatus(error.message, false)),
);
$("capturePart").addEventListener("click", () =>
  capture(TYPES.CAPTURE_PART).catch((error) => setStatus(error.message, false)),
);
$("captureVisible").addEventListener("click", () =>
  capture(TYPES.CAPTURE_VISIBLE).catch((error) => setStatus(error.message, false)),
);
$("sendBackend").addEventListener("click", () =>
  sendLastCapture().catch((error) => setStatus(error.message, false)),
);
$("testExtension").addEventListener("click", () =>
  testExtension().catch((error) => setStatus(error.message, false)),
);

load().catch((error) => setStatus(error.message, false));
