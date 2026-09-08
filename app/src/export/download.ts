const TYPES: Record<string, string> = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xlsm: "application/vnd.ms-excel.sheet.macroEnabled.12",
  md: "text/markdown;charset=utf-8",
  // A draw.io file is XML; the two DSLs are plain text; FossFLOW is JSON. They
  // all left as Markdown, which some browsers took as a reason to append .md.
  drawio: "application/xml;charset=utf-8",
  dsl: "text/plain;charset=utf-8",
  c4: "text/plain;charset=utf-8",
  json: "application/json;charset=utf-8",
};

// The type a file is handed over as, from its extension. Text falls back on
// plain text, never on Markdown: Markdown is one format among the text ones.
export function mimeTypeFor(fileName: string): string {
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
  return TYPES[extension] ?? "text/plain;charset=utf-8";
}

// When "Always ask where to save" is on, the click saves nothing: it opens a
// native dialog, and the browser only reads the blob once that dialog has been
// answered. Revoking the URL on the next tick, as was done, destroyed it while
// the dialog was still open -- the download then died in silence, with neither
// an error nor a file. The delay covers the time a human takes to pick a
// folder; the URL survives at most until the page reloads anyway.
//
const REVOCATION_DELAY_MS = 120_000;

export function downloadText(content: string, fileName: string): void {
  downloadBlob(new Blob([content], { type: mimeTypeFor(fileName) }), fileName);
}

export function downloadWorkbook(bytes: ArrayBuffer, fileName: string): void {
  const extension = fileName.split(".").pop() ?? "xlsx";
  downloadBlob(new Blob([bytes], { type: TYPES[extension] ?? TYPES.xlsx }), fileName);
}

// The one and only place that triggers a download. There used to be three, not
// one, each with its own copy of the same trap.
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  // Anchor attached to the document before the click: a synchronous click on a
  // detached anchor is known to fail intermittently outside Chrome (§2.4 also
  // requires Firefox and Safari).
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), REVOCATION_DELAY_MS);
}
