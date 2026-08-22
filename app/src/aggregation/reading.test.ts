import { describe, it, expect } from "vitest";
import * as base from "../testing/fixtures";
import { buildFunctionalFlows, chainesCoupees, lectureUnion } from "./reading";
import type { ParsedModel, Actor, ActorType, InterfaceCatalogue, Consumption, Milestone } from "../parsing/model";
import { SCHEMA_VERSION } from "../parsing/build-model";

// Fabriques positionnelles : dans ce fichier ce sont les CHAÎNES qu'on lit, et
// une chaîne se raconte mieux en « qui expose quoi vers qui » qu'en surcharges.
function actor(name: string, actorType: string): Actor {
  return base.actor({ name, actorType });
}

function iface(flowName: string, providerName: string, legacyRelays = ""): InterfaceCatalogue {
  return base.iface({ flowName, providerName, legacyRelays, expectedSheet: `FX_${providerName}_HTTP` });
}

// Le quatrième argument est la nouveauté de la v4 : la consommation dit sous
// laquelle des interfaces de son consommateur elle est republiée. C'est ce qui
// remplace la case Relais, et ce qu'une liste déroulante peut guider.
// Le quatrième argument est la nouveauté de la v4 : la consommation dit sous
// laquelle des interfaces de son consommateur elle est republiée.
function consumption(flowName: string, consumerName: string, provider: string, republishedAs = ""): Consumption {
  return base.consumption({ flowName, consumerName, republishedAs, sheet: `FX_${provider}_HTTP` });
}

const TYPES: ActorType[] = [
  { type: "Application", icon: "", nature: "Business", sheet: "ActorTypes", row: 0 },
  { type: "Middleware", icon: "", nature: "Technical", sheet: "ActorTypes", row: 0 },
];

function model(o: Partial<ParsedModel> = {}): ParsedModel {
  return base.template({ actorTypes: TYPES, flowTypes: [base.typeFlux()], ...o });
}

// Tatooine ─► Bus ─► Naboo, le bus étant technique.
function unRelais(): ParsedModel {
  return model({
    actors: [actor("Tatooine", "Application"), actor("Bus", "Middleware"), actor("Naboo", "Application")],
    interfaces: [iface("Transactions", "Tatooine"), iface("trx.norm", "Bus")],
    consumptions: [consumption("Transactions", "Bus", "Tatooine", "trx.norm"), consumption("trx.norm", "Naboo", "Bus")],
  });
}

const MILESTONES: Milestone[] = [
  { name: "v1", rank: 1, label: "", status: "Delivered", date: "", description: "", sheet: "Milestones", row: 0 },
  { name: "v2", rank: 2, label: "", status: "Delivered", date: "", description: "", sheet: "Milestones", row: 0 },
];

// Alderaan ─► Bus ─► ETL ─► Coruscant, le segment porté par le Bus (cmd.raw) retiré en v2.
function unRelaisAvecSegmentRetire(): ParsedModel {
  const m = model({
    actors: [actor("Alderaan", "Application"), actor("Bus", "Middleware"), actor("ETL", "Middleware"), actor("Coruscant", "Application")],
    interfaces: [iface("Commandes", "Alderaan"), iface("cmd.raw", "Bus"), iface("CMD_D", "ETL")],
    consumptions: [consumption("Commandes", "Bus", "Alderaan", "cmd.raw"), consumption("cmd.raw", "ETL", "Bus", "CMD_D"), consumption("CMD_D", "Coruscant", "ETL")],
    milestones: MILESTONES,
  });
  m.interfaces[1].retiredAt = "v2";
  return m;
}

