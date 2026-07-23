/**
 * SK Distribution — Relational Shipping Schedules & Google Drive Sync Logic
 */

(() => {
  "use strict";

  const DEFAULT_MASTER_ID = "1M-vZ24Yw4ZN7R7b_473cVn8kny8DznTakSsD3VQsCzc";
  const SNAPSHOT_KEY = "sk-pages-schedule-snapshot-v1";
  const CONFIG_KEY = "sk-pages-schedule-config-v1";
  const FINISHED_SET = new Set(["SHIPPED", "DELIVERED", "RECEIVED", "COMPLETED", "CANCELLED", "CANCELED"]);

  // Configuration State
  const config = {
    sheetId: DEFAULT_MASTER_ID,
    inboundTab: "Inbound",
    outboundTab: "Outbound",
    webhookUrl: ""
  };

  // Application State
  const state = {
    inbound: [],
    outbound: [],
    direction: "", // "" = All, "inbound", "outbound"
    query: "",
    mode: "",
    attentionOnly: false,
    showFinished: false,
    lastChecked: null,
    loading: true,
    activeNav: "overview",
    theme: "editorial"
  };

  // Helper Selectors
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => Array.from(document.querySelectorAll(selector));

  const escapeHtml = (val) => String(val ?? "").replace(/[&<>'"]/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  })[c]);

  const normalizedStatus = (val) => String(val || "Work in Progress").trim().replace(/\s+/g, " ");
  const isFinished = (val) => FINISHED_SET.has(normalizedStatus(val).toUpperCase());

  // Load Saved Configuration
  function loadConfig() {
    const saved = localStorage.getItem(CONFIG_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        config.sheetId = parsed.sheetId || DEFAULT_MASTER_ID;
        config.inboundTab = parsed.inboundTab || "Inbound";
        config.outboundTab = parsed.outboundTab || "Outbound";
        config.webhookUrl = parsed.webhookUrl || "";
      } catch (e) {
        console.warn("Could not parse saved config:", e);
      }
    }

    // Update Form Inputs
    if ($("#cfg-sheet-id")) $("#cfg-sheet-id").value = config.sheetId;
    if ($("#cfg-inbound-tab")) $("#cfg-inbound-tab").value = config.inboundTab;
    if ($("#cfg-outbound-tab")) $("#cfg-outbound-tab").value = config.outboundTab;
    if ($("#cfg-webhook-url")) $("#cfg-webhook-url").value = config.webhookUrl;

    updateSheetLink();
  }

  function saveConfig() {
    config.sheetId = $("#cfg-sheet-id")?.value.trim() || DEFAULT_MASTER_ID;
    config.inboundTab = $("#cfg-inbound-tab")?.value.trim() || "Inbound";
    config.outboundTab = $("#cfg-outbound-tab")?.value.trim() || "Outbound";
    config.webhookUrl = $("#cfg-webhook-url")?.value.trim() || "";

    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
    updateSheetLink();
    showToast("Google Drive & Sheets configuration saved!");
    loadScheduleData(true);
  }

  function updateSheetLink() {
    const directLink = $("#sheet-direct-link");
    if (directLink) {
      directLink.href = `https://docs.google.com/spreadsheets/d/${config.sheetId}`;
    }
    const statusText = $("#source-writeback-status");
    if (statusText) {
      statusText.textContent = config.webhookUrl ? "2-Way Webhook Active" : "Read-Only (No Webhook)";
      statusText.className = config.webhookUrl ? "metric-val status-ok" : "metric-val";
    }
  }

  // Value getter helper
  function getRowValue(row, ...keys) {
    if (!row) return "";
    for (const key of keys) {
      const upper = String(key).toUpperCase();
      for (const prop of Object.keys(row)) {
        if (prop.toUpperCase() === upper && row[prop] != null && String(row[prop]).trim()) {
          return String(row[prop]).trim();
        }
      }
    }
    return "";
  }

  // Date Utilities
  function parseDate(input) {
    const text = String(input || "").trim();
    if (!text) return Number.MAX_SAFE_INTEGER;
    
    if (/^\d{5}(?:\.\d+)?$/.test(text)) {
      const serial = Number(text);
      if (serial >= 30000 && serial <= 70000) {
        return (serial - 25569) * 86400000;
      }
    }

    const parts = text.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
    if (parts) {
      let year = parts[3] ? Number(parts[3]) : new Date().getFullYear();
      if (year < 100) year += 2000;
      return new Date(year, Number(parts[1]) - 1, Number(parts[2])).getTime();
    }

    const parsed = Date.parse(text);
    return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed;
  }

  function formatDate(input) {
    const time = parseDate(input);
    if (time === Number.MAX_SAFE_INTEGER) return input || "—";
    return new Intl.DateTimeFormat("en-US", { month: "2-digit", day: "2-digit", year: "2-digit" }).format(new Date(time));
  }

  function relativeTimeText(input) {
    const time = parseDate(input);
    if (time === Number.MAX_SAFE_INTEGER) return "";
    const diffDays = Math.round((time - Date.now()) / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Tomorrow";
    if (diffDays === -1) return "Yesterday";
    if (diffDays > 1) return `In ${diffDays} days`;
    return `${Math.abs(diffDays)} days ago`;
  }

  function isValidDate(text) {
    const time = parseDate(text);
    if (time === Number.MAX_SAFE_INTEGER) return false;
    const year = new Date(time).getFullYear();
    const current = new Date().getFullYear();
    return year >= current - 2 && year <= current + 3;
  }

  // Carrier Detection Engine
  function detectCarrier(identifier, contextValue, fallback = "") {
    const id = String(identifier || "").replace(/\s+/g, "").toUpperCase();
    const context = String(contextValue || "").toUpperCase();

    if (/^1Z[A-Z0-9]{16}$/.test(id) || id === "UPS" || context.includes("UPS")) return "UPS";
    if (/^9[234]\d{17,21}$/.test(id) || id === "USPS" || context.includes("USPS")) return "USPS";
    if (/FEDEX|FDX/.test(context) || id === "FEDEX") return "FedEx";
    if (context.includes("DHL") || id === "DHL") return "DHL";
    if (context.includes("AMAZON") || id === "AMAZON" || /^TBA\d+/.test(id)) return "Amazon Logistics";
    if (/KOREAN AIR/.test(context) || /^180-?\d{8}$/.test(id)) return "Korean Air Cargo";
    if (/^(HMMU|HDMU)/.test(id) || context.includes("HMM")) return "HMM";
    if (/^(MAEU|MSKU|MRSU)/.test(id) || context.includes("MAERSK")) return "Maersk";
    if (/^SMCU/.test(id) || context.includes("SM LINE")) return "SM Line";
    if (/^ONEU/.test(id)) return "ONE";
    if (/^KMTU/.test(id)) return "KMTC";
    if (/^(MSCU|MEDU)/.test(id) || context.includes("MSC")) return "MSC";
    if (/^EGLV/.test(id) || context.includes("EVERGREEN")) return "Evergreen";
    if (/^OOLU/.test(id) || context.includes("OOCL")) return "OOCL";
    if (/^COSU/.test(id) || context.includes("COSCO")) return "COSCO";
    if (/^CMAU/.test(id) || context.includes("CMA CGM")) return "CMA CGM";
    if (/^YMLU/.test(id) || context.includes("YANG MING")) return "Yang Ming";
    if (/^ZIMU/.test(id) || context.includes("ZIM")) return "ZIM";

    return String(fallback || "").trim();
  }

  // Shipment Mode Classifier
  function classifyMode(direction, row, identifier, carrier) {
    const declared = getRowValue(row, "CARRIER TYPE").toUpperCase();
    const context = [
      identifier, carrier,
      getRowValue(row, "VESSEL / FLIGHT", "SHIPPING METHOD", "SHIPMENT TYPE", "NOTE"),
      getRowValue(row, "MBL", "HBL", "CONTAINER", "AWB"),
      getRowValue(row, "PALLET TYPE", "WEIGHT (LBS)")
    ].join(" ").toUpperCase();

    if (/UPS|USPS|FEDEX|FDX|DHL|AMAZON|TBA\d+/.test(context)) return "Small parcel";
    if (/^\d{3}-?\d{8}$/.test(String(identifier).replace(/\s+/g, "")) || /\bAIR\b|AIRFREIGHT|AIR FREIGHT|FLIGHT|\bAWB\b|KOREAN AIR/.test(context)) return "Air freight";
    if (/^[A-Z]{4}\d{7}$/.test(String(identifier).replace(/\s+/g, ""))) return "Ocean freight";
    if (declared.includes("AIR")) return "Air freight";
    if (declared.includes("OCEAN")) return "Ocean freight";
    if (/\bOCEAN\b|VESSEL|CONTAINER|\bMBL\b|\bHBL\b|\bFCL\b|\bLCL\b/.test(context)) return "Ocean freight";
    if (direction === "outbound" && (/LTL|FTL|TRUCK|FREIGHT|PALLET|PRO#/.test(context) || (identifier && carrier))) return "Ground freight";

    return "Unclassified";
  }

  // Direct Tracking URL Generator
  function buildTrackingUrl(identifier, carrier) {
    const id = String(identifier || "").replace(/\s+/g, "").toUpperCase();
    if (!id) return "";
    const encoded = encodeURIComponent(id);

    if (/^1Z[A-Z0-9]{16}$/.test(id) || /UPS/i.test(carrier)) return `https://www.ups.com/track?tracknum=${encoded}`;
    if (/^9[234]\d{17,21}$/.test(id) || /USPS/i.test(carrier)) return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encoded}`;
    if (/FEDEX|FDX/i.test(carrier)) return `https://www.fedex.com/fedextrack/?trknbr=${encoded}`;
    if (/DHL/i.test(carrier)) return `https://www.dhl.com/us-en/home/tracking/tracking-express.html?submit=1&tracking-id=${encoded}`;
    if (/AMAZON/i.test(carrier) || /^TBA\d+/.test(id)) return "https://track.amazon.com/";
    if (/^HMMU/.test(id) || /HMM/i.test(carrier)) return `https://www.hmm21.com/e-service/general/trackNTrace/TrackNTrace.do?searchType=CNTR&searchNo=${encoded}`;
    if (/^(MAEU|MSKU|MRSU)/.test(id) || /MAERSK/i.test(carrier)) return `https://www.maersk.com/tracking/${encoded}`;
    if (/^SMCU/.test(id)) return `https://esvc.smlines.com/smline/CUP_HOM_3301GS.do?search_name=${encoded}&search_type=C`;
    if (/ONE/i.test(carrier) || /^ONEU/.test(id)) return `https://ecomm.one-line.com/one-ecom/manage-shipment/cargo-tracking?trakNoParam=${encoded}`;
    if (/MSC/i.test(carrier)) return "https://www.msc.com/en/track-a-shipment";
    if (/EVERGREEN/i.test(carrier)) return "https://ct.shipmentlink.com/servlet/TDB1_CargoTracking.do";
    if (/OOCL/i.test(carrier)) return "https://www.oocl.com/eng/ourservices/eservices/cargotracking/Pages/cargotracking.aspx";
    if (/COSCO/i.test(carrier)) return "https://elines.coscoshipping.com/ebusiness/cargoTracking";
    if (/CMA CGM/i.test(carrier)) return `https://www.cma-cgm.com/ebusiness/tracking/search?SearchBy=Container&Reference=${encoded}`;

    return `https://www.17track.net/en?nums=${encoded}`;
  }

  // Quality Assessment Logic
  function evaluateRecordQuality(direction, record) {
    const missing = [];
    if (!record.date) missing.push(direction === "inbound" ? "ETA" : "Ship date");
    else if (!isValidDate(record.date)) missing.push("Valid date format");
    if (!record.identifier) missing.push(direction === "inbound" ? "Container / MBL / HBL / AWB" : "PRO / Tracking / BOL");
    if (!record.carrier) missing.push("Carrier name");
    if (record.shipmentMode === "Unclassified") missing.push("Shipment mode");
    if (direction === "outbound" && !record.customer) missing.push("Customer name");
    if (!record.invoice) missing.push("Invoice / PO #");
    if (!record.trackingUrl) missing.push("Tracking link");

    const totalFields = 7;
    const score = Math.max(0, Math.round(((totalFields - missing.length) / totalFields) * 100));
    return { score, missing, needsAttention: missing.length > 0 };
  }

  // Relational Linking Engine
  function findRelatedRecords(record) {
    if (!record) return [];
    const targetSet = record.direction === "inbound" ? state.outbound : state.inbound;
    const invoiceKey = record.invoice.trim().toLowerCase();
    const idKey = record.identifier.trim().toLowerCase();

    if (invoiceKey === "—" && idKey === "n/a") return [];

    return targetSet.filter(r => {
      const rInv = r.invoice.trim().toLowerCase();
      const rId = r.identifier.trim().toLowerCase();
      const rNote = r.note.trim().toLowerCase();

      if (invoiceKey !== "—" && rInv !== "—" && (rInv === invoiceKey || rNote.includes(invoiceKey))) return true;
      if (idKey !== "n/a" && rId !== "n/a" && (rId === idKey || rNote.includes(idKey))) return true;
      return false;
    });
  }

  // Process Raw Row
  function processRow(direction, rawRow) {
    const identifier = getRowValue(rawRow, "CONTAINER NO", "CONTAINER", "MBL", "HBL", "PRO NO", "PRO #", "TRACKING NO", "TRACKING", "AWB", "BOL");
    const carrierContext = getRowValue(rawRow, "CARRIER", "LINE", "SHIPPING LINE", "CARRIER TYPE", "METHOD");
    const carrier = detectCarrier(identifier, carrierContext, carrierContext);
    const mode = classifyMode(direction, rawRow, identifier, carrier);
    const date = getRowValue(rawRow, "ETA", "EXPECTED ARRIVAL", "SHIP DATE", "SHIPPED DATE", "DATE");
    const customer = getRowValue(rawRow, "CUSTOMER", "CLIENT", "CONSIGNEE", "SHIP TO", "ORIGIN", "SUPPLIER");
    const invoice = getRowValue(rawRow, "INVOICE", "INVOICE NO", "PO", "PO NO", "REF");
    const vessel = getRowValue(rawRow, "VESSEL / FLIGHT", "VESSEL", "FLIGHT", "TRUCK");
    const status = normalizedStatus(getRowValue(rawRow, "STATUS", "STATE"));
    const note = getRowValue(rawRow, "NOTE", "REMARKS", "COMMENTS");
    const trackingUrl = buildTrackingUrl(identifier, carrier);

    const record = {
      direction,
      identifier: identifier || "N/A",
      carrier: carrier || "Unassigned",
      shipmentMode: mode,
      date: date || "",
      customer: customer || "SK Internal",
      invoice: invoice || "—",
      vessel: vessel || "—",
      status: status || "Work in Progress",
      note: note || "",
      trackingUrl,
      raw: rawRow
    };

    record.quality = evaluateRecordQuality(direction, record);
    return record;
  }

  // CSV Parser
  function parseCSV(csvText) {
    const lines = [];
    let currentLine = [];
    let currentCell = "";
    let insideQuotes = false;

    for (let i = 0; i < csvText.length; i++) {
      const char = csvText[i];
      const nextChar = csvText[i + 1];

      if (char === '"') {
        if (insideQuotes && nextChar === '"') {
          currentCell += '"';
          i++;
        } else {
          insideQuotes = !insideQuotes;
        }
      } else if (char === ',' && !insideQuotes) {
        currentLine.push(currentCell.trim());
        currentCell = "";
      } else if ((char === '\r' || char === '\n') && !insideQuotes) {
        if (char === '\r' && nextChar === '\n') i++;
        currentLine.push(currentCell.trim());
        if (currentLine.some(c => c)) lines.push(currentLine);
        currentLine = [];
        currentCell = "";
      } else {
        currentCell += char;
      }
    }
    if (currentCell || currentLine.length > 0) {
      currentLine.push(currentCell.trim());
      if (currentLine.some(c => c)) lines.push(currentLine);
    }

    if (lines.length === 0) return [];
    const headers = lines[0].map(h => h.toUpperCase());
    return lines.slice(1).map(row => {
      const obj = {};
      headers.forEach((header, index) => {
        obj[header] = row[index] || "";
      });
      return obj;
    });
  }

  // Mock Realistic Data Fallback
  function generateMockData() {
    const mockInboundRaw = [
      { "CONTAINER NO": "HMMU1234567", "CARRIER": "HMM", "ETA": "07/25/2026", "VESSEL / FLIGHT": "HYUNDAI BRAVE / 042E", "STATUS": "In Transit", "INVOICE": "INV-8921", "NOTE": "Priority electronics pallet" },
      { "CONTAINER NO": "MAEU9876543", "CARRIER": "Maersk", "ETA": "07/28/2026", "VESSEL / FLIGHT": "MAERSK MC-KINNEY", "STATUS": "Customs Hold", "INVOICE": "INV-8940", "NOTE": "Pending FDA clearance" },
      { "CONTAINER NO": "180-49201948", "CARRIER": "Korean Air Cargo", "ETA": "07/23/2026", "VESSEL / FLIGHT": "KE011 Air", "STATUS": "Work in Progress", "INVOICE": "INV-9002", "NOTE": "Urgent air freight sample" },
      { "CONTAINER NO": "OOLU5543210", "CARRIER": "OOCL", "ETA": "08/02/2026", "VESSEL / FLIGHT": "OOCL HONG KONG", "STATUS": "Work in Progress", "INVOICE": "INV-9015", "NOTE": "PO-4410 customer order" },
      { "CONTAINER NO": "SMCU8812903", "CARRIER": "SM Line", "ETA": "07/20/2026", "VESSEL / FLIGHT": "SM LONG BEACH", "STATUS": "Delivered", "INVOICE": "INV-8850", "NOTE": "Unloaded at Dock 4" }
    ];

    const mockOutboundRaw = [
      { "PRO NO": "PRO-99201", "CARRIER": "FedEx", "SHIP DATE": "07/23/2026", "CUSTOMER": "Apex Retail Distributors", "INVOICE": "INV-8921", "STATUS": "Shipped", "NOTE": "LTL Freight 4 pallets linked to HMMU1234567" },
      { "PRO NO": "1Z9999999999999999", "CARRIER": "UPS", "SHIP DATE": "07/24/2026", "CUSTOMER": "Zenith Logistics Hub", "INVOICE": "PO-4425", "STATUS": "Work in Progress", "NOTE": "Small Parcel Express" },
      { "PRO NO": "PRO-88410", "CARRIER": "Estes Express", "SHIP DATE": "07/26/2026", "CUSTOMER": "Pacific Rim Trading", "INVOICE": "PO-4410", "STATUS": "Work in Progress", "NOTE": "Ground Freight linked to OOLU5543210" },
      { "PRO NO": "TBA902194012", "CARRIER": "Amazon Logistics", "SHIP DATE": "07/22/2026", "CUSTOMER": "Amazon FBA ONT8", "INVOICE": "INV-8850", "STATUS": "Delivered", "NOTE": "FBA Direct dropoff" }
    ];

    return {
      inbound: mockInboundRaw.map(r => processRow("inbound", r)),
      outbound: mockOutboundRaw.map(r => processRow("outbound", r))
    };
  }

  // Load Data Engine
  async function loadScheduleData(forceRefresh = false) {
    state.loading = true;

    // Check Local Storage cache first
    let cachedDataLoaded = false;
    if (!forceRefresh) {
      const cached = localStorage.getItem(SNAPSHOT_KEY);
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          if ((parsed.inbound && parsed.inbound.length > 0) || (parsed.outbound && parsed.outbound.length > 0)) {
            state.inbound = parsed.inbound || [];
            state.outbound = parsed.outbound || [];
            state.lastChecked = parsed.lastChecked || new Date().toISOString();
            state.loading = false;
            cachedDataLoaded = true;
            updateDashboard();
          }
        } catch (e) {
          console.warn("Failed to parse cached snapshot:", e);
        }
      }
    }

    // If no cached data, populate fallback data immediately so UI is 100% interactive instantly
    if (!cachedDataLoaded && state.inbound.length === 0) {
      const mock = generateMockData();
      state.inbound = mock.inbound;
      state.outbound = mock.outbound;
      state.lastChecked = new Date().toISOString();
      state.loading = false;
      updateDashboard();
    }

    try {
      const inboundUrl = `https://docs.google.com/spreadsheets/d/${config.sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(config.inboundTab)}`;
      const outboundUrl = `https://docs.google.com/spreadsheets/d/${config.sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(config.outboundTab)}`;

      const [inboundRes, outboundRes] = await Promise.allSettled([
        fetch(inboundUrl).then(r => r.text()),
        fetch(outboundUrl).then(r => r.text())
      ]);

      let inboundData = [];
      let outboundData = [];

      if (inboundRes.status === "fulfilled" && inboundRes.value.includes(",")) {
        const rawRows = parseCSV(inboundRes.value);
        inboundData = rawRows.map(r => processRow("inbound", r));
      }

      if (outboundRes.status === "fulfilled" && outboundRes.value.includes(",")) {
        const rawRows = parseCSV(outboundRes.value);
        outboundData = rawRows.map(r => processRow("outbound", r));
      }

      if (inboundData.length > 0 || outboundData.length > 0) {
        state.inbound = inboundData.length > 0 ? inboundData : state.inbound;
        state.outbound = outboundData.length > 0 ? outboundData : state.outbound;
        state.lastChecked = new Date().toISOString();

        localStorage.setItem(SNAPSHOT_KEY, JSON.stringify({
          inbound: state.inbound,
          outbound: state.outbound,
          lastChecked: state.lastChecked
        }));

        showToast("Live Google Sheets data synced!");
      }
    } catch (err) {
      console.warn("Live fetch fallback:", err);
    } finally {
      state.loading = false;
      updateDashboard();
    }
  }
      state.inbound = mock.inbound;
      state.outbound = mock.outbound;
      state.lastChecked = new Date().toISOString();
      showToast("Loaded snapshot schedule data.");
    } finally {
      state.loading = false;
      updateDashboard();
    }
  }

  // Submit 2-Way Writeback Update
  async function submitUpdateToSheets(record, newStatus, newNote) {
    record.status = newStatus;
    if (newNote != null) record.note = newNote;
    record.quality = evaluateRecordQuality(record.direction, record);

    // Save updated snapshot
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify({
      inbound: state.inbound,
      outbound: state.outbound,
      lastChecked: new Date().toISOString()
    }));

    updateDashboard();

    if (!config.webhookUrl) {
      showToast("Local record updated! (Add Apps Script Webhook URL to push live to Google Sheets)");
      return;
    }

    try {
      showToast("Pushing 2-way writeback to Google Sheets...");
      const response = await fetch(config.webhookUrl, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          direction: record.direction,
          identifier: record.identifier,
          status: newStatus,
          note: record.note,
          updatedAt: new Date().toISOString()
        })
      });
      showToast("Writeback update sent to Google Sheets Webhook!");
    } catch (e) {
      console.error("Writeback error:", e);
      showToast("Saved locally. Webhook writeback error: " + e.message);
    }
  }

  // Dashboard Filters
  function getFilteredRecords() {
    let records = [];
    if (state.direction === "inbound") records = [...state.inbound];
    else if (state.direction === "outbound") records = [...state.outbound];
    else records = [...state.inbound, ...state.outbound];

    if (!state.showFinished) {
      records = records.filter(r => !isFinished(r.status));
    }

    if (state.mode) {
      records = records.filter(r => r.shipmentMode === state.mode);
    }

    if (state.attentionOnly) {
      records = records.filter(r => r.quality.needsAttention);
    }

    if (state.query.trim()) {
      const q = state.query.trim().toLowerCase();
      records = records.filter(r =>
        r.identifier.toLowerCase().includes(q) ||
        r.carrier.toLowerCase().includes(q) ||
        r.customer.toLowerCase().includes(q) ||
        r.invoice.toLowerCase().includes(q) ||
        r.vessel.toLowerCase().includes(q) ||
        r.note.toLowerCase().includes(q)
      );
    }

    return records;
  }

  function updateDashboard() {
    const allRecords = [...state.inbound, ...state.outbound];
    const activeInbound = state.inbound.filter(r => !isFinished(r.status));
    const activeOutbound = state.outbound.filter(r => !isFinished(r.status));
    
    // Relational Links Calculation
    let totalRelational = 0;
    allRecords.forEach(r => {
      if (findRelatedRecords(r).length > 0) totalRelational++;
    });

    const totalScores = allRecords.reduce((acc, r) => acc + r.quality.score, 0);
    const avgQuality = allRecords.length > 0 ? Math.round(totalScores / allRecords.length) : 100;

    $("#nav-inbound-count").textContent = activeInbound.length;
    $("#nav-outbound-count").textContent = activeOutbound.length;

    $("#kpi-inbound-val").textContent = activeInbound.length;
    $("#kpi-outbound-val").textContent = activeOutbound.length;
    $("#kpi-relational-val").textContent = totalRelational;
    $("#kpi-quality-val").textContent = `${avgQuality}%`;

    $("#stat-port-sub").textContent = `${activeInbound.length} In-Transit`;
    $("#stat-dest-sub").textContent = `${activeOutbound.length} Handoffs`;

    $("#source-inbound-total").textContent = state.inbound.length;
    $("#source-outbound-total").textContent = state.outbound.length;
    $("#source-rel-total").textContent = totalRelational;

    if (state.lastChecked) {
      const timeStr = new Date(state.lastChecked).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      $("#last-updated-tag").textContent = `Last checked: ${timeStr}`;
    }

    renderTable();
  }

  // Render Table
  function renderTable() {
    const tbody = $("#table-body");
    const emptyState = $("#empty-state");
    const records = getFilteredRecords();

    $("#record-count").textContent = `${records.length} items matching filter`;

    if (state.loading) {
      tbody.innerHTML = `
        <tr class="skeleton-row"><td colspan="10"><div class="skeleton-bar"></div></td></tr>
        <tr class="skeleton-row"><td colspan="10"><div class="skeleton-bar"></div></td></tr>
        <tr class="skeleton-row"><td colspan="10"><div class="skeleton-bar"></div></td></tr>
      `;
      emptyState.hidden = true;
      return;
    }

    if (records.length === 0) {
      tbody.innerHTML = "";
      emptyState.hidden = false;
      return;
    }

    emptyState.hidden = true;
    tbody.innerHTML = records.map((r, index) => {
      const finished = isFinished(r.status);
      const qualityClass = r.quality.score >= 85 ? "good" : r.quality.score >= 60 ? "warn" : "bad";
      const relTime = relativeTimeText(r.date);
      const related = findRelatedRecords(r);

      return `
        <tr>
          <td>
            <span class="dir-pill ${r.direction}">${r.direction}</span>
            <span class="mode-badge">${escapeHtml(r.shipmentMode)}</span>
          </td>
          <td>
            <span class="id-text">${escapeHtml(r.identifier)}</span>
          </td>
          <td>
            <div class="carrier-cell">
              <span class="carrier-name">${escapeHtml(r.carrier)}</span>
              ${r.vessel !== "—" ? `<span class="vessel-sub">${escapeHtml(r.vessel)}</span>` : ""}
            </div>
          </td>
          <td>
            <div class="date-cell">
              <span>${formatDate(r.date)}</span>
              ${relTime ? `<span class="rel-time">${relTime}</span>` : ""}
            </div>
          </td>
          <td>
            <span>${escapeHtml(r.customer)}</span>
          </td>
          <td>
            <span class="id-text">${escapeHtml(r.invoice)}</span>
          </td>
          <td>
            ${related.length > 0 ? `
              <span class="rel-pill" title="Linked to ${related.map(x => x.identifier).join(', ')}">
                🔗 ${related.length} Linked
              </span>
            ` : `<span class="rel-pill none">—</span>`}
          </td>
          <td>
            <span class="status-pill ${finished ? 'finished' : r.quality.needsAttention ? 'attention' : 'wip'}">
              <span class="status-dot"></span>
              ${escapeHtml(r.status)}
            </span>
          </td>
          <td>
            <span class="quality-badge ${qualityClass}">${r.quality.score}%</span>
          </td>
          <td>
            <div style="display:flex; gap:6px;">
              ${r.trackingUrl ? `<a class="track-link-btn" href="${r.trackingUrl}" target="_blank" rel="noopener">Track ↗</a>` : ""}
              <button class="action-btn secondary-btn view-detail-btn" data-index="${index}" style="padding:4px 8px;" type="button">Details</button>
            </div>
          </td>
        </tr>
      `;
    }).join("");

    $$(".view-detail-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.getAttribute("data-index"));
        const record = records[idx];
        if (record) openDetailModal(record);
      });
    });
  }

  // Open Detail Modal Drawer with Relational & Writeback Controls
  function openDetailModal(record) {
    const modal = $("#detail-modal");
    $("#modal-title").textContent = record.identifier;
    $("#modal-eyebrow").textContent = `${record.direction.toUpperCase()} · ${record.shipmentMode}`;

    const related = findRelatedRecords(record);
    const missingItems = record.quality.missing;

    $("#modal-body").innerHTML = `
      <div class="detail-grid">
        <div class="detail-item">
          <div class="detail-label">Carrier / Line</div>
          <div class="detail-value">${escapeHtml(record.carrier)}</div>
        </div>
        <div class="detail-item">
          <div class="detail-label">Vessel / Flight / Truck</div>
          <div class="detail-value">${escapeHtml(record.vessel)}</div>
        </div>
        <div class="detail-item">
          <div class="detail-label">Date (${record.direction === 'inbound' ? 'ETA' : 'Ship'})</div>
          <div class="detail-value">${formatDate(record.date)}</div>
        </div>
        <div class="detail-item">
          <div class="detail-label">Current Status</div>
          <div class="detail-value">${escapeHtml(record.status)}</div>
        </div>
        <div class="detail-item">
          <div class="detail-label">Customer / Origin</div>
          <div class="detail-value">${escapeHtml(record.customer)}</div>
        </div>
        <div class="detail-item">
          <div class="detail-label">Invoice / PO #</div>
          <div class="detail-value">${escapeHtml(record.invoice)}</div>
        </div>
      </div>

      <!-- Relational Matches Card -->
      <div class="detail-item" style="margin-bottom:20px;">
        <div class="detail-label">🔗 Relational Linked Shipments (${related.length})</div>
        ${related.length === 0 ? `
          <div style="font-size:12px; color:var(--muted); margin-top:6px;">No linked ${record.direction === 'inbound' ? 'outbound' : 'inbound'} shipments found for PO/Invoice '${escapeHtml(record.invoice)}'.</div>
        ` : `
          <ul class="related-records-list">
            ${related.map(rel => `
              <li class="related-record-card">
                <strong>${rel.direction.toUpperCase()}: ${escapeHtml(rel.identifier)}</strong> (${escapeHtml(rel.carrier)})
                <div>Customer/Origin: ${escapeHtml(rel.customer)} | Status: ${escapeHtml(rel.status)}</div>
              </li>
            `).join("")}
          </ul>
        `}
      </div>

      <!-- 2-Way Sheet Writeback Update Form -->
      <div class="edit-form-box">
        <div class="edit-form-title">⚡ 2-Way Google Sheets Status Update</div>
        <label class="detail-label" style="display:block; margin-bottom:4px;">Update Status:</label>
        <select id="edit-status-select" class="edit-input">
          <option value="Work in Progress" ${record.status === "Work in Progress" ? "selected" : ""}>Work in Progress</option>
          <option value="In Transit" ${record.status === "In Transit" ? "selected" : ""}>In Transit</option>
          <option value="Customs Hold" ${record.status === "Customs Hold" ? "selected" : ""}>Customs Hold</option>
          <option value="Shipped" ${record.status === "Shipped" ? "selected" : ""}>Shipped</option>
          <option value="Delivered" ${record.status === "Delivered" ? "selected" : ""}>Delivered</option>
          <option value="Cancelled" ${record.status === "Cancelled" ? "selected" : ""}>Cancelled</option>
        </select>

        <label class="detail-label" style="display:block; margin-bottom:4px;">Update Notes:</label>
        <input type="text" id="edit-notes-input" class="edit-input" value="${escapeHtml(record.note)}" placeholder="Add remarks or notes">

        <button class="btn primary-btn" id="save-writeback-btn" style="width:100%; margin-top:6px;" type="button">
          Submit Update to Google Sheets
        </button>
      </div>

      <div class="detail-item" style="margin-top:20px;">
        <div class="detail-label">Data Quality Diagnostics (${record.quality.score}%)</div>
        <ul class="quality-check-list">
          ${missingItems.length === 0 ? `
            <li style="color:var(--success);">✓ Complete record. All primary operational fields present.</li>
          ` : missingItems.map(item => `
            <li style="color:var(--danger);">⚠️ Missing field: ${escapeHtml(item)}</li>
          `).join("")}
        </ul>
      </div>
    `;

    $("#modal-footer").innerHTML = `
      ${record.trackingUrl ? `
        <a class="btn primary-btn" href="${record.trackingUrl}" target="_blank" rel="noopener" style="flex:1;">
          Open Carrier Tracking ↗
        </a>
      ` : ""}
      <button class="btn secondary-btn" id="modal-close-action" type="button">Close</button>
    `;

    modal.hidden = false;

    // Attach Writeback Event
    $("#save-writeback-btn")?.addEventListener("click", () => {
      const newStatus = $("#edit-status-select").value;
      const newNotes = $("#edit-notes-input").value;
      submitUpdateToSheets(record, newStatus, newNotes);
      closeModal();
    });

    $("#modal-close-action")?.addEventListener("click", closeModal);
  }

  function closeModal() {
    $("#detail-modal").hidden = true;
  }

  // Toast Notifications
  function showToast(msg) {
    const container = $("#toast-container");
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.textContent = msg;
    container.appendChild(toast);
    setTimeout(() => {
      toast.remove();
    }, 3200);
  }

  // Export Data
  function exportCSV() {
    const records = getFilteredRecords();
    if (records.length === 0) return showToast("No records to export.");

    const headers = ["Direction", "Identifier", "Carrier", "Mode", "Date", "Customer", "Invoice", "Vessel", "Status"];
    const rows = records.map(r => [
      r.direction, r.identifier, r.carrier, r.shipmentMode, r.date, r.customer, r.invoice, r.vessel, r.status
    ]);

    const csvContent = "data:text/csv;charset=utf-8," + [headers, ...rows].map(e => e.map(val => `"${String(val).replace(/"/g, '""')}"`).join(",")).join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `sk_shipping_schedules_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    link.remove();
    showToast("CSV export generated!");
  }

  function exportJSON() {
    const records = getFilteredRecords();
    if (records.length === 0) return showToast("No records to export.");

    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(records, null, 2));
    const link = document.createElement("a");
    link.setAttribute("href", dataStr);
    link.setAttribute("download", `sk_shipping_schedules_${Date.now()}.json`);
    document.body.appendChild(link);
    link.click();
    link.remove();
    showToast("JSON export generated!");
  }

  // Setup Event Listeners
  function initEventListeners() {
    loadConfig();

    $$(".nav-tab").forEach(tab => {
      tab.addEventListener("click", () => {
        $$(".nav-tab").forEach(t => t.classList.remove("active"));
        tab.classList.add("active");
        const nav = tab.getAttribute("data-nav");
        state.activeNav = nav;

        if (nav === "inbound") {
          state.direction = "inbound";
          $("#view-title").textContent = "Inbound Shipments";
        } else if (nav === "outbound") {
          state.direction = "outbound";
          $("#view-title").textContent = "Outbound Shipments";
        } else if (nav === "sources") {
          document.querySelector("#sources-section")?.scrollIntoView({ behavior: "smooth" });
          return;
        } else {
          state.direction = "";
          $("#view-title").textContent = "All Operations Overview";
        }

        $$("#direction-chips .chip").forEach(c => {
          c.classList.toggle("active", c.getAttribute("data-direction") === state.direction);
        });

        updateDashboard();
      });
    });

    $$("#direction-chips .chip").forEach(chip => {
      chip.addEventListener("click", () => {
        $$("#direction-chips .chip").forEach(c => c.classList.remove("active"));
        chip.classList.add("active");
        state.direction = chip.getAttribute("data-direction");
        updateDashboard();
      });
    });

    $("#mode-select")?.addEventListener("change", (e) => {
      state.mode = e.target.value;
      updateDashboard();
    });

    $("#attention-toggle")?.addEventListener("change", (e) => {
      state.attentionOnly = e.target.checked;
      updateDashboard();
    });

    $("#finished-toggle")?.addEventListener("change", (e) => {
      state.showFinished = e.target.checked;
      updateDashboard();
    });

    const searchInput = $("#search-input");
    const clearBtn = $("#clear-search");
    searchInput?.addEventListener("input", (e) => {
      state.query = e.target.value;
      clearBtn.hidden = !state.query;
      updateDashboard();
    });

    clearBtn?.addEventListener("click", () => {
      searchInput.value = "";
      state.query = "";
      clearBtn.hidden = true;
      updateDashboard();
    });

    $("#reset-filters-btn")?.addEventListener("click", () => {
      state.query = "";
      state.mode = "";
      state.direction = "";
      state.attentionOnly = false;
      state.showFinished = false;
      if (searchInput) searchInput.value = "";
      if ($("#mode-select")) $("#mode-select").value = "";
      if ($("#attention-toggle")) $("#attention-toggle").checked = false;
      if ($("#finished-toggle")) $("#finished-toggle").checked = false;
      updateDashboard();
    });

    const exportBtn = $("#export-dropdown-btn");
    const exportMenu = $("#export-menu");
    exportBtn?.addEventListener("click", () => {
      exportMenu.hidden = !exportMenu.hidden;
    });

    document.addEventListener("click", (e) => {
      if (!exportBtn?.contains(e.target) && !exportMenu?.contains(e.target)) {
        if (exportMenu) exportMenu.hidden = true;
      }
    });

    $("#export-csv")?.addEventListener("click", exportCSV);
    $("#export-json")?.addEventListener("click", exportJSON);

    $("#refresh-btn")?.addEventListener("click", () => loadScheduleData(true));
    $("#clear-cache-btn")?.addEventListener("click", () => {
      localStorage.removeItem(SNAPSHOT_KEY);
      showToast("Local cache cleared.");
      loadScheduleData(true);
    });

    $("#save-cfg-btn")?.addEventListener("click", saveConfig);

    $("#show-script-btn")?.addEventListener("click", () => {
      const box = $("#script-code-box");
      if (box) box.hidden = !box.hidden;
    });

    $("#copy-script-btn")?.addEventListener("click", () => {
      const code = $("#apps-script-code")?.textContent;
      if (code) {
        navigator.clipboard.writeText(code).then(() => {
          showToast("Apps Script code copied to clipboard!");
        });
      }
    });

    $$(".theme-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        $$(".theme-btn").forEach(b => b.classList.remove("selected"));
        btn.classList.add("selected");
        const theme = btn.getAttribute("data-theme");
        $("#app").className = `ops-app theme-${theme}`;
        state.theme = theme;
      });
    });

    $("#share-btn")?.addEventListener("click", () => {
      const url = new URL(window.location.href);
      url.hash = state.direction || "overview";
      navigator.clipboard.writeText(url.href).then(() => {
        showToast("Shareable view link copied!");
      });
    });

    $("#modal-close-btn")?.addEventListener("click", closeModal);
    $("#detail-modal")?.addEventListener("click", (e) => {
      if (e.target.id === "detail-modal") closeModal();
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    initEventListeners();
    loadScheduleData();
  });
})();
