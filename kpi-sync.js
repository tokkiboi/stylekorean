/* Synchronizes the public dashboard with the protected KPI block in
   All Outbound Shipping Schedule!Z1:AA5. The KPI formulas in Sheets use
   the full dataset, so completed and filter-hidden shipments are included. */

(() => {
  const SHEET_ID = "1M-vZ24Yw4ZN7R7b_473cVn8kny8DznTakSsD3VQsCzc";
  const SHEET_NAME = "All Outbound Shipping Schedule";
  const KPI_RANGE = "Z1:AA5";

  document.addEventListener("DOMContentLoaded", () => {
    const refreshButton = document.getElementById("refreshBtn");
    refreshButton?.addEventListener("click", loadCostKpis);
    loadCostKpis();
  });

  async function loadCostKpis() {
    try {
      const rows = await fetchKpiRange();
      const metrics = Object.fromEntries(
        rows
          .map(row => [normalizeLabel(row[0]), row[1]])
          .filter(([label]) => label)
      );

      setText("kpiYtdCost", metrics["YTD SHIPPING COST"] || "—");
      setText("kpiYtdShipments", metrics["YTD SHIPMENTS"] || "—");
      setText("kpiAvgCost", metrics["AVG COST / SHIPMENT"] || "—");
      setText("kpiMtdCost", metrics["MTD SHIPPING COST"] || "—");
    } catch (error) {
      console.error("Could not load outbound KPI block:", error);
      ["kpiYtdCost", "kpiYtdShipments", "kpiAvgCost", "kpiMtdCost"]
        .forEach(id => setText(id, "Unavailable"));
    }
  }

  async function fetchKpiRange() {
    const url = new URL(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq`);
    url.searchParams.set("tqx", "out:json");
    url.searchParams.set("sheet", SHEET_NAME);
    url.searchParams.set("range", KPI_RANGE);

    const response = await fetch(url.toString(), { cache: "no-store" });
    if (!response.ok) throw new Error(`Google Sheets request failed: ${response.status}`);

    const text = await response.text();
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end < 0) throw new Error("Unexpected Google Visualization response.");

    const payload = JSON.parse(text.slice(start, end + 1));
    return payload.table.rows.map(row =>
      row.c.map(cell => {
        if (!cell) return "";
        if (cell.f !== undefined && cell.f !== null) return String(cell.f).trim();
        if (cell.v !== undefined && cell.v !== null) return String(cell.v).trim();
        return "";
      })
    );
  }

  function normalizeLabel(value) {
    return String(value || "").trim().toUpperCase();
  }

  function setText(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
  }
})();
