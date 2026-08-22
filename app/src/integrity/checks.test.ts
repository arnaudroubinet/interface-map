import { describe, it, expect } from "vitest";
import * as base from "../testing/fixtures";
import { runIntegrityChecks } from "./checks";
import { buildFlowInstances } from "../aggregation/core";
import { buildFunctionalFlows } from "../aggregation/reading";
import { VERSION_MODELE, expectedFxSheet } from "../parsing/build-model";
import type { ParsedModel, Actor, InterfaceCatalogue, Consommation } from "../parsing/model";

// Un parc qui ne déclenche rien : chaque test n'introduit alors qu'une seule
// faute, celle qu'il examine.
function actor(o: Partial<Actor> = {}): Actor {
  return base.actor({ description: "d", ...o });
}

function iface(o: Partial<InterfaceCatalogue> = {}): InterfaceCatalogue {
  return base.iface({ description: "d", lienContrat: "lien", ...o });
}

function conso(o: Partial<Consommation> = {}): Consommation {
  return base.conso({ usage: "u", criticality: "1 - Critical", statut: "Actif", decision: "Keep", ...o });
}

function model(overrides: Partial<ParsedModel>): ParsedModel {
  return {
    actors: [actor({ name: "A" }), actor({ name: "B" })],
    groups: [{ name: "G", perimeter: "Platform", sheet: "Groups", row: 0 }],
    groupesAbsents: false,
    typesActeur: [{ type: "Application", icone: "app-window", nature: "", sheet: "ActorTypes", row: 0 }],
    milestones: [],
  flowTypes: [base.typeFlux({ type: "HTTP" })],
    interfaces: [iface({})],
    consumptions: [conso({})],
    fxSheetNames: ["FX_A_HTTP"],
    colonnesOptionnellesAbsentes: [],
    versionModele: VERSION_MODELE,
    fichierModifie: null,
    ...overrides,
  };
}

describe("7.1 structure", () => {
  it("reports nothing on a clean model", () => {
    const report = runIntegrityChecks(model({}));
    expect(report.families.find((f) => f.id === "structure")!.anomalies).toHaveLength(0);
  });

  it("flags a missing optional column", () => {
    const report = runIntegrityChecks(model({ colonnesOptionnellesAbsentes: [{ sheet: "Actors", column: "Group" }] }));
    expect(report.families.find((f) => f.id === "structure")!.anomalies).toHaveLength(1);
  });

  it("flags a duplicate actor name", () => {
    const report = runIntegrityChecks(model({ actors: [actor({ name: "A" }), actor({ name: "A" })] }));
    expect(report.families.find((f) => f.id === "structure")!.anomalies.some((a) => a.message.includes('"A"'))).toBe(true);
  });

  it("flags a duplicate interface name", () => {
    const report = runIntegrityChecks(model({ interfaces: [iface({ flowName: "F" }), iface({ flowName: "F" })] }));
    expect(report.families.find((f) => f.id === "structure")!.anomalies.length).toBeGreaterThan(0);
  });

  it("flags a missing FX_ tab expected by an interface", () => {
    const report = runIntegrityChecks(model({ fxSheetNames: [] }));
    expect(report.families.find((f) => f.id === "structure")!.anomalies.some((a) => a.message.includes("missing from the workbook"))).toBe(true);
  });

  it("flags an FX_ tab with no matching interface", () => {
    const report = runIntegrityChecks(model({ fxSheetNames: ["FX_A_HTTP", "FX_Orphelin_HTTP"] }));
    expect(report.families.find((f) => f.id === "structure")!.anomalies.some((a) => a.message.includes("FX_Orphelin_HTTP"))).toBe(true);
  });
});

describe("7.2 références", () => {
  it("reports nothing when all references resolve", () => {
    const report = runIntegrityChecks(model({}));
    expect(report.families.find((f) => f.id === "references")!.anomalies).toHaveLength(0);
  });

  it("flags an unknown exposant", () => {
    const report = runIntegrityChecks(model({ interfaces: [iface({ providerName: "Inconnu" })] }));
    expect(report.families.find((f) => f.id === "references")!.anomalies.some((a) => a.message.includes("Inconnu"))).toBe(true);
  });

  it("flags an unknown type de flux", () => {
    const report = runIntegrityChecks(model({ interfaces: [iface({ flowType: "SFTP" })] }));
    expect(report.families.find((f) => f.id === "references")!.anomalies.some((a) => a.message.includes("SFTP"))).toBe(true);
  });

  it("flags an unknown acteur consommateur", () => {
    const report = runIntegrityChecks(model({ consumptions: [conso({ consumerName: "Inconnu" })] }));
    expect(report.families.find((f) => f.id === "references")!.anomalies.some((a) => a.message.includes("Inconnu"))).toBe(true);
  });

  it("flags a consumption whose flow name is not in the catalog", () => {
    const report = runIntegrityChecks(model({ consumptions: [conso({ flowName: "Fantome" })] }));
    expect(report.families.find((f) => f.id === "references")!.anomalies.some((a) => a.message.includes("Fantome"))).toBe(true);
  });

  it("flags a consumption filed under the wrong tab", () => {
    const report = runIntegrityChecks(model({ consumptions: [conso({ sheet: "FX_Mauvais_Onglet" })] }));
    expect(report.families.find((f) => f.id === "references")!.anomalies.some((a) => a.message.includes("FX_A_HTTP"))).toBe(true);
  });

  it("does not flag a consumption as misfiled when a same-named interface exists on another tab (§3.3 rattachement)", () => {
    // Two catalog interfaces share the name "F" on different tabs (already
    // flagged elsewhere as a 7.1 duplicate). The consumption is filed under
    // the FIRST interface's tab (FX_A_HTTP) — a name-only lookup (the pre-fix
    // behaviour) always keeps the LAST-inserted entry (FX_C_HTTP) and would
    // wrongly flag this correctly-filed row as "rangée dans le mauvais
    // onglet"; only a (feuille, nom du flux) lookup (§3.3) gets this right.
    const report = runIntegrityChecks(
      model({
        interfaces: [iface({ expectedSheet: "FX_A_HTTP" }), iface({ providerName: "C", expectedSheet: "FX_C_HTTP" })],
        actors: [actor({ name: "A" }), actor({ name: "B" }), actor({ name: "C" })],
        consumptions: [conso({ sheet: "FX_A_HTTP" })],
      })
    );
    expect(report.families.find((f) => f.id === "references")!.anomalies.some((a) => a.message.includes("rangée"))).toBe(false);
  });
});

describe("7.3 cohérence", () => {
  it("reports nothing on a clean model", () => {
    const report = runIntegrityChecks(model({}));
    expect(report.families.find((f) => f.id === "coherence")!.anomalies).toHaveLength(0);
  });

  it("flags a consumer identical to the exposant", () => {
    const report = runIntegrityChecks(model({ consumptions: [conso({ consumerName: "A" })] }));
    expect(report.families.find((f) => f.id === "coherence")!.anomalies.length).toBeGreaterThan(0);
  });

  it("flags an interface with no consumption", () => {
    const report = runIntegrityChecks(model({ consumptions: [] }));
    expect(report.families.find((f) => f.id === "coherence")!.anomalies.some((a) => a.message.includes("no declared consumption"))).toBe(true);
  });

  // Un composant sans flux n'invalide rien : il n'apparaît simplement nulle
  // part. C'est un avertissement, pas une erreur.
  it("warns about an actor with no flow at all", () => {
    const report = runIntegrityChecks(model({ actors: [actor({ name: "A" }), actor({ name: "B" }), actor({ name: "Isole" })] }));
    expect(report.families.find((f) => f.id === "coherence")!.anomalies.some((a) => a.message.includes("Isole"))).toBe(false);
    const block = report.infoBlocks.find((b) => b.id === "acteurs-sans-flux")!;
    expect(block.level).toBe("warning");
    expect(block.items).toEqual(["Isole (Actors, row 0)"]);
  });
});

