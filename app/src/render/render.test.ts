// Le fichier de tests du dossier render/ dans son entier -- matrix-table,
// integrity-report, aide, icones. La colocation dit « un test à côté de son
// module » ; ici c'est un test pour six modules, et l'absence d'un
// matrix-table.test.ts ne veut donc pas dire qu'il n'est pas couvert.
import { describe, it, expect } from "vitest";
// La comparaison vit ici, et non dans aide.ts : la page d'aide n'a pas à
// dépendre du rail pour être écrite, elle doit seulement rester d'accord avec
// lui. C'est au test de tenir les deux bouts.
import { VUES } from "../ui/rail";
import { EXPORTS } from "../ui/banner";
import { AVAILABLE_ICONS, ICON_PREVIEWS } from "./icons";
import { buildAide, vuesDocumentees, exportsDocumentes } from "./help";
import { buildRoadmapSvg } from "./roadmap";
import { buildMatrixTable } from "./matrix-table";
import { buildIntegrityReport } from "./integrity-report";
import type { MatrixResult } from "../aggregation/views";
import * as base from "../testing/fixtures";
import type { IntegrityReport } from "../integrity/checks";

describe("buildMatrixTable", () => {
  it("draws exactly the rows and columns it is given", () => {
    const matrix: MatrixResult = base.matrix({
      columns: ["A"],
      rows: [{ actor: "B", cellules: new Map([["A", [{ technology: "HTTP", count: 2, attenuated: false, names: [] }]]]) }],
    });

    const table = buildMatrixTable(matrix, () => "#2a78d6");

    expect(table.tagName.toLowerCase()).toBe("table");
    expect(table.querySelectorAll("tbody tr")).toHaveLength(1);
    // Coin, une colonne, et la marge des totaux.
    expect(table.querySelectorAll("thead th")).toHaveLength(3);
    expect(table.textContent).toContain("HTTP ×2");
  });

  it("marks an attenuated technology distinctly", () => {
    const matrix: MatrixResult = base.matrix({
      columns: ["B"],
      rows: [{ actor: "A", cellules: new Map([["B", [{ technology: "HTTP", count: 1, attenuated: true, names: [] }]]]) }],
    });

    const table = buildMatrixTable(matrix, () => "#2a78d6");

    expect(table.querySelector("[data-dimmed='true']")).not.toBeNull();
  });

  // Lignes et colonnes n'ont plus le même ordre depuis qu'elles sont élaguées
  // chacune de son côté : une case « soi à soi » n'est plus sur une diagonale,
  // et la griser ne produisait qu'un bloc gris flottant au milieu du tableau.
  // Le fond des cases vient du thème, jamais du tableau : sur un thème sombre,
  // un fond posé ici rendait la donnée illisible. Les cases de TOTAUX portent
  // une classe, mais aucune couleur en propre.
  it("marks no cell with a background of its own", () => {
    const matrix: MatrixResult = base.matrix({
      columns: ["A", "B"],
      rows: [
        { actor: "A", cellules: new Map([["B", [{ technology: "HTTP", count: 1, attenuated: false, names: [] }]]]) },
        { actor: "B", cellules: new Map([["A", [{ technology: "HTTP", count: 1, attenuated: false, names: [] }]]]) },
      ],
    });

    const table = buildMatrixTable(matrix, () => "#2a78d6");

    expect([...table.querySelectorAll("td[class]")].filter((td) => td.className !== "matrix-total")).toEqual([]);
    expect([...table.querySelectorAll("td")].every((td) => td.style.backgroundColor === "")).toBe(true);
  });

  // En mode fonctionnel la technologie est vidée (§4.5) ; la cellule ne doit
  // pas afficher un « ×3 » précédé d'un vide.
  it("montre le seul compteur quand la cellule n'a pas de technologie", () => {
    const matrix: MatrixResult = base.matrix({
      columns: ["A"],
      rows: [{ actor: "B", cellules: new Map([["A", [{ technology: "", count: 2, attenuated: false, names: [] }]]]) }],
    });

    const table = buildMatrixTable(matrix, () => "#000");

    expect(table.textContent).toContain("2");
    expect(table.textContent).not.toContain("×");
  });
});

