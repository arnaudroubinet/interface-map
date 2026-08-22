import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { migrerClasseurLegacy } from "./legacy-upgrade";
import { writeTemplate } from "./template-export";
import { parseWorkbook } from "../parsing/workbook";
import {
  buildModel,
  COLONNES_INTERFACES,
  COLONNES_FX,
  COLONNES_ACTEURS,
  COLONNES_GROUPES,
  COLONNES_PALIERS,
  COLONNES_TYPESFLUX,
  COLONNES_TYPESACTEUR,
  VERSION_MODELE,
  nomOngletValide,
} from "../parsing/build-model";

// Des classeurs d'origine fabriqués pour le test, et non le fichier d'exemple :
// une conversion qui ne marcherait que sur un fichier connu ne serait qu'une
// transcription déguisée.
function classeurLegacy(
  flows: Record<string, string>[],
  composants: Record<string, string>[] = []
): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(flows), "Flux");
  if (composants.length > 0) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(composants), "Composants");
  }
  return XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
}

// Les lignes produites sont positionnelles : on lit par nom de colonne plutôt
// que par index, sinon toute colonne insérée en amont casse ces tests sans rien
// dire de la conversion elle-même.
const iExposant = COLONNES_INTERFACES.indexOf("Provider");
const iConsommateur = COLONNES_FX.indexOf("Consumer");
const iDecision = COLONNES_FX.indexOf("Decision");

const lien = (o: Partial<Record<string, string>> = {}) => ({
  "Composant source": "Appelant",
  "Composant cible": "Appelé",
  "Type de flux": "HTTP",
  "Nom du flux": "Flux A",
  "Description": "d",
  "Emplacement du contrat": "portail",
  Statut: "A conserver",
  Comments: "",
  ...o,
});

