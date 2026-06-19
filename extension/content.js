import {
  MESSAGE_TYPES,
  SIS_URL_PATTERN,
  absoluteUrl,
  captureFingerprint,
  cleanText,
  normalizeCapture,
  normalizePartNumber,
  normalizeQuantity,
  serializeError,
} from "./utils.js";

const INSTANCE_KEY = "__catCollectorProductionInstance";
const PANEL_ID = "cat-collector-panel";
const TOAST_ID = "cat-collector-toast";
const AUTO_CAPTURE_DELAY_MS = 1_800;

if (!globalThis[INSTANCE_KEY]) {
  globalThis[INSTANCE_KEY] = true;
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
    const labeled = valueFromLabels([
      "serial(?: number)?",
      "s\\/n",
      "n[úu]mero de s[ée]rie",
      "prefixo",
    ]);
    if (labeled) return labeled.toUpperCase();
    const catSerial = `${location.href} ${breadcrumbTexts().join(" ")}`.match(/\b([A-Z]{3}\d{5,8})\b/i);
    return catSerial?.[1]?.toUpperCase() ?? "";
  }

  function extractMachineModel() {
    const labeled = valueFromLabels(["machine model", "model", "modelo", "equipment"]);
    if (labeled && /\d/.test(labeled)) return labeled.toUpperCase();

    const source = `${breadcrumbTexts().join(" ")} ${document.title}`;
    const match = source.match(/\b(\d{2,4}\s?[A-Z]{0,4}(?:\s?(?:GC|XE|L|K|M))?)\b/i);
    return cleanText(match?.[1], 120).toUpperCase();
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
    if (message?.type === MESSAGE_TYPES.CAPTURE || message?.action === "capture") {
      try {
        sendResponse({ ok: true, data: collectSisData(message.mode ?? "page") });
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
