import { el, clear } from "../shared/dom";
import { wireDropZone, UNREADABLE_WORKBOOK_MESSAGE } from "./drop-zone";
import { type MigrationReport } from "../export/legacy-upgrade";
import { repairWorkbook } from "../export/repair";
import { writeTemplate } from "../export/template-export";
import {
  readReferentialUrl,
  hasReferential,
  REFERENTIAL_QUERIES,
  cleanReferentialUrl,
  isOpaqueSharingLink,
} from "../export/datamashup";
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

export function openMigration(): void {
  const previous = document.querySelector(".migration-overlay");
  if (previous) previous.remove();

  const overlay = el("div", { class: "migration-overlay" });
  const box = el("div", { class: "migration-box" });

  const closeButton = el("button", { class: "close-button", title: "Close" }, ["×"]);
  closeButton.addEventListener("click", () => overlay.remove());

  const zone = el("div", { class: "drop-target migration-target" });
  const message = el("p", { class: "drop-target-text" });

  // Where the referential is changed. It sits here, and no longer in the rail,
  // because a URL is not a reading option: it is a property of the FILE, and
  // this screen is the one place a file is rewritten. Typing it beside the
  // views suggested it took effect on what was on screen, when nothing at all
  // happens until Excel refreshes the workbook.
  const referentialField = el("input", {
    type: "url",
    class: "migration-referential",
    placeholder: "https://…/referential.xlsx",
  }) as HTMLInputElement;

  // What gets pasted here is a SharePoint "Copy link" nine times out of ten: a
  // viewer address, whose sign-in Excel refuses because the resource it names
  // is not the file. The path is kept and the rest dropped -- in the field
  // itself, not silently on the way out: an address on screen that is not the
  // one written is a debugging session nobody asked for.
  const referentialSaid = el("p", { class: "migration-referential-said" });
  referentialField.addEventListener("change", () => {
    if (isOpaqueSharingLink(referentialField.value)) {
      referentialSaid.className = "migration-referential-said error-message";
      referentialSaid.textContent =
        "That link does not name the file — it carries a viewing token instead of a path. " +
        "Open the file in SharePoint and take the address shown there.";
      return;
    }
    referentialField.value = cleanReferentialUrl(referentialField.value);
    referentialSaid.className = "migration-referential-said";
    referentialSaid.textContent = "";
  });
  const blankReferential = el("button", { class: "export-button", type: "button" }, ["Blank referential"]);
  blankReferential.title = "The vocabularies to start from: actor types and technologies, no actor and no group";
  blankReferential.addEventListener("click", () =>
    downloadReferentialXlsx("interface-map-referential.xlsx", BLANK_REFERENTIAL)
  );
  // Filled with the sample cartography's own names, so that the two files can
  // be pointed at each other and show the mechanism working rather than an
  // empty table.
  const sampleReferential = el("button", { class: "export-button", type: "button" }, ["Sample referential"]);
  sampleReferential.title = "A filled referential, publishing what the sample workbook declares";
  sampleReferential.addEventListener("click", () =>
    downloadReferentialXlsx("interface-map-referential-sample.xlsx", SAMPLE_REFERENTIAL)
  );

  const referentialBlock = el("div", { class: "migration-referential-block" }, [
    el("label", { class: "migration-referential-label" }, ["External referential", referentialField]),
    referentialSaid,
    el("p", { class: "rail-note" }, [
      `One workbook, holding the tables ${REFERENTIAL_QUERIES.map((q) => q.table).join(", ")}. ` +
        "Left empty, the workbook keeps the referential it already points at.",
    ]),
    // The trap costs a refresh error and half an hour: a SharePoint or OneDrive
    // sharing link serves a viewer page, not the file, and Excel.Workbook chokes
    // on the HTML it gets back.
    el("p", { class: "rail-note" }, [
      "On SharePoint or OneDrive, paste the file's address: only its path is kept — everything after the \"?\" names a way of ",
      "VIEWING the file, and Excel then asks to sign in for something that is not the workbook. ",
      "It asks for an organisational account the first time it refreshes; the credentials stay in Excel, never in the file.",
    ]),
    // No referential yet is the ordinary case at this point, and an empty field
    // is a dead end. The file to publish is handed over here, where the
    // question is asked -- the tool writes it, so its tables carry the names
    // the query looks for.
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

  const convert = (file: File) => {
    message.className = "drop-target-text";
    message.textContent = "Converting…";
    file
      .arrayBuffer()
      .then(async (bytes) => {
        // The repair rebuilds the sheets, and the referential is not in the
        // sheets: it lives in the binary Power Query stream. Only the dropped
        // bytes still hold it, so it is read here and handed to repairWorkbook
        // -- otherwise repairing a workbook would silently erase its queries.
        //
        // What was typed wins over what the file carried: that is the whole
        // point of the field. An empty field changes nothing, rather than
        // erasing the referential of a workbook one only meant to repair.
        const typed = cleanReferentialUrl(referentialField.value);
        const referential = typed !== "" ? typed : await readReferentialUrl(bytes);
        const repair = repairWorkbook(bytes, undefined, referential);
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
        // Said out loud: the field may have been left empty, and the reader has
        // then no way to tell which of the two rules applied.
        zone.appendChild(
          el("p", { class: "drop-target-text" }, [
            hasReferential(referential)
              ? `External referential: ${referential}`
              : "No external referential: the workbook produced declares none.",
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
  wireDropZone(zone, convert);

  // Drag and drop is not enough: from a folder or an email, one wants to be able
  // to pick the file.
  const choose = el("input", { type: "file", accept: ".xlsx,.xlsm" }) as HTMLInputElement;
  choose.className = "file-field";
  choose.addEventListener("change", () => {
    const file = choose.files?.[0];
    if (file) convert(file);
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
