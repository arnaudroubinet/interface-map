import { describe, it, expect } from "vitest";
import { runIntegrityChecks } from "./checks";
import { buildFlowInstances } from "../aggregation/core";
import { VERSION_MODELE, feuilleFxAttendue } from "../parsing/build-model";
import type { ParsedModel, Acteur, InterfaceCatalogue, Consommation } from "../parsing/model";

function acteur(overrides: Partial<Acteur>): Acteur {
  return {
    nom: "A", groupe: "G", typeActeur: "Application", responsable: "", description: "d", commentaires: "", palierIntroduction: "", palierRetrait: "", feuille: "Actors", ligne: 0,
    ...overrides,
  };
}

function iface(overrides: Partial<InterfaceCatalogue>): InterfaceCatalogue {
  return {
    nomDuFlux: "F", acteurExposant: "A", typeDeFlux: "HTTP", description: "d",
    lienContrat: "lien", referenceContrat: "", commentaires: "", aConfirmer: false,
    version: "", etat: "",
    feuilleAttendue: "FX_A_HTTP", relais: "", palierIntroduction: "", palierRetrait: "", feuille: "Interfaces", ligne: 0,
    ...overrides,
  };
}

function conso(overrides: Partial<Consommation>): Consommation {
  return {
    nomDuFlux: "F", acteurConsommateur: "B", usage: "u", criticite: "1 - Critical",
    version: "",
    statut: "Actif", decision: "Keep", republiePar: "", commentaires: "", feuille: "FX_A_HTTP", palierIntroduction: "", palierRetrait: "", ligne: 0,
    ...overrides,
  };
}

function model(overrides: Partial<ParsedModel>): ParsedModel {
  return {
    acteurs: [acteur({ nom: "A" }), acteur({ nom: "B" })],
    groupes: [{ nom: "G", perimetre: "Platform", feuille: "Groups", ligne: 0 }],
    groupesAbsents: false,
    typesActeur: [{ type: "Application", icone: "app-window", nature: "", feuille: "ActorTypes", ligne: 0 }],
    paliers: [],
  typesFlux: [{ type: "HTTP", sensRepresentation: "consommateur-exposant", sensRepresentationBrut: "consumer → provider", couleur: "", description: "", feuille: "FlowTypes", ligne: 0 }],
    interfaces: [iface({})],
    consommations: [conso({})],
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
    expect(report.familles.find((f) => f.id === "structure")!.anomalies).toHaveLength(0);
  });

  it("flags a missing optional column", () => {
    const report = runIntegrityChecks(model({ colonnesOptionnellesAbsentes: [{ feuille: "Actors", colonne: "Group" }] }));
    expect(report.familles.find((f) => f.id === "structure")!.anomalies).toHaveLength(1);
  });

  it("flags a duplicate actor name", () => {
    const report = runIntegrityChecks(model({ acteurs: [acteur({ nom: "A" }), acteur({ nom: "A" })] }));
    expect(report.familles.find((f) => f.id === "structure")!.anomalies.some((a) => a.message.includes('"A"'))).toBe(true);
  });

  it("flags a duplicate interface name", () => {
    const report = runIntegrityChecks(model({ interfaces: [iface({ nomDuFlux: "F" }), iface({ nomDuFlux: "F" })] }));
    expect(report.familles.find((f) => f.id === "structure")!.anomalies.length).toBeGreaterThan(0);
  });

  it("flags a missing FX_ tab expected by an interface", () => {
    const report = runIntegrityChecks(model({ fxSheetNames: [] }));
    expect(report.familles.find((f) => f.id === "structure")!.anomalies.some((a) => a.message.includes("missing from the workbook"))).toBe(true);
  });

  it("flags an FX_ tab with no matching interface", () => {
    const report = runIntegrityChecks(model({ fxSheetNames: ["FX_A_HTTP", "FX_Orphelin_HTTP"] }));
    expect(report.familles.find((f) => f.id === "structure")!.anomalies.some((a) => a.message.includes("FX_Orphelin_HTTP"))).toBe(true);
  });
});

describe("7.2 références", () => {
  it("reports nothing when all references resolve", () => {
    const report = runIntegrityChecks(model({}));
    expect(report.familles.find((f) => f.id === "references")!.anomalies).toHaveLength(0);
  });

  it("flags an unknown exposant", () => {
    const report = runIntegrityChecks(model({ interfaces: [iface({ acteurExposant: "Inconnu" })] }));
    expect(report.familles.find((f) => f.id === "references")!.anomalies.some((a) => a.message.includes("Inconnu"))).toBe(true);
  });

  it("flags an unknown type de flux", () => {
    const report = runIntegrityChecks(model({ interfaces: [iface({ typeDeFlux: "SFTP" })] }));
    expect(report.familles.find((f) => f.id === "references")!.anomalies.some((a) => a.message.includes("SFTP"))).toBe(true);
  });

  it("flags an unknown acteur consommateur", () => {
    const report = runIntegrityChecks(model({ consommations: [conso({ acteurConsommateur: "Inconnu" })] }));
    expect(report.familles.find((f) => f.id === "references")!.anomalies.some((a) => a.message.includes("Inconnu"))).toBe(true);
  });

  it("flags a consumption whose flow name is not in the catalog", () => {
    const report = runIntegrityChecks(model({ consommations: [conso({ nomDuFlux: "Fantome" })] }));
    expect(report.familles.find((f) => f.id === "references")!.anomalies.some((a) => a.message.includes("Fantome"))).toBe(true);
  });

  it("flags a consumption filed under the wrong tab", () => {
    const report = runIntegrityChecks(model({ consommations: [conso({ feuille: "FX_Mauvais_Onglet" })] }));
    expect(report.familles.find((f) => f.id === "references")!.anomalies.some((a) => a.message.includes("FX_A_HTTP"))).toBe(true);
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
        interfaces: [iface({ feuilleAttendue: "FX_A_HTTP" }), iface({ acteurExposant: "C", feuilleAttendue: "FX_C_HTTP" })],
        acteurs: [acteur({ nom: "A" }), acteur({ nom: "B" }), acteur({ nom: "C" })],
        consommations: [conso({ feuille: "FX_A_HTTP" })],
      })
    );
    expect(report.familles.find((f) => f.id === "references")!.anomalies.some((a) => a.message.includes("rangée"))).toBe(false);
  });
});

