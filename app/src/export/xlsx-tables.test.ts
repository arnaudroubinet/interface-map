// Ce fichier ne couvre que les collisions de displayName. Le reste de l'OOXML
// écrit à la main -- noms définis, validations, ordre des balises -- est
// vérifié à la balise près dans template-export.test.ts, qui inspecte le XML
// réellement produit. Bonne couverture, rangée sous un autre nom.
import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { poserLesTableaux, type TableauÀPoser } from "./xlsx-tables";

// Un classeur minimal, juste assez pour que poserLesTableaux trouve les
// feuilles qu'on lui demande de compléter.
function classeurMinimal(feuilles: readonly string[]): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  for (const nom of feuilles) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Flow name"], ["a"]]), nom);
  }
  return XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
}

function displayNamesDesTables(paquet: ArrayBuffer): string[] {
  const cfb = XLSX.CFB.read(new Uint8Array(paquet), { type: "array" });
  const noms: string[] = [];
  for (const chemin of cfb.FullPaths) {
    if (!/\/xl\/tables\/table\d+\.xml$/.test(chemin)) continue;
    const entrée = XLSX.CFB.find(cfb, chemin.replace(/^[^/]*/, ""));
    const xml = new TextDecoder().decode(new Uint8Array(entrée!.content as unknown as ArrayBufferLike));
    const m = xml.match(/displayName="([^"]*)"/);
    noms.push(m![1]);
  }
  return noms;
}

// nomDeTableau() assainit un nom de feuille en remplaçant tout caractère non
// alphanumérique par « _ » : « FX_A B_HTTP » et « FX_A-B_HTTP » retombent
// tous deux sur « TblFX_A_B_HTTP ». ECMA-376 §18.5.1.2 exige un displayName
// unique dans le classeur ; Excel résout la collision en supprimant l'un des
// deux tableaux (« Enregistrements supprimés ») et en proposant de réparer.
describe("poserLesTableaux — collision de noms de tableau", () => {
  const feuilles = ["FX_A B_HTTP", "FX_A-B_HTTP"];
  const tableaux: TableauÀPoser[] = feuilles.map((feuille) => ({
    feuille,
    colonnes: ["Flow name"],
    lignes: 1,
  }));

  it("donne un displayName distinct à deux feuilles qui s'assainissent à l'identique", () => {
    const paquet = poserLesTableaux(classeurMinimal(feuilles), { tableaux });
    const noms = displayNamesDesTables(paquet);
    expect(noms).toHaveLength(2);
    expect(new Set(noms).size).toBe(2);
  });

  it("nomme les tableaux de façon stable d'une génération à l'autre", () => {
    const brut = classeurMinimal(feuilles);
    const premier = displayNamesDesTables(poserLesTableaux(brut, { tableaux }));
    const second = displayNamesDesTables(poserLesTableaux(brut, { tableaux }));
    expect(second).toEqual(premier);
  });
});