describe("migration depuis le format d'origine", () => {
  // Le cœur de la conversion. Le format d'origine dit « source → cible » ; le
  // format actuel dit « qui expose ». Les deux ne coïncident que selon le sens
  // de représentation du type.
  it("fait exposer la cible quand l'appel va du consommateur vers l'exposant", () => {
    const { donnees } = migrerClasseurLegacy(classeurLegacy([lien({ "Type de flux": "HTTP" })]));
    expect(donnees.interfaces[0][iExposant]).toBe("Appelé");
    expect(donnees.fx[0].name).toBe("FX_Appelé_HTTP");
    expect(donnees.fx[0].rows[0][iConsommateur]).toBe("Appelant");
  });

  it("fait exposer la source quand on représente la poussée du producteur", () => {
    const { donnees } = migrerClasseurLegacy(classeurLegacy([lien({ "Type de flux": "Kafka" })]));
    expect(donnees.interfaces[0][iExposant]).toBe("Appelant");
    expect(donnees.fx[0].rows[0][iConsommateur]).toBe("Appelé");
  });

  // Un type hors référentiel n'a pas de sens connu : on ne l'invente pas, on
  // retombe sur l'appel, et on le signale.
  it("signale un type absent du référentiel, quel qu'il soit", () => {
    const { typesInconnus, donnees } = migrerClasseurLegacy(
      classeurLegacy([lien({ "Type de flux": "AS2" }), lien({ "Type de flux": "Fichier + ESB", "Nom du flux": "B" })])
    );
    expect(typesInconnus.sort()).toEqual(["AS2", "Fichier + ESB"]);
    expect(donnees.interfaces[0][iExposant]).toBe("Appelé");
  });

  // La correspondance se fait contre le vocabulaire actuel, pas contre une
  // table relevée sur un fichier : n'importe quelle casse ou accentuation passe.
  it("retrouve la décision dans le vocabulaire actuel, aux accents près", () => {
    const { donnees } = migrerClasseurLegacy(
      classeurLegacy([
        lien({ Statut: "A supprimer" }),
        lien({ Statut: "à TRANSFORMER", "Nom du flux": "B" }),
        lien({ Statut: "Bidon", "Nom du flux": "C" }),
      ])
    );
    const decisions = donnees.fx.flatMap((o) => o.rows).map((l) => l[iDecision]);
    // « À supprimer » reste une décision : le format d'origine ne dit nulle
    // part quand ce flux part, seulement qu'il n'a plus lieu d'être.
    const retraits = donnees.fx.flatMap((o) => o.rows).map((l) => l[COLONNES_FX.indexOf("Retired at")]);
    expect(retraits.every((r) => r === "")).toBe(true);
    expect(decisions).toContain("Remove");
    expect(decisions).toContain("Transform");
    // Une valeur hors vocabulaire n'est pas devinée : elle reste vide, et la
    // complétude la réclame.
    expect(decisions).toContain("");
  });

  // Dans les fichiers réels, l'onglet Composants n'est pas tenu à jour.
  it("récupère les composants que seuls les flux citent", () => {
    const { donnees, acteursCrees } = migrerClasseurLegacy(
      classeurLegacy([lien({})], [{ Groupe: "G1", Nom: "Déjà là", Description: "d", Commentaires: "" }])
    );
    expect(acteursCrees.sort()).toEqual(["Appelant", "Appelé"]);
    expect(donnees.actors.map((a) => a[0])).toContain("Déjà là");
    // Créés sans groupe : le contrôle d'intégrité le réclamera.
    expect(donnees.actors.find((a) => a[0] === "Appelant")![1]).toBe("");
    expect(donnees.groups).toEqual([["G1", ""]]);
  });

  it("regroupe les consommations d'un même exposant dans un seul onglet", () => {
    const { donnees } = migrerClasseurLegacy(
      classeurLegacy([
        lien({ "Composant source": "A", "Nom du flux": "F1" }),
        lien({ "Composant source": "B", "Nom du flux": "F2" }),
      ])
    );
    expect(donnees.fx).toHaveLength(1);
    expect(donnees.fx[0].rows.map((l) => l[iConsommateur]).sort()).toEqual(["A", "B"]);
  });

  // Excel refuse « / » dans un nom d'onglet. On renonçait alors à l'onglet, et
  // ses consommations partaient avec lui. Le nom est maintenant assaini : le
  // caractère interdit devient un tiret et tout est conservé.
  it("assainit l'onglet qu'Excel refuserait plutôt que d'y renoncer", () => {
    const { donnees } = migrerClasseurLegacy(classeurLegacy([lien({ "Type de flux": "OIDC/SSO" })]));
    expect(donnees.interfaces).toHaveLength(1);
    expect(donnees.fx.map((o) => o.name)).toEqual(["FX_Appelé_OIDC-SSO"]);
  });

  it("refuse un classeur sans feuille Flux", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["rien"]]), "Autre");
    const octets = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
    expect(() => migrerClasseurLegacy(octets)).toThrow(/Flux/);
  });
});

