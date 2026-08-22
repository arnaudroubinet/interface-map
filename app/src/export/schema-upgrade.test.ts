import { describe, it, expect } from "vitest";
import * as base from "../testing/fixtures";
import { ETAPES_MISE_A_NIVEAU, donneesDepuisModele, mettreANiveau } from "./schema-upgrade";
import { écrireModele, LISTES } from "./template-export";
import { parseWorkbook } from "../parsing/workbook";
import { buildModel, VERSION_MODELE, COLONNES_INTERFACES, expectedFxSheet } from "../parsing/build-model";
import { runIntegrityChecks } from "../integrity/checks";
import type { ParsedModel } from "../parsing/model";

// Un classeur d'avant le versionnement : les colonnes Version et État n'y
// existent pas, le parseur les a donc lues vides.
function modeleOrigine(): ParsedModel {
  return base.template({
    actors: [
      base.actor({ name: "Tatooine", group: "Socle", responsable: "Yavin", description: "d", commentaires: "c" }),
      base.actor({ name: "Mygeeto", group: "Ryloth" }),
    ],
    groups: [base.group({ name: "Socle" }), base.group({ name: "Ryloth", perimeter: "External" })],
    typesActeur: [base.typeActeur()],
    flowTypes: [base.typeFlux()],
    interfaces: [
      base.iface({
        flowName: "Authent", providerName: "Tatooine", description: "Ouverture de session",
        lienContrat: "https://c", referenceContrat: "CTR-1", commentaires: "note", aConfirmer: true,
        expectedSheet: "FX_Tatooine_HTTP",
      }),
    ],
    consumptions: [
      base.conso({
        flowName: "Authent", consumerName: "Mygeeto", usage: "Ouverture",
        criticality: "1 - Critical", statut: "Actif", decision: "Keep", sheet: "FX_Tatooine_HTTP",
      }),
    ],
    fxSheetNames: ["FX_Tatooine_HTTP"],
    versionModele: 0,
  });
}

describe("chaîne de mise à niveau", () => {
  it("enchaîne les étapes sans trou ni recouvrement, jusqu'à la version courante", () => {
    let attendu = 0;
    for (const étape of ETAPES_MISE_A_NIVEAU) {
      expect(étape.de).toBe(attendu);
      expect(étape.vers).toBe(attendu + 1);
      attendu = étape.vers;
    }
    expect(attendu).toBe(VERSION_MODELE);
  });
});

describe("mise à niveau d'un classeur d'origine", () => {
  it("produit un classeur à la version courante", () => {
    const résultat = buildModel(parseWorkbook(écrireModele(mettreANiveau(modeleOrigine()))));
    if (!résultat.ok) throw new Error("classeur mis à niveau illisible");
    expect(résultat.model.versionModele).toBe(VERSION_MODELE);
  });

  it("conserve acteurs, groupes, interfaces et consommations", () => {
    const résultat = buildModel(parseWorkbook(écrireModele(mettreANiveau(modeleOrigine()))));
    if (!résultat.ok) throw new Error("classeur mis à niveau illisible");
    const m = résultat.model;
    expect(m.actors.map((a) => a.name).sort()).toEqual(["Mygeeto", "Tatooine"]);
    expect(m.actors.find((a) => a.name === "Tatooine")!.responsable).toBe("Yavin");
    expect(m.groups.find((g) => g.name === "Socle")!.perimeter).toBe("Platform");
    expect(m.interfaces).toHaveLength(1);
    expect(m.interfaces[0].providerName).toBe("Tatooine");
    expect(m.interfaces[0].referenceContrat).toBe("CTR-1");
    expect(m.interfaces[0].aConfirmer).toBe(true);
    expect(m.consumptions).toHaveLength(1);
    expect(m.consumptions[0].consumerName).toBe("Mygeeto");
    expect(m.consumptions[0].criticality).toBe("1 - Critical");
  });

  // Les deux colonnes arrivent vides : la v0 ne sait rien en dire, et inventer
  // un état « Actif » ferait passer pour décidé ce qui ne l'a jamais été.
  it("laisse les nouvelles colonnes vides", () => {
    const résultat = buildModel(parseWorkbook(écrireModele(mettreANiveau(modeleOrigine()))));
    if (!résultat.ok) throw new Error("classeur mis à niveau illisible");
    expect(résultat.model.interfaces[0].version).toBe("");
    expect(résultat.model.interfaces[0].etat).toBe("");
    expect(résultat.model.consumptions[0].version).toBe("");
  });

  it("range chaque consommation dans l'onglet dont elle vient", () => {
    const donnees = donneesDepuisModele(modeleOrigine());
    expect(donnees.fx.map((o) => o.name)).toEqual(["FX_Tatooine_HTTP"]);
    expect(donnees.fx[0].rows).toHaveLength(1);
  });
});

