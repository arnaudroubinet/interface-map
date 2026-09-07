import { el, clear } from "../shared/dom";
import { wireDropZone, UNREADABLE_WORKBOOK_MESSAGE } from "./drop-zone";
import { type MigrationReport } from "../export/legacy-upgrade";
import { repairWorkbook } from "../export/repair";
import { writeTemplate } from "../export/template-export";
import { REFERENTIAL_SHEETS, type ReferentialRows } from "../parsing/referential-shape";
import { readReferentialWorkbook } from "../parsing/referential-workbook";
import { downloadReferentialXlsx, SAMPLE_REFERENTIAL, BLANK_REFERENTIAL } from "../export/referential-template";
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

// A drop the dialog will not convert, and can say why: two workbooks, two
// referentials, a referential alone. Told apart from a real failure so that
// the reader gets the reason rather than "unreadable".
class RefusedDrop extends Error {}

export function openMigration(): void {
  const previous = document.querySelector(".migration-overlay");
  if (previous) previous.remove();

  const overlay = el("div", { class: "migration-overlay" });
  const box = el("div", { class: "migration-box" });

  const closeButton = el("button", { class: "close-button", title: "Close" }, ["×"]);
  closeButton.addEventListener("click", () => overlay.remove());

  const zone = el("div", { class: "drop-target migration-target" });
  const message = el("p", { class: "drop-target-text" });

  // Where a referential is OBTAINED. The tool writes the referential file for
  // the same reason it writes the cartography's template: a shape nobody typed
  // by hand is a shape the tool can recognise when it is dropped back. Dropping
  // it is not done here in particular -- the main screen takes it beside the
  // cartography -- but here is where the question "where do I get one" is asked.
  const blankReferential = el("button", { class: "export-button", type: "button" }, ["Blank referential"]);
  blankReferential.title = "The vocabularies to start from: actor types and technologies, no actor and no group";
  blankReferential.addEventListener("click", () =>
    downloadReferentialXlsx("interface-map-referential.xlsx", BLANK_REFERENTIAL)
  );
  // Filled with the sample cartography's own names, so that the two files can
  // be dropped together and show the mechanism working rather than an empty
  // table.
  const sampleReferential = el("button", { class: "export-button", type: "button" }, ["Sample referential"]);
  sampleReferential.title = "A filled referential, publishing what the sample workbook declares";
  sampleReferential.addEventListener("click", () =>
    downloadReferentialXlsx("interface-map-referential-sample.xlsx", SAMPLE_REFERENTIAL)
  );

  const referentialBlock = el("div", { class: "migration-referential-block" }, [
    el("p", { class: "migration-referential-label" }, ["Referential"]),
    el("p", { class: "rail-note" }, [
      `One workbook, holding the sheets ${REFERENTIAL_SHEETS.map((r) => r.sheet).join(", ")}. ` +
        "Drop it together with the workbook to repair, and the repaired workbook carries its rows; " +
        "dropped alone with the workbook on the main screen, it refreshes the copy the workbook holds.",
    ]),
    el("div", { class: "migration-referential-files" }, [blankReferential, sampleReferential]),
  ]);

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

  // The same drop takes the workbook to repair and, beside it, its referential:
  // the two are told apart by their shape, as on the main screen. What is not a
  // referential is the workbook to repair -- an original-format file does not
  // read as anything the parser knows, and that is exactly the file this screen
  // exists for.
  const sortOut = async (
    files: File[]
  ): Promise<{ workbook: File; bytes: ArrayBuffer; referential: { name: string; rows: ReferentialRows } | null }> => {
    const read = await Promise.all(
      files.map(async (file) => {
        const bytes = await file.arrayBuffer();
        let rows: ReferentialRows | null = null;
        try {
          rows = readReferentialWorkbook(parseWorkbook(bytes));
        } catch {
          // Not even a workbook the parser opens: not a referential, then. What
          // it is gets decided further down, by the repair itself.
        }
        return { file, bytes, rows };
      })
    );
    const referentials = read.filter((r) => r.rows !== null);
    const workbooks = read.filter((r) => r.rows === null);
    if (referentials.length > 1) throw new RefusedDrop("Several referentials dropped at once: a workbook follows one.");
    if (workbooks.length > 1) throw new RefusedDrop("Several workbooks dropped at once: repair one, with its referential if you like.");
    if (workbooks.length === 0) {
      throw new RefusedDrop(`${referentials[0].file.name} is a referential: drop the workbook to repair, with it if you like.`);
    }
    const referential = referentials[0];
    return {
      workbook: workbooks[0].file,
      bytes: workbooks[0].bytes,
      referential: referential ? { name: referential.file.name, rows: referential.rows! } : null,
    };
  };

  const convert = (files: File[]) => {
    message.className = "drop-target-text";
    message.textContent = "Converting…";
    sortOut(files)
      .then(async ({ workbook: file, bytes, referential }) => {
        // The referential dropped alongside replaces the copy the workbook
        // carried; none dropped, the copy stays as it was -- repairing a
        // workbook must not empty its lists.
        const repair = repairWorkbook(bytes, undefined, referential?.rows ?? null);
        const base = file.name.replace(/\.(xlsx|xlsm)$/i, "");
        const workbook = writeTemplate(repair.data);
        downloadWorkbook(workbook, `${base}-repaired.xlsx`);

        // The checks are run over what has just been written: announcing "there
        // will be things left to fill in" without counting them would sound like a
        // figure of speech. These are the same checks as the tool's, on the same
        // file.
        const reread = buildModel(parseWorkbook(workbook));
        const summary = reread.ok ? runIntegrityChecks(reread.model) : null;

        clear(zone);
        zone.appendChild(el("p", { class: "drop-target-title" }, ["Workbook repaired"]));
        zone.appendChild(
          el("p", { class: "drop-target-text" }, [
            `${repair.data.actors.length} components, ${repair.data.interfaces.length} interfaces, ` +
              `${repair.data.fx.reduce((n, o) => n + o.rows.length, 0)} consumptions, ` +
              `${repair.data.fx.length} flow sheets.`,
          ])
        );
        if (summary) {
          zone.appendChild(
            el("p", { class: "drop-target-text" }, [
              `The workbook produced carries ${summary.totalAnomalies} anomal${summary.totalAnomalies > 1 ? "ies" : "y"}, ` +
                `${summary.totalActions} pending decision${summary.totalActions > 1 ? "s" : ""} and ` +
                `${summary.totalWarnings} warning${summary.totalWarnings > 1 ? "s" : ""}. ` +
                "Load it in the tool for the detail: whatever the original format does not hold " +
                "— perimeters, actor types, usages, criticalities — was left empty.",
            ])
          );
        }
        // Said out loud: with no referential in the drop, the reader has no way
        // to tell whether the copy was refreshed or kept.
        zone.appendChild(
          el("p", { class: "drop-target-text" }, [
            referential
              ? `Referential copy refreshed from ${referential.name}.`
              : "Referential copy kept as the workbook carried it: drop the referential alongside to refresh it.",
          ])
        );
        const points = repair.legacyReport ? row(repair.legacyReport) : [];
        if (points.length > 0) {
          const list = el("ul", { class: "migration-list" });
          for (const p of points) list.appendChild(el("li", {}, [p]));
          zone.appendChild(list);
        }
        const convertAnotherButton = el("button", { class: "export-button" }, ["Convert another file"]);
        convertAnotherButton.addEventListener("click", reset);
        zone.appendChild(convertAnotherButton);
      })
      .catch((err) => {
        // A drop refused for what it holds says why. Anything else -- truncated
        // bytes, corrupt zip, missing Flux sheet... -- is not established here:
        // claiming a cause would be worse than saying nothing. The same message,
        // the same wording, as the main drop target on the same failure
        // (founding §: never a false cause).
        if (!(err instanceof RefusedDrop)) console.error(err);
        message.className = "drop-target-text error-message";
        message.textContent = err instanceof RefusedDrop ? err.message : UNREADABLE_WORKBOOK_MESSAGE;
      });
  };

  reset();
  wireDropZone(zone, convert);

  // Drag and drop is not enough: from a folder or an email, one wants to be able
  // to pick the file.
  const choose = el("input", { type: "file", accept: ".xlsx,.xlsm", multiple: "" }) as HTMLInputElement;
  choose.className = "file-field";
  choose.addEventListener("change", () => {
    const files = [...(choose.files ?? [])];
    if (files.length > 0) convert(files);
  });

  box.appendChild(closeButton);
  box.appendChild(el("h2", { class: "migration-title" }, ["Repair or upgrade a workbook"]));
  box.appendChild(referentialBlock);
  box.appendChild(zone);
  box.appendChild(choose);
  overlay.appendChild(box);

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });
  document.addEventListener("keydown", function esc(e) {
    if (e.key !== "Escape") return;
    overlay.remove();
    document.removeEventListener("keydown", esc);
  });

  document.body.appendChild(overlay);
}