describe("7.3 cohérence", () => {
  it("reports nothing on a clean model", () => {
    const report = runIntegrityChecks(model({}));
    expect(report.familles.find((f) => f.id === "coherence")!.anomalies).toHaveLength(0);
  });

  it("flags a consumer identical to the exposant", () => {
    const report = runIntegrityChecks(model({ consommations: [conso({ acteurConsommateur: "A" })] }));
    expect(report.familles.find((f) => f.id === "coherence")!.anomalies.length).toBeGreaterThan(0);
  });

  it("flags an interface with no consumption", () => {
    const report = runIntegrityChecks(model({ consommations: [] }));
    expect(report.familles.find((f) => f.id === "coherence")!.anomalies.some((a) => a.message.includes("no declared consumption"))).toBe(true);
  });

  // Un composant sans flux n'invalide rien : il n'apparaît simplement nulle
  // part. C'est un avertissement, pas une erreur.
  it("warns about an actor with no flow at all", () => {
    const report = runIntegrityChecks(model({ acteurs: [acteur({ nom: "A" }), acteur({ nom: "B" }), acteur({ nom: "Isole" })] }));
    expect(report.familles.find((f) => f.id === "coherence")!.anomalies.some((a) => a.message.includes("Isole"))).toBe(false);
    const bloc = report.blocsInformatifs.find((b) => b.id === "acteurs-sans-flux")!;
    expect(bloc.niveau).toBe("avertissement");
    expect(bloc.items).toEqual(["Isole (Actors, row 0)"]);
  });
});

describe("7.4 complétude", () => {
  it("reports nothing on a clean model", () => {
    const report = runIntegrityChecks(model({}));
    expect(report.familles.find((f) => f.id === "completude")!.anomalies).toHaveLength(0);
  });

  it("flags an empty interface description", () => {
    const report = runIntegrityChecks(model({ interfaces: [iface({ description: "" })] }));
    expect(report.familles.find((f) => f.id === "completude")!.anomalies.some((a) => a.message.includes("description"))).toBe(true);
  });

  it("flags an interface with no contract at all", () => {
    const report = runIntegrityChecks(model({ interfaces: [iface({ lienContrat: "", referenceContrat: "" })] }));
    expect(report.familles.find((f) => f.id === "completude")!.anomalies.some((a) => a.message.includes("no contract"))).toBe(true);
  });

  it("flags a consumption with empty usage or décision", () => {
    const report = runIntegrityChecks(model({ consommations: [conso({ usage: "", decision: "" })] }));
    expect(report.familles.find((f) => f.id === "completude")!.anomalies.length).toBe(2);
  });

  // Un retrait déclaré dit déjà ce qu'on fait de cette consommation : elle
  // part, à ce palier-là. Réclamer en plus une décision de jugement demanderait
  // deux fois la même chose.
  it("does not ask for a decision on a consumption that has a retirement milestone", () => {
    const report = runIntegrityChecks(
      model({ paliers: [], consommations: [conso({ decision: "", palierRetrait: "v2" })] })
    );
    const messages = report.familles.find((f) => f.id === "completude")!.anomalies.map((a) => a.message);
    expect(messages.some((m) => m.includes("decision empty"))).toBe(false);
  });

  it("flags an actor with an empty groupe", () => {
    const report = runIntegrityChecks(model({ acteurs: [acteur({ nom: "A", groupe: "" }), acteur({ nom: "B" })] }));
    expect(report.familles.find((f) => f.id === "completude")!.anomalies.length).toBe(1);
  });

  // Le périmètre se saisit désormais sur le groupe, plus sur l'acteur.
  it("flags a groupe with an empty périmètre", () => {
    const report = runIntegrityChecks(model({ groupes: [{ nom: "G", perimetre: "", feuille: "Groups", ligne: 0 }] }));
    const messages = report.familles.find((f) => f.id === "completude")!.anomalies.map((a) => a.message);
    expect(messages).toContain('Group "G" (Groups, row 0): perimeter not filled in.');
  });
});

describe("7.6 onglet Groupes", () => {
  it("flags a missing Groupes sheet", () => {
    const report = runIntegrityChecks(model({ groupes: [], groupesAbsents: true }));
    const messages = report.familles.find((f) => f.id === "structure")!.anomalies.map((a) => a.message);
    expect(messages.some((m) => m.includes('Sheet "Groups" missing'))).toBe(true);
  });

  it("flags an actor whose groupe is not declared", () => {
    const report = runIntegrityChecks(model({ groupes: [{ nom: "Autre", perimetre: "External", feuille: "Groups", ligne: 0 }] }));
    const messages = report.familles.find((f) => f.id === "references")!.anomalies.map((a) => a.message);
    expect(messages.some((m) => m.includes('group "G" missing from the "Groups" sheet'))).toBe(true);
  });

  it("flags a declared groupe nobody belongs to", () => {
    const report = runIntegrityChecks(model({ groupes: [{ nom: "G", perimetre: "External", feuille: "Groups", ligne: 0 }, { nom: "Orphelin", perimetre: "External", feuille: "Groups", ligne: 0 }] }));
    const messages = report.familles.find((f) => f.id === "references")!.anomalies.map((a) => a.message);
    expect(messages).toContain('Group "Orphelin" (Groups, row 0) is declared but no actor belongs to it.');
  });
});

describe("7.5 candidats au décommissionnement", () => {
  it("is empty when nothing qualifies", () => {
    const report = runIntegrityChecks(model({}));
    expect(report.blocsInformatifs.find((b) => b.id === "decommissionnement")!.items).toHaveLength(0);
  });

  it("lists an interface whose only consumption is on its way out", () => {
    const report = runIntegrityChecks(model({ consommations: [conso({ palierRetrait: "v2" })] }));
    expect(report.blocsInformatifs.find((b) => b.id === "decommissionnement")!.items).toEqual(["F (Interfaces, row 0)"]);
  });



  // Le statut d'un composant n'existe plus : il ne peut plus décider seul
  // qu'une interface est candidate au décommissionnement.
  it("does not list an interface whose consumptions are all active", () => {
    const report = runIntegrityChecks(model({}));
    expect(report.blocsInformatifs.find((b) => b.id === "decommissionnement")!.items).toEqual([]);
  });
});

describe("7.6 interfaces à confirmer", () => {
  it("lists interfaces flagged Oui", () => {
    const report = runIntegrityChecks(model({ interfaces: [iface({ nomDuFlux: "F", aConfirmer: true })] }));
    expect(report.blocsInformatifs.find((b) => b.id === "a-confirmer")!.items).toEqual(["F (Interfaces, row 0)"]);
  });
});

