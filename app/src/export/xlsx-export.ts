import * as XLSX from "xlsx";
import { downloadWorkbook } from "./download";
import type { MatrixResult } from "../aggregation/views";
import { cellLabel } from "../aggregation/core";

// The matrix as it is read on screen -- it is the same object, already pruned:
// one row per sender, one column per receiver, and in the cell the link's
// technologies.
function matrixGrid(matrix: MatrixResult): string[][] {
  const header = ["From \\ To", ...matrix.columns];
  const rows = matrix.rows.map((row) => [
    row.actor,
    ...matrix.columns.map((target) =>
      (row.cells.get(target) ?? [])
        .map((c) => cellLabel(c.technology, c.count, c.names))
        .join(", ")
    ),
  ]);
  return [header, ...rows];
}

// The same content, flattened. Excel can do nothing with a sparse grid: it is
// that sheet one sorts and pivots.
function flowList(matrix: MatrixResult): (string | number)[][] {
  const rows: (string | number)[][] = [["From", "To", "Technology", "Count", "Attenuated"]];
  for (const row of matrix.rows) {
    for (const [target, cells] of row.cells) {
      for (const cell of cells) {
        rows.push([row.actor, target, cell.technology, cell.count, cell.attenuated ? "Yes" : ""]);
      }
    }
  }
  return rows;
}

function widths(grille: string[][]): { wch: number }[] {
  return grille[0].map((_, column) =>
    ({ wch: Math.min(28, Math.max(10, ...grille.map((l) => (l[column] ?? "").length + 2))) })
  );
}

// Separated from the download: this is the part that decides the content,
// hence the only one worth testing. The rest is nothing but DOM.
export function buildMatrixWorkbook(matrix: MatrixResult): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();

  const grille = matrixGrid(matrix);
  const matrixSheet = XLSX.utils.aoa_to_sheet(grille);
  matrixSheet["!cols"] = widths(grille);
  // No frozen panes: SheetJS in its community edition does not write the <pane>
  // tag, as verified on the produced file. What it really writes is column
  // widths and the autofilter -- so those are what is relied on, along with the
  // "Flux" sheet, which is the one actually sorted in Excel.
  //
  matrixSheet["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: 0, c: grille[0].length - 1 } }) };
  XLSX.utils.book_append_sheet(wb, matrixSheet, "Matrix");

  const plat = flowList(matrix);
  const flowsSheet = XLSX.utils.aoa_to_sheet(plat);
  flowsSheet["!cols"] = [{ wch: 26 }, { wch: 26 }, { wch: 18 }, { wch: 9 }, { wch: 9 }];
  flowsSheet["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: 0, c: 4 } }) };
  XLSX.utils.book_append_sheet(wb, flowsSheet, "Flows");

  return wb;
}

export function downloadMatrixXlsx(matrix: MatrixResult, filename: string): void {
  const wb = buildMatrixWorkbook(matrix);
  const data = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  downloadWorkbook(data, filename);
}
