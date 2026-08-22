import type { MatrixResult } from "../aggregation/views";
import { cellLabel } from "../aggregation/core";

// The table received is final: buildMatrixView has already removed the rows
// and columns with no link. What is given is drawn, nothing more.
export function buildMatrixTable(
  matrix: MatrixResult,
  colorFor: (tech: string) => string,
  // The same title as the diagrams' title block: a table pasted into a document
  // said neither its workbook, nor its milestone, nor its reading.
  title?: string
): HTMLTableElement {
  const table = document.createElement("table");
  table.className = "matrix";

  if (title) {
    const legend = document.createElement("caption");
    legend.textContent = title;
    table.appendChild(legend);
  }

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  const coin = document.createElement("th");
  coin.className = "matrix-corner";
  coin.textContent = "From ↓ / To →";
  headRow.appendChild(coin);
  for (const actor of matrix.columns) {
    const th = document.createElement("th");
    // `scope` tells a screen reader which cells this header titles. Without it,
    // a 143-cell matrix reads as 143 numbers with no address.
    th.setAttribute("scope", "col");
    // The label lives in a span: THAT is what turns vertical, not the cell. The
    // cell stays in horizontal writing mode, so it sizes itself on the longest
    // name and centres its content -- with a fixed height, long names overflowed
    // and were clipped.
    const label = document.createElement("span");
    label.className = "matrix-header";
    label.textContent = actor;
    th.appendChild(label);
    headRow.appendChild(th);
  }
  const totalCol = document.createElement("th");
  totalCol.setAttribute("scope", "col");
  totalCol.className = "matrix-total";
  totalCol.appendChild(Object.assign(document.createElement("span"), { className: "matrix-header", textContent: "Total out" }));
  headRow.appendChild(totalCol);
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  for (const row of matrix.rows) {
    const tr = document.createElement("tr");
    const th = document.createElement("th");
    th.className = "matrix-actor";
    th.setAttribute("scope", "row");
    th.textContent = row.actor;
    tr.appendChild(th);

    for (const arrival of matrix.columns) {
      const td = document.createElement("td");
      for (const cell of row.cells.get(arrival) ?? []) {
        const span = document.createElement("span");
        span.className = "matrix-tech";
        // Colour goes on a chip, never on the text. It comes from the referential,
        // in free hexadecimal: a corporate palette is tuned for print and light
        // backgrounds, and four colours out of five fall below the contrast
        // threshold as soon as one reads in a dark theme. Carried by the text, an
        // unreadable colour made the data unreadable; carried by a chip, it stays
        // the reminder it always was and the label keeps the theme's ink.
        //
        //
        // No chip without a technology: the functional reading empties it, and an
        // empty chip would remind of nothing.
        if (cell.technology.trim()) {
          const pastille = document.createElement("span");
          pastille.className = "matrix-dot";
          pastille.style.backgroundColor = colorFor(cell.technology);
          span.appendChild(pastille);
        }
        span.appendChild(document.createTextNode(cellLabel(cell.technology, cell.count, cell.names)));
        // The whole list on hover: the label names only the first few.
        if (cell.names.length > 0) span.title = cell.names.join("\n");
        if (cell.attenuated) {
          span.dataset.dimmed = "true";
          span.style.opacity = "0.5";
        }
        td.appendChild(span);
      }
      tr.appendChild(td);
    }
    // The row's margin: how many flows leave it. Without it, naming the hub
    // meant counting cells by eye.
    const total = document.createElement("td");
    total.className = "matrix-total";
    total.textContent = String(matrix.rowTotals.get(row.actor) ?? 0);
    tr.appendChild(total);
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);

  const pied = document.createElement("tfoot");
  const trPied = document.createElement("tr");
  const coinPied = document.createElement("th");
  coinPied.setAttribute("scope", "row");
  coinPied.className = "matrix-total";
  coinPied.textContent = "Total in";
  trPied.appendChild(coinPied);
  for (const column of matrix.columns) {
    const td = document.createElement("td");
    td.className = "matrix-total";
    td.textContent = String(matrix.columnTotals.get(column) ?? 0);
    trPied.appendChild(td);
  }
  trPied.appendChild(document.createElement("td"));
  pied.appendChild(trPied);
  table.appendChild(pied);

  return table;
}
