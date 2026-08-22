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
  // The mode is named only in the functional reading: the names produced so far
  // do not move, and two exports of the same diagram can no longer collide.
  const parts = ["carto", ...(mode === "functional" ? ["functional"] : []), slug(view)];
  if (selection) parts.push(slug(selection));
  if (milestone) parts.push(milestone);
  return `${parts.join("-")}.${ext}`;
}
