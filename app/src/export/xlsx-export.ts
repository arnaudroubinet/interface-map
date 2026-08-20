import * as XLSX from "xlsx";
import { téléchargerClasseur } from "./telechargement";
import type { MatrixResult } from "../aggregation/views";
import { libelleCellule } from "../aggregation/core";

// La matrice telle qu'elle est lue à l'écran -- c'est le même objet, déjà
// élagué : une ligne par émetteur, une colonne par destinataire, et dans la
// case les technologies du lien.
function grilleMatrice(matrix: MatrixResult): string[][] {
  const entete = ["From \\ To", ...matrix.colonnes];
  const lignes = matrix.lignes.map((ligne) => [
    ligne.acteur,
    ...matrix.colonnes.map((cible) =>
      (ligne.cellules.get(cible) ?? [])
        .map((c) => libelleCellule(c.technologie, c.count, c.noms))
        .join(", ")
    ),
  ]);
  return [entete, ...lignes];
}

// Le même contenu à plat. Excel ne sait rien faire d'une grille creuse : c'est
// cette feuille-là qu'on trie et qu'on met en tableau croisé.
function listeDesFlux(matrix: MatrixResult): (string | number)[][] {
  const lignes: (string | number)[][] = [["From", "To", "Technology", "Count", "Attenuated"]];
  for (const ligne of matrix.lignes) {
    for (const [cible, cellules] of ligne.cellules) {
      for (const cell of cellules) {
        lignes.push([ligne.acteur, cible, cell.technologie, cell.count, cell.atténué ? "Yes" : ""]);
      }
    }
  }
  return lignes;
}

function largeurs(grille: string[][]): { wch: number }[] {
  return grille[0].map((_, colonne) =>
    ({ wch: Math.min(28, Math.max(10, ...grille.map((l) => (l[colonne] ?? "").length + 2))) })
  );
}

// Séparé du téléchargement : c'est la partie qui décide du contenu, donc la
// seule qui vaille d'être testée. Le reste n'est que du DOM.
export function construireClasseurMatrice(matrix: MatrixResult): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();

  const grille = grilleMatrice(matrix);
  const feuilleMatrice = XLSX.utils.aoa_to_sheet(grille);
  feuilleMatrice["!cols"] = largeurs(grille);
  // Pas de volets figés : SheetJS en édition communautaire n'écrit pas la
  // balise <pane>, on l'a vérifié sur le fichier produit. Ce qu'il écrit
  // vraiment, ce sont les largeurs de colonnes et l'autofiltre -- c'est donc
  // sur ceux-là qu'on s'appuie, et sur la feuille « Flux », qui est celle
  // qu'on trie réellement dans Excel.
  feuilleMatrice["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: 0, c: grille[0].length - 1 } }) };
  XLSX.utils.book_append_sheet(wb, feuilleMatrice, "Matrix");

  const plat = listeDesFlux(matrix);
  const feuilleFlux = XLSX.utils.aoa_to_sheet(plat);
  feuilleFlux["!cols"] = [{ wch: 26 }, { wch: 26 }, { wch: 18 }, { wch: 9 }, { wch: 9 }];
  feuilleFlux["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: 0, c: 4 } }) };
  XLSX.utils.book_append_sheet(wb, feuilleFlux, "Flows");

  return wb;
}

export function downloadMatrixXlsx(matrix: MatrixResult, filename: string): void {
  const wb = construireClasseurMatrice(matrix);
  const donnees = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  téléchargerClasseur(donnees, filename);
}