describe("buildFunctionalFlows", () => {
  it("relie la source métier au consommateur métier à travers un relais", () => {
    const flows = buildFunctionalFlows(unRelais(), null);
    expect(flows).toHaveLength(1);
    expect([flows[0].provider, flows[0].consumer]).toEqual(["Tatooine", "Naboo"]);
  });

  // Le nom métier est celui que le producteur donne à sa donnée, pas celui du
  // segment technique qui la transporte.
  it("nomme le lien d'après l'interface à la source", () => {
    expect(buildFunctionalFlows(unRelais(), null)[0].interfaceName).toBe("Transactions");
  });

  // Sans technologie, la clé de fusion des traits n'en tient plus compte.
  it("vide la technologie", () => {
    expect(buildFunctionalFlows(unRelais(), null)[0].flowType).toBe("");
  });

  it("oriente la flèche du fournisseur vers le consommateur", () => {
    expect(buildFunctionalFlows(unRelais(), null)[0].direction).toBe("provider-to-consumer");
  });

  it("suit une chaîne de longueur quelconque", () => {
    const m = model({
      actors: [actor("Alderaan", "Application"), actor("Bus", "Middleware"), actor("ETL", "Middleware"), actor("Coruscant", "Application")],
      interfaces: [iface("Commandes", "Alderaan"), iface("cmd.raw", "Bus"), iface("CMD_D", "ETL")],
      consumptions: [consumption("Commandes", "Bus", "Alderaan", "cmd.raw"), consumption("cmd.raw", "ETL", "Bus", "CMD_D"), consumption("CMD_D", "Coruscant", "ETL")],
    });
    const flows = buildFunctionalFlows(m, null);
    expect(flows).toHaveLength(1);
    expect([flows[0].provider, flows[0].consumer]).toEqual(["Alderaan", "Coruscant"]);
  });

  // Le cas qui justifie toute la mécanique : deux flux dans un même bus ne
  // doivent pas se croiser.
  it("ne croise pas deux flux passant par le même bus", () => {
    const m = model({
      actors: [actor("Tatooine", "Application"), actor("Alderaan", "Application"), actor("Bus", "Middleware"), actor("Naboo", "Application"), actor("Coruscant", "Application")],
      interfaces: [
        iface("Transactions", "Tatooine"), iface("Référentiel", "Alderaan"),
        iface("trx.norm", "Bus"), iface("ref.norm", "Bus"),
      ],
      consumptions: [
        consumption("Transactions", "Bus", "Tatooine", "trx.norm"), consumption("Référentiel", "Bus", "Alderaan", "ref.norm"),
        consumption("trx.norm", "Naboo", "Bus"), consumption("ref.norm", "Coruscant", "Bus"),
      ],
    });
    const liens = buildFunctionalFlows(m, null).map((f) => `${f.provider}→${f.consumer}`).sort();
    expect(liens).toEqual(["Alderaan→Coruscant", "Tatooine→Naboo"]);
  });

  it("produit un lien par consommateur métier en diffusion", () => {
    const m = model({
      actors: [actor("Tatooine", "Application"), actor("Bus", "Middleware"), actor("Coruscant", "Application"), actor("Hoth", "Application")],
      interfaces: [iface("Transactions", "Tatooine"), iface("trx.norm", "Bus")],
      consumptions: [consumption("Transactions", "Bus", "Tatooine", "trx.norm"), consumption("trx.norm", "Coruscant", "Bus"), consumption("trx.norm", "Hoth", "Bus")],
    });
    expect(buildFunctionalFlows(m, null).map((f) => f.consumer).sort()).toEqual(["Coruscant", "Hoth"]);
  });

  it("garde tel quel un échange entre deux acteurs métier", () => {
    const m = model({
      actors: [actor("Tatooine", "Application"), actor("Mygeeto", "Application")],
      interfaces: [iface("Authent", "Tatooine")],
      consumptions: [consumption("Authent", "Mygeeto", "Tatooine")],
    });
    const flows = buildFunctionalFlows(m, null);
    expect([flows[0].provider, flows[0].consumer]).toEqual(["Tatooine", "Mygeeto"]);
  });

  it("ne produit rien quand rien n'alimente l'interface republiée", () => {
    const m = unRelais();
    m.consumptions[0].republishedAs = "";
    expect(buildFunctionalFlows(m, null)).toHaveLength(0);
  });

  it("ne produit rien quand la republication désigne une interface inconnue", () => {
    const m = unRelais();
    m.consumptions[0].republishedAs = "Fantôme";
    expect(buildFunctionalFlows(m, null)).toHaveLength(0);
  });

  // Sans garde, le parcours tournerait indéfiniment.
  it("s'arrête sur une chaîne qui boucle", () => {
    const m = model({
      actors: [actor("Bus", "Middleware"), actor("ETL", "Middleware"), actor("Coruscant", "Application")],
      interfaces: [iface("a", "Bus"), iface("b", "ETL")],
      consumptions: [consumption("a", "Coruscant", "Bus"), consumption("b", "Bus", "ETL", "a"), consumption("a", "ETL", "Bus", "b")],
    });
    expect(buildFunctionalFlows(m, null)).toHaveLength(0);
  });

  // Le palier s'applique d'abord : une chaîne dont un segment est retiré à ce
  // palier ne produit plus de lien -- c'est ce que la vue Écarts compare.
  it("coupe la chaîne au palier où le segment intermédiaire est retiré", () => {
    const m = unRelaisAvecSegmentRetire();
    expect(buildFunctionalFlows(m, 1)).toHaveLength(1);
    expect(buildFunctionalFlows(m, 2)).toHaveLength(0);
  });

  it("ignore le retrait d'un segment quand aucun palier n'est affiché", () => {
    expect(buildFunctionalFlows(unRelaisAvecSegmentRetire(), null)).toHaveLength(1);
  });

  it("ne trace pas un lien dont la source est le consommateur", () => {
    const m = model({
      actors: [actor("Tatooine", "Application"), actor("Bus", "Middleware")],
      interfaces: [iface("Transactions", "Tatooine"), iface("trx.norm", "Bus")],
      consumptions: [consumption("Transactions", "Bus", "Tatooine", "trx.norm"), consumption("trx.norm", "Tatooine", "Bus")],
    });
    expect(buildFunctionalFlows(m, null)).toHaveLength(0);
  });
});

