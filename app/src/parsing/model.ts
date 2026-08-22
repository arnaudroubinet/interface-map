export interface RawSheet {
  name: string;
  // Headers read from row 1 of the sheet itself, not inferred from `rows`: a
  // sheet that exists but holds no data row -- the FX_ tabs the tool creates
  // empty -- would otherwise have no known column at all, and would raise a
  // false "missing column" anomaly for every one of them.
  headers: string[];
  rows: RawRow[];
}

// A sheet row, with the number Excel shows for it. That number serves the
// integrity report, which quotes the location so it can be gone to and fixed:
// the array index would not do, since one blank row in between shifts it away
// from what the reader sees.
export interface RawRow {
  row: number;
  values: Record<string, string>;
}

export interface ParsedWorkbook {
  sheets: RawSheet[];
  savedAt: Date | null;
}

// Where a row comes from. This is provenance, not domain data: it does not
// describe what the row holds, it says where to find it again to correct it.
// The integrity report quotes it.
export interface Location {
  sheet: string;
  row: number;
}

// A row's two validity bounds on the milestone axis. These are MILESTONES,
// never dates: the date is carried by the milestone itself, on the Milestones
// sheet. A row does not know when it arrived, it knows at which marker. Left
// empty they keep the project's usual meaning -- "always been there" and
// "still there" -- so a workbook declaring no milestone reads exactly as
// before.
export interface Validity {
  introducedAt: string;
  retiredAt: string;
}

export interface Actor extends Validity, Location {
  name: string;
  group: string;
  actorType: string;
  owner: string;
  description: string;
  comments: string;
}

// The perimeter is carried by the GROUP, not by the actor: "Core" is the
// platform, and everything it holds belongs to it. Marking each application
// one by one left room for a mixed group -- half platform, half external --
// whose colour and whose count could not both be right.
export interface Group extends Location {
  name: string;
  perimeter: string;
}

// A milestone of the platform. Never to be confused with an interface
// contract's version, nor with the workbook's schema number: three distinct
// notions that the word "version" would cover all at once.
export interface Milestone extends Location {
  name: string;
  // Carries the order. A column rather than the order of the rows: sorting in
  // Excel would destroy an implicit order without saying a word.
  rank: number;
  label: string;
  status: string;
  date: string;
  description: string;
}

// The actor type is an open list, particular to each repository: it is the
// workbook that says which icon to give it, not the code.
export interface ActorType extends Location {
  type: string;
  icon: string;
  // Business or technical. It is the TYPE that decides, never the actor: same
  // principle as the perimeter, declared on the group and not on its members.
  // Empty means business -- a workbook that has not filled the column shows
  // everything rather than hiding actors in silence.
  nature: string;
}

export interface FlowType extends Location {
  type: string;
  direction: "provider-to-consumer" | "consumer-to-provider";
  // The value as typed in. `direction` normalises it, falling back to
  // "consumer to provider" for anything it does not recognise: without the
  // original value, a mistyped entry would reverse the arrow with nothing able
  // to report it.
  rawDirection: string;
  description: string;
  // The repository's colour, in hex, when it carries one. Empty otherwise: the
  // palette then takes over. This is what anchors a shade to its technology
  // rather than to its rank, which shifted as soon as a technology was added
  // ahead of the others alphabetically.
  colour: string;
}

export interface InterfaceCatalogue extends Validity, Location {
  flowName: string;
  // An empty version is a version, not an absence: it takes part in the
  // matching key like any other value, and that is what lets earlier workbooks
  // read identically.
  version: string;
  // Inherited from v1: the milestone axis replaced it. Read only so the schema
  // upgrade knows what to convert, never written back.
  legacyState: string;
  providerName: string;
  flowType: string;
  description: string;
  contractLink: string;
  contractReference: string;
  comments: string;
  toConfirm: boolean;
  expectedSheet: string;
  // The flow name of the interface this one extends. Filled only on interfaces
  // provided by a technical actor: it is what allows an exchange to be
  // followed through the plumbing, even as its name changes from one segment
  // to the next.
  legacyRelays: string;
}

export interface Consumption extends Validity, Location {
  flowName: string;
  // The version consumed, as written in the catalogue: it is the third term of
  // the key that attaches this row to its interface.
  version: string;
  consumerName: string;
  usage: string;
  criticality: string;
  // Inherited from v1, like InterfaceCatalogue.legacyState.
  legacyStatus: string;
  decision: string;
  comments: string;
  // Filled only when the consumer is a technical actor: the name of WHICH OF
  // ITS OWN interfaces republishes this flow. This is what folds a chain in
  // the functional reading, and it is carried by the consumption because the
  // consumption is the line that names the original provider and version.
  republishedAs: string;
  sheet: string;
}

// A row of the external referential. It carries no Location: nothing points at
// it in the report -- an anomaly is reported where the value is USED, on the
// Actors or FlowTypes sheet, which is where it can be corrected.
export interface ReferentialActor {
  name: string;
  group: string;
  actorType: string;
  owner: string;
  description: string;
}

export interface ReferentialTechnology {
  type: string;
  direction: string;
  description: string;
  // Hexadecimal, as the workbook's own Colour column carries it. Empty when the
  // referential declares none.
  colour: string;
}

export interface ParsedModel {
  actors: Actor[];
  groups: Group[];
  actorTypes: ActorType[];
  // True when the "Groups" sheet is missing. No perimeter is then known: it is
  // not guessed, an integrity check asks for the sheet.
  groupsSheetMissing: boolean;
  flowTypes: FlowType[];
  // Declared by the Milestones sheet, sorted by rank. Empty when the sheet is
  // missing.
  milestones: Milestone[];
  interfaces: InterfaceCatalogue[];
  consumptions: Consumption[];
  fxSheetNames: string[];
  missingOptionalColumns: { sheet: string; column: string }[];
  // The workbook's schema number: 0 for any workbook older than its
  // introduction. Decides whether the tool can read this file as it stands.
  schemaVersion: number;
  savedAt: Date | null;
  // What the external referential publishes, when the workbook carries one.
  // Empty otherwise -- and an empty referential is not a fault: the workbook
  // must work without one.
  referentialActors: ReferentialActor[];
  referentialTechnologies: ReferentialTechnology[];
}

export interface BlockingError {
  message: string;
}

export type BuildModelResult =
  | { ok: true; model: ParsedModel }
  | { ok: false; errors: BlockingError[] };