describe("7.7 groupes utilisés", () => {
  it("counts actors per non-empty groupe", () => {
    const report = runIntegrityChecks(
      model({ acteurs: [acteur({ nom: "A", groupe: "Socle" }), acteur({ nom: "B", groupe: "Socle" })] })
    );
    expect(report.blocsInformatifs.find((b) => b.id === "groupes")!.items).toEqual(["Socle (2)"]);
  });
});

describe("totalAnomalies", () => {
  it("counts only the anomaly families, not the informational blocks", () => {
    const report = runIntegrityChecks(model({ interfaces: [iface({ description: "" })] }));
    expect(report.totalAnomalies).toBeGreaterThan(0);
    expect(report.totalAnomalies).toBe(
      report.familles.reduce((sum, f) => sum + f.anomalies.length, 0)
    );
  });
});

// C'est le seul contrôle où une faute de frappe produit un schéma FAUX en
// silence : une valeur non reconnue cesse d'atténuer le flux, ou inverse la
// flèche pour un sens de représentation.
describe("7.6 vocabulaires", () => {
  it("reports nothing when every value is in its list", () => {
    const report = runIntegrityChecks(model({}));
    expect(report.familles.find((f) => f.id === "vocabulaires")!.anomalies).toHaveLength(0);
  });

  it("flags a mistyped decision or criticité", () => {
    const report = runIntegrityChecks(
      model({ consommations: [conso({ decision: "A garder", criticite: "Haute" })] })
    );
    const messages = report.familles.find((f) => f.id === "vocabulaires")!.anomalies.map((a) => a.message);
    expect(messages.some((m) => m.includes("Haute"))).toBe(true);
    expect(messages.some((m) => m.includes("A garder"))).toBe(true);
    expect(messages.some((m) => m.includes("Haute"))).toBe(true);
  });

  // build-model retombe silencieusement sur « consommateur → exposant » pour
  // toute valeur qu'il ne reconnaît pas : la flèche s'inverserait sans un mot.
  it("flags an unknown sens de représentation, which would silently flip the arrow", () => {
    const report = runIntegrityChecks(
      model({
        typesFlux: [
          { type: "HTTP", sensRepresentation: "consommateur-exposant", sensRepresentationBrut: "du client au serveur", couleur: "", description: "", feuille: "FlowTypes", ligne: 0 },
        ],
      })
    );
    expect(
      report.familles.find((f) => f.id === "vocabulaires")!.anomalies.some((a) => a.message.includes("du client au serveur"))
    ).toBe(true);
  });

  it("flags an unknown nature", () => {
    const report = runIntegrityChecks(
      model({ typesActeur: [{ type: "Application", icone: "app-window", nature: "Fonctionnelle", feuille: "ActorTypes", ligne: 0 }] })
    );
    expect(
      report.familles.find((f) => f.id === "vocabulaires")!.anomalies.some((a) => a.message.includes("Fonctionnelle"))
    ).toBe(true);
  });

  it("stays silent on an empty value, which the complétude family already covers", () => {
    const report = runIntegrityChecks(model({ consommations: [conso({ statut: "", decision: "", criticite: "" })] }));
    expect(report.familles.find((f) => f.id === "vocabulaires")!.anomalies).toHaveLength(0);
  });
});

describe("7.7 signaux non bloquants", () => {
  it("warns about a missing criticité rather than failing the file", () => {
    const report = runIntegrityChecks(model({ consommations: [conso({ criticite: "" })] }));
    const bloc = report.blocsInformatifs.find((b) => b.id === "criticite-manquante")!;
    expect(bloc.niveau).toBe("avertissement");
    expect(bloc.items).toHaveLength(1);
  });

  // Deux composants peuvent échanger plusieurs fois par la même technologie :
  // c'est légitime, on le montre sans le reprocher.
  it("reports a repeated exchange between the same pair as information", () => {
    const report = runIntegrityChecks(
      model({ consommations: [conso({}), conso({ nomDuFlux: "F", acteurConsommateur: "B" })] })
    );
    const bloc = report.blocsInformatifs.find((b) => b.id === "echanges-repetes")!;
    expect(bloc.niveau).toBe("info");
    expect(bloc.items.some((i) => i.includes("A → B over HTTP"))).toBe(true);
  });

  it("reports an unused flow type as information", () => {
    const report = runIntegrityChecks(
      model({
        typesFlux: [
          { type: "HTTP", sensRepresentation: "consommateur-exposant", sensRepresentationBrut: "consumer → provider", couleur: "", description: "", feuille: "FlowTypes", ligne: 0 },
          { type: "Kafka", sensRepresentation: "exposant-consommateur", sensRepresentationBrut: "provider → consumer", couleur: "", description: "", feuille: "FlowTypes", ligne: 0 },
        ],
      })
    );
    const bloc = report.blocsInformatifs.find((b) => b.id === "typesflux-inutilises")!;
    expect(bloc.niveau).toBe("info");
    expect(bloc.items).toEqual(["Kafka (FlowTypes, row 0)"]);
  });
});

// Un raccourci pour les modèles à deux versions d'un même contrat : c'est la
// situation que toute cette famille de contrôles décrit.
function modelDeuxVersions(overrides: Partial<ParsedModel> = {}): ParsedModel {
  return model({
    paliers,
    interfaces: [
      iface({ version: "1.0", palierIntroduction: "v1", palierRetrait: "v3" }),
      iface({ version: "2.0", palierIntroduction: "v1" }),
    ],
    consommations: [conso({ version: "1.0", palierIntroduction: "v1" })],
    ...overrides,
  });
}

describe("versions d'interface — références", () => {
  it("reports a consumption whose version is absent from the catalogue", () => {
    const report = runIntegrityChecks(modelDeuxVersions({ consommations: [conso({ version: "9.9" })] }));
    const messages = report.familles.find((f) => f.id === "references")!.anomalies.map((a) => a.message);
    expect(messages.join(" ")).toContain('version "9.9"');
  });

  it("does not confuse two versions of the same flux", () => {
    const report = runIntegrityChecks(modelDeuxVersions());
    const messages = report.familles.find((f) => f.id === "references")!.anomalies.map((a) => a.message);
    expect(messages).toEqual([]);
  });
});


describe("versions d'interface — cohérence", () => {
  it("reports a consumer sitting on two versions of the same contract", () => {
    const report = runIntegrityChecks(
      modelDeuxVersions({ consommations: [conso({ version: "1.0" }), conso({ version: "2.0" })] })
    );
    const messages = report.familles.find((f) => f.id === "coherence")!.anomalies.map((a) => a.message);
    expect(messages.join(" ")).toContain("B");
    expect(messages.join(" ")).toContain("two versions");
  });

  it("says nothing when two different consumers each sit on one version", () => {
    const report = runIntegrityChecks(
      modelDeuxVersions({
        acteurs: [acteur({ nom: "A" }), acteur({ nom: "B" }), acteur({ nom: "C" })],
        consommations: [conso({ version: "1.0" }), conso({ version: "2.0", acteurConsommateur: "C" })],
      })
    );
    const messages = report.familles.find((f) => f.id === "coherence")!.anomalies.map((a) => a.message);
    expect(messages.join(" ")).not.toContain("two versions");
  });


});