describe("buildIntegrityReport", () => {
  it("renders one block per family with its title and anomaly count", () => {
    const report: IntegrityReport = {
      families: [
        { id: "structure", title: "Structure", description: "d", anomalies: [{ message: "Problème A" }] },
        { id: "references", title: "Références", description: "d", anomalies: [] },
      ],
      infoBlocks: [{ id: "groupes", title: "Groupes utilisés", description: "d", items: ["Socle (2)"], level: "info" }],
      totalAnomalies: 1,
      totalActions: 0,
      totalAvertissements: 0,
    };

    const el = buildIntegrityReport(report);

    expect(el.textContent).toContain("Structure");
    expect(el.textContent).toContain("Problème A");
    expect(el.textContent).toContain("Nothing to report");
    expect(el.textContent).toContain("Groupes utilisés");
    expect(el.textContent).toContain("Socle (2)");
  });
});

describe("buildIntegrityReport — état visuel des sections", () => {
  const report: IntegrityReport = {
    families: [
      { id: "structure", title: "Structure", description: "…", anomalies: [] },
      { id: "coherence", title: "Cohérence", description: "…", anomalies: [{ message: "un problème" }] },
    ],
    infoBlocks: [],
    totalAnomalies: 1,
    totalActions: 0,
    totalAvertissements: 0,
  };

  const parTitre = (el: HTMLElement, start: string) =>
    [...el.querySelectorAll("details")].find((d) => d.querySelector("summary")!.textContent!.startsWith(start))!;

  it("collapses a clean section behind a green check, and opens an alerting one under a stop icon", () => {
    const el = buildIntegrityReport(report);
    const saine = parTitre(el, "Structure");
    const enAlerte = parTitre(el, "Cohérence");

    // Section saine : repliée, marquée « ok ».
    expect(saine.open).toBe(false);
    expect(saine.classList.contains("section-ok")).toBe(true);
    expect(saine.querySelector("summary")!.textContent).toContain("Structure (0)");

    // Section en alerte : dépliée d'office, marquée « alerte ».
    expect(enAlerte.open).toBe(true);
    expect(enAlerte.classList.contains("section-alert")).toBe(true);
    expect(enAlerte.querySelector("summary")!.textContent).toContain("Cohérence (1)");
    expect(enAlerte.querySelectorAll("li")).toHaveLength(1);
  });

  it("gives each section an icon that distinguishes the two states without relying on colour alone", () => {
    const el = buildIntegrityReport(report);
    const saine = parTitre(el, "Structure");
    const enAlerte = parTitre(el, "Cohérence");
    const traces = (d: Element) => [...d.querySelectorAll("summary svg path")].length;

    expect(traces(saine)).toBe(1); // coche : un seul tracé
    expect(traces(enAlerte)).toBe(3); // octogone + les deux barres de la croix
  });
});

describe("buildIntegrityReport — avertissements", () => {
  it("marks a warning block distinctly from an error and from plain information", () => {
    const report: IntegrityReport = {
      families: [{ id: "coherence", title: "Cohérence", description: "…", anomalies: [{ message: "faute" }] }],
      infoBlocks: [
        { id: "a-confirmer", title: "Interfaces à confirmer", description: "…", items: ["F1"], level: "warning" },
        { id: "groupes", title: "Groupes utilisés", description: "…", items: ["Socle (2)"], level: "info" },
      ],
      totalAnomalies: 1,
      totalActions: 0,
      totalAvertissements: 1,
    };

    const el = buildIntegrityReport(report);
    const parTitre = (start: string) =>
      [...el.querySelectorAll("details")].find((d) => d.querySelector("summary")!.textContent!.startsWith(start))!;
    const erreur = parTitre("Cohérence");
    const avert = parTitre("Interfaces à confirmer");
    const info = parTitre("Groupes utilisés");

    expect(erreur.classList.contains("section-alert")).toBe(true);
    expect(avert.classList.contains("section-warning")).toBe(true);
    expect(info.classList.contains("section-info")).toBe(true);

    // Chacun est visible d'office : un avertissement ne se cache pas.
    expect([erreur.open, avert.open, info.open]).toEqual([true, true, true]);

    // Les trois icônes diffèrent par leur forme, pas seulement par leur couleur.
    const traces = (d: Element) => d.querySelectorAll("summary svg path").length;
    expect(traces(erreur)).toBe(3); // octogone + croix
    expect(traces(avert)).toBe(3); // triangle + barre + point
    expect(traces(info)).toBe(2); // barre + point, dans un cercle
    expect(avert.querySelector("summary svg path")!.getAttribute("d")).not.toBe(
      erreur.querySelector("summary svg path")!.getAttribute("d")
    );
  });
});

