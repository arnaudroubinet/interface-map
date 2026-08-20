import { describe, it, expect } from "vitest";
import { toutesLesPlanches } from "./planches";
import type { ParsedModel, Acteur, InterfaceCatalogue, Consommation } from "../parsing/model";
import { VERSION_MODELE } from "../parsing/build-model";

function acteur(o: Partial<Acteur>): Acteur {
  return {
    nom: "A", groupe: "Socle", typeActeur: "Application", responsable: "", description: "d", commentaires: "",
    palierIntroduction: "", palierRetrait: "", feuille: "Actors", ligne: 0, ...o,
  };
}

function iface(o: Partial<InterfaceCatalogue>): InterfaceCatalogue {
  return {
    nomDuFlux: "F", acteurExposant: "A", typeDeFlux: "HTTP", description: "d", version: "", etat: "",
    lienContrat: "", referenceContrat: "", commentaires: "", aConfirmer: false,
    feuilleAttendue: "FX_A_HTTP", relais: "", palierIntroduction: "", palierRetrait: "",
    feuille: "Interfaces", ligne: 0, ...o,
  };
}

function conso(o: Partial<Consommation>): Consommation {
  return {
    nomDuFlux: "F", acteurConsommateur: "B", usage: "u", criticite: "1 - Critical", version: "",
    statut: "Actif", decision: "Keep", republiePar: "", commentaires: "", feuille: "FX_A_HTTP",
    palierIntroduction: "", palierRetrait: "", ligne: 0, ...o,
  };
}

function model(o: Partial<ParsedModel> = {}): ParsedModel {
  return {
    acteurs: [acteur({ nom: "A" }), acteur({ nom: "B", groupe: "Partenaire" })],
    groupes: [
      { nom: "Socle", perimetre: "Platform", feuille: "Groups", ligne: 0 },
      { nom: "Partenaire", perimetre: "External", feuille: "Groups", ligne: 0 },
    ],
    groupesAbsents: false,
    typesActeur: [{ type: "Application", icone: "app-window", nature: "", feuille: "ActorTypes", ligne: 0 }],
    paliers: [],
    typesFlux: [
      { type: "HTTP", sensRepresentation: "consommateur-exposant", sensRepresentationBrut: "consumer → provider", couleur: "", description: "", feuille: "FlowTypes", ligne: 0 },
      { type: "Kafka", sensRepresentation: "exposant-consommateur", sensRepresentationBrut: "provider → consumer", couleur: "", description: "", feuille: "FlowTypes", ligne: 0 },
    ],
    interfaces: [iface({})],
    consommations: [conso({})],
    fxSheetNames: ["FX_A_HTTP"],
    colonnesOptionnellesAbsentes: [],
    versionModele: VERSION_MODELE,
    fichierModifie: null,
    ...o,
  };
}

const titres = (m: ParsedModel, rang: number | null = null) =>
  toutesLesPlanches(m, rang, "architecture").map((p) => p.titre);

// Bus relaie un flux d'Tatooine vers Naboo : Tatooine expose F1, Bus relaie
// via F2 (relais: F1), Naboo consomme F2. En fonctionnel, la chaîne se
// résout en un flux direct Tatooine → Naboo, Bus disparaît.
function modeleAvecTechnique(): ParsedModel {
  return model({
    acteurs: [acteur({ nom: "Tatooine" }), acteur({ nom: "Bus", typeActeur: "Middleware" }), acteur({ nom: "Naboo" })],
    typesActeur: [
      { type: "Application", icone: "app-window", nature: "", feuille: "ActorTypes", ligne: 0 },
      { type: "Middleware", icone: "app-window", nature: "Technical", feuille: "ActorTypes", ligne: 0 },
    ],
    interfaces: [iface({ nomDuFlux: "F1", acteurExposant: "Tatooine" }), iface({ nomDuFlux: "F2", acteurExposant: "Bus", relais: "F1" })],
    consommations: [conso({ nomDuFlux: "F2", acteurConsommateur: "Naboo" })],
  });
}

