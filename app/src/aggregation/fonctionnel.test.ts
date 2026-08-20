import { describe, it, expect } from "vitest";
import { buildFunctionalFlows, chainesCoupees } from "./fonctionnel";
import type { ParsedModel, Acteur, TypeActeur, InterfaceCatalogue, Consommation, Palier } from "../parsing/model";
import { VERSION_MODELE } from "../parsing/build-model";

function acteur(nom: string, typeActeur: string): Acteur {
  return { nom, groupe: "G", typeActeur, responsable: "", description: "", commentaires: "", palierIntroduction: "", palierRetrait: "", feuille: "Actors", ligne: 0 };
}

function iface(nomDuFlux: string, acteurExposant: string, relais = ""): InterfaceCatalogue {
  return {
    nomDuFlux, version: "", etat: "", acteurExposant, typeDeFlux: "HTTP", description: "",
    lienContrat: "", referenceContrat: "", commentaires: "", aConfirmer: false, relais,
    feuilleAttendue: `FX_${acteurExposant}_HTTP`,
    palierIntroduction: "", palierRetrait: "", feuille: "Interfaces", ligne: 0,
  };
}

// Le quatrième argument est la nouveauté de la v4 : la consommation dit sous
// laquelle des interfaces de son consommateur elle est republiée. C'est ce qui
// remplace la case Relais, et ce qu'une liste déroulante peut guider.
function conso(nomDuFlux: string, acteurConsommateur: string, exposant: string, republiePar = ""): Consommation {
  return {
    nomDuFlux, version: "", acteurConsommateur, usage: "", criticite: "", statut: "", decision: "", republiePar,
    commentaires: "", feuille: `FX_${exposant}_HTTP`, palierIntroduction: "", palierRetrait: "", ligne: 0,
  };
}

const TYPES: TypeActeur[] = [
  { type: "Application", icone: "", nature: "Business", feuille: "ActorTypes", ligne: 0 },
  { type: "Middleware", icone: "", nature: "Technical", feuille: "ActorTypes", ligne: 0 },
];

function model(o: Partial<ParsedModel>): ParsedModel {
  return {
    acteurs: [], typesActeur: TYPES, groupes: [], groupesAbsents: false, paliers: [],
    typesFlux: [{ type: "HTTP", sensRepresentation: "consommateur-exposant", sensRepresentationBrut: "consumer → provider", couleur: "", description: "", feuille: "FlowTypes", ligne: 0 }],
    interfaces: [], consommations: [], fxSheetNames: [],
    colonnesOptionnellesAbsentes: [], versionModele: VERSION_MODELE, fichierModifie: null,
    ...o,
  };
}

// Tatooine ─► Bus ─► Naboo, le bus étant technique.
function unRelais(): ParsedModel {
  return model({
    acteurs: [acteur("Tatooine", "Application"), acteur("Bus", "Middleware"), acteur("Naboo", "Application")],
    interfaces: [iface("Transactions", "Tatooine"), iface("trx.norm", "Bus")],
    consommations: [conso("Transactions", "Bus", "Tatooine", "trx.norm"), conso("trx.norm", "Naboo", "Bus")],
  });
}

const PALIERS: Palier[] = [
  { nom: "v1", rang: 1, libelle: "", statut: "Delivered", date: "", description: "", feuille: "Milestones", ligne: 0 },
  { nom: "v2", rang: 2, libelle: "", statut: "Delivered", date: "", description: "", feuille: "Milestones", ligne: 0 },
];

// Alderaan ─► Bus ─► ETL ─► Coruscant, le segment porté par le Bus (cmd.raw) retiré en v2.
function unRelaisAvecSegmentRetire(): ParsedModel {
  const m = model({
    acteurs: [acteur("Alderaan", "Application"), acteur("Bus", "Middleware"), acteur("ETL", "Middleware"), acteur("Coruscant", "Application")],
    interfaces: [iface("Commandes", "Alderaan"), iface("cmd.raw", "Bus"), iface("CMD_D", "ETL")],
    consommations: [conso("Commandes", "Bus", "Alderaan", "cmd.raw"), conso("cmd.raw", "ETL", "Bus", "CMD_D"), conso("CMD_D", "Coruscant", "ETL")],
    paliers: PALIERS,
  });
  m.interfaces[1].palierRetrait = "v2";
  return m;
}

