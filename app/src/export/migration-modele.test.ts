import { describe, it, expect } from "vitest";
import * as base from "../testing/fixtures";
import { ETAPES_MISE_A_NIVEAU, donneesDepuisModele, mettreANiveau } from "./migration-modele";
import { écrireModele, LISTES } from "./template-export";
import { parseWorkbook } from "../parsing/workbook";
import { buildModel, VERSION_MODELE, COLONNES_INTERFACES, feuilleFxAttendue } from "../parsing/build-model";
import { runIntegrityChecks } from "../integrity/checks";
import type { ParsedModel } from "../parsing/model";

// Un classeur d'avant le versionnement : les colonnes Version et État n'y
// existent pas, le parseur les a donc lues vides.
function modeleOrigine(): ParsedModel {
  return base.modele({
    acteurs: [
      base.acteur({ nom: "Tatooine", groupe: "Socle", responsable: "Yavin", description: "d", commentaires: "c" }),
      base.acteur({ nom: "Mygeeto", groupe: "Ryloth" }),
    ],
    groupes: [base.groupe({ nom: "Socle" }), base.groupe({ nom: "Ryloth", perimetre: "External" })],
    typesActeur: [base.typeActeur()],
    typesFlux: [base.typeFlux()],
    interfaces: [
      base.iface({
        nomDuFlux: "Authent", acteurExposant: "Tatooine", description: "Ouverture de session",
        lienContrat: "https://c", referenceContrat: "CTR-1", commentaires: "note", aConfirmer: true,
        feuilleAttendue: "FX_Tatooine_HTTP",
      }),
    ],
    consommations: [
      base.conso({
        nomDuFlux: "Authent", acteurConsommateur: "Mygeeto", usage: "Ouverture",
        criticite: "1 - Critical", statut: "Actif", decision: "Keep", feuille: "FX_Tatooine_HTTP",
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
    expect(m.acteurs.map((a) => a.nom).sort()).toEqual(["Mygeeto", "Tatooine"]);
    expect(m.acteurs.find((a) => a.nom === "Tatooine")!.responsable).toBe("Yavin");
    expect(m.groupes.find((g) => g.nom === "Socle")!.perimetre).toBe("Platform");
    expect(m.interfaces).toHaveLength(1);
    expect(m.interfaces[0].acteurExposant).toBe("Tatooine");
    expect(m.interfaces[0].referenceContrat).toBe("CTR-1");
    expect(m.interfaces[0].aConfirmer).toBe(true);
    expect(m.consommations).toHaveLength(1);
    expect(m.consommations[0].acteurConsommateur).toBe("Mygeeto");
    expect(m.consommations[0].criticite).toBe("1 - Critical");
  });

  // Les deux colonnes arrivent vides : la v0 ne sait rien en dire, et inventer
  // un état « Actif » ferait passer pour décidé ce qui ne l'a jamais été.
  it("laisse les nouvelles colonnes vides", () => {
    const résultat = buildModel(parseWorkbook(écrireModele(mettreANiveau(modeleOrigine()))));
    if (!résultat.ok) throw new Error("classeur mis à niveau illisible");
    expect(résultat.model.interfaces[0].version).toBe("");
    expect(résultat.model.interfaces[0].etat).toBe("");
    expect(résultat.model.consommations[0].version).toBe("");
  });

  it("range chaque consommation dans l'onglet dont elle vient", () => {
    const donnees = donneesDepuisModele(modeleOrigine());
    expect(donnees.fx.map((o) => o.nom)).toEqual(["FX_Tatooine_HTTP"]);
    expect(donnees.fx[0].lignes).toHaveLength(1);
  });
});

// Le même, avec ce qu'il disait du temps par ses colonnes État et Statut.
function modeleDate(): ParsedModel {
  return {
    ...modeleOrigine(),
    interfaces: [
      { ...modeleOrigine().interfaces[0], etat: "À décommissionner" },
      { ...modeleOrigine().interfaces[0], nomDuFlux: "Autre", etat: "Retiré" },
      { ...modeleOrigine().interfaces[0], nomDuFlux: "Vivant", etat: "Actif" },
    ],
    consommations: [
      { ...modeleOrigine().consommations[0], statut: "Actif" },
      { ...modeleOrigine().consommations[0], nomDuFlux: "Autre", statut: "En projet" },
      { ...modeleOrigine().consommations[0], nomDuFlux: "Vivant", decision: "À supprimer" },
    ],
  };
}

const LE_JOUR = new Date("2026-08-17T10:00:00Z");

describe("mise à niveau — l'axe des paliers remplace État et Statut", () => {
  it("crée un palier Origin, livré, portant la date de la migration", () => {
    const donnees = mettreANiveau(modeleDate(), LE_JOUR);
    const origin = donnees.paliers.find((p) => p[0] === "Origin")!;
    expect(origin).toBeDefined();
    expect(origin[3]).toBe("Delivered");
    expect(origin[4]).toBe("2026-08-17");
  });

  // Sans ce point d'ancrage, l'arrivée étant obligatoire, le classeur converti
  // s'ouvrirait sur une anomalie de complétude par ligne.
  it("pose Origin comme palier d'arrivée sur chaque ligne existante", () => {
    const r = buildModel(parseWorkbook(écrireModele(mettreANiveau(modeleDate(), LE_JOUR))));
    if (!r.ok) throw new Error("illisible");
    expect(r.model.acteurs.every((a) => a.palierIntroduction === "Origin")).toBe(true);
    expect(r.model.interfaces.filter((i) => i.nomDuFlux !== "Autre").every((i) => i.palierIntroduction === "Origin")).toBe(true);
    // Ce que la v1 déclarait « En projet » arrive plus tard, ce qu'elle
    // déclarait déjà parti vient d'avant : les deux ont leur test dédié.
    expect(r.model.consommations.some((c) => c.palierIntroduction === "Origin")).toBe(true);
  });

  it("convertit ce qui est retiré ou en retrait en palier de retrait", () => {
    const r = buildModel(parseWorkbook(écrireModele(mettreANiveau(modeleDate(), LE_JOUR))));
    if (!r.ok) throw new Error("illisible");
    // Retiré : déjà parti, son retrait est le palier d'origine lui-même.
    expect(r.model.interfaces.find((i) => i.nomDuFlux === "Autre")!.palierRetrait).toBe("Origin");
    // À décommissionner : parti au palier suivant, qui est donc créé.
    const enRetrait = r.model.interfaces.find((i) => i.nomDuFlux === "Authent")!;
    expect(enRetrait.palierRetrait).not.toBe("");
    expect(enRetrait.palierRetrait).not.toBe("Origin");
    expect(r.model.paliers.map((p) => p.nom)).toContain(enRetrait.palierRetrait);
  });

  // « À supprimer » ne dit pas quand la consommation part, seulement qu'elle
  // n'a plus lieu d'être : c'est un jugement, au mieux une alerte de
  // dépréciation. En faire une date inventerait un départ que personne n'a
  // décidé -- la conversion le traduit, elle ne l'avale pas.
  it("garde À supprimer comme décision, sans inventer de retrait", () => {
    const r = buildModel(parseWorkbook(écrireModele(mettreANiveau(modeleDate(), LE_JOUR))));
    if (!r.ok) throw new Error("illisible");
    const àSupprimer = r.model.consommations.find((c) => c.nomDuFlux === "Vivant")!;
    expect(àSupprimer.decision).toBe("Remove");
    expect(àSupprimer.palierRetrait).toBe("");
  });

  it("convertit un statut En projet en arrivée au palier planifié", () => {
    const r = buildModel(parseWorkbook(écrireModele(mettreANiveau(modeleDate(), LE_JOUR))));
    if (!r.ok) throw new Error("illisible");
    const enProjet = r.model.consommations.find((c) => c.nomDuFlux === "Autre")!;
    expect(enProjet.palierIntroduction).not.toBe("Origin");
  });

  // Le classeur converti ne doit se plaindre ni de l'axe qu'on vient de lui
  // poser, ni des colonnes qu'on vient de lui retirer.
  it("ne se plaint ni des paliers ni des colonnes retirées", () => {
    const r = buildModel(parseWorkbook(écrireModele(mettreANiveau(modeleDate(), LE_JOUR))));
    if (!r.ok) throw new Error("illisible");
    const messages = runIntegrityChecks(r.model).familles.flatMap((f) => f.anomalies.map((a) => a.message)).join(" | ");
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
    expect(r.model.paliers.map((p) => p.rang)).toEqual(r.model.paliers.map((_, i) => i + 1));
  });
});

describe("classeur produit — onglets attendus", () => {
  // C'est ce qui remplace la macro : passer un classeur par la migration en
  // ressort un fichier où tout onglet attendu existe, fût-il vide.
  it("crée un onglet pour une interface qui n'a encore aucune consommation", () => {
    const modele: ParsedModel = {
      ...modeleDate(),
      interfaces: [
        { ...modeleDate().interfaces[0], nomDuFlux: "Sans conso", feuilleAttendue: "FX_Tatooine_Kafka", etat: "" },
      ],
      consommations: [],
    };
    const donnees = mettreANiveau(modele, LE_JOUR);
    expect(donnees.fx.map((o) => o.nom)).toContain("FX_Tatooine_Kafka");
    expect(donnees.fx.find((o) => o.nom === "FX_Tatooine_Kafka")!.lignes).toEqual([]);
  });

  // On ne fabrique jamais un classeur qu'Excel refuserait. On y renonçait
  // autrefois en n'écrivant pas l'onglet -- et ses consommations partaient
  // avec lui, sans un mot. Le nom est maintenant ramené à ce qu'Excel accepte.
  it("crée l'onglet sous un nom qu'Excel accepte plutôt que d'y renoncer", () => {
    // Un exposant réellement long : le nom d'onglet est DÉRIVÉ de lui, il ne
    // se pose pas à la main -- c'est bien par là que le problème arrive.
    const long = "Plateforme de règlement-livraison interbancaire";
    const base = modeleDate();
    const modele: ParsedModel = {
      ...base,
      acteurs: [...base.acteurs, { ...base.acteurs[0], nom: long }],
      interfaces: [
        {
          ...base.interfaces[0],
          acteurExposant: long,
          feuilleAttendue: feuilleFxAttendue(long, base.interfaces[0].typeDeFlux),
        },
      ],
      consommations: [],
    };
    // Au niveau du classeur produit, le seul qui compte : l'onglet existe, son
    // nom tient dans la limite, et la relecture retombe exactement dessus.
    const octets = écrireModele(mettreANiveau(modele, LE_JOUR));
    const relu = buildModel(parseWorkbook(octets));
    if (!relu.ok) throw new Error("classeur illisible");
    expect(relu.model.fxSheetNames.every((n) => n.length <= 31)).toBe(true);
    expect(relu.model.fxSheetNames).toContain(relu.model.interfaces[0].feuilleAttendue);
  });

  it("ne double pas un onglet qui porte déjà des consommations", () => {
    const donnees = mettreANiveau(modeleDate(), LE_JOUR);
    const noms = donnees.fx.map((o) => o.nom);
    expect(new Set(noms).size).toBe(noms.length);
  });
});

describe("mise à niveau — le classeur passe en anglais", () => {
  function modeleFrançais(): ParsedModel {
    return {
      ...modeleDate(),
      groupes: [{ nom: "Socle", perimetre: "Plateforme", feuille: "Groups", ligne: 0 }, { nom: "Lothal", perimetre: "Externe", feuille: "Groups", ligne: 0 }],
      typesFlux: [base.typeFlux({ type: "HTTP", sensRepresentationBrut: "consommateur → exposant" })],
      consommations: [{ ...modeleDate().consommations[0], criticite: "1 - Vitale", decision: "À transformer" }],
      interfaces: [{ ...modeleDate().interfaces[0], etat: "" }],
    };
  }

  it("translates the values already entered", () => {
    const r = buildModel(parseWorkbook(écrireModele(mettreANiveau(modeleFrançais(), LE_JOUR))));
    if (!r.ok) throw new Error("illisible");
    expect(r.model.groupes.map((g) => g.perimetre)).toEqual(["Platform", "External"]);
    expect(r.model.typesFlux[0].sensRepresentationBrut).toBe("consumer → provider");
    expect(r.model.paliers[0].statut).toBe("Delivered");
    expect(r.model.consommations[0].criticite).toBe("1 - Critical");
    expect(r.model.consommations[0].decision).toBe("Transform");
  });

  // Un terme propre à l'équipe n'est pas du vocabulaire fermé : on ne l'écrase
  // pas, et le contrôle de vocabulaire le signalera s'il n'a rien à faire là.
  it("leaves a value it does not recognise alone", () => {
    const modele = { ...modeleFrançais(), groupes: [{ nom: "Socle", perimetre: "Zone grise", feuille: "Groups", ligne: 0 }] };
    const r = buildModel(parseWorkbook(écrireModele(mettreANiveau(modele, LE_JOUR))));
    if (!r.ok) throw new Error("illisible");
    expect(r.model.groupes[0].perimetre).toBe("Zone grise");
  });

  // Les référentiels du classeur ne doivent pas être remplacés par l'amorce :
  // les types déclarés par l'équipe survivent à la mise à niveau.
  it("keeps the workbook's own flow types rather than reseeding them", () => {
    const modele = {
      ...modeleFrançais(),
      typesFlux: [base.typeFlux({ type: "Saleucami", sensRepresentationBrut: "consommateur → exposant", description: "Protocole interne" })],
    };
    const r = buildModel(parseWorkbook(écrireModele(mettreANiveau(modele, LE_JOUR))));
    if (!r.ok) throw new Error("illisible");
    expect(r.model.typesFlux.map((t) => t.type)).toContain("Saleucami");
  });
});

// Le v1 est parti en production avant qu'on découvre ses formules cassées. La
// chaîne doit donc le reconnaître comme périmé et le refaire écrire -- sans
// quoi les classeurs déjà distribués gardent leurs liaisons fantômes.
describe("mise à niveau — le v1 déjà distribué", () => {
  function modeleV1(): ParsedModel {
    return { ...modeleOrigine(), versionModele: 1, paliers: [
      { nom: "Origin", rang: 1, libelle: "", statut: "Delivered", date: "", description: "", feuille: "Milestones", ligne: 2 },
    ] };
  }

  it("est reconnu comme périmé par la version courante", () => {
    expect(modeleV1().versionModele).toBeLessThan(VERSION_MODELE);
  });

  it("ressort au format courant, son contenu intact", () => {
    const r = buildModel(parseWorkbook(écrireModele(mettreANiveau(modeleV1(), LE_JOUR))));
    if (!r.ok) throw new Error("illisible");
    expect(r.model.versionModele).toBe(VERSION_MODELE);
    expect(r.model.acteurs.map((a) => a.nom)).toEqual(modeleV1().acteurs.map((a) => a.nom));
    expect(r.model.paliers.map((p) => p.nom)).toEqual(["Origin"]);
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
    expect(r.model.acteurs.map((a) => a.nom)).toEqual(modeleV2().acteurs.map((a) => a.nom));
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
      consommations: [{ ...base.consommations[0], feuille: "FX_TATOOINE_HTTP" }],
      fxSheetNames: ["FX_TATOOINE_HTTP"],
    };
  }

  it("ne produit qu'un onglet, portant les consommations", () => {
    const donnees = donneesDepuisModele(modeleOngletDifferent());
    expect(donnees.fx.map((o) => o.nom)).toEqual(["FX_Tatooine_HTTP"]);
    expect(donnees.fx[0].lignes).toHaveLength(1);
  });

  // Une consommation qui ne se rattache à aucune interface n'a pas d'onglet
  // canonique où aller : la déplacer d'autorité la perdrait.
  it("laisse dans son onglet une consommation rattachée à rien", () => {
    const base = modeleOrigine();
    const donnees = donneesDepuisModele({
      ...base,
      consommations: [{ ...base.consommations[0], nomDuFlux: "Inconnu", feuille: "FX_Ailleurs_HTTP" }],
      fxSheetNames: ["FX_Ailleurs_HTTP"],
    });
    const ailleurs = donnees.fx.find((o) => o.nom === "FX_Ailleurs_HTTP")!;
    expect(ailleurs.lignes).toHaveLength(1);
  });
});

// --- QA : le classeur reconstruit parle anglais depuis le schéma v3, sauf la
// colonne « To confirm », restée en français. La valeur écrite n'appartient
// donc pas à la liste déroulante que le même classeur pose sur cette colonne.
describe("mise à niveau — vocabulaire de la colonne To confirm", () => {
  it("écrit la valeur du vocabulaire courant, pas son ancienne écriture française", () => {
    const donnees = donneesDepuisModele(modeleOrigine());
    const colonne = COLONNES_INTERFACES.indexOf("To confirm");
    expect(LISTES.Confirmation).toContain(donnees.interfaces[0][colonne]);
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
      consommations: [{ ...base.consommations[0], nomDuFlux: "Inconnu", feuille: "FX_TATOOINE_HTTP" }],
      fxSheetNames: ["FX_TATOOINE_HTTP"],
    });
    const noms = donnees.fx.map((o) => o.nom.toLowerCase());
    expect(new Set(noms).size).toBe(noms.length);
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
      groupes: [],
      groupesAbsents: true,
      acteurs: base.acteurs.map((a, i) => ({ ...a, groupe: i === 0 ? "Socle" : "Partenaires" })),
    };
  };

  it("reconstruit les groupes que portent les acteurs", () => {
    const donnees = mettreANiveau(sansOnglet());
    expect(donnees.groupes.map((g) => g[0]).sort()).toEqual(["Partenaires", "Socle"]);
  });

  // Le périmètre ne se devine pas : il reste vide, et la complétude le réclame.
  // Inventer « Platform » rendrait un classeur d'apparence complète et faux.
  it("laisse le périmètre vide plutôt que de l'inventer", () => {
    expect(mettreANiveau(sansOnglet()).groupes.every((g) => g[1] === "")).toBe(true);
  });

  it("ne touche à rien quand l'onglet existe", () => {
    const donnees = mettreANiveau(modeleOrigine());
    expect(donnees.groupes.map((g) => g[0])).toEqual(modeleOrigine().groupes.map((g) => g.nom));
  });
});