describe("chainesCoupees", () => {
  it("nomme l'interface republiée que rien n'alimente", () => {
    const m = unRelais();
    m.consumptions[0].republishedAs = "";
    const cut = chainesCoupees(m, null);
    expect(cut).toHaveLength(1);
    expect(cut[0].reason).toBe("no-input");
    expect(cut[0].iface.flowName).toBe("trx.norm");
  });

  it("nomme aussi celle dont la seule entrée désigne une interface inconnue", () => {
    const m = unRelais();
    m.consumptions[0].republishedAs = "Fantôme";
    expect(chainesCoupees(m, null)[0].reason).toBe("no-input");
  });

  it("ne signale rien sur une chaîne entière", () => {
    expect(chainesCoupees(unRelais(), null)).toEqual([]);
  });

  // Rien ne lit conso : le rapport d'intégrité (seul appelant) ne désigne
  // jamais la consommation, seulement l'interface où la chaîne casse.
  it("ne porte pas la consommation, que rien ne lit", () => {
    const m = unRelais();
    m.consumptions[0].republishedAs = "";
    expect(chainesCoupees(m, null)[0]).not.toHaveProperty("conso");
  });

  // Un segment retiré au palier laisse l'interface republiée sans entrée
  // vivante : c'est exactement la même situation qu'une entrée jamais saisie,
  // et aucun appelant ne distingue les deux.
  it("signale un segment retiré au palier comme une interface sans entrée", () => {
    const cut = chainesCoupees(unRelaisAvecSegmentRetire(), 2);
    expect(cut).toHaveLength(1);
    expect(cut[0].reason).toBe("no-input");
  });
});