// Le même, avec ce qu'il disait du temps par ses colonnes État et Statut.
function modeleDate(): ParsedModel {
  return {
    ...modeleOrigine(),
    interfaces: [
      { ...modeleOrigine().interfaces[0], etat: "À décommissionner" },
      { ...modeleOrigine().interfaces[0], flowName: "Autre", etat: "Retiré" },
      { ...modeleOrigine().interfaces[0], flowName: "Vivant", etat: "Actif" },
    ],
    consumptions: [
      { ...modeleOrigine().consumptions[0], statut: "Actif" },
      { ...modeleOrigine().consumptions[0], flowName: "Autre", statut: "En projet" },
      { ...modeleOrigine().consumptions[0], flowName: "Vivant", decision: "À supprimer" },
    ],
  };
}

const LE_JOUR = new Date("2026-08-17T10:00:00Z");

describe("mise à niveau — l'axe des paliers remplace État et Statut", () => {
  it("crée un palier Origin, livré, portant la date de la migration", () => {
    const donnees = mettreANiveau(modeleDate(), LE_JOUR);
    const origin = donnees.milestones.find((p) => p[0] === "Origin")!;
    expect(origin).toBeDefined();
    expect(origin[3]).toBe("Delivered");
    expect(origin[4]).toBe("2026-08-17");
  });

  // Sans ce point d'ancrage, l'arrivée étant obligatoire, le classeur converti
  // s'ouvrirait sur une anomalie de complétude par ligne.
  it("pose Origin comme palier d'arrivée sur chaque ligne existante", () => {
    const r = buildModel(parseWorkbook(écrireModele(mettreANiveau(modeleDate(), LE_JOUR))));
    if (!r.ok) throw new Error("illisible");
    expect(r.model.actors.every((a) => a.introducedAt === "Origin")).toBe(true);
    expect(r.model.interfaces.filter((i) => i.flowName !== "Autre").every((i) => i.introducedAt === "Origin")).toBe(true);
    // Ce que la v1 déclarait « En projet » arrive plus tard, ce qu'elle
    // déclarait déjà parti vient d'avant : les deux ont leur test dédié.
    expect(r.model.consumptions.some((c) => c.introducedAt === "Origin")).toBe(true);
  });

  it("convertit ce qui est retiré ou en retrait en palier de retrait", () => {
    const r = buildModel(parseWorkbook(écrireModele(mettreANiveau(modeleDate(), LE_JOUR))));
    if (!r.ok) throw new Error("illisible");
    // Retiré : déjà parti, son retrait est le palier d'origine lui-même.
    expect(r.model.interfaces.find((i) => i.flowName === "Autre")!.retiredAt).toBe("Origin");
    // À décommissionner : parti au palier suivant, qui est donc créé.
    const enRetrait = r.model.interfaces.find((i) => i.flowName === "Authent")!;
    expect(enRetrait.retiredAt).not.toBe("");
    expect(enRetrait.retiredAt).not.toBe("Origin");
    expect(r.model.milestones.map((p) => p.name)).toContain(enRetrait.retiredAt);
  });

  // « À supprimer » ne dit pas quand la consommation part, seulement qu'elle
  // n'a plus lieu d'être : c'est un jugement, au mieux une alerte de
  // dépréciation. En faire une date inventerait un départ que personne n'a
  // décidé -- la conversion le traduit, elle ne l'avale pas.
  it("garde À supprimer comme décision, sans inventer de retrait", () => {
    const r = buildModel(parseWorkbook(écrireModele(mettreANiveau(modeleDate(), LE_JOUR))));
    if (!r.ok) throw new Error("illisible");
    const àSupprimer = r.model.consumptions.find((c) => c.flowName === "Vivant")!;
    expect(àSupprimer.decision).toBe("Remove");
    expect(àSupprimer.retiredAt).toBe("");
  });

  it("convertit un statut En projet en arrivée au palier planifié", () => {
    const r = buildModel(parseWorkbook(écrireModele(mettreANiveau(modeleDate(), LE_JOUR))));
    if (!r.ok) throw new Error("illisible");
    const enProjet = r.model.consumptions.find((c) => c.flowName === "Autre")!;
    expect(enProjet.introducedAt).not.toBe("Origin");
  });

  // Le classeur converti ne doit se plaindre ni de l'axe qu'on vient de lui
  // poser, ni des colonnes qu'on vient de lui retirer.
  it("ne se plaint ni des paliers ni des colonnes retirées", () => {
    const r = buildModel(parseWorkbook(écrireModele(mettreANiveau(modeleDate(), LE_JOUR))));
    if (!r.ok) throw new Error("illisible");
    const messages = runIntegrityChecks(r.model).families.flatMap((f) => f.anomalies.map((a) => a.message)).join(" | ");
    expect(messages).not.toContain("palier");
    expect(messages).not.toContain("statut");
    expect(messages).not.toContain("état");
  });
});

