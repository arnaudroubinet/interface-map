import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { construireClasseurMatrice } from "./xlsx-export";
import type { MatrixResult } from "../aggregation/views";
import * as base from "../testing/fixtures";

// Le tableau arrive déjà élagué : ni Kamino ni Muet n'émettent, ils n'ont donc
// pas de ligne, et Tatooine ne reçoit rien, il n'a pas de colonne.
const matrice: MatrixResult = base.matrice({
  colonnes: ["Kamino", "Muet"],
  lignes: [
    {
      acteur: "Tatooine",
      cellules: new Map([
        ["Kamino", [{ technologie: "HTTP", count: 3, atténué: false, noms: [] }]],
        ["Muet", [{ technologie: "Kafka", count: 1, atténué: true, noms: [] }]],
      ]),
    },
  ],
});

// On relit le classeur écrit, pas l'objet en mémoire : c'est le fichier reçu
// dans Excel qui compte.
function classeurProduit(): XLSX.WorkBook {
  const wb = construireClasseurMatrice(matrice);
  const octets = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  return XLSX.read(new Uint8Array(octets), { type: "array" });
}

describe("export Excel de la matrice", () => {
  it("écrit une feuille grille et une feuille à plat", () => {
    const wb = classeurProduit();
    expect(wb.SheetNames).toEqual(["Matrix", "Flows"]);
  });

  it("place les technologies à l'intersection émetteur/destinataire", () => {
    const wb = classeurProduit();
    const grille = XLSX.utils.sheet_to_json<string[]>(wb.Sheets.Matrix, { header: 1, defval: "" });
    expect(grille[0]).toEqual(["From \\ To", "Kamino", "Muet"]);
    expect(grille[1][0]).toBe("Tatooine");
    expect(grille[1][1]).toBe("HTTP ×3");
    expect(grille).toHaveLength(2);
  });

  it("déplie un flux par ligne dans la feuille à plat, avec son compte", () => {
    const wb = classeurProduit();
    const flux = XLSX.utils.sheet_to_json<Record<string, string | number>>(wb.Sheets.Flows, { defval: "" });
    expect(flux).toEqual([
      { From: "Tatooine", To: "Kamino", Technology: "HTTP", Count: 3, Attenuated: "" },
      { From: "Tatooine", To: "Muet", Technology: "Kafka", Count: 1, Attenuated: "Yes" },
    ]);
  });

  // Ce qui rend la grille exploitable dans Excel et que la bibliothèque écrit
  // réellement : l'autofiltre sur la ligne d'en-tête. Les volets figés, eux,
  // ne sont pas produits par l'édition communautaire.
  it("pose un autofiltre sur l'en-tête des deux feuilles", () => {
    const wb = classeurProduit();
    expect(wb.Sheets.Matrix["!autofilter"]).toBeDefined();
    expect(wb.Sheets.Flows["!autofilter"]).toBeDefined();
  });

});

// En mode fonctionnel, la technologie est vidée (§4.2) : sans ce compteur de
// repli, la grille exportée n'a plus que ses en-têtes -- un classeur qui a
// l'air correct et qui ne dit à personne qu'il ne montre plus rien.
describe("export Excel de la matrice — mode fonctionnel (technologie vide)", () => {
  const matriceFonctionnelle: MatrixResult = base.matrice({
    colonnes: ["Kamino", "Muet"],
    lignes: [
      {
        acteur: "Tatooine",
        cellules: new Map([
          ["Kamino", [{ technologie: "", count: 1, atténué: false, noms: [] }]],
          ["Muet", [{ technologie: "", count: 3, atténué: false, noms: [] }]],
        ]),
      },
    ],
  });

  function classeurFonctionnel(): XLSX.WorkBook {
    const wb = construireClasseurMatrice(matriceFonctionnelle);
    const octets = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
    return XLSX.read(new Uint8Array(octets), { type: "array" });
  }

  it("montre le compteur seul quand il n'y a pas de technologie", () => {
    const wb = classeurFonctionnel();
    const grille = XLSX.utils.sheet_to_json<string[]>(wb.Sheets.Matrix, { header: 1, defval: "" });
    expect(grille[1][1]).toBe("1");
    expect(grille[1][2]).toBe("3");
  });
});
