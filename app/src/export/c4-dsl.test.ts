import { describe, it, expect } from "vitest";
import * as base from "../testing/fixtures";
import { modelToStructurizr } from "./c4-dsl";
import type { ParsedModel, Actor, InterfaceCatalogue, Consumption } from "../parsing/model";
import { SCHEMA_VERSION } from "../parsing/build-model";

// Un parc renseigné : ces fichiers vérifient ce que les exports TRANSPORTENT,
// donc les champs qu'ils lisent doivent être remplis.
function actor(o: Partial<Actor> = {}): Actor {
  return base.actor({ group: "Socle", description: "d", ...o });
}

function iface(o: Partial<InterfaceCatalogue> = {}): InterfaceCatalogue {
  return base.iface({ description: "d", ...o });
}

function consumption(o: Partial<Consumption> = {}): Consumption {
  return base.consumption({ usage: "u", criticality: "1 - Critical", legacyStatus: "Actif", decision: "Keep", ...o });
}

function model(o: Partial<ParsedModel> = {}): ParsedModel {
  return {
    actors: [actor({ name: "A" }), actor({ name: "B", group: "Partenaire" })],
    groups: [
      { name: "Socle", perimeter: "Platform", sheet: "Groups", row: 0 },
      { name: "Partenaire", perimeter: "External", sheet: "Groups", row: 0 },
    ],
    groupsSheetMissing: false,
    actorTypes: [{ type: "Application", icon: "app-window", nature: "", sheet: "ActorTypes", row: 0 }],
    milestones: [],
    flowTypes: [
      base.typeFlux({ type: "HTTP" }),
    ],
    interfaces: [iface({})],
    consumptions: [consumption({})],
    fxSheetNames: ["FX_A_HTTP"],
    missingOptionalColumns: [],
    schemaVersion: SCHEMA_VERSION,
    savedAt: null,
    ...o,
  };
}

