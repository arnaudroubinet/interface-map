import { describe, it, expect } from "vitest";
import { buildModel, COLONNES_FX, feuilleFxAttendue, nomOngletValide } from "./build-model";
import type { ParsedWorkbook, RawSheet } from "./model";

function wb(sheets: RawSheet[]): ParsedWorkbook {
  return { sheets, fichierModifie: null };
}

// Les vrais en-têtes viennent de la ligne 1 de la feuille, pas des lignes de
// données (voir RawSheet.headers) ; pour une fixture de test avec au moins
// une ligne, l'union de ses clés est un équivalent fidèle.
function sheet(name: string, rows: Record<string, string>[], headers?: string[]): RawSheet {
  return {
    name,
    headers: headers ?? [...new Set(rows.flatMap((r) => Object.keys(r)))],
    rows: rows.map((valeurs, i) => ({ ligne: i + 2, valeurs })),
  };
}

const acteursOk: RawSheet = sheet("Actors", [
  { Name: "Tatooine", Group: "Socle", "Perimeter": "Platform", "Actor type": "Application", Status: "Actif", Owner: "", Description: "", Comments: "" },
  { Name: "Mygeeto", Group: "Ryloth", "Perimeter": "External", "Actor type": "Application", Status: "Actif", Owner: "", Description: "", Comments: "" },
]);

const typesFluxOk: RawSheet = sheet("FlowTypes", [
  { "Flow type": "HTTP", "Direction": "consumer → provider", Description: "" },
  { "Flow type": "Kafka", "Direction": "provider → consumer", Description: "" },
]);

const interfacesOk: RawSheet = sheet("Interfaces", [
  { "Flow name": "Authent", "Provider": "Tatooine", "Flow type": "HTTP", Description: "Ouverture de session", "Contract link": "", "Contract reference": "MOD1", Comments: "", "To confirm": "" },
]);

const fxTatooineHttp: RawSheet = sheet("FX_Tatooine_HTTP", [
  { "Flow name": "Authent", "Consumer": "Mygeeto", Usage: "Ouverture", "Criticality for this consumer": "1 - Critical", Status: "Actif", "Decision": "Keep", Comments: "" },
]);

