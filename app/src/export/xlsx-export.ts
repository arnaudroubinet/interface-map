import * as XLSX from "xlsx";
import { downloadWorkbook } from "./download";
import type { MatrixResult } from "../aggregation/views";
import { cellLabel } from "../aggregation/core";

// La matrix telle qu'elle est lue à l'écran -- c'est le même objet, déjà
// élagué : une ligne par émetteur, une colonne par destinataire, et dans la
// case les technologies du lien.
function grilleMatrice(matrix: MatrixResult): string[][] {
  const header = ["From \\ To", ...matrix.columns];
  const rows = matrix.rows.map((row) => [
    row.actor,
    ...matrix.columns.map((target) =>
      (row.cellules.get(target) ?? [])
        .map((c) => cellLabel(c.technology, c.count, c.names))
        .join(", ")
    ),
  ]);
  return [header, ...rows];
}

// Le même contenu à plat. Excel ne sait rien faire d'une grille creuse : c'est
// cette feuille-là qu'on trie et qu'on met en tableau croisé.
function listeDesFlux(matrix: MatrixResult): (string | number)[][] {
  const rows: (string | number)[][] = [["From", "To", "Technology", "Count", "Attenuated"]];
  for (const row of matrix.rows) {
    for (const [target, cellules] of row.cellules) {
      for (const cell of cellules) {
        rows.push([row.actor, target, cell.technology, cell.count, cell.attenuated ? "Yes" : ""]);
      }
    }
  }
  return rows;
}

function largeurs(grille: string[][]): { wch: number }[] {
  return grille[0].map((_, column) =>
    ({ wch: Math.min(28, Math.max(10, ...grille.map((l) => (l[column] ?? "").length + 2))) })
  );
}

// Séparé du téléchargement : c'est la partie qui décide du contenu, donc la
// seule qui vaille d'être testée. Le reste n'est que du DOM.
export function buildMatrixWorkbook(matrix: MatrixResult): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();

  const grille = grilleMatrice(matrix);
  const matrixSheet = XLSX.utils.aoa_to_sheet(grille);
  matrixSheet["!cols"] = largeurs(grille);
  // Pas de volets figés : SheetJS en édition communautaire n'écrit pas la
  // balise <pane>, on l'a vérifié sur le fichier produit. Ce qu'il écrit
  // vraiment, ce sont les largeurs de colonnes et l'autofiltre -- c'est donc
  // sur ceux-là qu'on s'appuie, et sur la feuille « Flux », qui est celle
  // qu'on trie réellement dans Excel.
  matrixSheet["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: 0, c: grille[0].length - 1 } }) };
  XLSX.utils.book_append_sheet(wb, matrixSheet, "Matrix");

  const plat = listeDesFlux(matrix);
  const feuilleFlux = XLSX.utils.aoa_to_sheet(plat);
  feuilleFlux["!cols"] = [{ wch: 26 }, { wch: 26 }, { wch: 18 }, { wch: 9 }, { wch: 9 }];
  feuilleFlux["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: 0, c: 4 } }) };
  XLSX.utils.book_append_sheet(wb, feuilleFlux, "Flows");

  return wb;
}

export function downloadMatrixXlsx(matrix: MatrixResult, filename: string): void {
  const wb = buildMatrixWorkbook(matrix);
  const data = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  downloadWorkbook(data, filename);
}
