/* CAT Collector — content script MV3. */
(function () {
  window.__catCollectorLoaded = true;
  if (window.__catCollectorV12Loaded) {
    console.log("[SIS] content.js reinjetado");
  }
  window.__catCollectorV12Loaded = true;

  const PANEL_ID = "catc-panel";
  const PN_RE = /\b([0-9A-Z]{1,4}[- ]?[0-9A-Z]{3,6})\b/g;
  const SIS_RE = /^https:\/\/sis2\.cat\.com\//i;

  console.log("[SIS] Detectado");

  function textOf(el) {
    return (el?.innerText || el?.textContent || "").replace(/\s+/g, " ").trim();
  }

  function absolutizeUrl(value) {
    if (!value) return null;
    try {
      return new URL(value, location.href).href;
    } catch (_e) {
      return value;
    }
  }

  function pageText() {
    return `${location.href} ${document.title} ${textOf(document.body)}`;
  }

  function breadcrumbNodes() {
    return [...document.querySelectorAll(
      "nav[aria-label*='bread' i] *, [class*='breadcrumb' i] *, [data-testid*='breadcrumb' i] *, .MuiBreadcrumbs-root *, .ant-breadcrumb *"
    )].filter((el) => textOf(el));
  }

  function breadcrumbTexts() {
    const values = breadcrumbNodes().map(textOf).filter(Boolean);
    return [...new Set(values)].filter((value) => value.length <= 90);
  }

  function extractSerialNumber() {
    const url = new URL(location.href);
    for (const key of ["serialNumber", "serial", "sn", "machineSerial", "equipmentSerialNumber"]) {
      const value = url.searchParams.get(key);
      if (value) return value.toUpperCase();
    }
    const source = `${location.href} ${breadcrumbTexts().join(" ")}`;
    const labeled = source.match(/(?:serial|s\/n|n[úu]mero\s+de\s+s[ée]rie)\D*([A-Z0-9]{5,12})/i);
    if (labeled) return labeled[1].toUpperCase();
    const catLike = source.match(/\b([A-Z]{3}\d{5})\b/i);
    return catLike ? catLike[1].toUpperCase() : null;
  }

  function extractMachineModel() {
    const texts = breadcrumbTexts();
    for (const value of texts) {
      const match = value.match(/\b(\d{3,4}\s?[A-Z]{0,3}(?:\s?GC)?)\b/i);
      if (match && !/^\d{4,}$/.test(match[1])) return match[1].replace(/\s+/g, " ").trim().toUpperCase();
    }
    const match = pageText().match(/\b(\d{3,4}\s?[A-Z]{1,3}(?:\s?GC)?)\b/i);
    return match ? match[1].replace(/\s+/g, " ").trim().toUpperCase() : null;
  }

  function activeText(selectors) {
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      const value = textOf(el);
      if (value) return value;
    }
    return null;
  }

  function inferFromBreadcrumb(indexFromEnd) {
    const texts = breadcrumbTexts().filter((value) => !/sis|caterpillar|home|in[íi]cio/i.test(value));
    return texts.length >= Math.abs(indexFromEnd) ? texts.at(indexFromEnd) : null;
  }

  function extractSystem() {
    return activeText([
      "[data-testid*='system' i][aria-selected='true']",
      "[class*='system' i][class*='active' i]",
      "[class*='system' i][class*='selected' i]",
      "li[aria-selected='true'][data-level='system']",
    ]) || inferFromBreadcrumb(-3) || null;
  }

  function extractSubsystem() {
    return activeText([
      "[data-testid*='subsystem' i][aria-selected='true']",
      "[class*='subsystem' i][class*='active' i]",
      "[class*='subsystem' i][class*='selected' i]",
      "li[aria-selected='true'][data-level='subsystem']",
    ]) || inferFromBreadcrumb(-2) || null;
  }

  function extractGroup() {
    return activeText([
      "[data-testid*='group' i][aria-selected='true']",
      "[class*='group' i][class*='active' i]",
      "[class*='group' i][class*='selected' i]",
      "[class*='illustration' i][class*='title' i]",
      "h1", "h2",
    ]) || inferFromBreadcrumb(-1) || null;
  }

  function extractDiagramImage() {
    const img = document.querySelector(
      "img[src*='illustration' i], img[class*='illustration' i], [class*='illustration' i] img, [class*='diagram' i] img, svg image"
    );
    return absolutizeUrl(img?.getAttribute("src") || img?.getAttribute("href") || img?.getAttribute("xlink:href"));
  }

  function rowImage(row) {
    const img = row.querySelector("img, svg image");
    return absolutizeUrl(img?.getAttribute("src") || img?.getAttribute("href") || img?.getAttribute("xlink:href"));
  }

  function normalizePartNumber(value) {
    const match = String(value || "").match(/\b([0-9A-Z]{1,4}[- ]?[0-9A-Z]{3,6})\b/i);
    return match ? match[1].replace(/\s+/, "-").toUpperCase() : null;
  }

  function readHeaderMap(table) {
    const headers = [...table.querySelectorAll("thead th, thead td, tr:first-child th")].map((cell) => textOf(cell).toLowerCase());
    const find = (tests) => headers.findIndex((header) => tests.some((test) => test.test(header)));
    return {
      partNumber: find([/part/, /pe[çc]a/, /n[úu]mero/]),
      description: find([/descr/, /name/, /nome/]),
      quantity: find([/qty/, /quant/, /qtd/]),
      position: find([/item/, /pos/, /ref/]),
    };
  }

  function extractPartFromRow(row, headerMap = {}) {
    const cells = [...row.querySelectorAll("td, th, [role='cell'], [role='gridcell']")].map(textOf).filter(Boolean);
    const rowText = cells.join(" ") || textOf(row);
    const partNumber = normalizePartNumber(
      cells[headerMap.partNumber] || row.getAttribute("data-part-number") || rowText
    );
    if (!partNumber) return null;

    const quantityText = cells[headerMap.quantity] || row.getAttribute("data-quantity") || cells.find((cell) => /^\d{1,3}$/.test(cell));
    const quantity = Math.max(1, Math.min(999, parseInt(quantityText || "1", 10) || 1));
    const position = cells[headerMap.position] || row.getAttribute("data-item") || cells.find((cell) => /^[A-Z0-9]{1,4}$/i.test(cell) && normalizePartNumber(cell) !== partNumber) || null;
    const description = cells[headerMap.description]
      || cells.filter((cell) => normalizePartNumber(cell) !== partNumber && !/^\d{1,3}$/.test(cell)).sort((a, b) => b.length - a.length)[0]
      || partNumber;

    return {
      position,
      itemPosition: position,
      partNumber,
      description,
      quantity,
      imageUrl: rowImage(row) || extractDiagramImage(),
    };
  }

  function candidateRows(root, mode) {
    const rows = [];
    root.querySelectorAll("table, [role='table'], [role='grid']").forEach((table) => {
      const headerMap = readHeaderMap(table);
      table.querySelectorAll("tbody tr, tr, [role='row']").forEach((row) => rows.push({ row, headerMap }));
    });
    root.querySelectorAll("[data-part-number], [class*='part' i], [data-testid*='part' i]").forEach((row) => rows.push({ row, headerMap: {} }));

    const visible = rows.filter(({ row }) => {
      const rect = row.getBoundingClientRect();
      const hasSize = rect.width > 0 && rect.height > 0;
      if (!hasSize) return false;
      return mode !== "visible" || (rect.top < innerHeight && rect.bottom > 0 && rect.left < innerWidth && rect.right > 0);
    });
    return mode === "part" ? visible.slice(0, 1) : visible;
  }

  function collectParts(mode = "page") {
    const parts = [];
    candidateRows(document, mode).forEach(({ row, headerMap }) => {
      const part = extractPartFromRow(row, headerMap);
      if (part) parts.push(part);
    });

    if (!parts.length && mode !== "part") {
      const matches = [...pageText().matchAll(PN_RE)].map((match) => normalizePartNumber(match[1])).filter(Boolean);
      matches.forEach((partNumber) => parts.push({ position: null, itemPosition: null, partNumber, description: partNumber, quantity: 1, imageUrl: extractDiagramImage() }));
    }

    const seen = new Set();
    return parts.filter((part) => {
      if (seen.has(part.partNumber)) return false;
      seen.add(part.partNumber);
      return true;
    });
  }

  function collectSisData(mode = "page") {
    console.log("[SIS] Captura iniciada");
    const parts = collectParts(mode);
    console.log(`[SIS] ${parts.length} peças encontradas`);
    return {
      serialNumber: extractSerialNumber(),
      machineModel: extractMachineModel(),
      model: extractMachineModel(),
      system: extractSystem(),
      subsystem: extractSubsystem(),
      group: extractGroup(),
      url: window.location.href,
      sisUrl: window.location.href,
      imageUrl: extractDiagramImage(),
      capturedAt: new Date().toISOString(),
      parts,
      items: parts.map((part) => ({
        partNumber: part.partNumber,
        description: part.description,
        quantity: part.quantity,
        itemPosition: part.position,
        imageUrl: part.imageUrl,
      })),
    };
  }

  window.collectSisData = collectSisData;

  function toast(message, ok = true) {
    const old = document.getElementById("catc-toast");
    if (old) old.remove();
    const toastEl = document.createElement("div");
    toastEl.id = "catc-toast";
    toastEl.style.borderColor = ok ? "#FFCC00" : "#ff5555";
    toastEl.style.color = ok ? "#FFCC00" : "#ff8888";
    toastEl.textContent = message;
    document.body.appendChild(toastEl);
    setTimeout(() => toastEl.remove(), 3500);
  }

  async function send(payload) {
    const { backendUrl, collectorKey } = await chrome.storage.local.get(["backendUrl", "collectorKey"]);
    if (!backendUrl || !collectorKey) {
      toast("Configure Backend URL e Collector Key no popup.", false);
      return false;
    }
    console.log("[SIS] Enviando para backend");
    const response = await chrome.runtime.sendMessage({ type: "catc:send", backendUrl, collectorKey, payload });
    if (response?.ok) {
      console.log("[SIS] Captura salva");
      toast(`Captura salva: ${payload.parts.length} peça(s).`);
      return true;
    }
    toast(response?.error || "Falha ao enviar captura.", false);
    return false;
  }

  async function captureAndSend(mode) {
    const payload = collectSisData(mode);
    if (!payload.parts.length) {
      toast("Nenhuma peça encontrada.", false);
      return;
    }
    await chrome.storage.local.set({ lastCapture: payload });
    await send(payload);
    refreshPanel();
  }

  function refreshPanel() {
    const panel = document.getElementById(PANEL_ID);
    const meta = panel?.querySelector("#catc-meta");
    if (!meta) return;
    const data = collectSisData("visible");
    meta.innerHTML =
      `<b>Serial:</b> ${data.serialNumber || "—"}<br>` +
      `<b>Modelo:</b> ${data.machineModel || "—"}<br>` +
      `<b>Sistema:</b> ${data.system || "—"}<br>` +
      `<b>Grupo:</b> ${data.group || "—"}<br>` +
      `<b>Peças visíveis:</b> ${data.parts.length}`;
  }

  function renderPanel() {
    if (!SIS_RE.test(location.href) || document.getElementById(PANEL_ID)) return;
    const panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.innerHTML = `
      <header>🐈 CAT Collector</header>
      <div class="catc-body">
        <button id="catc-btn-page">Capturar página</button>
        <button id="catc-btn-part" class="ghost">Capturar peça</button>
        <button id="catc-btn-visible" class="ghost">Capturar tudo visível</button>
        <div class="catc-meta" id="catc-meta">Detectando...</div>
      </div>`;
    document.body.appendChild(panel);
    panel.querySelector("#catc-btn-page").addEventListener("click", () => captureAndSend("page"));
    panel.querySelector("#catc-btn-part").addEventListener("click", () => captureAndSend("part"));
    panel.querySelector("#catc-btn-visible").addEventListener("click", () => captureAndSend("visible"));
    refreshPanel();
    new MutationObserver(() => window.requestAnimationFrame(refreshPanel)).observe(document.body, { childList: true, subtree: true });
  }

  if (!window.__catCollectorV12MessageListener) {
    window.__catCollectorV12MessageListener = true;
    chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
      if (request.action === "ping") {
        sendResponse({ ok: true, loaded: true, isSisPage: SIS_RE.test(location.href), url: location.href });
        return true;
      }
      if (request.action === "capture") {
        try {
          const data = collectSisData(request.mode || "page");
          sendResponse({ ok: true, data });
        } catch (e) {
          sendResponse({ ok: false, error: e.message });
        }
        return true;
      }
      return false;
    });
  }

  renderPanel();
})();
