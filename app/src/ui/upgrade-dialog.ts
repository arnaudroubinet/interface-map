import { el, clear } from "../shared/dom";
import { wireDropZone, UNREADABLE_WORKBOOK_MESSAGE } from "./drop-zone";
import { type MigrationReport } from "../export/legacy-upgrade";
import { repairWorkbook } from "../export/repair";
import { writeTemplate } from "../export/template-export";
import { downloadWorkbook } from "../export/download";
import { parseWorkbook } from "../parsing/workbook";
import { buildModel } from "../parsing/build-model";
import { runIntegrityChecks } from "../integrity/checks";

// Fenêtre de migration : on y dépose un classeur au format d'origine, elle rend
// sa conversion au format actuel. Elle vit à part du dépôt principal, pour
// qu'on ne puisse pas confondre « je veux voir ce fichier » et « je veux le
// convertir » -- les deux prennent un .xlsx et n'en font pas la même chose.

function row(report: MigrationReport): string[] {
  const points: string[] = [];
  if (report.actorsCreated.length > 0) {
    points.push(
      `${report.actorsCreated.length} component${report.actorsCreated.length > 1 ? "s" : ""} inferred from the flows, with no group or type: ${report.actorsCreated.join(", ")}`
    );
  }
  if (report.typesInconnus.length > 0) {
    // Le code sait seulement que ces types ne figurent pas au référentiel : il
    // ne sait pas POURQUOI, ni ce qu'il faudrait en faire. Le dire autrement
    // reviendrait à généraliser un cas particulier.
    points.push(
      `flow types missing from the current repository, to be reclassified: ${report.typesInconnus.join(", ")}. ` +
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
      .then((bytes) => {
        const repair = repairWorkbook(bytes);
        const base = file.name.replace(/\.(xlsx|xlsm)$/i, "");
        const workbook = writeTemplate(repair.data);
        downloadWorkbook(workbook, `${base}-repaired.xlsx`);

        // On fait passer les contrôles sur ce qu'on vient d'écrire : annoncer
        // « il restera des choses à saisir » sans les compter laisserait croire
        // à une formule de style. Ce sont les mêmes contrôles que ceux de
        // l'outil, sur le même fichier.
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
        // La cause précise (bytes tronqués, zip corrompu, feuille Flux
        // absente...) n'est pas établie ici : la prétendre serait pire que de
        // ne rien dire. Même message, même mot, que la cible de dépôt
        // principale sur le même échec (§ fondateur : jamais de fausse cause).
        console.error(err);
        message.className = "drop-target-text error-message";
        message.textContent = UNREADABLE_WORKBOOK_MESSAGE;
      });
  };

  reset();
  wireDropZone(zone, convertir);

  // Le glisser-déposer ne suffit pas : depuis un dossier ou un courriel, on veut
  // pouvoir choisir le fichier.
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