describe("versions d'interface — bloc action des migrations", () => {
  it("names the interface, both versions and the consumers left behind", () => {
    const report = runIntegrityChecks(modelDeuxVersions());
    const bloc = report.blocsInformatifs.find((b) => b.id === "migrations")!;
    expect(bloc.niveau).toBe("action");
    expect(bloc.items).toEqual(["F 1.0 (Interfaces, row 0) → 2.0: B"]);
  });

  it("counts towards the action total, not the anomaly one", () => {
    const report = runIntegrityChecks(modelDeuxVersions());
    expect(report.totalActions).toBeGreaterThan(0);
  });

  // Sans ce libellé, le rapport laisserait croire qu'il suffit de déplacer une
  // cellule, alors que la version d'arrivée reste à créer.
  it("says so when no active version exists to migrate towards", () => {
    const report = runIntegrityChecks(
      model({ paliers, interfaces: [iface({ version: "1.0", palierRetrait: "v3", palierIntroduction: "v1" })], consommations: [conso({ version: "1.0", palierIntroduction: "v1" })] })
    );
    const bloc = report.blocsInformatifs.find((b) => b.id === "migrations")!;
    expect(bloc.items).toEqual(["F 1.0 (Interfaces, row 0) → no active version: B"]);
  });

  it("names every active version rather than choosing one", () => {
    const report = runIntegrityChecks(
      model({
        paliers,
        interfaces: [
          iface({ version: "1.0", palierIntroduction: "v1", palierRetrait: "v3" }),
          iface({ version: "2.0", palierIntroduction: "v1" }),
          iface({ version: "3.0", palierIntroduction: "v1" }),
        ],
        consommations: [conso({ version: "1.0", palierIntroduction: "v1" })],
      })
    );
    const bloc = report.blocsInformatifs.find((b) => b.id === "migrations")!;
    expect(bloc.items).toEqual(["F 1.0 (Interfaces, row 0) → 2.0, 3.0: B"]);
  });

  it("drops an interface nobody consumes any more from the block", () => {
    const report = runIntegrityChecks(modelDeuxVersions({ consommations: [conso({ version: "2.0" })] }));
    expect(report.blocsInformatifs.find((b) => b.id === "migrations")!.items).toEqual([]);
  });
});

const paliers = [
  { nom: "v1", rang: 1, libelle: "", statut: "Delivered", date: "", description: "", feuille: "Milestones", ligne: 0 },
  { nom: "v2", rang: 2, libelle: "", statut: "Delivered", date: "", description: "", feuille: "Milestones", ligne: 0 },
  { nom: "v3", rang: 3, libelle: "", statut: "Planned", date: "", description: "", feuille: "Milestones", ligne: 0 },
];

function messagesCoherence(m: ParsedModel): string {
  return runIntegrityChecks(m).familles.find((f) => f.id === "coherence")!.anomalies.map((a) => a.message).join(" | ");
}

describe("paliers — contrôles temporels", () => {
  it("says nothing on a workbook whose intervals nest properly", () => {
    const m = model({
      paliers,
      acteurs: [acteur({ nom: "A", palierIntroduction: "v1" }), acteur({ nom: "B", palierIntroduction: "v1" })],
      interfaces: [iface({ palierIntroduction: "v2" })],
      consommations: [conso({ palierIntroduction: "v2" })],
    });
    expect(messagesCoherence(m)).not.toContain("milestone");
  });

  // Le même contrôle vu des deux bouts : une interface qui déborde de la vie
  // de son exposant, c'est aussi un acteur retiré qui porte encore des flux.
  it("reports an interface living outside its exposant's own interval", () => {
    const m = model({
      paliers,
      acteurs: [acteur({ nom: "A", palierRetrait: "v2" }), acteur({ nom: "B" })],
      interfaces: [iface({ palierRetrait: "v3" })],
    });
    expect(messagesCoherence(m)).toContain("A");
  });

  it("reports a consumption living outside its interface's interval", () => {
    const m = model({
      paliers,
      interfaces: [iface({ palierRetrait: "v2" })],
      consommations: [conso({ palierRetrait: "v3" })],
    });
    expect(messagesCoherence(m)).toContain("F");
  });

  it("reports a consumption living outside its consumer's interval", () => {
    const m = model({
      paliers,
      acteurs: [acteur({ nom: "A" }), acteur({ nom: "B", palierIntroduction: "v3" })],
      consommations: [conso({ palierIntroduction: "v1" })],
    });
    expect(messagesCoherence(m)).toContain("B");
  });

  it("reports a retirement that precedes the introduction", () => {
    const m = model({ paliers, interfaces: [iface({ palierIntroduction: "v3", palierRetrait: "v1" })] });
    expect(messagesCoherence(m)).toContain("at or before");
  });

  it("reports a palier cited by a row but absent from the Paliers sheet", () => {
    const m = model({ paliers, interfaces: [iface({ palierIntroduction: "v9" })] });
    const refs = runIntegrityChecks(m).familles.find((f) => f.id === "references")!.anomalies.map((a) => a.message);
    expect(refs.join(" ")).toContain("v9");
  });

  it("reports duplicate ranks in the Paliers sheet", () => {
    const m = model({ paliers: [...paliers, { nom: "v4", rang: 2, libelle: "", statut: "Planned", date: "", description: "", feuille: "Milestones", ligne: 0 }] });
    const struct = runIntegrityChecks(m).familles.find((f) => f.id === "structure")!.anomalies.map((a) => a.message);
    expect(struct.join(" ")).toContain("rank");
  });

  // Sans palier livré, le palier courant est indéterminé : les vues se
  // rabattent sur le premier déclaré, autant le dire.
  it("reports a Paliers sheet without a single delivered palier", () => {
    const m = model({ paliers: paliers.map((p) => ({ ...p, statut: "Planned" })) });
    const struct = runIntegrityChecks(m).familles.find((f) => f.id === "structure")!.anomalies.map((a) => a.message);
    expect(struct.join(" ")).toContain("Delivered");
  });

  // Un classeur sans aucun palier déclaré ne doit pas se mettre à en parler.
  it("stays silent on a workbook that declares no palier at all", () => {
    const rapport = runIntegrityChecks(model({}));
    const tout = rapport.familles.flatMap((f) => f.anomalies.map((a) => a.message)).join(" ");
    expect(tout).not.toContain("milestone");
    expect(tout).not.toContain("Milestone");
  });
});

