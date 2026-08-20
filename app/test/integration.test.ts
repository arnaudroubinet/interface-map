import { describe, it, expect } from "vitest";
import { parseWorkbook } from "../src/parsing/workbook";
import { buildModel } from "../src/parsing/build-model";
import { runIntegrityChecks } from "../src/integrity/checks";
import { buildGroupToGroupView, buildPlatformDetailView } from "../src/aggregation/views";
import { lecture, chainesCoupees } from "../src/aggregation/fonctionnel";
import { estActeurTechnique } from "../src/aggregation/nature";
import { acteurEstPlateforme } from "../src/aggregation/core";
import { écrireModele } from "../src/export/template-export";
import { DONNEES_EXEMPLE } from "../src/export/exemple-donnees";

// Le classeur d'exemple, écrit par l'outil puis relu par lui : c'est le seul
// test qui fait tourner toute la chaîne d'un bout à l'autre. Il portait
// autrefois sur un classeur réel déposé dans le dépôt ; celui-ci en est parti
// avec les données de l'entreprise, et l'exemple embarqué le remplace. On y
// perd le désordre du terrain -- accents, onglets nommés à la main, colonnes
// surnuméraires -- et rien ne le compense ici.
describe("chaîne complète sur le classeur d'exemple", () => {
  it("parses end to end without throwing and yields plausible counts", async () => {
    const workbook = parseWorkbook(écrireModele(DONNEES_EXEMPLE));
    const built = buildModel(workbook);

    expect(built.ok).toBe(true);
    if (!built.ok) return;

    expect(built.model.acteurs.length).toBeGreaterThan(0);
    expect(built.model.interfaces.length).toBeGreaterThan(0);
    expect(built.model.consommations.length).toBeGreaterThan(0);
    // FX_Modèle must not be picked up as a real consumption tab.
    expect(built.model.fxSheetNames).not.toContain("FX_Modèle");

    const report = runIntegrityChecks(built.model);
    expect(report.familles).toHaveLength(5);
    expect(report.blocsInformatifs).toHaveLength(9);
    // L'exemple est construit pour ne déclencher aucune anomalie (voir le
    // commentaire d'exemple-donnees.ts) : un décalage de colonne dans
    // l'exemple, le gabarit ou le modèle fait aussitôt rougir cette ligne.
    expect(report.totalAnomalies).toBe(0);

    const view = buildGroupToGroupView(
      built.model,
      lecture(built.model, null, "architecture"),
      { compteurs: true }
    );
    expect(view.nodes.length).toBeGreaterThan(0);
    expect(view.edges.length).toBeGreaterThan(0);
  });
});

// --- QA : l'exemple livré ne portait ni nature ni relais, si bien que les deux
// modes rendaient exactement le même dessin. Il ne pouvait donc ni montrer la
// lecture métier à qui découvre l'outil, ni protéger la traversée d'une
// régression -- et rien ne le disait, tout était vert.
describe("le classeur d'exemple exerce la lecture métier", () => {
  const modele = () => {
    const built = buildModel(parseWorkbook(écrireModele(DONNEES_EXEMPLE)));
    if (!built.ok) throw new Error("exemple illisible");
    return built.model;
  };

  it("déclare au moins un acteur technique et le fait disparaître en fonctionnel", () => {
    const m = modele();
    const archi = lecture(m, null, "architecture").acteurs.length;
    const métier = lecture(m, null, "fonctionnel").acteurs.length;
    expect(métier).toBeLessThan(archi);
  });

  it("raboute une chaîne : deux acteurs métier que seul le mode fonctionnel relie", () => {
    const m = modele();
    const paires = (mode: "architecture" | "fonctionnel") =>
      new Set(lecture(m, null, mode).flux.map((f) => `${f.exposant} → ${f.consommateur}`));
    const archi = paires("architecture");
    const nouvelles = [...paires("fonctionnel")].filter((p) => !archi.has(p));
    expect(nouvelles.length).toBeGreaterThan(0);
  });

  it("ne casse aucune chaîne", () => {
    expect(chainesCoupees(modele(), null)).toHaveLength(0);
  });
});

