import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { reparerClasseur } from "./reparation";
import { écrireModele } from "./template-export";
import { DONNEES_EXEMPLE } from "./exemple-donnees";
import { parseWorkbook } from "../parsing/workbook";
import { buildModel, VERSION_MODELE } from "../parsing/build-model";

const LE_JOUR = new Date("2026-08-17T00:00:00Z");

// La forme réelle du format d'origine : feuilles et colonnes en français
// (voir /Exemples/exemple legacy.xlsx). Un classeur écrit avec des intitulés
// anglais ne ressemble à rien que le parseur d'origine reconnaisse -- il faut
// la vraie forme pour exercer réellement la conversion.
function classeurLegacy(): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet([
      {
        "Composant source": "Utapau",
        "Composant cible": "Felucia",
        "Type de flux": "HTTP",
        "Nom du flux": "Checkout",
        "Nom du fichier": "",
        Description: "d",
        "Emplacement du contrat": "contract-url",
        Statut: "A conserver",
        Commentaires: "",
      },
    ]),
    "Flux"
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet([{ Groupe: "G1", Nom: "Utapau", Description: "d", Commentaires: "" }]),
    "Composants"
  );
  return XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
}

// Un classeur d'origine dont rien ne se reconnaît : ni les feuilles, ni les
// colonnes du seul onglet qui pourrait en tenir lieu. C'est le scénario du
// classeur réel « revenu complètement vide, en silence ».
function classeurIrreconnaissable(): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet([{ Source: "Utapau", Target: "Felucia", Type: "HTTP", Name: "Checkout" }]),
    "Flux"
  );
  return XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
}

// Composants se lit, Flux non : les acteurs sortent, aucune interface.
// C'est la variante déguisée du classeur vide -- une liste d'applications
// sans rien entre elles -- plausible pour un format maison qui a dérivé.
function classeurActeursSansInterfaces(): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet([{ Source: "Utapau", Target: "Felucia", Type: "HTTP", Name: "Checkout" }]),
    "Flux"
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet([{ Groupe: "G1", Nom: "Utapau", Description: "d", Commentaires: "" }]),
    "Composants"
  );
  return XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
}

describe("reparerClasseur", () => {
  it("converts a workbook from the original format and reports what it inferred", () => {
    const r = reparerClasseur(classeurLegacy(), LE_JOUR);
    expect(r.rapportLegacy).not.toBeNull();
    expect(r.donnees.acteurs.map((a) => a[0]).sort()).toEqual(["Felucia", "Utapau"]);
    expect(r.donnees.interfaces.map((i) => i[0])).toEqual(["Checkout"]);
    expect(r.donnees.fx).toHaveLength(1);
    expect(r.donnees.fx[0].nom).toBe("FX_Felucia_HTTP");
    expect(r.donnees.fx[0].lignes).toHaveLength(1);
    expect(r.donnees.fx[0].lignes[0][0]).toBe("Checkout");
  });

  // §fondateur : un classeur d'où rien ne se récupère ne doit jamais repartir
  // en silence comme s'il avait été traité -- c'est exactement l'incident
  // survenu avec un classeur réel de cette famille.
  it("throws rather than return a silently empty workbook when nothing at all is recovered", () => {
    expect(() => reparerClasseur(classeurIrreconnaissable(), LE_JOUR)).toThrow();
  });

  // Le seuil est sur les interfaces, pas sur les acteurs : une cartographie
  // d'interfaces sans la moindre interface n'est pas un résultat, même quand
  // des acteurs, eux, se sont bien récupérés.
  it("throws when actors are recovered but not a single interface", () => {
    expect(() => reparerClasseur(classeurActeursSansInterfaces(), LE_JOUR)).toThrow();
  });

  // Un classeur de notre famille n'est pas une conversion : c'est une remise en
  // état, et il n'y a rien à signaler d'inféré.
  it("upgrades one of our own workbooks without a legacy report", () => {
    const r = reparerClasseur(écrireModele(DONNEES_EXEMPLE), LE_JOUR);
    expect(r.rapportLegacy).toBeNull();
    const relu = buildModel(parseWorkbook(écrireModele(r.donnees)));
    if (!relu.ok) throw new Error("illisible");
    expect(relu.model.versionModele).toBe(VERSION_MODELE);
  });

  // C'est ce qui remplace la macro : rendre un fichier où il ne manque aucun
  // onglet, même pour une interface qui n'a pas encore de consommation.
  it("returns a workbook where every expected sheet exists", () => {
    const r = reparerClasseur(écrireModele(DONNEES_EXEMPLE), LE_JOUR);
    const relu = buildModel(parseWorkbook(écrireModele(r.donnees)));
    if (!relu.ok) throw new Error("illisible");
    const attendus = new Set(relu.model.interfaces.map((i) => i.feuilleAttendue));
    for (const attendu of attendus) expect(relu.model.fxSheetNames).toContain(attendu);
  });
});

