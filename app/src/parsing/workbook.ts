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
    // blankrows: the empty rows are kept long enough to number them, then
    // dropped. Without them the index would shift from the first skipped row
    // on, and every following number would be wrong.
    const raw = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, {
      defval: "",
      raw: false,
      blankrows: true,
    });
    // The first data row follows the header, itself at the start of the sheet's
    // real range -- which does not always begin at A1.
    const start = sheet["!ref"] ? XLSX.utils.decode_range(sheet["!ref"]).s.r : 0;
    const rows: RawRow[] = raw
      .map((values, i) => ({ row: start + 2 + i, values }))
      .filter((r) => Object.values(r.values).some((v) => (v ?? "").toString().trim() !== ""));
    const headerRow = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false })[0];
    // Array.from, not .map: sheet_to_json returns a sparse array when a header
    // cell is empty (e.g. an unnamed spacer column) — .map skips the holes and
    // leaves them in the result, which find() (headers.ts) then visits as
    // `undefined` and crashes normalizeText() on.
    // Array.from(iterable, fn) visits every index, holes included.
    const headers = Array.from(headerRow ?? [], (h) => (h ?? "").toString());
    return { name, headers, rows };
  });

  const modifiedDate = wb.Props?.ModifiedDate;
  const savedAt = modifiedDate instanceof Date ? modifiedDate : null;

  return { sheets, savedAt };
}
