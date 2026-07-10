/* Direct worksheet synchronization for the outbound dashboard.
   This replaces the consolidated-tab-only load path and merges the five
   operational source worksheets in the browser. */

const DIRECT_OUTBOUND_SOURCES = {
  wh: { name: "WH Trucking Request", range: "A2:U815", source: "WH TRUCKING" },
  b2b: { name: "B2B/E-COM TRUCKING", range: "A1:R853", source: "B2B/E-COM" },
  transfers: { name: "TRANSFERS", range: "A1:M974", source: "TRANSFERS" },
  ulta: { name: "ULTA", range: "A1:N1012", source: "ULTA" },
  iherb: { name: "IHERB", range: "A1:M967", source: "IHERB" }
};

refreshAll = async function refreshAllFromSourceWorksheets() {
  setConnection("loading", "Loading live source worksheets…");

  try {
    const [wh, b2b, transfers, ulta, iherb, consolidated, inbound, importSchedule] = await Promise.all([
      fetchSheet(DIRECT_OUTBOUND_SOURCES.wh.name, DIRECT_OUTBOUND_SOURCES.wh.range),
      fetchSheet(DIRECT_OUTBOUND_SOURCES.b2b.name, DIRECT_OUTBOUND_SOURCES.b2b.range),
      fetchSheet(DIRECT_OUTBOUND_SOURCES.transfers.name, DIRECT_OUTBOUND_SOURCES.transfers.range),
      fetchSheet(DIRECT_OUTBOUND_SOURCES.ulta.name, DIRECT_OUTBOUND_SOURCES.ulta.range),
      fetchSheet(DIRECT_OUTBOUND_SOURCES.iherb.name, DIRECT_OUTBOUND_SOURCES.iherb.range),
      fetchSheet(CONFIG.sheets.outbound.name, CONFIG.sheets.outbound.range),
      fetchSheet(CONFIG.sheets.inbound.name, CONFIG.sheets.inbound.range),
      fetchSheet(CONFIG.sheets.importSchedule.name, CONFIG.sheets.importSchedule.range)
    ]);

    const statusLookup = buildStatusLookup(consolidated);

    outboundRows = [
      ...mapWhRows(wh),
      ...mapB2bRows(b2b),
      ...mapTransferRows(transfers),
      ...mapUltaRows(ulta),
      ...mapIherbRows(iherb)
    ]
      .map(row => applyStatusOverlay(row, statusLookup))
      .filter(isMeaningfulOutboundRow)
      .filter(isOngoingOutboundRow)
      .sort(compareOutboundRows);

    inboundRows = inbound
      .filter(isInboundDataRow)
      .map(normalizeInboundRow)
      .filter(isOngoingInboundRow);
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
    setConnection("good", `Live data loaded directly from 5 outbound source worksheets (${outboundRows.length.toLocaleString()} entries).`);
  } catch (error) {
    console.error(error);
    $("setupNotice").classList.remove("hidden");
    setConnection("bad", "Could not load one or more source worksheets. Check public sharing / Publish to web settings.");
  }
};

function mapWhRows(rows) {
  return rows
    .filter(row => {
      const customer = clean(row["CUSTOMER"]);
      return customer && !customer.startsWith("PLEASE LIST THE INVOICE");
    })
    .map(row => outboundRow({
      source: "WH TRUCKING",
      customer: row["CUSTOMER"],
      invoice: row["INVOICE NO."],
      address: row["ADDRESS"],
      shipDate: row["SHIP DATE"],
      qty: dimensionLineCount(row["LENGTH (IN)"], row["WIDTH (IN)"], row["HEIGHT (IN)"]) || row["Pallet Type"],
      length: row["LENGTH (IN)"],
      width: row["WIDTH (IN)"],
      height: row["HEIGHT (IN)"],
      weight: row["WEIGHT (LBS)"],
      carrier: row["CARRIER"],
      rate: row["RATE"],
      pro: row["PRO#"],
      note: row["NOTE"],
      status: row["STATUS"]
    }));
}

function mapB2bRows(rows) {
  return rows
    .filter(row => clean(row["NOTE"]))
    .map(row => outboundRow({
      source: "B2B/E-COM",
      customer: row["NOTE"],
      invoice: row["INVOICE"],
      address: row["TO"],
      shipDate: row["PU"],
      qty: row["PLT"],
      carrier: row["TRUCKING"],
      rate: row["RATE"],
      pro: row["PRO#"],
      note: joinNotes(`FROM: ${clean(row["FROM"])}`, row["REMARKS"]),
      status: row["STATUS"]
    }));
}

function mapTransferRows(rows) {
  return rows
    .filter(row => clean(row["FROM"]) || clean(row["TO"]))
    .map(row => {
      const from = clean(row["FROM"]);
      const to = clean(row["TO"]);
      return outboundRow({
        source: "TRANSFERS",
        customer: `TRANSFER ${from}${from && to ? " → " : ""}${to}`,
        invoice: row["INVOICE"] || row["BOL#"],
        address: to,
        shipDate: row["PU"],
        qty: row["PLT"],
        carrier: row["TRUCKING"],
        rate: row["RATE"],
        pro: row["BOL#"],
        note: joinNotes(row["NOTE"], `FROM: ${from}`),
        status: row["STATUS"]
      });
    });
}

function mapUltaRows(rows) {
  return rows
    .filter(row => clean(row["DC"]))
    .map(row => outboundRow({
      source: "ULTA",
      customer: row["DC"],
      invoice: row["PO#"],
      address: row["Ship To"],
      shipDate: row["ship date"] || row["Date"],
      qty: row["Total Cartons"],
      length: "48",
      width: "40",
      height: row["Height"],
      weight: row["Weight"],
      carrier: row["TRUCKING"],
      rate: row["RATE"],
      pro: row["PRO#"],
      note: joinNotes(`INVOICE: ${clean(row["Invoice"])}`, row["NOTE"]),
      status: row["STATUS"]
    }));
}

