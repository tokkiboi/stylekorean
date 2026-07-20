const SPREADSHEET_ID = "1M-vZ24Yw4ZN7R7b_473cVn8kny8DznTakSsD3VQsCzc";

const STATUS_OPTIONS = [
  "Scheduled", "Work in Progress", "Pending", "Shipping", "Shipped",
  "Delivered", "Received", "Cancelled", "Completed"
];
const ALLOWED_SHEETS = [
  "WH Trucking Request", "B2B/E-COM TRUCKING", "TRANSFERS", "ULTA", "IHERB",
  "IMPORTS", "NATIONAL ORDER PROGRESS", "NATIONAL SHIP OUT SCHEDULE",
  "TJX/ROSS", "TJX/ROSS DIMENSION"
];

function doGet() {
  return json_({ ok: true, service: "StyleKorean shipment status", statuses: STATUS_OPTIONS });
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const request = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    validateRequest_(request);
    const status = canonicalStatus_(request.status);
    const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = spreadsheet.getSheetByName(request.sourceSheet);
    if (!sheet) throw new Error("Source sheet not found.");

    const target = request.kind === "inbound"
      ? findInboundTarget_(sheet, request)
      : findOutboundTarget_(sheet, request);

    const current = String(target.getDisplayValue() || "").trim();
    if (String(request.currentStatus || "").trim() &&
        current.toUpperCase() !== String(request.currentStatus).trim().toUpperCase()) {
      throw new Error("Status changed in Google Sheets. Refresh and try again.");
    }

    target.setValue(status);
    SpreadsheetApp.flush();
    return json_({ ok: true, sheet: sheet.getName(), row: target.getRow(), column: target.getColumn(), status });
  } catch (error) {
    return json_({ ok: false, error: String(error.message || error) });
  } finally {
    lock.releaseLock();
  }
}

function canonicalStatus_(value) {
  const wanted = String(value || "").trim().toUpperCase();
  const status = STATUS_OPTIONS.find(item => item.toUpperCase() === wanted);
  if (!status) throw new Error("Status is not allowed.");
  return status;
}

function validateRequest_(request) {
  if (!["outbound", "inbound"].includes(request.kind)) throw new Error("Invalid relation kind.");
  if (!ALLOWED_SHEETS.includes(request.sourceSheet)) throw new Error("Source sheet is not allowed.");
}

function findInboundTarget_(sheet, request) {
  const row = Number(request.sourceRow);
  if (!Number.isInteger(row) || row < 3 || row > sheet.getLastRow()) throw new Error("Invalid IMPORTS source row.");
  const headers = sheet.getRange(1, 1, 3, sheet.getLastColumn()).getDisplayValues();
  const header = findHeader_(headers, ["WEBSITE STATUS", "STATUS", "INBOUND STATUS"]);
  if (!header) throw new Error("Inbound status column not found.");
  return sheet.getRange(row, header.column);
}

function findOutboundTarget_(sheet, request) {
  const values = sheet.getDataRange().getDisplayValues();
  const header = findHeader_(values.slice(0, 4), ["WEBSITE STATUS", "STATUS", "OVERALL PO STATUS", "WORK PROGRESS"]);
  if (!header) throw new Error("Status column not found.");
  const map = headerMap_(values[header.row - 1]);

  const sourceRow = Number(request.sourceRow);
  if (Number.isInteger(sourceRow) && sourceRow > header.row && sourceRow <= values.length) {
    const row = values[sourceRow - 1];
    if (identityScore_(row, map, request) > 0) return sheet.getRange(sourceRow, header.column);
  }

  const candidates = [];
  for (let r = header.row; r < values.length; r++) {
    const score = identityScore_(values[r], map, request);
    if (score) candidates.push({ row: r + 1, score });
  }
  candidates.sort((a, b) => b.score - a.score);
  if (!candidates.length || (candidates[1] && candidates[0].score === candidates[1].score)) {
    throw new Error("Could not identify one unique source row.");
  }
  return sheet.getRange(candidates[0].row, header.column);
}

function identityScore_(row, map, request) {
  let score = 0;
  score += exact_(row, map, ["PRO#", "BOL", "BOL#", "PU#"], request.pro) ? 100 : 0;
  score += exact_(row, map, ["INVOICE", "INVOICE NO.", "PO#", "ORDER#", "ORDER NAME"], request.invoice) ? 50 : 0;
  score += exact_(row, map, ["CUSTOMER", "NOTE", "DC", "CHANNEL", "ORDER NAME"], request.customer) ? 20 : 0;
  score += exact_(row, map, ["SHIP DATE", "PU", "DATE", "START SHIP", "PICK-UP DATE", "SSD", "SHIPOUT DATE"], request.shipDate) ? 10 : 0;
  return score;
}

function findHeader_(rows, names) {
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < rows[r].length; c++) {
      if (names.includes(String(rows[r][c] || "").trim().toUpperCase())) return { row: r + 1, column: c + 1 };
    }
  }
  return null;
}

function headerMap_(headers) {
  return headers.reduce((map, value, index) => {
    map[String(value || "").trim().toUpperCase()] = index;
    return map;
  }, {});
}

function exact_(row, map, names, expected) {
  const wanted = String(expected || "").trim().toUpperCase();
  if (!wanted) return false;
  return names.some(name => map[name] !== undefined && String(row[map[name]] || "").trim().toUpperCase() === wanted);
}

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