describe("toutesLesPlanches", () => {
  it("opens with the three views that need no selection", () => {
    expect(titres(model()).slice(0, 3)).toEqual(["Group to group", "Platform detail", "Platform only"]);
  });

  // Les vues à sélecteur en produisent autant qu'il y a de choix dans le
  // sélecteur : c'est là tout ce que « tous les schémas » veut dire.
  it("unfolds the selector views, one board per choice", () => {
    const tous = titres(model());
    expect(tous).toContain("HTTP (technology)");
    expect(tous).toContain("A (actor)");
    expect(tous).toContain("B (actor)");
  });

  // Une technologie que personne n'emploie n'a pas de schéma : ce serait une
  // planche vide, et le rapport la signale déjà comme type inutilisé.
  it("leaves out a technology no interface uses", () => {
    expect(titres(model())).not.toContain("Kafka (technology)");
  });

  // Un acteur qu'aucun flux ne touche non plus : sa planche ne montrerait que
  // sa propre boîte.
  it("leaves out an actor no flow reaches", () => {
    const m = model({ acteurs: [acteur({ nom: "A" }), acteur({ nom: "B" }), acteur({ nom: "Seul" })] });
    expect(titres(m)).not.toContain("Seul (actor)");
  });

  // Un acteur peut porter le nom d'un type de flux : deux onglets « HTTP »
  // dans le fichier draw.io, et le lecteur ne sait plus lequel est la
  // technologie et lequel est l'acteur.
  it("tells the flow type board from the actor board of the same name", () => {
    const m = model({
      acteurs: [acteur({ nom: "HTTP" }), acteur({ nom: "B", groupe: "Partenaire" })],
      interfaces: [iface({ acteurExposant: "HTTP" })],
    });
    expect(titres(m)).toContain("HTTP (technology)");
    expect(titres(m)).toContain("HTTP (actor)");
    // La planche nomme l'acteur qu'elle détaille : c'est ce que visent les
    // liens, et le titre ne se laisse plus défaire pour le retrouver.
    const planches = toutesLesPlanches(m, null, "architecture");
    expect(planches.find((p) => p.titre === "HTTP (actor)")!.acteur).toBe("HTTP");
    expect(planches.find((p) => p.titre === "HTTP (technology)")!.acteur).toBeUndefined();
  });

  it("carries the nodes and edges of each board", () => {
    const planche = toutesLesPlanches(model(), null, "architecture").find((p) => p.titre === "Group to group")!;
    expect(planche.nodes.length).toBeGreaterThan(0);
    expect(planche.edges.length).toBeGreaterThan(0);
  });

  // Le palier affiché vaut pour toutes les planches : un export ne peut pas
  // mélanger deux états de la plateforme.
  it("reads every board at the same milestone", () => {
    const paliers = [
      { nom: "v1", rang: 1, libelle: "", statut: "Delivered", date: "", description: "", feuille: "Milestones", ligne: 0 },
      { nom: "v2", rang: 2, libelle: "", statut: "Delivered", date: "", description: "", feuille: "Milestones", ligne: 0 },
    ];
    const m = model({
      paliers,
      interfaces: [iface({ palierIntroduction: "v1", palierRetrait: "v2" })],
      consommations: [conso({ palierIntroduction: "v1" })],
      acteurs: [acteur({ nom: "A", palierIntroduction: "v1" }), acteur({ nom: "B", groupe: "Partenaire", palierIntroduction: "v1" })],
    });
    expect(titres(m, 1)).toContain("HTTP (technology)");
    expect(titres(m, 2)).not.toContain("HTTP (technology)");
  });
});

describe("planches selon le mode", () => {
  it("n'inclut aucune planche par technologie en fonctionnel", () => {
    const titres = toutesLesPlanches(modeleAvecTechnique(), null, "fonctionnel").map((p) => p.titre);
    expect(titres).not.toContain("HTTP (technology)");
  });

  it("n'inclut aucune planche pour un acteur technique", () => {
    const titres = toutesLesPlanches(modeleAvecTechnique(), null, "fonctionnel").map((p) => p.titre);
    expect(titres).not.toContain("Bus (actor)");
  });

  it("garde les trois vues fixes", () => {
    const titres = toutesLesPlanches(modeleAvecTechnique(), null, "fonctionnel").map((p) => p.titre);
    expect(titres.slice(0, 3)).toEqual(["Group to group", "Platform detail", "Platform only"]);
  });

  // §5.2 : un acteur métier devenu isolé -- dont les échanges passaient tous
  // par des chaînes coupées -- reste affiché, seul. Le fichier draw.io promet
  // toutes les planches ; un onglet manquant romprait cette promesse.
  it("porte sa propre planche pour un acteur métier devenu isolé", () => {
    const m = modeleAvecTechnique();
    m.acteurs.push(acteur({ nom: "Isolé", groupe: "Socle" }));
    const titres = toutesLesPlanches(m, null, "fonctionnel").map((p) => p.titre);
    expect(titres).toContain("Isolé (actor)");
  });

  // Retiré au palier affiché, l'acteur isolé n'a plus de planche : il n'est
  // plus sur la carte, pas même seul.
  it("n'a pas de planche pour un acteur métier isolé retiré au palier affiché", () => {
    const paliers = [
      { nom: "v1", rang: 1, libelle: "", statut: "Delivered", date: "", description: "", feuille: "Milestones", ligne: 0 },
      { nom: "v2", rang: 2, libelle: "", statut: "Delivered", date: "", description: "", feuille: "Milestones", ligne: 0 },
    ];
    const m = modeleAvecTechnique();
    m.paliers = paliers;
    m.acteurs.push(acteur({ nom: "Isolé", groupe: "Socle", palierIntroduction: "v1", palierRetrait: "v2" }));
    const titresÀ = (rang: number) => toutesLesPlanches(m, rang, "fonctionnel").map((p) => p.titre);
    expect(titresÀ(1)).toContain("Isolé (actor)");
    expect(titresÀ(2)).not.toContain("Isolé (actor)");
  });
});