describe("paliers — complétude", () => {
  function messagesCompletude(m: ParsedModel): string {
    return runIntegrityChecks(m).familles.find((f) => f.id === "completude")!.anomalies.map((a) => a.message).join(" | ");
  }

  // On ne devine pas à la place de celui qui tient le fichier : au pire il
  // mettra un palier arbitraire, mais le choix lui revient.
  it("reports an interface with no arrival palier", () => {
    const m = model({ paliers, interfaces: [iface({})], consommations: [] });
    expect(messagesCompletude(m)).toContain("introduction milestone");
  });

  it("reports a consumption with no arrival palier — that is when its consumer arrived", () => {
    const m = model({
      paliers,
      interfaces: [iface({ palierIntroduction: "v1" })],
      consommations: [conso({})],
    });
    expect(messagesCompletude(m)).toContain("Consumption");
  });

  it("reports an acteur with no arrival palier", () => {
    const m = model({ paliers, acteurs: [acteur({ nom: "A" }), acteur({ nom: "B", palierIntroduction: "v1" })] });
    expect(messagesCompletude(m)).toContain("Actor");
  });

  // Un retrait vide n'est pas un manque : c'est un fait, la ligne est encore là.
  it("says nothing about an empty retirement palier", () => {
    const m = model({
      paliers,
      acteurs: [acteur({ nom: "A", palierIntroduction: "v1" }), acteur({ nom: "B", palierIntroduction: "v1" })],
      interfaces: [iface({ palierIntroduction: "v1" })],
      consommations: [conso({ palierIntroduction: "v1" })],
    });
    expect(messagesCompletude(m)).not.toContain("milestone");
  });

  // Tant que l'équipe n'a pas adopté l'axe, l'outil n'en parle pas.
  it("stays silent when no palier is declared at all", () => {
    const m = model({ interfaces: [iface({})], consommations: [conso({})] });
    expect(messagesCompletude(m)).not.toContain("milestone");
  });
});

describe("paliers — le rapport suit le palier affiché", () => {
  const troisPaliers = [
    { nom: "v1", rang: 1, libelle: "", statut: "Delivered", date: "", description: "", feuille: "Milestones", ligne: 0 },
    { nom: "v2", rang: 2, libelle: "", statut: "Delivered", date: "", description: "", feuille: "Milestones", ligne: 0 },
  ];

  // Un acteur retiré en v2 n'a évidemment plus de flux en v2 : le signaler
  // remplirait le rapport de fausses anomalies dès la première ligne retirée.
  it("does not blame a retired acteur for having no flow any more", () => {
    const m = model({
      paliers: troisPaliers,
      acteurs: [
        acteur({ nom: "A", palierIntroduction: "v1" }),
        acteur({ nom: "B", palierIntroduction: "v1" }),
        acteur({ nom: "C", palierIntroduction: "v1", palierRetrait: "v2" }),
      ],
      interfaces: [iface({ palierIntroduction: "v1" })],
      consommations: [conso({ palierIntroduction: "v1" })],
    });
    const bloc = (rang: number) =>
      runIntegrityChecks(m, rang).blocsInformatifs.find((b) => b.id === "acteurs-sans-flux")!.items;
    expect(bloc(1)).toContain("C (Actors, row 0)");
    expect(bloc(2)).not.toContain("C (Actors, row 0)");
  });

  // La structure, elle, juge le classeur et pas un instant de son histoire.
  it("keeps structural checks independent of the displayed palier", () => {
    const m = model({
      paliers: troisPaliers,
      colonnesOptionnellesAbsentes: [{ feuille: "Actors", colonne: "Group" }],
      acteurs: [acteur({ nom: "A", palierIntroduction: "v1" }), acteur({ nom: "B", palierIntroduction: "v1" })],
      interfaces: [iface({ palierIntroduction: "v1" })],
      consommations: [conso({ palierIntroduction: "v1" })],
    });
    const structure = (rang: number) =>
      runIntegrityChecks(m, rang).familles.find((f) => f.id === "structure")!.anomalies.length;
    expect(structure(1)).toBe(structure(2));
    expect(structure(1)).toBeGreaterThan(0);
  });
});

// Un rapport sert à corriger. Sans l'adresse, chaque ligne oblige à retrouver
// soi-même la case dans le classeur, et l'ordre de lecture ne suit rien.
describe("emplacement des anomalies", () => {
  const messages = (m: ParsedModel, id: string) =>
    runIntegrityChecks(m).familles.find((f) => f.id === id)!.anomalies.map((a) => a.message);

  it("cites the sheet and the row of the line at fault", () => {
    const m = model({
      interfaces: [iface({ description: "", ligne: 42 })],
      consommations: [conso({ usage: "", feuille: "FX_A_HTTP", ligne: 7 })],
    });
    const complétude = messages(m, "completude");

    expect(complétude).toContain('Interface "F" (Interfaces, row 42): description empty.');
    expect(complétude).toContain('Consumption "F" (FX_A_HTTP, row 7): usage not described.');
  });

  it("carries the address as data too, so the report can order and link on it", () => {
    const m = model({ interfaces: [iface({ description: "", ligne: 42 })] });
    const anomalie = runIntegrityChecks(m)
      .familles.find((f) => f.id === "completude")!
      .anomalies.find((a) => a.message.includes("description empty"))!;

    expect(anomalie.emplacement).toEqual({ feuille: "Interfaces", ligne: 42 });
  });

  it("orders a family by sheet then by ascending row", () => {
    const m = model({
      acteurs: [acteur({ nom: "A", groupe: "" , ligne: 9 }), acteur({ nom: "B", groupe: "", ligne: 3 })],
      interfaces: [iface({ description: "", lienContrat: "l", ligne: 5 })],
      consommations: [],
    });
    const adresses = runIntegrityChecks(m)
      .familles.find((f) => f.id === "completude")!
      .anomalies.map((a) => `${a.emplacement!.feuille}:${a.emplacement!.ligne}`);

    expect(adresses).toEqual(["Actors:3", "Actors:9", "Interfaces:5"]);
  });

  it("puts what has no address first, since it points at the file rather than a line", () => {
    const m = model({
      groupesAbsents: true,
      groupes: [],
      interfaces: [iface({ feuilleAttendue: "FX_A_MQTT", ligne: 4 })],
      consommations: [],
      fxSheetNames: [],
    });
    const structure = runIntegrityChecks(m).familles.find((f) => f.id === "structure")!.anomalies;

    expect(structure[0].emplacement).toBeUndefined();
    expect(structure.some((a) => a.emplacement)).toBe(true);
  });
});