describe("7.4 complétude", () => {
  it("reports nothing on a clean model", () => {
    const report = runIntegrityChecks(model({}));
    expect(report.families.find((f) => f.id === "completude")!.anomalies).toHaveLength(0);
  });

  it("flags an empty interface description", () => {
    const report = runIntegrityChecks(model({ interfaces: [iface({ description: "" })] }));
    expect(report.families.find((f) => f.id === "completude")!.anomalies.some((a) => a.message.includes("description"))).toBe(true);
  });

  it("flags an interface with no contract at all", () => {
    const report = runIntegrityChecks(model({ interfaces: [iface({ lienContrat: "", referenceContrat: "" })] }));
    expect(report.families.find((f) => f.id === "completude")!.anomalies.some((a) => a.message.includes("no contract"))).toBe(true);
  });

  it("flags a consumption with empty usage or décision", () => {
    const report = runIntegrityChecks(model({ consumptions: [conso({ usage: "", decision: "" })] }));
    expect(report.families.find((f) => f.id === "completude")!.anomalies.length).toBe(2);
  });

  // Un retrait déclaré dit déjà ce qu'on fait de cette consommation : elle
  // part, à ce palier-là. Réclamer en plus une décision de jugement demanderait
  // deux fois la même chose.
  it("does not ask for a decision on a consumption that has a retirement milestone", () => {
    const report = runIntegrityChecks(
      model({ milestones: [], consumptions: [conso({ decision: "", retiredAt: "v2" })] })
    );
    const messages = report.families.find((f) => f.id === "completude")!.anomalies.map((a) => a.message);
    expect(messages.some((m) => m.includes("decision empty"))).toBe(false);
  });

  it("flags an actor with an empty groupe", () => {
    const report = runIntegrityChecks(model({ actors: [actor({ name: "A", group: "" }), actor({ name: "B" })] }));
    expect(report.families.find((f) => f.id === "completude")!.anomalies.length).toBe(1);
  });

  // Le périmètre se saisit désormais sur le groupe, plus sur l'acteur.
  it("flags a groupe with an empty périmètre", () => {
    const report = runIntegrityChecks(model({ groups: [{ name: "G", perimeter: "", sheet: "Groups", row: 0 }] }));
    const messages = report.families.find((f) => f.id === "completude")!.anomalies.map((a) => a.message);
    expect(messages).toContain('Group "G" (Groups, row 0): perimeter not filled in.');
  });
});

describe("7.6 onglet Groupes", () => {
  it("flags a missing Groupes sheet", () => {
    const report = runIntegrityChecks(model({ groups: [], groupesAbsents: true }));
    const messages = report.families.find((f) => f.id === "structure")!.anomalies.map((a) => a.message);
    expect(messages.some((m) => m.includes('Sheet "Groups" missing'))).toBe(true);
  });

  it("flags an actor whose groupe is not declared", () => {
    const report = runIntegrityChecks(model({ groups: [{ name: "Autre", perimeter: "External", sheet: "Groups", row: 0 }] }));
    const messages = report.families.find((f) => f.id === "references")!.anomalies.map((a) => a.message);
    expect(messages.some((m) => m.includes('group "G" missing from the "Groups" sheet'))).toBe(true);
  });

  it("flags a declared groupe nobody belongs to", () => {
    const report = runIntegrityChecks(model({ groups: [{ name: "G", perimeter: "External", sheet: "Groups", row: 0 }, { name: "Orphelin", perimeter: "External", sheet: "Groups", row: 0 }] }));
    const messages = report.families.find((f) => f.id === "references")!.anomalies.map((a) => a.message);
    expect(messages).toContain('Group "Orphelin" (Groups, row 0) is declared but no actor belongs to it.');
  });
});

describe("7.5 candidats au décommissionnement", () => {
  it("is empty when nothing qualifies", () => {
    const report = runIntegrityChecks(model({}));
    expect(report.infoBlocks.find((b) => b.id === "decommissionnement")!.items).toHaveLength(0);
  });

  it("lists an interface whose only consumption is on its way out", () => {
    const report = runIntegrityChecks(model({ consumptions: [conso({ retiredAt: "v2" })] }));
    expect(report.infoBlocks.find((b) => b.id === "decommissionnement")!.items).toEqual(["F (Interfaces, row 0)"]);
  });



  // Le statut d'un composant n'existe plus : il ne peut plus décider seul
  // qu'une interface est candidate au décommissionnement.
  it("does not list an interface whose consumptions are all active", () => {
    const report = runIntegrityChecks(model({}));
    expect(report.infoBlocks.find((b) => b.id === "decommissionnement")!.items).toEqual([]);
  });
});

describe("7.6 interfaces à confirmer", () => {
  it("lists interfaces flagged Oui", () => {
    const report = runIntegrityChecks(model({ interfaces: [iface({ flowName: "F", aConfirmer: true })] }));
    expect(report.infoBlocks.find((b) => b.id === "a-confirmer")!.items).toEqual(["F (Interfaces, row 0)"]);
  });
});

describe("7.7 groupes utilisés", () => {
  it("counts actors per non-empty groupe", () => {
    const report = runIntegrityChecks(
      model({ actors: [actor({ name: "A", group: "Socle" }), actor({ name: "B", group: "Socle" })] })
    );
    expect(report.infoBlocks.find((b) => b.id === "groupes")!.items).toEqual(["Socle (2)"]);
  });
});

describe("totalAnomalies", () => {
  it("counts only the anomaly families, not the informational blocks", () => {
    const report = runIntegrityChecks(model({ interfaces: [iface({ description: "" })] }));
    expect(report.totalAnomalies).toBeGreaterThan(0);
    expect(report.totalAnomalies).toBe(
      report.families.reduce((sum, f) => sum + f.anomalies.length, 0)
    );
  });
});

// C'est le seul contrôle où une faute de frappe produit un schéma FAUX en
// silence : une valeur non reconnue cesse d'atténuer le flux, ou inverse la
// flèche pour un sens de représentation.
describe("7.6 vocabulaires", () => {
  it("reports nothing when every value is in its list", () => {
    const report = runIntegrityChecks(model({}));
    expect(report.families.find((f) => f.id === "vocabulaires")!.anomalies).toHaveLength(0);
  });

  it("flags a mistyped decision or criticité", () => {
    const report = runIntegrityChecks(
      model({ consumptions: [conso({ decision: "A garder", criticality: "Haute" })] })
    );
    const messages = report.families.find((f) => f.id === "vocabulaires")!.anomalies.map((a) => a.message);
    expect(messages.some((m) => m.includes("Haute"))).toBe(true);
    expect(messages.some((m) => m.includes("A garder"))).toBe(true);
    expect(messages.some((m) => m.includes("Haute"))).toBe(true);
  });

  // build-model retombe silencieusement sur « consommateur → exposant » pour
  // toute valeur qu'il ne reconnaît pas : la flèche s'inverserait sans un mot.
  it("flags an unknown sens de représentation, which would silently flip the arrow", () => {
    const report = runIntegrityChecks(
      model({
        flowTypes: [
          base.typeFlux({ type: "HTTP", sensRepresentationBrut: "du client au serveur" }),
        ],
      })
    );
    expect(
      report.families.find((f) => f.id === "vocabulaires")!.anomalies.some((a) => a.message.includes("du client au serveur"))
    ).toBe(true);
  });

  it("flags an unknown nature", () => {
    const report = runIntegrityChecks(
      model({ typesActeur: [{ type: "Application", icone: "app-window", nature: "Fonctionnelle", sheet: "ActorTypes", row: 0 }] })
    );
    expect(
      report.families.find((f) => f.id === "vocabulaires")!.anomalies.some((a) => a.message.includes("Fonctionnelle"))
    ).toBe(true);
  });

  it("stays silent on an empty value, which the complétude family already covers", () => {
    const report = runIntegrityChecks(model({ consumptions: [conso({ statut: "", decision: "", criticality: "" })] }));
    expect(report.families.find((f) => f.id === "vocabulaires")!.anomalies).toHaveLength(0);
  });
});

describe("7.7 signaux non bloquants", () => {
  it("warns about a missing criticité rather than failing the file", () => {
    const report = runIntegrityChecks(model({ consumptions: [conso({ criticality: "" })] }));
    const block = report.infoBlocks.find((b) => b.id === "criticite-manquante")!;
    expect(block.level).toBe("warning");
    expect(block.items).toHaveLength(1);
  });

  // Deux composants peuvent échanger plusieurs fois par la même technologie :
  // c'est légitime, on le montre sans le reprocher.
  it("reports a repeated exchange between the same pair as information", () => {
    const report = runIntegrityChecks(
      model({ consumptions: [conso({}), conso({ flowName: "F", consumerName: "B" })] })
    );
    const block = report.infoBlocks.find((b) => b.id === "echanges-repetes")!;
    expect(block.level).toBe("info");
    expect(block.items.some((i) => i.includes("A → B over HTTP"))).toBe(true);
  });

  it("reports an unused flow type as information", () => {
    const report = runIntegrityChecks(
      model({
        flowTypes: [
          base.typeFlux({ type: "HTTP" }),
          base.typeFlux({ type: "Kafka", sensRepresentation: "provider-to-consumer", sensRepresentationBrut: "provider → consumer" }),
        ],
      })
    );
    const block = report.infoBlocks.find((b) => b.id === "typesflux-inutilises")!;
    expect(block.level).toBe("info");
    expect(block.items).toEqual(["Kafka (FlowTypes, row 0)"]);
  });
});

