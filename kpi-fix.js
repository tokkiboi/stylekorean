/* KPI correction layer
   Uses live outboundRows so metrics include source-synced rows.
*/

(() => {
  function refreshCorrectedKpis() {
    if (!Array.isArray(window.outboundRows)) return;

    const rows = window.outboundRows;
    const completed = /(SHIPPED|DELIVERED|RECEIVED|COMPLETED)/;
    const shipped = rows.filter(r => completed.test(String(r["STATUS"] || "").toUpperCase())).length;

    const now = new Date();
    const ytd = rows.filter(r => {
      const d = new Date(r["SHIP DATE"]);
      return !isNaN(d) && d.getFullYear() === now.getFullYear();
    });
    const mtd = ytd.filter(r => {
      const d = new Date(r["SHIP DATE"]);
      return d.getMonth() === now.getMonth();
    });

    const cost = list => list.reduce((sum, r) => sum + parseFloat(String(r["RATE"] || "").replace(/[^0-9.]/g, "") || 0), 0);

    const set = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    };

    set("kpiShipped", shipped.toLocaleString());
    set("kpiYtdCost", formatCurrency(cost(ytd)));
    set("kpiMtdCost", formatCurrency(cost(mtd)));
  }

  document.addEventListener("DOMContentLoaded", () => {
    setTimeout(refreshCorrectedKpis, 1500);
  });

  window.refreshCorrectedKpis = refreshCorrectedKpis;
})();
