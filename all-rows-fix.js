/* Ensure every filtered schedule entry is rendered.
   Loaded after app.js so it replaces the previous 1,000-row display cap. */

function renderTable(tableId, rows, columns, cellDecorator) {
  const table = document.getElementById(tableId);
  if (!table) return;

  const thead = table.querySelector("thead");
  const tbody = table.querySelector("tbody");
  thead.innerHTML = `<tr>${columns.map(col => `<th>${escapeHtml(col)}</th>`).join("")}</tr>`;
  tbody.innerHTML = "";

  const fragment = document.createDocumentFragment();
  rows.forEach(row => {
    const tr = document.createElement("tr");
    columns.forEach(col => {
      const td = document.createElement("td");
      td.innerHTML = cellDecorator(col, row[col] || "", row);
      tr.appendChild(td);
    });
    fragment.appendChild(tr);
  });

  tbody.appendChild(fragment);

  if (!rows.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = columns.length;
    td.className = "cell-muted";
    td.textContent = "No matching schedule entries.";
    tr.appendChild(td);
    tbody.appendChild(tr);
  }
}
