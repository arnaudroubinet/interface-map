// Ce fichier ne couvre que les collisions de displayName. Le reste de l'OOXML
// écrit à la main -- noms définis, validations, ordre des balises -- est
// vérifié à la balise près dans template-export.test.ts, qui inspecte le XML
// réellement produit. Bonne couverture, rangée sous un autre nom.
import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { applyOoxmlExtras, type TableToApply } from "./xlsx-tables";

// Un classeur minimal, juste assez pour que poserLesTableaux trouve les
// feuilles qu'on lui demande de compléter.
function minimalWorkbook(sheets: readonly string[]): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  for (const name of sheets) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Flow name"], ["a"]]), name);
  }
  return XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
}

function displayNamesDesTables(paquet: ArrayBuffer): string[] {
  const cfb = XLSX.CFB.read(new Uint8Array(paquet), { type: "array" });
  const names: string[] = [];
  for (const path of cfb.FullPaths) {
    if (!/\/xl\/tables\/table\d+\.xml$/.test(path)) continue;
    const input = XLSX.CFB.find(cfb, path.replace(/^[^/]*/, ""));
    const xml = new TextDecoder().decode(new Uint8Array(input!.content as unknown as ArrayBufferLike));
    const m = xml.match(/displayName="([^"]*)"/);
    names.push(m![1]);
  }
  return names;
}

// nomDeTableau() assainit un nom de feuille en remplaçant tout caractère non
// alphanumérique par « _ » : « FX_A B_HTTP » et « FX_A-B_HTTP » retombent
// tous deux sur « TblFX_A_B_HTTP ». ECMA-376 §18.5.1.2 exige un displayName
// unique dans le classeur ; Excel résout la collision en supprimant l'un des
// deux tableaux (« Enregistrements supprimés ») et en proposant de réparer.
describe("poserLesTableaux — collision de noms de tableau", () => {
  const sheets = ["FX_A B_HTTP", "FX_A-B_HTTP"];
  const tables: TableToApply[] = sheets.map((sheet) => ({
    sheet,
    columns: ["Flow name"],
    rows: 1,
  }));

  it("donne un displayName distinct à deux feuilles qui s'assainissent à l'identique", () => {
    const paquet = applyOoxmlExtras(minimalWorkbook(sheets), { tables });
    const names = displayNamesDesTables(paquet);
    expect(names).toHaveLength(2);
    expect(new Set(names).size).toBe(2);
  });

  it("nomme les tableaux de façon stable d'une génération à l'autre", () => {
    const raw = minimalWorkbook(sheets);
    const premier = displayNamesDesTables(applyOoxmlExtras(raw, { tables }));
    const second = displayNamesDesTables(applyOoxmlExtras(raw, { tables }));
    expect(second).toEqual(premier);
  });
});
