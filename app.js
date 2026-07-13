/* Live Logistics Dashboard
   Reads Google Sheets through the Google Visualization API.
   The spreadsheet must be published/shared publicly for browser access.
*/

const CONFIG = {
  spreadsheetId: "1M-vZ24Yw4ZN7R7b_473cVn8kny8DznTakSsD3VQsCzc",
  sheetUrl: "https://docs.google.com/spreadsheets/d/1M-vZ24Yw4ZN7R7b_473cVn8kny8DznTakSsD3VQsCzc",
  sheets: {
    outbound: {
      name: "All Outbound Shipping Schedule",
      range: "A3:W7000"
    },
    inbound: {
      name: "INBOUND SHIPMENTS DATA",
      range: "A3:Q1200"
    },
    importSchedule: {
      name: "INBOUND SHIPMENTS DATA",
      range: "U238:AI260"
    }
  }
};

const SOURCE_CLASSES = {
  "WH TRUCKING": "source-WH-TRUCKING",
  "B2B/E-COM": "source-B2B-E-COM",
  "IHERB": "source-IHERB",
  "TRANSFERS": "source-TRANSFERS",
  "ULTA": "source-ULTA",
  "IMPORTS": "source-IMPORTS"
};

const OUTBOUND_COLUMNS = [
  "SOURCE",
  "CUSTOMER",
  "INVOICE NO.",
  "SHIP DATE",
  "Q'ty (Plts / Ctns)",
  "CARRIER",
  "RATE",
  "PRO#",
  "STATUS"
];

const INBOUND_COLUMNS = [
  "Carrier Type",
  "Shipment #",
  "Invoice",
  "MBL",
  "HBL",
  "Container",
  "ETA",
  "LFD",
  "Delivery Expected",
  "Reserved / Broker",
  "Inbound Status"
];

let outboundRows = [];
let inboundRows = [];
let importScheduleRows = [];

const $ = (id) => document.getElementById(id);

document.addEventListener("DOMContentLoaded", () => {
  $("sheetLink").href = CONFIG.sheetUrl;
  wireEvents();
  refreshAll();
});

function wireEvents() {
  $("refreshBtn").addEventListener("click", refreshAll);
  ["outboundSearch", "sourceFilter", "statusFilter"].forEach(id => {
    $(id).addEventListener("input", renderOutbound);
    $(id).addEventListener("change", renderOutbound);
  });
  ["inboundSearch", "carrierTypeFilter", "inboundStatusFilter"].forEach(id => {
    $(id).addEventListener("input", renderInbound);
    $(id).addEventListener("change", renderInbound);
  });
}

async function refreshAll() {
  setConnection("loading", "Loading live Google Sheets data…");
  try {
    const [outbound, inbound, importSchedule] = await Promise.all([
      fetchSheet(CONFIG.sheets.outbound.name, CONFIG.sheets.outbound.range),
      fetchSheet(CONFIG.sheets.inbound.name, CONFIG.sheets.inbound.range),
      fetchSheet(CONFIG.sheets.importSchedule.name, CONFIG.sheets.importSchedule.range)
    ]);

    outboundRows = outbound.filter(row => hasAnyValue(row) && row["SOURCE"] && row["SOURCE"] !== "SOURCE");
    inboundRows = inbound
      .filter(isInboundDataRow)
      .map(normalizeInboundRow);
    importScheduleRows = importSchedule.filter(row => hasAnyValue(row) && !containsSheetError(row));

    populateFilters();
    renderKPIs();
    renderSourceLegend();
    renderTimeline();
    renderOutboundTimeline();
    renderImportSchedule();
    renderOutbound();
    renderInbound();

    $("lastUpdated").textContent = `Last updated: ${new Date().toLocaleString()}`;
    $("setupNotice").classList.add("hidden");
    setConnection("good", "Live data loaded from Google Sheets.");
  } catch (error) {
    console.error(error);
    $("setupNotice").classList.remove("hidden");
    setConnection("bad", "Could not load live sheet data. Check public sharing / Publish to web settings.");
  }
}

