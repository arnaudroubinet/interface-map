import { el, clear } from "../shared/dom";
import { wireDropZone, UNREADABLE_WORKBOOK_MESSAGE } from "./drop-zone";
import { type MigrationReport } from "../export/legacy-upgrade";
import { repairWorkbook } from "../export/repair";
import { writeTemplate } from "../export/template-export";
import { readReferentialUrls } from "../export/datamashup";
import { downloadWorkbook } from "../export/download";
import { parseWorkbook } from "../parsing/workbook";
import { buildModel } from "../parsing/build-model";
import { runIntegrityChecks } from "../integrity/checks";

// The migration dialog: a workbook in the original format is dropped in it,
// and it returns its conversion to the current format. It lives apart from the
// main drop target so that "I want to see this file" and "I want to convert
// it" cannot be confused -- both take an .xlsx and do different things with it.

function row(report: MigrationReport): string[] {
  const points: string[] = [];
  if (report.actorsCreated.length > 0) {
    points.push(
      `${report.actorsCreated.length} component${report.actorsCreated.length > 1 ? "s" : ""} inferred from the flows, with no group or type: ${report.actorsCreated.join(", ")}`
    );
  }
  if (report.unknownTypes.length > 0) {
    // The code only knows these types are not in the referential: it does not know
    // WHY, nor what should be done about them. Saying otherwise would amount to
    // generalising a particular case.
    points.push(
      `flow types missing from the current repository, to be reclassified: ${report.unknownTypes.join(", ")}. ` +
        "Their direction being unknown, the arrow was drawn as a call from the consumer to the provider."
    );
  }
  return points;
}

export function openMigration(): void {
  const previous = document.querySelector(".migration-overlay");
  if (previous) previous.remove();

  const voile = el("div", { class: "migration-overlay" });
  const box = el("div", { class: "migration-box" });

  const fermer = el("button", { class: "close-button", title: "Close" }, ["×"]);
  fermer.addEventListener("click", () => voile.remove());

  const zone = el("div", { class: "drop-target migration-target" });
  const message = el("p", { class: "drop-target-text" });

  const reset = () => {
    clear(zone);
    zone.appendChild(el("p", { class: "drop-target-title" }, ["Drop a workbook — original format, older model, or simply missing sheets"]));
    zone.appendChild(
      el("p", { class: "drop-target-text" }, [
        "You get back a workbook at the current model, with every sheet an interface expects — created empty when it did not exist.",
      ])
    );
    zone.appendChild(message);
  };

  const convertir = (file: File) => {
    message.className = "drop-target-text";
    message.textContent = "Converting…";
    file
      .arrayBuffer()
      .then(async (bytes) => {
        const repair = repairWorkbook(bytes);
        const base = file.name.replace(/\.(xlsx|xlsm)$/i, "");
        // The repair rebuilds the sheets, and the referential URLs are not in
        // the sheets: they live in the binary Power Query stream. Only the
        // dropped bytes still hold them, so they are read back and put in --
        // otherwise repairing a workbook would silently erase its queries.
        const workbook = writeTemplate({ ...repair.data, referentials: await readReferentialUrls(bytes) });
        downloadWorkbook(workbook, `${base}-repaired.xlsx`);

        // The checks are run over what has just been written: announcing "there
        // will be things left to fill in" without counting them would sound like a
        // figure of speech. These are the same checks as the tool's, on the same
        // file.
        const reread = buildModel(parseWorkbook(workbook));
        const bilan = reread.ok ? runIntegrityChecks(reread.model) : null;

        clear(zone);
        zone.appendChild(el("p", { class: "drop-target-title" }, ["Workbook repaired"]));
        zone.appendChild(
          el("p", { class: "drop-target-text" }, [
            `${repair.data.actors.length} components, ${repair.data.interfaces.length} interfaces, ` +
              `${repair.data.fx.reduce((n, o) => n + o.rows.length, 0)} consumptions, ` +
              `${repair.data.fx.length} flow sheets.`,
          ])
        );
        if (bilan) {
          zone.appendChild(
            el("p", { class: "drop-target-text" }, [
              `The workbook produced carries ${bilan.totalAnomalies} anomal${bilan.totalAnomalies > 1 ? "ies" : "y"}, ` +
                `${bilan.totalActions} pending decision${bilan.totalActions > 1 ? "s" : ""} and ` +
                `${bilan.totalWarnings} warning${bilan.totalWarnings > 1 ? "s" : ""}. ` +
                "Load it in the tool for the detail: whatever the original format does not hold " +
                "— perimeters, actor types, usages, criticalities — was left empty.",
            ])
          );
        }
        const points = repair.legacyReport ? row(repair.legacyReport) : [];
        if (points.length > 0) {
          const list = el("ul", { class: "migration-list" });
          for (const p of points) list.appendChild(el("li", {}, [p]));
          zone.appendChild(list);
        }
        const encore = el("button", { class: "export-button" }, ["Convert another file"]);
        encore.addEventListener("click", reset);
        zone.appendChild(encore);
      })
      .catch((err) => {
        // The precise cause (truncated bytes, corrupt zip, missing Flux sheet...)
        // is not established here: claiming it would be worse than saying nothing.
        // The same message, the same wording, as the main drop target on the same
        // failure (founding §: never a false cause).
        console.error(err);
        message.className = "drop-target-text error-message";
        message.textContent = UNREADABLE_WORKBOOK_MESSAGE;
      });
  };

  reset();
  wireDropZone(zone, convertir);

  // Drag and drop is not enough: from a folder or an email, one wants to be able
  // to pick the file.
  const choose = el("input", { type: "file", accept: ".xlsx,.xlsm" }) as HTMLInputElement;
  choose.className = "file-field";
  choose.addEventListener("change", () => {
    const file = choose.files?.[0];
    if (file) convertir(file);
  });

  box.appendChild(fermer);
  box.appendChild(el("h2", { class: "migration-title" }, ["Repair or upgrade a workbook"]));
  box.appendChild(zone);
  box.appendChild(choose);
  voile.appendChild(box);

  voile.addEventListener("click", (e) => {
    if (e.target === voile) voile.remove();
  });
  document.addEventListener("keydown", function esc(e) {
    if (e.key !== "Escape") return;
    voile.remove();
    document.removeEventListener("keydown", esc);
  });

  document.body.appendChild(voile);
}