// --- QA : la remontée vérifiait la vie du SEGMENT amont mais jamais celle de
// l'ACTEUR qui l'expose. Au palier où Tatooine est retiré, la vue fonctionnelle
// dessinait encore « Tatooine ─► Naboo » ; et comme les acteurs rendus
// viennent de lecture(), Tatooine n'y figurait plus et ressortait en boîte de
// groupe -- sans icône, sans type, hors de sa frontière.
describe("remontée — l'acteur source doit vivre au palier, pas seulement son segment", () => {
  const avecTatooineRetire = () => {
    const m = unRelais();
    return {
      ...m,
      milestones: MILESTONES,
      actors: m.actors.map((a) => (a.name === "Tatooine" ? { ...a, retiredAt: "v1" } : a)),
    };
  };

  it("ne rend plus un flux dont l'acteur source est retiré", () => {
    const flows = buildFunctionalFlows(avecTatooineRetire(), 1);
    expect(flows.map((f) => f.provider)).not.toContain("Tatooine");
  });

  it("le rend tant que l'acteur vit", () => {
    const flows = buildFunctionalFlows(avecTatooineRetire(), 0);
    expect(flows.map((f) => f.provider)).toContain("Tatooine");
  });
});

// --- QA : le relais nomme un flux par son nom seul, et la remontée le
// cherchait dans TOUT le catalogue. Or ce que l'acteur technique relaie, il le
// consomme -- et ses consommations disent de qui et en quelle version. Chercher
// ailleurs, c'est deviner, et l'outil devinait mal en silence.
// --- QA : la republication est portée par la LIGNE DE CONSOMMATION, qui seule
// sait de quel fournisseur et de quelle version vient l'entrée. La v3 la
// portait sur la ligne d'interface, sous forme d'un nom de flux cherché dans
// tout le catalogue : elle prenait le premier venu, donc parfois le mauvais
// exposant ou la mauvaise version, en silence.
describe("remontée — l'entrée désigne son fournisseur et sa version", () => {
  const estate = (o: Partial<ParsedModel>) =>
    model({
      actors: [actor("A", "Application"), actor("B", "Application"), actor("X", "Middleware"), actor("C", "Application")],
      ...o,
    });

  // Deux acteurs publient un flux du même nom -- c'est légitime. Le bus n'en
  // consomme qu'un : c'est celui-là, et pas l'autre, qui alimente C.
  it("suit l'exposant de la consommation, pas un homonyme du catalogue", () => {
    const m = estate({
      interfaces: [iface("f0", "A"), iface("f0", "B"), iface("f1", "X")],
      consumptions: [consumption("f0", "X", "B", "f1"), consumption("f1", "C", "X")],
    });
    expect(buildFunctionalFlows(m, null).map((f) => f.provider)).toEqual(["B"]);
  });

  it("suit la version réellement consommée", () => {
    const m = estate({
      interfaces: [
        { ...iface("f0", "A"), version: "1.0" },
        { ...iface("f0", "A"), version: "2.0" },
        iface("f1", "X"),
      ],
      consumptions: [{ ...consumption("f0", "X", "A", "f1"), version: "2.0" }, consumption("f1", "C", "X")],
    });
    expect(buildFunctionalFlows(m, null).map((f) => f.version)).toEqual(["2.0"]);
  });

  it("laisse passer une chaîne saine à plusieurs sauts", () => {
    const m = model({
      actors: [actor("A", "Application"), actor("X", "Middleware"), actor("Y", "Middleware"), actor("C", "Application")],
      interfaces: [iface("f0", "A"), iface("f1", "X"), iface("f2", "Y")],
      consumptions: [consumption("f0", "X", "A", "f1"), consumption("f1", "Y", "X", "f2"), consumption("f2", "C", "Y")],
    });
    expect(buildFunctionalFlows(m, null).map((f) => `${f.provider}→${f.consumer}`)).toEqual(["A→C"]);
  });
});

