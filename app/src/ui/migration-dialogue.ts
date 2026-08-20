import { el, clear } from "./dom";
import { wireDropZone, MESSAGE_CLASSEUR_ILLISIBLE } from "./drop-zone";
import { type RapportMigration } from "../export/migration-legacy";
import { reparerClasseur } from "../export/reparation";
import { écrireModele } from "../export/template-export";
import { téléchargerClasseur } from "../export/telechargement";
import { parseWorkbook } from "../parsing/workbook";
import { buildModel } from "../parsing/build-model";
import { runIntegrityChecks } from "../integrity/checks";

// Fenêtre de migration : on y dépose un classeur au format d'origine, elle rend
// sa conversion au format actuel. Elle vit à part du dépôt principal, pour
// qu'on ne puisse pas confondre « je veux voir ce fichier » et « je veux le
// convertir » -- les deux prennent un .xlsx et n'en font pas la même chose.

function ligne(rapport: RapportMigration): string[] {
  const points: string[] = [];
  if (rapport.acteursCrees.length > 0) {
    points.push(
      `${rapport.acteursCrees.length} component${rapport.acteursCrees.length > 1 ? "s" : ""} inferred from the flows, with no group or type: ${rapport.acteursCrees.join(", ")}`
    );
  }
  if (rapport.typesInconnus.length > 0) {
    // Le code sait seulement que ces types ne figurent pas au référentiel : il
    // ne sait pas POURQUOI, ni ce qu'il faudrait en faire. Le dire autrement
    // reviendrait à généraliser un cas particulier.
    points.push(
      `flow types missing from the current repository, to be reclassified: ${rapport.typesInconnus.join(", ")}. ` +
        "Their direction being unknown, the arrow was drawn as a call from the consumer to the provider."
    );
  }
  return points;
}

export function ouvrirMigration(): void {
  const précédent = document.querySelector(".voile-migration");
  if (précédent) précédent.remove();

  const voile = el("div", { class: "voile-migration" });
  const boîte = el("div", { class: "boite-migration" });

  const fermer = el("button", { class: "bouton-fermer", title: "Close" }, ["×"]);
  fermer.addEventListener("click", () => voile.remove());

  const zone = el("div", { class: "cible-depot cible-migration" });
  const message = el("p", { class: "cible-depot-texte" });

  const réinitialiser = () => {
    clear(zone);
    zone.appendChild(el("p", { class: "cible-depot-titre" }, ["Drop a workbook — original format, older model, or simply missing sheets"]));
    zone.appendChild(
      el("p", { class: "cible-depot-texte" }, [
        "You get back a workbook at the current model, with every sheet an interface expects — created empty when it did not exist.",
      ])
    );
    zone.appendChild(message);
  };

  const convertir = (fichier: File) => {
    message.className = "cible-depot-texte";
    message.textContent = "Converting…";
    fichier
      .arrayBuffer()
      .then((octets) => {
        const réparation = reparerClasseur(octets);
        const base = fichier.name.replace(/\.(xlsx|xlsm)$/i, "");
        const classeur = écrireModele(réparation.donnees);
        téléchargerClasseur(classeur, `${base}-repaired.xlsx`);

        // On fait passer les contrôles sur ce qu'on vient d'écrire : annoncer
        // « il restera des choses à saisir » sans les compter laisserait croire
        // à une formule de style. Ce sont les mêmes contrôles que ceux de
        // l'outil, sur le même fichier.
        const relu = buildModel(parseWorkbook(classeur));
        const bilan = relu.ok ? runIntegrityChecks(relu.model) : null;

        clear(zone);
        zone.appendChild(el("p", { class: "cible-depot-titre" }, ["Workbook repaired"]));
        zone.appendChild(
          el("p", { class: "cible-depot-texte" }, [
            `${réparation.donnees.acteurs.length} components, ${réparation.donnees.interfaces.length} interfaces, ` +
              `${réparation.donnees.fx.reduce((n, o) => n + o.lignes.length, 0)} consumptions, ` +
              `${réparation.donnees.fx.length} flow sheets.`,
          ])
        );
        if (bilan) {
          zone.appendChild(
            el("p", { class: "cible-depot-texte" }, [
              `The workbook produced carries ${bilan.totalAnomalies} anomal${bilan.totalAnomalies > 1 ? "ies" : "y"}, ` +
                `${bilan.totalActions} pending decision${bilan.totalActions > 1 ? "s" : ""} and ` +
                `${bilan.totalAvertissements} warning${bilan.totalAvertissements > 1 ? "s" : ""}. ` +
                "Load it in the tool for the detail: whatever the original format does not hold " +
                "— perimeters, actor types, usages, criticalities — was left empty.",
            ])
          );
        }
        const points = réparation.rapportLegacy ? ligne(réparation.rapportLegacy) : [];
        if (points.length > 0) {
          const liste = el("ul", { class: "liste-migration" });
          for (const p of points) liste.appendChild(el("li", {}, [p]));
          zone.appendChild(liste);
        }
        const encore = el("button", { class: "bouton-export" }, ["Convert another file"]);
        encore.addEventListener("click", réinitialiser);
        zone.appendChild(encore);
      })
      .catch((err) => {
        // La cause précise (bytes tronqués, zip corrompu, feuille Flux
        // absente...) n'est pas établie ici : la prétendre serait pire que de
        // ne rien dire. Même message, même mot, que la cible de dépôt
        // principale sur le même échec (§ fondateur : jamais de fausse cause).
        console.error(err);
        message.className = "cible-depot-texte message-erreur";
        message.textContent = MESSAGE_CLASSEUR_ILLISIBLE;
      });
  };

  réinitialiser();
  wireDropZone(zone, convertir);

  // Le glisser-déposer ne suffit pas : depuis un dossier ou un courriel, on veut
  // pouvoir choisir le fichier.
  const choisir = el("input", { type: "file", accept: ".xlsx,.xlsm" }) as HTMLInputElement;
  choisir.className = "champ-fichier";
  choisir.addEventListener("change", () => {
    const fichier = choisir.files?.[0];
    if (fichier) convertir(fichier);
  });

  boîte.appendChild(fermer);
  boîte.appendChild(el("h2", { class: "titre-migration" }, ["Repair or upgrade a workbook"]));
  boîte.appendChild(zone);
  boîte.appendChild(choisir);
  voile.appendChild(boîte);

  voile.addEventListener("click", (e) => {
    if (e.target === voile) voile.remove();
  });
  document.addEventListener("keydown", function échap(e) {
    if (e.key !== "Escape") return;
    voile.remove();
    document.removeEventListener("keydown", échap);
  });

  document.body.appendChild(voile);
}
