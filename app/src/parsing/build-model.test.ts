import { describe, it, expect } from "vitest";
import { buildModel, FX_COLUMNS, expectedFxSheet, isValidTabName } from "./build-model";
import type { ParsedWorkbook, RawSheet } from "./model";

function wb(sheets: RawSheet[]): ParsedWorkbook {
  return { sheets, savedAt: null };
}

// Les vrais en-têtes viennent de la ligne 1 de la feuille, pas des lignes de
// données (voir RawSheet.headers) ; pour une fixture de test avec au moins
// une ligne, l'union de ses clés est un équivalent fidèle.
function sheet(name: string, rows: Record<string, string>[], headers?: string[]): RawSheet {
  return {
    name,
    headers: headers ?? [...new Set(rows.flatMap((r) => Object.keys(r)))],
    rows: rows.map((values, i) => ({ row: i + 2, values })),
  };
}

const actorsOk: RawSheet = sheet("Actors", [
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
    const result = buildModel(wb([actorsOk, typesFluxOk, interfacesOk, fxTatooineHttp]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.actors).toHaveLength(2);
    expect(result.model.flowTypes).toHaveLength(2);
    expect(result.model.interfaces).toHaveLength(1);
    expect(result.model.interfaces[0].expectedSheet).toBe("FX_Tatooine_HTTP");
    expect(result.model.consumptions).toHaveLength(1);
    expect(result.model.consumptions[0].sheet).toBe("FX_Tatooine_HTTP");
    expect(result.model.fxSheetNames).toEqual(["FX_Tatooine_HTTP"]);
  });

  it("matches sheet names case/accent-insensitively", () => {
    const result = buildModel(
      wb([
        { ...actorsOk, name: "actors" },
        { ...typesFluxOk, name: "TYPESFLUX" },
        interfacesOk,
      ])
    );
    expect(result.ok).toBe(true);
  });

  it("ignores FX_Modèle as a consumption sheet", () => {
    const template: RawSheet = { name: "FX_Modèle", headers: [], rows: [] };
    const result = buildModel(wb([actorsOk, typesFluxOk, interfacesOk, fxTatooineHttp, template]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.fxSheetNames).toEqual(["FX_Tatooine_HTTP"]);
  });

  it("drops rows with no content in any expected column", () => {
    const withBlankRow: RawSheet = {
      ...actorsOk,
      rows: [
        ...actorsOk.rows,
        { row: 4, values: { Name: "", Group: "", "Perimeter": "", "Actor type": "", Status: "", Owner: "", Description: "", Comments: "" } },
      ],
    };
    const result = buildModel(wb([withBlankRow, typesFluxOk, interfacesOk]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.actors).toHaveLength(2);
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
    const result = buildModel(wb([actorsOk, longType, longInterfaces]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const expected = result.model.interfaces[0].expectedSheet;
    expect(expected.length).toBeLessThanOrEqual(31);
    expect(isValidTabName(expected)).toBe(true);
  });

  it("tracks non-key columns missing from a sheet's header row", () => {
    const actorsWithoutGroup: RawSheet = sheet("Actors", [{ Name: "Tatooine" }]);
    const result = buildModel(wb([actorsWithoutGroup, typesFluxOk, interfacesOk]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.missingOptionalColumns).toContainEqual({ sheet: "Actors", column: "Group" });
  });

  it("does not report every column missing on a present-but-empty FX_ tab (freshly generated by the macro, §12)", () => {
    const emptyFx: RawSheet = { name: "FX_Bespin_OIDC-SSO", headers: [...FX_COLUMNS], rows: [] };
    const result = buildModel(wb([actorsOk, typesFluxOk, interfacesOk, emptyFx]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.missingOptionalColumns.filter((c) => c.sheet === "FX_Bespin_OIDC-SSO")).toHaveLength(0);
  });
});

describe("buildModel — blocking errors", () => {
  it("blocks when a structuring sheet is missing", () => {
    const result = buildModel(wb([actorsOk, typesFluxOk]));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.message.includes("Interfaces"))).toBe(true);
  });

  it("blocks when a key column is missing", () => {
    const unnamedActors: RawSheet = sheet("Actors", [{ Group: "Socle" }]);
    const result = buildModel(wb([unnamedActors, typesFluxOk, interfacesOk]));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.message.includes("Name"))).toBe(true);
  });

  it("reports every blocking cause at once", () => {
    const result = buildModel(wb([]));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toHaveLength(3);
  });

  it("reports a present sheet's missing key column even when a different sheet is absent entirely", () => {
    const unnamedActors: RawSheet = sheet("Actors", [{ Group: "Socle" }]);
    const result = buildModel(wb([unnamedActors, typesFluxOk]));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.message.includes("Interfaces"))).toBe(true);
    expect(result.errors.some((e) => e.message.includes("Name") && e.message.includes("Actors"))).toBe(true);
  });
});

