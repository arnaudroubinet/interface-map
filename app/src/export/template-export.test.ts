import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import {
  buildTemplateWorkbook,
  writeTemplate,
  FLOW_TYPE_SHEET_COLUMNS,
  tablesOfTemplate,
  listsOfTemplate,
  validationsOfTemplate,
  referentialListNames,
  PROMPTS,
  columnOf,
  EXTRA_COLUMN,
  TAB_CELL,
  LISTES,
  REF_ACTORS_SHEET,
  REF_TECHNOLOGIES_SHEET,
  type WorkbookData,
} from "./template-export";
import { parseWorkbook } from "../parsing/workbook";
import {
  buildModel,
  SCHEMA_VERSION,
  INTERFACE_COLUMNS,
  FX_COLUMNS,
  MILESTONE_COLUMNS,
  ACTOR_COLUMNS,
  GROUP_COLUMNS,
  ACTOR_TYPE_COLUMNS,
  FLOW_TYPE_COLUMNS,
} from "../parsing/build-model";
import { runIntegrityChecks } from "../integrity/checks";
import { AVAILABLE_ICONS, ICON_PREVIEWS } from "../render/icons";
import { SAMPLE_DATA } from "./sample-data";
import { readPart } from "./xlsx-tables";
import { readReferentialUrl } from "./datamashup";

// The written file is reread, not the in-memory object: that is the one the
// user will open, and it is the one that must go back through our parser.
// writeTemplate includes the OOXML extras (structured tables).
function rereadTemplate(): ArrayBuffer {
  return writeTemplate();
}

// The raw content of one part of the package, to check what SheetJS can
// neither write nor reread.
function part(path: string, packageBytes: ArrayBuffer = rereadTemplate()): string {
  const cfb = XLSX.CFB.read(new Uint8Array(packageBytes), { type: "array" });
  const input = XLSX.CFB.find(cfb, path);
  if (!input || !input.content) throw new Error(`missing part: ${path}`);
  return new TextDecoder().decode(new Uint8Array(input.content as unknown as ArrayBufferLike));
}

// The sheet parts are numbered in the workbook's order: naming them by that
// number breaks as soon as a sheet is inserted before. So they are resolved by
// name, as everywhere else in this project.
// The same reason for the "table" parts: their number follows the workbook's
// order, so it moves as soon as a table is inserted before. They are found
// again by the name they carry.
function tableXml(tableName: string, packageBytes: ArrayBuffer = rereadTemplate()): string {
  const cfb = XLSX.CFB.read(new Uint8Array(packageBytes), { type: "array" });
  for (const path of cfb.FullPaths) {
    if (!/\/xl\/tables\/table\d+\.xml$/.test(path)) continue;
    const xml = part(path.replace(/^[^/]*/, ""), packageBytes);
    if (xml.includes(`name="${tableName}"`)) return xml;
  }
  throw new Error(`missing table: ${tableName}`);
}

function sheetXml(name: string, packageBytes: ArrayBuffer = rereadTemplate()): string {
  const wb = XLSX.read(new Uint8Array(packageBytes), { type: "array" });
  const index = wb.SheetNames.indexOf(name);
  if (index < 0) throw new Error(`missing tab: ${name}`);
  return part(`/xl/worksheets/sheet${index + 1}.xml`, packageBytes);
}

