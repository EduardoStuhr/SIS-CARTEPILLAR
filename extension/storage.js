import {
  buildPartKey,
  captureFingerprint,
  cleanText,
  normalizeBackendUrl,
  normalizeCapture,
  randomId,
  serializeError,
} from "./utils.js";

export const STORAGE_KEYS = Object.freeze({
  CONFIG: "catCollectorConfig",
  HISTORY: "catCollectorHistory",
  CATALOG: "catCollectorCatalog",
  LAST_CAPTURE: "catCollectorLastCapture",
  QUEUE: "catCollectorQueue",
  ALIASES: "catCollectorAliases",
});

export const DEFAULT_CONFIG = Object.freeze({
  backendUrl: "http://localhost:8080",
  collectorKey: "",
  autoCapture: true,
});

const LEGACY_DEFAULT_BACKEND_URL = "http://localhost:8081";

const MAX_HISTORY = 100;
const MAX_CATALOG_ITEMS = 5000;
const MAX_QUEUE_ITEMS = 100;

async function read(keys) {
  return chrome.storage.local.get(keys);
}

async function write(values) {
  await chrome.storage.local.set(values);
}

export async function initializeStorage() {
  const values = await read(Object.values(STORAGE_KEYS));
  const updates = {};

  if (!values[STORAGE_KEYS.CONFIG]) updates[STORAGE_KEYS.CONFIG] = DEFAULT_CONFIG;
  if (!Array.isArray(values[STORAGE_KEYS.HISTORY])) updates[STORAGE_KEYS.HISTORY] = [];
  if (!values[STORAGE_KEYS.CATALOG]) updates[STORAGE_KEYS.CATALOG] = {};
  if (!Array.isArray(values[STORAGE_KEYS.QUEUE])) updates[STORAGE_KEYS.QUEUE] = [];
  if (!values[STORAGE_KEYS.ALIASES]) updates[STORAGE_KEYS.ALIASES] = {};
  if (Array.isArray(values[STORAGE_KEYS.HISTORY])) {
    const history = values[STORAGE_KEYS.HISTORY].filter(Boolean);
    if (history.length !== values[STORAGE_KEYS.HISTORY].length) updates[STORAGE_KEYS.HISTORY] = history;
  }
  if (Array.isArray(values[STORAGE_KEYS.QUEUE])) {
    const queue = values[STORAGE_KEYS.QUEUE].filter((item) => item?.capture);
    if (queue.length !== values[STORAGE_KEYS.QUEUE].length) updates[STORAGE_KEYS.QUEUE] = queue;
  }

  if (Object.keys(updates).length) await write(updates);
}

export async function getConfig() {
  const values = await read(STORAGE_KEYS.CONFIG);
  const config = { ...DEFAULT_CONFIG, ...(values[STORAGE_KEYS.CONFIG] ?? {}) };
  if (config.backendUrl === LEGACY_DEFAULT_BACKEND_URL) {
    config.backendUrl = DEFAULT_CONFIG.backendUrl;
  }
  return config;
}

export async function saveConfig(config) {
  const next = {
    backendUrl: config.backendUrl ? normalizeBackendUrl(config.backendUrl) : "",
    collectorKey: cleanText(config.collectorKey, 500),
    autoCapture: config.autoCapture !== false,
  };
  await write({ [STORAGE_KEYS.CONFIG]: next });
  return next;
}

export async function getHistory() {
  const values = await read(STORAGE_KEYS.HISTORY);
  return Array.isArray(values[STORAGE_KEYS.HISTORY])
    ? values[STORAGE_KEYS.HISTORY].filter(Boolean)
    : [];
}

export async function getCatalogRecords() {
  const values = await read(STORAGE_KEYS.CATALOG);
  return Object.values(values[STORAGE_KEYS.CATALOG] ?? {});
}

export async function getLastCapture() {
  const values = await read(STORAGE_KEYS.LAST_CAPTURE);
  return values[STORAGE_KEYS.LAST_CAPTURE] ?? null;
}

export async function getAliases() {
  const values = await read(STORAGE_KEYS.ALIASES);
  return values[STORAGE_KEYS.ALIASES] ?? {};
}