describe("buildIntegrityReport — ordre de lecture", () => {
  it("sorts sections by what they demand: errors, then warnings, then information, then the clean ones", () => {
    const report: IntegrityReport = {
      families: [
        { id: "structure", title: "Structure", description: "…", anomalies: [] },
        { id: "coherence", title: "Cohérence", description: "…", anomalies: [{ message: "faute" }] },
      ],
      infoBlocks: [
        { id: "groupes", title: "Groups", description: "…", items: ["Socle (2)"], level: "info" },
        { id: "vide", title: "Bloc vide", description: "…", items: [], level: "info" },
        { id: "a-confirmer", title: "To confirm", description: "…", items: ["F1"], level: "warning" },
      ],
      totalAnomalies: 1,
      totalActions: 0,
      totalAvertissements: 1,
    };

    const titles = [...buildIntegrityReport(report).querySelectorAll("details")].map(
      (d) => d.querySelector("summary")!.textContent!.replace(/\s*\(\d+\)$/, "")
    );

    expect(titles).toEqual(["Cohérence", "To confirm", "Groups", "Structure", "Bloc vide"]);
  });
});

describe("catalogue d'icônes", () => {
  // Ajouter une icône sans son aperçu laisserait une case vide dans le classeur,
  // sans rien pour le signaler.
  it("donne un aperçu à chaque icône du catalogue, et rien de plus", () => {
    expect(Object.keys(ICON_PREVIEWS).sort()).toEqual(AVAILABLE_ICONS);
  });
});

describe("buildIntegrityReport — actions", () => {
  const block = (id: string, level: "info" | "action" | "warning") => ({
    id, title: id, description: "d", items: ["x"], level,
  });

  // Une action n'est pas un défaut du fichier : elle attend une décision, et
  // se distingue de l'alerte par sa forme autant que par sa couleur.
  it("gives an action its own icon and class, distinct from a warning", () => {
    const html = buildIntegrityReport({
      families: [],
      infoBlocks: [block("a-confirmer", "action"), block("criticite", "warning")],
      totalAnomalies: 0, totalActions: 1, totalAvertissements: 1,
    });
    const action = html.querySelector(".section-action")!;
    const warning = html.querySelector(".section-warning")!;
    expect(action).not.toBeNull();
    expect(warning).not.toBeNull();
    expect(action.querySelector("svg")!.innerHTML).not.toBe(warning.querySelector("svg")!.innerHTML);
  });

  // Ordre de lecture : ce qu'il faut corriger, puis ce qu'il faut décider, puis
  // ce qu'il faut compléter, puis ce qu'il suffit de lire.
  it("sorts errors, then actions, then warnings, then information", () => {
    const html = buildIntegrityReport({
      families: [{ id: "structure", title: "Structure", description: "d", anomalies: [{ message: "m" }] }],
      infoBlocks: [block("info", "info"), block("avert", "warning"), block("action", "action")],
      totalAnomalies: 1, totalActions: 1, totalAvertissements: 1,
    });
    const classes = [...html.querySelectorAll("details")].map((d) => d.className.split(" ")[1]);
    expect(classes).toEqual(["section-alert", "section-action", "section-warning", "section-info"]);
  });
});

// --- La page d'aide se compare au rail : une vue ajoutée sans une ligne de
// documentation ferait échouer ce test. Une documentation qui prend du retard
// est pire que pas de documentation, puisqu'elle affirme.
describe("buildAide", () => {
  it("documente chaque vue du rail, et rien de plus", () => {
    expect(vuesDocumentees().sort()).toEqual(VUES.map((v) => v.label).sort());
  });

  // Le même dispositif que pour les vues : un huitième export ne peut pas
  // arriver sans sa ligne d'explication. C'est la meilleure couture du projet,
  // et elle ne servait qu'à moitié.
  it("documente chaque export proposé, et rien de plus", () => {
    expect(exportsDocumentes().sort()).toEqual(EXPORTS.map((e) => e.label).sort());
  });

  it("explique les deux lectures et les deux colonnes qui les portent", () => {
    const text = buildAide().textContent ?? "";
    for (const attendu of ["ARCHITECTURE", "BUSINESS", "Nature", "Republished as"]) {
      expect(text).toContain(attendu);
    }
  });

  it("dit que le classeur n'est jamais modifié ni envoyé", () => {
    const text = buildAide().textContent ?? "";
    expect(text).toContain("never writes");
    expect(text).toContain("nothing leaves this browser");
  });

  it("prévient de la confusion entre Remove et le retrait", () => {
    expect(buildAide().textContent ?? "").toContain("deprecation warning");
  });
});

