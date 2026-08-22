import * as XLSX from "xlsx";
import type { RawSheet, RawRow, ParsedWorkbook } from "./model";

export function parseWorkbook(buffer: ArrayBuffer): ParsedWorkbook {
  // SheetJS's `type: "array"` mode expects a byte array (Uint8Array), not a
  // raw ArrayBuffer — passing the ArrayBuffer directly silently produces a
  // bogus single-sheet workbook instead of throwing. A real ArrayBuffer (as
  // produced by the browser's File.arrayBuffer()) must be wrapped.
  const wb = XLSX.read(new Uint8Array(buffer), { type: "array", cellDates: true });

  const sheets: RawSheet[] = wb.SheetNames.map((name) => {
    const sheet = wb.Sheets[name];
    // blankrows : on garde les lignes vides le temps de numéroter, puis on les
    // écarte. Sans elles, l'indice se décalerait dès la première ligne sautée
    // et tous les numéros suivants seraient faux.
    const brutes = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, {
      defval: "",
      raw: false,
      blankrows: true,
    });
    // La première ligne de données suit l'en-tête, lui-même au début de la
    // plage réelle de la feuille -- qui ne commence pas toujours en A1.
    const départ = sheet["!ref"] ? XLSX.utils.decode_range(sheet["!ref"]).s.r : 0;
    const rows: RawRow[] = brutes
      .map((values, i) => ({ row: départ + 2 + i, values }))
      .filter((r) => Object.values(r.values).some((v) => (v ?? "").toString().trim() !== ""));
    const headerRow = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false })[0];
    // Array.from, pas .map : sheet_to_json renvoie un tableau creux quand une
    // cellule d'en-tête est vide (ex. colonne intercalaire sans nom) — .map
    // saute les trous et les laisse dans le résultat, ce que find() (headers.ts)
    // visite ensuite comme `undefined` et fait planter normalizeText().
    // Array.from(iterable, fn) visite chaque index, trous compris.
    const headers = Array.from(headerRow ?? [], (h) => (h ?? "").toString());
    return { name, headers, rows };
  });

  const modifiedDate = wb.Props?.ModifiedDate;
  const fichierModifie = modifiedDate instanceof Date ? modifiedDate : null;

  return { sheets, fichierModifie };
}