export async function upsertCapture(payload, options = {}) {
  const capture = normalizeCapture(payload);
  if (!capture.parts.length) {
    throw Object.assign(new Error("Nenhuma captura válida para salvar."), { code: "EMPTY_CAPTURE" });
  }
  const values = await read([
    STORAGE_KEYS.HISTORY,
    STORAGE_KEYS.CATALOG,
    STORAGE_KEYS.ALIASES,
  ]);
  const history = Array.isArray(values[STORAGE_KEYS.HISTORY])
    ? values[STORAGE_KEYS.HISTORY]
    : [];
  const catalog = { ...(values[STORAGE_KEYS.CATALOG] ?? {}) };
  const aliases = values[STORAGE_KEYS.ALIASES] ?? {};

  for (const part of capture.parts) {
    const key = buildPartKey(capture, part);
    const existing = catalog[key] ?? {};
    const configuredAliases = aliases[part.partNumber] ?? [];
    catalog[key] = {
      ...existing,
      key,
      machineModel: capture.machineModel,
      serialNumber: capture.serialNumber,
      system: capture.system,
      subsystem: capture.subsystem,
      group: capture.group,
      capturedAt: capture.capturedAt,
      sourceUrl: capture.url,
      ...part,
      aliases: [...new Set([...(existing.aliases ?? []), ...part.aliases, ...configuredAliases])],
      updatedAt: new Date().toISOString(),
    };
  }

  const catalogEntries = Object.entries(catalog).sort(
    ([, first], [, second]) => String(second.updatedAt).localeCompare(String(first.updatedAt)),
  );
  const trimmedCatalog = Object.fromEntries(catalogEntries.slice(0, MAX_CATALOG_ITEMS));
  const fingerprint = captureFingerprint(capture);
  const prior = history.find((item) => item.fingerprint === fingerprint);
  const historyEntry = {
    id: prior?.id ?? randomId(),
    fingerprint,
    machine: capture.machineModel || capture.serialNumber || "Máquina não identificada",
    machineModel: capture.machineModel,
    serialNumber: capture.serialNumber,
    group: capture.group || "Grupo não identificado",
    items: capture.parts.length,
    url: capture.url,
    capturedAt: capture.capturedAt,
    updatedAt: new Date().toISOString(),
    sent: Boolean(options.sent),
    source: cleanText(options.source ?? "manual", 40),
    backendResponse: options.backendResponse ?? prior?.backendResponse ?? null,
    error: options.error ? serializeError(options.error) : null,
  };
  const nextHistory = [
    historyEntry,
    ...history.filter((item) => item.fingerprint !== fingerprint),
  ].slice(0, MAX_HISTORY);

  console.log("[SIS] Salvando localmente");
  await write({
    [STORAGE_KEYS.CATALOG]: trimmedCatalog,
    [STORAGE_KEYS.HISTORY]: nextHistory,
    [STORAGE_KEYS.LAST_CAPTURE]: capture,
  });

  return { capture, historyEntry, catalogSize: Object.keys(trimmedCatalog).length };
}

export async function clearHistory() {
  await chrome.storage.local.remove([STORAGE_KEYS.HISTORY, STORAGE_KEYS.LAST_CAPTURE]);
  await write({ [STORAGE_KEYS.HISTORY]: [] });
}

export async function enqueueCapture(payload, error) {
  const capture = normalizeCapture(payload);
  if (!capture.parts.length) {
    throw Object.assign(new Error("Nenhuma captura válida para enfileirar."), { code: "EMPTY_CAPTURE" });
  }
  const fingerprint = captureFingerprint(capture);
  const values = await read(STORAGE_KEYS.QUEUE);
  const queue = Array.isArray(values[STORAGE_KEYS.QUEUE]) ? values[STORAGE_KEYS.QUEUE] : [];
  const previous = queue.find((item) => item.fingerprint === fingerprint);
  const item = {
    id: previous?.id ?? randomId(),
    fingerprint,
    capture,
    attempts: (previous?.attempts ?? 0) + 1,
    createdAt: previous?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    error: serializeError(error),
  };
  const next = [item, ...queue.filter((entry) => entry.fingerprint !== fingerprint)].slice(
    0,
    MAX_QUEUE_ITEMS,
  );
  await write({ [STORAGE_KEYS.QUEUE]: next });
  return item;
}

export async function getQueue() {
  const values = await read(STORAGE_KEYS.QUEUE);
  return Array.isArray(values[STORAGE_KEYS.QUEUE])
    ? values[STORAGE_KEYS.QUEUE].filter((item) => item?.capture)
    : [];
}

export async function removeQueuedCapture(id) {
  const queue = await getQueue();
  await write({ [STORAGE_KEYS.QUEUE]: queue.filter((item) => item.id !== id) });
}

export async function getState() {
  const [config, history, catalog, lastCapture, queue, aliases] = await Promise.all([
    getConfig(),
    getHistory(),
    getCatalogRecords(),
    getLastCapture(),
    getQueue(),
    getAliases(),
  ]);
  return { config, history, catalog, lastCapture, queue, aliases };
}