async function fetchSheet(sheetName, range) {
  const url = new URL(`https://docs.google.com/spreadsheets/d/${CONFIG.spreadsheetId}/gviz/tq`);
  url.searchParams.set("tqx", "out:json");
  url.searchParams.set("sheet", sheetName);
  url.searchParams.set("range", range);

  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) throw new Error(`Google Sheets request failed: ${res.status}`);
  const text = await res.text();
  const json = parseGviz(text);
  return tableToObjects(json.table);
}

function parseGviz(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < 0) {
    throw new Error("Unexpected Google Visualization response.");
  }
  return JSON.parse(text.slice(start, end + 1));
}

function tableToObjects(table) {
  const headers = table.cols.map((col, index) => (col.label || `Column ${index + 1}`).trim());
  return table.rows.map(row => {
    const obj = {};
    headers.forEach((header, index) => {
      const cell = row.c[index];
      obj[header] = normalizeCell(cell);
    });
    return obj;
  });
}

function normalizeCell(cell) {
  if (!cell) return "";
  if (cell.f !== undefined && cell.f !== null) return String(cell.f).trim();
  if (cell.v !== undefined && cell.v !== null) return String(cell.v).trim();
  return "";
}

function hasAnyValue(row) {
  return Object.values(row).some(v => String(v || "").trim() !== "");
}

function isInboundDataRow(row) {
  if (!hasAnyValue(row)) return false;
  if (containsSheetError(row)) return false;

  const type = norm(row["Carrier Type"]);
  const shipment = norm(row["Shipment #"]);

  if (type === "CARRIER TYPE" || shipment === "SHIPMENT #") return false;
  if (type === "SCHEDULE" || shipment.includes("TWO-WEEK ETA SCHEDULE")) return false;

  return [
    "Shipment #",
    "Invoice",
    "MBL",
    "HBL",
    "Container",
    "ETA",
    "LFD",
    "Delivery Expected",
    "Reserved / Broker",
    "Inbound Status"
  ].some(col => String(row[col] || "").trim() !== "");
}

function containsSheetError(row) {
  return Object.values(row).some(value => /^#(REF|VALUE|N\/A|ERROR|DIV\/0|NAME|NUM)!?$/i.test(String(value || "").trim()));
}

function normalizeInboundRow(row) {
  const next = { ...row };
  if (!next["Shipment #"]) {
    next["Shipment #"] = next["Container"] || next["HBL"] || next["MBL"] || next["Invoice"] || "";
  }
  return next;
}

function setConnection(kind, text) {
  const dot = $("connectionDot");
  dot.className = "status-dot";
  if (kind === "good") dot.classList.add("good");
  if (kind === "bad") dot.classList.add("bad");
  $("connectionText").textContent = text;
}

function populateFilters() {
  fillSelect("sourceFilter", unique(outboundRows.map(r => r["SOURCE"])).sort());
  fillSelect("statusFilter", unique(outboundRows.map(r => r["STATUS"] || "Blank")).sort());
  fillSelect("carrierTypeFilter", unique(inboundRows.map(r => r["Carrier Type"])).sort());
  fillSelect("inboundStatusFilter", unique(inboundRows.map(r => r["Inbound Status"] || "Blank")).sort());
}

function fillSelect(id, values) {
  const select = $(id);
  const first = select.options[0];
  select.innerHTML = "";
  select.appendChild(first);
  values.filter(Boolean).forEach(value => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.appendChild(option);
  });
}

function unique(values) {
  return [...new Set(values.map(v => String(v || "").trim()).filter(Boolean))];
}