describe("emplacement des blocs informatifs", () => {
  const bloc = (m: ParsedModel, id: string) =>
    runIntegrityChecks(m).blocsInformatifs.find((b) => b.id === id)!.items;

  it("cites the address on every item that designates a line", () => {
    const m = model({
      acteurs: [acteur({ nom: "A", ligne: 2 }), acteur({ nom: "B", ligne: 3 }), acteur({ nom: "Seul", ligne: 8 })],
      interfaces: [iface({ aConfirmer: true, ligne: 5 })],
      consommations: [conso({ criticite: "", ligne: 6 })],
      typesFlux: [
        { type: "HTTP", sensRepresentation: "consommateur-exposant", sensRepresentationBrut: "consumer → provider", couleur: "", description: "", feuille: "FlowTypes", ligne: 2 },
        { type: "SFTP", sensRepresentation: "consommateur-exposant", sensRepresentationBrut: "consumer → provider", couleur: "", description: "", feuille: "FlowTypes", ligne: 3 },
      ],
    });

    expect(bloc(m, "acteurs-sans-flux")).toEqual(["Seul (Actors, row 8)"]);
    expect(bloc(m, "a-confirmer")).toEqual(["F (Interfaces, row 5)"]);
    expect(bloc(m, "criticite-manquante")).toEqual(["F (FX_A_HTTP, row 6) — B"]);
    expect(bloc(m, "typesflux-inutilises")).toEqual(["SFTP (FlowTypes, row 3)"]);
  });

  it("orders a block by ascending row, like the rest of the report", () => {
    const m = model({
      acteurs: [acteur({ nom: "A", ligne: 2 }), acteur({ nom: "Z", ligne: 4 }), acteur({ nom: "M", ligne: 9 })],
      interfaces: [],
      consommations: [],
    });

    expect(bloc(m, "acteurs-sans-flux")).toEqual(["A (Actors, row 2)", "Z (Actors, row 4)", "M (Actors, row 9)"]);
  });
});

describe("cycles de dépendance", () => {
  const cycles = (m: ParsedModel, rang: number | null = null) =>
    runIntegrityChecks(m, rang).blocsInformatifs.find((b) => b.id === "cycles")!.items;

  // Un consommateur dépend de l'exposant de l'interface qu'il consomme.
  // A expose F1 que B consomme ; B expose F2 que A consomme : chacun a besoin
  // de l'autre pour fonctionner.
  function boucle(noms: string[]) {
    const interfaces = noms.map((nom, i) =>
      iface({ nomDuFlux: `F${i}`, acteurExposant: nom, feuilleAttendue: `FX_${nom}_HTTP` })
    );
    const consommations = noms.map((nom, i) =>
      conso({
        nomDuFlux: `F${i}`,
        // Chacun est consommé par le suivant, le dernier par le premier.
        acteurConsommateur: noms[(i + 1) % noms.length],
        feuille: `FX_${nom}_HTTP`,
      })
    );
    return {
      acteurs: noms.map((nom) => acteur({ nom })),
      interfaces,
      consommations,
      fxSheetNames: noms.map((nom) => `FX_${nom}_HTTP`),
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
      acteurs: [acteur({ nom: "A" })],
      interfaces: [iface({ acteurExposant: "A" })],
      consommations: [conso({ acteurConsommateur: "A" })],
    });
    expect(cycles(m)).toEqual([]);
  });

  it("reports two independent loops separately", () => {
    const un = boucle(["A", "B"]);
    const deux = boucle(["Y", "Z"]);
    const m = model({
      acteurs: [...un.acteurs, ...deux.acteurs],
      interfaces: [...un.interfaces, ...deux.interfaces],
      consommations: [...un.consommations, ...deux.consommations],
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
      paliers,
      acteurs: boucleV1.acteurs.map((a) => ({ ...a, palierIntroduction: "v1" })),
      interfaces: boucleV1.interfaces.map((i) => ({ ...i, palierIntroduction: "v1" })),
      consommations: boucleV1.consommations.map((c, i) => ({
        ...c,
        palierIntroduction: "v1",
        // Un seul des deux liens part au palier 2 : la boucle s'ouvre.
        palierRetrait: i === 0 ? "v2" : "",
      })),
    });
    expect(cycles(m, 1)).toEqual(["A, B (2 components)"]);
    expect(cycles(m, 2)).toEqual([]);
  });
});