describe("migration legacy — colonnes version et état", () => {
  it("aligns each produced row on the current column count", () => {
    // Un acteur venu de Composants et un autre créé faute d'y figurer : les
    // deux chemins d'écriture des acteurs doivent être couverts.
    const { donnees } = migrerClasseurLegacy(
      classeurLegacy([lien({})], [{ Groupe: "G1", Nom: "Appelant", Description: "d", Commentaires: "" }])
    );
    for (const row of donnees.interfaces) expect(row).toHaveLength(COLONNES_INTERFACES.length);
    for (const tab of donnees.fx) {
      for (const row of tab.rows) expect(row).toHaveLength(COLONNES_FX.length);
    }
    for (const row of donnees.actors) expect(row).toHaveLength(COLONNES_ACTEURS.length);
    for (const row of donnees.groups) expect(row).toHaveLength(COLONNES_GROUPES.length);
    for (const row of donnees.milestones) expect(row).toHaveLength(COLONNES_PALIERS.length);
    for (const row of donnees.flowTypes) expect(row).toHaveLength(COLONNES_TYPESFLUX.length);
    for (const row of donnees.typesActeur) expect(row).toHaveLength(COLONNES_TYPESACTEUR.length);
    // Non vides pour de vrai : sinon les boucles ci-dessus ne vérifient rien.
    expect(donnees.actors.length).toBeGreaterThan(0);
    expect(donnees.groups.length).toBeGreaterThan(0);
    expect(donnees.milestones.length).toBeGreaterThan(0);
  });

  // Le format d'origine ne connaît ni version ni état : on ne les invente pas,
  // §7.4 signalera les manques.
  it("leaves version empty rather than inventing it", () => {
    const { donnees } = migrerClasseurLegacy(classeurLegacy([lien({})]));
    const result = buildModel(parseWorkbook(writeTemplate(donnees)));
    if (!result.ok) throw new Error("classeur migré illisible");
    expect(result.model.interfaces[0].version).toBe("");
    expect(result.model.consumptions[0].version).toBe("");
  });

  it("emits a workbook already at the current schema number", () => {
    const { donnees } = migrerClasseurLegacy(classeurLegacy([lien({})]));
    const result = buildModel(parseWorkbook(writeTemplate(donnees)));
    if (!result.ok) throw new Error("classeur migré illisible");
    expect(result.model.versionModele).toBe(VERSION_MODELE);
  });
});

// La règle qui dit ce qu'Excel accepte comme nom d'onglet est unique
// (build-model.ts), mais deux chemins la consomment séparément : la migration
// decide ici, à l'écriture, s'il crée l'onglet FX_ ; buildModel decide plus
// tard, à la relecture, si l'interface a un onglet valide. On fait passer
// chaque nom par les deux : s'ils se mettaient un jour à diverger, le classeur
// produit porterait une interface que le contrôle d'intégrité réclamerait sur
// un onglet que rien n'aurait jamais pu créer.
describe("nom d'onglet FX_ — la même règle des deux côtés (migration et relecture)", () => {
  // Préfixe fixe pour ce classeur legacy : « FX_Appelé_ » (10 caractères,
  // l'exposant par défaut de lien() étant « Appelé »). Un type de 22
  // caractères pousse donc le nom total à 32 -- un de plus que la limite
  // d'Excel.
  const casHostiles: [string, string][] = [
    ["dépasse 31 caractères", "X".repeat(22)],
    ["porte un « : »", ":"],
    ["porte un « \\ »", "\\"],
    ["porte un « / »", "/"],
    ["porte un « ? »", "?"],
    ["porte un « * »", "*"],
    ["porte un « [ »", "["],
    ["porte un « ] »", "]"],
  ];

  it.each(casHostiles)("crée des deux côtés le même onglet quand le type %s", (_cas, type) => {
    const { donnees } = migrerClasseurLegacy(classeurLegacy([lien({ "Type de flux": type })]));
    expect(donnees.fx).toHaveLength(1);
    expect(nomOngletValide(donnees.fx[0].name)).toBe(true);

    const result = buildModel(parseWorkbook(writeTemplate(donnees)));
    if (!result.ok) throw new Error("classeur migré illisible");
    // Le cœur de l'affaire : l'onglet que l'écriture a créé est exactement
    // celui que la relecture attend, et la consommation a survécu au voyage.
    expect(result.model.interfaces[0].expectedSheet).toBe(donnees.fx[0].name);
    expect(result.model.consumptions).toHaveLength(1);
  });

  it("crée des deux côtés le même onglet pour un nom déjà valide", () => {
    const { donnees } = migrerClasseurLegacy(classeurLegacy([lien({ "Type de flux": "HTTP" })]));
    expect(donnees.fx.map((o) => o.name)).toEqual(["FX_Appelé_HTTP"]);

    const result = buildModel(parseWorkbook(writeTemplate(donnees)));
    if (!result.ok) throw new Error("classeur migré illisible");
    expect(result.model.interfaces[0].expectedSheet).toBe("FX_Appelé_HTTP");
    expect(result.model.consumptions).toHaveLength(1);
  });
});