function renderKPIs() {
  const shipped = outboundRows.filter(row => norm(row["STATUS"]).includes("SHIPPED")).length;
  const activeInbound = inboundRows.filter(row => !norm(row["Inbound Status"]).includes("DELIVERED"));
  const ocean = activeInbound.filter(row => row["Carrier Type"] === "Ocean").length;
  const parcelAir = activeInbound.filter(row => ["UPS", "FedEx", "DHL", "USPS", "Air"].includes(row["Carrier Type"])).length;
  const rateTotal = outboundRows.reduce((sum, row) => sum + parseCurrency(row["RATE"]), 0);

  $("kpiOutbound").textContent = outboundRows.length.toLocaleString();
  $("kpiShipped").textContent = shipped.toLocaleString();
  $("kpiInbound").textContent = activeInbound.length.toLocaleString();
  $("kpiOcean").textContent = ocean.toLocaleString();
  $("kpiParcelAir").textContent = parcelAir.toLocaleString();
  $("kpiRate").textContent = formatCurrency(rateTotal);
}

function renderSourceLegend() {
  const counts = {};
  outboundRows.forEach(row => {
    const source = row["SOURCE"] || "Other";
    counts[source] = (counts[source] || 0) + 1;
  });

  const legend = $("sourceLegend");
  if (!legend) return;
  legend.closest(".panel")?.remove();
  return;
  Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([source, count]) => {
      const chip = document.createElement("span");
      chip.className = `source-chip ${sourceClass(source)}`;
      chip.textContent = `${source}: ${count}`;
      legend.appendChild(chip);
    });
}

function renderTimeline() {
  const timeline = $("inboundTimeline");
  timeline.innerHTML = "";

  const today = new Date();
  const start = startOfDay(today);
  const days = Array.from({ length: 14 }, (_, i) => addDays(start, i));

  days.forEach(day => {
    const matches = inboundRows.filter(row => {
      if (norm(row["Inbound Status"]).includes("DELIVERED")) return false;
      const eta = parseSheetDate(row["ETA"]);
      return eta && isSameDay(eta, day);
    });

    const card = document.createElement("article");
    card.className = "day-card";
    const label = day.toLocaleDateString(undefined, { weekday: "short", month: "numeric", day: "numeric" });
    card.innerHTML = `<strong>${label}</strong>`;

    const list = document.createElement("ul");
    if (!matches.length) {
      const li = document.createElement("li");
      li.className = "cell-muted";
      li.textContent = "No ETA";
      list.appendChild(li);
    } else {
      matches.slice(0, 8).forEach(row => {
        const li = document.createElement("li");
        const item = row["Container"] || row["Shipment #"] || row["HBL"] || row["MBL"] || row["Invoice"] || "Shipment";
        const itemHtml = row["Container"]
          ? formatTrackingLinks(row["Container"], row)
          : escapeHtml(item);
        li.innerHTML = `<span class="type-pill ${typeClass(row["Carrier Type"])}">${escapeHtml(row["Carrier Type"] || "Other")}</span><br>${itemHtml}`;
        list.appendChild(li);
      });
      if (matches.length > 8) {
        const li = document.createElement("li");
        li.className = "cell-muted";
        li.textContent = `+${matches.length - 8} more`;
        list.appendChild(li);
      }
    }
    card.appendChild(list);
    timeline.appendChild(card);
  });
}

