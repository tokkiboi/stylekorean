const fs = require("fs");
const els = {};
function el(id) {
  if (!els[id]) els[id] = {
    id, innerHTML: "", textContent: "", value: "", checked: false,
    classList: { toggle() {}, add() {}, remove() {} },
    firstElementChild: {}, append() {}, appendChild() {},
    addEventListener() {}, querySelector() { return null; }
  };
  return els[id];
}
global.document = {
  querySelectorAll: () => [],
  getElementById: el,
  addEventListener: (ev, fn) => { if (ev === "DOMContentLoaded") global.__boot = fn; },
  createElement: (t) => ({ tagName: t, className: "", innerHTML: "", textContent: "", appendChild() {}, append() {} }),
  createDocumentFragment: () => ({ appendChild() {} }),
  hidden: false
};
global.window = global;
global.setInterval = () => {};

function gviz(cols, rows) {
  return "x(" + JSON.stringify({
    table: {
      cols: cols.map((l) => ({ label: l })),
      rows: rows.map((r) => ({ c: r.map((v) => (v == null ? null : { v: String(v) })) }))
    }
  }) + ")";
}

const payloads = {
  "IMPORTS": gviz(
    ["SHIPMENT", "INVOICE", "CONTAINER", "MBL", "HBL", "VSL", "ETA", "NOTES", "RESERVED", "DELIVERY EXPECTED"],
    [
      ["SHP-101", "IN00455649", "TCNU1234567", "MBL777", "HBL888", "HMM GARNET", "07/25/2026", "in transit", "", ""],
      ["UPS", null, null, null, null, null, null, null, null, null],
      [null, "1Z999AA10123456784", "IN00456708", "Seoul", "label created, not shipped", null, null, null, null, null]
    ]),
  "TRANSFERS": gviz(
    ["PU", "TO", "INVOICE", "VENDOR", "TRUCKING", "BOL#", "PLT", "RATE", "STATUS", "NOTE"],
    [["07/20/2026", "NJ WAREHOUSE", "IN123", "CA SFS", "TQL", "BOL1", "4", "$350", "", "urgent"]]),
  "ULTA": gviz(
    ["SHIP DATE", "DC", "PO#", "TRUCKING", "PRO#", "TOTAL CARTONS", "SHIP TO", "RATE", "STATUS", "NOTE", "REMARKS"],
    [["07/22/2026", "CHAMBERSBURG", "101295829", "PRIORITY1", "", "38", "95 Kriner Rd", "$568.98", "", "", ""]]),
  "IHERB": gviz(
    ["PU", "DELIVERY APPT", "PO#", "TRUCKING", "BOL", "QTY", "TO", "RATE", "STATUS", "NOTE", "REMARKS"],
    [["07/21/2026", "", "PO-IH-1", "RXO", "", "10", "Moreno Valley", "$400", "", "", ""]]),
  "B2B/E-COM TRUCKING": gviz(
    ["PU", "NOTE", "INVOICE", "TRUCKING", "PRO#", "PLT", "TO", "RATE"],
    [
      ["07/23/2026", "STEFANO MAKEUP", "IN00456708", "SAIA", "PRO9", "2", "Dallas TX", "$275"],
      ["07/24/2026", "HIDDEN ROW", "IN999", "SAIA", "PROX", "1", "LA", "$99"]
    ]),
  "WH Trucking Request": gviz(
    ["CUSTOMER", "INVOICE NO.", "ADDRESS", "SHIP DATE", "PALLET TYPE", "CARRIER", "RATE", "PRO#", "NOTE", "STATUS", "REMARKS"],
    [
      ["PLEASE LIST THE INVOICE WITH SHIPPING CHARGE", "", "", "", "", "", "", "", "", "", ""],
      ["J AND Y INTERNATIONAL", "IN00455649", "Carrollton TX", "07/19/2026", "STD", "FEDEX", "$120", "", "", "", ""]
    ]),
  "NATIONAL ORDER PROGRESS": gviz(
    ["PICK-UP DATE", "START SHIP", "CHANNEL", "PO#", "ORDER#", "DEPARTMENT", "SHIPMENT TYPE", "MEMO", "OVERALL PO STATUS"],
    [
      ["07/24/2026", "", "MACYS", "PO-N-1", "", "BEAUTY", "TRUCKING", "", "WORKING"],
      ["", "", "NO DATE", "PO-N-2", "", "BEAUTY", "TRUCKING", "", "WORKING"]
    ]),
  "NATIONAL SHIP OUT SCHEDULE": gviz(
    ["ACCOUNT", "ORDER NAME", "# OF POS", "SHIP METHOD", "# OF PALLETS", "# OF CARTONS", "ROUTING DATE", "SSD", "CANCEL DATE", "NOTE", "WORK PROGRESS"],
    [
      ["ROSS", "106k (07/29)", "1", "Trucking", "5", "320", "07/22", "07/29", "", "", "Working"],
      ["Account", "Order/PO#", "", "", "", "", "Routing Date", "Start Ship Date", "", "", ""],
      ["ULTA STY", "STY#25", "", "UPS", "", "", "Routing Date", "Start Ship Date", "", "", ""]
    ]),
  "TJX/ROSS DIMENSION": gviz(
    ["ORDER RECEIVED", "ORDER NAME", "DC#", "PO# ", "SHIPMENT #", "PU#", "ALT. PU# (EG.NRT#)", " PLANNED QTY", "BOX", "WEIGHT (LBS)", "PLT", "CU", "SSD", "CANCEL DATE", "SHIPOUT DATE", "BOL", "CARRIER", "STATUS"],
    [
      ["01/26", "ROSS 120K", "SWDC", "11603064", "2264700", "CS02327772", "", "13410", "467", "13246", "8", "", "2/2/2026", "", "", "CS02327772", "Paystar Logistics", "Shipped"],
      ["", "", "SWDC", "11603077", "2264702", "72129285", "", "12100", "303", "8997", "6", "", "2/11/2026", "", "07/20/2026", "CS02333717", "Performance Team", ""]
    ]),
  "OUTBOUND WEBSITE EXCLUSIONS": gviz(["SOURCE", "KEY", "REASON"], [["B2B/E-COM TRUCKING", "PROX", "private"]])
};
const kpiPayload = gviz([], []).replace('"rows":[]',
  '"rows":[{"c":[{"v":"YTD SHIPPING COST"},{"v":"$123,456"}]},{"c":[{"v":"MTD SHIPPING COST"},{"v":"$7,890"}]}]');