// --- QA : en lecture fonctionnelle la technologie est vide, et la fonction de
// couleur retombait sur son repli « #000 » -- écrit en dur dans le style de
// chaque cellule. Sur le thème sombre, cela donnait du noir sur noir : la
// matrix fonctionnelle était illisible. Sans technologie il n'y a pas de
// couleur à porter, et la cellule doit hériter de celle du thème.
describe("buildMatrixTable — couleur des cellules", () => {
  const matrix = (technology: string): MatrixResult => base.matrix({
    columns: ["A"],
    rows: [{ actor: "B", cellules: new Map([["A", [{ technology, count: 1, attenuated: false, names: ["F"] }]]]) }],
  });

  it("n'impose aucune couleur quand il n'y a pas de technologie", () => {
    const span = buildMatrixTable(matrix(""), () => "#000").querySelector(".matrix-tech") as HTMLElement;
    expect(span.style.color).toBe("");
  });

  // L'intention n'a pas changé -- la couleur de la technologie reste montrée --
  // mais elle a quitté le texte pour la pastille.
  it("montre toujours la couleur de la technologie, sur sa pastille", () => {
    const table = buildMatrixTable(matrix("HTTP"), () => "#2a78d6");
    const pastille = table.querySelector(".matrix-dot") as HTMLElement;
    expect(pastille.style.backgroundColor).not.toBe("");
  });
});

// --- La couleur d'une technologie viendra du référentiel externe, en
// hexadécimal libre. Mesuré sur cinq couleurs d'entreprise typiques : toutes
// excellentes sur blanc (4,3 à 9,2:1), quatre sous le seuil de 3:1 sur fond
// sombre. Or dans la matrix la couleur ÉTAIT la couleur du texte : une charte
// réglée pour l'impression rendait donc la donnée illisible.
//
// La couleur passe donc sur une pastille, et le libellé prend l'encre du
// thème. N'importe quel hexadécimal devient lisible, et la couleur reste le
// rappel qu'elle a toujours été.
describe("buildMatrixTable — la couleur ne porte plus le texte", () => {
  const matrix = (technology: string): MatrixResult => base.matrix({
    columns: ["A"],
    rows: [{ actor: "B", cellules: new Map([["A", [{ technology, count: 1, attenuated: false, names: ["F"] }]]]) }],
  });

  it("pose la couleur sur une pastille, jamais sur le libellé", () => {
    const table = buildMatrixTable(matrix("HTTP"), () => "#7a2e3b");
    const pastille = table.querySelector(".matrix-dot") as HTMLElement;
    const label = table.querySelector(".matrix-tech") as HTMLElement;
    expect(pastille.style.backgroundColor).not.toBe("");
    expect(label.style.color).toBe("");
  });

  it("n'affiche aucune pastille quand il n'y a pas de technologie", () => {
    const table = buildMatrixTable(matrix(""), () => "#000");
    expect(table.querySelector(".matrix-dot")).toBeNull();
  });

  it("garde le libellé lisible dans les deux cas", () => {
    for (const tech of ["HTTP", ""]) {
      const table = buildMatrixTable(matrix(tech), () => "#7a2e3b");
      expect(table.textContent).toContain("F");
    }
  });
});

// --- §2.10 : 143 cases, aucun total, aucun titre, et rien qui dise à un
// lecteur d'écran de quelle case un en-tête est le titre.
describe("buildMatrixTable — les marges et la sémantique du tableau", () => {
  const estate = () =>
    base.matrix({
      columns: ["A", "B"],
      rows: [
        { actor: "A", cellules: new Map([["B", [{ technology: "HTTP", count: 3, attenuated: false, names: [] }]]]) },
        { actor: "B", cellules: new Map([["A", [{ technology: "HTTP", count: 1, attenuated: false, names: [] }]]]) },
      ],
    });

  it("porte le titre du tableau dans un caption", () => {
    const table = buildMatrixTable(estate(), () => "#111", "Matrix — architecture reading, milestone v2");
    expect(table.querySelector("caption")?.textContent).toContain("milestone v2");
  });

  it("n'invente pas de caption quand aucun titre n'est fourni", () => {
    expect(buildMatrixTable(estate(), () => "#111").querySelector("caption")).toBeNull();
  });

  // Sans `scope`, une matrix de 143 cases se lit comme 143 nombres sans
  // adresse.
  it("dit de quelle case chaque en-tête est le titre", () => {
    const table = buildMatrixTable(estate(), () => "#111");
    // Le coin n'est le titre de rien : il annonce le sens de lecture des deux
    // axes, et lui donner une portée le rattacherait à l'un des deux.
    const enTetes = [...table.querySelectorAll("thead th")].filter((th) => !th.classList.contains("matrix-corner"));
    expect(enTetes.length).toBeGreaterThan(0);
    expect(enTetes.every((th) => th.getAttribute("scope") === "col")).toBe(true);
    expect([...table.querySelectorAll("tbody th")].every((th) => th.getAttribute("scope") === "row")).toBe(true);
  });

  it("compte les flux sortants en bout de ligne et les entrants en pied de colonne", () => {
    const table = buildMatrixTable(estate(), () => "#111");
    const finDeLigne = [...table.querySelectorAll("tbody tr")].map((tr) => tr.lastElementChild?.textContent);
    expect(finDeLigne).toEqual(["3", "1"]);
    const pied = [...table.querySelectorAll("tfoot td")].map((td) => td.textContent);
    expect(pied.slice(0, 2)).toEqual(["1", "3"]);
  });
});