// Un raccourci pour les modèles à deux versions d'un même contrat : c'est la
// situation que toute cette famille de contrôles décrit.
function modelDeuxVersions(overrides: Partial<ParsedModel> = {}): ParsedModel {
  return model({
    milestones,
    interfaces: [
      iface({ version: "1.0", introducedAt: "v1", retiredAt: "v3" }),
      iface({ version: "2.0", introducedAt: "v1" }),
    ],
    consumptions: [conso({ version: "1.0", introducedAt: "v1" })],
    ...overrides,
  });
}

describe("versions d'interface — références", () => {
  it("reports a consumption whose version is absent from the catalogue", () => {
    const report = runIntegrityChecks(modelDeuxVersions({ consumptions: [conso({ version: "9.9" })] }));
    const messages = report.families.find((f) => f.id === "references")!.anomalies.map((a) => a.message);
    expect(messages.join(" ")).toContain('version "9.9"');
  });

  it("does not confuse two versions of the same flux", () => {
    const report = runIntegrityChecks(modelDeuxVersions());
    const messages = report.families.find((f) => f.id === "references")!.anomalies.map((a) => a.message);
    expect(messages).toEqual([]);
  });
});


describe("versions d'interface — cohérence", () => {
  it("reports a consumer sitting on two versions of the same contract", () => {
    const report = runIntegrityChecks(
      modelDeuxVersions({ consumptions: [conso({ version: "1.0" }), conso({ version: "2.0" })] })
    );
    const messages = report.families.find((f) => f.id === "coherence")!.anomalies.map((a) => a.message);
    expect(messages.join(" ")).toContain("B");
    expect(messages.join(" ")).toContain("two versions");
  });

  it("says nothing when two different consumers each sit on one version", () => {
    const report = runIntegrityChecks(
      modelDeuxVersions({
        actors: [actor({ name: "A" }), actor({ name: "B" }), actor({ name: "C" })],
        consumptions: [conso({ version: "1.0" }), conso({ version: "2.0", consumerName: "C" })],
      })
    );
    const messages = report.families.find((f) => f.id === "coherence")!.anomalies.map((a) => a.message);
    expect(messages.join(" ")).not.toContain("two versions");
  });


});

describe("versions d'interface — bloc action des migrations", () => {
  it("names the interface, both versions and the consumers left behind", () => {
    const report = runIntegrityChecks(modelDeuxVersions());
    const block = report.infoBlocks.find((b) => b.id === "migrations")!;
    expect(block.level).toBe("action");
    expect(block.items).toEqual(["F 1.0 (Interfaces, row 0) → 2.0: B"]);
  });

  it("counts towards the action total, not the anomaly one", () => {
    const report = runIntegrityChecks(modelDeuxVersions());
    expect(report.totalActions).toBeGreaterThan(0);
  });

  // Sans ce libellé, le rapport laisserait croire qu'il suffit de déplacer une
  // cellule, alors que la version d'arrivée reste à créer.
  it("says so when no active version exists to migrate towards", () => {
    const report = runIntegrityChecks(
      model({ milestones, interfaces: [iface({ version: "1.0", retiredAt: "v3", introducedAt: "v1" })], consumptions: [conso({ version: "1.0", introducedAt: "v1" })] })
    );
    const block = report.infoBlocks.find((b) => b.id === "migrations")!;
    expect(block.items).toEqual(["F 1.0 (Interfaces, row 0) → no active version: B"]);
  });

  it("names every active version rather than choosing one", () => {
    const report = runIntegrityChecks(
      model({
        milestones,
        interfaces: [
          iface({ version: "1.0", introducedAt: "v1", retiredAt: "v3" }),
          iface({ version: "2.0", introducedAt: "v1" }),
          iface({ version: "3.0", introducedAt: "v1" }),
        ],
        consumptions: [conso({ version: "1.0", introducedAt: "v1" })],
      })
    );
    const block = report.infoBlocks.find((b) => b.id === "migrations")!;
    expect(block.items).toEqual(["F 1.0 (Interfaces, row 0) → 2.0, 3.0: B"]);
  });

  it("drops an interface nobody consumes any more from the block", () => {
    const report = runIntegrityChecks(modelDeuxVersions({ consumptions: [conso({ version: "2.0" })] }));
    expect(report.infoBlocks.find((b) => b.id === "migrations")!.items).toEqual([]);
  });
});

const milestones = [
  { name: "v1", rank: 1, label: "", statut: "Delivered", date: "", description: "", sheet: "Milestones", row: 0 },
  { name: "v2", rank: 2, label: "", statut: "Delivered", date: "", description: "", sheet: "Milestones", row: 0 },
  { name: "v3", rank: 3, label: "", statut: "Planned", date: "", description: "", sheet: "Milestones", row: 0 },
];

function messagesCoherence(m: ParsedModel): string {
  return runIntegrityChecks(m).families.find((f) => f.id === "coherence")!.anomalies.map((a) => a.message).join(" | ");
}

describe("paliers — contrôles temporels", () => {
  it("says nothing on a workbook whose intervals nest properly", () => {
    const m = model({
      milestones,
      actors: [actor({ name: "A", introducedAt: "v1" }), actor({ name: "B", introducedAt: "v1" })],
      interfaces: [iface({ introducedAt: "v2" })],
      consumptions: [conso({ introducedAt: "v2" })],
    });
    expect(messagesCoherence(m)).not.toContain("milestone");
  });

  // Le même contrôle vu des deux bouts : une interface qui déborde de la vie
  // de son exposant, c'est aussi un acteur retiré qui porte encore des flux.
  it("reports an interface living outside its exposant's own interval", () => {
    const m = model({
      milestones,
      actors: [actor({ name: "A", retiredAt: "v2" }), actor({ name: "B" })],
      interfaces: [iface({ retiredAt: "v3" })],
    });
    expect(messagesCoherence(m)).toContain("A");
  });

  it("reports a consumption living outside its interface's interval", () => {
    const m = model({
      milestones,
      interfaces: [iface({ retiredAt: "v2" })],
      consumptions: [conso({ retiredAt: "v3" })],
    });
    expect(messagesCoherence(m)).toContain("F");
  });

  it("reports a consumption living outside its consumer's interval", () => {
    const m = model({
      milestones,
      actors: [actor({ name: "A" }), actor({ name: "B", introducedAt: "v3" })],
      consumptions: [conso({ introducedAt: "v1" })],
    });
    expect(messagesCoherence(m)).toContain("B");
  });

  it("reports a retirement that precedes the introduction", () => {
    const m = model({ milestones, interfaces: [iface({ introducedAt: "v3", retiredAt: "v1" })] });
    expect(messagesCoherence(m)).toContain("at or before");
  });

  it("reports a palier cited by a row but absent from the Paliers sheet", () => {
    const m = model({ milestones, interfaces: [iface({ introducedAt: "v9" })] });
    const refs = runIntegrityChecks(m).families.find((f) => f.id === "references")!.anomalies.map((a) => a.message);
    expect(refs.join(" ")).toContain("v9");
  });

  it("reports duplicate ranks in the Paliers sheet", () => {
    const m = model({ milestones: [...milestones, { name: "v4", rank: 2, label: "", statut: "Planned", date: "", description: "", sheet: "Milestones", row: 0 }] });
    const struct = runIntegrityChecks(m).families.find((f) => f.id === "structure")!.anomalies.map((a) => a.message);
    expect(struct.join(" ")).toContain("rank");
  });

  // Sans palier livré, le palier courant est indéterminé : les vues se
  // rabattent sur le premier déclaré, autant le dire.
  it("reports a Paliers sheet without a single delivered palier", () => {
    const m = model({ milestones: milestones.map((p) => ({ ...p, statut: "Planned" })) });
    const struct = runIntegrityChecks(m).families.find((f) => f.id === "structure")!.anomalies.map((a) => a.message);
    expect(struct.join(" ")).toContain("Delivered");
  });

  // Un classeur sans aucun palier déclaré ne doit pas se mettre à en parler.
  it("stays silent on a workbook that declares no palier at all", () => {
    const report = runIntegrityChecks(model({}));
    const tout = report.families.flatMap((f) => f.anomalies.map((a) => a.message)).join(" ");
    expect(tout).not.toContain("milestone");
    expect(tout).not.toContain("Milestone");
  });
});