// --- QA : un bus agrège. Il consomme plusieurs flux et les republie sous un
// seul. Porté par la consommation, ce cas ne demande aucune syntaxe : ce sont
// simplement plusieurs lignes qui désignent la même interface.
describe("remontée — un relayeur qui agrège plusieurs sources", () => {
  const estate = (republications: [string, string][]) =>
    model({
      actors: [actor("A", "Application"), actor("B", "Application"), actor("X", "Middleware"), actor("C", "Application")],
      interfaces: [iface("f0", "A"), iface("g0", "B"), iface("f1", "X")],
      consumptions: [
        consumption("f0", "X", "A", republications[0][1]),
        consumption("g0", "X", "B", republications[1][1]),
        consumption("f1", "C", "X"),
      ],
    });

  it("suit toutes les entrées republiées sous la même interface", () => {
    const flows = buildFunctionalFlows(estate([["f0", "f1"], ["g0", "f1"]]), null);
    expect(flows.map((f) => `${f.provider}→${f.consumer}`).sort()).toEqual(["A→C", "B→C"]);
  });

  it("n'en suit qu'une quand une seule est republiée", () => {
    expect(buildFunctionalFlows(estate([["f0", "f1"], ["g0", ""]]), null).map((f) => f.provider)).toEqual(["A"]);
  });

  // Deux branches qui remontent à la même source ne font qu'un lien : sans
  // dédoublonnage le trait compterait deux fois le même échange.
  it("ne compte pas deux fois une source atteinte par deux chemins", () => {
    const m = model({
      actors: [actor("A", "Application"), actor("X", "Middleware"), actor("Y", "Middleware"), actor("Z", "Middleware"), actor("C", "Application")],
      interfaces: [iface("f0", "A"), iface("f1", "X"), iface("f2", "Y"), iface("f3", "Z")],
      consumptions: [
        consumption("f0", "X", "A", "f1"), consumption("f0", "Y", "A", "f2"),
        consumption("f1", "Z", "X", "f3"), consumption("f2", "Z", "Y", "f3"),
        consumption("f3", "C", "Z"),
      ],
    });
    expect(buildFunctionalFlows(m, null)).toHaveLength(1);
  });
});


// --- §2.4 : le placement se fait sur l'UNION de tous les paliers, puis chaque
// palier n'en montre que son sous-ensemble. Sans cela, trois arêtes de plus
// suffisaient à déplacer les treize mêmes boîtes de 400 px en médiane.
describe("lectureUnion", () => {
  const estate = () =>
    base.template({
      milestones: [base.milestone({ name: "v1", rank: 1 }), base.milestone({ name: "v2", rank: 2 })],
      groups: [base.group({ name: "G" })],
      actorTypes: [base.actorType()],
      flowTypes: [base.typeFlux()],
      fxSheetNames: ["FX_A_HTTP"],
      actors: [
        base.actor({ name: "A", introducedAt: "v1" }),
        base.actor({ name: "B", introducedAt: "v1" }),
        base.actor({ name: "Tardif", introducedAt: "v2" }),
      ],
      interfaces: [base.iface({ flowName: "F", providerName: "A", expectedSheet: "FX_A_HTTP" })],
      consumptions: [
        base.consumption({ flowName: "F", consumerName: "B", sheet: "FX_A_HTTP", introducedAt: "v1", retiredAt: "v2" }),
        base.consumption({ flowName: "F", consumerName: "Tardif", sheet: "FX_A_HTTP", introducedAt: "v2" }),
      ],
    });

  it("réunit les acteurs de tous les paliers, y compris ceux qui arrivent plus tard", () => {
    expect(lectureUnion(estate(), "architecture").actors.map((a) => a.name).sort()).toEqual(["A", "B", "Tardif"]);
  });

  it("réunit les flux de tous les paliers, y compris ceux qui disparaissent", () => {
    const consumers = lectureUnion(estate(), "architecture").flows.map((f) => f.consumer).sort();
    expect(consumers).toEqual(["B", "Tardif"]);
  });

  // Un même flux vivant à deux paliers ne doit pas compter deux fois : la
  // planche placerait deux traits superposés.
  it("ne double pas un flux vivant à plusieurs paliers", () => {
    const m = estate();
    m.consumptions[0].retiredAt = "";
    expect(lectureUnion(m, "architecture").flows).toHaveLength(2);
  });

  // Un classeur sans palier n'a rien à réunir : la lecture ordinaire suffit,
  // et fabriquer une union vide effacerait tout le parc.
  it("retombe sur la lecture ordinaire quand le classeur ne déclare aucun palier", () => {
    const m = base.template({ ...estate(), milestones: [] });
    expect(lectureUnion(m, "architecture").actors).toHaveLength(3);
  });
});