// --- §2.15 : les deux lectures existent, sont justes, et n'empruntaient pas
// le vocabulaire que leurs lecteurs possèdent déjà.
describe("buildAide — le vocabulaire des deux lectures", () => {
  const text = () => buildAide().textContent ?? "";

  it("rattache les deux lectures aux viewpoints ArchiMate", () => {
    expect(text()).toContain("Application Cooperation");
    expect(text()).toContain("Application Usage");
  });

  // Le point d'honnêteté : rabattre une chaîne est une dérivation que la
  // norme dit pouvoir être fausse, et l'outil l'affirmait sans le dire.
  it("dit ce qu'un lien rabattu affirme, et ce qu'il n'affirme pas", () => {
    expect(text()).toContain("derivation rule 10");
    expect(text()).toContain("it says the information travels, not that it arrives unchanged");
  });
});

// --- §A4 : l'axe des paliers était une liste déroulante, on ne voyait jamais
// le temps. La frise le montre d'un coup.
describe("buildFriseSvg", () => {
  const timeline = {
    milestones: [
      { name: "v1", rank: 1, label: "Initial", status: "Delivered", date: "2026-01-01", description: "", sheet: "Milestones", row: 2 },
      { name: "v2", rank: 2, label: "Partners", status: "Delivered", date: "2026-06-01", description: "", sheet: "Milestones", row: 3 },
    ],
    segments: [
      { label: "Member lookup 1.0", grouping: "A", start: 1, end: 2, openRight: false, openLeft: false },
      { label: "Member lookup 2.0", grouping: "A", start: 2, end: 3, openRight: true, openLeft: false },
    ],
  };

  it("dessine une barre par segment et une graduation par palier", () => {
    const svg = buildRoadmapSvg(timeline, null, null);
    expect(svg.querySelectorAll("rect")).toHaveLength(3); // le fond, plus deux barres
    expect(svg.querySelectorAll("line")).toHaveLength(2);
  });

  it("nomme chaque palier et chaque ligne", () => {
    const texts = [...buildRoadmapSvg(timeline, null, null).querySelectorAll("text")].map((t) => t.textContent);
    expect(texts).toContain("v1");
    expect(texts).toContain("Member lookup 1.0");
    expect(texts.some((t) => t?.includes("2026-06-01"))).toBe(true);
  });

  // Une pointe, pas un bord franc : un bord dirait que la ligne s'arrête là,
  // alors qu'elle n'a simplement pas de fin connue.
  it("termine par une pointe la ligne qui n'a pas de retrait", () => {
    expect(buildRoadmapSvg(timeline, null, null).querySelectorAll(".fx-roadmap-open")).toHaveLength(1);
  });

  // Le « vous êtes ici » : le palier affiché se distingue des autres.
  it("marque le palier affiché d'une verticale plus forte", () => {
    const svg = buildRoadmapSvg(timeline, "v2", null);
    const widths = [...svg.querySelectorAll("line")].map((l) => l.getAttribute("stroke-width"));
    expect(new Set(widths).size).toBe(2);
  });

  // Une barre plus longue à droite qu'à gauche : sans ça, deux versions qui se
  // succèdent se dessineraient au même endroit.
  it("place chaque barre à l'abscisse de son palier", () => {
    const svg = buildRoadmapSvg(timeline, null, null);
    const [, un, deux] = [...svg.querySelectorAll("rect")];
    expect(Number(deux.getAttribute("x"))).toBeGreaterThan(Number(un.getAttribute("x")));
  });
});
