import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { repairWorkbook } from "./repair";
import { writeTemplate } from "./template-export";
import { SAMPLE_DATA } from "./sample-data";
import { parseWorkbook } from "../parsing/workbook";
import { buildModel, SCHEMA_VERSION } from "../parsing/build-model";

const THE_DAY = new Date("2026-08-17T00:00:00Z");

// The original format's real shape: French sheets and columns (see
// /Exemples/exemple legacy.xlsx). A workbook written with English headings
// looks like nothing the original parser recognises -- the real shape is needed
// to really exercise the conversion.
function legacyWorkbook(): ArrayBuffer {
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
    XLSX.utils.json_to_sheet([{ Group: "G1", Nom: "Utapau", Description: "d", Commentaires: "" }]),
    "Composants"
  );
  return XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
}

// An original workbook where nothing is recognised: neither the sheets nor the
// columns of the one sheet that could stand in for them. This is the scenario
// of the real workbook that "came back completely empty, in silence".
function unrecognisableWorkbook(): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet([{ Source: "Utapau", Target: "Felucia", Type: "HTTP", Name: "Checkout" }]),
    "Flux"
  );
  return XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
}

// Composants reads, Flux does not: the actors come out, no interface does.
// This is the disguised variant of the empty workbook -- a list of applications
// with nothing between them -- plausible for a home-grown format that drifted.
function workbookActorsWithoutInterfaces(): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet([{ Source: "Utapau", Target: "Felucia", Type: "HTTP", Name: "Checkout" }]),
    "Flux"
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet([{ Group: "G1", Nom: "Utapau", Description: "d", Commentaires: "" }]),
    "Composants"
  );
  return XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
}

describe("reparerClasseur", () => {
  it("converts a workbook from the original format and reports what it inferred", () => {
    const r = repairWorkbook(legacyWorkbook(), THE_DAY);
    expect(r.legacyReport).not.toBeNull();
    expect(r.data.actors.map((a) => a[0]).sort()).toEqual(["Felucia", "Utapau"]);
    expect(r.data.interfaces.map((i) => i[0])).toEqual(["Checkout"]);
    expect(r.data.fx).toHaveLength(1);
    expect(r.data.fx[0].name).toBe("FX_Felucia_HTTP");
    expect(r.data.fx[0].rows).toHaveLength(1);
    expect(r.data.fx[0].rows[0][0]).toBe("Checkout");
  });

  // Founding §: a workbook from which nothing is recovered must never leave in
  // silence as though it had been processed -- that is exactly the incident that
  // happened with a real workbook of this family.
  it("throws rather than return a silently empty workbook when nothing at all is recovered", () => {
    expect(() => repairWorkbook(unrecognisableWorkbook(), THE_DAY)).toThrow();
  });

  // The threshold is on the interfaces, not on the actors: an interface
  // cartography without a single interface is not a result, even when actors
  // were recovered just fine.
  it("throws when actors are recovered but not a single interface", () => {
    expect(() => repairWorkbook(workbookActorsWithoutInterfaces(), THE_DAY)).toThrow();
  });

  // A workbook of our family is not a conversion: it is a repair, and there is
  // nothing inferred to report.
  it("upgrades one of our own workbooks without a legacy report", () => {
    const r = repairWorkbook(writeTemplate(SAMPLE_DATA), THE_DAY);
    expect(r.legacyReport).toBeNull();
    const reread = buildModel(parseWorkbook(writeTemplate(r.data)));
    if (!reread.ok) throw new Error("illisible");
    expect(reread.model.schemaVersion).toBe(SCHEMA_VERSION);
  });

  // This is what replaces the macro: returning a file where no sheet is missing,
  // even for an interface that has no consumption yet.
  it("returns a workbook where every expected sheet exists", () => {
    const r = repairWorkbook(writeTemplate(SAMPLE_DATA), THE_DAY);
    const reread = buildModel(parseWorkbook(writeTemplate(r.data)));
    if (!reread.ok) throw new Error("illisible");
    const expected = new Set(reread.model.interfaces.map((i) => i.expectedSheet));
    for (const sheet of expected) expect(reread.model.fxSheetNames).toContain(sheet);
  });
});

// --- QA: the French shape of the CURRENT model -- not to be confused with the
// original format, which describes a LINK between two components. Here the
// sheets already carry today's model, merely named in French: RefActeur,
// RefTypesActeur, Flux, and an "Usine responsable" column. The parser
// recognised neither those three sheet names nor that column, so it rejected
// the workbook before even reaching the value translation, which the v0→v1
// step has been able to do since day one.
function frenchWorkbook(): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet([{ "Type d'acteur": "Application", "Icône": "app-window" }]),
    "RefTypesActeur"
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet([
      { Nom: "Endor", Group: "Socle", "Type d'acteur": "Application", "Usine responsable": "Corellia", Description: "d", Commentaires: "" },
      { Nom: "Chandrila", Group: "Socle", "Type d'acteur": "Application", "Usine responsable": "", Description: "d", Commentaires: "" },
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

describe("a workbook on the current model named in French", () => {
  it("reads as a workbook of the family, without going through the original conversion", () => {
    const repair = repairWorkbook(frenchWorkbook(), THE_DAY);
    expect(repair.legacyReport).toBeNull();
  });

  it("keeps the actors, their owner and the interface", () => {
    const reread = buildModel(parseWorkbook(writeTemplate(repairWorkbook(frenchWorkbook(), THE_DAY).data)));
    expect(reread.ok).toBe(true);
    if (!reread.ok) return;
    expect(reread.model.actors.map((a) => a.name).sort()).toEqual(["Chandrila", "Endor"]);
    expect(reread.model.actors.find((a) => a.name === "Endor")?.owner).toBe("Corellia");
    expect(reread.model.interfaces.map((i) => i.flowName)).toEqual(["Transactions"]);
    expect(reread.model.consumptions).toHaveLength(1);
  });

  it("translates the French values along the way", () => {
    const reread = buildModel(parseWorkbook(writeTemplate(repairWorkbook(frenchWorkbook(), THE_DAY).data)));
    if (!reread.ok) return;
    expect(reread.model.consumptions[0].decision).toBe("Keep");
    expect(reread.model.consumptions[0].criticality).toBe("1 - Critical");
  });
});
