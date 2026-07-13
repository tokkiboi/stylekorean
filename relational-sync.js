/* Relational Google Sheets status editing.
   Set APPS_SCRIPT_URL after deploying google-apps-script/Code.gs. */
(() => {
  const RELATIONAL = {
    appsScriptUrl: "",
    outboundStatuses: ["SHIPPING", "DELIVERED", "RECEIVED", "COMPLETED"],
    inboundStatuses: ["N/A", "Delivered", "Customs Clearance", "FDA Review/Hold", "FWS Review/Hold", "Delayed"]
  };

  // Include the existing source-row and source-link columns from the inbound relation.
  if (window.CONFIG?.sheets?.inbound) CONFIG.sheets.inbound.range = "A3:S1200";

  const oldOutboundDecorator = window.decorateOutboundCell;
  const oldInboundDecorator = window.decorateInboundCell;

  window.decorateOutboundCell = function (col, value, row) {
    if (col !== "STATUS") return oldOutboundDecorator(col, value, row);
    return statusEditor("outbound", value, row, RELATIONAL.outboundStatuses);
  };

  window.decorateInboundCell = function (col, value, row) {
    if (col !== "Inbound Status") return oldInboundDecorator(col, value, row);
    return statusEditor("inbound", value, row, RELATIONAL.inboundStatuses);
  };

  function statusEditor(kind, value, row, allowed) {
    if (!RELATIONAL.appsScriptUrl) {
      return `${statusPill(value)}<small class="relation-disabled" title="Deploy the Apps Script endpoint to enable write-back">read only</small>`;
    }
    const payload = encodeURIComponent(JSON.stringify(buildRelation(kind, row)));
    const options = allowed.map(status =>
      `<option value="${escapeAttribute(status)}" ${norm(status) === norm(value) ? "selected" : ""}>${escapeHtml(status)}</option>`
    ).join("");
    return `<select class="relational-status" data-relation="${payload}" data-original="${escapeAttribute(value)}" aria-label="Update shipment status">
      <option value="" ${value ? "" : "selected"}>Blank</option>${options}
    </select><span class="relation-result" aria-live="polite"></span>`;
  }

  function buildRelation(kind, row) {
    if (kind === "inbound") {
      return {
        kind,
        sourceSheet: "IMPORTS",
        sourceRow: Number(row["IMPORTS Source Row"]) || null,
        key: row["Shipment #"] || row["Container"] || row["HBL"] || row["MBL"],
        currentStatus: row["Inbound Status"] || ""
      };
    }
    return {
      kind,
      sourceSheet: sourceSheetName(row["SOURCE"]),
      source: row["SOURCE"] || "",
      pro: row["PRO#"] || "",
      invoice: row["INVOICE NO."] || "",
      customer: row["CUSTOMER"] || "",
      shipDate: row["SHIP DATE"] || "",
      currentStatus: row["STATUS"] || ""
    };
  }

  function sourceSheetName(source) {
    return ({
      "WH TRUCKING": "WH Trucking Request",
      "B2B/E-COM": "B2B/E-COM TRUCKING",
      "TRANSFERS": "TRANSFERS",
      "ULTA": "ULTA",
      "IHERB": "IHERB"
    })[String(source || "").toUpperCase()] || "";
  }

  document.addEventListener("change", async event => {
    const select = event.target.closest(".relational-status");
    if (!select) return;
    const result = select.nextElementSibling;
    const original = select.dataset.original || "";
    select.disabled = true;
    result.textContent = "Saving…";
    try {
      const relation = JSON.parse(decodeURIComponent(select.dataset.relation));
      const response = await fetch(RELATIONAL.appsScriptUrl, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ ...relation, status: select.value })
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Update failed");
      select.dataset.original = select.value;
      result.textContent = "Saved";
      setTimeout(() => { result.textContent = ""; refreshAll(); }, 900);
    } catch (error) {
      select.value = original;
      result.textContent = error.message || "Not saved";
      console.error("Google Sheets write-back failed:", error);
    } finally {
      select.disabled = false;
    }
  });
})();