// Les rangs doivent se suivre depuis 1 : « Avant » n'est créé que s'il sert,
// et une numérotation qui commence à 2 laisserait croire à un palier perdu.
describe("mise à niveau — numérotation des paliers créés", () => {
  it("numérote sans trou à partir de 1", () => {
    const r = buildModel(parseWorkbook(écrireModele(mettreANiveau(modeleDate(), LE_JOUR))));
    if (!r.ok) throw new Error("illisible");
    expect(r.model.milestones.map((p) => p.rank)).toEqual(r.model.milestones.map((_, i) => i + 1));
  });
});

describe("classeur produit — onglets attendus", () => {
  // C'est ce qui remplace la macro : passer un classeur par la migration en
  // ressort un fichier où tout onglet attendu existe, fût-il vide.
  it("crée un onglet pour une interface qui n'a encore aucune consommation", () => {
    const template: ParsedModel = {
      ...modeleDate(),
      interfaces: [
        { ...modeleDate().interfaces[0], flowName: "Sans conso", expectedSheet: "FX_Tatooine_Kafka", etat: "" },
      ],
      consumptions: [],
    };
    const donnees = mettreANiveau(template, LE_JOUR);
    expect(donnees.fx.map((o) => o.name)).toContain("FX_Tatooine_Kafka");
    expect(donnees.fx.find((o) => o.name === "FX_Tatooine_Kafka")!.rows).toEqual([]);
  });

  // On ne fabrique jamais un classeur qu'Excel refuserait. On y renonçait
  // autrefois en n'écrivant pas l'onglet -- et ses consommations partaient
  // avec lui, sans un mot. Le nom est maintenant ramené à ce qu'Excel accepte.
  it("crée l'onglet sous un nom qu'Excel accepte plutôt que d'y renoncer", () => {
    // Un exposant réellement long : le nom d'onglet est DÉRIVÉ de lui, il ne
    // se pose pas à la main -- c'est bien par là que le problème arrive.
    const long = "Plateforme de règlement-livraison interbancaire";
    const base = modeleDate();
    const template: ParsedModel = {
      ...base,
      actors: [...base.actors, { ...base.actors[0], name: long }],
      interfaces: [
        {
          ...base.interfaces[0],
          providerName: long,
          expectedSheet: expectedFxSheet(long, base.interfaces[0].flowType),
        },
      ],
      consumptions: [],
    };
    // Au niveau du classeur produit, le seul qui compte : l'onglet existe, son
    // nom tient dans la limite, et la relecture retombe exactement dessus.
    const octets = écrireModele(mettreANiveau(template, LE_JOUR));
    const relu = buildModel(parseWorkbook(octets));
    if (!relu.ok) throw new Error("classeur illisible");
    expect(relu.model.fxSheetNames.every((n) => n.length <= 31)).toBe(true);
    expect(relu.model.fxSheetNames).toContain(relu.model.interfaces[0].expectedSheet);
  });

  it("ne double pas un onglet qui porte déjà des consommations", () => {
    const donnees = mettreANiveau(modeleDate(), LE_JOUR);
    const names = donnees.fx.map((o) => o.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("mise à niveau — le classeur passe en anglais", () => {
  function modeleFrançais(): ParsedModel {
    return {
      ...modeleDate(),
      groups: [{ name: "Socle", perimeter: "Plateforme", sheet: "Groups", row: 0 }, { name: "Lothal", perimeter: "Externe", sheet: "Groups", row: 0 }],
      flowTypes: [base.typeFlux({ type: "HTTP", sensRepresentationBrut: "consommateur → exposant" })],
      consumptions: [{ ...modeleDate().consumptions[0], criticality: "1 - Vitale", decision: "À transformer" }],
      interfaces: [{ ...modeleDate().interfaces[0], etat: "" }],
    };
  }

  it("translates the values already entered", () => {
    const r = buildModel(parseWorkbook(écrireModele(mettreANiveau(modeleFrançais(), LE_JOUR))));
    if (!r.ok) throw new Error("illisible");
    expect(r.model.groups.map((g) => g.perimeter)).toEqual(["Platform", "External"]);
    expect(r.model.flowTypes[0].sensRepresentationBrut).toBe("consumer → provider");
    expect(r.model.milestones[0].statut).toBe("Delivered");
    expect(r.model.consumptions[0].criticality).toBe("1 - Critical");
    expect(r.model.consumptions[0].decision).toBe("Transform");
  });

  // Un terme propre à l'équipe n'est pas du vocabulaire fermé : on ne l'écrase
  // pas, et le contrôle de vocabulaire le signalera s'il n'a rien à faire là.
  it("leaves a value it does not recognise alone", () => {
    const template = { ...modeleFrançais(), groups: [{ name: "Socle", perimeter: "Zone grise", sheet: "Groups", row: 0 }] };
    const r = buildModel(parseWorkbook(écrireModele(mettreANiveau(template, LE_JOUR))));
    if (!r.ok) throw new Error("illisible");
    expect(r.model.groups[0].perimeter).toBe("Zone grise");
  });

  // Les référentiels du classeur ne doivent pas être remplacés par l'amorce :
  // les types déclarés par l'équipe survivent à la mise à niveau.
  it("keeps the workbook's own flow types rather than reseeding them", () => {
    const template = {
      ...modeleFrançais(),
      flowTypes: [base.typeFlux({ type: "Saleucami", sensRepresentationBrut: "consommateur → exposant", description: "Protocole interne" })],
    };
    const r = buildModel(parseWorkbook(écrireModele(mettreANiveau(template, LE_JOUR))));
    if (!r.ok) throw new Error("illisible");
    expect(r.model.flowTypes.map((t) => t.type)).toContain("Saleucami");
  });
});

// Le v1 est parti en production avant qu'on découvre ses formules cassées. La
// chaîne doit donc le reconnaître comme périmé et le refaire écrire -- sans
// quoi les classeurs déjà distribués gardent leurs liaisons fantômes.
describe("mise à niveau — le v1 déjà distribué", () => {
  function modeleV1(): ParsedModel {
    return { ...modeleOrigine(), versionModele: 1, milestones: [
      { name: "Origin", rank: 1, label: "", statut: "Delivered", date: "", description: "", sheet: "Milestones", row: 2 },
    ] };
  }

  it("est reconnu comme périmé par la version courante", () => {
    expect(modeleV1().versionModele).toBeLessThan(VERSION_MODELE);
  });

  it("ressort au format courant, son contenu intact", () => {
    const r = buildModel(parseWorkbook(écrireModele(mettreANiveau(modeleV1(), LE_JOUR))));
    if (!r.ok) throw new Error("illisible");
    expect(r.model.versionModele).toBe(VERSION_MODELE);
    expect(r.model.actors.map((a) => a.name)).toEqual(modeleV1().actors.map((a) => a.name));
    expect(r.model.milestones.map((p) => p.name)).toEqual(["Origin"]);
  });

  // L'étape v1 → v2 ne touche pas au modèle : tout le bénéfice est dans la
  // réécriture. Le vérifier empêche d'y glisser une transformation par erreur.
  it("ne transforme rien dans le modèle lui-même", () => {
    const avant = modeleV1();
    const étape = ETAPES_MISE_A_NIVEAU.find((e) => e.de === 1)!;
    expect(étape.appliquer(avant, { dateMigration: LE_JOUR })).toBe(avant);
  });
});

describe("mise à niveau — le v2 déjà distribué", () => {
  function modeleV2(): ParsedModel {
    return { ...modeleOrigine(), versionModele: 2 };
  }

  it("est reconnu comme périmé", () => {
    expect(modeleV2().versionModele).toBeLessThan(VERSION_MODELE);
  });

  it("ressort au format courant, son contenu intact", () => {
    const r = buildModel(parseWorkbook(écrireModele(mettreANiveau(modeleV2(), LE_JOUR))));
    if (!r.ok) throw new Error("illisible");
    expect(r.model.versionModele).toBe(VERSION_MODELE);
    expect(r.model.actors.map((a) => a.name)).toEqual(modeleV2().actors.map((a) => a.name));
  });

  it("ne transforme rien dans le modèle lui-même", () => {
    const avant = modeleV2();
    const étape = ETAPES_MISE_A_NIVEAU.find((e) => e.de === 2)!;
    expect(étape.appliquer(avant, { dateMigration: LE_JOUR })).toBe(avant);
  });
});

// Un classeur tenu à la main nomme rarement ses onglets au caractère près. Le
// parseur le tolère -- il rattache la consommation à son interface malgré la
// casse -- mais la réécriture, elle, rangeait les interfaces sous le nom
// reconstruit et les consommations sous le nom d'origine. Un seul onglet en
// ressortait en deux : un neuf et vide, et l'ancien devenu orphelin.
describe("mise à niveau — onglet nommé autrement que reconstruit", () => {
  function modeleOngletDifferent(): ParsedModel {
    const base = modeleOrigine();
    return {
      ...base,
      // L'onglet réel s'écrit FX_TATOOINE_HTTP, le nom reconstruit FX_Tatooine_HTTP.
      consumptions: [{ ...base.consumptions[0], sheet: "FX_TATOOINE_HTTP" }],
      fxSheetNames: ["FX_TATOOINE_HTTP"],
    };
  }

  it("ne produit qu'un onglet, portant les consommations", () => {
    const donnees = donneesDepuisModele(modeleOngletDifferent());
    expect(donnees.fx.map((o) => o.name)).toEqual(["FX_Tatooine_HTTP"]);
    expect(donnees.fx[0].rows).toHaveLength(1);
  });

  // Une consommation qui ne se rattache à aucune interface n'a pas d'onglet
  // canonique où aller : la déplacer d'autorité la perdrait.
  it("laisse dans son onglet une consommation rattachée à rien", () => {
    const base = modeleOrigine();
    const donnees = donneesDepuisModele({
      ...base,
      consumptions: [{ ...base.consumptions[0], flowName: "Inconnu", sheet: "FX_Ailleurs_HTTP" }],
      fxSheetNames: ["FX_Ailleurs_HTTP"],
    });
    const ailleurs = donnees.fx.find((o) => o.name === "FX_Ailleurs_HTTP")!;
    expect(ailleurs.rows).toHaveLength(1);
  });
});

// --- QA : le classeur reconstruit parle anglais depuis le schéma v3, sauf la
// colonne « To confirm », restée en français. La valeur écrite n'appartient
// donc pas à la liste déroulante que le même classeur pose sur cette colonne.
describe("mise à niveau — vocabulaire de la colonne To confirm", () => {
  it("écrit la valeur du vocabulaire courant, pas son ancienne écriture française", () => {
    const donnees = donneesDepuisModele(modeleOrigine());
    const column = COLONNES_INTERFACES.indexOf("To confirm");
    expect(LISTES.Confirmation).toContain(donnees.interfaces[0][column]);
  });
});

// --- QA : deux onglets FX_ dont les noms ne diffèrent que par la casse. Excel
// n'accepte pas deux feuilles homonymes à la casse près : il refuse d'ouvrir
// le fichier. Le cas se produit dès qu'une consommation orpheline vit dans un
// onglet tenu à la main (« FX_TATOOINE_HTTP ») alors qu'une interface fait
// attendre l'onglet reconstruit (« FX_Tatooine_HTTP »).
describe("mise à niveau — onglets homonymes à la casse près", () => {
  it("ne produit pas deux onglets qui ne diffèrent que par la casse", () => {
    const base = modeleOrigine();
    const donnees = donneesDepuisModele({
      ...base,
      consumptions: [{ ...base.consumptions[0], flowName: "Inconnu", sheet: "FX_TATOOINE_HTTP" }],
      fxSheetNames: ["FX_TATOOINE_HTTP"],
    });
    const names = donnees.fx.map((o) => o.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
  });
});

// --- QA : un classeur d'une version PLUS RÉCENTE que l'outil ne traversait
// aucune étape et ressortait étiqueté à la version de l'outil. Rien ne peut le
// produire aujourd'hui, la v3 étant la dernière ; le jour où une v4 circulera,
// une version antérieure de l'outil la rétrograderait en silence, en perdant
// tout ce que le parseur d'alors ne sait pas lire.
describe("mise à niveau — classeur plus récent que l'outil", () => {
  it("refuse de rétrograder plutôt que de réécrire en silence", () => {
    const futur = { ...modeleOrigine(), versionModele: VERSION_MODELE + 1 };
    expect(() => mettreANiveau(futur)).toThrow(/newer|récent/i);
  });

  it("laisse passer un classeur à la version de l'outil", () => {
    expect(() => mettreANiveau({ ...modeleOrigine(), versionModele: VERSION_MODELE })).not.toThrow();
  });
});

// --- QA : un classeur d'origine peut n'avoir aucun onglet de groupes, la
// colonne « Groupe » de ses acteurs portant seule l'information. La
// reconstruction écrivait alors model.groupes, vide, et les groupes
// disparaissaient : sur un classeur réel, dix-neuf groupes perdus, et autant
// d'acteurs renvoyant à un groupe qui n'existe plus.
describe("mise à niveau — classeur sans onglet de groupes", () => {
  const sansOnglet = () => {
    const base = modeleOrigine();
    return {
      ...base,
      groups: [],
      groupesAbsents: true,
      actors: base.actors.map((a, i) => ({ ...a, group: i === 0 ? "Socle" : "Partenaires" })),
    };
  };

  it("reconstruit les groupes que portent les acteurs", () => {
    const donnees = mettreANiveau(sansOnglet());
    expect(donnees.groups.map((g) => g[0]).sort()).toEqual(["Partenaires", "Socle"]);
  });

  // Le périmètre ne se devine pas : il reste vide, et la complétude le réclame.
  // Inventer « Platform » rendrait un classeur d'apparence complète et faux.
  it("laisse le périmètre vide plutôt que de l'inventer", () => {
    expect(mettreANiveau(sansOnglet()).groups.every((g) => g[1] === "")).toBe(true);
  });

  it("ne touche à rien quand l'onglet existe", () => {
    const donnees = mettreANiveau(modeleOrigine());
    expect(donnees.groups.map((g) => g[0])).toEqual(modeleOrigine().groups.map((g) => g.name));
  });
});

// --- QA : la v3 portait la lecture fonctionnelle sur la LIGNE D'INTERFACE,
// dans une colonne « Relays » qui nommait plusieurs flux d'entrée. La v4 la
// porte sur la consommation. Ce qui se retrouve est déplacé ; ce qui ne se
// retrouve pas disparaissait de la conversion sans un mot, et le classeur
// converti ne disait plus nulle part qu'un relais avait été déclaré.
describe("mise à niveau — les relais de la v3", () => {
  const modeleV3 = (relais: string): ParsedModel => {
    const b = modeleOrigine();
    return {
      ...b,
      versionModele: 3,
      milestones: [base.milestone({ name: "v1", rank: 1 })],
      actors: [...b.actors, base.actor({ name: "Bus", group: "Socle" })],
      interfaces: [
        ...b.interfaces,
        base.iface({
          flowName: "Republié", version: "1.0", providerName: "Bus",
          expectedSheet: "FX_Bus_HTTP", commentaires: "note", relais,
        }),
      ],
      consumptions: [
        ...b.consumptions,
        base.conso({ flowName: "Authent", consumerName: "Bus", sheet: "FX_Tatooine_HTTP" }),
      ],
      fxSheetNames: ["FX_Tatooine_HTTP", "FX_Bus_HTTP"],
    };
  };

  const relire = (m: ParsedModel) => {
    const relu = buildModel(parseWorkbook(écrireModele(mettreANiveau(m, LE_JOUR))));
    if (!relu.ok) throw new Error("classeur illisible");
    return relu.model;
  };

  it("porte le relais sur la consommation qu'il désignait", () => {
    const m = relire(modeleV3("Authent"));
    const input = m.consumptions.find((c) => c.consumerName === "Bus")!;
    expect(input.republishedAs).toBe("Republié 1.0");
  });

  it("garde dans le classeur le relais qu'il n'a pas su placer", () => {
    const m = relire(modeleV3("Introuvable"));
    expect(m.consumptions.every((c) => c.republishedAs === "")).toBe(true);
    const iface = m.interfaces.find((i) => i.flowName === "Republié")!;
    expect(iface.commentaires).toContain("note");
    expect(iface.commentaires).toContain("Introuvable");
  });
});