describe("nature et relais", () => {
  const TYPES = [
    { type: "Application", icone: "app-window", nature: "Business", feuille: "ActorTypes", ligne: 2 },
    { type: "Middleware", icone: "server", nature: "Technical", feuille: "ActorTypes", ligne: 3 },
  ];
  const messages = (m: ParsedModel, famille: string) =>
    runIntegrityChecks(m).familles.find((f) => f.id === famille)!.anomalies.map((a) => a.message).join(" | ");

  // La republication est portée par la ligne de consommation du bus : c'est
  // elle qui dit sous laquelle de SES interfaces l'entrée ressort.
  function parcRelais(republiePar = "trx.norm"): ParsedModel {
    return model({
      typesActeur: TYPES,
      acteurs: [acteur({ nom: "Tatooine" }), acteur({ nom: "Bus", typeActeur: "Middleware" }), acteur({ nom: "B" })],
      interfaces: [
        iface({ nomDuFlux: "Transactions", acteurExposant: "Tatooine" }),
        iface({ nomDuFlux: "trx.norm", acteurExposant: "Bus", feuilleAttendue: "FX_Bus_HTTP" }),
      ],
      consommations: [
        conso({ nomDuFlux: "Transactions", acteurConsommateur: "Bus", republiePar }),
        conso({ nomDuFlux: "trx.norm", acteurConsommateur: "B", feuille: "FX_Bus_HTTP" }),
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
    m.consommations[1].republiePar = "Autre chose";
    expect(messages(m, "coherence")).toContain("only plumbing relays");
  });

  it("signale une interface republiée que rien n'alimente", () => {
    expect(messages(parcRelais(""), "coherence")).toContain("nothing feeds it");
  });

  // Le bus fourre-tout : le flux entre dans la plomberie et n'en ressort pour
  // personne, sans quoi le lien fonctionnel manquerait en silence.
  it("signale un flux qui entre chez un technique et n'en ressort pour personne", () => {
    const m = parcRelais();
    m.interfaces.push(iface({ nomDuFlux: "Référentiel", acteurExposant: "Tatooine", feuilleAttendue: "FX_Tatooine_REF" }));
    m.consommations.push(conso({ nomDuFlux: "Référentiel", acteurConsommateur: "Bus", feuille: "FX_Tatooine_REF" }));
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
  const auPalier = (rang: number) =>
    runIntegrityChecks(
      model({
        paliers: [
          { nom: "v1", rang: 1, libelle: "", statut: "", date: "", description: "", feuille: "Milestones", ligne: 0 },
          { nom: "v2", rang: 2, libelle: "", statut: "", date: "", description: "", feuille: "Milestones", ligne: 0 },
        ],
        acteurs: [acteur({ nom: "A", palierRetrait: "v1" }), acteur({ nom: "B" })],
        interfaces: [iface({ acteurExposant: "A" })],
        consommations: [conso({ acteurConsommateur: "B" })],
      }),
      rang
    );

  it("ne cite plus un acteur retiré dans les blocs informatifs", () => {
    expect(JSON.stringify(auPalier(1).blocsInformatifs)).not.toContain('"A"');
  });

  it("laisse tomber la consommation dont l'exposant a disparu", () => {
    const sansFlux = auPalier(1).blocsInformatifs.find((b) => b.titre.includes("no flow"));
    expect(sansFlux?.items.join(" ")).toContain("B");
  });

  it("garde tout tant que l'acteur vit", () => {
    const sansFlux = auPalier(0).blocsInformatifs.find((b) => b.titre.includes("no flow"));
    expect(sansFlux?.items.join(" ")).not.toContain("B");
  });
});

// --- QA : la frise elle-même n'était pas contrôlée. Un rang illisible vaut 0
// à la lecture -- « un contrôle réclame le rang », promettait le commentaire de
// build-model.ts, mais ce contrôle n'existait pas. Et deux paliers dont les
// noms ne diffèrent que par la casse se confondent, puisque c'est sur le nom
// normalisé que toute ligne datée résout son rang.
describe("frise des paliers", () => {
  const palier = (nom: string, rang: number) => ({
    nom, rang, libelle: "", statut: "Delivered", date: "", description: "",
    feuille: "Milestones", ligne: 0,
  });
  // Toute ligne datée doit porter sa borne d'introduction dès qu'une frise
  // existe : sans elle, ce sont ces anomalies-là qu'on lirait, pas celles de
  // la frise.
  const anomalies = (paliers: ReturnType<typeof palier>[]) => {
    const dès = { palierIntroduction: paliers[0].nom };
    return runIntegrityChecks(
      model({
        paliers,
        acteurs: [acteur({ nom: "A", ...dès }), acteur({ nom: "B", ...dès })],
        interfaces: [iface({ ...dès })],
        consommations: [conso({ ...dès })],
      })
    )
      .familles.flatMap((f) => f.anomalies)
      .map((a) => a.message)
      .join(" ");
  };

  it("réclame un rang exploitable", () => {
    expect(anomalies([palier("v1", 1), palier("v2", 0)])).toContain("v2");
  });

  it("signale deux paliers que la casse seule distingue", () => {
    expect(anomalies([palier("v1", 1), palier("V1", 2)])).toContain("V1");
  });

  it("laisse une frise saine tranquille", () => {
    expect(anomalies([palier("v1", 1), palier("v2", 2)])).toBe("");
  });
});

// --- QA : deux blocs nommaient l'interface sans sa version. Deux versions d'un
// même contrat donnaient alors deux items rigoureusement identiques à l'œil,
// alors que « Migrations under way » sait écrire « F 1.0 » depuis le début.
describe("blocs informatifs — une interface se nomme avec sa version", () => {
  const deuxVersions = () =>
    model({
      interfaces: [
        iface({ nomDuFlux: "F", version: "1.0", aConfirmer: true }),
        iface({ nomDuFlux: "F", version: "2.0", aConfirmer: true, ligne: 1 }),
      ],
      consommations: [],
    });

  it("distingue les deux versions dans « Interfaces to confirm »", () => {
    const bloc = runIntegrityChecks(deuxVersions()).blocsInformatifs.find((b) => b.titre === "Interfaces to confirm")!;
    expect(bloc.items).toHaveLength(2);
    expect(new Set(bloc.items.map((i) => i.replace(/\(.*\)/, "")))).toHaveProperty("size", 2);
  });
});

// --- QA : deux acteurs peuvent publier un contrat de même nom sans s'être
// concertés -- c'est banal, et ce sont deux interfaces distinctes. Le contrôle
// les prenait pour un doublon parce qu'il ne regardait que (nom, version) : sur
// un classeur réel, 4 faux doublons sur 9. L'exposant fait partie de l'identité.
describe("doublon d'interface — l'exposant fait partie de l'identité", () => {
  const avec = (interfaces: ReturnType<typeof iface>[]) =>
    runIntegrityChecks(model({ interfaces, consommations: [] }))
      .familles.flatMap((f) => f.anomalies)
      .map((a) => a.message)
      .filter((m) => m.includes("more than once"));

  it("ne signale pas deux exposants différents pour un même nom", () => {
    expect(
      avec([
        iface({ nomDuFlux: "Kashyyyk", acteurExposant: "A", feuilleAttendue: "FX_A_HTTP" }),
        iface({ nomDuFlux: "Kashyyyk", acteurExposant: "B", feuilleAttendue: "FX_B_HTTP" }),
      ])
    ).toHaveLength(0);
  });

  it("signale toujours le même nom chez le même exposant", () => {
    expect(
      avec([
        iface({ nomDuFlux: "Kashyyyk", acteurExposant: "A" }),
        iface({ nomDuFlux: "Kashyyyk", acteurExposant: "A", ligne: 1 }),
      ])
    ).toHaveLength(1);
  });

  it("laisse deux versions d'un même contrat tranquilles", () => {
    expect(
      avec([
        iface({ nomDuFlux: "Kashyyyk", version: "1.0", acteurExposant: "A" }),
        iface({ nomDuFlux: "Kashyyyk", version: "2.0", acteurExposant: "A", ligne: 1 }),
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
    runIntegrityChecks(model({ interfaces, consommations: [] }))
      .familles.flatMap((f) => f.anomalies)
      .map((a) => a.message)
      .filter((m) => m.includes("same sheet"));

  const long = (suffixe: string) => `Plateforme de règlement-livraison ${suffixe}`;

  it("signale deux exposants dont les noms coupés se confondent", () => {
    const dits = messages([
      iface({ nomDuFlux: "F", acteurExposant: long("Nord"), feuilleAttendue: feuilleFxAttendue(long("Nord"), "HTTP") }),
      iface({ nomDuFlux: "G", acteurExposant: long("Sud"), feuilleAttendue: feuilleFxAttendue(long("Sud"), "HTTP"), ligne: 1 }),
    ]);
    expect(dits).toHaveLength(1);
    expect(dits[0]).toContain("Plateforme de règlement-livraison");
  });

  it("ne dit rien quand les onglets diffèrent", () => {
    expect(
      messages([
        iface({ nomDuFlux: "F", acteurExposant: "Tatooine", feuilleAttendue: feuilleFxAttendue("Tatooine", "HTTP") }),
        iface({ nomDuFlux: "G", acteurExposant: "Chandrila", feuilleAttendue: feuilleFxAttendue("Chandrila", "HTTP"), ligne: 1 }),
      ])
    ).toHaveLength(0);
  });

  it("ne dit rien pour deux interfaces du même couple, qui partagent l'onglet à juste titre", () => {
    expect(
      messages([
        iface({ nomDuFlux: "F", acteurExposant: "Tatooine" }),
        iface({ nomDuFlux: "G", acteurExposant: "Tatooine", ligne: 1 }),
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
    { type: "Application", icone: "app-window", nature: "Business", feuille: "ActorTypes", ligne: 0 },
    { type: "Middleware", icone: "server", nature: "Technical", feuille: "ActorTypes", ligne: 0 },
  ];

  it("signale l'interface fautive, pas celle par laquelle on est entré", () => {
    const m = model({
      typesActeur: TYPES,
      acteurs: [
        acteur({ nom: "A" }),
        acteur({ nom: "X", typeActeur: "Middleware" }),
        acteur({ nom: "Y", typeActeur: "Middleware" }),
        acteur({ nom: "C" }),
      ],
      interfaces: [
        iface({ nomDuFlux: "f0", acteurExposant: "A", feuilleAttendue: "FX_A_HTTP" }),
        iface({ nomDuFlux: "f1", acteurExposant: "X", feuilleAttendue: "FX_X_HTTP", ligne: 1 }),
        iface({ nomDuFlux: "f2", acteurExposant: "Y", feuilleAttendue: "FX_Y_HTTP", ligne: 2 }),
      ],
      consommations: [
        // f0 arrive bien chez X, mais X ne dit pas sous quoi il le republie :
        // c'est f1 qui n'est alimentée par rien.
        conso({ nomDuFlux: "f0", acteurConsommateur: "X", feuille: "FX_A_HTTP" }),
        conso({ nomDuFlux: "f1", acteurConsommateur: "Y", feuille: "FX_X_HTTP", republiePar: "f2", ligne: 1 }),
        conso({ nomDuFlux: "f2", acteurConsommateur: "C", feuille: "FX_Y_HTTP", ligne: 2 }),
      ],
      fxSheetNames: ["FX_A_HTTP", "FX_X_HTTP", "FX_Y_HTTP"],
    });
    const dits = runIntegrityChecks(m)
      .familles.flatMap((f) => f.anomalies)
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
  const parc = (couleurs: [string, string][]) =>
    model({
      typesFlux: couleurs.map(([type, couleur], i) => ({
        type, couleur, sensRepresentation: "consommateur-exposant" as const,
        sensRepresentationBrut: "consumer → provider", description: "", feuille: "FlowTypes", ligne: i,
      })),
      interfaces: couleurs.map(([type], i) =>
        iface({ nomDuFlux: `F${i}`, typeDeFlux: type, feuilleAttendue: `FX_A_${type}`, ligne: i })
      ),
      consommations: [],
      fxSheetNames: couleurs.map(([type]) => `FX_A_${type}`),
    });

  const messages = (m: ParsedModel) =>
    runIntegrityChecks(m).familles.flatMap((f) => f.anomalies).map((a) => a.message).filter((x) => x.includes("colour"));

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
      interfaces: [iface({ typeDeFlux: "Inconnue" })],
      consommations: [],
    });
    const dit = runIntegrityChecks(m)
      .familles.flatMap((f) => f.anomalies)
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
  const messages = (perimetre: string) =>
    runIntegrityChecks(model({ groupes: [{ nom: "G", perimetre, feuille: "Groups", ligne: 0 }] }))
      .familles.flatMap((f) => f.anomalies)
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
      paliers: [
        { nom: "v1", rang: 1, libelle: "", statut: "Delivered", date: "", description: "", feuille: "Milestones", ligne: 0 },
        { nom: "v2", rang: 2, libelle: "", statut: "Delivered", date: "", description: "", feuille: "Milestones", ligne: 1 },
      ],
      // « Fantome » expose, mais ne figure pas dans l'onglet Actors.
      acteurs: [acteur({ nom: "B", palierIntroduction: "v1" })],
      interfaces: [iface({ acteurExposant: "Fantome", palierIntroduction: "v1" })],
      consommations: [conso({ acteurConsommateur: "B", palierIntroduction: "v1" })],
    });

  const blocs = (rang: number | null) =>
    runIntegrityChecks(fantome(), rang).blocsInformatifs.flatMap((b) => b.items.map((i) => `${b.titre} | ${i}`));

  it("ne déclare pas sans flux un acteur que le schéma relie", () => {
    expect(buildFlowInstances(fantome(), 1)).toHaveLength(1);
    expect(blocs(1).filter((i) => i.includes("no flow"))).toHaveLength(0);
  });

  it("dit la même chose au palier et hors palier", () => {
    expect(blocs(1).filter((i) => /no flow|Unused flow/.test(i))).toEqual(
      blocs(null).filter((i) => /no flow|Unused flow/.test(i))
    );
  });

  // Un acteur CONNU et retiré, lui, retire bien ses flux : c'est l'autre moitié
  // de la règle, corrigée plus tôt, et elle ne doit pas se rouvrir.
  it("retire toujours les flux d'un acteur connu et retiré", () => {
    const m = model({
      paliers: [{ nom: "v1", rang: 1, libelle: "", statut: "Delivered", date: "", description: "", feuille: "Milestones", ligne: 0 }],
      acteurs: [acteur({ nom: "A", palierIntroduction: "v1", palierRetrait: "v1" }), acteur({ nom: "B", palierIntroduction: "v1" })],
      interfaces: [iface({ acteurExposant: "A", palierIntroduction: "v1" })],
      consommations: [conso({ acteurConsommateur: "B", palierIntroduction: "v1" })],
    });
    expect(buildFlowInstances(m, 1)).toHaveLength(0);
  });
});
