import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { buildMatrixWorkbook } from "./xlsx-export";
import type { MatrixResult } from "../aggregation/views";
import * as base from "../testing/fixtures";

// Le tableau arrive déjà élagué : ni Kamino ni Muet n'émettent, ils n'ont donc
// pas de ligne, et Tatooine ne reçoit rien, il n'a pas de colonne.
const matrix: MatrixResult = base.matrix({
  columns: ["Kamino", "Muet"],
  rows: [
    {
      actor: "Tatooine",
      cells: new Map([
        ["Kamino", [{ technology: "HTTP", count: 3, attenuated: false, names: [] }]],
        ["Muet", [{ technology: "Kafka", count: 1, attenuated: true, names: [] }]],
      ]),
    },
  ],
});

// On relit le classeur écrit, pas l'objet en mémoire : c'est le fichier reçu
// dans Excel qui compte.
function producedWorkbook(): XLSX.WorkBook {
  const wb = buildMatrixWorkbook(matrix);
  const bytes = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  return XLSX.read(new Uint8Array(bytes), { type: "array" });
}

describe("export Excel de la matrix", () => {
  it("écrit une feuille grille et une feuille à plat", () => {
    const wb = producedWorkbook();
    expect(wb.SheetNames).toEqual(["Matrix", "Flows"]);
  });

  it("place les technologies à l'intersection émetteur/destinataire", () => {
    const wb = producedWorkbook();
    const grille = XLSX.utils.sheet_to_json<string[]>(wb.Sheets.Matrix, { header: 1, defval: "" });
    expect(grille[0]).toEqual(["From \\ To", "Kamino", "Muet"]);
    expect(grille[1][0]).toBe("Tatooine");
    expect(grille[1][1]).toBe("HTTP ×3");
    expect(grille).toHaveLength(2);
  });

  it("déplie un flux par ligne dans la feuille à plat, avec son compte", () => {
    const wb = producedWorkbook();
    const flows = XLSX.utils.sheet_to_json<Record<string, string | number>>(wb.Sheets.Flows, { defval: "" });
    expect(flows).toEqual([
      { From: "Tatooine", To: "Kamino", Technology: "HTTP", Count: 3, Attenuated: "" },
      { From: "Tatooine", To: "Muet", Technology: "Kafka", Count: 1, Attenuated: "Yes" },
    ]);
  });

  // Ce qui rend la grille exploitable dans Excel et que la bibliothèque écrit
  // réellement : l'autofiltre sur la ligne d'en-tête. Les volets figés, eux,
  // ne sont pas produits par l'édition communautaire.
  it("pose un autofiltre sur l'en-tête des deux feuilles", () => {
    const wb = producedWorkbook();
    expect(wb.Sheets.Matrix["!autofilter"]).toBeDefined();
    expect(wb.Sheets.Flows["!autofilter"]).toBeDefined();
  });

});

// En mode fonctionnel, la technologie est vidée (§4.2) : sans ce compteur de
// repli, la grille exportée n'a plus que ses en-têtes -- un classeur qui a
// l'air correct et qui ne dit à personne qu'il ne montre plus rien.
describe("export Excel de la matrix — mode fonctionnel (technologie vide)", () => {
  const functionalMatrix: MatrixResult = base.matrix({
    columns: ["Kamino", "Muet"],
    rows: [
      {
        actor: "Tatooine",
        cells: new Map([
          ["Kamino", [{ technology: "", count: 1, attenuated: false, names: [] }]],
          ["Muet", [{ technology: "", count: 3, attenuated: false, names: [] }]],
        ]),
      },
    ],
  });

  function functionalWorkbook(): XLSX.WorkBook {
    const wb = buildMatrixWorkbook(functionalMatrix);
    const bytes = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
    return XLSX.read(new Uint8Array(bytes), { type: "array" });
  }

  it("montre le compteur seul quand il n'y a pas de technologie", () => {
    const wb = functionalWorkbook();
    const grille = XLSX.utils.sheet_to_json<string[]>(wb.Sheets.Matrix, { header: 1, defval: "" });
    expect(grille[1][1]).toBe("1");
    expect(grille[1][2]).toBe("3");
  });
});

// --- « Ce qui est à l'écran est ce qui s'exporte » : l'ordre des lignes se
// décide dans buildMatrixView, une fois, et l'export ne doit surtout pas le
// retrier -- sinon le classeur emporté n'est pas le tableau qu'on avait sous
// les yeux.
describe("construireClasseurMatrice — l'ordre reçu est l'ordre écrit", () => {
  const cellule = { technology: "HTTP", count: 1, attenuated: false, names: [] };
  const nonAlphabetique = base.matrix({
    columns: ["Zeffo", "Bracca"],
    rows: [
      { actor: "Zeffo", cells: new Map([["Bracca", [cellule]]]) },
      { actor: "Bracca", cells: new Map([["Zeffo", [cellule]]]) },
    ],
  });

  it("écrit les lignes dans l'ordre du tableau, pas dans l'ordre alphabétique", () => {
    const sheet = buildMatrixWorkbook(nonAlphabetique).Sheets["Matrix"];
    expect([sheet.A2.v, sheet.A3.v]).toEqual(["Zeffo", "Bracca"]);
  });

  it("écrit les colonnes dans l'ordre du tableau", () => {
    const sheet = buildMatrixWorkbook(nonAlphabetique).Sheets["Matrix"];
    expect([sheet.B1.v, sheet.C1.v]).toEqual(["Zeffo", "Bracca"]);
  });
});