global.fetch = async (u) => {
  const url = new URL(u);
  const tab = url.searchParams.get("sheet");
  const body = tab === "All Outbound Shipping Schedule" ? kpiPayload : payloads[tab] || null;
  if (!body) return { ok: false, status: 404, text: async () => "" };
  return { ok: true, status: 200, text: async () => body };
};

require("vm").runInThisContext(fs.readFileSync(__dirname + "/app.js", "utf8"), { filename: "app.js" });

(async () => {
  global.__boot();
  await new Promise((r) => setTimeout(r, 100));
  const g = (c) => require("vm").runInThisContext(c);
  const out = g("outboundRows");
  console.log("OUTBOUND (" + out.length + "):");
  out.forEach((r) => console.log("  " + [r.source, r.customer, r.shipDate, r.units, r.status].join(" | ")));
  console.log("INBOUND:", g("inboundRows").map((r) => r.mode + ":" + (r.container || r.mbl) + " eta " + r.eta).join(", "));
  console.log("PARCELS:", g("parcelRows").map((p) => p.carrier + ":" + p.tracking + " status " + p.status).join(", "));
  console.log("COSTS:", JSON.stringify(g("costSummary")));
  console.log("HEALTH:", g("sourceHealth").filter((s) => s.ok).length + "/" + g("sourceHealth").length);
  console.log("SYNC:", els["sync"].textContent);

  /* assertions */
  const assert = (cond, msg) => { if (!cond) { console.error("ASSERT FAIL: " + msg); process.exitCode = 1; } };
  assert(out.length === 9, "expected 9 outbound rows, got " + out.length);
  assert(!out.some((r) => r.pro === "PROX"), "exclusion row leaked");
  assert(!out.some((r) => r.customer === "NO DATE"), "undated National Order Progress row leaked");
  assert(g('classifyStatus("shipped")') === "Completed", "shipped was not completed");
  assert(g('classifyStatus("done")') === "Completed", "done was not completed");
  assert(g('classifyStatus("greyed out")') === "Completed", "explicit greyed-out marker was not completed");
  assert(g('effectiveStatus({ AUXILIARY: "done" }, "Scheduled")') === "Completed", "completion marker outside the mapped status column was missed");
  assert(g('effectiveStatus({ AUXILIARY: "cancelled" }, "Shipping")') === "Cancelled", "cancellation marker outside the mapped status column was missed");
  assert(g('classifyStatus("received")') === "Received", "received was not finished");
  assert(g('classifyStatus("delivered")') === "Delivered", "delivered was not finished");
  assert(g('classifyStatus("cancelled")') === "Cancelled", "cancelled was not finished");
  assert(g("activeOutbound()").every((r) => !g("FINISHED").has(r.status)), "finished row leaked into active outbound");
  assert(g("filteredOutbound()").length === 8, "finished row leaked into default table view");
  els["showFinished"].checked = true;
  assert(g("filteredOutbound()").length === 9, "Show finished did not reveal completed rows");
  assert(!out.some((r) => r.customer === "Account" || r.invoice === "Order/PO#"), "placeholder rows leaked");
  assert(out.some((r) => r.source === "TJX/ROSS" && r.customer === "ROSS 120K" && r.invoice === "11603077"), "TJX/ROSS carry-forward failed");
  assert(out.some((r) => r.source === "National Ship Out" && r.units === "5 Pallets"), "National Ship Out mapping failed");
  assert(g("inboundRows").length === 1 && g("inboundRows")[0].container === "TCNU1234567", "inbound container parse failed");
  assert(g("parcelRows").length === 1 && g("parcelRows")[0].carrier === "UPS" && g("parcelRows")[0].status === "Scheduled", "parcel parse failed");
  assert(g("costSummary").ytd === 123456 && g("costSummary").mtd === 7890, "KPI block override failed");
  assert(g("sourceHealth").length === 11, "expected 11 sources tracked");
  assert(els["sourceStrip"].innerHTML.includes("#gid=1497250700"), "IMPORTS source link missing");
  assert(els["sourceStrip"].innerHTML.includes("noopener noreferrer"), "source links are not safely opened");
  console.log(process.exitCode ? "SMOKE TEST FAILED" : "SMOKE TEST PASSED ✔");
})().catch((e) => { console.error("FAIL", e); process.exit(1); });
