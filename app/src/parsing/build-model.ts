import type {
  RawSheet,
  ParsedWorkbook,
  Actor,
  Group,
  ActorType,
  FlowType,
  Milestone,
  Validity,
  InterfaceCatalogue,
  Consumption,
  BuildModelResult,
  BlockingError,
  ReferentialActor,
  ReferentialTechnology,
} from "./model";
import { matchesSheetName, hasPrefix, findHeader } from "./headers";
import { normalizeText } from "../shared/text";

const FORBIDDEN_CHARACTERS = /[:\\/?*[\]]/;
// The same, one by one: the helper tables' Excel formula must reproduce this
// sanitising identically, and a regular expression cannot be written there.
export const FORBIDDEN_TAB_CHARACTERS = [":", "\\", "/", "?", "*", "[", "]"];
export const REMPLACEMENT_ONGLET = "-";
export const MAX_TAB_LENGTH = 31;

// The state belongs to the FLOW, not to the component: an actor no longer has
// a status. Carrying it on both sides meant an actor marked decommissioned
// silently extinguished flows that were declared active.
export const MILESTONE_COLUMNS = ["Milestone", "Rank", "Label", "Status", "Date", "Description"];
// The two validity bounds, added as they are to every sheet carrying datable
// objects. Declared once: they must stay identical from one sheet to the next,
// otherwise the temporal checks would read different columns depending on the
// object.
export const VALIDITY_COLUMNS = ["Introduced at", "Retired at"];

// Columns of the original format that the current one no longer produces: the
// milestone axis says the same thing, better. They are still READ, and only
// read, so the upgrade knows what to convert. They appear in no COLUMNS_*, so
// neither the blank template nor any produced workbook carries them, and their
// absence is never reported.
export const LEGACY_STATE_COLUMN = "État";
export const LEGACY_STATUS_COLUMN = "Statut";

export const ACTOR_COLUMNS = ["Name", "Group", "Actor type", "Owner", "Description", "Comments", ...VALIDITY_COLUMNS];

// The two sheets the external referential fills. They exist whether or not a
// referential is declared: the schema must not depend on a URL being set, or a
// workbook would change shape the day someone types one in.
export const REF_ACTORS_SHEET = "RefActors";
export const REF_TECHNOLOGIES_SHEET = "RefTechnologies";
export const REF_ACTOR_COLUMNS = ["Name", "Group", "Actor type", "Owner", "Description"];
export const REF_TECHNOLOGY_COLUMNS = ["Flow type", "Direction", "Description", "Colour"];

export const GROUP_COLUMNS = ["Group", "Perimeter"];
// "Preview" is a calculated column of the workbook, not data: the template
// puts a formula there showing the chosen icon. The parser ignores it.
export const ACTOR_TYPE_COLUMNS = ["Actor type", "Icon", "Nature"];
export const ICON_PREVIEW_COLUMN = "Preview";
export const FLOW_TYPE_COLUMNS = ["Flow type", "Direction", "Description"];
export const INTERFACE_COLUMNS = ["Flow name", "Version", "Provider", "Flow type", "Description", "Contract link", "Contract reference", "Comments", "To confirm", ...VALIDITY_COLUMNS];
// "Republished as" carries the functional reading on the side where the
// information already exists. A technical actor consumes a flow and republishes
// it under one of ITS interfaces: it is that consumption row that knows which
// provider and which version are involved. One value per row -- hence an
// ordinary drop-down, where v3's Relays column, which named several sources in
// a single cell, allowed none.
export const REPUBLICATION_COLUMN = "Republished as";
// Carried the functional reading in v3, on the interface row.
const LEGACY_RELAY_COLUMN = "Relays";
// The technologies' colour comes from the external referential. The column is
// not in the schema: read if present, ignored otherwise -- a workbook without
// it is not at fault, it falls back on the palette.
const FLOW_COLOUR_COLUMNS = ["Colour", "Color", "Couleur"];
export const FX_COLUMNS = ["Flow name", "Version", "Consumer", "Usage", "Criticality for this consumer", "Decision", "Comments", REPUBLICATION_COLUMN, ...VALIDITY_COLUMNS];

// The workbook's schema number, written on a hidden sheet. A monotonic
// integer, not a semver: it serves only to know which transformations to
// apply, and in what order.
export const SCHEMA_VERSION = 5;
export const VERSION_SHEET = "Version";
export const SCHEMA_VERSION_COLUMN = "Model version";

