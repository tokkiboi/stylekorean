/* ═══════════════════════════════════════════════════════════════
   StyleKorean Logistics Hub — consolidated application script.
   Replaces the previous app.js + kpi-sync.js + source-sync.js +
   all-rows-fix.js + all-sources-sync.js layering with one file.

   Imports ALL operational sources in LOGISTICS MASTER 2026:
     IMPORTS · TRANSFERS · ULTA · IHERB · B2B/E-COM TRUCKING ·
     WH Trucking Request · NATIONAL ORDER PROGRESS ·
     NATIONAL SHIP OUT SCHEDULE · TJX/ROSS DIMENSION ·
     OUTBOUND WEBSITE EXCLUSIONS · All Outbound KPI block (Z1:AA5)

   Never imported: loginfo (credentials), dimension reference tabs.
   ═══════════════════════════════════════════════════════════════ */
"use strict";

/* ---------- constants & state ---------- */
const SHEET_ID = "1M-vZ24Yw4ZN7R7b_473cVn8kny8DznTakSsD3VQsCzc";
const FINISHED = new Set(["Delivered", "Received", "Completed", "Cancelled"]);
const PARCEL_SECTIONS = /^(UPS|USPS|DHL|AMAZON|FEDEX)$/i;
const PLANNING_LABELS = /^(URGENT|SCHEDULED|NEED SCHEDULING|COMPLETED)$/i;
const AUTO_REFRESH_MS = 10 * 60 * 1000;
const COMPLETE_ENDPOINT = String(globalThis.STYLEKOREAN_CONFIG?.completeEndpoint || "").trim();

const SOURCES = [
  { tab: "IMPORTS",                    range: "A:AD", kind: "inbound",  gid: 1497250700 },
  { tab: "TRANSFERS",                  range: "A:N",  kind: "outbound", gid: 1834454901 },
  { tab: "ULTA",                       range: "A:N",  kind: "outbound", gid: 360479919 },
  { tab: "IHERB",                      range: "A:M",  kind: "outbound", gid: 955532469 },
  { tab: "B2B/E-COM TRUCKING",         range: "A:R",  kind: "outbound", gid: 1971553563 },
  { tab: "WH Trucking Request",        range: "A2:U", kind: "outbound", gid: 852802817 },
  { tab: "NATIONAL ORDER PROGRESS",    range: "A:U",  kind: "outbound", gid: 2026071601 },
  { tab: "NATIONAL SHIP OUT SCHEDULE", range: "A:K",  kind: "outbound", gid: 20260708 },
  { tab: "TJX/ROSS DIMENSION",         range: "A:R",  kind: "outbound", gid: 1110009873 },
  { tab: "OUTBOUND WEBSITE EXCLUSIONS", range: "A:C", kind: "filter",  gid: 2026071701 }
];
const KPI_SOURCE = { tab: "All Outbound Shipping Schedule", range: "Z1:AA5", kind: "kpi", gid: 20260708 };

const SOURCE_COLORS = {
  "WH Trucking Request": "var(--c-wh)",
  "B2B/E-com Trucking": "var(--c-b2b)",
  "Transfers": "var(--c-transfers)",
  "Ulta": "var(--c-ulta)",
  "iHerb": "var(--c-iherb)",
  "National Order Progress": "var(--c-national-order)",
  "National Ship Out": "var(--c-ship-out)",
  "TJX/ROSS": "var(--c-tjx)"
};

let inboundRows = [];
let outboundRows = [];         /* includes finished rows; filtered at render */
let parcelRows = [];
let sourceHealth = [];         /* [{tab, ok, rows}] */
let costSummary = { ytd: 0, mtd: 0, finished: 0, kpiSource: "computed" };
let loading = false;

/* ---------- tiny DOM / text helpers ---------- */
const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
));
const clean = (v) => String(v ?? "").trim();
const useful = (r) => Object.values(r).some(Boolean);

/* exact-name column getter (headers already normalized by objects()) */
function col(row, ...names) {
  for (const n of names) {
    const v = row[n.toUpperCase()];
    if (v) return v;
  }
  return "";
}
/* tolerant getter for tabs with messy headers (line breaks, trailing spaces,
   parentheticals — e.g. TJX/ROSS DIMENSION's "PO# ", "Alt.\nPU#\n(eg.NRT#)") */
