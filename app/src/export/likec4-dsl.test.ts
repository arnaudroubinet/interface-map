import { describe, it, expect } from "vitest";
import * as base from "../testing/fixtures";
import { modeleEnLikeC4 } from "./likec4-dsl";
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

describe("modeleEnLikeC4", () => {
  it("declares the kinds it uses before using them", () => {
    const dsl = modeleEnLikeC4(model(), null);
    expect(dsl).toMatch(/specification \{[\s\S]*element group[\s\S]*element system[\s\S]*\}/);
    expect(dsl.indexOf("specification {")).toBeLessThan(dsl.indexOf("model {"));
  });

  // LikeC4 dit l'appartenance par l'imbrication : c'est ce qui donne au groupe
  // sa frontière sur la planche.
  it("nests the actors inside their group", () => {
    const dsl = modeleEnLikeC4(model(), null);
    expect(dsl).toMatch(/socle = group "Socle" \{\s+a = system "A" \{/);
  });

  it("carries the description and the actor type on the element", () => {
    const dsl = modeleEnLikeC4(model(), null);
    expect(dsl).toContain('description "d"');
    expect(dsl).toContain('technology "Application"');
  });

  // Le périmètre du groupe devient une étiquette : c'est ce qui distingue le
  // parc qu'on tient de celui qu'on subit.
  it("tags what sits outside the platform", () => {
    const dsl = modeleEnLikeC4(model(), null);
    expect(dsl).toMatch(/b = system "B" \{\s+#external/);
  });

  // Une relation nommée depuis la racine désigne les deux bouts par leur
  // chemin complet, sans quoi LikeC4 ne les retrouve pas.
  it("names both ends by their full path", () => {
    const dsl = modeleEnLikeC4(model(), null);
    expect(dsl).toContain('socle.a -[http]-> partenaire.b "F"');
    expect(dsl).toContain('technology "HTTP"');
  });

  it("follows the flow type the other way round when it says so", () => {
    const m = model({
      typesFlux: [
        base.typeFlux({ type: "HTTP", sensRepresentation: "exposant-consommateur", sensRepresentationBrut: "provider → consumer" }),
      ],
    });
    expect(modeleEnLikeC4(m, null)).toContain('socle.a -[http]-> partenaire.b "F"');
  });

  // LikeC4 a un champ de description sur la relation, distinct du libellé : ce
  // que l'échange transporte s'y écrit là où l'outil l'affiche, plutôt qu'en
  // métadonnée.
  it("carries the interface description on the relationship", () => {
    const m = model({ interfaces: [iface({ description: "What the exchange carries" })] });
    expect(modeleEnLikeC4(m, null)).toMatch(/-> partenaire\.b "F" \{[^}]*description "What the exchange carries"/s);
  });

  // Les deux colonnes de commentaires ne disent pas la même chose : celle de
  // l'interface porte sur le contrat, celle de la consommation sur l'usage
  // qu'un consommateur en fait.
  it("carries both comment columns on the relationship", () => {
    const m = model({
      interfaces: [iface({ commentaires: "Scope under review" })],
      consommations: [conso({ commentaires: "Migrating next quarter" })],
    });
    const dsl = modeleEnLikeC4(m, null);
    expect(dsl).toContain('interfaceComments "Scope under review"');
    expect(dsl).toContain('consumptionComments "Migrating next quarter"');
  });

  it("flags an interface still to be confirmed, and only that one", () => {
    const m = model({ interfaces: [iface({ aConfirmer: true })] });
    expect(modeleEnLikeC4(m, null)).toContain('toConfirm "Yes"');
    expect(modeleEnLikeC4(model(), null)).not.toContain("toConfirm");
  });

  // Un acteur qui consomme l'interface qu'il expose lui-même : LikeC4 refuse le
  // fichier entier sur une relation d'un élément vers lui-même -- « Invalid
  // parent-child relationship ». Les vues agrégées la masquent déjà (§4.3).
  it("leaves out an actor consuming the interface it exposes itself", () => {
    const m = model({ acteurs: [acteur({ nom: "A" })], consommations: [conso({ acteurConsommateur: "A" })] });
    const dsl = modeleEnLikeC4(m, null);
    expect(dsl).not.toContain("socle.a -> socle.a");
  });

  // Un acteur sans groupe existe quand même : le rapport le réclame déjà, ce
  // n'est pas à l'export de le faire disparaître.
  it("keeps an actor that belongs to no group, at the root", () => {
    const m = model({ acteurs: [acteur({ nom: "Seul", groupe: "" })], interfaces: [], consommations: [] });
    expect(modeleEnLikeC4(m, null)).toContain('seul = system "Seul"');
  });

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
    expect(modeleEnLikeC4(m, 1)).toContain('b = system "B"');
    expect(modeleEnLikeC4(m, 2)).not.toContain('b = system "B"');
  });

  it("declares a view that shows everything", () => {
    const dsl = modeleEnLikeC4(model(), null);
    expect(dsl).toContain("views {");
    expect(dsl).toContain("include *");
  });

  // Une vue par schema, comme dans l'outil : la vue d'un acteur porte sur cet
  // acteur, d'ou le « of ».
  it("declares a view for each actor, scoped to it", () => {
    const dsl = modeleEnLikeC4(model(), null);
    expect(dsl).toContain("view actor_a of socle.a {");
    expect(dsl).toContain("view actor_b of partenaire.b {");
  });

  // La technologie se lit sur les traits : sans etiquette sur la relation, la
  // vue n'a rien sur quoi filtrer. L'etiquette doit etre declaree d'abord.
  it("tags each relationship with its technology, and gives it a view", () => {
    const dsl = modeleEnLikeC4(model(), null);
    expect(dsl).toContain("tag http");
    expect(dsl).toMatch(/-> partenaire\.b "F" \{\s+#http/);
    expect(dsl).toContain("view tech_http {");
    expect(dsl).toContain("include * where tag is #http");
  });

  it("declares a view holding the platform alone", () => {
    const dsl = modeleEnLikeC4(model(), null);
    expect(dsl).toContain("view platform_only {");
    expect(dsl).toContain("include * where tag is #platform");
  });
});

// --- §2.13 : trois kinds pour N types d'acteur, aucune légende, et notre
// convention de pointe réduite à une étiquette -- alors que LikeC4 est la
// SEULE cible qui sache la dessiner.
describe("modeleEnLikeC4 — la notation traverse l'export", () => {
  const parc = (sens: "consommateur-exposant" | "exposant-consommateur") =>
    model({ typesFlux: [base.typeFlux({ type: "HTTP", sensRepresentation: sens })] });

  it("pose une pointe ouverte sur une technologie tirée", () => {
    expect(modeleEnLikeC4(parc("consommateur-exposant"), null)).toMatch(/relationship http \{[\s\S]*?head vee/);
  });

  it("pose une pointe pleine sur une technologie poussée", () => {
    expect(modeleEnLikeC4(parc("exposant-consommateur"), null)).toMatch(/relationship http \{[\s\S]*?head normal/);
  });

  // Le style de trait par défaut de LikeC4 est `dashed` : sans `line solid`,
  // TOUS nos traits sortent en pointillé et « Transform » ne se distingue plus.
  it("écrit line solid explicitement", () => {
    expect(modeleEnLikeC4(parc("exposant-consommateur"), null)).toContain("line solid");
  });

  it("donne à la relation la couleur que la technologie a dans l'outil", () => {
    const m = model({ typesFlux: [base.typeFlux({ type: "HTTP", couleur: "#1f5fae" })] });
    expect(modeleEnLikeC4(m, null)).toMatch(/relationship http \{[\s\S]*?color #1f5fae/);
  });

  // Les groupes sont DÉJÀ des éléments du modèle exporté : il ne manquait que
  // les vues. Cité sans son `.*` un groupe est une boîte, avec son `.*` il est
  // ouvert -- soit exactement nos deux vues agrégées.
  it("produit la vue groupe à groupe et la vue plateforme détaillée", () => {
    const dsl = modeleEnLikeC4(model(), null);
    expect(dsl).toContain("view group_to_group {");
    expect(dsl).toContain("view platform_detail {");
    expect(dsl).toMatch(/view platform_detail \{[\s\S]*?socle\.\*/);
  });
});