describe("buildModel — happy path", () => {
  it("builds the referential, catalog and consumptions", () => {
    const result = buildModel(wb([acteursOk, typesFluxOk, interfacesOk, fxTatooineHttp]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.acteurs).toHaveLength(2);
    expect(result.model.typesFlux).toHaveLength(2);
    expect(result.model.interfaces).toHaveLength(1);
    expect(result.model.interfaces[0].feuilleAttendue).toBe("FX_Tatooine_HTTP");
    expect(result.model.consommations).toHaveLength(1);
    expect(result.model.consommations[0].feuille).toBe("FX_Tatooine_HTTP");
    expect(result.model.fxSheetNames).toEqual(["FX_Tatooine_HTTP"]);
  });

  it("matches sheet names case/accent-insensitively", () => {
    const result = buildModel(
      wb([
        { ...acteursOk, name: "acteurs" },
        { ...typesFluxOk, name: "TYPESFLUX" },
        interfacesOk,
      ])
    );
    expect(result.ok).toBe(true);
  });

  it("ignores FX_Modèle as a consumption sheet", () => {
    const modele: RawSheet = { name: "FX_Modèle", headers: [], rows: [] };
    const result = buildModel(wb([acteursOk, typesFluxOk, interfacesOk, fxTatooineHttp, modele]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.fxSheetNames).toEqual(["FX_Tatooine_HTTP"]);
  });

  it("drops rows with no content in any expected column", () => {
    const withBlankRow: RawSheet = {
      ...acteursOk,
      rows: [
        ...acteursOk.rows,
        { ligne: 4, valeurs: { Name: "", Group: "", "Perimeter": "", "Actor type": "", Status: "", Owner: "", Description: "", Comments: "" } },
      ],
    };
    const result = buildModel(wb([withBlankRow, typesFluxOk, interfacesOk]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.acteurs).toHaveLength(2);
  });

  // L'intention n'a pas changé -- ne jamais laisser un nom qu'Excel refuse
  // atteindre le classeur -- mais le moyen, si : on l'assainit à la source au
  // lieu de le marquer invalide et de le jeter à l'écriture, ce qui emportait
  // les consommations de l'onglet sans un mot.
  it("keeps a reconstructed FX_ name within what Excel accepts, however long the flow type", () => {
    const longType: RawSheet = sheet("FlowTypes", [
      { "Flow type": "Un type de flux vraiment beaucoup trop long", "Direction": "consumer → provider", Description: "" },
    ]);
    const longInterfaces: RawSheet = sheet("Interfaces", [
      { "Flow name": "X", "Provider": "Tatooine", "Flow type": "Un type de flux vraiment beaucoup trop long", Description: "", "Contract link": "", "Contract reference": "", Comments: "", "To confirm": "" },
    ]);
    const result = buildModel(wb([acteursOk, longType, longInterfaces]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const attendue = result.model.interfaces[0].feuilleAttendue;
    expect(attendue.length).toBeLessThanOrEqual(31);
    expect(nomOngletValide(attendue)).toBe(true);
  });

  it("tracks non-key columns missing from a sheet's header row", () => {
    const acteursNoGroupe: RawSheet = sheet("Actors", [{ Name: "Tatooine" }]);
    const result = buildModel(wb([acteursNoGroupe, typesFluxOk, interfacesOk]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.colonnesOptionnellesAbsentes).toContainEqual({ feuille: "Actors", colonne: "Group" });
  });

  it("does not report every column missing on a present-but-empty FX_ tab (freshly generated by the macro, §12)", () => {
    const fxVide: RawSheet = { name: "FX_Bespin_OIDC-SSO", headers: [...COLONNES_FX], rows: [] };
    const result = buildModel(wb([acteursOk, typesFluxOk, interfacesOk, fxVide]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.colonnesOptionnellesAbsentes.filter((c) => c.feuille === "FX_Bespin_OIDC-SSO")).toHaveLength(0);
  });
});

describe("buildModel — blocking errors", () => {
  it("blocks when a structuring sheet is missing", () => {
    const result = buildModel(wb([acteursOk, typesFluxOk]));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.erreurs.some((e) => e.message.includes("Interfaces"))).toBe(true);
  });

  it("blocks when a key column is missing", () => {
    const acteursSansNom: RawSheet = sheet("Actors", [{ Group: "Socle" }]);
    const result = buildModel(wb([acteursSansNom, typesFluxOk, interfacesOk]));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.erreurs.some((e) => e.message.includes("Name"))).toBe(true);
  });

  it("reports every blocking cause at once", () => {
    const result = buildModel(wb([]));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.erreurs).toHaveLength(3);
  });

  it("reports a present sheet's missing key column even when a different sheet is absent entirely", () => {
    const acteursSansNom: RawSheet = sheet("Actors", [{ Group: "Socle" }]);
    const result = buildModel(wb([acteursSansNom, typesFluxOk]));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.erreurs.some((e) => e.message.includes("Interfaces"))).toBe(true);
    expect(result.erreurs.some((e) => e.message.includes("Name") && e.message.includes("Actors"))).toBe(true);
  });
});

describe("buildModel — version et état d'interface", () => {
  it("reads the Version and État columns of an interface", () => {
    const interfaces = sheet("Interfaces", [
      { "Flow name": "Authent", Version: "1.0", "État": "À décommissionner", "Provider": "Tatooine", "Flow type": "HTTP" },
    ]);
    const result = buildModel(wb([acteursOk, typesFluxOk, interfaces]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.interfaces[0].version).toBe("1.0");
    expect(result.model.interfaces[0].etat).toBe("À décommissionner");
  });

  it("reads the Version column of a consumption", () => {
    const fx = sheet("FX_Tatooine_HTTP", [
      { "Flow name": "Authent", Version: "2.0", "Consumer": "Mygeeto", Status: "Actif", "Decision": "Keep" },
    ]);
    const result = buildModel(wb([acteursOk, typesFluxOk, interfacesOk, fx]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.consommations[0].version).toBe("2.0");
  });

  // Une version vide est une version, pas une absence : c'est ce qui laisse les
  // classeurs antérieurs se rattacher exactement comme avant.
  it("leaves version empty rather than absent when the column is missing", () => {
    const result = buildModel(wb([acteursOk, typesFluxOk, interfacesOk, fxTatooineHttp]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.interfaces[0].version).toBe("");
    expect(result.model.consommations[0].version).toBe("");
  });
});

describe("buildModel — numéro de schéma du classeur", () => {
  it("reads the schema number from the hidden Version sheet", () => {
    const version = sheet("Version", [{ "Model version": "1" }]);
    const result = buildModel(wb([acteursOk, typesFluxOk, interfacesOk, version]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.versionModele).toBe(1);
  });

  // Tous les classeurs produits avant cette évolution.
  it("treats a workbook without the sheet as version 0", () => {
    const result = buildModel(wb([acteursOk, typesFluxOk, interfacesOk]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.versionModele).toBe(0);
  });

  it("falls back to 0 on an unreadable schema number", () => {
    const version = sheet("Version", [{ "Model version": "n'importe quoi" }]);
    const result = buildModel(wb([acteursOk, typesFluxOk, interfacesOk, version]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.versionModele).toBe(0);
  });

  it("does not mistake the Version sheet for a consumption sheet", () => {
    const version = sheet("Version", [{ "Model version": "1" }]);
    const result = buildModel(wb([acteursOk, typesFluxOk, interfacesOk, version]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.fxSheetNames).toEqual([]);
  });
});

const paliersOk: RawSheet = sheet("Milestones", [
  { Milestone: "v1", Rank: "1", "Label": "Socle initial", Status: "Delivered", Date: "2026-01-15", Description: "" },
  { Milestone: "v2", Rank: "2", "Label": "Ouverture partenaires", Status: "Delivered", Date: "2026-06-01", Description: "" },
  { Milestone: "v3", Rank: "3", "Label": "Temps réel", Status: "Planned", Date: "", Description: "" },
]);

describe("buildModel — onglet Paliers", () => {
  it("reads the declared paliers with their rank and status", () => {
    const result = buildModel(wb([acteursOk, typesFluxOk, interfacesOk, paliersOk]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.paliers.map((p) => p.nom)).toEqual(["v1", "v2", "v3"]);
    expect(result.model.paliers[1].rang).toBe(2);
    expect(result.model.paliers[2].statut).toBe("Planned");
  });

  // L'ordre vient du rang, pas de l'ordre des lignes : un tri dans Excel
  // détruirait un ordre implicite sans rien dire.
  it("orders by rank, not by row order", () => {
    const désordre: RawSheet = sheet("Milestones", [
      { Milestone: "v3", Rank: "3", Status: "Planned" },
      { Milestone: "v1", Rank: "1", Status: "Delivered" },
      { Milestone: "v2", Rank: "2", Status: "Delivered" },
    ]);
    const result = buildModel(wb([acteursOk, typesFluxOk, interfacesOk, désordre]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.paliers.map((p) => p.nom)).toEqual(["v1", "v2", "v3"]);
  });

  it("leaves the list empty when the sheet is absent", () => {
    const result = buildModel(wb([acteursOk, typesFluxOk, interfacesOk]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.paliers).toEqual([]);
  });
});

describe("buildModel — colonnes de validité", () => {
  it("reads the introduction and retirement paliers of an acteur", () => {
    const acteurs: RawSheet = sheet("Actors", [
      { Name: "Tatooine", Group: "Socle", "Introduced at": "v1", "Retired at": "v3" },
    ]);
    const result = buildModel(wb([acteurs, typesFluxOk, interfacesOk, paliersOk]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.acteurs[0].palierIntroduction).toBe("v1");
    expect(result.model.acteurs[0].palierRetrait).toBe("v3");
  });

  it("reads them on an interface and on a consumption", () => {
    const interfaces: RawSheet = sheet("Interfaces", [
      { "Flow name": "Authent", "Provider": "Tatooine", "Flow type": "HTTP", "Introduced at": "v2" },
    ]);
    const fx: RawSheet = sheet("FX_Tatooine_HTTP", [
      { "Flow name": "Authent", "Consumer": "Mygeeto", "Retired at": "v3" },
    ]);
    const result = buildModel(wb([acteursOk, typesFluxOk, interfaces, fx, paliersOk]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.interfaces[0].palierIntroduction).toBe("v2");
    expect(result.model.consommations[0].palierRetrait).toBe("v3");
  });

  // Vides, elles gardent le sens habituel du projet : « depuis toujours » et
  // « toujours là ». Les classeurs qui ne datent rien se lisent à l'identique.
  it("leaves them empty rather than absent when nothing is declared", () => {
    const result = buildModel(wb([acteursOk, typesFluxOk, interfacesOk, fxTatooineHttp]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.acteurs[0].palierIntroduction).toBe("");
    expect(result.model.interfaces[0].palierRetrait).toBe("");
    expect(result.model.consommations[0].palierIntroduction).toBe("");
  });
});

describe("nature du type d'acteur et relais d'interface", () => {
  it("lit la nature déclarée sur le type d'acteur", () => {
    const result = buildModel(
      wb([
        sheet("Actors", [{ Name: "Tatooine", Group: "Socle", "Actor type": "Application" }]),
        sheet("ActorTypes", [
          { "Actor type": "Application", Icon: "app-window", Nature: "Business" },
          { "Actor type": "Middleware", Icon: "server", Nature: "Technical" },
        ]),
        typesFluxOk,
        sheet("Interfaces", [{ "Flow name": "F", Provider: "Tatooine", "Flow type": "HTTP" }]),
      ])
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.typesActeur.map((t) => [t.type, t.nature])).toEqual([
      ["Application", "Business"],
      ["Middleware", "Technical"],
    ]);
  });

  it("lit le relais déclaré sur une interface", () => {
    const result = buildModel(
      wb([
        sheet("Actors", [{ Name: "Bus", Group: "Socle", "Actor type": "Middleware" }]),
        sheet("ActorTypes", [{ "Actor type": "Middleware", Icon: "server", Nature: "Technical" }]),
        typesFluxOk,
        sheet("Interfaces", [{ "Flow name": "trx.norm", Provider: "Bus", "Flow type": "HTTP", Relays: "Transactions" }]),
      ])
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.interfaces[0].relais).toBe("Transactions");
  });

  // Un classeur d'avant la v3 n'a ni l'une ni l'autre colonne : il doit se
  // lire à l'identique, les deux champs vides.
  it("lit les deux champs vides quand les colonnes manquent", () => {
    const result = buildModel(
      wb([
        sheet("Actors", [{ Name: "Tatooine", Group: "Socle", "Actor type": "Application" }]),
        sheet("ActorTypes", [{ "Actor type": "Application", Icon: "app-window" }]),
        typesFluxOk,
        sheet("Interfaces", [{ "Flow name": "F", Provider: "Tatooine", "Flow type": "HTTP" }]),
      ])
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.typesActeur[0].nature).toBe("");
    expect(result.model.interfaces[0].relais).toBe("");
  });
});

// --- QA : Excel refuse un nom d'onglet de plus de 31 caractères ou portant
// l'un de : \ / ? * [ ]. Le nom étant DÉRIVÉ de l'exposant et du type de flux,
// un acteur au nom un peu long produisait un onglet impossible -- et l'écriture
// l'écartait en silence, emportant ses consommations. Le nom est désormais
// assaini au seul endroit où il se fabrique.
describe("feuilleFxAttendue — un nom qu'Excel accepte toujours", () => {
  it("coupe à 31 caractères", () => {
    const nom = feuilleFxAttendue("Plateforme de règlement-livraison", "HTTP");
    expect(nom).toHaveLength(31);
    expect(nomOngletValide(nom)).toBe(true);
  });

  it("remplace les caractères qu'Excel interdit", () => {
    const nom = feuilleFxAttendue("Referentiel", "OIDC/SSO");
    expect(nom).toBe("FX_Referentiel_OIDC-SSO");
    expect(nomOngletValide(nom)).toBe(true);
  });

  it("ne touche pas à un nom déjà acceptable", () => {
    expect(feuilleFxAttendue("Tatooine", "HTTP")).toBe("FX_Tatooine_HTTP");
  });

  it("assainit chacun des caractères interdits", () => {
    for (const c of [":", "\\", "/", "?", "*", "[", "]"]) {
      expect(nomOngletValide(feuilleFxAttendue("A", `X${c}Y`))).toBe(true);
    }
  });
});
