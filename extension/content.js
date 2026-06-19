(() => {
"use strict";

const MESSAGE_TYPES = Object.freeze({
  PING: "CAT_COLLECTOR_PING",
  CAPTURE_PAGE: "CAT_COLLECTOR_CAPTURE_PAGE",
  CAPTURE_PART: "CAT_COLLECTOR_CAPTURE_PART",
  CAPTURE_VISIBLE: "CAT_COLLECTOR_CAPTURE_VISIBLE",
  SEND_CAPTURE: "CAT_COLLECTOR_SEND_BACKEND",
  AUTO_CAPTURE: "CAT_COLLECTOR_AUTO_CAPTURE",
  STATUS: "CAT_COLLECTOR_STATUS",
});

const SIS_URL_PATTERN = /^https:\/\/sis2\.cat\.com(?:\/|$)/i;
const LISTENER_READY_KEY = "__CAT_COLLECTOR_LISTENER_READY__";
const PANEL_ID = "cat-collector-panel";
const TOAST_ID = "cat-collector-toast";
const AUTO_CAPTURE_DELAY_MS = 1_800;

function cleanText(value, maxLength = 500) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function normalizePartNumber(value) {
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

function normalizeQuantity(value) {
  const parsed = Number.parseInt(String(value ?? "1").replace(/[^0-9]/g, ""), 10);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(9999, parsed)) : 1;
}

function absoluteUrl(value, baseUrl = globalThis.location?.href) {
  const source = cleanText(value, 2048);
  if (!source) return "";

  try {
    return new URL(source, baseUrl).href;
  } catch {
    return source;
  }
}

function normalizePart(part, captureUrl = "") {
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

function normalizeCapture(payload = {}) {
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

function captureFingerprint(capture) {
  const normalized = normalizeCapture(capture);
  const partNumbers = normalized.parts.map((part) => part.partNumber).sort().join(",");
  return [
    normalized.machineModel.toUpperCase(),
    normalized.serialNumber.toUpperCase(),
    normalized.group.toUpperCase(),
    partNumbers,
  ].join("|");
}

function serializeError(error) {
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

if (!window[LISTENER_READY_KEY]) {
  window[LISTENER_READY_KEY] = true;
  startCollector();
} else {
  console.log("[SIS] content.js já está carregado");
}

function startCollector() {
  console.log("[SIS] Detectado");
  let lastAutoFingerprint = "";
  let observedUrl = location.href;
  let refreshTimer;
  let autoCaptureTimer;

  function textOf(element, maxLength = 1000) {
    return cleanText(element?.innerText ?? element?.textContent, maxLength);
  }

  function getSearchRoots() {
    const roots = [document];
    const visited = new Set(roots);

    for (let index = 0; index < roots.length; index += 1) {
      const root = roots[index];
      for (const element of root.querySelectorAll?.("*") ?? []) {
        if (element.shadowRoot && !visited.has(element.shadowRoot)) {
          visited.add(element.shadowRoot);
          roots.push(element.shadowRoot);
        }
        if (element instanceof HTMLIFrameElement) {
          try {
            if (element.contentDocument && !visited.has(element.contentDocument)) {
              visited.add(element.contentDocument);
              roots.push(element.contentDocument);
            }
          } catch {
            // Cross-origin frames are intentionally ignored.
          }
        }
      }
    }
    return roots;
  }

  function queryAll(selector) {
    const elements = [];
    for (const root of getSearchRoots()) {
      elements.push(...(root.querySelectorAll?.(selector) ?? []));
    }
    return [...new Set(elements)];
  }

  function firstText(selectors) {
    for (const selector of selectors) {
      for (const element of queryAll(selector)) {
        const value = textOf(element, 240);
        if (value) return value;
      }
    }
    return "";
  }

  function breadcrumbTexts() {
    const nodes = queryAll(
      "nav[aria-label*='bread' i] a, nav[aria-label*='bread' i] li, " +
        "[class*='breadcrumb' i] a, [class*='breadcrumb' i] li, " +
        "[data-testid*='breadcrumb' i] *, .MuiBreadcrumbs-root li, .ant-breadcrumb-link",
    );
    return [...new Set(nodes.map((element) => textOf(element, 120)).filter(Boolean))];
  }

  function pageText() {
    return cleanText(`${document.title} ${document.body?.innerText ?? ""}`, 100_000);
  }

  function valueFromLabels(labels) {
    const source = `${location.href} ${breadcrumbTexts().join(" ")} ${pageText()}`;
    for (const label of labels) {
      const match = source.match(new RegExp(`${label}\\s*[:#-]?\\s*([A-Z0-9-]{3,30})`, "i"));
      if (match?.[1]) return cleanText(match[1], 120);
    }
    return "";
  }

  function extractSerialNumber() {
    const url = new URL(location.href);
    for (const key of [
      "serialNumber",
      "serial",
      "sn",
      "machineSerial",
      "equipmentSerialNumber",
      "productId",
    ]) {
      const value = url.searchParams.get(key);
      if (value) return cleanText(value, 120).toUpperCase();
    }
    const hashQuery = url.hash.includes("?") ? url.hash.slice(url.hash.indexOf("?") + 1) : "";
    const hashParams = new URLSearchParams(hashQuery);
    for (const key of [
      "serialNumber",
      "serial",
      "sn",
      "machineSerial",
      "equipmentSerialNumber",
      "productId",
    ]) {
      const value = hashParams.get(key);
      if (value) return cleanText(value, 120).toUpperCase();
    }
    const labeled = valueFromLabels([
      "serial(?: number)?",
      "s\\/n",
      "n[úu]mero de s[ée]rie",
      "prefixo",
    ]);
    if (labeled && !/^(NUMBER|SERIAL|SERIALNUMBER)$/i.test(labeled)) return labeled.toUpperCase();
    const catSerial = `${location.href} ${breadcrumbTexts().join(" ")}`.match(/\b([A-Z]{3}\d{5,8})\b/i);
    return catSerial?.[1]?.toUpperCase() ?? "";
  }

  function extractMachineModel() {
    const serialNumber = extractSerialNumber();
    const crumbs = filteredBreadcrumbs();
    const serialIndex = serialNumber
      ? crumbs.findIndex((value) => value.toUpperCase() === serialNumber)
      : -1;
    if (serialIndex > 0) {
      const beforeSerial = cleanText(crumbs[serialIndex - 1], 120).toUpperCase();
      if (beforeSerial && !/^(NUMBER|SERIAL|SIS|CAT|CATERPILLAR)$/i.test(beforeSerial)) {
        return beforeSerial;
      }
    }

    for (const crumb of [...crumbs].reverse()) {
      const value = cleanText(crumb, 120).toUpperCase();
      if (!value || value === serialNumber || /^(NUMBER|SERIAL|SIS|CAT|CATERPILLAR)$/i.test(value)) continue;
      if (/\d/.test(value)) return value;
    }

    const labeled = valueFromLabels(["machine model", "model", "modelo", "equipment"]);
    if (labeled && /\d/.test(labeled) && !/^(NUMBER|SERIAL)$/i.test(labeled)) return labeled.toUpperCase();

    const source = `${breadcrumbTexts().join(" ")} ${document.title}`;
    const match = source.match(/\b(\d{2,4}\s?[A-Z]{0,4}(?:\s?(?:GC|XE|L|K|M))?)\b/i);
    return cleanText(match?.[1] || "Modelo não informado", 120).toUpperCase();
  }

  function filteredBreadcrumbs() {
    return breadcrumbTexts().filter(
      (value) => !/^(sis|sis 2\.0|caterpillar|cat|home|início|inicio)$/i.test(value),
    );
  }

  function extractSystem() {
    return (
      firstText([
        "[data-testid*='system' i][aria-selected='true']",
        "[data-level='system'][aria-selected='true']",
        "[class*='system' i][class*='selected' i]",
        "[class*='system' i][class*='active' i]",
      ]) || filteredBreadcrumbs().at(-3) || ""
    );
  }

  function extractSubsystem() {
    return (
      firstText([
        "[data-testid*='subsystem' i][aria-selected='true']",
        "[data-level='subsystem'][aria-selected='true']",
        "[class*='subsystem' i][class*='selected' i]",
        "[class*='subsystem' i][class*='active' i]",
      ]) || filteredBreadcrumbs().at(-2) || ""
    );
  }

  function extractGroup() {
    return (
      firstText([
        "[data-testid*='group' i][aria-selected='true']",
        "[data-level='group'][aria-selected='true']",
        "[class*='group' i][class*='selected' i]",
        "[class*='illustration' i] [class*='title' i]",
        "main h1",
        "main h2",
      ]) || filteredBreadcrumbs().at(-1) || ""
    );
  }

  function imageUrlFrom(root) {
    const image = root?.querySelector?.("img, svg image");
    return absoluteUrl(
      image?.currentSrc ??
        image?.getAttribute?.("src") ??
        image?.getAttribute?.("href") ??
        image?.getAttribute?.("xlink:href"),
      location.href,
    );
  }

  function extractDiagramImage() {
    for (const selector of [
      "img[src*='illustration' i]",
      "img[class*='illustration' i]",
      "[class*='illustration' i] img",
      "[class*='diagram' i] img",
      "[data-testid*='diagram' i] img",
      "svg image",
    ]) {
      const image = queryAll(selector)[0];
      const url = imageUrlFrom(image?.parentElement ?? image);
      if (url) return url;
    }
    return "";
  }

  function isVisible(element, viewportOnly = false) {
    if (!(element instanceof Element)) return false;
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
      return false;
    }
    const rectangle = element.getBoundingClientRect();
    if (rectangle.width <= 0 || rectangle.height <= 0) return false;
    if (!viewportOnly) return true;
    return (
      rectangle.top < innerHeight &&
      rectangle.bottom > 0 &&
      rectangle.left < innerWidth &&
      rectangle.right > 0
    );
  }

  function readHeaderMap(table) {
    const headers = [...table.querySelectorAll("thead th, thead td, tr:first-child th")].map((cell) =>
      textOf(cell, 100).toLowerCase(),
    );
    const find = (patterns) => headers.findIndex((header) => patterns.some((pattern) => pattern.test(header)));
    return {
      partNumber: find([/part/, /pe[çc]a/, /n[úu]mero/, /^pn$/]),
      description: find([/descr/, /name/, /nome/, /denomina/]),
      quantity: find([/qty/, /quant/, /qtd/]),
      position: find([/item/, /pos/, /ref/]),
    };
  }

  function extractPartFromRow(row, headerMap = {}) {
    const cells = [...row.querySelectorAll("td, th, [role='cell'], [role='gridcell']")]
      .map((cell) => textOf(cell, 500))
      .filter(Boolean);
    const rowText = cells.join(" ") || textOf(row, 1500);
    const explicitPartNumber =
      row.getAttribute("data-part-number") ??
      row.querySelector("[data-part-number]")?.getAttribute("data-part-number");
    const partNumber = normalizePartNumber(cells[headerMap.partNumber] ?? explicitPartNumber ?? rowText);
    if (!partNumber) return null;

    const quantityText =
      cells[headerMap.quantity] ??
      row.getAttribute("data-quantity") ??
      cells.find((cell) => /^\d{1,4}$/.test(cell));
    const position = cleanText(
      cells[headerMap.position] ??
        row.getAttribute("data-item") ??
        cells.find((cell) => /^[A-Z0-9]{1,4}$/i.test(cell) && normalizePartNumber(cell) !== partNumber),
      80,
    );
    const description = cleanText(
      cells[headerMap.description] ??
        cells
          .filter(
            (cell) =>
              normalizePartNumber(cell) !== partNumber &&
              !/^\d{1,4}$/.test(cell) &&
              cell !== position,
          )
          .sort((first, second) => second.length - first.length)[0] ??
        partNumber,
      500,
    );

    return {
      position,
      partNumber,
      description: description || partNumber,
      quantity: normalizeQuantity(quantityText),
      imageUrl: imageUrlFrom(row) || extractDiagramImage(),
      url: location.href,
    };
  }

  function candidateRows(mode) {
    const candidates = [];
    const selectedSelectors =
      "tr[aria-selected='true'], [role='row'][aria-selected='true'], " +
      "[data-testid*='part' i][class*='selected' i], [class*='part' i][class*='selected' i]";

    if (mode === "part") {
      for (const row of queryAll(selectedSelectors)) candidates.push({ row, headerMap: {} });
    }

    for (const table of queryAll("table, [role='table'], [role='grid']")) {
      const headerMap = readHeaderMap(table);
      for (const row of table.querySelectorAll("tbody tr, [role='row']")) {
        candidates.push({ row, headerMap });
      }
    }
    for (const row of queryAll("[data-part-number], [data-testid*='part-row' i]")) {
      candidates.push({ row, headerMap: {} });
    }

    const unique = [...new Map(candidates.map((item) => [item.row, item])).values()].filter(({ row }) =>
      isVisible(row, mode === "visible"),
    );
    return mode === "part" ? unique.slice(0, 1) : unique;
  }

  function collectParts(mode = "page") {
    const parts = [];
    for (const { row, headerMap } of candidateRows(mode)) {
      const part = extractPartFromRow(row, headerMap);
      if (part) parts.push(part);
    }

    if (!parts.length && mode !== "part") {
      const matches = pageText().match(/[A-Z0-9]{1,5}(?:[-\s]?[A-Z0-9]{3,8})/gi) ?? [];
      for (const value of matches) {
        const partNumber = normalizePartNumber(value);
        if (!partNumber) continue;
        parts.push({
          position: "",
          partNumber,
          description: partNumber,
          quantity: 1,
          imageUrl: extractDiagramImage(),
          url: location.href,
        });
      }
    }

    return normalizeCapture({ parts, url: location.href }).parts;
  }

  function collectSisData(mode = "page") {
    console.log("[SIS] Captura iniciada");
    const parts = collectParts(mode);
    console.log(`[SIS] ${parts.length} peças encontradas`);
    return normalizeCapture({
      machineModel: extractMachineModel(),
      serialNumber: extractSerialNumber(),
      system: extractSystem(),
      subsystem: extractSubsystem(),
      group: extractGroup(),
      capturedAt: new Date().toISOString(),
      url: location.href,
      parts,
    });
  }

  function showToast(message, ok = true) {
    document.getElementById(TOAST_ID)?.remove();
    const element = document.createElement("div");
    element.id = TOAST_ID;
    element.dataset.type = ok ? "success" : "error";
    element.textContent = message;
    document.documentElement.appendChild(element);
    setTimeout(() => element.remove(), 4_000);
  }

  function updatePanel(data = collectSisData("visible")) {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    const status = panel.querySelector("[data-role='status']");
    const details = panel.querySelector("[data-role='details']");
    if (status) status.textContent = "[SIS] Detectado";
    if (details) {
      details.textContent = [
        `Modelo: ${data.machineModel || "—"}`,
        `Série: ${data.serialNumber || "—"}`,
        `Grupo: ${data.group || "—"}`,
        `Peças visíveis: ${data.parts.length}`,
      ].join("\n");
    }
  }

  async function captureAndSend(mode) {
    const payload = collectSisData(mode);
    if (!payload.parts.length) {
      showToast("✖ Nenhuma peça encontrada.", false);
      return;
    }
    const response = await chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.SEND_CAPTURE,
      payload,
      source: "sis-panel",
    });
    if (!response?.ok) {
      throw new Error(response?.error?.message ?? "Falha ao enviar captura.");
    }
    showToast(`✔ Captura salva · ${payload.parts.length} peça(s)`);
    updatePanel(payload);
  }

  function renderPanel() {
    if (!SIS_URL_PATTERN.test(location.href) || document.getElementById(PANEL_ID)) return;
    const panel = document.createElement("aside");
    panel.id = PANEL_ID;
    panel.setAttribute("aria-label", "CAT Collector");
    panel.innerHTML = `
      <header><span>CAT</span> Collector</header>
      <div class="cat-collector-body">
        <strong data-role="status">[SIS] Detectado</strong>
        <pre data-role="details">Lendo página...</pre>
        <button type="button" data-mode="page">Capturar página</button>
        <button type="button" data-mode="part" class="secondary">Capturar peça</button>
        <button type="button" data-mode="visible" class="secondary">Capturar tudo visível</button>
      </div>`;
    document.documentElement.appendChild(panel);
    for (const button of panel.querySelectorAll("button[data-mode]")) {
      button.addEventListener("click", () => {
        button.disabled = true;
        captureAndSend(button.dataset.mode)
          .catch((error) => {
            console.error("[SIS]", error);
            showToast(`✖ ${error.message}`, false);
          })
          .finally(() => {
            button.disabled = false;
          });
      });
    }
    updatePanel();
  }

  async function autoCapture() {
    if (!SIS_URL_PATTERN.test(location.href)) return;
    const payload = collectSisData("visible");
    if (!payload.parts.length) return;
    const fingerprint = captureFingerprint(payload);
    if (fingerprint === lastAutoFingerprint) return;
    lastAutoFingerprint = fingerprint;
    await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.AUTO_CAPTURE, payload });
  }

  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      renderPanel();
      updatePanel();
    }, 500);

    if (location.href !== observedUrl) {
      observedUrl = location.href;
      lastAutoFingerprint = "";
      clearTimeout(autoCaptureTimer);
      autoCaptureTimer = setTimeout(() => autoCapture().catch(console.error), AUTO_CAPTURE_DELAY_MS);
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === MESSAGE_TYPES.PING || message?.action === "ping") {
      sendResponse({
        ok: true,
        loaded: true,
        isSisPage: SIS_URL_PATTERN.test(location.href),
        url: location.href,
      });
      return false;
    }
    if (
      message?.type === MESSAGE_TYPES.CAPTURE_PAGE ||
      message?.type === MESSAGE_TYPES.CAPTURE_PART ||
      message?.type === MESSAGE_TYPES.CAPTURE_VISIBLE ||
      message?.action === "capture"
    ) {
      try {
        const capture = collectSisData(message.mode ?? "page");
        sendResponse({ ok: true, capture, data: capture });
      } catch (error) {
        sendResponse({ ok: false, error: serializeError(error) });
      }
      return false;
    }
    if (message?.type === MESSAGE_TYPES.STATUS) {
      showToast(`${message.ok ? "✔" : "✖"} ${message.message}`, Boolean(message.ok));
      return false;
    }
    return false;
  });

  renderPanel();
  const observer = new MutationObserver(scheduleRefresh);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  autoCaptureTimer = setTimeout(() => autoCapture().catch(console.error), AUTO_CAPTURE_DELAY_MS);
}
})();
