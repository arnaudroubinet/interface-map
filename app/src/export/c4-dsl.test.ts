import { describe, it, expect } from "vitest";
import * as base from "../testing/fixtures";
import { modeleEnStructurizr } from "./c4-dsl";
import type { ParsedModel, Acteur, InterfaceCatalogue, Consommation } from "../parsing/model";
import { VERSION_MODELE } from "../parsing/build-model";

// Un parc renseigné : ces fichiers vérifient ce que les exports TRANSPORTENT,
// donc les champs qu'ils lisent doivent être remplis.
function acteur(o: Partial<Acteur> = {}): Acteur {
  return base.acteur({ groupe: "Socle", description: "d", ...o });
}

function iface(o: Partial<InterfaceCatalogue> = {}): InterfaceCatalogue {
  return base.iface({ description: "d", ...o });
}

function conso(o: Partial<Consommation> = {}): Consommation {
  return base.conso({ usage: "u", criticite: "1 - Critical", statut: "Actif", decision: "Keep", ...o });
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
      base.typeFlux({ type: "HTTP" }),
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

describe("modeleEnStructurizr", () => {
  it("wraps the model and its views in a workspace named after the workbook", () => {
    const dsl = modeleEnStructurizr(model(), null, "carto.xlsx");
    expect(dsl).toContain('workspace "carto"');
    expect(dsl).toContain("model {");
    expect(dsl).toContain("views {");
  });

  it("declares each actor as a software system, tagged with its type", () => {
    const dsl = modeleEnStructurizr(model(), null, "carto.xlsx");
    expect(dsl).toContain('a = softwareSystem "A" "d"');
    expect(dsl).toContain('tags "Application"');
  });

  // Le groupe est la seule frontière que le classeur déclare : la perdre
  // rendrait la planche illisible, tous les acteurs à plat.
  it("puts the actors inside the group they belong to", () => {
    const dsl = modeleEnStructurizr(model(), null, "carto.xlsx");
    expect(dsl).toMatch(/group "Socle" \{[^}]*a = softwareSystem/s);
  });

  // La relation va du fournisseur au consommateur, exactement comme sur les
  // schémas : un export qui l'inverserait raconterait autre chose que ce que
  // l'utilisateur a sous les yeux. L'intention du test n'a pas changé ; ce qui
  // a changé, c'est que la règle est désormais la même des deux côtés.
  it("draws the relationship the way the diagrams do", () => {
    const dsl = modeleEnStructurizr(model(), null, "carto.xlsx");
    expect(dsl).toContain('a -> b "F" "HTTP"');
  });

  // Le sens déclaré par le type de flux ne retourne plus la relation : il dit
  // seulement qui prend l'initiative, et cela s'écrit en étiquette.
  it("keeps the same direction whichever way the flow type reads", () => {
    const m = model({
      typesFlux: [
        base.typeFlux({ type: "HTTP", sensRepresentation: "exposant-consommateur", sensRepresentationBrut: "provider → consumer" }),
      ],
    });
    const dsl = modeleEnStructurizr(m, null, "carto.xlsx");
    expect(dsl).toContain('a -> b "F" "HTTP"');
    expect(dsl).not.toContain('"Pulled"');
  });

  // Ce que l'échange transporte est justement ce qu'une relation C4 décrit. Le
  // libellé de la relation porte déjà l'identité du flux -- nom et version,
  // comme sur les schémas -- et Structurizr n'a pas d'autre emplacement de
  // texte sur un lien : la description se range en propriété plutôt que perdue.
  it("carries the interface description on the relationship", () => {
    const m = model({ interfaces: [iface({ description: "What the exchange carries" })] });
    expect(modeleEnStructurizr(m, null, "carto.xlsx")).toContain('"Description" "What the exchange carries"');
  });

  // Les deux colonnes de commentaires -- celle de l'interface, celle de la
  // consommation -- disent des choses différentes : l'une porte sur le contrat,
  // l'autre sur l'usage qu'un consommateur en fait. Les fondre en une seule
  // propriété perdrait de qui vient quoi.
  it("carries both comment columns on the relationship", () => {
    const m = model({
      interfaces: [iface({ commentaires: "Scope under review" })],
      consommations: [conso({ commentaires: "Migrating next quarter" })],
    });
    const dsl = modeleEnStructurizr(m, null, "carto.xlsx");
    expect(dsl).toContain('"Interface comments" "Scope under review"');
    expect(dsl).toContain('"Consumption comments" "Migrating next quarter"');
  });

  // Un flux à confirmer est un flux dont on n'est pas sûr : l'export le dit,
  // sinon le fichier produit affirme plus que le classeur. Une interface
  // confirmée n'a rien à en dire, elle ne porte donc pas la propriété.
  it("flags an interface still to be confirmed, and only that one", () => {
    const m = model({ interfaces: [iface({ aConfirmer: true })] });
    expect(modeleEnStructurizr(m, null, "carto.xlsx")).toContain('"To confirm" "Yes"');
    expect(modeleEnStructurizr(model(), null, "carto.xlsx")).not.toContain('"To confirm"');
  });

  // Un acteur qui consomme l'interface qu'il expose lui-même : la relation
  // partirait d'un élément vers lui-même, ce qui ne dit rien dans un modèle C4
  // et que les vues agrégées masquent déjà (§4.3). Structurizr l'accepte, mais
  // LikeC4 refuse le fichier entier -- « Invalid parent-child relationship » --
  // et les deux exports doivent décrire le même modèle.
  it("leaves out an actor consuming the interface it exposes itself", () => {
    const m = model({ acteurs: [acteur({ nom: "A" })], consommations: [conso({ acteurConsommateur: "A" })] });
    const dsl = modeleEnStructurizr(m, null, "carto.xlsx");
    expect(dsl).not.toContain("a -> a");
  });

  it("names the interface version on the relationship, like everywhere else", () => {
    const m = model({ interfaces: [iface({ version: "1.0" })], consommations: [conso({ version: "1.0" })] });
    expect(modeleEnStructurizr(m, null, "carto.xlsx")).toContain('"F 1.0"');
  });

  // Un acteur retiré au palier affiché n'est plus là : l'export dit l'état de
  // la plateforme à ce palier, pas l'histoire du classeur.
  it("exports the platform as it stands at the milestone on show", () => {
    const paliers = [
      { nom: "v1", rang: 1, libelle: "", statut: "Delivered", date: "", description: "", feuille: "Milestones", ligne: 0 },
      { nom: "v2", rang: 2, libelle: "", statut: "Delivered", date: "", description: "", feuille: "Milestones", ligne: 0 },
    ];
    const m = model({
      paliers,
      acteurs: [
        acteur({ nom: "A", palierIntroduction: "v1" }),
        acteur({ nom: "B", groupe: "Partenaire", palierIntroduction: "v1", palierRetrait: "v2" }),
      ],
      interfaces: [iface({ palierIntroduction: "v1" })],
      consommations: [conso({ palierIntroduction: "v1" })],
    });
    expect(modeleEnStructurizr(m, 1, "carto.xlsx")).toContain('b = softwareSystem "B"');
    expect(modeleEnStructurizr(m, 2, "carto.xlsx")).not.toContain('b = softwareSystem "B"');
  });

  // Structurizr ne sait pas échapper un guillemet : le laisser passer casserait
  // le fichier entier plutôt que la seule ligne fautive.
  it("keeps a quoted name from breaking the file", () => {
    const m = model({ acteurs: [acteur({ nom: 'Le "gros" système' })], interfaces: [], consommations: [] });
    const dsl = modeleEnStructurizr(m, null, "carto.xlsx");
    expect(dsl).toContain("Le 'gros' système");
  });

  it("declares a landscape view that shows everything", () => {
    const dsl = modeleEnStructurizr(model(), null, "carto.xlsx");
    expect(dsl).toContain("systemLandscape");
    expect(dsl).toContain("include *");
    expect(dsl).toContain("autolayout lr");
  });

  // Une vue par schema : ce que l'outil sait dessiner, l'outil C4 doit savoir
  // le retrouver sans avoir a le redemander au classeur.
  it("declares a context view for each actor", () => {
    const dsl = modeleEnStructurizr(model(), null, "carto.xlsx");
    expect(dsl).toContain('systemContext a "actor-a"');
    expect(dsl).toContain('systemContext b "actor-b"');
  });

  // La vue par technologie se lit sur les traits, pas sur les boites : chaque
  // lien porte donc sa technologie en etiquette, faute de quoi rien ne permet
  // de la retrouver.
  it("tags each relationship with its technology, and gives it a view", () => {
    const dsl = modeleEnStructurizr(model(), null, "carto.xlsx");
    expect(dsl).toContain('tags "HTTP"');
    expect(dsl).toContain('systemLandscape "tech-http"');
    expect(dsl).toContain('include "relationship.tag==HTTP"');
  });

  it("declares a view holding the platform alone", () => {
    const dsl = modeleEnStructurizr(model(), null, "carto.xlsx");
    expect(dsl).toContain('include "element.tag==Platform"');
  });

  // Une technologie declaree mais que personne n'emploie n'a pas de schema
  // dans l'outil : elle n'en a pas davantage ici.
  it("leaves out a technology no interface uses", () => {
    const m = model({
      typesFlux: [
        ...model().typesFlux,
        base.typeFlux({ type: "Kafka", sensRepresentation: "exposant-consommateur", sensRepresentationBrut: "provider \u2192 consumer" }),
      ],
    });
    expect(modeleEnStructurizr(m, null, "carto.xlsx")).not.toContain("tech-kafka");
  });
});

// --- La règle des schémas vaut pour le modèle C4 : la relation va du
// fournisseur au consommateur, comme la donnée. Elle suivait auparavant le sens
// de l'APPEL, si bien qu'un flux HTTP sortait à l'envers de nos images -- le
// même parc racontait deux histoires selon qu'on le lisait ici ou là.
//
// L'initiative n'est pas perdue : une relation C4 n'a qu'un sens, elle passe
// donc en étiquette.
describe("modeleEnStructurizr — sens de la relation", () => {
  const parc = (sensRepresentation: "exposant-consommateur" | "consommateur-exposant") =>
    model({
      acteurs: [acteur({ nom: "Fournisseur" }), acteur({ nom: "Appelant" })],
      typesFlux: [base.typeFlux({ sensRepresentation, sensRepresentationBrut: "" })],
      interfaces: [iface({ acteurExposant: "Fournisseur" })],
      consommations: [conso({ acteurConsommateur: "Appelant" })],
    });

  // Les identifiants sont fabriqués par identifiants() : on les résout depuis
  // les lignes de déclaration plutôt que d'en supposer la forme.
  const identifiantDe = (dsl: string, nom: string) =>
    dsl.split("\n").find((l) => l.includes(`"${nom}"`) && l.includes(" = "))!.trim().split(" = ")[0];
  const relation = (dsl: string) => dsl.split("\n").find((l) => l.includes(" -> "))!.trim();

  it("va du fournisseur au consommateur, même quand le consommateur appelle", () => {
    for (const sens of ["exposant-consommateur", "consommateur-exposant"] as const) {
      const dsl = modeleEnStructurizr(parc(sens), null, "c.xlsx");
      const [de, vers] = relation(dsl).split(" -> ");
      expect(de).toBe(identifiantDe(dsl, "Fournisseur"));
      expect(vers.split(" ")[0]).toBe(identifiantDe(dsl, "Appelant"));
    }
  });

  it("étiquette la relation que le consommateur initie", () => {
    expect(modeleEnStructurizr(parc("consommateur-exposant"), null, "c.xlsx")).toContain('"Pulled"');
    expect(modeleEnStructurizr(parc("exposant-consommateur"), null, "c.xlsx")).not.toContain('"Pulled"');
  });
});

// --- QA : le périmètre était comparé par égalité stricte ici, et à la
// normalisation près dans les schémas. Un groupe saisi « platform » était donc
// une plateforme à l'écran et n'en était plus une dans le fichier C4 : la vue
// dédiée disparaissait sans un mot.
describe("modeleEnStructurizr — périmètre écrit autrement", () => {
  const parc = (perimetre: string) =>
    model({ groupes: [{ nom: "Socle", perimetre, feuille: "Groups", ligne: 0 }] });

  it("reconnaît la plateforme quelle que soit la casse", () => {
    for (const v of ["Platform", "platform", "PLATFORM"]) {
      expect(modeleEnStructurizr(parc(v), null, "c.xlsx")).toContain('"platform-only"');
    }
  });

  it("ne fabrique pas la vue quand aucun groupe n'est plateforme", () => {
    expect(modeleEnStructurizr(parc("External"), null, "c.xlsx")).not.toContain('"platform-only"');
  });
});