describe("paliers — complétude", () => {
  function messagesCompletude(m: ParsedModel): string {
    return runIntegrityChecks(m).families.find((f) => f.id === "completude")!.anomalies.map((a) => a.message).join(" | ");
  }

  // On ne devine pas à la place de celui qui tient le fichier : au pire il
  // mettra un palier arbitraire, mais le choix lui revient.
  it("reports an interface with no arrival palier", () => {
    const m = model({ milestones, interfaces: [iface({})], consumptions: [] });
    expect(messagesCompletude(m)).toContain("introduction milestone");
  });

  it("reports a consumption with no arrival palier — that is when its consumer arrived", () => {
    const m = model({
      milestones,
      interfaces: [iface({ introducedAt: "v1" })],
      consumptions: [conso({})],
    });
    expect(messagesCompletude(m)).toContain("Consumption");
  });

  it("reports an acteur with no arrival palier", () => {
    const m = model({ milestones, actors: [actor({ name: "A" }), actor({ name: "B", introducedAt: "v1" })] });
    expect(messagesCompletude(m)).toContain("Actor");
  });

  // Un retrait vide n'est pas un manque : c'est un fait, la ligne est encore là.
  it("says nothing about an empty retirement palier", () => {
    const m = model({
      milestones,
      actors: [actor({ name: "A", introducedAt: "v1" }), actor({ name: "B", introducedAt: "v1" })],
      interfaces: [iface({ introducedAt: "v1" })],
      consumptions: [conso({ introducedAt: "v1" })],
    });
    expect(messagesCompletude(m)).not.toContain("milestone");
  });

  // Tant que l'équipe n'a pas adopté l'axe, l'outil n'en parle pas.
  it("stays silent when no palier is declared at all", () => {
    const m = model({ interfaces: [iface({})], consumptions: [conso({})] });
    expect(messagesCompletude(m)).not.toContain("milestone");
  });
});

describe("paliers — le rapport suit le palier affiché", () => {
  const troisPaliers = [
    { name: "v1", rank: 1, label: "", statut: "Delivered", date: "", description: "", sheet: "Milestones", row: 0 },
    { name: "v2", rank: 2, label: "", statut: "Delivered", date: "", description: "", sheet: "Milestones", row: 0 },
  ];

  // Un acteur retiré en v2 n'a évidemment plus de flux en v2 : le signaler
  // remplirait le rapport de fausses anomalies dès la première ligne retirée.
  it("does not blame a retired acteur for having no flow any more", () => {
    const m = model({
      milestones: troisPaliers,
      actors: [
        actor({ name: "A", introducedAt: "v1" }),
        actor({ name: "B", introducedAt: "v1" }),
        actor({ name: "C", introducedAt: "v1", retiredAt: "v2" }),
      ],
      interfaces: [iface({ introducedAt: "v1" })],
      consumptions: [conso({ introducedAt: "v1" })],
    });
    const block = (rank: number) =>
      runIntegrityChecks(m, rank).infoBlocks.find((b) => b.id === "acteurs-sans-flux")!.items;
    expect(block(1)).toContain("C (Actors, row 0)");
    expect(block(2)).not.toContain("C (Actors, row 0)");
  });

  // La structure, elle, juge le classeur et pas un instant de son histoire.
  it("keeps structural checks independent of the displayed palier", () => {
    const m = model({
      milestones: troisPaliers,
      colonnesOptionnellesAbsentes: [{ sheet: "Actors", column: "Group" }],
      actors: [actor({ name: "A", introducedAt: "v1" }), actor({ name: "B", introducedAt: "v1" })],
      interfaces: [iface({ introducedAt: "v1" })],
      consumptions: [conso({ introducedAt: "v1" })],
    });
    const structure = (rank: number) =>
      runIntegrityChecks(m, rank).families.find((f) => f.id === "structure")!.anomalies.length;
    expect(structure(1)).toBe(structure(2));
    expect(structure(1)).toBeGreaterThan(0);
  });
});

// Un rapport sert à corriger. Sans l'adresse, chaque ligne oblige à retrouver
// soi-même la case dans le classeur, et l'ordre de lecture ne suit rien.
describe("emplacement des anomalies", () => {
  const messages = (m: ParsedModel, id: string) =>
    runIntegrityChecks(m).families.find((f) => f.id === id)!.anomalies.map((a) => a.message);

  it("cites the sheet and the row of the line at fault", () => {
    const m = model({
      interfaces: [iface({ description: "", row: 42 })],
      consumptions: [conso({ usage: "", sheet: "FX_A_HTTP", row: 7 })],
    });
    const complétude = messages(m, "completude");

    expect(complétude).toContain('Interface "F" (Interfaces, row 42): description empty.');
    expect(complétude).toContain('Consumption "F" (FX_A_HTTP, row 7): usage not described.');
  });

  it("carries the address as data too, so the report can order and link on it", () => {
    const m = model({ interfaces: [iface({ description: "", row: 42 })] });
    const anomaly = runIntegrityChecks(m)
      .families.find((f) => f.id === "completude")!
      .anomalies.find((a) => a.message.includes("description empty"))!;

    expect(anomaly.emplacement).toEqual({ sheet: "Interfaces", row: 42 });
  });

  it("orders a family by sheet then by ascending row", () => {
    const m = model({
      actors: [actor({ name: "A", group: "" , row: 9 }), actor({ name: "B", group: "", row: 3 })],
      interfaces: [iface({ description: "", lienContrat: "l", row: 5 })],
      consumptions: [],
    });
    const adresses = runIntegrityChecks(m)
      .families.find((f) => f.id === "completude")!
      .anomalies.map((a) => `${a.emplacement!.sheet}:${a.emplacement!.row}`);

    expect(adresses).toEqual(["Actors:3", "Actors:9", "Interfaces:5"]);
  });

  it("puts what has no address first, since it points at the file rather than a line", () => {
    const m = model({
      groupesAbsents: true,
      groups: [],
      interfaces: [iface({ expectedSheet: "FX_A_MQTT", row: 4 })],
      consumptions: [],
      fxSheetNames: [],
    });
    const structure = runIntegrityChecks(m).families.find((f) => f.id === "structure")!.anomalies;

    expect(structure[0].emplacement).toBeUndefined();
    expect(structure.some((a) => a.emplacement)).toBe(true);
  });
});

describe("emplacement des blocs informatifs", () => {
  const block = (m: ParsedModel, id: string) =>
    runIntegrityChecks(m).infoBlocks.find((b) => b.id === id)!.items;

  it("cites the address on every item that designates a line", () => {
    const m = model({
      actors: [actor({ name: "A", row: 2 }), actor({ name: "B", row: 3 }), actor({ name: "Seul", row: 8 })],
      interfaces: [iface({ aConfirmer: true, row: 5 })],
      consumptions: [conso({ criticality: "", row: 6 })],
      flowTypes: [
        base.typeFlux({ type: "HTTP", row: 2 }),
        base.typeFlux({ type: "SFTP", row: 3 }),
      ],
    });

    expect(block(m, "acteurs-sans-flux")).toEqual(["Seul (Actors, row 8)"]);
    expect(block(m, "a-confirmer")).toEqual(["F (Interfaces, row 5)"]);
    expect(block(m, "criticite-manquante")).toEqual(["F (FX_A_HTTP, row 6) — B"]);
    expect(block(m, "typesflux-inutilises")).toEqual(["SFTP (FlowTypes, row 3)"]);
  });

  it("orders a block by ascending row, like the rest of the report", () => {
    const m = model({
      actors: [actor({ name: "A", row: 2 }), actor({ name: "Z", row: 4 }), actor({ name: "M", row: 9 })],
      interfaces: [],
      consumptions: [],
    });

    expect(block(m, "acteurs-sans-flux")).toEqual(["A (Actors, row 2)", "Z (Actors, row 4)", "M (Actors, row 9)"]);
  });
});

