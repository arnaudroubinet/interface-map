import { describe, it, expect } from "vitest";
import { parseWorkbook } from "../src/parsing/workbook";
import { buildModel } from "../src/parsing/build-model";
import { runIntegrityChecks } from "../src/integrity/checks";
import { buildGroupToGroupView, buildPlatformDetailView } from "../src/aggregation/views";
import { reading, chainesCoupees } from "../src/aggregation/reading";
import { isTechnicalActor } from "../src/aggregation/nature";
import { actorIsPlatform } from "../src/aggregation/core";
import { writeTemplate } from "../src/export/template-export";
import { SAMPLE_DATA } from "../src/export/sample-data";

// Le classeur d'exemple, écrit par l'outil puis relu par lui : c'est le seul
// test qui fait tourner toute la chaîne d'un bout à l'autre. Il portait
// autrefois sur un classeur réel déposé dans le dépôt ; celui-ci en est parti
// avec les données de l'entreprise, et l'exemple embarqué le remplace. On y
// perd le désordre du terrain -- accents, onglets nommés à la main, colonnes
// surnuméraires -- et rien ne le compense ici.
describe("chaîne complète sur le classeur d'exemple", () => {
  it("parses end to end without throwing and yields plausible counts", async () => {
    const workbook = parseWorkbook(writeTemplate(SAMPLE_DATA));
    const built = buildModel(workbook);

    expect(built.ok).toBe(true);
    if (!built.ok) return;

    expect(built.model.actors.length).toBeGreaterThan(0);
    expect(built.model.interfaces.length).toBeGreaterThan(0);
    expect(built.model.consumptions.length).toBeGreaterThan(0);
    // FX_Modèle must not be picked up as a real consumption tab.
    expect(built.model.fxSheetNames).not.toContain("FX_Modèle");

    const report = runIntegrityChecks(built.model);
    expect(report.families).toHaveLength(5);
    expect(report.infoBlocks).toHaveLength(11);
    // Les identifiants, pas seulement le compte : un bloc qui disparaît en
    // même temps qu'un autre arrive laisserait le compte intact.
    expect(new Set(report.infoBlocks.map((b) => b.id)).size).toBe(report.infoBlocks.length);
    // L'exemple est construit pour ne déclencher aucune anomalie (voir le
    // commentaire d'exemple-donnees.ts) : un décalage de colonne dans
    // l'exemple, le gabarit ou le modèle fait aussitôt rougir cette ligne.
    expect(report.totalAnomalies).toBe(0);

    const view = buildGroupToGroupView(
      built.model,
      reading(built.model, null, "architecture"),
      { counters: true }
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
  const template = () => {
    const built = buildModel(parseWorkbook(writeTemplate(SAMPLE_DATA)));
    if (!built.ok) throw new Error("exemple illisible");
    return built.model;
  };

  it("déclare au moins un acteur technique et le fait disparaître en fonctionnel", () => {
    const m = template();
    const archi = reading(m, null, "architecture").actors.length;
    const business = reading(m, null, "functional").actors.length;
    expect(business).toBeLessThan(archi);
  });

  it("raboute une chaîne : deux acteurs métier que seul le mode fonctionnel relie", () => {
    const m = template();
    const paires = (mode: "architecture" | "functional") =>
      new Set(reading(m, null, mode).flows.map((f) => `${f.provider} → ${f.consumer}`));
    const archi = paires("architecture");
    const nouvelles = [...paires("functional")].filter((p) => !archi.has(p));
    expect(nouvelles.length).toBeGreaterThan(0);
  });

  it("ne casse aucune chaîne", () => {
    expect(chainesCoupees(template(), null)).toHaveLength(0);
  });
});

// --- Une chaîne à TROIS relais successifs, dont un hors plateforme. Les cas à
// un seul saut ne prouvent pas grand-chose : la remontée descend
// récursivement, et c'est sur plusieurs sauts qu'elle peut s'arrêter trop tôt,
// se perdre, ou franchir la frontière de la plateforme sans le dire.
describe("le classeur d'exemple porte une chaîne à trois relais", () => {
  const template = () => {
    const built = buildModel(parseWorkbook(writeTemplate(SAMPLE_DATA)));
    if (!built.ok) throw new Error("exemple illisible");
    return built.model;
  };

  it("déclare les trois relais techniques, deux sur la plateforme et un dehors", () => {
    const m = template();
    const legacyRelays = ["Kafka", "Dagobah", "ESB"].map((name) => m.actors.find((a) => a.name === name)!);
    expect(legacyRelays.every((a) => isTechnicalActor(m, a.name))).toBe(true);
    expect(legacyRelays.filter((a) => actorIsPlatform(m, a)).map((a) => a.name)).toEqual(["Kafka", "Dagobah"]);
  });

  it("dessine les quatre segments en architecture", () => {
    const segments = reading(template(), null, "architecture")
      .flows.filter((f) => f.interfaceName === "Policy notice" || f.interfaceName.startsWith("notice."))
      .map((f) => `${f.provider}→${f.consumer}`);
    expect(segments).toEqual(["Chandrila→Kafka", "Kafka→Dagobah", "Dagobah→ESB", "ESB→Bracca"]);
  });

  // Le même relais sert deux chaînes qui ne se ressemblent pas : l'une sort du
  // périmètre par deux relais de plus, l'autre s'arrête au premier et reste
  // interne. Rien dans la ligne d'interface du bus ne les distingue -- c'est la
  // ligne de consommation qui le dit, une par entrée.
  it("fait servir le même relais à deux chaînes sans les confondre", () => {
    const m = template();
    const business = reading(m, null, "functional").flows;
    const target = (name: string) =>
      business.filter((f) => f.provider === "Chandrila" && f.consumer === name).map((f) => f.interfaceName);

    // vers l'extérieur, par trois relais
    expect(target("Bracca")).toContain("Policy notice");
    expect(actorIsPlatform(m, m.actors.find((a) => a.name === "Bracca")!)).toBe(false);

    // et vers la plateforme, par le seul Kafka
    expect(target("Takodana")).toEqual(["Policy events"]);
    expect(actorIsPlatform(m, m.actors.find((a) => a.name === "Takodana")!)).toBe(true);
  });

  it("les raboute en un seul lien métier, les trois relais retirés", () => {
    const m = template();
    const business = reading(m, null, "functional");
    expect(business.actors.map((a) => a.name)).not.toContain("Dagobah");
    expect(
      business.flows.filter((f) => f.provider === "Chandrila" && f.consumer === "Bracca" && f.interfaceName === "Policy notice")
    ).toHaveLength(1);
  });
});

// --- Le tracé suit la DONNÉE, du fournisseur vers le consommateur, quelle que
// soit la technologie. La chaîne se lit donc comme un tuyau même quand un
// maillon est tiré : le troisième segment est en HTTP, et sa pointe -- posée à
// son départ -- dit que c'est le bus qui interroge la passerelle.
describe("la chaîne à trois relais se lit dans un seul sens", () => {
  it("enchaîne les quatre segments de bout en bout", () => {
    const built = buildModel(parseWorkbook(writeTemplate(SAMPLE_DATA)));
    if (!built.ok) throw new Error("exemple illisible");
    const m = built.model;
    const view = buildPlatformDetailView(m, reading(m, null, "architecture"), { counters: true });

    // « Support » est le groupe qui porte l'ESB : hors plateforme, il est
    // dessiné replié sur son groupe.
    const chaining: [string, string][] = [
      ["Chandrila", "Kafka"],
      ["Kafka", "Dagobah"],
      ["Dagobah", "Support"],
      ["Support", "Sales network"],
    ];
    for (const [de, vers] of chaining) {
      expect(view.edges.some((e) => e.from === de && e.to === vers)).toBe(true);
    }
  });
});