describe("modeleEnStructurizr", () => {
  it("wraps the model and its views in a workspace named after the workbook", () => {
    const dsl = modelToStructurizr(model(), null, "carto.xlsx");
    expect(dsl).toContain('workspace "carto"');
    expect(dsl).toContain("model {");
    expect(dsl).toContain("views {");
  });

  it("declares each actor as a software system, tagged with its type", () => {
    const dsl = modelToStructurizr(model(), null, "carto.xlsx");
    expect(dsl).toContain('a = softwareSystem "A" "d"');
    expect(dsl).toContain('tags "Application"');
  });

  // Le groupe est la seule frontière que le classeur déclare : la perdre
  // rendrait la planche illisible, tous les acteurs à plat.
  it("puts the actors inside the group they belong to", () => {
    const dsl = modelToStructurizr(model(), null, "carto.xlsx");
    expect(dsl).toMatch(/group "Socle" \{[^}]*a = softwareSystem/s);
  });

  // La relation va du fournisseur au consommateur, exactement comme sur les
  // schémas : un export qui l'inverserait raconterait autre chose que ce que
  // l'utilisateur a sous les yeux. L'intention du test n'a pas changé ; ce qui
  // a changé, c'est que la règle est désormais la même des deux côtés.
  it("draws the relationship the way the diagrams do", () => {
    const dsl = modelToStructurizr(model(), null, "carto.xlsx");
    expect(dsl).toContain('a -> b "F" "HTTP"');
  });

  // Le sens déclaré par le type de flux ne retourne plus la relation : il dit
  // seulement qui prend l'initiative, et cela s'écrit en étiquette.
  it("keeps the same direction whichever way the flow type reads", () => {
    const m = model({
      flowTypes: [
        base.typeFlux({ type: "HTTP", direction: "provider-to-consumer", rawDirection: "provider → consumer" }),
      ],
    });
    const dsl = modelToStructurizr(m, null, "carto.xlsx");
    expect(dsl).toContain('a -> b "F" "HTTP"');
    expect(dsl).not.toContain('"Pulled"');
  });

  // Ce que l'échange transporte est justement ce qu'une relation C4 décrit. Le
  // libellé de la relation porte déjà l'identité du flux -- nom et version,
  // comme sur les schémas -- et Structurizr n'a pas d'autre emplacement de
  // texte sur un lien : la description se range en propriété plutôt que perdue.
  it("carries the interface description on the relationship", () => {
    const m = model({ interfaces: [iface({ description: "What the exchange carries" })] });
    expect(modelToStructurizr(m, null, "carto.xlsx")).toContain('"Description" "What the exchange carries"');
  });

  // Les deux colonnes de commentaires -- celle de l'interface, celle de la
  // consommation -- disent des choses différentes : l'une porte sur le contrat,
  // l'autre sur l'usage qu'un consommateur en fait. Les fondre en une seule
  // propriété perdrait de qui vient quoi.
  it("carries both comment columns on the relationship", () => {
    const m = model({
      interfaces: [iface({ comments: "Scope under review" })],
      consumptions: [consumption({ comments: "Migrating next quarter" })],
    });
    const dsl = modelToStructurizr(m, null, "carto.xlsx");
    expect(dsl).toContain('"Interface comments" "Scope under review"');
    expect(dsl).toContain('"Consumption comments" "Migrating next quarter"');
  });

  // Un flux à confirmer est un flux dont on n'est pas sûr : l'export le dit,
  // sinon le fichier produit affirme plus que le classeur. Une interface
  // confirmée n'a rien à en dire, elle ne porte donc pas la propriété.
  it("flags an interface still to be confirmed, and only that one", () => {
    const m = model({ interfaces: [iface({ toConfirm: true })] });
    expect(modelToStructurizr(m, null, "carto.xlsx")).toContain('"To confirm" "Yes"');
    expect(modelToStructurizr(model(), null, "carto.xlsx")).not.toContain('"To confirm"');
  });

  // Un acteur qui consomme l'interface qu'il expose lui-même : la relation
  // partirait d'un élément vers lui-même, ce qui ne dit rien dans un modèle C4
  // et que les vues agrégées masquent déjà (§4.3). Structurizr l'accepte, mais
  // LikeC4 refuse le fichier entier -- « Invalid parent-child relationship » --
  // et les deux exports doivent décrire le même modèle.
  it("leaves out an actor consuming the interface it exposes itself", () => {
    const m = model({ actors: [actor({ name: "A" })], consumptions: [consumption({ consumerName: "A" })] });
    const dsl = modelToStructurizr(m, null, "carto.xlsx");
    expect(dsl).not.toContain("a -> a");
  });

  it("names the interface version on the relationship, like everywhere else", () => {
    const m = model({ interfaces: [iface({ version: "1.0" })], consumptions: [consumption({ version: "1.0" })] });
    expect(modelToStructurizr(m, null, "carto.xlsx")).toContain('"F 1.0"');
  });

  // Un acteur retiré au palier affiché n'est plus là : l'export dit l'état de
  // la plateforme à ce palier, pas l'histoire du classeur.
  it("exports the platform as it stands at the milestone on show", () => {
    const milestones = [
      { name: "v1", rank: 1, label: "", status: "Delivered", date: "", description: "", sheet: "Milestones", row: 0 },
      { name: "v2", rank: 2, label: "", status: "Delivered", date: "", description: "", sheet: "Milestones", row: 0 },
    ];
    const m = model({
      milestones,
      actors: [
        actor({ name: "A", introducedAt: "v1" }),
        actor({ name: "B", group: "Partenaire", introducedAt: "v1", retiredAt: "v2" }),
      ],
      interfaces: [iface({ introducedAt: "v1" })],
      consumptions: [consumption({ introducedAt: "v1" })],
    });
    expect(modelToStructurizr(m, 1, "carto.xlsx")).toContain('b = softwareSystem "B"');
    expect(modelToStructurizr(m, 2, "carto.xlsx")).not.toContain('b = softwareSystem "B"');
  });

  // Structurizr ne sait pas échapper un guillemet : le laisser passer casserait
  // le fichier entier plutôt que la seule ligne fautive.
  it("keeps a quoted name from breaking the file", () => {
    const m = model({ actors: [actor({ name: 'Le "gros" système' })], interfaces: [], consumptions: [] });
    const dsl = modelToStructurizr(m, null, "carto.xlsx");
    expect(dsl).toContain("Le 'gros' système");
  });

  it("declares a landscape view that shows everything", () => {
    const dsl = modelToStructurizr(model(), null, "carto.xlsx");
    expect(dsl).toContain("systemLandscape");
    expect(dsl).toContain("include *");
    expect(dsl).toContain("autolayout lr");
  });

  // Une vue par schema : ce que l'outil sait dessiner, l'outil C4 doit savoir
  // le retrouver sans avoir a le redemander au classeur.
  it("declares a context view for each actor", () => {
    const dsl = modelToStructurizr(model(), null, "carto.xlsx");
    expect(dsl).toContain('systemContext a "actor-a"');
    expect(dsl).toContain('systemContext b "actor-b"');
  });

  // La vue par technologie se lit sur les traits, pas sur les boites : chaque
  // lien porte donc sa technologie en etiquette, faute de quoi rien ne permet
  // de la retrouver.
  it("tags each relationship with its technology, and gives it a view", () => {
    const dsl = modelToStructurizr(model(), null, "carto.xlsx");
    expect(dsl).toContain('tags "HTTP"');
    expect(dsl).toContain('systemLandscape "tech-http"');
    expect(dsl).toContain('include "relationship.tag==HTTP"');
  });

  it("declares a view holding the platform alone", () => {
    const dsl = modelToStructurizr(model(), null, "carto.xlsx");
    expect(dsl).toContain('include "element.tag==Platform"');
  });

  // Une technologie declaree mais que personne n'emploie n'a pas de schema
  // dans l'outil : elle n'en a pas davantage ici.
  it("leaves out a technology no interface uses", () => {
    const m = model({
      flowTypes: [
        ...model().flowTypes,
        base.typeFlux({ type: "Kafka", direction: "provider-to-consumer", rawDirection: "provider \u2192 consumer" }),
      ],
    });
    expect(modelToStructurizr(m, null, "carto.xlsx")).not.toContain("tech-kafka");
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
  const estate = (direction: "provider-to-consumer" | "consumer-to-provider") =>
    model({
      actors: [actor({ name: "Fournisseur" }), actor({ name: "Appelant" })],
      flowTypes: [base.typeFlux({ direction, rawDirection: "" })],
      interfaces: [iface({ providerName: "Fournisseur" })],
      consumptions: [consumption({ consumerName: "Appelant" })],
    });

  // Les identifiants sont fabriqués par identifiants() : on les résout depuis
  // les lignes de déclaration plutôt que d'en supposer la forme.
  const identifiantDe = (dsl: string, name: string) =>
    dsl.split("\n").find((l) => l.includes(`"${name}"`) && l.includes(" = "))!.trim().split(" = ")[0];
  const relation = (dsl: string) => dsl.split("\n").find((l) => l.includes(" -> "))!.trim();

  it("va du fournisseur au consommateur, même quand le consommateur appelle", () => {
    for (const direction of ["provider-to-consumer", "consumer-to-provider"] as const) {
      const dsl = modelToStructurizr(estate(direction), null, "c.xlsx");
      const [de, vers] = relation(dsl).split(" -> ");
      expect(de).toBe(identifiantDe(dsl, "Fournisseur"));
      expect(vers.split(" ")[0]).toBe(identifiantDe(dsl, "Appelant"));
    }
  });

  it("étiquette la relation que le consommateur initie", () => {
    expect(modelToStructurizr(estate("consumer-to-provider"), null, "c.xlsx")).toContain('"Pulled"');
    expect(modelToStructurizr(estate("provider-to-consumer"), null, "c.xlsx")).not.toContain('"Pulled"');
  });
});

// --- QA : le périmètre était comparé par égalité stricte ici, et à la
// normalisation près dans les schémas. Un groupe saisi « platform » était donc
// une plateforme à l'écran et n'en était plus une dans le fichier C4 : la vue
// dédiée disparaissait sans un mot.
describe("modeleEnStructurizr — périmètre écrit autrement", () => {
  const estate = (perimeter: string) =>
    model({ groups: [{ name: "Socle", perimeter, sheet: "Groups", row: 0 }] });

  it("reconnaît la plateforme quelle que soit la casse", () => {
    for (const v of ["Platform", "platform", "PLATFORM"]) {
      expect(modelToStructurizr(estate(v), null, "c.xlsx")).toContain('"platform-only"');
    }
  });

  // Déclarer la vue ne suffit pas : elle filtre sur « element.tag==Platform »,
  // et l'étiquette recopiait l'écriture du classeur. La vue existait donc, et
  // sortait vide.
  it("étiquette les acteurs dans l'écriture que la vue filtre", () => {
    for (const v of ["platform", "PLATFORM"]) {
      const dsl = modelToStructurizr(estate(v), null, "c.xlsx");
      expect(dsl).toContain('"Platform"');
      expect(dsl).not.toContain(`"${v}"`);
    }
  });

  it("ne fabrique pas la vue quand aucun groupe n'est plateforme", () => {
    expect(modelToStructurizr(estate("External"), null, "c.xlsx")).not.toContain('"platform-only"');
  });
});

// --- §2.12 : 21 vues sans titre. Ouvert dans Structurizr, le fichier
// présentait une liste de clés techniques -- « tech-rest-esb » -- que
// personne ne peut lire.
describe("modeleEnStructurizr — les vues portent un titre", () => {
  it("écrit `title` DANS le bloc de la vue, pas en second argument", () => {
    const dsl = modelToStructurizr(model(), null, "carto.xlsx", "v2");
    expect(dsl).toMatch(/systemLandscape "landscape" \{\s*\n\s*title "System landscape — milestone v2"/);
  });

  it("titre chaque vue de technologie du nom de la technologie", () => {
    expect(modelToStructurizr(model(), null, "carto.xlsx")).toContain('title "HTTP flows"');
  });

  // Sans palier affiché, pas de mention : « milestone null » serait pire que
  // rien.
  it("ne mentionne le palier que lorsqu'il y en a un", () => {
    expect(modelToStructurizr(model(), null, "carto.xlsx")).not.toContain("milestone");
  });
});

describe("modeleEnStructurizr — la notation passe dans le fichier", () => {
  it("style la plateforme, et pas seulement l'externe", () => {
    expect(modelToStructurizr(model(), null, "carto.xlsx")).toMatch(/element "Platform" \{\s*\n\s*background/);
  });

  // Sans style, l'étiquette « Pulled » ne changeait rien dans l'outil cible :
  // notre convention de pointe y était invisible.
  // Le terrain par défaut est TIRÉ (HTTP, « consumer → provider »).
  it("donne un style au tag Pulled quand un flux est tiré", () => {
    expect(modelToStructurizr(model(), null, "carto.xlsx")).toMatch(/relationship "Pulled" \{\s*\n\s*style dashed/);
  });

  it("ne style pas Pulled quand aucun flux ne l'est", () => {
    const pushed = model({ flowTypes: [base.typeFlux({ type: "HTTP", direction: "provider-to-consumer" })] });
    expect(modelToStructurizr(pushed, null, "carto.xlsx")).not.toContain('relationship "Pulled"');
  });

  it("donne une forme aux types d'acteur qu'il reconnaît, et laisse les autres en boîte", () => {
    const estate = model({
      actorTypes: [
        { type: "Queue", icon: "", nature: "", sheet: "ActorTypes", row: 0 },
        { type: "Chose", icon: "", nature: "", sheet: "ActorTypes", row: 0 },
      ],
    });
    const dsl = modelToStructurizr(estate, null, "carto.xlsx");
    expect(dsl).toMatch(/element "Queue" \{\s*\n\s*shape Pipe/);
    expect(dsl).not.toContain('element "Chose"');
  });

  it("déclare les identifiants hiérarchiques en tête du modèle", () => {
    expect(modelToStructurizr(model(), null, "carto.xlsx")).toContain("!identifiers hierarchical");
  });
});

// --- Les deux DSL étaient fermés en lecture fonctionnelle, au motif qu'un
// schéma fonctionnel n'est pas une architecture C4. Un système qui rend un
// service à un autre est pourtant le cas d'usage central d'un systemLandscape.
// Ce qu'on s'interdit, c'est un fichier qui raconte autre chose que l'écran.
describe("modeleEnStructurizr — la lecture fonctionnelle", () => {
  it("annonce la lecture dans le nom et la description du workspace", () => {
    const dsl = modelToStructurizr(model(), null, "carto.xlsx", null, "functional");
    expect(dsl).toContain("(functional reading)");
    expect(dsl).toContain("chains folded, media removed");
  });

  it("ne l'annonce pas en lecture d'architecture", () => {
    expect(modelToStructurizr(model(), null, "carto.xlsx")).not.toContain("functional reading");
  });
});