describe("the workbook template", () => {
  it("carries every sheet the parser expects", () => {
    const wb = XLSX.read(new Uint8Array(rereadTemplate()), { type: "array" });
    expect(wb.SheetNames).toEqual([
      "Instructions",
      "Actors",
      "Groups",
      "Milestones",
      "ActorTypes",
      "FlowTypes",
      "Interfaces",
      "Lists",
      "RefActors",
      "RefGroups",
      "RefActorTypes",
      "RefTechnologies",
      "Version",
    ]);
  });

  // The central contract: a template that does not reread would be worse than no
  // template, as the user would not know whether the fault is theirs or the tool's.
  it("rereads with no blocking error and no missing column", () => {
    const parsed = parseWorkbook(rereadTemplate());
    const result = buildModel(parsed);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.missingOptionalColumns).toEqual([]);
  });

  it("declares the perimeter at group level, not deduced from the actors", () => {
    const parsed = parseWorkbook(rereadTemplate());
    const result = buildModel(parsed);
    if (!result.ok) throw new Error("unreadable template");
    // The sheet exists and is authoritative, even with no rows.
    expect(result.model.groupsSheetMissing).toBe(false);
  });

  // Nothing is seeded here any more: a type is taken from the referential as it
  // is needed. Seeding six would have a brand-new workbook declare types before
  // anyone said it used any -- and the referential is where they now live.
  it("declares no actor type of its own", () => {
    const result = buildModel(parseWorkbook(rereadTemplate()));
    if (!result.ok) throw new Error("unreadable template");
    expect(result.model.actorTypes).toEqual([]);
  });

  // A template opening on errors would cast doubt on the tool before the first
  // entry: a blank workbook is empty, not inconsistent.
  it("triggers no blocking anomaly on opening", () => {
    const result = buildModel(parseWorkbook(rereadTemplate()));
    if (!result.ok) throw new Error("unreadable template");
    const report = runIntegrityChecks(result.model);
    const messages = report.families.flatMap((f) => f.anomalies.map((a) => a.message));
    expect(messages).toEqual([]);
  });

  // Excel refused to open the template: the autofilter sets a defined name quoting
  // the sheet's name between apostrophes, and SheetJS does not double the inner
  // apostrophe of "Mode d'emploi". The file stayed readable by SheetJS itself,
  // hence green tests on a workbook Excel offered to repair. The rule is
  // therefore checked here, at the source.
  it("sets no autofilter on a sheet whose name holds an apostrophe", () => {
    const wb = buildTemplateWorkbook();
    for (const name of wb.SheetNames) {
      if (name.includes("'")) {
        expect(wb.Sheets[name]["!autofilter"]).toBeUndefined();
      }
    }
    // No sheet carries an apostrophe any more since "Mode d'emploi" became
    // "Instructions". The rule stays true and the test guards it, but it no
    // longer protects anything while no name carries one.
    expect(wb.SheetNames.some((n) => n.includes("'"))).toBe(false);
  });

  it("lists the accepted icon names on the Lists sheet, each with its preview", () => {
    const wb = XLSX.read(new Uint8Array(rereadTemplate()), { type: "array" });
    const lists = XLSX.utils.sheet_to_json<Record<string, string>>(wb.Sheets.Lists, { defval: "" });
    const offered = lists.map((l) => l.Icon).filter(Boolean);
    expect(offered).toEqual(AVAILABLE_ICONS);
    // Each name has its visual cue alongside, on the same row.
    for (const row of lists.filter((l) => l.Icon)) {
      expect(row["Preview"]).toBe(ICON_PREVIEWS[row.Icon]);
      expect(row["Preview"]).not.toBe("");
    }
  });

  // The actor types are enumerated by the ActorTypes sheet: repeating them in
  // Lists would have created two competing truths.
  it("does not enumerate the actor types in Lists", () => {
    const wb = XLSX.read(new Uint8Array(rereadTemplate()), { type: "array" });
    const headers = XLSX.utils.sheet_to_json<string[]>(wb.Sheets.Lists, { header: 1 })[0];
    expect(headers).not.toContain("ActorType");
  });

  // SheetJS does not write structured tables: the OOXML package is completed
  // afterwards. These checks are therefore on the XML, not on the object.
  // The "Tbl" prefix is the macro's contract: it looks for "TblInterfaces" and
  // stops if it does not find it.
  it("sets a real Excel table on every entry sheet", () => {
    for (let i = 1; i <= tablesOfTemplate().length; i++) {
      const table = part(`/xl/tables/table${i}.xml`);
      expect(table).toContain('displayName="Tbl');
      expect(table).toContain('showRowStripes="1"');
    }
    // And the declaration on the sheet's side, failing which Excel would ignore the part.
    expect(sheetXml("Actors")).toContain("<tableParts count=\"1\">");
  });

  it("names the table's columns like the header row", () => {
    const actors = tablesOfTemplate().find((t) => t.sheet === "Actors")!;
    const table = part("/xl/tables/table1.xml");
    for (const column of actors.columns) {
      // Excel refuses a table one of whose declared columns does not match.
      expect(table).toContain(column.replace(/'/g, "'"));
    }
  });

  // SheetJS does not write data validations either: they are injected, hence
  // checked on the XML.
  // The perimeter is declared on the group: the column of the same name has gone
  // from the Actors sheet, and its drop-down with it.
  it("no longer asks for a perimeter on the actors", () => {
    const result = buildModel(parseWorkbook(rereadTemplate()));
    if (!result.ok) throw new Error("unreadable template");
    expect(result.model.missingOptionalColumns).toEqual([]);
    const wb = XLSX.read(new Uint8Array(rereadTemplate()), { type: "array" });
    const headers = XLSX.utils.sheet_to_json<string[]>(wb.Sheets.Actors, { header: 1 })[0];
    expect(headers).not.toContain("Perimeter");
    expect(XLSX.utils.sheet_to_json<string[]>(wb.Sheets.Groups, { header: 1 })[0]).toContain("Perimeter");
  });

  it("constrains the reference columns with a drop-down", () => {
    const actors = sheetXml("Actors");
    // The count is read from what is declared, not from a literal: one more
    // constrained column must not break this test for nothing.
    const expected = validationsOfTemplate().filter((v) => v.sheet === "Actors").length;
    expect(expected).toBeGreaterThan(1);
    expect(actors).toContain(`<dataValidations count="${expected}">`);
    expect(actors).toContain('type="list"');
    expect(actors).toContain("<formula1>L_RefActeur</formula1>");
    // The group and the actor type read the LOCAL sheets: the integrity check
    // holds Groups to be authoritative, and ActorTypes carries the icon. A
    // drop-down fed by the referential would propose what the report marks red.
    expect(actors).toContain("<formula1>L_Groupe</formula1>");
    expect(actors).toContain("<formula1>L_TypeActeur</formula1>");
    expect(actors).not.toContain("L_RefGroupe</formula1>");
    expect(actors).not.toContain("L_RefTypeActeur</formula1>");
    // Placed between the data and the ignored errors: the order of a sheet's
    // elements is imposed by the OOXML schema.
    expect(actors.indexOf("</sheetData>")).toBeLessThan(actors.indexOf("<dataValidations"));
    expect(actors.indexOf("<dataValidations")).toBeLessThan(actors.indexOf("<tableParts"));
  });

  // The regression this test catches: binding a column to a referential list
  // while keeping Excel's Stop alert. On a workbook with no referential the
  // list is a single blank cell, so Excel refuses EVERY typed value -- and
  // Actors!Name is where an actor is created. The spec is explicit: nothing is
  // blocked, a name the referential does not carry is only reported.
  it("never refuses a value the referential does not carry yet", () => {
    const fed = validationsOfTemplate().filter((v) => v.formula && referentialListNames().includes(v.formula));
    expect(fed.length).toBeGreaterThan(0);
    for (const v of fed) expect(v.suggestsOnly).toBe(true);

    const alertOf = (xml: string, list: string) =>
      xml.match(new RegExp(`<dataValidation ([^>]*)><formula1>${list}</formula1>`))![1];
    expect(alertOf(sheetXml("Actors"), "L_RefActeur")).toContain('showErrorMessage="0"');
    expect(alertOf(sheetXml("FlowTypes"), "L_RefTypeFlux")).toContain('showErrorMessage="0"');
    // And nothing else loosens: a vocabulary the workbook itself owns keeps
    // refusing what is not in it.
    expect(alertOf(sheetXml("Interfaces"), "L_TypeFlux")).toContain('showErrorMessage="1"');
    expect(alertOf(sheetXml("Groups"), "L_Perimetre")).toContain('showErrorMessage="1"');
  });

  it("points each list at the table column carrying it", () => {
    const workbook = part("/xl/workbook.xml");
    // A structured reference: the table extends by itself, and neither OFFSET nor
    // COUNTA has any place behind these names. Each of Lists' vocabularies now
    // carries ITS table, sized to its own content — not the single TblLists table,
    // which padded the short lists with blank rows up to the longest one's height
    // (Icon).
    const expected: [string, string][] = [
      ["L_Perimetre", "TblLists_Perimeter[Perimeter]"],
      ["L_Sens", "TblLists_Direction[Direction]"],
      ["L_Decision", "TblLists_Decision[Decision]"],
      ["L_Criticite", "TblLists_Criticality[Criticality]"],
      ["L_Confirmation", "TblLists_Confirmation[Confirmation]"],
      ["L_Icone", "TblLists_Icon[Icon]"],
      ["L_Nature", "TblLists_Nature[Nature]"],
      ["L_TypeActeur", "TblActorTypes[Actor type]"],
      ["L_Acteur", "TblActors[Name]"],
      ["L_Groupe", "TblGroups[Group]"],
      ["L_TypeFlux", "TblFlowTypes[Flow type]"],
      ["L_Palier", "TblMilestones[Milestone]"],
      ["L_RefActeur", "TblRefActors[Name]"],
      ["L_RefGroupe", "TblRefGroups[Name]"],
      ["L_RefTypeActeur", "TblRefActorTypes[Actor type]"],
      ["L_RefTypeFlux", "TblRefTechnologies[Flow type]"],
    ];
    expect(listsOfTemplate().map((l) => l.name).sort()).toEqual(expected.map(([name]) => name).sort());
    for (const [name, reference] of expected) {
      expect(workbook).toContain(`<definedName name="${name}">${reference}</definedName>`);
    }
    expect(workbook).not.toContain("OFFSET(");
    expect(workbook).not.toContain("COUNTA(");
  });

  // The regression this test catches: a single TblLists table, sized on the
  // longest list (Icon, 25 entries), made every shorter list 2 to 4 real values
  // followed by blank rows -- visible in the drop-down, and counted by COUNTA
  // since SheetJS writes empty string cells there rather than writing nothing.
  //
  it("sizes each Lists vocabulary's table to its own content, with no blank row", () => {
    const headers = Object.keys(LISTES);
    headers.forEach((key, index) => {
      const column = XLSX.utils.encode_col(index);
      const table = tableXml(`TblLists_${key}`);
      const lastRow = LISTES[key].length + 1;
      expect(table).toContain(`ref="${column}1:${column}${lastRow}"`);
    });
  });

  // Each list targets a sheet and a heading that really exist on its table: a
  // structured reference is not recoverable like an OFFSET, which would at least
  // have pointed somewhere. A missing table or column makes the defined name
  // invalid, and Excel reports it by offering to repair the
  // classeur.
  it("each list targets a sheet and a heading really present in its table", () => {
    const tables = tablesOfTemplate();
    for (const list of listsOfTemplate()) {
      // Lists carries one table PER vocabulary: searching by sheet alone would
      // fall back on the first of them, not necessarily the one carrying the
      // heading targeted.
      const table = tables.find((t) => t.sheet === list.sheet && t.columns.includes(list.heading));
      expect(table, `pas de table portant "${list.heading}" sur ${list.sheet}`).toBeDefined();
    }
  });

  it("references only lists that are really defined", () => {
    // The FX_ sheets' dependent lists compute their range: those are formulas, not
    // names. The rule therefore holds only for the latter.
    const defined = new Set(listsOfTemplate().map((l) => l.name));
    const byName = validationsOfTemplate().filter((v) => v.formula !== undefined && /^L_[A-Za-zÀ-ÿ]+$/.test(v.formula));
    expect(byName.length).toBeGreaterThan(0);
    for (const validation of byName) {
      expect(defined).toContain(validation.formula!);
    }
  });

  // The tables carry their own filter: the sheet autofilters, and the defined
  // names they dragged along, have no place any more.
  it("leaves only the lists' defined names, no autofilter residue", () => {
    const workbook = part("/xl/workbook.xml");
    expect(workbook).not.toContain("_FilterDatabase");
    const names = [...workbook.matchAll(/<definedName name="([^"]*)"/g)].map((m) => m[1]);
    expect(names.sort()).toEqual(listsOfTemplate().map((l) => l.name).sort());
  });

  // Neither the pattern nor the dictionary is filled by hand.
  it("hides Lists, the four referential sheets and Version, visible on the entry sheets", () => {
    const wb = XLSX.read(new Uint8Array(rereadTemplate()), { type: "array" });
    const states = wb.Workbook!.Sheets!;
    const hidden = wb.SheetNames.filter((_, i) => states[i].Hidden);
    expect(hidden).toEqual(["Lists", "RefActors", "RefGroups", "RefActorTypes", "RefTechnologies", "Version"]);
  });

  // The common technologies moved to the blank referential, where the workbook
  // now picks the ones it uses. referential-template.test.ts checks they are
  // there; here, what matters is that nothing is declared for the reader.
  it("declares no technology of its own", () => {
    const result = buildModel(parseWorkbook(rereadTemplate()));
    if (!result.ok) throw new Error("unreadable template");
    expect(result.model.flowTypes).toEqual([]);
  });

  // What the referential says about a name is read, not entered: a calculated
  // column, which Excel fills on every row added and puts back when someone
  // types over it. The icon preview that used to sit here is gone with it --
  // it previewed a value nobody chooses on this side any more.
  it("reads from the referential in calculated columns, never typed", () => {
    const types = tableXml("TblActorTypes");
    expect(types).toContain("<calculatedColumnFormula>");
    expect(types).toContain("RefActorTypes!$");
    expect(types).not.toContain("Preview");

    const technologies = tableXml("TblFlowTypes");
    expect(technologies).toContain("RefTechnologies!$");
    for (const column of ["Direction", "Description", "Colour"]) {
      expect(technologies).toContain(`name="${column}"`);
    }
  });

  // Excel loads the tables in order: a formula naming a table defined further on
  // is invalid at the moment it reads it, and it DELETES the offending table while
  // offering to repair the workbook. Its log taught us that; this test prevents
  // going back there.
  it("uses no structured reference to another table", () => {
    for (let i = 1; i <= tablesOfTemplate().length; i++) {
      const table = part(`/xl/tables/table${i}.xml`);
      const formulas = [...table.matchAll(/<calculatedColumnFormula>(.*?)<\/calculatedColumnFormula>/g)];
      for (const [, formula] of formulas) {
        expect(formula).not.toMatch(/Tbl[A-Za-z]+\[/);
      }
    }
  });
});

// materialiseRows declared the sheet's dimension from the extent of the table
// it had just laid down alone, overwriting what SheetJS had written. On Lists,
// the helper area (columns J to N, up to row 1000) fell outside "A1:H26"; on
// every FX_ sheet, cell K1 -- on which both cascading lists depend -- fell
// outside "A1:I{n}". Excel rebuilds the range without flinching, but another
// reader (this project included)
// relies on it as-is.
describe("the workbook template — declared dimension", () => {
  it("covers Lists' helper area, not only the vocabulary tables", () => {
    const lists = sheetXml("Lists");
    const m = lists.match(/<dimension ref="A1:([A-Z]+)(\d+)"\/>/);
    expect(m).not.toBeNull();
    const [, lastColumn, lastRow] = m!;
    // The flow-name column, the rightmost of the helper area.
    const flows = XLSX.utils.encode_col(Object.keys(LISTES).length + 5);
    expect(XLSX.utils.decode_col(lastColumn)).toBeGreaterThanOrEqual(XLSX.utils.decode_col(flows));
    expect(Number(lastRow)).toBe(1000);
  });

  it("covers the helper cell naming the sheet, on every FX_ sheet", () => {
    const packageBytes = writeTemplate(SAMPLE_DATA);
    for (const tab of SAMPLE_DATA.fx) {
      const sheet = sheetXml(tab.name, packageBytes);
      const m = sheet.match(/<dimension ref="A1:([A-Z]+)(\d+)"\/>/);
      expect(m, `no dimension on ${tab.name}`).not.toBeNull();
      expect(XLSX.utils.decode_col(m![1])).toBeGreaterThanOrEqual(XLSX.utils.decode_col(EXTRA_COLUMN));
    }
  });
});

// The GenererOngletsManquants macro ships INSIDE the generated workbooks: its
// contract is no longer a convention, it is a dependency. It looks for the
// Interfaces sheet, its "TblInterfaces" table, two named columns, and the
// FX_Modèle pattern. A silent rename would break it at the user's end, with
// nothing here flinching.

// The macro and its button travel INSIDE the generated workbooks: it is Excel
// that creates the FX_ sheets, the tool only reads.

describe("the workbook template — schema number", () => {
  it("writes the current number on the Version sheet", () => {
    const wb = XLSX.read(new Uint8Array(rereadTemplate()), { type: "array" });
    const rows = XLSX.utils.sheet_to_json<Record<string, string>>(wb.Sheets.Version, { defval: "" });
    expect(String(rows[0]["Model version"])).toBe(String(SCHEMA_VERSION));
  });

  // The workbook just produced must never ask for its own upgrade: this is the
  // test that catches a forgotten increment on either side.
  it("rereads at the version the tool expects", () => {
    const result = buildModel(parseWorkbook(rereadTemplate()));
    if (!result.ok) throw new Error("unreadable template");
    expect(result.model.schemaVersion).toBe(SCHEMA_VERSION);
  });
});

describe("the workbook template — interface version", () => {

  // The version is free entry: numbering conventions vary from one team to the
  // next, and a closed list would force them all into one. It still carries its
  // tooltip -- explaining is not
  // contraindre.
  it("leaves the Version column free entry, but explained", () => {
    const surVersion = validationsOfTemplate().filter(
      (v) => v.sheet === "Interfaces" && v.column === columnOf(INTERFACE_COLUMNS, "Version")
    );
    expect(surVersion).toHaveLength(1);
    expect(surVersion[0].formula).toBeUndefined();
    expect(surVersion[0].prompt?.text).toContain("Free text");
  });

  // The same heading on an FX_ sheet names a dependent list: the same
  // infobulle y serait fausse.
  it("does not put the FX_ sheets' prompt on it", () => {
    const surVersion = validationsOfTemplate().find(
      (v) => v.sheet === "Interfaces" && v.column === columnOf(INTERFACE_COLUMNS, "Version")
    );
    expect(surVersion?.prompt?.text).not.toContain("Fill in Flow name first");
  });

});

// The sample rows are positional: a column inserted upstream shifts them
// without breaking anything visible, and the shipped workbook then talks
// nonsense. These two tests exist so that can no longer get through.
describe("the sample file — alignment on the columns", () => {
  it("gives every row as many cells as the sheet has columns", () => {
    for (const row of SAMPLE_DATA.interfaces) {
      expect(row).toHaveLength(INTERFACE_COLUMNS.length);
    }
    for (const tab of SAMPLE_DATA.fx) {
      for (const row of tab.rows) {
        expect(row).toHaveLength(FX_COLUMNS.length);
      }
    }
  });

  it("rereads with every value in its column", () => {
    const result = buildModel(parseWorkbook(writeTemplate(SAMPLE_DATA)));
    if (!result.ok) throw new Error("unreadable example");
    const iface = result.model.interfaces.find((i) => i.flowName === "Member lookup")!;
    expect(iface.providerName).toBe("Takodana");
    expect(iface.flowType).toBe("HTTP");
    const consumption = result.model.consumptions.find((c) => c.consumerName === "Chandrila")!;
    expect(consumption.decision).toBe("Keep");
  });

  // The sample file exists to show the tool at work: the migration report is
  // part of that, so it needs a case to show.
  it("carries a decommissioning under way, so the report has something to say", () => {
    const result = buildModel(parseWorkbook(writeTemplate(SAMPLE_DATA)));
    if (!result.ok) throw new Error("unreadable example");
    const report = runIntegrityChecks(result.model);
    const block = report.infoBlocks.find((b) => b.id === "migrations")!;
    expect(block.items.length).toBeGreaterThan(0);
  });
});

describe("the FX_ sheets' dependent lists", () => {
  // The helper tables must be LIVE: frozen at generation time, they would stop
  // being right the moment the first interface was added in Excel.
  it("feeds both helper tables by formula from Interfaces", () => {
    const lists = sheetXml("Lists");
    expect(lists).toContain('t="array"');
    expect(lists).toContain("FILTER(");
    expect(lists).toContain("UNIQUE(");
    expect(lists).toContain("Interfaces!");
  });

  // Rebuilds the FX_ sheet name by the same convention as the parser
  // (build-model.ts) and the legacy migration (legacy-upgrade.ts):
  // "FX_" + publisher + "_" + flow type.
  it("rebuilds the FX_ sheet name as \"FX_\" + publisher + \"_\" + type", () => {
    const lists = sheetXml("Lists");
    expect(lists).toContain("&quot;FX_&quot;&amp;");
    expect(lists).toContain("&amp;&quot;_&quot;&amp;");
  });

  it("gives every FX_ sheet a cell naming its own sheet", () => {
    const wb = XLSX.read(new Uint8Array(writeTemplate(SAMPLE_DATA)), { type: "array" });
    const cell = wb.Sheets["FX_Takodana_HTTP"][TAB_CELL];
    expect(cell?.f).toContain('CELL("filename"');
  });

  it("hides the column carrying that cell, outside the entry table", () => {
    const template = sheetXml("FX_Takodana_HTTP", writeTemplate(SAMPLE_DATA));
    expect(template).toMatch(/<col[^>]*hidden="(1|true)"/);
    // The entry table stops before it: the cell must not enter it.
    expect(EXTRA_COLUMN > columnOf(FX_COLUMNS, FX_COLUMNS[FX_COLUMNS.length - 1])).toBe(true);
  });

  it("filters the flows on the sheet and the versions on the row's flow", () => {
    const validations = validationsOfTemplate(SAMPLE_DATA);
    const onFlow = validations.find(
      (v) => v.sheet === "FX_Takodana_HTTP" && v.column === columnOf(FX_COLUMNS, "Flow name")
    )!;
    const surVersion = validations.find(
      (v) => v.sheet === "FX_Takodana_HTTP" && v.column === columnOf(FX_COLUMNS, "Version")
    )!;
    // The flow list keys on the sheet's name, carried by the cell.
    expect(onFlow.formula).toContain(`$${EXTRA_COLUMN}$1`);
    expect(onFlow.formula).toContain("MATCH(");
    // The versions' list adds THIS ROW's flow to it: a row-relative reference,
    // so Excel shifts the formula from one row to the next.
    expect(surVersion.formula).toContain(`$${columnOf(FX_COLUMNS, "Flow name")}2`);
    expect(surVersion.formula).toContain("MATCH(");
  });

  it("sets both validations on every FX_ sheet", () => {
    const validations = validationsOfTemplate(SAMPLE_DATA);
    for (const tab of SAMPLE_DATA.fx) {
      const columns = validations.filter((v) => v.sheet === tab.name).map((v) => v.column);
      expect(columns).toContain(columnOf(FX_COLUMNS, "Flow name"));
      expect(columns).toContain(columnOf(FX_COLUMNS, "Version"));
    }
  });

  // The global flow list has no use left: keeping it would leave two ways of
  // offering a flow, one of them wrong.
  it("no longer exposes a global flow list", () => {
    expect(listsOfTemplate().map((l) => l.name)).not.toContain("L_Flux");
    expect(validationsOfTemplate(SAMPLE_DATA).map((v) => v.formula)).not.toContain("L_Flux");
  });
});

// Excel refused a first version of these formulas and deleted the record:
// functions newer than 2007 must be STORED under a prefixed name (_xlfn., and
// _xlfn._xlws. for FILTER and SORT). Without it, Excel does not recognise them
// and offers to repair the file.
describe("helper formulas — stored names", () => {
  const expected: [string, string][] = [
    ["FILTER", "_xlfn._xlws.FILTER("],
    ["SORT", "_xlfn._xlws.SORT("],
    ["UNIQUE", "_xlfn.UNIQUE("],
    ["SEQUENCE", "_xlfn.SEQUENCE("],
    ["HSTACK", "_xlfn.HSTACK("],
  ];

  it("prefixes every recent function", () => {
    const lists = sheetXml("Lists");
    for (const [, prefixed] of expected) {
      expect(lists).toContain(prefixed);
    }
  });

  it("n'en laisse aucune sous son nom nu", () => {
    const lists = sheetXml("Lists");
    for (const [nu] of expected) {
      expect(lists).not.toMatch(new RegExp(`(?<![.A-Za-z_])${nu}\\(`));
    }
  });
});

describe("the workbook template — milestones", () => {
  it("carries a Milestones sheet, visible, with its columns", () => {
    const wb = XLSX.read(new Uint8Array(rereadTemplate()), { type: "array" });
    expect(wb.SheetNames).toContain("Milestones");
    const headers = XLSX.utils.sheet_to_json<string[]>(wb.Sheets.Milestones, { header: 1 })[0];
    expect(headers).toEqual([...MILESTONE_COLUMNS]);
    const states = wb.Workbook!.Sheets!;
    expect(states[wb.SheetNames.indexOf("Milestones")].Hidden).toBeFalsy();
  });

  // The validity bounds are picked, not typed: a typo would create a phantom
  // milestone, invisible from the Milestones sheet.
  it("constrains both validity bounds with the milestone list", () => {
    const onMilestone = validationsOfTemplate(SAMPLE_DATA).filter((v) => v.formula === "L_Palier");
    const sheets = new Set(onMilestone.map((v) => v.sheet));
    expect(sheets).toContain("Actors");
    expect(sheets).toContain("Interfaces");
    for (const tab of SAMPLE_DATA.fx) expect(sheets).toContain(tab.name);
    for (const sheet of sheets) {
      const columns = onMilestone.filter((v) => v.sheet === sheet).map((v) => v.column);
      expect(columns).toHaveLength(2);
    }
  });

  it("feeds that list from the Milestones sheet itself", () => {
    const range = listsOfTemplate().find((l) => l.name === "L_Palier")!;
    expect(range.sheet).toBe("Milestones");
    expect(range.heading).toBe("Milestone");
  });

  it("rereads with no missing column, milestones included", () => {
    const result = buildModel(parseWorkbook(writeTemplate(SAMPLE_DATA)));
    if (!result.ok) throw new Error("unreadable template");
    expect(result.model.missingOptionalColumns).toEqual([]);
  });
});

// The sample file exists to show the tool at work: it must therefore be
// exemplary, and in particular report no anomaly against itself.
describe("the sample file — the milestone axis", () => {
  it("fills in an arrival milestone on every row, with no anomaly", () => {
    const result = buildModel(parseWorkbook(writeTemplate(SAMPLE_DATA)));
    if (!result.ok) throw new Error("unreadable example");
    const messages = runIntegrityChecks(result.model).families.flatMap((f) => f.anomalies.map((a) => a.message));
    expect(messages).toEqual([]);
  });
});

// A formula quoting a non-existent sheet is not a broken formula in Excel's
// eyes: it is a reference to ANOTHER WORKBOOK. The file then opens on "This
// workbook contains links to one or more external sources", and the lists that
// depend on it never fill.
describe("formulas — no phantom sheet", () => {
  it("quotes only sheets that exist in the workbook", () => {
    const packageBytes = writeTemplate();
    const wb = XLSX.read(new Uint8Array(packageBytes), { type: "array" });
    const known = new Set(wb.SheetNames);

    const cited = new Set<string>();
    const relever = (xml: string) => {
      // A sheet name in a formula precedes a "!": either bare, or between
      // apostrophes when it carries a space.
      for (const m of xml.matchAll(/(?:'([^']+)'|([A-Za-z_][A-Za-z0-9_.]*))!/g)) {
        cited.add(m[1] ?? m[2]);
      }
    };
    for (const name of wb.SheetNames) relever(sheetXml(name, packageBytes));
    relever(part("/xl/workbook.xml", packageBytes));
    // The calculated columns live not in the sheet but in the "table" part: that
    // is where the preview formula was, and forgetting it left the check blind to
    // the very one that triggered the warning.
    const cfb = XLSX.CFB.read(new Uint8Array(packageBytes), { type: "array" });
    for (const input of cfb.FullPaths) {
      if (/\/xl\/tables\/table\d+\.xml$/.test(input)) relever(part(input.replace(/^[^/]*/, ""), packageBytes));
    }

    expect([...cited].filter((n) => !known.has(n))).toEqual([]);
  });
});

// Every sheet one types into carries a structured table: that is what gives it
// its banding, its filter and the automatic extension of formulas to the next
// row. A sheet without one is typed into less well than its neighbours, with
// nothing to explain the difference.
describe("the workbook template — every entry sheet is a table", () => {
  it("forgets no data sheet", () => {
    const packageBytes = writeTemplate();
    const wb = XLSX.read(new Uint8Array(packageBytes), { type: "array" });
    // Neither the prose, nor the two hidden sheets that are not typed into.
    const entry = wb.SheetNames.filter((n) => !["Instructions", "Lists", "Version"].includes(n));
    const withTable = new Set(tablesOfTemplate(SAMPLE_DATA).map((t) => t.sheet));

    expect(entry.filter((n) => !withTable.has(n))).toEqual([]);
  });
});

// SheetJS throws "Sheet names cannot exceed 31 chars" as soon as
// FX_<publisher>_<type> exceeds the limit Excel imposes on sheet names -- which
// FX_COLUMNS does not prevent at writing time. A real referential has long
// actor and technology names; the export must not die on them.
// As dataFromModel() (schema-upgrade.ts) and migrateLegacyWorkbook()
// (legacy-upgrade.ts) already do for the same case: the impossible sheet is
// dropped, the interface stays in the catalogue, and the integrity check --
// which already knows how to say "its expected FX_ sheet does not exist" --
// reports it on re-reading. Refusing the whole export would have punished the
// valid interfaces for a single invalid one.
// The intent is the same as before -- never produce a workbook Excel would
// refuse -- but the means has changed: the name is sanitised instead of the
// sheet being dropped, which carried its consumptions off without a word.
describe("the workbook template — an FX_ sheet with an impossible name", () => {
  const overlongName = `FX_${"A".repeat(30)}_HTTP`; // 38 caractères

  const data: WorkbookData = {
    flowTypes: [],
    actorTypes: [],
    milestones: [],
    groups: [],
    actors: [],
    interfaces: [],
    fx: [
      { name: overlongName, rows: [] },
      { name: "FX_Takodana_HTTP", rows: [] },
    ],
  };

  const sanitised = overlongName.slice(0, 31);

  it("does not fail when an FX_ sheet exceeds 31 characters", () => {
    expect(() => writeTemplate(data)).not.toThrow();
  });

  it("creates the sheet under a name Excel accepts, without touching the others", () => {
    const wb = XLSX.read(new Uint8Array(writeTemplate(data)), { type: "array" });
    expect(wb.SheetNames).toContain(sanitised);
    expect(wb.SheetNames).toContain("FX_Takodana_HTTP");
    expect(wb.SheetNames.every((n) => n.length <= 31)).toBe(true);
  });

  it("gives it its table and its validations, like the others", () => {
    expect(tablesOfTemplate(data).map((t) => t.sheet)).toContain(sanitised);
    expect(validationsOfTemplate(data).map((v) => v.sheet)).toContain(sanitised);
  });
});

describe("the workbook template — nature and relays", () => {
  it("offers the nature as a closed list on ActorTypes", () => {
    const lists = listsOfTemplate();
    expect(lists.find((l) => l.name === "L_Nature")).toBeDefined();
  });

  // The functional reading rests on two columns. "Relays", in v3, lived on the
  // interface row; it gave way to "Republished as" on the consumption row, which
  // alone knows which provider and which version the input comes from -- and
  // which a drop-down can guide.
  it("writes the two columns that carry the functional reading", () => {
    const packageBytes = writeTemplate(SAMPLE_DATA);
    const wb = XLSX.read(new Uint8Array(packageBytes), { type: "array" });
    const types = XLSX.utils.sheet_to_json<string[]>(wb.Sheets["ActorTypes"], { header: 1 })[0];
    const interfaces = XLSX.utils.sheet_to_json<string[]>(wb.Sheets["Interfaces"], { header: 1 })[0];
    const fxName = wb.SheetNames.find((n) => n.startsWith("FX_"))!;
    const fx = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[fxName], { header: 1 })[0];
    expect(types).toContain("Nature");
    expect(fx).toContain("Republished as");
    expect(interfaces).not.toContain("Relays");
  });
});

// --- QA: the workbook's two vocabularies, when they are not exactly the seed's
// size. The structured table is sized on the seed (DEFAULT_ICONS, FLOW_TYPES)
// and not on the data actually written: the drop-down targeting it therefore
// fills with blank rows when the team has removed some, and loses values when
// it has added some.
describe("the workbook template — referential tables sized on the data", () => {
  const data: WorkbookData = {
    flowTypes: [
      ["HTTP", "consumer → provider", "REST"],
      ["Kafka", "provider → consumer", "événements"],
      ["SFTP", "provider → consumer", "fichiers"],
    ],
    actorTypes: [
      ["Application", "app-window", ""],
      ["Service", "cog", ""],
      ["Packaged product", "package", ""],
      ["Partner", "handshake", ""],
      ["Person", "user", ""],
      ["Infrastructure", "server", ""],
      ["Database", "database", ""],
      ["Queue", "server", ""],
      ["Gateway", "server", ""],
    ],
    milestones: [],
    groups: [],
    actors: [],
    interfaces: [],
    fx: [],
  };

  const table = (sheet: string) => tablesOfTemplate(data).find((t) => t.sheet === sheet)!;

  it("bounds the FlowTypes table to the types actually written", () => {
    expect(table("FlowTypes").rows).toBe(data.flowTypes.length);
  });

  it("extends the ActorTypes table to every type actually written", () => {
    expect(table("ActorTypes").rows).toBe(data.actorTypes.length);
  });

  it("leaves no actor type outside the table that feeds L_TypeActeur", () => {
    const wb = XLSX.read(new Uint8Array(writeTemplate(data)), { type: "array" });
    const rows = XLSX.utils.sheet_to_json<string[]>(wb.Sheets["ActorTypes"], { header: 1, defval: "" });
    expect(rows.length - 1).toBe(table("ActorTypes").rows);
  });
});

// --- QA: the workbook sets its validations and its helper tables over a range
// frozen at 1000 rows. Beyond that, an entry is no longer checked and the
// dependent lists stop seeing the flows -- with nothing to say so.
describe("the workbook template — large workbooks", () => {
  const NB = 1200;
  const big: WorkbookData = {
    flowTypes: [], actorTypes: [], milestones: [], groups: [], actors: [], fx: [],
    interfaces: Array.from({ length: NB }, (_, i) => [
      `Flux ${i}`, "1.0", "Tatooine", "HTTP", "", "", "", "No", "", "", "",
    ]),
  };

  it("extends the validations beyond the thousandth row", () => {
    const xml = sheetXml("Interfaces", writeTemplate(big));
    const sqrefs = [...xml.matchAll(/sqref="[A-Z]+2:[A-Z]+(\d+)"/g)].map((m) => Number(m[1]));
    expect(sqrefs.length).toBeGreaterThan(0);
    expect(Math.min(...sqrefs)).toBeGreaterThan(NB);
  });

  it("extends the helper tables beyond the thousandth row", () => {
    const xml = sheetXml("Lists", writeTemplate(big));
    const dimension = xml.match(/<dimension ref="A1:[A-Z]+(\d+)"/);
    expect(Number(dimension![1])).toBeGreaterThan(NB);
  });
});

// --- QA: an FX_ sheet's "Version" list does not open while the "Flow name"
// column is empty -- the source evaluates to #N/A, the accepted price of the
// exact MATCH. Nothing said so to whoever was typing: they saw a dead list.
// Excel can show a bubble when the cell is selected; the flag was set, the text
// was missing.
describe("the workbook template — entry prompts", () => {
  const validations = () => validationsOfTemplate(SAMPLE_DATA);

  it("explains the entry order on an FX_ sheet's Version column", () => {
    const version = validations().find((v) => v.sheet.startsWith("FX_") && v.prompt?.text.includes("Flow name"));
    expect(version).toBeDefined();
  });

  it("writes the prompt into the sheet's XML", () => {
    const packageBytes = writeTemplate(SAMPLE_DATA);
    const wb = XLSX.read(new Uint8Array(packageBytes), { type: "array" });
    const fxName = wb.SheetNames.find((n) => n.startsWith("FX_") && n !== "FX_Modèle")!;
    const xml = sheetXml(fxName, packageBytes);
    expect(xml).toContain("promptTitle=");
    expect(xml).toContain("prompt=");
  });

  // Every entry column now carries its tooltip, list or no list: that was half
  // the workbook saying nothing, and precisely the half people hesitate over.
  //
  it("explains every entry column", () => {
    const sansInvite = validations().filter((v) => !v.prompt);
    expect(sansInvite).toEqual([]);
  });

  // An empty prompt has nothing to write: the workbook must not cover itself
  // d'attributs vides.
  it("never writes an empty prompt", () => {
    for (const v of validations()) {
      expect(v.prompt?.title.trim()).toBeTruthy();
      expect(v.prompt?.text.trim()).toBeTruthy();
    }
  });
});

// --- QA: the sheet name is sanitised on the tool's side (sanitiseTabName). The
// helper tables' Excel formula rebuilds that same name to find a sheet's flows:
// if it does not reproduce the sanitising identically, the dependent lists of a
// shortened-name sheet look for a sheet that does not exist, and stay empty.
//
describe("the workbook template — the Excel formula sanitises like the tool", () => {
  // Only the formula is extracted: comparing the whole XML would drown the failure.
  const helperFormula = () => {
    const xml = sheetXml("Lists", writeTemplate(SAMPLE_DATA));
    const m = xml.match(/<f t="array"[^>]*>([^<]*)<\/f>/);
    if (!m) throw new Error("no spilled-result formula in the Lists sheet");
    return m[1];
  };

  it("cuts the rebuilt name at 31 characters", () => {
    expect(helperFormula()).toContain("LEFT(");
    expect(helperFormula()).toContain(",31)");
  });

  it("replaces every character Excel forbids", () => {
    const substitutions = (helperFormula().match(/SUBSTITUTE\(/g) ?? []).length;
    expect(substitutions).toBe(7);
  });
});

// --- The validations' floor: on a small workbook the drop-down must reach well
// below the rows already written, failing which the first entry under the last
// row would no longer be checked. Measured by mutation: lowering that floor
// from 1000 to 2 made no test fail.
describe("the workbook template — the validations' floor", () => {
  it("validates far below the rows already written, even on a tiny workbook", () => {
    const xml = sheetXml("Actors", writeTemplate());
    const upTo = [...xml.matchAll(/sqref="[A-Z]+2:[A-Z]+(\d+)"/g)].map((m) => Number(m[1]));
    expect(upTo.length).toBeGreaterThan(0);
    expect(Math.min(...upTo)).toBeGreaterThanOrEqual(1000);
  });
});

// --- QA: the tool set no document property at all. A workbook it had just
// produced therefore reread WITHOUT a save date, and every diagram's title block
// announced "save date unknown" over fresh data -- which makes the tool look
// like it reads Excel files badly.
describe("writeTemplate — the document properties", () => {
  const THE_DAY = new Date("2026-08-22T09:00:00Z");

  it("writes the save date, and the re-reading finds it again", () => {
    expect(parseWorkbook(writeTemplate(SAMPLE_DATA, THE_DAY)).savedAt?.toISOString()).toBe(
      "2026-08-22T09:00:00.000Z"
    );
  });

  // The date is injected, not read from the clock: that is what makes the writing
  // reproducible, as the upgrade already does.
  it("takes the date it is given rather than the current time", () => {
    const other = new Date("2020-01-02T03:04:05Z");
    expect(parseWorkbook(writeTemplate(SAMPLE_DATA, other)).savedAt?.toISOString()).toBe(other.toISOString());
  });

  // The structured tables, lists and validations are applied AFTER SheetJS has
  // written, by rewriting the zip: they must not carry away
  // docProps/core.xml au passage.
  it("keeps the date despite the workbook being rewritten", () => {
    const reread = parseWorkbook(writeTemplate(SAMPLE_DATA, THE_DAY));
    expect(reread.savedAt).not.toBeNull();
    expect(reread.sheets.some((f) => f.name === "Interfaces")).toBe(true);
  });
});

// --- The explanation sheet and the data-entry aids. Half the workbook said
// nothing: the free-entry columns had no tooltip at all, although they are the
// ones people hesitate over.
describe("the workbook template — the data-entry aids", () => {
  const entrySheets = ["Actors", "Groups", "Milestones", "ActorTypes", "FlowTypes", "Interfaces"];

  it("sets a tooltip on every column of every entry sheet", () => {
    const validations = validationsOfTemplate();
    const columnsOf: Record<string, readonly string[]> = {
      Actors: ACTOR_COLUMNS,
      Groups: GROUP_COLUMNS,
      Milestones: MILESTONE_COLUMNS,
      ActorTypes: ACTOR_TYPE_COLUMNS,
      FlowTypes: FLOW_TYPE_COLUMNS,
      Interfaces: INTERFACE_COLUMNS,
    };
    for (const sheet of entrySheets) {
      const applied = new Set(validations.filter((v) => v.sheet === sheet).map((v) => v.column));
      for (const [i] of columnsOf[sheet].entries()) {
        expect(applied, `${sheet}: column ${i + 1} without tooltip`).toContain(XLSX.utils.encode_col(i));
      }
    }
  });

  // A tooltip declared for a column that does not exist serves nobody and gives
  // the illusion of coverage.
  it("declares no tooltip for a non-existent column", () => {
    const all = [
      ...ACTOR_COLUMNS, ...GROUP_COLUMNS, ...MILESTONE_COLUMNS,
      ...ACTOR_TYPE_COLUMNS, ...FLOW_TYPE_SHEET_COLUMNS, ...INTERFACE_COLUMNS, ...FX_COLUMNS,
    ];
    for (const key of Object.keys(PROMPTS)) {
      const heading = key.includes(".") ? key.split(".")[1] : key;
      expect(all, `prompt orpheline : ${key}`).toContain(heading);
    }
  });
});

// --- The referential's two sheets: they exist whether or not a referential is
// declared, and only carry a live query -- hence a connection, a queryTable
// part -- when the corresponding URL is actually set.
describe("referential sheets", () => {
  it("adds both sheets, hidden, even with no referential", () => {
    const cfb = XLSX.CFB.read(new Uint8Array(writeTemplate()), { type: "array" });
    const workbook = readPart(cfb, "/xl/workbook.xml")!;
    expect(workbook).toContain(`name="${REF_ACTORS_SHEET}"`);
    expect(workbook).toContain(`name="${REF_TECHNOLOGIES_SHEET}"`);
    for (const name of [REF_ACTORS_SHEET, REF_TECHNOLOGIES_SHEET]) {
      const sheet = new RegExp(`<sheet name="${name}"[^>]*state="hidden"`).test(workbook);
      expect(sheet).toBe(true);
    }
  });

  it("writes no query when the workbook declares no referential", () => {
    const cfb = XLSX.CFB.read(new Uint8Array(writeTemplate()), { type: "array" });
    expect(XLSX.CFB.find(cfb, "/customXml/item1.xml")).toBeFalsy();
    expect(XLSX.CFB.find(cfb, "/xl/connections.xml")).toBeFalsy();
  });

  it("carries the URL through to the written workbook", async () => {
    const bytes = writeTemplate({
      flowTypes: [], actorTypes: [], milestones: [], groups: [], actors: [], interfaces: [], fx: [],
      referential: "https://tenant.sharepoint.com/sites/SI/Documents/referential.xlsx",
    });
    expect(await readReferentialUrl(bytes)).toBe("https://tenant.sharepoint.com/sites/SI/Documents/referential.xlsx");
  });

  it("feeds the actor and flow-type drop-downs from the referential", () => {
    const cfb = XLSX.CFB.read(new Uint8Array(writeTemplate()), { type: "array" });
    const workbook = readPart(cfb, "/xl/workbook.xml")!;
    expect(workbook).toContain("L_RefActeur");
    expect(workbook).toContain("L_RefTypeFlux");
  });
});

// The derived columns hold formulas, and a formula written by the tool carries
// no cached value until Excel computes it. A workbook downloaded and dropped
// straight back in must not lose its icons, its natures and -- worse -- its
// directions, without which no arrow is drawn.
describe("the workbook template — what the sheet cannot say yet, the hidden list says", () => {
  const written = () =>
    writeTemplate({
      flowTypes: [["HTTP", "", ""]],
      actorTypes: [["Application", "", ""]],
      milestones: [],
      groups: [["Core", "Platform"]],
      actors: [["Tatooine", "Core", "Application", "", "", "", "", ""]],
      interfaces: [["Authent", "", "Tatooine", "HTTP", "", "", "", "", "No", "", ""]],
      fx: [{ name: "FX_Tatooine_HTTP", rows: [] }],
      referentialRows: {
        RefActorTypes: [["Application", "app-window", "Technical", ""]],
        RefTechnologies: [["HTTP", "provider → consumer", "Pushed", "#1f5fae"]],
      },
    });

  it("reads a type's icon and nature back from the hidden list", () => {
    const result = buildModel(parseWorkbook(written()));
    if (!result.ok) throw new Error("unreadable workbook");
    const type = result.model.actorTypes[0];
    expect(type.icon).toBe("app-window");
    expect(type.nature).toBe("Technical");
  });

  it("reads a technology's direction back from the hidden list", () => {
    const result = buildModel(parseWorkbook(written()));
    if (!result.ok) throw new Error("unreadable workbook");
    expect(result.model.flowTypes[0].direction).toBe("provider-to-consumer");
    expect(result.model.flowTypes[0].description).toBe("Pushed");
  });

  // Nothing is invented: a name the hidden list does not carry keeps saying
  // nothing, and the integrity check that exists for it says so.
  it("leaves a type the hidden list does not carry alone", () => {
    const bytes = writeTemplate({
      flowTypes: [], actorTypes: [["Mainframe", "", ""]], milestones: [], groups: [],
      actors: [], interfaces: [], fx: [],
      referentialRows: { RefActorTypes: [["Application", "app-window", "Business", ""]] },
    });
    const result = buildModel(parseWorkbook(bytes));
    if (!result.ok) throw new Error("unreadable workbook");
    expect(result.model.actorTypes[0].icon).toBe("");
  });
});

// A formula cell with no value at all is dropped on the way out -- SheetJS
// writes nothing for it -- and the column came back empty in the file while
// looking right in the tests. The cached value is the lookup worked out here:
// Excel recomputes it, but until it does the file must show the icon.
describe("the workbook template — the derived cells reach the file", () => {
  const sample = () =>
    XLSX.read(new Uint8Array(writeTemplate(SAMPLE_DATA)), { type: "array" });

  it("writes both the formula and the value it resolves to", () => {
    const cell = sample().Sheets.ActorTypes.B2;
    expect(cell.f).toContain("RefActorTypes!$");
    expect(cell.v).toBe("app-window");
  });

  it("does the same for a technology's direction", () => {
    const cell = sample().Sheets.FlowTypes.B2;
    expect(cell.f).toContain("RefTechnologies!$");
    expect(cell.v).not.toBe("");
  });
});