describe("cycles de dépendance", () => {
  const cycles = (m: ParsedModel, rank: number | null = null) =>
    runIntegrityChecks(m, rank).infoBlocks.find((b) => b.id === "cycles")!.items;

  // Un consommateur dépend de l'exposant de l'interface qu'il consomme.
  // A expose F1 que B consomme ; B expose F2 que A consomme : chacun a besoin
  // de l'autre pour fonctionner.
  function boucle(names: string[]) {
    const interfaces = names.map((name, i) =>
      iface({ flowName: `F${i}`, providerName: name, expectedSheet: `FX_${name}_HTTP` })
    );
    const consumptions = names.map((name, i) =>
      conso({
        flowName: `F${i}`,
        // Chacun est consommé par le suivant, le dernier par le premier.
        consumerName: names[(i + 1) % names.length],
        sheet: `FX_${name}_HTTP`,
      })
    );
    return {
      actors: names.map((name) => actor({ name })),
      interfaces,
      consumptions,
      fxSheetNames: names.map((name) => `FX_${name}_HTTP`),
    };
  }

  it("stays silent on a workbook where nothing loops", () => {
    expect(cycles(model({}))).toEqual([]);
  });

  it("names the two components that need each other", () => {
    expect(cycles(model(boucle(["A", "B"])))).toEqual(["A, B (2 components)"]);
  });

  // La dépendance se propage : A a besoin de C sans jamais le citer.
  it("finds a loop that closes through a third component", () => {
    expect(cycles(model(boucle(["A", "B", "C"])))).toEqual(["A, B, C (3 components)"]);
  });

  // Un acteur qui consomme sa propre interface n'est pas un cycle entre
  // composants : c'est une boucle interne, que les vues agrégées masquent déjà.
  it("ignores a component that consumes its own interface", () => {
    const m = model({
      actors: [actor({ name: "A" })],
      interfaces: [iface({ providerName: "A" })],
      consumptions: [conso({ consumerName: "A" })],
    });
    expect(cycles(m)).toEqual([]);
  });

  it("reports two independent loops separately", () => {
    const un = boucle(["A", "B"]);
    const deux = boucle(["Y", "Z"]);
    const m = model({
      actors: [...un.actors, ...deux.actors],
      interfaces: [...un.interfaces, ...deux.interfaces],
      consumptions: [...un.consumptions, ...deux.consumptions],
      fxSheetNames: [...un.fxSheetNames, ...deux.fxSheetNames],
    });
    expect(cycles(m)).toEqual(["A, B (2 components)", "Y, Z (2 components)"]);
  });

  // Le cycle est un état de la plateforme, pas un défaut du fichier : ce qui
  // est retiré au palier affiché ne le referme plus.
  it("reads the loop at the milestone on show", () => {
    const boucleV1 = boucle(["A", "B"]);
    const m = model({
      ...boucleV1,
      milestones,
      actors: boucleV1.actors.map((a) => ({ ...a, introducedAt: "v1" })),
      interfaces: boucleV1.interfaces.map((i) => ({ ...i, introducedAt: "v1" })),
      consumptions: boucleV1.consumptions.map((c, i) => ({
        ...c,
        introducedAt: "v1",
        // Un seul des deux liens part au palier 2 : la boucle s'ouvre.
        retiredAt: i === 0 ? "v2" : "",
      })),
    });
    expect(cycles(m, 1)).toEqual(["A, B (2 components)"]);
    expect(cycles(m, 2)).toEqual([]);
  });
});

describe("nature et relais", () => {
  const TYPES = [
    { type: "Application", icone: "app-window", nature: "Business", sheet: "ActorTypes", row: 2 },
    { type: "Middleware", icone: "server", nature: "Technical", sheet: "ActorTypes", row: 3 },
  ];
  const messages = (m: ParsedModel, family: string) =>
    runIntegrityChecks(m).families.find((f) => f.id === family)!.anomalies.map((a) => a.message).join(" | ");

  // La republication est portée par la ligne de consommation du bus : c'est
  // elle qui dit sous laquelle de SES interfaces l'entrée ressort.
  function parcRelais(republishedAs = "trx.norm"): ParsedModel {
    return model({
      typesActeur: TYPES,
      actors: [actor({ name: "Tatooine" }), actor({ name: "Bus", typeActeur: "Middleware" }), actor({ name: "B" })],
      interfaces: [
        iface({ flowName: "Transactions", providerName: "Tatooine" }),
        iface({ flowName: "trx.norm", providerName: "Bus", expectedSheet: "FX_Bus_HTTP" }),
      ],
      consumptions: [
        conso({ flowName: "Transactions", consumerName: "Bus", republishedAs }),
        conso({ flowName: "trx.norm", consumerName: "B", sheet: "FX_Bus_HTTP" }),
      ],
      fxSheetNames: ["FX_A_HTTP", "FX_Bus_HTTP"],
    });
  }

  it("ne signale rien sur une chaîne entière", () => {
    expect(messages(parcRelais(), "references")).not.toContain("republished");
    expect(messages(parcRelais(), "coherence")).not.toContain("republish");
  });

  it("signale une republication vers une interface que l'acteur n'expose pas", () => {
    expect(messages(parcRelais("Fantôme"), "references")).toContain("Fantôme");
  });

  it("signale une republication déclarée par un acteur métier", () => {
    const m = parcRelais();
    m.consumptions[1].republishedAs = "Autre chose";
    expect(messages(m, "coherence")).toContain("only plumbing relays");
  });

  it("signale une interface republiée que rien n'alimente", () => {
    expect(messages(parcRelais(""), "coherence")).toContain("nothing feeds it");
  });

  // Le bus fourre-tout : le flux entre dans la plomberie et n'en ressort pour
  // personne, sans quoi le lien fonctionnel manquerait en silence.
  it("signale un flux qui entre chez un technique et n'en ressort pour personne", () => {
    const m = parcRelais();
    m.interfaces.push(iface({ flowName: "Référentiel", providerName: "Tatooine", expectedSheet: "FX_Tatooine_REF" }));
    m.consumptions.push(conso({ flowName: "Référentiel", consumerName: "Bus", sheet: "FX_Tatooine_REF" }));
    m.fxSheetNames.push("FX_Tatooine_REF");
    expect(messages(m, "coherence")).toContain("Référentiel");
  });

  it("signale une nature hors vocabulaire", () => {
    const m = parcRelais();
    m.typesActeur = [{ ...TYPES[0], nature: "Métier" }, TYPES[1]];
    expect(messages(m, "vocabulaires")).toContain("Métier");
  });

  it("réclame la nature manquante dès qu'un type en déclare une", () => {
    const m = parcRelais();
    m.typesActeur = [{ ...TYPES[0], nature: "" }, TYPES[1]];
    expect(messages(m, "completude")).toContain("nature");
  });

  // Tant que l'équipe n'a pas adopté la distinction, l'outil n'en parle pas.
  it("se tait sur un classeur où aucun type ne déclare de nature", () => {
    const m = parcRelais();
    m.typesActeur = TYPES.map((t) => ({ ...t, nature: "" }));
    expect(messages(m, "completude")).not.toContain("nature");
  });
});

// --- QA : le rapport et les schémas décrivent le MÊME palier et doivent donc
// retenir les mêmes flux. Les schémas (aggregation/core.ts) exigent la chaîne
// entière vivante -- exposant, interface, consommation, consommateur ; le
// rapport filtrait les trois tables chacune de son côté, donc gardait une
// consommation dont l'acteur avait disparu. Le rapport contredisait le schéma
// affiché à côté de lui.
describe("rapport au palier — la chaîne entière, comme les schémas", () => {
  const auPalier = (rank: number) =>
    runIntegrityChecks(
      model({
        milestones: [
          { name: "v1", rank: 1, label: "", statut: "", date: "", description: "", sheet: "Milestones", row: 0 },
          { name: "v2", rank: 2, label: "", statut: "", date: "", description: "", sheet: "Milestones", row: 0 },
        ],
        actors: [actor({ name: "A", retiredAt: "v1" }), actor({ name: "B" })],
        interfaces: [iface({ providerName: "A" })],
        consumptions: [conso({ consumerName: "B" })],
      }),
      rank
    );

  it("ne cite plus un acteur retiré dans les blocs informatifs", () => {
    expect(JSON.stringify(auPalier(1).infoBlocks)).not.toContain('"A"');
  });

  it("laisse tomber la consommation dont l'exposant a disparu", () => {
    const sansFlux = auPalier(1).infoBlocks.find((b) => b.title.includes("no flow"));
    expect(sansFlux?.items.join(" ")).toContain("B");
  });

  it("garde tout tant que l'acteur vit", () => {
    const sansFlux = auPalier(0).infoBlocks.find((b) => b.title.includes("no flow"));
    expect(sansFlux?.items.join(" ")).not.toContain("B");
  });
});

