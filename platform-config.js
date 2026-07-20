"use strict";

/* Central integration manifest. Authenticated providers must use a private
   server-side endpoint; never place credentials in this public file. */
window.STYLEKOREAN_PLATFORM = Object.freeze({
  version: "1.2.0",
  refreshMs: 10 * 60 * 1000,
  providers: Object.freeze({
    googleSheets: Object.freeze({ label: "Google Sheets", access: "Public read-only" }),
    secureApi: Object.freeze({ label: "Secure API", access: "Server-side credentials" })
  }),
  workbook: Object.freeze({
    id: "1M-vZ24Yw4ZN7R7b_473cVn8kny8DznTakSsD3VQsCzc",
    label: "LOGISTICS MASTER 2026"
  }),
  finishedStatuses: Object.freeze(["Shipped", "Delivered", "Received", "Completed", "Cancelled"]),
  parcelStatusOverrides: Object.freeze({ "4634189291": "Delivered" }),
  sources: Object.freeze([
    { id: "imports", tab: "IMPORTS", range: "A:AF", kind: "inbound", provider: "googleSheets", gid: 1497250700 },
    { id: "transfers", tab: "TRANSFERS", range: "A:N", kind: "outbound", provider: "googleSheets", gid: 1834454901 },
    { id: "ulta", tab: "ULTA", range: "A:N", kind: "outbound", provider: "googleSheets", gid: 360479919 },
    { id: "iherb", tab: "IHERB", range: "A:M", kind: "outbound", provider: "googleSheets", gid: 955532469 },
    { id: "b2b", tab: "B2B/E-COM TRUCKING", range: "A:R", kind: "outbound", provider: "googleSheets", gid: 1971553563 },
    { id: "wh-trucking", tab: "WH Trucking Request", range: "A2:U", kind: "outbound", provider: "googleSheets", gid: 852802817 },
    { id: "national-orders", tab: "NATIONAL ORDER PROGRESS", range: "A:U", kind: "outbound", provider: "googleSheets", gid: 2026071601 },
    { id: "national-ship-out", tab: "NATIONAL SHIP OUT SCHEDULE", range: "A:K", kind: "outbound", provider: "googleSheets", gid: 20260708 },
    { id: "tjx-ross", tab: "TJX/ROSS DIMENSION", range: "A:R", kind: "outbound", provider: "googleSheets", gid: 1110009873 },
    { id: "website-exclusions", tab: "OUTBOUND WEBSITE EXCLUSIONS", range: "A:C", kind: "filter", provider: "googleSheets", gid: 2026071701 }
  ]),
  kpiSource: Object.freeze({ id: "outbound-kpis", tab: "All Outbound Shipping Schedule", range: "Z1:AA5", kind: "kpi", provider: "googleSheets", gid: 20260708 })
});