// A missing sheet, an empty sheet or an unreadable value: version 0, that is,
// "before versioning". Nothing more is guessed -- the upgrade will know what to
// do, and erring upwards would mean reading a workbook with columns it does
// not have.
function readSchemaVersion(sheets: RawSheet[]): number {
  const sheet = sheets.find((s) => matchesSheetName(s.name, VERSION_SHEET));
  if (!sheet) return 0;
  const header = findHeader(sheet.headers, SCHEMA_VERSION_COLUMN);
  if (!header) return 0;
  const raw = (sheet.rows[0]?.values[header] ?? "").toString().trim();
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function findSheet(sheets: RawSheet[], name: string): RawSheet | undefined {
  return sheets.find((s) => matchesSheetName(s.name, name));
}

function buildHeaderMap(actualHeaders: string[], expected: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const column of expected) {
    const found = findHeader(actualHeaders, column);
    if (found) map.set(column, found);
  }
  return map;
}

function get(row: Record<string, string>, headerMap: Map<string, string>, canonical: string): string {
  const actual = headerMap.get(canonical);
  return actual ? (row[actual] ?? "").toString().trim() : "";
}

function rowHasContent(row: Record<string, string>, headerMap: Map<string, string>, columns: string[]): boolean {
  return columns.some((c) => get(row, headerMap, c) !== "");
}

// Both normalisations still accept v2's spelling: a v2 workbook must read
// correctly in order to be converted, and these two values are interpreted at
// read time, not at conversion time.
function normDirection(raw: string): "provider-to-consumer" | "consumer-to-provider" {
  const v = normalizeText(raw);
  const toConsumer = v.startsWith(normalizeText("provider")) || v.startsWith(normalizeText("exposant"));
  return toConsumer ? "provider-to-consumer" : "consumer-to-provider";
}

function normYes(raw: string): boolean {
  const v = normalizeText(raw);
  return v === normalizeText("yes") || v === normalizeText("oui");
}

function validity(row: Record<string, string>, headerMap: Map<string, string>): Validity {
  return {
    introducedAt: get(row, headerMap, "Introduced at"),
    retiredAt: get(row, headerMap, "Retired at"),
  };
}

// What Excel accepts as a sheet name, not a rule of ours: at most 31
// characters, none of the seven forbidden characters. Exported so that
// legacy-upgrade.ts consumes it too -- without it, the parser and the
// migration could one day judge the same name differently, and produce a
// workbook whose missing sheet could never have been created.
export function isValidTabName(name: string): boolean {
  return name.length <= 31 && !FORBIDDEN_CHARACTERS.test(name);
}

// The convention binding a consumption to its interface (§3.3): rebuilt here,
// in the helper tables' Excel formula (template-export.ts) and in the legacy
// migration (legacy-upgrade.ts). One single place, so that the three cannot
// drift apart from one another.
export const FX_SHEET_PREFIX = "FX_";
export const FX_SHEET_SEPARATOR = "_";

// Excel refuses a name longer than 31 characters or carrying one of: \ / ? * [ ].
// The name being DERIVED, an actor with a slightly long name produced an
// impossible sheet -- which the writing dropped in silence, taking its
// consumptions with it. So it is sanitised here, at the one place the name is
// made, rather than letting the problem reach the workbook.
//
// Two (publisher, type) pairs can now land on the same name once cut: an
// integrity check reports it rather than merging them.
export function sanitiseTabName(name: string): string {
  const withoutForbidden = FORBIDDEN_TAB_CHARACTERS.reduce(
    (current, interdit) => current.split(interdit).join(REMPLACEMENT_ONGLET),
    name
  );
  return withoutForbidden.slice(0, MAX_TAB_LENGTH);
}

export function expectedFxSheet(providerName: string, flowType: string): string {
  return sanitiseTabName(`${FX_SHEET_PREFIX}${providerName}${FX_SHEET_SEPARATOR}${flowType}`);
}