// --- QA : la frise elle-même n'était pas contrôlée. Un rang illisible vaut 0
// à la lecture -- « un contrôle réclame le rang », promettait le commentaire de
// build-model.ts, mais ce contrôle n'existait pas. Et deux paliers dont les
// noms ne diffèrent que par la casse se confondent, puisque c'est sur le nom
// normalisé que toute ligne datée résout son rang.
describe("frise des paliers", () => {
  const milestone = (name: string, rank: number) => ({
    name, rank, label: "", statut: "Delivered", date: "", description: "",
    sheet: "Milestones", row: 0,
  });
  // Toute ligne datée doit porter sa borne d'introduction dès qu'une frise
  // existe : sans elle, ce sont ces anomalies-là qu'on lirait, pas celles de
  // la frise.
  const anomalies = (milestones: ReturnType<typeof milestone>[]) => {
    const dès = { introducedAt: milestones[0].name };
    return runIntegrityChecks(
      model({
        milestones,
        actors: [actor({ name: "A", ...dès }), actor({ name: "B", ...dès })],
        interfaces: [iface({ ...dès })],
        consumptions: [conso({ ...dès })],
      })
    )
      .families.flatMap((f) => f.anomalies)
      .map((a) => a.message)
      .join(" ");
  };

  it("réclame un rang exploitable", () => {
    expect(anomalies([milestone("v1", 1), milestone("v2", 0)])).toContain("v2");
  });

  it("signale deux paliers que la casse seule distingue", () => {
    expect(anomalies([milestone("v1", 1), milestone("V1", 2)])).toContain("V1");
  });

  it("laisse une frise saine tranquille", () => {
    expect(anomalies([milestone("v1", 1), milestone("v2", 2)])).toBe("");
  });
});

// --- QA : deux blocs nommaient l'interface sans sa version. Deux versions d'un
// même contrat donnaient alors deux items rigoureusement identiques à l'œil,
// alors que « Migrations under way » sait écrire « F 1.0 » depuis le début.
describe("blocs informatifs — une interface se nomme avec sa version", () => {
  const deuxVersions = () =>
    model({
      interfaces: [
        iface({ flowName: "F", version: "1.0", aConfirmer: true }),
        iface({ flowName: "F", version: "2.0", aConfirmer: true, row: 1 }),
      ],
      consumptions: [],
    });

  it("distingue les deux versions dans « Interfaces to confirm »", () => {
    const block = runIntegrityChecks(deuxVersions()).infoBlocks.find((b) => b.title === "Interfaces to confirm")!;
    expect(block.items).toHaveLength(2);
    expect(new Set(block.items.map((i) => i.replace(/\(.*\)/, "")))).toHaveProperty("size", 2);
  });
});

// --- QA : deux acteurs peuvent publier un contrat de même nom sans s'être
// concertés -- c'est banal, et ce sont deux interfaces distinctes. Le contrôle
// les prenait pour un doublon parce qu'il ne regardait que (nom, version) : sur
// un classeur réel, 4 faux doublons sur 9. L'exposant fait partie de l'identité.
describe("doublon d'interface — l'exposant fait partie de l'identité", () => {
  const avec = (interfaces: ReturnType<typeof iface>[]) =>
    runIntegrityChecks(model({ interfaces, consumptions: [] }))
      .families.flatMap((f) => f.anomalies)
      .map((a) => a.message)
      .filter((m) => m.includes("more than once"));

  it("ne signale pas deux exposants différents pour un même nom", () => {
    expect(
      avec([
        iface({ flowName: "Kashyyyk", providerName: "A", expectedSheet: "FX_A_HTTP" }),
        iface({ flowName: "Kashyyyk", providerName: "B", expectedSheet: "FX_B_HTTP" }),
      ])
    ).toHaveLength(0);
  });

  it("signale toujours le même nom chez le même exposant", () => {
    expect(
      avec([
        iface({ flowName: "Kashyyyk", providerName: "A" }),
        iface({ flowName: "Kashyyyk", providerName: "A", row: 1 }),
      ])
    ).toHaveLength(1);
  });

  it("laisse deux versions d'un même contrat tranquilles", () => {
    expect(
      avec([
        iface({ flowName: "Kashyyyk", version: "1.0", providerName: "A" }),
        iface({ flowName: "Kashyyyk", version: "2.0", providerName: "A", row: 1 }),
      ])
    ).toHaveLength(0);
  });
});

// --- QA : couper le nom à 31 caractères peut faire tomber deux couples
// (exposant, type de flux) sur le même onglet. Les fondre mélangerait les
// consommations de deux contrats sans un mot ; le contrôle le dit, et
// l'utilisateur raccourcit un nom.
describe("onglet FX_ — deux couples qui tombent sur le même nom", () => {
  const messages = (interfaces: ReturnType<typeof iface>[]) =>
    runIntegrityChecks(model({ interfaces, consumptions: [] }))
      .families.flatMap((f) => f.anomalies)
      .map((a) => a.message)
      .filter((m) => m.includes("same sheet"));

  const long = (suffixe: string) => `Plateforme de règlement-livraison ${suffixe}`;

  it("signale deux exposants dont les noms coupés se confondent", () => {
    const dits = messages([
      iface({ flowName: "F", providerName: long("Nord"), expectedSheet: expectedFxSheet(long("Nord"), "HTTP") }),
      iface({ flowName: "G", providerName: long("Sud"), expectedSheet: expectedFxSheet(long("Sud"), "HTTP"), row: 1 }),
    ]);
    expect(dits).toHaveLength(1);
    expect(dits[0]).toContain("Plateforme de règlement-livraison");
  });

  it("ne dit rien quand les onglets diffèrent", () => {
    expect(
      messages([
        iface({ flowName: "F", providerName: "Tatooine", expectedSheet: expectedFxSheet("Tatooine", "HTTP") }),
        iface({ flowName: "G", providerName: "Chandrila", expectedSheet: expectedFxSheet("Chandrila", "HTTP"), row: 1 }),
      ])
    ).toHaveLength(0);
  });

  it("ne dit rien pour deux interfaces du même couple, qui partagent l'onglet à juste titre", () => {
    expect(
      messages([
        iface({ flowName: "F", providerName: "Tatooine" }),
        iface({ flowName: "G", providerName: "Tatooine", row: 1 }),
      ])
    ).toHaveLength(0);
  });
});

// --- QA : une chaîne coupée par un relais qu'on ne peut pas suivre ne
// produisait AUCUNE anomalie. Le lien fonctionnel manquait donc en silence --
// exactement ce que le contrôle du bus fourre-tout cherche à éviter par
// ailleurs.
// --- Les deux cas simples sont couverts plus haut. Celui-ci ne l'est pas : la
// chaîne casse AU MILIEU, à deux sauts du consommateur métier. La remontée
// devant descendre récursivement, une coupure profonde pourrait très bien ne
// jamais remonter jusqu'au rapport.
describe("chaîne cassée en son milieu", () => {
  const TYPES = [
    { type: "Application", icone: "app-window", nature: "Business", sheet: "ActorTypes", row: 0 },
    { type: "Middleware", icone: "server", nature: "Technical", sheet: "ActorTypes", row: 0 },
  ];

  it("signale l'interface fautive, pas celle par laquelle on est entré", () => {
    const m = model({
      typesActeur: TYPES,
      actors: [
        actor({ name: "A" }),
        actor({ name: "X", typeActeur: "Middleware" }),
        actor({ name: "Y", typeActeur: "Middleware" }),
        actor({ name: "C" }),
      ],
      interfaces: [
        iface({ flowName: "f0", providerName: "A", expectedSheet: "FX_A_HTTP" }),
        iface({ flowName: "f1", providerName: "X", expectedSheet: "FX_X_HTTP", row: 1 }),
        iface({ flowName: "f2", providerName: "Y", expectedSheet: "FX_Y_HTTP", row: 2 }),
      ],
      consumptions: [
        // f0 arrive bien chez X, mais X ne dit pas sous quoi il le republie :
        // c'est f1 qui n'est alimentée par rien.
        conso({ flowName: "f0", consumerName: "X", sheet: "FX_A_HTTP" }),
        conso({ flowName: "f1", consumerName: "Y", sheet: "FX_X_HTTP", republishedAs: "f2", row: 1 }),
        conso({ flowName: "f2", consumerName: "C", sheet: "FX_Y_HTTP", row: 2 }),
      ],
      fxSheetNames: ["FX_A_HTTP", "FX_X_HTTP", "FX_Y_HTTP"],
    });
    const dits = runIntegrityChecks(m)
      .families.flatMap((f) => f.anomalies)
      .map((a) => a.message)
      .filter((msg) => msg.includes("nothing feeds it"));
    expect(dits).toHaveLength(1);
    expect(dits[0]).toContain('"f1"');
  });
});


