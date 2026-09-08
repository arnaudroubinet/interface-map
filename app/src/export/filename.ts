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
  ext: "svg" | "png" | "xlsx" | "md" | "drawio" | "dsl" | "c4" | "json",
  mode: Mode = "architecture"
): string {
  // The mode is named only in the functional reading: the names produced so far
  // do not move, and two exports of the same diagram can no longer collide.
  const parts = ["carto", ...(mode === "functional" ? ["functional"] : []), slug(view)];
  if (selection) parts.push(slug(selection));
  // Slugged like the rest: a milestone is typed by a person, and "T3 2026 / lot 1"
  // is a name the browser truncates at the slash.
  if (milestone) parts.push(slug(milestone));
  return `${parts.join("-")}.${ext}`;
}