export function buildModel(workbook: ParsedWorkbook): BuildModelResult {
  const errors: BlockingError[] = [];

  const actorsSheet = findSheet(workbook.sheets, "Actors");
  const flowTypesSheet = findSheet(workbook.sheets, "FlowTypes");
  const interfacesSheet = findSheet(workbook.sheets, "Interfaces");

  if (!actorsSheet) errors.push({ message: 'Sheet "Actors" missing from the workbook.' });
  if (!flowTypesSheet) errors.push({ message: 'Sheet "FlowTypes" missing from the workbook.' });
  if (!interfacesSheet) errors.push({ message: 'Sheet "Interfaces" missing from the workbook.' });

  if (actorsSheet && !findHeader(actorsSheet.headers, "Name")) {
    errors.push({ message: 'Key column "Name" missing from sheet "Actors".' });
  }
  if (flowTypesSheet && !findHeader(flowTypesSheet.headers, "Flow type")) {
    errors.push({ message: 'Key column "Flow type" missing from sheet "FlowTypes".' });
  }
  if (interfacesSheet && !findHeader(interfacesSheet.headers, "Flow name")) {
    errors.push({ message: 'Key column "Flow name" missing from sheet "Interfaces".' });
  }

  if (!actorsSheet || !flowTypesSheet || !interfacesSheet || errors.length > 0) {
    return { ok: false, errors };
  }

  const actorHeaders = actorsSheet.headers;
  const flowTypeHeaders = flowTypesSheet.headers;
  const headersInterfaces = interfacesSheet.headers;

  const missingOptionalColumns: { sheet: string; column: string }[] = [];
  function noteMissingColumns(sheet: string, actualHeaders: string[], expected: string[]) {
    for (const column of expected) {
      if (!findHeader(actualHeaders, column)) {
        missingOptionalColumns.push({ sheet, column });
      }
    }
  }

  noteMissingColumns("Actors", actorHeaders, ACTOR_COLUMNS.filter((c) => c !== "Name"));
  noteMissingColumns("FlowTypes", flowTypeHeaders, FLOW_TYPE_COLUMNS.filter((c) => c !== "Flow type"));
  noteMissingColumns("Interfaces", headersInterfaces, INTERFACE_COLUMNS.filter((c) => c !== "Flow name"));

  const headerMapActors = buildHeaderMap(actorHeaders, ACTOR_COLUMNS);
  const actors: Actor[] = actorsSheet.rows
    .filter(({ values: r }) => rowHasContent(r, headerMapActors, ACTOR_COLUMNS))
    .map(({ row, values: r }) => ({
      sheet: actorsSheet.name,
      row,
      name: get(r, headerMapActors, "Name"),
      group: get(r, headerMapActors, "Group"),
      actorType: get(r, headerMapActors, "Actor type"),
      owner: get(r, headerMapActors, "Owner"),
      description: get(r, headerMapActors, "Description"),
      comments: get(r, headerMapActors, "Comments"),
      ...validity(r, headerMapActors),
    }))
    .filter((a) => a.name !== "");

  // The "Groups" sheet: the ONLY source of the perimeter. Its absence is not
  // made up for -- guessing the perimeter from the actors would give two
  // competing truths on the same question again. An integrity check asks for the
  // sheet, and without it no actor is placed.
  const groupsSheet = findSheet(workbook.sheets, "Groups");
  let groups: Group[] = [];
  let groupsSheetMissing = true;
  if (groupsSheet && findHeader(groupsSheet.headers, "Group")) {
    groupsSheetMissing = false;
    noteMissingColumns("Groups", groupsSheet.headers, GROUP_COLUMNS.filter((c) => c !== "Group"));
    const headerMapGroups = buildHeaderMap(groupsSheet.headers, GROUP_COLUMNS);
    groups = groupsSheet.rows
      .filter(({ values: r }) => rowHasContent(r, headerMapGroups, GROUP_COLUMNS))
      .map(({ row, values: r }) => ({
        sheet: groupsSheet.name,
        row,
        name: get(r, headerMapGroups, "Group"),
        perimeter: get(r, headerMapGroups, "Perimeter"),
      }))
      .filter((g) => g.name !== "");
  }

  // The "ActorTypes" sheet: which icon which type carries. The list of types is
  // particular to each referential, so it is the workbook that names it.
  // Optional, like "Groups": without it the nodes carry the neutral token and an
  // integrity check reports it.
  const actorTypesSheet = findSheet(workbook.sheets, "ActorTypes");
  let actorTypes: ActorType[] = [];
  if (actorTypesSheet && findHeader(actorTypesSheet.headers, "Actor type")) {
    noteMissingColumns("ActorTypes", actorTypesSheet.headers, ACTOR_TYPE_COLUMNS.filter((c) => c !== "Actor type"));
    const headerMapActorTypes = buildHeaderMap(actorTypesSheet.headers, ACTOR_TYPE_COLUMNS);
    actorTypes = actorTypesSheet.rows
      .filter(({ values: r }) => rowHasContent(r, headerMapActorTypes, ACTOR_TYPE_COLUMNS))
      .map(({ row, values: r }) => ({
        sheet: actorTypesSheet.name,
        row,
        type: get(r, headerMapActorTypes, "Actor type"),
        icon: get(r, headerMapActorTypes, "Icon"),
        nature: get(r, headerMapActorTypes, "Nature"),
      }))
      .filter((t) => t.type !== "");
  }

  const headerMapFlowTypes = buildHeaderMap(flowTypeHeaders, FLOW_TYPE_COLUMNS);
  const colourHeader = FLOW_COLOUR_COLUMNS.map((c) => findHeader(flowTypeHeaders, c)).find(Boolean);
  const flowTypes: FlowType[] = flowTypesSheet.rows
    .filter(({ values: r }) => rowHasContent(r, headerMapFlowTypes, FLOW_TYPE_COLUMNS))
    .map(({ row, values: r }) => ({
      sheet: flowTypesSheet.name,
      row,
      type: get(r, headerMapFlowTypes, "Flow type"),
      direction: normDirection(get(r, headerMapFlowTypes, "Direction")),
      rawDirection: get(r, headerMapFlowTypes, "Direction"),
      colour: colourHeader ? (r[colourHeader] ?? "").toString().trim() : "",
      description: get(r, headerMapFlowTypes, "Description"),
    }))
    .filter((t) => t.type !== "");

  // The two referential sheets. Absent, they yield nothing: a workbook that
  // declares no referential is not incomplete, it simply has none.
  const refActorsSheet = findSheet(workbook.sheets, REF_ACTORS_SHEET);
  const headerMapRefActors = buildHeaderMap(refActorsSheet?.headers ?? [], REF_ACTOR_COLUMNS);
  const referentialActors: ReferentialActor[] = (refActorsSheet?.rows ?? [])
    .map(({ values: r }) => ({
      name: get(r, headerMapRefActors, "Name"),
      group: get(r, headerMapRefActors, "Group"),
      actorType: get(r, headerMapRefActors, "Actor type"),
      owner: get(r, headerMapRefActors, "Owner"),
      description: get(r, headerMapRefActors, "Description"),
    }))
    .filter((a) => a.name !== "");

  const refTechnologiesSheet = findSheet(workbook.sheets, REF_TECHNOLOGIES_SHEET);
  const headerMapRefTechnologies = buildHeaderMap(refTechnologiesSheet?.headers ?? [], REF_TECHNOLOGY_COLUMNS);
  const referentialTechnologies: ReferentialTechnology[] = (refTechnologiesSheet?.rows ?? [])
    .map(({ values: r }) => ({
      type: get(r, headerMapRefTechnologies, "Flow type"),
      direction: get(r, headerMapRefTechnologies, "Direction"),
      description: get(r, headerMapRefTechnologies, "Description"),
      colour: get(r, headerMapRefTechnologies, "Colour"),
    }))
    .filter((t) => t.type !== "");

  const milestonesSheet = findSheet(workbook.sheets, "Milestones");
  const milestones: Milestone[] = [];
  if (milestonesSheet) {
    noteMissingColumns("Milestones", milestonesSheet.headers, MILESTONE_COLUMNS.filter((c) => c !== "Milestone"));
    const headerMapMilestones = buildHeaderMap(milestonesSheet.headers, MILESTONE_COLUMNS);
    for (const { row, values: r } of milestonesSheet.rows) {
      if (!rowHasContent(r, headerMapMilestones, MILESTONE_COLUMNS)) continue;
      const name = get(r, headerMapMilestones, "Milestone");
      if (name === "") continue;
      // An unreadable rank counts as 0: the row is still read and a check asks
      // for the rank, rather than making it vanish in silence.
      const rank = Number.parseInt(get(r, headerMapMilestones, "Rank"), 10);
      milestones.push({
        sheet: milestonesSheet.name,
        row,
        name,
        rank: Number.isFinite(rank) ? rank : 0,
        label: get(r, headerMapMilestones, "Label"),
        status: get(r, headerMapMilestones, "Status"),
        date: get(r, headerMapMilestones, "Date"),
        description: get(r, headerMapMilestones, "Description"),
      });
    }
    milestones.sort((a, b) => a.rank - b.rank);
  }

  const headerMapInterfaces = buildHeaderMap(headersInterfaces, [...INTERFACE_COLUMNS, LEGACY_STATE_COLUMN]);
  const interfaces: InterfaceCatalogue[] = interfacesSheet.rows
    .filter(({ values: r }) => rowHasContent(r, headerMapInterfaces, INTERFACE_COLUMNS))
    .map(({ row, values: r }) => {
      const flowName = get(r, headerMapInterfaces, "Flow name");
      const providerName = get(r, headerMapInterfaces, "Provider");
      const flowType = get(r, headerMapInterfaces, "Flow type");
      const expectedSheet = expectedFxSheet(providerName, flowType);
      return {
        sheet: interfacesSheet.name,
        row,
        flowName,
        version: get(r, headerMapInterfaces, "Version"),
        legacyState: get(r, headerMapInterfaces, LEGACY_STATE_COLUMN),
        providerName,
        flowType,
        description: get(r, headerMapInterfaces, "Description"),
        contractLink: get(r, headerMapInterfaces, "Contract link"),
        contractReference: get(r, headerMapInterfaces, "Contract reference"),
        comments: get(r, headerMapInterfaces, "Comments"),
        toConfirm: normYes(get(r, headerMapInterfaces, "To confirm")),
        expectedSheet,
        // A v3 column, replaced by "Republished as" on the consumption. It is
        // still read -- and only here -- so the upgrade can move the information;
        // nothing else consults it any more.
        legacyRelays: (() => {
          const header = findHeader(interfacesSheet.headers, LEGACY_RELAY_COLUMN);
          return header ? (r[header] ?? "").toString().trim() : "";
        })(),
        ...validity(r, headerMapInterfaces),
      };
    })
    .filter((i) => i.flowName !== "");

  const fxSheets = workbook.sheets.filter(
    // FX_Modèle was the pattern the macro copied. It no longer exists, and the
    // produced workbooks no longer carry one; it is still dropped for earlier
    // workbooks, where the sheet still lingers.
    (s) => hasPrefix(s.name, FX_SHEET_PREFIX) && !matchesSheetName(s.name, "FX_Modèle")
  );
  const fxSheetNames = fxSheets.map((s) => s.name);

  const consumptions: Consumption[] = [];
  for (const sheet of fxSheets) {
    const headersFx = sheet.headers;
    noteMissingColumns(sheet.name, headersFx, FX_COLUMNS);
    const headerMapFx = buildHeaderMap(headersFx, [...FX_COLUMNS, LEGACY_STATUS_COLUMN]);
    for (const { row, values: r } of sheet.rows) {
      if (!rowHasContent(r, headerMapFx, FX_COLUMNS)) continue;
      const flowName = get(r, headerMapFx, "Flow name");
      if (flowName === "") continue;
      consumptions.push({
        row,
        flowName,
        version: get(r, headerMapFx, "Version"),
        consumerName: get(r, headerMapFx, "Consumer"),
        usage: get(r, headerMapFx, "Usage"),
        criticality: get(r, headerMapFx, "Criticality for this consumer"),
        legacyStatus: get(r, headerMapFx, LEGACY_STATUS_COLUMN),
        decision: get(r, headerMapFx, "Decision"),
        republishedAs: get(r, headerMapFx, REPUBLICATION_COLUMN),
        comments: get(r, headerMapFx, "Comments"),
        sheet: sheet.name,
        ...validity(r, headerMapFx),
      });
    }
  }

  return {
    ok: true,
    model: {
      actors,
      groups,
      groupsSheetMissing,
      actorTypes,
      flowTypes,
      milestones,
      interfaces,
      consumptions,
      fxSheetNames,
      missingOptionalColumns,
      schemaVersion: readSchemaVersion(workbook.sheets),
      savedAt: workbook.savedAt,
      referentialActors,
      referentialTechnologies,
    },
  };
}
