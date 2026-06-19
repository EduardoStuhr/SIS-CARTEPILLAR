import {
  delay,
  getCaptureEndpoint,
  normalizeCapture,
  serializeError,
} from "./utils.js";

const REQUEST_TIMEOUT_MS = 20_000;
const RETRY_DELAYS_MS = [700, 1_500, 3_000];

export class ApiError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "ApiError";
    this.code = options.code ?? "API_ERROR";
    this.status = options.status ?? 0;
    this.retryable = options.retryable ?? false;
    this.details = options.details ?? null;
  }
}

async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new ApiError("Backend indisponível: tempo limite excedido.", {
        code: "BACKEND_TIMEOUT",
        retryable: true,
      });
    }
    const message = error instanceof TypeError && /failed to fetch/i.test(error.message ?? "")
      ? "Não conectou ao backend; verifique porta/manifest/CORS"
      : `Backend indisponível: ${error?.message ?? "falha de rede"}.`;
    throw new ApiError(message, {
      code: "NETWORK_ERROR",
      retryable: true,
      details: serializeError(error),
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function readResponse(response) {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return response.json().catch(() => ({}));
  }
  const text = await response.text().catch(() => "");
  return text ? { message: text.slice(0, 1000) } : {};
}

function errorFromResponse(response, body) {
  const backendMessage = body?.error ?? body?.message;
  if (response.status === 401) {
    return new ApiError("Collector Key inválida", {
      code: "AUTHENTICATION_ERROR",
      status: response.status,
      details: backendMessage,
    });
  }
  if (response.status === 403) {
    return new ApiError("Collector Key inválida", {
      code: "AUTHENTICATION_ERROR",
      status: response.status,
      details: backendMessage,
    });
  }
  if (response.status === 404) {
    return new ApiError("Endpoint não encontrado", {
      code: "ENDPOINT_NOT_FOUND",
      status: response.status,
      details: backendMessage,
    });
  }
  return new ApiError(backendMessage || `Backend respondeu HTTP ${response.status}.`, {
    code: response.status >= 500 ? "BACKEND_UNAVAILABLE" : "BACKEND_REJECTED",
    status: response.status,
    retryable: response.status === 429 || response.status >= 500,
  });
}

export async function sendCaptureToBackend(config, payload) {
  if (!config?.collectorKey) {
    throw new ApiError("Collector Key não configurada.", { code: "MISSING_COLLECTOR_KEY" });
  }
  const endpoint = getCaptureEndpoint(config.backendUrl);
  const capture = normalizeCapture(payload);
  console.log("[SIS] URL final do endpoint", endpoint);
  console.log("[SIS] Payload antes de enviar ao backend", capture);
  if (capture.parts.some((part) => !part.partNumber)) {
    throw new ApiError("Toda peça precisa ter partNumber.", { code: "INVALID_PART_NUMBER" });
  }
  if (!capture.parts.length) {
    throw new ApiError("A captura não contém peças válidas.", { code: "EMPTY_CAPTURE" });
  }

  console.log("[SIS] Enviando ao backend", {
    url: endpoint,
    parts: capture.parts.length,
    serial: capture.serialNumber || "—",
    modelo: capture.machineModel || "—",
  });
  let lastError;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      const response = await fetchWithTimeout(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.collectorKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(capture),
      });
      const body = await readResponse(response);
      console.log("[SIS] Resposta do backend", {
        url: endpoint,
        status: response.status,
        ok: response.ok,
        body,
      });
      if (!response.ok) {
        console.error("[SIS] Erro do backend", {
          url: endpoint,
          status: response.status,
          body,
        });
        throw errorFromResponse(response, body);
      }
      console.log("[SIS] Captura salva", { status: response.status, body });
      return { ok: true, endpoint, status: response.status, body };
    } catch (error) {
      lastError = error instanceof ApiError
        ? error
        : new ApiError(error?.message ?? "Falha desconhecida.");
      if (!lastError.retryable || attempt === RETRY_DELAYS_MS.length) throw lastError;
      await delay(RETRY_DELAYS_MS[attempt]);
    }
  }
  throw lastError;
}

export async function testBackendConnection(config) {
  if (!config?.collectorKey) {
    throw new ApiError("Collector Key não configurada.", { code: "MISSING_COLLECTOR_KEY" });
  }
  const endpoint = getCaptureEndpoint(config.backendUrl);
  const response = await fetchWithTimeout(endpoint, {
    method: "OPTIONS",
    headers: { Authorization: `Bearer ${config.collectorKey}` },
  });
  const body = await readResponse(response);

  if (response.status === 401 || response.status === 403 || response.status === 404) {
    throw errorFromResponse(response, body);
  }
  if (response.status >= 500) throw errorFromResponse(response, body);
  return { ok: true, endpoint, status: response.status };
}
