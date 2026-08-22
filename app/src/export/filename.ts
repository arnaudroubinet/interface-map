import type { Mode } from "../aggregation/core";

function slug(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function buildExportFilename(
  view: string,
  selection: string | null,
  milestone: string | null,
  ext: "svg" | "png" | "xlsx" | "md" | "drawio" | "dsl" | "c4",
  mode: Mode = "architecture"
): string {
  // Le mode ne se dit qu'en fonctionnel : les noms produits jusqu'ici ne
  // bougent pas, et deux exports du m\u00eame sch\u00e9ma ne peuvent plus se recouvrir.
  const parts = ["carto", ...(mode === "functional" ? ["functional"] : []), slug(view)];
  if (selection) parts.push(slug(selection));
  if (milestone) parts.push(milestone);
  return `${parts.join("-")}.${ext}`;
}