// --- QA : la forme française du modèle ACTUEL -- à ne pas confondre avec le
// format d'origine, qui décrit un LIEN entre deux composants. Ici les feuilles
// portent déjà le modèle d'aujourd'hui, simplement nommées en français :
// RefActeur, RefTypesActeur, Flux, et une colonne « Usine responsable ». Le
// parseur ne reconnaissait ni ces trois noms d'onglet ni cette colonne, donc il
// rejetait le classeur avant même d'arriver à la traduction des valeurs, que
// l'étape v0→v1 sait pourtant faire depuis toujours.
function classeurFrancais(): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet([{ "Type d'acteur": "Application", "Icône": "app-window" }]),
    "RefTypesActeur"
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet([
      { Nom: "Endor", Groupe: "Socle", "Type d'acteur": "Application", "Usine responsable": "Corellia", Description: "d", Commentaires: "" },
      { Nom: "Chandrila", Groupe: "Socle", "Type d'acteur": "Application", "Usine responsable": "", Description: "d", Commentaires: "" },
    ]),
    "RefActeur"
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet([{ "Type de flux": "HTTP", "Sens de représentation": "consommateur → exposant", Description: "" }]),
    "TypesFlux"
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet([
      { "Nom du flux": "Transactions", Version: "1.0", "Acteur exposant": "Endor", "Type de flux": "HTTP", Description: "d", "Lien contrat": "", "Référence contrat": "", Commentaires: "", "À confirmer": "Non" },
    ]),
    "Flux"
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet([
      { "Flow name": "Transactions", Version: "1.0", Consumer: "Chandrila", Usage: "u", "Criticality for this consumer": "1 - Vitale", Decision: "À conserver", Comments: "" },
    ]),
    "FX_Endor_HTTP"
  );
  return XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
}

describe("classeur au modèle actuel nommé en français", () => {
  it("se lit comme un classeur de la famille, sans passer par la conversion d'origine", () => {
    const réparation = reparerClasseur(classeurFrancais(), LE_JOUR);
    expect(réparation.rapportLegacy).toBeNull();
  });

  it("garde les acteurs, leur responsable et l'interface", () => {
    const relu = buildModel(parseWorkbook(écrireModele(reparerClasseur(classeurFrancais(), LE_JOUR).donnees)));
    expect(relu.ok).toBe(true);
    if (!relu.ok) return;
    expect(relu.model.acteurs.map((a) => a.nom).sort()).toEqual(["Chandrila", "Endor"]);
    expect(relu.model.acteurs.find((a) => a.nom === "Endor")?.responsable).toBe("Corellia");
    expect(relu.model.interfaces.map((i) => i.nomDuFlux)).toEqual(["Transactions"]);
    expect(relu.model.consommations).toHaveLength(1);
  });

  it("traduit les valeurs françaises au passage", () => {
    const relu = buildModel(parseWorkbook(écrireModele(reparerClasseur(classeurFrancais(), LE_JOUR).donnees)));
    if (!relu.ok) return;
    expect(relu.model.consommations[0].decision).toBe("Keep");
    expect(relu.model.consommations[0].criticite).toBe("1 - Critical");
  });
});
