const TYPES: Record<string, string> = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xlsm: "application/vnd.ms-excel.sheet.macroEnabled.12",
};

// Quand « Toujours demander où enregistrer » est actif, le clic n'enregistre
// rien : il ouvre une boîte de dialogue native, et le navigateur ne lit le blob
// qu'une fois qu'on y a répondu. Révoquer l'URL au tick suivant, comme on le
// faisait, la détruisait pendant que la boîte était encore ouverte -- le
// téléchargement mourait alors en silence, sans erreur ni fichier. Le délai
// couvre le temps qu'un humain met à choisir un dossier ; l'URL survit de toute
// façon au plus jusqu'au rechargement de la page.
const DELAI_REVOCATION_MS = 120_000;

export function downloadText(content: string, fileName: string): void {
  downloadBlob(new Blob([content], { type: "text/markdown;charset=utf-8" }), fileName);
}

export function downloadWorkbook(bytes: ArrayBuffer, fileName: string): void {
  const extension = fileName.split(".").pop() ?? "xlsx";
  downloadBlob(new Blob([bytes], { type: TYPES[extension] ?? TYPES.xlsx }), fileName);
}

// Le seul endroit qui déclenche un téléchargement. Il n'y en avait pas un mais
// trois, chacun avec sa copie du même piège.
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  // Ancre attachée au document avant le clic : un clic synchrone sur une ancre
  // détachée est connu pour échouer par intermittence hors Chrome (§2.4 exige
  // aussi Firefox et Safari).
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), DELAI_REVOCATION_MS);
}