function renderOutboundTimeline() {
  const timeline = $("outboundTimeline");
  if (!timeline) return;

  timeline.innerHTML = "";

  const start = startOfDay(new Date());
  const days = Array.from({ length: 14 }, (_, i) => addDays(start, i));

  days.forEach(day => {
    const matches = outboundRows
      .filter(row => {
        if (/\b(SHIPPED|DELIVERED|RECEIVED|COMPLETED)\b/.test(norm(row["STATUS"]))) return false;
        const shipDate = parseSheetDate(row["SHIP DATE"]);
        return shipDate && isSameDay(shipDate, day);
      })
      .sort((a, b) => norm(a["CUSTOMER"]).localeCompare(norm(b["CUSTOMER"])));

    const card = document.createElement("article");
    card.className = "day-card outbound-day-card";
    const label = day.toLocaleDateString(undefined, { weekday: "short", month: "numeric", day: "numeric" });
    card.innerHTML = `<strong>${label}</strong>`;

    const list = document.createElement("ul");
    if (!matches.length) {
      const li = document.createElement("li");
      li.className = "cell-muted";
      li.textContent = "No shipment";
      list.appendChild(li);
    } else {
      matches.slice(0, 8).forEach(row => {
        const li = document.createElement("li");
        const source = row["SOURCE"] || "Other";
        const item = row["CUSTOMER"] || row["INVOICE NO."] || row["PRO#"] || "Shipment";
        const detail = row["INVOICE NO."] && row["INVOICE NO."] !== item
          ? row["INVOICE NO."]
          : (row["PRO#"] && row["PRO#"] !== item ? row["PRO#"] : "");
        li.innerHTML = `<span class="type-pill ${sourceClass(source)}">${escapeHtml(source)}</span><br>${escapeHtml(item)}${detail ? `<br><span class="cell-muted">${escapeHtml(detail)}</span>` : ""}`;
        list.appendChild(li);
      });

      if (matches.length > 8) {
        const li = document.createElement("li");
        li.className = "cell-muted";
        li.textContent = `+${matches.length - 8} more`;
        list.appendChild(li);
      }
    }

    card.appendChild(list);
    timeline.appendChild(card);
  });
}

function renderImportSchedule() {
  const timeline = $("importScheduleTimeline");
  if (!timeline) return;

  const dayColumns = getImportScheduleDayColumns();
  let totalItems = 0;
  timeline.innerHTML = "";

  dayColumns.forEach(day => {
    const items = importScheduleRows
      .flatMap(row => splitScheduleItems(row[day]))
      .filter(Boolean);

    totalItems += items.length;

    const card = document.createElement("article");
    card.className = "day-card import-day-card";
    card.innerHTML = `<strong>${escapeHtml(day)}</strong>`;

    const list = document.createElement("ul");
    if (!items.length) {
      const li = document.createElement("li");
      li.className = "cell-muted";
      li.textContent = "No imports";
      list.appendChild(li);
    } else {
      items.slice(0, 8).forEach(value => {
        const parsed = parseScheduleItem(value);
        const li = document.createElement("li");
        li.innerHTML = `<span class="type-pill ${typeClass(parsed.type)}">${escapeHtml(parsed.type)}</span><br>${escapeHtml(parsed.item)}`;
        list.appendChild(li);
      });
      if (items.length > 8) {
        const li = document.createElement("li");
        li.className = "cell-muted";
        li.textContent = `+${items.length - 8} more`;
        list.appendChild(li);
      }
    }

    card.appendChild(list);
    timeline.appendChild(card);
  });

  $("importScheduleCount").textContent = `${totalItems.toLocaleString()} imports`;
}

function getImportScheduleDayColumns() {
  const firstRow = importScheduleRows[0] || {};
  return Object.keys(firstRow)
    .filter(key => key && key !== "Schedule" && !/^Column\s+\d+$/i.test(key))
    .slice(0, 14);
}

function splitScheduleItems(value) {
  return String(value || "")
    .split(/\n+/)
    .map(item => item.trim())
    .filter(Boolean);
}

function parseScheduleItem(value) {
  const clean = String(value || "").trim();
  const match = clean.match(/^([^:]{2,20}):\s*(.*)$/);
  if (!match) return { type: "Import", item: clean };
  return { type: match[1].trim(), item: match[2].trim() || clean };
}