// --- Une chaîne à TROIS relais successifs, dont un hors plateforme. Les cas à
// un seul saut ne prouvent pas grand-chose : la remontée descend
// récursivement, et c'est sur plusieurs sauts qu'elle peut s'arrêter trop tôt,
// se perdre, ou franchir la frontière de la plateforme sans le dire.
describe("le classeur d'exemple porte une chaîne à trois relais", () => {
  const modele = () => {
    const built = buildModel(parseWorkbook(écrireModele(DONNEES_EXEMPLE)));
    if (!built.ok) throw new Error("exemple illisible");
    return built.model;
  };

  it("déclare les trois relais techniques, deux sur la plateforme et un dehors", () => {
    const m = modele();
    const relais = ["Kafka", "Dagobah", "ESB"].map((nom) => m.acteurs.find((a) => a.nom === nom)!);
    expect(relais.every((a) => estActeurTechnique(m, a.nom))).toBe(true);
    expect(relais.filter((a) => acteurEstPlateforme(m, a)).map((a) => a.nom)).toEqual(["Kafka", "Dagobah"]);
  });

  it("dessine les quatre segments en architecture", () => {
    const segments = lecture(modele(), null, "architecture")
      .flux.filter((f) => f.interfaceNom === "Policy notice" || f.interfaceNom.startsWith("notice."))
      .map((f) => `${f.exposant}→${f.consommateur}`);
    expect(segments).toEqual(["Chandrila→Kafka", "Kafka→Dagobah", "Dagobah→ESB", "ESB→Bracca"]);
  });

  // Le même relais sert deux chaînes qui ne se ressemblent pas : l'une sort du
  // périmètre par deux relais de plus, l'autre s'arrête au premier et reste
  // interne. Rien dans la ligne d'interface du bus ne les distingue -- c'est la
  // ligne de consommation qui le dit, une par entrée.
  it("fait servir le même relais à deux chaînes sans les confondre", () => {
    const m = modele();
    const métier = lecture(m, null, "fonctionnel").flux;
    const cible = (nom: string) =>
      métier.filter((f) => f.exposant === "Chandrila" && f.consommateur === nom).map((f) => f.interfaceNom);

    // vers l'extérieur, par trois relais
    expect(cible("Bracca")).toContain("Policy notice");
    expect(acteurEstPlateforme(m, m.acteurs.find((a) => a.nom === "Bracca")!)).toBe(false);

    // et vers la plateforme, par le seul Kafka
    expect(cible("Takodana")).toEqual(["Policy events"]);
    expect(acteurEstPlateforme(m, m.acteurs.find((a) => a.nom === "Takodana")!)).toBe(true);
  });

  it("les raboute en un seul lien métier, les trois relais retirés", () => {
    const m = modele();
    const métier = lecture(m, null, "fonctionnel");
    expect(métier.acteurs.map((a) => a.nom)).not.toContain("Dagobah");
    expect(
      métier.flux.filter((f) => f.exposant === "Chandrila" && f.consommateur === "Bracca" && f.interfaceNom === "Policy notice")
    ).toHaveLength(1);
  });
});

// --- Le tracé suit la DONNÉE, du fournisseur vers le consommateur, quelle que
// soit la technologie. La chaîne se lit donc comme un tuyau même quand un
// maillon est tiré : le troisième segment est en HTTP, et sa pointe -- posée à
// son départ -- dit que c'est le bus qui interroge la passerelle.
describe("la chaîne à trois relais se lit dans un seul sens", () => {
  it("enchaîne les quatre segments de bout en bout", () => {
    const built = buildModel(parseWorkbook(écrireModele(DONNEES_EXEMPLE)));
    if (!built.ok) throw new Error("exemple illisible");
    const m = built.model;
    const vue = buildPlatformDetailView(m, lecture(m, null, "architecture"), { compteurs: true });

    // « Support » est le groupe qui porte l'ESB : hors plateforme, il est
    // dessiné replié sur son groupe.
    const enchaînement: [string, string][] = [
      ["Chandrila", "Kafka"],
      ["Kafka", "Dagobah"],
      ["Dagobah", "Support"],
      ["Support", "Sales network"],
    ];
    for (const [de, vers] of enchaînement) {
      expect(vue.edges.some((e) => e.from === de && e.to === vers)).toBe(true);
    }
  });
});