describe("buildFunctionalFlows", () => {
  it("relie la source métier au consommateur métier à travers un relais", () => {
    const flux = buildFunctionalFlows(unRelais(), null);
    expect(flux).toHaveLength(1);
    expect([flux[0].exposant, flux[0].consommateur]).toEqual(["Tatooine", "Naboo"]);
  });

  // Le nom métier est celui que le producteur donne à sa donnée, pas celui du
  // segment technique qui la transporte.
  it("nomme le lien d'après l'interface à la source", () => {
    expect(buildFunctionalFlows(unRelais(), null)[0].interfaceNom).toBe("Transactions");
  });

  // Sans technologie, la clé de fusion des traits n'en tient plus compte.
  it("vide la technologie", () => {
    expect(buildFunctionalFlows(unRelais(), null)[0].typeDeFlux).toBe("");
  });

  it("oriente la flèche du fournisseur vers le consommateur", () => {
    expect(buildFunctionalFlows(unRelais(), null)[0].sens).toBe("exposant-consommateur");
  });

  it("suit une chaîne de longueur quelconque", () => {
    const m = model({
      acteurs: [acteur("Alderaan", "Application"), acteur("Bus", "Middleware"), acteur("ETL", "Middleware"), acteur("Coruscant", "Application")],
      interfaces: [iface("Commandes", "Alderaan"), iface("cmd.raw", "Bus"), iface("CMD_D", "ETL")],
      consommations: [conso("Commandes", "Bus", "Alderaan", "cmd.raw"), conso("cmd.raw", "ETL", "Bus", "CMD_D"), conso("CMD_D", "Coruscant", "ETL")],
    });
    const flux = buildFunctionalFlows(m, null);
    expect(flux).toHaveLength(1);
    expect([flux[0].exposant, flux[0].consommateur]).toEqual(["Alderaan", "Coruscant"]);
  });

  // Le cas qui justifie toute la mécanique : deux flux dans un même bus ne
  // doivent pas se croiser.
  it("ne croise pas deux flux passant par le même bus", () => {
    const m = model({
      acteurs: [acteur("Tatooine", "Application"), acteur("Alderaan", "Application"), acteur("Bus", "Middleware"), acteur("Naboo", "Application"), acteur("Coruscant", "Application")],
      interfaces: [
        iface("Transactions", "Tatooine"), iface("Référentiel", "Alderaan"),
        iface("trx.norm", "Bus"), iface("ref.norm", "Bus"),
      ],
      consommations: [
        conso("Transactions", "Bus", "Tatooine", "trx.norm"), conso("Référentiel", "Bus", "Alderaan", "ref.norm"),
        conso("trx.norm", "Naboo", "Bus"), conso("ref.norm", "Coruscant", "Bus"),
      ],
    });
    const liens = buildFunctionalFlows(m, null).map((f) => `${f.exposant}→${f.consommateur}`).sort();
    expect(liens).toEqual(["Alderaan→Coruscant", "Tatooine→Naboo"]);
  });

  it("produit un lien par consommateur métier en diffusion", () => {
    const m = model({
      acteurs: [acteur("Tatooine", "Application"), acteur("Bus", "Middleware"), acteur("Coruscant", "Application"), acteur("Hoth", "Application")],
      interfaces: [iface("Transactions", "Tatooine"), iface("trx.norm", "Bus")],
      consommations: [conso("Transactions", "Bus", "Tatooine", "trx.norm"), conso("trx.norm", "Coruscant", "Bus"), conso("trx.norm", "Hoth", "Bus")],
    });
    expect(buildFunctionalFlows(m, null).map((f) => f.consommateur).sort()).toEqual(["Coruscant", "Hoth"]);
  });

  it("garde tel quel un échange entre deux acteurs métier", () => {
    const m = model({
      acteurs: [acteur("Tatooine", "Application"), acteur("Mygeeto", "Application")],
      interfaces: [iface("Authent", "Tatooine")],
      consommations: [conso("Authent", "Mygeeto", "Tatooine")],
    });
    const flux = buildFunctionalFlows(m, null);
    expect([flux[0].exposant, flux[0].consommateur]).toEqual(["Tatooine", "Mygeeto"]);
  });

  it("ne produit rien quand rien n'alimente l'interface republiée", () => {
    const m = unRelais();
    m.consommations[0].republiePar = "";
    expect(buildFunctionalFlows(m, null)).toHaveLength(0);
  });

  it("ne produit rien quand la republication désigne une interface inconnue", () => {
    const m = unRelais();
    m.consommations[0].republiePar = "Fantôme";
    expect(buildFunctionalFlows(m, null)).toHaveLength(0);
  });

  // Sans garde, le parcours tournerait indéfiniment.
  it("s'arrête sur une chaîne qui boucle", () => {
    const m = model({
      acteurs: [acteur("Bus", "Middleware"), acteur("ETL", "Middleware"), acteur("Coruscant", "Application")],
      interfaces: [iface("a", "Bus"), iface("b", "ETL")],
      consommations: [conso("a", "Coruscant", "Bus"), conso("b", "Bus", "ETL", "a"), conso("a", "ETL", "Bus", "b")],
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
      acteurs: [acteur("Tatooine", "Application"), acteur("Bus", "Middleware")],
      interfaces: [iface("Transactions", "Tatooine"), iface("trx.norm", "Bus")],
      consommations: [conso("Transactions", "Bus", "Tatooine", "trx.norm"), conso("trx.norm", "Tatooine", "Bus")],
    });
    expect(buildFunctionalFlows(m, null)).toHaveLength(0);
  });
});

