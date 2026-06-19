export const SIS_URL_PATTERN = /^https:\/\/sis2\.cat\.com(?:\/|$)/i;

export const MESSAGE_TYPES = Object.freeze({
  PING: "CAT_COLLECTOR_PING",
  CAPTURE_PAGE: "CAT_COLLECTOR_CAPTURE_PAGE",
  CAPTURE_PART: "CAT_COLLECTOR_CAPTURE_PART",
  CAPTURE_VISIBLE: "CAT_COLLECTOR_CAPTURE_VISIBLE",
  CAPTURE: "CAT_COLLECTOR_CAPTURE_PAGE",
  SAVE_CAPTURE: "CAT_COLLECTOR_SAVE_CAPTURE",
  SEND_BACKEND: "CAT_COLLECTOR_SEND_BACKEND",
  SEND_CAPTURE: "CAT_COLLECTOR_SEND_BACKEND",
  AUTO_CAPTURE: "CAT_COLLECTOR_AUTO_CAPTURE",
  TEST_BACKEND: "CAT_COLLECTOR_TEST_BACKEND",
  GET_STATE: "CAT_COLLECTOR_GET_STATE",
  SAVE_CONFIG: "CAT_COLLECTOR_SAVE_CONFIG",
  CLEAR_HISTORY: "CAT_COLLECTOR_CLEAR_HISTORY",
  RETRY_QUEUE: "CAT_COLLECTOR_RETRY_QUEUE",
  STATUS: "CAT_COLLECTOR_STATUS",
});

export function cleanText(value, maxLength = 500) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

export function normalizePartNumber(value) {
  const source = cleanText(value, 200).toUpperCase();
  const matches = source.match(/[A-Z0-9]{1,5}(?:[-\s]?[A-Z0-9]{3,8})/g) ?? [];

  for (const candidate of matches) {
    if (!/\d/.test(candidate)) continue;
    const compact = candidate.replace(/\s+/g, "");
    if (compact.length < 5 || compact.length > 13) continue;
    return compact;
  }

  return "";
}

export function normalizeQuantity(value) {
  const parsed = Number.parseInt(String(value ?? "1").replace(/[^0-9]/g, ""), 10);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(9999, parsed)) : 1;
}

export function absoluteUrl(value, baseUrl = globalThis.location?.href) {
  const source = cleanText(value, 2048);
  if (!source) return "";

  try {
    return new URL(source, baseUrl).href;
  } catch {
    return source;
  }
}

export function normalizeBackendUrl(value) {
  const source = cleanText(value, 2048).replace(/\/+$/, "");
  if (!source) return "";

  const url = new URL(source);
  if (!/^https?:$/.test(url.protocol)) {
    throw new Error("A Backend URL deve usar HTTP ou HTTPS.");
  }
  url.hash = "";
  url.search = "";
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.href.replace(/\/$/, "");
}

export function getCaptureEndpoint(backendUrl) {
  const normalized = normalizeBackendUrl(backendUrl);
  if (!normalized) throw new Error("Backend URL não configurada.");
  return normalized.endsWith("/api/sis-capture")
    ? normalized
    : `${normalized}/api/sis-capture`;
}

export function normalizePart(part, captureUrl = "") {
  const partNumber = normalizePartNumber(part?.partNumber ?? part?.part_number ?? "");
  if (!partNumber) return null;

  return {
    position: cleanText(part?.position ?? part?.itemPosition ?? part?.item_position, 80),
    partNumber,
    description: cleanText(part?.description ?? part?.name ?? partNumber, 500) || partNumber,
    quantity: normalizeQuantity(part?.quantity),
    imageUrl: absoluteUrl(part?.imageUrl ?? part?.image_url, captureUrl),
    url: absoluteUrl(part?.url ?? part?.sourceUrl ?? captureUrl, captureUrl),
    aliases: Array.isArray(part?.aliases)
      ? [...new Set(part.aliases.map((item) => cleanText(item, 120)).filter(Boolean))]
      : [],
  };
}

export function normalizeCapture(payload = {}) {
  const source = payload && typeof payload === "object" ? payload : {};
  const capturedDate = new Date(source.capturedAt ?? Date.now());
  const capturedAt = Number.isNaN(capturedDate.valueOf())
    ? new Date().toISOString()
    : capturedDate.toISOString();
  const url = absoluteUrl(source.url ?? source.sisUrl);
  const sourceParts = source.parts ?? source.items ?? [];
  const partsByNumber = new Map();

  for (const sourcePart of Array.isArray(sourceParts) ? sourceParts : []) {
    const part = normalizePart(sourcePart, url);
    if (!part) continue;
    const current = partsByNumber.get(part.partNumber);
    partsByNumber.set(part.partNumber, current ? { ...current, ...part } : part);
  }

  return {
    machineModel: cleanText(source.machineModel ?? source.model, 120),
    serialNumber: cleanText(source.serialNumber ?? source.serial_number, 120).toUpperCase(),
    system: cleanText(source.system, 240),
    subsystem: cleanText(source.subsystem, 240),
    group: cleanText(source.group ?? source.groupName, 240),
    capturedAt,
    capturedDate: capturedAt.slice(0, 10),
    capturedTime: capturedAt.slice(11, 19),
    url,
    parts: [...partsByNumber.values()],
  };
}

export function buildPartKey(capture, part) {
  return [
    cleanText(capture?.machineModel, 120).toUpperCase(),
    cleanText(capture?.serialNumber, 120).toUpperCase(),
    normalizePartNumber(part?.partNumber),
  ].join("|");
}

export function captureFingerprint(capture) {
  const normalized = normalizeCapture(capture);
  const partNumbers = normalized.parts.map((part) => part.partNumber).sort().join(",");
  return [
    normalized.machineModel.toUpperCase(),
    normalized.serialNumber.toUpperCase(),
    normalized.group.toUpperCase(),
    partNumbers,
  ].join("|");
}

export function randomId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function serializeError(error) {
  if (error && typeof error === "object") {
    return {
      name: cleanText(error.name ?? "Error", 80),
      message: cleanText(error.message ?? String(error), 1000),
      code: cleanText(error.code, 120),
      status: Number(error.status) || 0,
    };
  }
  return { name: "Error", message: cleanText(error || "Erro desconhecido", 1000) };
}

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character]);
}

export function parseOcrText(text) {
  const parts = [];
  const seen = new Set();

  for (const rawLine of String(text ?? "").split(/\r?\n/)) {
    const line = cleanText(rawLine, 500);
    const partNumber = normalizePartNumber(line);
    if (!partNumber || seen.has(partNumber)) continue;

    const tokens = line.split(" ");
    const quantityToken = [...tokens].reverse().find((token) => /^\d{1,4}$/.test(token));
    const quantity = quantityToken && quantityToken !== partNumber
      ? normalizeQuantity(quantityToken)
      : 1;
    const positionMatch = line.match(/^([A-Z0-9]{1,4})\s+/i);
    const description = cleanText(
      line
        .replace(new RegExp(partNumber.replace("-", "[-\\s]?"), "i"), " ")
        .replace(positionMatch?.[0] ?? "", " ")
        .replace(quantityToken ? new RegExp(`\\s${quantityToken}$`) : /$^/, " "),
      500,
    );

    parts.push({
      position: positionMatch?.[1] ?? "",
      partNumber,
      description: description || partNumber,
      quantity,
      imageUrl: "",
      url: "",
      aliases: [],
    });
    seen.add(partNumber);
  }

  return parts;
}

export function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