function mapIherbRows(rows) {
  return rows
    .filter(row => clean(row["PO#"]))
    .map(row => outboundRow({
      source: "IHERB",
      customer: `IHERB - ${clean(row["TO"])}`,
      invoice: row["PO#"],
      address: row["TO"],
      shipDate: row["PU"] || row["DELIVERY APPT"],
      qty: row["QTY"] ? `${clean(row["QTY"])} PALLETS` : "",
      carrier: row["TRUCKING"],
      rate: row["RATE"],
      pro: row["BOL"],
      note: joinNotes(`APPT#: ${clean(row["APPT #"])}`, `DELIVERY: ${clean(row["DELIVERY APPT"])}`, `INVOICE: ${clean(row["INVOICE"])}`),
      status: row["STATUS"]
    }));
}

function outboundRow(data) {
  return {
    "SOURCE": clean(data.source),
    "CUSTOMER": clean(data.customer),
    "INVOICE NO.": clean(data.invoice),
    "ADDRESS": clean(data.address),
    "SHIP DATE": clean(data.shipDate),
    "Q'ty (Plts / Ctns)": clean(data.qty),
    "LENGTH (IN)": clean(data.length),
    "WIDTH (IN)": clean(data.width),
    "HEIGHT (IN)": clean(data.height),
    "WEIGHT (LBS)": clean(data.weight),
    "CARRIER": clean(data.carrier),
    "RATE": clean(data.rate),
    "PRO#": clean(data.pro),
    "NOTE": clean(data.note),
    "STATUS": clean(data.status)
  };
}

function buildStatusLookup(rows) {
  const maps = { exact: new Map(), pro: new Map(), invoice: new Map(), customerDate: new Map() };

  rows
    .filter(row => hasAnyValue(row) && clean(row["SOURCE"]) && clean(row["SOURCE"]) !== "SOURCE")
    .forEach(row => {
      const status = clean(row["STATUS"]);
      if (!status) return;
      const normalized = outboundRow({
        source: row["SOURCE"], customer: row["CUSTOMER"], invoice: row["INVOICE NO."],
        shipDate: row["SHIP DATE"], pro: row["PRO#"], status
      });
      maps.exact.set(statusKey(normalized), status);
      if (normalized["PRO#"]) maps.pro.set(`${norm(normalized["SOURCE"])}|${norm(normalized["PRO#"])}`, status);
      if (normalized["INVOICE NO."]) maps.invoice.set(`${norm(normalized["SOURCE"])}|${norm(normalized["INVOICE NO."])}`, status);
      maps.customerDate.set(`${norm(normalized["SOURCE"])}|${norm(normalized["CUSTOMER"])}|${dateKey(normalized["SHIP DATE"])}`, status);
    });

  return maps;
}

function applyStatusOverlay(row, maps) {
  const sourceStatus = clean(row["STATUS"]);
  const exact = maps.exact.get(statusKey(row));
  const byPro = row["PRO#"] && maps.pro.get(`${norm(row["SOURCE"])}|${norm(row["PRO#"])}`);
  const byInvoice = row["INVOICE NO."] && maps.invoice.get(`${norm(row["SOURCE"])}|${norm(row["INVOICE NO."])}`);
  const byCustomerDate = maps.customerDate.get(`${norm(row["SOURCE"])}|${norm(row["CUSTOMER"])}|${dateKey(row["SHIP DATE"])}`);
  row["STATUS"] = sourceStatus || exact || byPro || byInvoice || byCustomerDate || "";
  return row;
}

function statusKey(row) {
  return [row["SOURCE"], row["CUSTOMER"], row["INVOICE NO."], dateKey(row["SHIP DATE"]), row["PRO#"]]
    .map(norm)
    .join("|");
}

function isMeaningfulOutboundRow(row) {
  return Boolean(row["SOURCE"] && (row["CUSTOMER"] || row["INVOICE NO."] || row["PRO#"] || row["SHIP DATE"]));
}

function isOngoingInboundRow(row) {
  return !/\b(DELIVERED|COMPLETED|RECEIVED)\b/.test(norm(row["Inbound Status"]));
}

function isOngoingOutboundRow(row) {
  return !/\b(SHIPPED|DELIVERED|RECEIVED|COMPLETED)\b/.test(norm(row["STATUS"]));
}

function compareOutboundRows(a, b) {
  const shippedA = /SHIPPED|DELIVERED/.test(norm(a["STATUS"])) ? 0 : 1;
  const shippedB = /SHIPPED|DELIVERED/.test(norm(b["STATUS"])) ? 0 : 1;
  if (shippedA !== shippedB) return shippedA - shippedB;

  const dateA = parseSheetDate(a["SHIP DATE"]);
  const dateB = parseSheetDate(b["SHIP DATE"]);
  const timeA = dateA ? dateA.getTime() : Number.MAX_SAFE_INTEGER;
  const timeB = dateB ? dateB.getTime() : Number.MAX_SAFE_INTEGER;
  if (timeA !== timeB) return timeA - timeB;

  return norm(a["CUSTOMER"]).localeCompare(norm(b["CUSTOMER"]));
}

function dateKey(value) {
  const parsed = parseSheetDate(value);
  if (!parsed) return norm(value);
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
}

function dimensionLineCount(...values) {
  return Math.max(0, ...values.map(value => clean(value).split(/\n+/).filter(Boolean).length));
}

function joinNotes(...values) {
  return values.map(clean).filter(value => value && !value.endsWith(":")).join(" | ");
}

function clean(value) {
  return String(value ?? "").trim();
}