// --- La couleur des technologies viendra d'un référentiel externe, en
// hexadécimal. Une valeur qui n'en est pas une, ou deux technologies qui
// partagent la même, ne se voient pas dans le classeur : la première retombe
// silencieusement sur la palette, la seconde rend deux traits indiscernables.
describe("couleur déclarée d'une technologie", () => {
  const parc = (colours: [string, string][]) =>
    model({
      flowTypes: colours.map(([type, colour], i) => base.typeFlux({ type, colour, row: i })),
      interfaces: colours.map(([type], i) =>
        iface({ flowName: `F${i}`, flowType: type, expectedSheet: `FX_A_${type}`, row: i })
      ),
      consumptions: [],
      fxSheetNames: colours.map(([type]) => `FX_A_${type}`),
    });

  const messages = (m: ParsedModel) =>
    runIntegrityChecks(m).families.flatMap((f) => f.anomalies).map((a) => a.message).filter((x) => x.includes("colour"));

  it("accepte un hexadécimal, avec ou sans dièse", () => {
    expect(messages(parc([["HTTP", "#2a78d6"], ["Kafka", "eb6834"]]))).toHaveLength(0);
  });

  it("accepte une couleur absente", () => {
    expect(messages(parc([["HTTP", ""], ["Kafka", ""]]))).toHaveLength(0);
  });

  it("signale une valeur qui n'est pas une couleur", () => {
    expect(messages(parc([["HTTP", "bleu ciel"]]))[0]).toContain("bleu ciel");
  });

  it("signale deux technologies qui déclarent la même couleur", () => {
    const dits = messages(parc([["HTTP", "#2a78d6"], ["Kafka", "#2A78D6"]]));
    expect(dits).toHaveLength(1);
    expect(dits[0]).toContain("Kafka");
  });
});

// --- Une technologie non déclarée au référentiel rend son sens de
// représentation inconnu : l'interface et toutes ses consommations sortent des
// schémas. Le rapport nommait la faute sans dire ce qu'elle coûte -- sur un
// classeur réel, 24 interfaces sur 59 absentes de tout dessin, pour une ligne
// qui avait l'air d'un simple rappel de vocabulaire.
describe("technologie absente du référentiel", () => {
  it("dit que l'interface n'est plus dessinée", () => {
    const m = model({
      interfaces: [iface({ flowType: "Inconnue" })],
      consumptions: [],
    });
    const dit = runIntegrityChecks(m)
      .families.flatMap((f) => f.anomalies)
      .map((a) => a.message)
      .find((msg) => msg.includes("Inconnue"))!;
    expect(dit).toContain("not drawn");
  });
});

// --- QA : le périmètre décide de tout le dessin -- ce qui est dans la
// frontière, ce qui est dehors -- et son vocabulaire n'était pas contrôlé. Une
// valeur fautive ne déclenchait donc rien : le groupe n'était ni plateforme ni
// externe, silencieusement.
describe("vocabulaire du périmètre", () => {
  const messages = (perimeter: string) =>
    runIntegrityChecks(model({ groups: [{ name: "G", perimeter, sheet: "Groups", row: 0 }] }))
      .families.flatMap((f) => f.anomalies)
      .map((a) => a.message)
      .filter((m) => m.toLowerCase().includes("perimeter"));

  it("accepte les deux valeurs, à la casse et aux accents près", () => {
    for (const v of ["Platform", "platform", "External", "EXTERNAL"]) {
      expect(messages(v).filter((m) => m.includes("unknown"))).toHaveLength(0);
    }
  });

  it("signale une valeur hors vocabulaire", () => {
    expect(messages("Platfrom").some((m) => m.includes("Platfrom"))).toBe(true);
  });
});

// --- QA : le filtre du palier jugeait l'EXISTENCE en plus de la vie. Un
// exposant absent de l'onglet Actors -- une faute de référence, que les
// contrôles signalent par ailleurs -- faisait donc disparaître son interface du
// rapport, alors que les schémas la dessinent (core.ts la traite comme vivante,
// délibérément). Le rapport déclarait « B sans flux » sous un schéma qui montre
// un flux vers B.
describe("filtre du palier — un acteur inconnu n'est pas un acteur mort", () => {
  const fantome = () =>
    model({
      milestones: [
        { name: "v1", rank: 1, label: "", statut: "Delivered", date: "", description: "", sheet: "Milestones", row: 0 },
        { name: "v2", rank: 2, label: "", statut: "Delivered", date: "", description: "", sheet: "Milestones", row: 1 },
      ],
      // « Fantome » expose, mais ne figure pas dans l'onglet Actors.
      actors: [actor({ name: "B", introducedAt: "v1" })],
      interfaces: [iface({ providerName: "Fantome", introducedAt: "v1" })],
      consumptions: [conso({ consumerName: "B", introducedAt: "v1" })],
    });

  const blocks = (rank: number | null) =>
    runIntegrityChecks(fantome(), rank).infoBlocks.flatMap((b) => b.items.map((i) => `${b.title} | ${i}`));

  it("ne déclare pas sans flux un acteur que le schéma relie", () => {
    expect(buildFlowInstances(fantome(), 1)).toHaveLength(1);
    expect(blocks(1).filter((i) => i.includes("no flow"))).toHaveLength(0);
  });

  it("dit la même chose au palier et hors palier", () => {
    expect(blocks(1).filter((i) => /no flow|Unused flow/.test(i))).toEqual(
      blocks(null).filter((i) => /no flow|Unused flow/.test(i))
    );
  });

  // Un acteur CONNU et retiré, lui, retire bien ses flux : c'est l'autre moitié
  // de la règle, corrigée plus tôt, et elle ne doit pas se rouvrir.
  it("retire toujours les flux d'un acteur connu et retiré", () => {
    const m = model({
      milestones: [{ name: "v1", rank: 1, label: "", statut: "Delivered", date: "", description: "", sheet: "Milestones", row: 0 }],
      actors: [actor({ name: "A", introducedAt: "v1", retiredAt: "v1" }), actor({ name: "B", introducedAt: "v1" })],
      interfaces: [iface({ providerName: "A", introducedAt: "v1" })],
      consumptions: [conso({ consumerName: "B", introducedAt: "v1" })],
    });
    expect(buildFlowInstances(m, 1)).toHaveLength(0);
  });
});

// --- QA : les contrôles de cohérence jugeaient TOUS le classeur entier. Ce que
// le schéma du palier affiché montre -- une interface qui y perd son dernier
// consommateur, une chaîne de relais que le temps coupe -- disparaissait donc
// en silence sous un schéma vide. Symétriquement, deux lignes datées d'une même
// migration étaient comptées ensemble, et le fichier se voyait reprocher de
// suivre sa propre consigne.
const messagesRecette = (m: Parameters<typeof runIntegrityChecks>[0], rank: number | null) =>
  runIntegrityChecks(m, rank).families.flatMap((f) => f.anomalies.map((a) => a.message));
// ---------------------------------------------------------------------------
// 3. Le rapport d'intégrité face à l'axe des paliers.
// ---------------------------------------------------------------------------

const PALIERS_RECETTE = [base.milestone({ name: "v1", rank: 1 }), base.milestone({ name: "v2", rank: 2 }), base.milestone({ name: "v3", rank: 3 })];
const SOCLE_RECETTE = {
  groups: [base.group({ name: "G" })],
  typesActeur: [base.typeActeur()],
  flowTypes: [base.typeFlux()],
  milestones: PALIERS_RECETTE,
  fxSheetNames: ["FX_A_HTTP"],
};