describe("chainesCoupees", () => {
  it("nomme l'interface republiée que rien n'alimente", () => {
    const m = unRelais();
    m.consommations[0].republiePar = "";
    const coupées = chainesCoupees(m, null);
    expect(coupées).toHaveLength(1);
    expect(coupées[0].raison).toBe("sans-entree");
    expect(coupées[0].iface.nomDuFlux).toBe("trx.norm");
  });

  it("nomme aussi celle dont la seule entrée désigne une interface inconnue", () => {
    const m = unRelais();
    m.consommations[0].republiePar = "Fantôme";
    expect(chainesCoupees(m, null)[0].raison).toBe("sans-entree");
  });

  it("ne signale rien sur une chaîne entière", () => {
    expect(chainesCoupees(unRelais(), null)).toEqual([]);
  });

  // Rien ne lit conso : le rapport d'intégrité (seul appelant) ne désigne
  // jamais la consommation, seulement l'interface où la chaîne casse.
  it("ne porte pas la consommation, que rien ne lit", () => {
    const m = unRelais();
    m.consommations[0].republiePar = "";
    expect(chainesCoupees(m, null)[0]).not.toHaveProperty("conso");
  });

  // Un segment retiré au palier laisse l'interface republiée sans entrée
  // vivante : c'est exactement la même situation qu'une entrée jamais saisie,
  // et aucun appelant ne distingue les deux.
  it("signale un segment retiré au palier comme une interface sans entrée", () => {
    const coupées = chainesCoupees(unRelaisAvecSegmentRetire(), 2);
    expect(coupées).toHaveLength(1);
    expect(coupées[0].raison).toBe("sans-entree");
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
      paliers: PALIERS,
      acteurs: m.acteurs.map((a) => (a.nom === "Tatooine" ? { ...a, palierRetrait: "v1" } : a)),
    };
  };

  it("ne rend plus un flux dont l'acteur source est retiré", () => {
    const flux = buildFunctionalFlows(avecTatooineRetire(), 1);
    expect(flux.map((f) => f.exposant)).not.toContain("Tatooine");
  });

  it("le rend tant que l'acteur vit", () => {
    const flux = buildFunctionalFlows(avecTatooineRetire(), 0);
    expect(flux.map((f) => f.exposant)).toContain("Tatooine");
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
  const parc = (o: Partial<ParsedModel>) =>
    model({
      acteurs: [acteur("A", "Application"), acteur("B", "Application"), acteur("X", "Middleware"), acteur("C", "Application")],
      ...o,
    });

  // Deux acteurs publient un flux du même nom -- c'est légitime. Le bus n'en
  // consomme qu'un : c'est celui-là, et pas l'autre, qui alimente C.
  it("suit l'exposant de la consommation, pas un homonyme du catalogue", () => {
    const m = parc({
      interfaces: [iface("f0", "A"), iface("f0", "B"), iface("f1", "X")],
      consommations: [conso("f0", "X", "B", "f1"), conso("f1", "C", "X")],
    });
    expect(buildFunctionalFlows(m, null).map((f) => f.exposant)).toEqual(["B"]);
  });

  it("suit la version réellement consommée", () => {
    const m = parc({
      interfaces: [
        { ...iface("f0", "A"), version: "1.0" },
        { ...iface("f0", "A"), version: "2.0" },
        iface("f1", "X"),
      ],
      consommations: [{ ...conso("f0", "X", "A", "f1"), version: "2.0" }, conso("f1", "C", "X")],
    });
    expect(buildFunctionalFlows(m, null).map((f) => f.version)).toEqual(["2.0"]);
  });

  it("laisse passer une chaîne saine à plusieurs sauts", () => {
    const m = model({
      acteurs: [acteur("A", "Application"), acteur("X", "Middleware"), acteur("Y", "Middleware"), acteur("C", "Application")],
      interfaces: [iface("f0", "A"), iface("f1", "X"), iface("f2", "Y")],
      consommations: [conso("f0", "X", "A", "f1"), conso("f1", "Y", "X", "f2"), conso("f2", "C", "Y")],
    });
    expect(buildFunctionalFlows(m, null).map((f) => `${f.exposant}→${f.consommateur}`)).toEqual(["A→C"]);
  });
});

// --- QA : un bus agrège. Il consomme plusieurs flux et les republie sous un
// seul. Porté par la consommation, ce cas ne demande aucune syntaxe : ce sont
// simplement plusieurs lignes qui désignent la même interface.
describe("remontée — un relayeur qui agrège plusieurs sources", () => {
  const parc = (republications: [string, string][]) =>
    model({
      acteurs: [acteur("A", "Application"), acteur("B", "Application"), acteur("X", "Middleware"), acteur("C", "Application")],
      interfaces: [iface("f0", "A"), iface("g0", "B"), iface("f1", "X")],
      consommations: [
        conso("f0", "X", "A", republications[0][1]),
        conso("g0", "X", "B", republications[1][1]),
        conso("f1", "C", "X"),
      ],
    });

  it("suit toutes les entrées republiées sous la même interface", () => {
    const flux = buildFunctionalFlows(parc([["f0", "f1"], ["g0", "f1"]]), null);
    expect(flux.map((f) => `${f.exposant}→${f.consommateur}`).sort()).toEqual(["A→C", "B→C"]);
  });

  it("n'en suit qu'une quand une seule est republiée", () => {
    expect(buildFunctionalFlows(parc([["f0", "f1"], ["g0", ""]]), null).map((f) => f.exposant)).toEqual(["A"]);
  });

  // Deux branches qui remontent à la même source ne font qu'un lien : sans
  // dédoublonnage le trait compterait deux fois le même échange.
  it("ne compte pas deux fois une source atteinte par deux chemins", () => {
    const m = model({
      acteurs: [acteur("A", "Application"), acteur("X", "Middleware"), acteur("Y", "Middleware"), acteur("Z", "Middleware"), acteur("C", "Application")],
      interfaces: [iface("f0", "A"), iface("f1", "X"), iface("f2", "Y"), iface("f3", "Z")],
      consommations: [
        conso("f0", "X", "A", "f1"), conso("f0", "Y", "A", "f2"),
        conso("f1", "Z", "X", "f3"), conso("f2", "Z", "Y", "f3"),
        conso("f3", "C", "Z"),
      ],
    });
    expect(buildFunctionalFlows(m, null)).toHaveLength(1);
  });
});