function colLoose(row, ...names) {
  const wanted = names.map((n) => String(n).toUpperCase().replace(/[^A-Z0-9#]/g, ""));
  for (const key of Object.keys(row)) {
    const nk = key.toUpperCase().replace(/[^A-Z0-9#]/g, "");
    if (wanted.includes(nk) && row[key]) return row[key];
  }
  return "";
}

/* ---------- Google Sheets (gviz) fetch layer ---------- */
function parseGviz(text) {
  const a = text.indexOf("{");
  const b = text.lastIndexOf("}");
  if (a < 0 || b < 0) throw Error("Google Sheets did not return data");
  return JSON.parse(text.slice(a, b + 1)).table;
}

async function fetchTable(tab, range, withHeaders = true) {
  const u = new URL(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq`);
  u.searchParams.set("tqx", "out:json");
  u.searchParams.set("headers", withHeaders ? "1" : "0");
  u.searchParams.set("sheet", tab);
  if (range) u.searchParams.set("range", range);
  /* FIX: without a timeout, one hung request left `loading` stuck true
     and killed every future auto-refresh. */
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 20000);
  try {
    const r = await fetch(u, { cache: "no-store", signal: ctl.signal });
    if (!r.ok) throw Error(`${tab}: HTTP ${r.status}`);
    return parseGviz(await r.text());
  } catch (e) {
    throw e.name === "AbortError" ? Error(`${tab}: timed out (20s)`) : e;
  } finally {
    clearTimeout(timer);
  }
}

function objects(table) {
  const headers = table.cols.map((c, i) =>
    (c.label || `COL_${i}`).toUpperCase().replace(/\s+/g, " ").trim()
  );
  return table.rows.map((r) => Object.fromEntries(
    headers.map((h, i) => {
      const c = r.c?.[i];
      return [h, c ? clean(c.f ?? c.v ?? "") : ""];
    })
  ));
}
const rawCell = (row, i) => {
  const c = row.c?.[i];
  return c ? clean(c.f ?? c.v ?? "") : "";
};

/* ---------- parsing helpers ---------- */
/* FIX: the previous date parser hard-coded "month >= 9 → 2025, else 2026".
   When the year is missing we now pick whichever candidate year lands the
   date closest to today, so the board keeps working in any year.
   Memoized — the same date strings are parsed thousands of times across
   boards, sorting, and consolidation. */
const dateCache = new Map();
function parseDate(v) {
  const s = clean(v);
  if (dateCache.has(s)) return dateCache.get(s);
  const d = computeDate(s);
  dateCache.set(s, d);
  return d;
}
function computeDate(s) {
  let m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) {
    let y = +m[3];
    if (y < 100) y += 2000;
    const month = +m[1], day = +m[2];
    const d = new Date(y, month - 1, day);
    return d.getFullYear() === y && d.getMonth() === month - 1 && d.getDate() === day ? d : null;
  }
  m = s.match(/(\d{1,2})\/(\d{1,2})/);
  if (!m) return null;
  const now = Date.now();
  return [-1, 0, 1]
    .map((off) => new Date(new Date().getFullYear() + off, +m[1] - 1, +m[2]))
    .reduce((a, b) => (Math.abs(b - now) < Math.abs(a - now) ? b : a));
}
function fmtDate(v) {
  const d = parseDate(v);
  if (!d) return clean(v);
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${String(d.getFullYear()).slice(-2)}`;
}
function lastDateIn(v) {
  const all = [...clean(v).matchAll(/\d{1,2}\/\d{1,2}(?:\/\d{2,4})?/g)];
  return all.length ? fmtDate(all.at(-1)[0]) : "";
}
function money(v) {
  const m = clean(v).replace(/,/g, "").match(/-?\d+(?:\.\d+)?/g);
  return m ? m.reduce((s, n) => s + Number(n), 0) : 0;
}
function classifyStatus(v) {
  v = String(v || "").toLowerCase();
  if (/cancel/.test(v)) return "Cancelled";
  if (/\bshipped\b|\bdone\b|complete|closed|gr[ae]y(?:ed)?\s*out/.test(v)) return "Completed";
  if (/deliver/.test(v)) return "Delivered";
  if (/receive/.test(v)) return "Received";
  if (/shipping|transit|progress/.test(v)) return "Shipping";
  return "Scheduled";
}
function effectiveStatus(row, mappedStatus = "Scheduled") {
  const detected = classifyStatus(Object.values(row || {}).join(" "));
  return FINISHED.has(detected) ? detected : mappedStatus;
}
function containerNumbers(v) {
  return clean(v).split(/[,\n]+/)
    .map((p) => p.trim().replace(/\s/g, "").toUpperCase())
    .filter((p) => /^[A-Z]{4}\d{7}$/.test(p));
}
function looksLikeParcelTracking(raw) {
  const n = clean(raw).replace(/\s/g, "").toUpperCase();
  return /^1Z[0-9A-Z]{16}$/.test(n) || /^TBA[0-9A-Z]+$/.test(n) ||
    /^(94|93|92|95)\d{18,22}$/.test(n) || /^[A-Z]{2}\d{9}US$/.test(n) ||
    /^\d{10}$/.test(n) || /^(?:\d{12}|\d{15}|\d{20}|\d{22})$/.test(n);
}
function parcelTrackingUrl(carrier, num) {
  const n = encodeURIComponent(num);
  switch (carrier) {
    case "UPS":   return `https://www.ups.com/track?tracknum=${n}`;
    case "FedEx": return `https://www.fedex.com/fedextrack/?trknbr=${n}`;
    case "USPS":  return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${n}`;
    case "DHL":   return `https://www.dhl.com/us-en/home/tracking.html?tracking-id=${n}`;
    case "Amazon": return `https://track.amazon.com/tracking/${n}`;
    default:      return "";
  }
}
function inferParcelCarrier(sectionCarrier, tracking) {
  const n = clean(tracking).replace(/\s/g, "").toUpperCase();
  if (/^1Z[0-9A-Z]{16}$/.test(n)) return "UPS";
  if (/^TBA[0-9A-Z]+$/.test(n)) return "Amazon";
  if (/^(94|93|92|95)\d{18,22}$/.test(n) || /^[A-Z]{2}\d{9}US$/.test(n)) return "USPS";
  if (/^\d{10}$/.test(n)) return "DHL";
  if (/^(?:\d{12}|\d{15}|\d{20}|\d{22})$/.test(n)) return /^DHL$/i.test(sectionCarrier) ? "DHL" : "FedEx";
  if (/^FEDEX$/i.test(sectionCarrier)) return "FedEx";
  if (/^(UPS|USPS|DHL)$/i.test(sectionCarrier)) return sectionCarrier.toUpperCase();
  if (/^AMAZON$/i.test(sectionCarrier)) return "Amazon";
  return sectionCarrier;
}

/* ---------- inbound: IMPORTS tab ---------- */
function isInboundShipment(r) {
  const shipment = col(r, "SHIPMENT");
  const invoice = col(r, "INVOICE");
  const container = col(r, "CONTAINER", "CONTAINER RAW (SYSTEM)");
  const mbl = col(r, "MBL").replace(/\s/g, "");
  const rowText = Object.values(r).join(" ");
  const hasInvoice = /\bIN\d{4,}\b/i.test(invoice);
  const hasCleanContainer = containerNumbers(container).length > 0;
  const hasAirWaybill = /^\d{3}-?\d{8}$/.test(mbl);
  const isPlanningRow = PLANNING_LABELS.test(shipment.trim()) ||
    (!hasInvoice && !hasCleanContainer && !hasAirWaybill && /-\s*20\d\d\b/.test(rowText));
  const hasParcelTracking = Object.values(r).some(looksLikeParcelTracking);
  const sectionLabel = Object.values(r).find((v) => PARCEL_SECTIONS.test(clean(v)));
  const hasShipmentIdentifier = !/^NEW$/i.test(shipment.trim()) &&
    (hasInvoice || hasCleanContainer || hasAirWaybill);
  return useful(r) && hasShipmentIdentifier && !hasParcelTracking && !sectionLabel && !isPlanningRow;
}

function mapInbound(rows) {
  return rows.filter(isInboundShipment).map((r) => {
    const containerRaw = col(r, "CONTAINER", "CONTAINER RAW (SYSTEM)");
    const container = containerNumbers(containerRaw)[0] || containerRaw.split(/[,\n]/)[0].trim();
    const mbl = col(r, "MBL");
    const isAir = !container && /^\d{3}-?\d{8}$/.test(mbl.replace(/\s/g, ""));
    return {
      mode: isAir ? "Air" : "Ocean",
      eta: fmtDate(col(r, "ETA")),
      shipmentNo: col(r, "SHIPMENT"),
      mbl,
      hbl: col(r, "HBL"),
      container,
      carrier: col(r, "CARRIER", "LINE", "FORWARDER") || (isAir ? "Air freight" : "Ocean freight"),
      trackingUrl: container ? `https://www.searates.com/container/tracking/?container=${encodeURIComponent(container)}` : "",
      origin: col(r, "VSL") || "Korea / Asia",
      destination: col(r, "DESTINATION", "POD", "PORT", "DELIVERY") || "LA / Long Beach",
      status: effectiveStatus(r, classifyStatus(`${col(r, "NOTES")} ${col(r, "RESERVED")} ${col(r, "DELIVERY EXPECTED")}`))
    };
  });
}

function planningDate(value) {
  const match = clean(value).match(/(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?/);
  if (!match) return "";
  return fmtDate(`${match[1]}/${match[2]}${match[3] ? "/" + match[3] : ""}`);
}

/* IMPORTS contains a calendar-style planning grid below the detailed shipment
   table. Its cells are operational schedule sources, not ordinary table rows,
   so scan the raw grid and merge the planned dates back into inbound records. */
function mapInboundPlanningGrid(table) {
  const rows = table.rows || [];
  const marker = rows.findIndex((row) =>
    /^URGENT$/i.test(rawCell(row, 0)) &&
    /^COMPLETED$/i.test(rawCell(row, 1)) &&
    /ESTIMATED\s*\/\s*CHANGED/i.test(rawCell(row, 2))
  );
  if (marker < 0) return [];

  const topDates = new Map();
  const topDateRow = rows[marker + 1];
  (topDateRow?.c || []).forEach((_, column) => {
    const date = planningDate(rawCell(topDateRow, column));
    if (date) topDates.set(column, date);
  });

  const sectionHeaders = new Map();
  (rows[marker]?.c || []).forEach((_, column) => {
    const value = rawCell(rows[marker], column).toUpperCase();
    if (value) sectionHeaders.set(column, value);
  });

  let phase = "";
  const phaseDates = new Map();
  const planned = [];
  for (let rowIndex = marker + 2; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex];
    const first = rawCell(row, 0).toUpperCase();
    if (PARCEL_SECTIONS.test(first)) break;
    if (first === "SCHEDULED") phase = "scheduled";
    if (first === "NEED SCHEDULING") {
      phase = "needs-scheduling";
      (row.c || []).forEach((_, column) => {
        const date = planningDate(rawCell(row, column));
        if (date) phaseDates.set(column, date);
      });
    }
    if (!phase) continue;

    (row.c || []).forEach((_, column) => {
      const value = rawCell(row, column);
      const container = clean(value).toUpperCase().match(/\b[A-Z]{4}\d{7}\b/)?.[0] || "";
      if (!container) return;
      const shipmentNo = value
        .replace(new RegExp(`\\s*-?\\s*${container}\\s*$`, "i"), "")
        .replace(/\s*-\s*$/, "")
        .trim();
      const eta = (phase === "needs-scheduling" ? phaseDates.get(column) : "") || topDates.get(column) || "";
      const completed = phase === "scheduled" && /COMPLETED/.test(sectionHeaders.get(column) || "");
      planned.push({
        mode: "Ocean",
        eta,
        shipmentNo: shipmentNo || container,
        mbl: "",
        hbl: "",
        container,
        carrier: "Ocean freight",
        trackingUrl: `https://www.searates.com/container/tracking/?container=${encodeURIComponent(container)}`,
        origin: "IMPORTS planning grid",
        destination: "LA / Long Beach",
        status: completed ? "Completed" : "Scheduled"
      });
    });
  }
  return planned;
}

function mergeInboundPlanning(detailed, planned) {
  const merged = detailed.map((row) => ({ ...row }));
  const byContainer = new Map(merged.map((row, index) => [clean(row.container).toUpperCase(), index]));
  planned.forEach((plan) => {
    const key = clean(plan.container).toUpperCase();
    const index = byContainer.get(key);
    if (index == null) {
      byContainer.set(key, merged.length);
      merged.push(plan);
      return;
    }
    const current = merged[index];
    merged[index] = {
      ...current,
      eta: plan.eta || current.eta,
      shipmentNo: current.shipmentNo || plan.shipmentNo,
      status: FINISHED.has(plan.status) ? plan.status : current.status,
      origin: [current.origin, "IMPORTS planning grid"].filter(Boolean).join(" · ")
    };
  });
  return merged;
}

function mapParcels(table) {
  let section = "";
  const result = [];
  for (const row of table.rows || []) {
    const label = rawCell(row, 0);
    if (PARCEL_SECTIONS.test(label)) section = label.toUpperCase();
    const num = rawCell(row, 1).replace(/^TRACKING#$/i, "").trim();
    if (!num || /^TRACK/i.test(num) || !looksLikeParcelTracking(num)) continue;
    const carrier = inferParcelCarrier(section, num);
    if (!carrier) continue;
    const detail = rawCell(row, 4);
    const rowText = (row.c || []).map((_, i) => rawCell(row, i)).join(" ");
    let status = classifyStatus(rowText);
    if (/label created|not shipped/i.test(detail)) status = "Scheduled";
    else if (!FINISHED.has(status) && /pending|clearance|customs|waiting|transit/i.test(rowText)) status = "Shipping";
    result.push({
      carrier,
      tracking: num,
      invoice: rawCell(row, 2),
      origin: rawCell(row, 3) || "Imports",
      eta: lastDateIn(detail),
      note: detail.replace(/\s+/g, " ").trim() || "No carrier tracking note yet",
      url: parcelTrackingUrl(carrier, num),
      status
    });
  }
  return result;
}

function activeParcels() {
  return parcelRows.filter((row) => !FINISHED.has(row.status));
}

/* ---------- outbound mappers (one per source tab) ---------- */
function pushOutbound(source, r, mapped, excludedFn) {
  const key = mapped.pro || mapped.invoice || "";
  if (excludedFn(source, key)) return;
  const shipDate = fmtDate(mapped.shipDate);
  const rowStatus = effectiveStatus(r, mapped.status);
  outboundRows.push({
    source,
    sourceTab: ({
      "Transfers": "TRANSFERS", "Ulta": "ULTA", "iHerb": "IHERB",
      "B2B/E-com Trucking": "B2B/E-COM TRUCKING", "WH Trucking Request": "WH Trucking Request",
      "National Order Progress": "NATIONAL ORDER PROGRESS", "TJX/ROSS": "TJX/ROSS"
    })[source] || "",
    shipDate,
    customer: clean(mapped.customer),
    invoice: clean(mapped.invoice),
    origin: clean(mapped.origin || ""),
    carrier: clean(mapped.carrier),
    pro: clean(mapped.pro),
    units: clean(mapped.units),
    qty: col(r, "Q'TY (PLTS / CTNS)", "QTY"),
    length: col(r, "LENGTH (IN)"),
    width: col(r, "WIDTH (IN)"),
    height: col(r, "HEIGHT (IN)", "HEIGHT"),
    weight: col(r, "WEIGHT (LBS)", "WEIGHT"),
    destination: clean(mapped.destination || ""),
    rate: (() => {
      for (const n of ["INVOICE AMOUNT", "RATE QUOTE AMOUNT", "RATE QUOTE", "QUOTE AMOUNT", "QUOTE", "RATE"]) {
        const v = col(r, n);
        if (v) return money(v);
      }
      const inv = col(r, "INVOICE");
      return inv.includes("$") ? money(inv) : 0;
    })(),
    status: rowStatus
  });
}

function mapAllOutbound(tabs, excludedFn) {
  const { tr, ul, ih, b2, wh, national, shipOut, tjxRoss } = tabs;
  outboundRows = [];

  tr.filter(useful).forEach((r) => pushOutbound("Transfers", r, {
    shipDate: col(r, "PU"),
    customer: col(r, "TO"),
    invoice: col(r, "INVOICE"),
    origin: col(r, "VENDOR/SUPPLIER/ORIGIN", "VENDOR / SUPPLIER / ORIGIN", "VENDOR", "SUPPLIER", "ORIGIN"),
    carrier: col(r, "TRUCKING"),
    pro: col(r, "BOL#"),
    units: col(r, "PLT") ? `${col(r, "PLT")} Pallets` : "",
    destination: col(r, "TO"),
    status: classifyStatus(`${col(r, "STATUS")} ${col(r, "NOTE")} ${col(r, "INVOICE")}`)
  }, excludedFn));

  ul.filter(useful).forEach((r) => pushOutbound("Ulta", r, {
    shipDate: col(r, "SHIP DATE", "DATE"),
    customer: col(r, "DC") || "Ulta",
    invoice: col(r, "PO#", "INVOICE"),
    carrier: col(r, "TRUCKING"),
    pro: col(r, "PRO#"),
    units: col(r, "TOTAL CARTONS") ? `${col(r, "TOTAL CARTONS")} Cartons` : "",
    destination: col(r, "SHIP TO"),
    status: col(r, "PRO#") ? "Completed"
      : classifyStatus(`${col(r, "STATUS")} ${col(r, "NOTE")} ${col(r, "REMARKS")}`)
  }, excludedFn));

  ih.filter(useful).forEach((r) => pushOutbound("iHerb", r, {
    shipDate: col(r, "PU", "DELIVERY APPT"),
    customer: `iHerb${col(r, "TO") ? " · " + col(r, "TO") : ""}`,
    invoice: col(r, "PO#"),
    carrier: col(r, "TRUCKING"),
    pro: col(r, "BOL"),
    units: col(r, "QTY") ? `${col(r, "QTY")} Pallets` : "",
    destination: col(r, "TO"),
    status: classifyStatus(`${col(r, "STATUS")} ${col(r, "NOTE")} ${col(r, "REMARKS")}`)
  }, excludedFn));

  b2.filter((r) =>
    ["INVOICE", "PU", "TRUCKING", "PRO#", "PLT", "QTY", "RATE"].some((n) => col(r, n))
  ).forEach((r) => pushOutbound("B2B/E-com Trucking", r, {
    shipDate: col(r, "PU"),
    customer: col(r, "NOTE"),
    invoice: col(r, "INVOICE"),
    carrier: col(r, "TRUCKING"),
    pro: col(r, "PRO#"),
    units: col(r, "PLT") ? `${col(r, "PLT")} Pallets` : "",
    destination: col(r, "TO"),
    status: classifyStatus(Object.values(r).join(" "))
  }, excludedFn));

  wh.filter((r) =>
    !/PLEASE LIST THE INVOICE WITH SHIPPING CHARGE/i.test(col(r, "CUSTOMER")) &&
    (col(r, "CUSTOMER") || col(r, "INVOICE NO.")) &&
    ["CUSTOMER", "INVOICE NO.", "SHIP DATE", "PALLET TYPE", "CARRIER", "PRO#"].some((n) => col(r, n))
  ).forEach((r) => pushOutbound("WH Trucking Request", r, {
    shipDate: col(r, "SHIP DATE"),
    customer: col(r, "CUSTOMER"),
    invoice: col(r, "INVOICE NO."),
    carrier: col(r, "CARRIER"),
    pro: col(r, "PRO#"),
    units: col(r, "PALLET TYPE") ? "Pallets" : "",
    destination: col(r, "ADDRESS"),
    status: classifyStatus(`${col(r, "STATUS")} ${col(r, "NOTE")} ${col(r, "REMARKS")}`)
  }, excludedFn));

  national.filter((r) => col(r, "PICK-UP DATE", "START SHIP", "SHIPPING DATE", "SHIP DATE"))
  .forEach((r) => pushOutbound("National Order Progress", r, {
    shipDate: col(r, "PICK-UP DATE", "START SHIP", "SHIPPING DATE", "SHIP DATE"),
    customer: col(r, "CHANNEL"),
    invoice: col(r, "PO#", "ORDER#"),
    origin: col(r, "DEPARTMENT"),
    carrier: col(r, "SHIPMENT TYPE"),
    pro: "",
    units: col(r, "MEMO"),
    destination: "",
    status: classifyStatus(`${col(r, "OVERALL PO STATUS")} ${col(r, "MEMO")}`)
  }, excludedFn));

  /* NATIONAL SHIP OUT SCHEDULE — skip its embedded placeholder template rows */
  shipOut.filter((r) => {
    const account = col(r, "ACCOUNT");
    const orderName = col(r, "ORDER NAME");
    if (!useful(r) || !account) return false;
    if (/^account$/i.test(account) || /^order\/po#$/i.test(orderName)) return false;
    return Boolean(col(r, "WORK PROGRESS") || col(r, "# OF CARTONS") || col(r, "# OF PALLETS"));
  }).forEach((r) => pushOutbound("National Ship Out", r, {
    shipDate: col(r, "SSD", "ROUTING DATE"),
    customer: col(r, "ACCOUNT"),
    invoice: col(r, "ORDER NAME"),
    origin: col(r, "# OF POS") ? `${col(r, "# OF POS")} POs` : "",
    carrier: col(r, "SHIP METHOD"),
    pro: "",
    units: col(r, "# OF PALLETS") ? `${col(r, "# OF PALLETS")} Pallets`
      : col(r, "# OF CARTONS") ? `${col(r, "# OF CARTONS")} Cartons` : "",
    destination: "",
    status: classifyStatus(`${col(r, "WORK PROGRESS")} ${col(r, "NOTE")}`)
  }, excludedFn));

  /* TJX/ROSS DIMENSION — grouped layout: the order name appears once and its
     PO lines follow below, so carry the group label forward. */
  let currentOrder = "";
  let currentReceived = "";
  tjxRoss.forEach((r) => {
    const orderName = colLoose(r, "ORDER NAME");
    const received = colLoose(r, "ORDER RECEIVED");
    if (orderName && !/^order\s*name$/i.test(orderName)) currentOrder = orderName;
    if (received && !/^order\s*received$/i.test(received)) currentReceived = received;

    const po = colLoose(r, "PO#", "PO");
    const bol = colLoose(r, "BOL");
    const weight = colLoose(r, "WEIGHT (LBS)", "WEIGHT LBS", "WEIGHT");
    if (!po && !bol && !weight) return;
    if (/^po#?$/i.test(po) || /^bol$/i.test(bol)) return;

    pushOutbound("TJX/ROSS", r, {
      shipDate: colLoose(r, "SHIPOUT DATE", "SHIP OUT DATE") || colLoose(r, "SSD"),
      customer: currentOrder || colLoose(r, "DC#") || "TJX/ROSS",
      invoice: po,
      origin: currentReceived ? `Ordered ${currentReceived}` : "",
      carrier: colLoose(r, "CARRIER"),
      pro: bol,
      units: [
        colLoose(r, "PLT") ? `${colLoose(r, "PLT")} Plt` : "",
        colLoose(r, "BOX") ? `${colLoose(r, "BOX")} Box` : ""
      ].filter(Boolean).join(" · "),
      destination: colLoose(r, "DC#"),
      status: classifyStatus(colLoose(r, "STATUS"))
    }, excludedFn);
  });
}

/* merge same-customer rows shipping within 3 days into one line */
function consolidate(rows) {
  const groups = new Map();
  const loners = [];
  rows.forEach((r) => {
    const key = r.customer.toUpperCase().replace(/\s+/g, " ").trim();
    if (!key) { loners.push(r); return; }
    groups.set(key, [...(groups.get(key) || []), r]);
  });
  const uniq = (vals) => [...new Set(vals.flatMap((v) => clean(v).split(/[\r\n,;]+/)).map((v) => v.trim()).filter(Boolean))];
  const merged = [...groups.values()].flatMap((rowsForCustomer) => {
    const sorted = [...rowsForCustomer].sort((a, b) => (parseDate(a.shipDate)?.getTime() || 0) - (parseDate(b.shipDate)?.getTime() || 0));
    const clusters = [];
    sorted.forEach((r) => {
      const cluster = clusters.at(-1);
      const first = cluster?.[0];
      const near = cluster && parseDate(r.shipDate) && parseDate(first.shipDate) &&
        parseDate(r.shipDate) - parseDate(first.shipDate) <= 3 * 864e5;
      if (near) cluster.push(r); else clusters.push([r]);
    });
    return clusters.map((cluster) => {
      if (cluster.length === 1) return cluster[0];
      const base = cluster[0];
      const dates = cluster.map((r) => r.shipDate).filter(Boolean);
      return {
        ...base,
        source: uniq(cluster.map((r) => r.source)).join(" · "),
        shipDate: dates[0] === dates.at(-1) ? dates[0] : `${dates[0]} – ${dates.at(-1)}`,
        invoice: uniq(cluster.map((r) => r.invoice)).join(" · "),
        pro: uniq(cluster.map((r) => r.pro)).join(" · "),
        carrier: uniq(cluster.map((r) => r.carrier)).join(" · "),
        units: uniq(cluster.map((r) => r.units)).join(" · "),
        destination: uniq(cluster.map((r) => r.destination)).join(" · "),
        rate: cluster.reduce((s, r) => s + r.rate, 0),
        status: cluster.some((r) => r.status === "Shipping") ? "Shipping" : base.status
      };
    });
  });
  return [...loners, ...merged].sort((a, b) =>
    (parseDate(a.shipDate)?.getTime() ?? Number.MAX_SAFE_INTEGER) -
    (parseDate(b.shipDate)?.getTime() ?? Number.MAX_SAFE_INTEGER)
  );
}

/* ---------- KPI block (protected range on All Outbound) ---------- */
async function fetchKpis() {
  const table = await fetchTable(KPI_SOURCE.tab, KPI_SOURCE.range, false);
  const block = {};
  (table.rows || []).forEach((row) => {
    const label = rawCell(row, 0).toUpperCase();
    if (label) block[label] = rawCell(row, 1);
  });
  return block;
}

/* ---------- load pipeline ---------- */
async function load() {
  if (loading) return;
  loading = true;
  $("sync").textContent = "Importing all Logistics Master 2026 sources…";
  try {
    /* FIX: catch attached at creation, not at await — otherwise a fast KPI
       failure fires an unhandledrejection while the main batch is in flight. */
    const kpiPromise = fetchKpis().catch((e) => ({ __error: e }));
    const results = await Promise.allSettled(SOURCES.map((s) => fetchTable(s.tab, s.range)));
    const tables = results.map((r) => (r.status === "fulfilled" ? r.value : { cols: [], rows: [] }));
    const mapped = tables.map(objects);

    const [im, tr, ul, ih, b2, whAll, national, shipOut, tjxRoss, exclusions] = mapped;
    const wh = whAll.slice(1); /* WH tab carries a banner row above its headers */

    const exclusionSet = new Set(
      exclusions.filter(useful).map((r) => `${col(r, "SOURCE")}|${col(r, "KEY")}`.trim().toUpperCase())
    );
    /* map display source names back to tab names for exclusion matching */
    const tabOf = {
      "Transfers": "TRANSFERS", "Ulta": "ULTA", "iHerb": "IHERB",
      "B2B/E-com Trucking": "B2B/E-COM TRUCKING", "WH Trucking Request": "WH TRUCKING REQUEST",
      "National Order Progress": "NATIONAL ORDER PROGRESS",
      "National Ship Out": "NATIONAL SHIP OUT SCHEDULE", "TJX/ROSS": "TJX/ROSS DIMENSION"
    };
    const excludedFn = (source, key) =>
      Boolean(key) && exclusionSet.has(`${tabOf[source] || source.toUpperCase()}|${key}`.toUpperCase());

    inboundRows = mergeInboundPlanning(mapInbound(im), mapInboundPlanningGrid(tables[0]));
    parcelRows = mapParcels(tables[0]);
    mapAllOutbound({ tr, ul, ih, b2, wh, national, shipOut, tjxRoss }, excludedFn);

    /* cost summary: computed first, then overridden by the protected KPI
       block whose Sheets formulas cover the full dataset */
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dated = outboundRows
      .map((r) => ({ r, d: parseDate(r.shipDate) }))
      .filter((x) => x.d && x.d <= today);
    costSummary = {
      ytd: dated.filter((x) => x.d.getFullYear() === now.getFullYear()).reduce((s, x) => s + x.r.rate, 0),
      mtd: dated.filter((x) => x.d.getFullYear() === now.getFullYear() && x.d.getMonth() === now.getMonth()).reduce((s, x) => s + x.r.rate, 0),
      finished: outboundRows.filter((r) => FINISHED.has(r.status)).length,
      kpiSource: "computed"
    };
    let kpiOk = true;
    try {
      const kpi = await kpiPromise;
      if (kpi && kpi.__error) throw kpi.__error;
      const ytd = money(kpi["YTD SHIPPING COST"] || "");
      const mtd = money(kpi["MTD SHIPPING COST"] || "");
      if (ytd > 0) { costSummary.ytd = Math.round(ytd); costSummary.kpiSource = "workbook"; }
      if (mtd > 0) costSummary.mtd = Math.round(mtd);
    } catch (e) {
      kpiOk = false;
      console.warn("KPI block unavailable — using computed totals.", e);
    }

    /* per-source health for the source strip */
    const contributed = [im, tr, ul, ih, b2, wh, national, shipOut, tjxRoss, exclusions]
      .map((rows) => rows.filter(useful).length);
    sourceHealth = SOURCES.map((s, i) => ({
      tab: s.tab, kind: s.kind, gid: s.gid,
      ok: results[i].status === "fulfilled",
      rows: contributed[i]
    }));
    sourceHealth.push({ tab: "All Outbound KPI block", kind: "kpi", gid: KPI_SOURCE.gid, ok: kpiOk, rows: kpiOk ? 4 : 0 });

    const failed = sourceHealth.filter((s) => !s.ok).map((s) => s.tab);
    renderAll();
    $("sync").textContent = failed.length
      ? `${sourceHealth.length - failed.length} of ${sourceHealth.length} sources imported · unavailable: ${failed.join(", ")}`
      : `All ${sourceHealth.length} workbook sources imported`;
    $("dot").classList.toggle("sync-error", failed.length > 0);
    $("setupNotice").classList.toggle("hidden", failed.length < sourceHealth.length);
    $("updated").textContent = new Date().toLocaleString();
  } catch (e) {
    console.error(e);
    $("dot").classList.add("sync-error");
    $("sync").textContent = `Workbook sync issue: ${e.message}`;
    $("setupNotice").classList.remove("hidden");
  } finally {
    loading = false;
  }
}

/* ---------- rendering ---------- */
function srcColor(source) {
  return SOURCE_COLORS[source.split(" · ")[0]] || "var(--steel)";
}
function srcTag(source) {
  return source.split(" · ").map((s) =>
    `<span class="src-tag" style="--c:${srcColor(s)}">${esc(s)}</span>`
  ).join(" ");
}
function statusPill(status) {
  return `<span class="status status-${status.toLowerCase()}">${esc(status)}</span>`;
}
const activeOutbound = () => outboundRows.filter((r) => !FINISHED.has(r.status));
const activeInbound = () => inboundRows.filter((r) => !FINISHED.has(r.status));

function renderSourceStrip() {
  const ok = sourceHealth.filter((s) => s.ok).length;
  $("sourceOkCount").textContent = `${ok}/${sourceHealth.length} online`;
  $("sourceStrip").innerHTML = sourceHealth.map((s) => {
    const color = {
      "TRANSFERS": "var(--c-transfers)", "ULTA": "var(--c-ulta)", "IHERB": "var(--c-iherb)",
      "B2B/E-COM TRUCKING": "var(--c-b2b)", "WH Trucking Request": "var(--c-wh)",
      "NATIONAL ORDER PROGRESS": "var(--c-national-order)",
      "NATIONAL SHIP OUT SCHEDULE": "var(--c-ship-out)", "TJX/ROSS DIMENSION": "var(--c-tjx)"
    }[s.tab] || "var(--ink-2)";
    const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit#gid=${s.gid}`;
    return `<a class="source-chip ${s.ok ? "" : "failed"}" style="--c:${color}" href="${url}" target="_blank" rel="noopener noreferrer" title="Open ${esc(s.tab)} in Google Sheets" aria-label="Open ${esc(s.tab)} source sheet">
      <span class="st" aria-hidden="true"></span>
      <span><span class="name">${esc(s.tab)}</span><span class="source-open" aria-hidden="true">↗</span><br><span class="rows">${s.ok ? `${s.rows.toLocaleString()} rows` : "unavailable"}</span></span>
    </a>`;
  }).join("");
}

function renderMetrics() {
  const active = activeOutbound();
  const scheduledCost = active.reduce((s, r) => s + r.rate, 0);
  const cards = [
    ["Active outbound", active.length.toLocaleString(), "Finished & cancelled excluded", ""],
    ["Finished outbound", costSummary.finished.toLocaleString(), "Shipped · done · received · delivered · cancelled", ""],
    ["Inbound active", activeInbound().length.toLocaleString(), "Ocean + air shipments", ""],
    ["Small parcel", activeParcels().length.toLocaleString(), "Active tracking · delivered and received excluded", ""],
    ["Scheduled outbound cost", `$${Math.round(scheduledCost).toLocaleString()}`, "Active rows with a charge", "accent"],
    ["YTD shipping cost", `$${Math.round(costSummary.ytd).toLocaleString()}`, costSummary.kpiSource === "workbook" ? "From protected KPI block" : "Computed from source rows", "accent"],
    ["MTD shipping cost", `$${Math.round(costSummary.mtd).toLocaleString()}`, costSummary.kpiSource === "workbook" ? "From protected KPI block" : "Computed from source rows", "accent"],
    ["Ocean containers", inboundRows.filter((r) => r.mode === "Ocean" && !FINISHED.has(r.status)).length.toLocaleString(), "Active container shipments", ""]
  ];
  $("metrics").innerHTML = cards.map(([label, value, note, cls]) =>
    `<article class="metric-card ${cls}"><span class="label">${label}</span><strong>${value}</strong><small>${note}</small></article>`
  ).join("");
}

function next14Days() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return Array.from({ length: 14 }, (_, i) => new Date(+start + i * 864e5));
}
const sameDay = (a, b) => a && b &&
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

function renderBoard(hostId, rows, dateField, itemHtml) {
  const days = next14Days();
  const today = new Date();
  $(hostId).innerHTML = `<div class="board">${days.map((day) => {
    const matches = rows.filter((r) => sameDay(parseDate(r[dateField]), day));
    const isWeekend = day.getDay() === 0 || day.getDay() === 6;
    return `<div class="board-day ${isWeekend ? "weekend" : ""} ${sameDay(day, today) ? "today" : ""}">
      <div class="board-date">${day.toLocaleDateString("en-US", { weekday: "short", month: "2-digit", day: "2-digit" })}</div>
      <div class="board-cell">${matches.length ? matches.map(itemHtml).join("") : '<span class="board-empty" aria-hidden="true">·</span>'}</div>
    </div>`;
  }).join("")}</div>`;
}

function renderBoards() {
  renderBoard("inboundBoard", activeInbound(), "eta", (r) =>
    `<div class="board-item" style="--c:${r.mode === "Air" ? "var(--c-b2b)" : "var(--c-transfers)"}">
      <strong>${esc(r.shipmentNo || r.container || r.mbl || "Shipment")}</strong>
      <span>${esc(r.container || r.carrier)}</span>
    </div>`);
  renderBoard("outboundBoard", activeOutbound(), "shipDate", (r) =>
    `<div class="board-item" style="--c:${srcColor(r.source)}">
      <strong>${esc(r.customer || "—")}</strong>
      <span>${esc(r.invoice || r.pro || r.source)}</span>
    </div>`);
}

function populateFilters() {
  /* FIX: rebuilding options on every auto-refresh silently reset the user's
     source/status selection — now the previous value is restored. */
  const fill = (id, values) => {
    const select = $(id);
    const previous = select.value;
    const first = select.firstElementChild;
    select.innerHTML = "";
    select.append(first);
    const options = [...new Set(values.filter(Boolean))].sort();
    options.forEach((v) => {
      const opt = document.createElement("option");
      opt.textContent = v;
      select.append(opt);
    });
    if (options.includes(previous)) select.value = previous;
  };
  fill("srcFilter", outboundRows.map((r) => r.source.split(" · ")[0]));
  fill("outStatus", outboundRows.map((r) => r.status));
}

/* single pipeline shared by the table render and CSV export */
let sortKey = "shipDate";
let sortDir = 1;
function filteredOutbound() {
  const q = $("outSearch").value.toLowerCase();
  const src = $("srcFilter").value;
  const st = $("outStatus").value;
  const showFinished = $("showFinished").checked;
  const base = outboundRows.filter((r) =>
    (showFinished || !FINISHED.has(r.status)) &&
    (!src || r.source.split(" · ").includes(src)) &&
    (!st || r.status === st) &&
    (!q || Object.values(r).join(" ").toLowerCase().includes(q))
  );
  const rows = consolidate(base);
  const value = (r) =>
    sortKey === "shipDate" ? (parseDate(r.shipDate)?.getTime() ?? Number.MAX_SAFE_INTEGER)
    : sortKey === "rate" ? r.rate
    : String(r[sortKey] || "").toLowerCase();
  return rows.sort((a, b) => {
    const A = value(a), B = value(b);
    return A < B ? -sortDir : A > B ? sortDir : 0;
  });
}

function renderOutbound() {
  const rows = filteredOutbound();
  $("outCount").textContent = `${rows.length.toLocaleString()} rows`;

  const body = $("outRows");
  body.innerHTML = "";
  if (!rows.length) {
    body.innerHTML = `<tr class="empty-row"><td colspan="10">No matching outbound entries.</td></tr>`;
    return;
  }
  const frag = document.createDocumentFragment();
  rows.forEach((r) => {
    const dims = [r.length, r.width, r.height].some(Boolean)
      ? `${esc(r.length || "–")}×${esc(r.width || "–")}×${esc(r.height || "–")}${r.weight ? ` · ${esc(r.weight)}` : ""}`
      : (r.weight ? `${esc(r.weight)} lbs` : "—");
    const trEl = document.createElement("tr");
    if (FINISHED.has(r.status)) trEl.className = "row-finished";
    trEl.innerHTML =
      `<td>${srcTag(r.source)}</td>` +
      `<td class="cell-date">${esc(r.shipDate) || "—"}</td>` +
      `<td><strong>${esc(r.customer) || "—"}</strong><small>${esc(r.invoice)}</small>` +
        (r.origin ? `<small>${esc(r.origin)}</small>` : "") + `</td>` +
      `<td><strong>${esc(r.carrier) || "—"}</strong><small>${esc(r.pro)}</small></td>` +
      `<td>${esc(r.units) || esc(r.qty) || "—"}</td>` +
      `<td class="cell-dims">${dims}</td>` +
      `<td>${esc(r.destination) || "—"}</td>` +
      `<td class="cell-money">${r.rate ? "$" + r.rate.toLocaleString() : "—"}</td>` +
      `<td>${statusPill(r.status)}</td>` +
      `<td>${completeAction(r)}</td>`;
    frag.appendChild(trEl);
  });
  body.appendChild(frag);
}

function completeAction(row) {
  if (FINISHED.has(row.status)) return '<span class="complete-done">Completed</span>';
  if (!row.sourceTab) return '<span class="complete-unavailable" title="This source does not expose a writable status field">Source only</span>';
  const relation = encodeURIComponent(JSON.stringify({
    kind: "outbound", sourceSheet: row.sourceTab, pro: row.pro || "",
    invoice: row.invoice || "", customer: row.customer || "", shipDate: row.shipDate || "",
    currentStatus: ""
  }));
  return `<button class="complete-button" type="button" data-complete="${relation}" ${COMPLETE_ENDPOINT ? "" : "aria-disabled=\"true\""} title="${COMPLETE_ENDPOINT ? "Mark this source entry completed" : "Configure the authenticated Apps Script endpoint first"}">Mark complete</button><span class="complete-result" aria-live="polite"></span>`;
}

async function markComplete(button) {
  if (!COMPLETE_ENDPOINT) {
    button.nextElementSibling.textContent = "Setup required";
    return;
  }
  const result = button.nextElementSibling;
  const relation = JSON.parse(decodeURIComponent(button.dataset.complete));
  if (!window.confirm(`Mark ${relation.customer || relation.invoice || "this entry"} complete?`)) return;
  button.disabled = true;
  result.textContent = "Saving…";
  try {
    const response = await fetch(COMPLETE_ENDPOINT, {
      method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ ...relation, status: "COMPLETED" })
    });
    const data = await response.json();
    if (!data.ok) throw new Error(data.error || "Update failed");
    result.textContent = "Saved";
    await load();
  } catch (error) {
    result.textContent = error.message || "Not saved";
    button.disabled = false;
  }
}

/* CSV export of exactly what's on screen (filters + consolidation + sort) */
function exportOutboundCsv() {
  const rows = filteredOutbound();
  const cell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = [
    ["Source", "Ship date", "Customer", "Invoice", "Origin", "Carrier", "PRO#", "Units",
     "Length (in)", "Width (in)", "Height (in)", "Weight (lbs)", "Destination", "Rate", "Status"].map(cell).join(","),
    ...rows.map((r) => [
      r.source, r.shipDate, r.customer, r.invoice, r.origin, r.carrier, r.pro, r.units || r.qty,
      r.length, r.width, r.height, r.weight, r.destination, r.rate || "", r.status
    ].map(cell).join(","))
  ].join("\r\n");
  const stamp = new Date().toISOString().slice(0, 10);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }));
  a.download = `stylekorean-outbound-${stamp}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function renderInbound() {
  const q = $("inSearch").value.toLowerCase();
  const mode = $("modeFilter").value;
  const rows = inboundRows
    .filter((r) => !FINISHED.has(r.status) &&
      (!mode || r.mode === mode) &&
      (!q || Object.values(r).join(" ").toLowerCase().includes(q)))
    .sort((a, b) =>
      (parseDate(a.eta)?.getTime() ?? Number.MAX_SAFE_INTEGER) -
      (parseDate(b.eta)?.getTime() ?? Number.MAX_SAFE_INTEGER));
  $("inCount").textContent = `${rows.length.toLocaleString()} rows`;

  const body = $("inRows");
  body.innerHTML = "";
  if (!rows.length) {
    body.innerHTML = `<tr class="empty-row"><td colspan="9">No matching inbound shipments.</td></tr>`;
    return;
  }
  const frag = document.createDocumentFragment();
  rows.forEach((r) => {
    const trEl = document.createElement("tr");
    trEl.innerHTML =
      `<td><span class="mode-tag mode-${r.mode.toLowerCase().replace(/\s+/g, "-")}">${esc(r.mode)}</span></td>` +
      `<td class="cell-date">${esc(r.eta) || "—"}</td>` +
      `<td><strong>${esc(r.shipmentNo) || "—"}</strong></td>` +
      `<td>${r.container
        ? (r.trackingUrl
          ? `<a class="track-link" href="${esc(r.trackingUrl)}" target="_blank" rel="noreferrer">${esc(r.container)} ↗</a>`
          : `<span class="mono">${esc(r.container)}</span>`)
        : "—"}</td>` +
      `<td><small style="margin:0">${esc(r.mbl) || "—"}</small><small>${esc(r.hbl)}</small></td>` +
      `<td>${esc(r.carrier) || "—"}</td>` +
      `<td>${esc(r.origin) || "—"}</td>` +
      `<td>${esc(r.destination) || "—"}</td>` +
      `<td>${statusPill(r.status)}</td>`;
    frag.appendChild(trEl);
  });
  body.appendChild(frag);
}

function renderParcels() {
  const active = activeParcels();
  const shown = active.slice(0, 24);
  $("parcelCount").textContent = `${active.length.toLocaleString()} active`;
  const hidden = active.length - shown.length;
  $("parcelGrid").innerHTML = shown.length ? shown.map((p) => `
    <article class="parcel-card">
      <div class="parcel-top">
        <span class="carrier-logo carrier-${p.carrier.toLowerCase()}">${esc(p.carrier)}</span>
        ${statusPill(p.status)}
      </div>
      <strong>${esc(p.tracking)}</strong>
      <p>${esc(p.invoice ? p.invoice + " · " : "")}${esc(p.note)}</p>
      <div class="parcel-bottom">
        <span class="parcel-eta">${p.eta ? "ETA " + esc(p.eta) : "ETA —"}</span>
        ${p.url ? `<a class="track-link" href="${esc(p.url)}" target="_blank" rel="noreferrer">Track ↗</a>` : ""}
      </div>
    </article>`).join("") +
    (hidden > 0 ? `<p class="parcel-more">+ ${hidden} more parcel${hidden === 1 ? "" : "s"} in the IMPORTS tab — open the Google Sheet for the full list.</p>` : "")
    : `<p style="color:var(--steel);padding:6px 0 14px;">No active small-parcel shipments. Delivered and received parcels are excluded.</p>`;
}

function renderAll() {
  renderSourceStrip();
  renderMetrics();
  renderBoards();
  populateFilters();
  renderOutbound();
  renderInbound();
  renderParcels();
}

/* ---------- events & boot ---------- */
function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

document.addEventListener("DOMContentLoaded", () => {
  $("refresh").addEventListener("click", () => load());
  $("outSearch").addEventListener("input", debounce(renderOutbound, 120));
  $("srcFilter").addEventListener("change", renderOutbound);
  $("outStatus").addEventListener("change", renderOutbound);
  $("showFinished").addEventListener("change", renderOutbound);
  $("inSearch").addEventListener("input", debounce(renderInbound, 120));
  $("modeFilter").addEventListener("change", renderInbound);
  $("exportCsv").addEventListener("click", exportOutboundCsv);
  $("outRows").addEventListener("click", (event) => {
    const button = event.target.closest(".complete-button");
    if (button) markComplete(button);
  });

  /* sortable outbound columns */
  const sortHeaders = [...document.querySelectorAll("#outTable th[data-sort]")];
  sortHeaders.forEach((th) => th.addEventListener("click", () => {
    const key = th.dataset.sort;
    if (sortKey === key) sortDir = -sortDir; else { sortKey = key; sortDir = 1; }
    sortHeaders.forEach((h) => {
      const active = h === th;
      h.classList.toggle("sorted", active);
      h.classList.toggle("desc", active && sortDir < 0);
      h.setAttribute("aria-sort", active ? (sortDir > 0 ? "ascending" : "descending") : "none");
    });
    renderOutbound();
  }));

  load();
  setInterval(() => { if (!document.hidden) load(); }, AUTO_REFRESH_MS);
});