describe("le rapport d'intégrité et l'axe des paliers", () => {
  it("ne crie pas à l'incohérence sur une migration datée à deux lignes", () => {
    // Ce que le mode d'emploi du classeur prescrit : « Obsolete row: do not
    // delete it: give it a retirement milestone. » Les deux intervalles sont
    // DISJOINTS -- à aucun palier B ne consomme deux versions.
    const m = base.template({
      ...SOCLE_RECETTE,
      actors: [base.actor({ name: "A", introducedAt: "v1" }), base.actor({ name: "B", introducedAt: "v1" })],
      interfaces: [
        base.iface({ flowName: "F", version: "1.0", providerName: "A", introducedAt: "v1", retiredAt: "v2" }),
        base.iface({ flowName: "F", version: "2.0", providerName: "A", introducedAt: "v2" }),
      ],
      consumptions: [
        base.conso({ flowName: "F", version: "1.0", consumerName: "B", introducedAt: "v1", retiredAt: "v2", row: 2 }),
        base.conso({ flowName: "F", version: "2.0", consumerName: "B", introducedAt: "v2", row: 3 }),
      ],
    });
    expect(buildFlowInstances(m, 1).map((f) => f.version)).toEqual(["1.0"]);
    expect(buildFlowInstances(m, 2).map((f) => f.version)).toEqual(["2.0"]);
    for (const rank of [null, 1, 2, 3]) {
      expect(messagesRecette(m, rank).filter((x) => x.includes("two versions"))).toEqual([]);
    }
  });

  it("signale une consommation dont l'intervalle ne rencontre jamais celui de son interface", () => {
    const m = base.template({
      ...SOCLE_RECETTE,
      actors: [base.actor({ name: "A", introducedAt: "v1" }), base.actor({ name: "B", introducedAt: "v1" })],
      interfaces: [base.iface({ flowName: "F", providerName: "A", introducedAt: "v1", retiredAt: "v2" })],
      consumptions: [base.conso({ flowName: "F", consumerName: "B", introducedAt: "v2" })],
    });
    expect([1, 2, 3].map((r) => buildFlowInstances(m, r).length)).toEqual([0, 0, 0]);
    expect(messagesRecette(m, 2).some((x) => x.includes("lives outside the lifetime"))).toBe(true);
  });

  it("dit qu'une interface n'a plus de consommation au palier affiché", () => {
    const m = base.template({
      ...SOCLE_RECETTE,
      actors: [base.actor({ name: "A", introducedAt: "v1" }), base.actor({ name: "B", introducedAt: "v1" })],
      interfaces: [base.iface({ flowName: "F", providerName: "A", introducedAt: "v1" })],
      consumptions: [base.conso({ flowName: "F", consumerName: "B", introducedAt: "v1", retiredAt: "v2" })],
    });
    expect(buildFlowInstances(m, 2)).toHaveLength(0);
    expect(messagesRecette(m, 2).some((x) => x.includes("no declared consumption"))).toBe(true);
  });

  it("dit qu'une chaîne de relais est coupée par le temps", () => {
    const m = base.template({
      milestones: [base.milestone({ name: "v1", rank: 1 }), base.milestone({ name: "v2", rank: 2 })],
      groups: [base.group({ name: "G" })],
      actors: [
        base.actor({ name: "Src", introducedAt: "v1" }),
        base.actor({ name: "Bus", typeActeur: "Infra", introducedAt: "v1" }),
        base.actor({ name: "Dst", introducedAt: "v1" }),
      ],
      typesActeur: [base.typeActeur({ nature: "Business" }), base.typeActeur({ type: "Infra", nature: "Technical" })],
      flowTypes: [base.typeFlux()],
      fxSheetNames: ["FX_Src_HTTP", "FX_Bus_HTTP"],
      interfaces: [
        base.iface({ flowName: "In", providerName: "Src", expectedSheet: "FX_Src_HTTP", introducedAt: "v1" }),
        base.iface({ flowName: "Out", providerName: "Bus", expectedSheet: "FX_Bus_HTTP", introducedAt: "v1" }),
      ],
      consumptions: [
        base.conso({ flowName: "In", consumerName: "Bus", sheet: "FX_Src_HTTP", republishedAs: "Out", introducedAt: "v1", retiredAt: "v2" }),
        base.conso({ flowName: "Out", consumerName: "Dst", sheet: "FX_Bus_HTTP", introducedAt: "v1" }),
      ],
    });
    expect(buildFunctionalFlows(m, 1)).toHaveLength(1);
    expect(buildFunctionalFlows(m, 2)).toHaveLength(0);
    expect(messagesRecette(m, 2).some((x) => x.includes("nothing feeds it"))).toBe(true);
  });

  it("ne prétend pas qu'un nom de flux est absent du catalogue quand le schéma le dessine", () => {
    const m = base.template({
      groups: [base.group({ name: "G" })],
      actors: [base.actor({ name: "A" }), base.actor({ name: "B" })],
      typesActeur: [base.typeActeur()],
      flowTypes: [base.typeFlux()],
      fxSheetNames: ["FX_A_HTTP"],
      interfaces: [base.iface({ flowName: "Authent", providerName: "A", expectedSheet: "FX_A_HTTP" })],
      consumptions: [base.conso({ flowName: "authent", consumerName: "B", sheet: "FX_A_HTTP" })],
    });
    expect(buildFlowInstances(m, null)).toHaveLength(1);
    expect(messagesRecette(m, null).some((x) => x.includes("missing from the Interfaces catalogue"))).toBe(false);
  });
});


// --- Le classeur fait foi sur la couleur, mais il doit savoir qu'on a dû la
// corriger : sinon la teinte à l'écran n'est pas celle qu'il a écrite, et
// personne ne comprend pourquoi.
describe("contrôles — couleurs trop claires pour être dessinées", () => {
  const block = (colour: string) =>
    runIntegrityChecks(model({ flowTypes: [base.typeFlux({ type: "HTTP", colour })] })).infoBlocks.find(
      (b) => b.id === "contraste"
    );

  it("signale une couleur déclarée trop claire pour un trait", () => {
    expect(block("#ffee00")?.items.join(" ")).toContain("HTTP");
    expect(block("#ffee00")?.level).toBe("warning");
  });

  it("ne signale rien quand la couleur déclarée passe le seuil", () => {
    expect(block("#1f5fae")?.items).toEqual([]);
  });

  // Une valeur qui n'est pas une couleur relève des contrôles de vocabulaire,
  // pas d'ici : la signaler deux fois dirait deux fois la même case.
  it("ne signale pas une valeur qui n'est pas une couleur", () => {
    expect(block("bleu ciel")?.items).toEqual([]);
  });
});

// --- Le graphe de dépendances existait et ne servait qu'aux cycles. « Si X
// tombe, qui est touché ? » est pourtant la question du jour où il faut
// arbitrer une migration, et rien n'y répondait.
describe("contrôles — rayon d'impact", () => {
  const block = (m: ParsedModel) => runIntegrityChecks(m).infoBlocks.find((b) => b.id === "rayon-impact");

  // A fournit B, B fournit C : A entraîne les deux.
  const chain = () =>
    model({
      actors: [actor({ name: "A" }), actor({ name: "B" }), actor({ name: "C" })],
      fxSheetNames: ["FX_A_HTTP", "FX_B_HTTP"],
      interfaces: [
        iface({ flowName: "F1", providerName: "A", expectedSheet: "FX_A_HTTP" }),
        iface({ flowName: "F2", providerName: "B", expectedSheet: "FX_B_HTTP" }),
      ],
      consumptions: [
        conso({ flowName: "F1", consumerName: "B", sheet: "FX_A_HTTP" }),
        conso({ flowName: "F2", consumerName: "C", sheet: "FX_B_HTTP" }),
      ],
    });

  it("compte l'aval transitif, pas seulement les voisins", () => {
    expect(block(chain())?.items[0]).toBe("A: 2 components downstream.");
  });

  it("classe le plus entraînant en tête", () => {
    expect(block(chain())?.items.map((i) => i.split(":")[0])).toEqual(["A", "B"]);
  });

  // Nommer avec un zéro allongerait la liste sans rien y ajouter.
  it("ne nomme pas ceux qui n'entraînent personne", () => {
    expect(block(chain())?.items.some((i) => i.startsWith("C:"))).toBe(false);
  });

  it("accorde le singulier", () => {
    expect(block(chain())?.items[1]).toBe("B: 1 component downstream.");
  });

  // Un cycle ramène l'acteur dans son propre aval : « combien j'en entraîne »
  // ne doit pas me compter moi-même.
  it("ne se compte pas soi-même quand un cycle y ramène", () => {
    const boucle = model({
      actors: [actor({ name: "A" }), actor({ name: "B" })],
      fxSheetNames: ["FX_A_HTTP", "FX_B_HTTP"],
      interfaces: [
        iface({ flowName: "F1", providerName: "A", expectedSheet: "FX_A_HTTP" }),
        iface({ flowName: "F2", providerName: "B", expectedSheet: "FX_B_HTTP" }),
      ],
      consumptions: [
        conso({ flowName: "F1", consumerName: "B", sheet: "FX_A_HTTP" }),
        conso({ flowName: "F2", consumerName: "A", sheet: "FX_B_HTTP" }),
      ],
    });
    expect(block(boucle)?.items).toEqual(["A: 1 component downstream.", "B: 1 component downstream."]);
  });
});