function renderOutbound() {
  const q = norm($("outboundSearch").value);
  const source = $("sourceFilter").value;
  const status = $("statusFilter").value;

  const rows = outboundRows.filter(row => {
    const matchesQ = !q || norm(Object.values(row).join(" ")).includes(q);
    const matchesSource = !source || row["SOURCE"] === source;
    const rowStatus = row["STATUS"] || "Blank";
    const matchesStatus = !status || rowStatus === status;
    return matchesQ && matchesSource && matchesStatus;
  });

  $("outboundCount").textContent = `${rows.length.toLocaleString()} rows`;
  renderTable("outboundTable", rows, OUTBOUND_COLUMNS, decorateOutboundCell);
}

function renderInbound() {
  const q = norm($("inboundSearch").value);
  const type = $("carrierTypeFilter").value;
  const status = $("inboundStatusFilter").value;

  const rows = inboundRows.filter(row => {
    const matchesQ = !q || norm(Object.values(row).join(" ")).includes(q);
    const matchesType = !type || row["Carrier Type"] === type;
    const rowStatus = row["Inbound Status"] || "Blank";
    const matchesStatus = !status || rowStatus === status;
    return matchesQ && matchesType && matchesStatus;
  });

  $("inboundCount").textContent = `${rows.length.toLocaleString()} rows`;
  renderTable("inboundTable", rows, INBOUND_COLUMNS, decorateInboundCell);
}

function renderTable(tableId, rows, columns, cellDecorator) {
  const table = $(tableId);
  const thead = table.querySelector("thead");
  const tbody = table.querySelector("tbody");

  thead.innerHTML = `<tr>${columns.map(col => `<th>${escapeHtml(col)}</th>`).join("")}</tr>`;
  tbody.innerHTML = "";

  rows.slice(0, 1000).forEach(row => {
    const tr = document.createElement("tr");
    columns.forEach(col => {
      const td = document.createElement("td");
      td.innerHTML = cellDecorator(col, row[col] || "", row);
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });

  if (rows.length > 1000) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = columns.length;
    td.className = "cell-muted";
    td.textContent = `Showing first 1,000 of ${rows.length.toLocaleString()} filtered rows. Narrow the search to see more.`;
    tr.appendChild(td);
    tbody.appendChild(tr);
  }
}

function decorateOutboundCell(col, value, row) {
  if (col === "SOURCE") {
    return `<span class="source-chip ${sourceClass(value)}">${escapeHtml(value || "Other")}</span>`;
  }
  if (col === "STATUS") {
    return statusPill(value);
  }
  return escapeHtml(value);
}

function decorateInboundCell(col, value, row) {
  if (col === "Carrier Type") {
    return `<span class="type-pill ${typeClass(value)}">${escapeHtml(value || "Other")}</span>`;
  }
  if (col === "Container") {
    return formatTrackingLinks(value, row);
  }
  if (col === "Inbound Status") {
    return statusPill(value);
  }
  return escapeHtml(value);
}

function formatTrackingLinks(value, row) {
  const text = String(value || "").trim();
  if (!text) return "";

  return text
    .split(/\n+/)
    .map(item => item.trim())
    .filter(Boolean)
    .map(item => {
      const url = getTrackingUrl(item, row);
      if (!url) return escapeHtml(item);
      return `<a class="tracking-link" href="${escapeAttribute(url)}" target="_blank" rel="noreferrer">${escapeHtml(item)}</a>`;
    })
    .join("<br>");
}

function getTrackingUrl(container, row) {
  const cleanContainer = String(container || "").trim();
  if (!cleanContainer) return "";

  const upperContainer = cleanContainer.toUpperCase();
  const carrierKey = [
    row["Carrier Type"],
    row["Shipment #"],
    row["MBL"],
    row["HBL"],
    row["VSL"]
  ].map(value => String(value || "")).join(" ").toUpperCase();
  const upsMatch = cleanContainer.match(/\b1Z[A-Z0-9]+\b/i);
  const uspsMatch = cleanContainer.match(/\b(?:94|92|93)\d{8,}\b/i);
  const dhlMatch = cleanContainer.match(/\b(?:JJD[A-Z0-9]+|JD[A-Z0-9]+|DHL[A-Z0-9]+)\b/i);
  const encoded = encodeURIComponent(cleanContainer);

  if (/^1Z/.test(upperContainer) || upsMatch) {
    return `https://www.ups.com/track?loc=en_US&tracknum=${encodeURIComponent(upsMatch?.[0] || cleanContainer)}`;
  }
  if (/^(94|92|93|USPS)/.test(upperContainer) || uspsMatch) {
    return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encodeURIComponent(uspsMatch?.[0] || cleanContainer)}`;
  }
  if (/^(JD|JJD|DHL)/.test(upperContainer) || dhlMatch) {
    return `https://www.dhl.com/us-en/home/tracking/tracking-express.html?submit=1&tracking-id=${encodeURIComponent(dhlMatch?.[0] || cleanContainer)}`;
  }
  if (/FEDEX|FDX/.test(carrierKey)) {
    return `https://www.fedex.com/fedextrack/?trknbr=${encoded}`;
  }
  if (/SMLM|SM /.test(carrierKey)) {
    return `https://esvc.smlines.com/smline/CUP_HOM_3301GS.do?_search=false&f_cmd=121&page=1&rows=10000&search_name=${encoded}&search_type=C&sidx=&sord=asc`;
  }
  if (/HDMU|(^| )HMM( |$)/.test(carrierKey)) {
    return "https://www.hmm21.com/e-service/general/trackNTrace/TrackNTrace.do";
  }
  if (/MAEU|MAERSK| MRSU| MSKU/.test(`${carrierKey} ${upperContainer}`)) {
    return `https://www.maersk.com/tracking/${encoded}`;
  }
  if (/KORP|KMTC| KMTU/.test(`${carrierKey} ${upperContainer}`)) {
    return "https://www.ekmtc.com/index.html";
  }
  if (/(^| )ONE( |$)|PUSM/.test(carrierKey)) {
    return `https://ecomm.one-line.com/one-ecom/manage-shipment/cargo-tracking?ctrack-field=${encoded}&trakNoParam=${encoded}`;
  }

  return "";
}