describe("buildModel — version et état d'interface", () => {
  it("reads the Version and État columns of an interface", () => {
    const interfaces = sheet("Interfaces", [
      { "Flow name": "Authent", Version: "1.0", "État": "À décommissionner", "Provider": "Tatooine", "Flow type": "HTTP" },
    ]);
    const result = buildModel(wb([actorsOk, typesFluxOk, interfaces]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.interfaces[0].version).toBe("1.0");
    expect(result.model.interfaces[0].legacyState).toBe("À décommissionner");
  });

  it("reads the Version column of a consumption", () => {
    const fx = sheet("FX_Tatooine_HTTP", [
      { "Flow name": "Authent", Version: "2.0", "Consumer": "Mygeeto", Status: "Actif", "Decision": "Keep" },
    ]);
    const result = buildModel(wb([actorsOk, typesFluxOk, interfacesOk, fx]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.consumptions[0].version).toBe("2.0");
  });

  // Une version vide est une version, pas une absence : c'est ce qui laisse les
  // classeurs antérieurs se rattacher exactement comme avant.
  it("leaves version empty rather than absent when the column is missing", () => {
    const result = buildModel(wb([actorsOk, typesFluxOk, interfacesOk, fxTatooineHttp]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.interfaces[0].version).toBe("");
    expect(result.model.consumptions[0].version).toBe("");
  });
});

describe("buildModel — numéro de schéma du classeur", () => {
  it("reads the schema number from the hidden Version sheet", () => {
    const version = sheet("Version", [{ "Model version": "1" }]);
    const result = buildModel(wb([actorsOk, typesFluxOk, interfacesOk, version]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.schemaVersion).toBe(1);
  });

  // Tous les classeurs produits avant cette évolution.
  it("treats a workbook without the sheet as version 0", () => {
    const result = buildModel(wb([actorsOk, typesFluxOk, interfacesOk]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.schemaVersion).toBe(0);
  });

  it("falls back to 0 on an unreadable schema number", () => {
    const version = sheet("Version", [{ "Model version": "n'importe quoi" }]);
    const result = buildModel(wb([actorsOk, typesFluxOk, interfacesOk, version]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.schemaVersion).toBe(0);
  });

  it("does not mistake the Version sheet for a consumption sheet", () => {
    const version = sheet("Version", [{ "Model version": "1" }]);
    const result = buildModel(wb([actorsOk, typesFluxOk, interfacesOk, version]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.fxSheetNames).toEqual([]);
  });
});

const milestonesOk: RawSheet = sheet("Milestones", [
  { Milestone: "v1", Rank: "1", "Label": "Socle initial", Status: "Delivered", Date: "2026-01-15", Description: "" },
  { Milestone: "v2", Rank: "2", "Label": "Ouverture partenaires", Status: "Delivered", Date: "2026-06-01", Description: "" },
  { Milestone: "v3", Rank: "3", "Label": "Temps réel", Status: "Planned", Date: "", Description: "" },
]);

describe("buildModel — onglet Paliers", () => {
  it("reads the declared paliers with their rank and status", () => {
    const result = buildModel(wb([actorsOk, typesFluxOk, interfacesOk, milestonesOk]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.milestones.map((p) => p.name)).toEqual(["v1", "v2", "v3"]);
    expect(result.model.milestones[1].rank).toBe(2);
    expect(result.model.milestones[2].status).toBe("Planned");
  });

  // L'ordre vient du rang, pas de l'ordre des lignes : un tri dans Excel
  // détruirait un ordre implicite sans rien dire.
  it("orders by rank, not by row order", () => {
    const shuffled: RawSheet = sheet("Milestones", [
      { Milestone: "v3", Rank: "3", Status: "Planned" },
      { Milestone: "v1", Rank: "1", Status: "Delivered" },
      { Milestone: "v2", Rank: "2", Status: "Delivered" },
    ]);
    const result = buildModel(wb([actorsOk, typesFluxOk, interfacesOk, shuffled]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.milestones.map((p) => p.name)).toEqual(["v1", "v2", "v3"]);
  });

  it("leaves the list empty when the sheet is absent", () => {
    const result = buildModel(wb([actorsOk, typesFluxOk, interfacesOk]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.milestones).toEqual([]);
  });
});

describe("buildModel — colonnes de validité", () => {
  it("reads the introduction and retirement paliers of an acteur", () => {
    const actors: RawSheet = sheet("Actors", [
      { Name: "Tatooine", Group: "Socle", "Introduced at": "v1", "Retired at": "v3" },
    ]);
    const result = buildModel(wb([actors, typesFluxOk, interfacesOk, milestonesOk]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.actors[0].introducedAt).toBe("v1");
    expect(result.model.actors[0].retiredAt).toBe("v3");
  });

  it("reads them on an interface and on a consumption", () => {
    const interfaces: RawSheet = sheet("Interfaces", [
      { "Flow name": "Authent", "Provider": "Tatooine", "Flow type": "HTTP", "Introduced at": "v2" },
    ]);
    const fx: RawSheet = sheet("FX_Tatooine_HTTP", [
      { "Flow name": "Authent", "Consumer": "Mygeeto", "Retired at": "v3" },
    ]);
    const result = buildModel(wb([actorsOk, typesFluxOk, interfaces, fx, milestonesOk]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.interfaces[0].introducedAt).toBe("v2");
    expect(result.model.consumptions[0].retiredAt).toBe("v3");
  });

  // Vides, elles gardent le sens habituel du projet : « depuis toujours » et
  // « toujours là ». Les classeurs qui ne datent rien se lisent à l'identique.
  it("leaves them empty rather than absent when nothing is declared", () => {
    const result = buildModel(wb([actorsOk, typesFluxOk, interfacesOk, fxTatooineHttp]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.actors[0].introducedAt).toBe("");
    expect(result.model.interfaces[0].retiredAt).toBe("");
    expect(result.model.consumptions[0].introducedAt).toBe("");
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
    expect(result.model.actorTypes.map((t) => [t.type, t.nature])).toEqual([
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
    expect(result.model.interfaces[0].legacyRelays).toBe("Transactions");
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
    expect(result.model.actorTypes[0].nature).toBe("");
    expect(result.model.interfaces[0].legacyRelays).toBe("");
  });
});

// --- QA : Excel refuse un nom d'onglet de plus de 31 caractères ou portant
// l'un de : \ / ? * [ ]. Le nom étant DÉRIVÉ de l'exposant et du type de flux,
// un acteur au nom un peu long produisait un onglet impossible -- et l'écriture
// l'écartait en silence, emportant ses consommations. Le nom est désormais
// assaini au seul endroit où il se fabrique.
describe("feuilleFxAttendue — un nom qu'Excel accepte toujours", () => {
  it("coupe à 31 caractères", () => {
    const name = expectedFxSheet("Plateforme de règlement-livraison", "HTTP");
    expect(name).toHaveLength(31);
    expect(isValidTabName(name)).toBe(true);
  });

  it("remplace les caractères qu'Excel interdit", () => {
    const name = expectedFxSheet("Referentiel", "OIDC/SSO");
    expect(name).toBe("FX_Referentiel_OIDC-SSO");
    expect(isValidTabName(name)).toBe(true);
  });

  it("ne touche pas à un nom déjà acceptable", () => {
    expect(expectedFxSheet("Tatooine", "HTTP")).toBe("FX_Tatooine_HTTP");
  });

  it("assainit chacun des caractères interdits", () => {
    for (const c of [":", "\\", "/", "?", "*", "[", "]"]) {
      expect(isValidTabName(expectedFxSheet("A", `X${c}Y`))).toBe(true);
    }
  });
});