function sourceClass(source) {
  const key = String(source || "OTHER").trim().toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "");
  return SOURCE_CLASSES[source] || `source-${key}` || "source-OTHER";
}

function typeClass(type) {
  const key = String(type || "Other").replace(/[^A-Za-z0-9]+/g, "");
  return `type-${key || "Other"}`;
}

function statusPill(value) {
  const clean = value || "Blank";
  const n = norm(clean);
  let cls = "";
  if (n.includes("DELIVERED") || n.includes("SHIPPED")) cls = "status-Delivered";
  else if (n.includes("READY")) cls = "status-Ready";
  else if (n.includes("PENDING") || n.includes("CUSTOMS")) cls = "status-Pending";
  else if (n.includes("DELAY") || n.includes("HOLD") || n.includes("FDA") || n.includes("FWS")) cls = "status-Delayed";
  return `<span class="status-pill ${cls}">${escapeHtml(clean)}</span>`;
}

function parseCurrency(value) {
  const n = Number(String(value || "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function formatCurrency(value) {
  return value.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function norm(value) {
  return String(value || "").toUpperCase().trim();
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;")
    .replaceAll("\n", "<br>");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

function parseSheetDate(value) {
  if (!value) return null;
  const text = String(value).trim();

  // Match common sheet date strings like 07/18, 07/18/2026, 7/18
  const m = text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (m) {
    const month = Number(m[1]) - 1;
    const day = Number(m[2]);
    let year = m[3] ? Number(m[3]) : new Date().getFullYear();
    if (year < 100) year += 2000;
    return new Date(year, month, day);
  }

  const d = new Date(text);
  return Number.isNaN(d.getTime()) ? null : startOfDay(d);
}
