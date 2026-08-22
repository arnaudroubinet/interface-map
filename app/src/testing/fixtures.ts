import type { MatrixResult, MatrixRow, MatrixCell } from "../aggregation/views";
import type {
  Actor,
  Consumption,
  Group,
  InterfaceCatalogue,
  Milestone,
  ParsedModel,
  ActorType,
  FlowType,
} from "../parsing/model";
import { SCHEMA_VERSION } from "../parsing/build-model";

// The tests' factories, in one place.
//
// These are not test fixtures: they are the EXHAUSTIVE literals of the model's
// types. Every test file used to carry its own copy -- twelve files, fourteen
// copies -- so that adding a field to Consumption cost forty-five compilation
// errors, forty-two of them in tests that had no interest in that field. Here
// it costs one.
//
// The defaults are NEUTRAL, and deliberately poor: a file that needs something
// else -- a group named "Socle", an arrival milestone -- wraps the factory
// rather than modifying it. Changing a default here would change the meaning
// of tests written elsewhere, which is exactly the trap being avoided.
//
// Never embedded in the deliverable: the entry point is src/main.ts, and
// nothing that depends on it imports this file.

export function actor(o: Partial<Actor> = {}): Actor {
  return {
    name: "A",
    group: "G",
    actorType: "Application",
    owner: "",
    description: "",
    comments: "",
    introducedAt: "",
    retiredAt: "",
    sheet: "Actors",
    row: 0,
    ...o,
  };
}

export function group(o: Partial<Group> = {}): Group {
  return { name: "G", perimeter: "Platform", sheet: "Groups", row: 0, ...o };
}

export function actorType(o: Partial<ActorType> = {}): ActorType {
  return { type: "Application", icon: "app-window", nature: "", sheet: "ActorTypes", row: 0, ...o };
}

export function flowType(o: Partial<FlowType> = {}): FlowType {
  return {
    type: "HTTP",
    direction: "consumer-to-provider",
    rawDirection: "consumer → provider",
    description: "",
    colour: "",
    sheet: "FlowTypes",
    row: 0,
    ...o,
  };
}

export function milestone(o: Partial<Milestone> = {}): Milestone {
  return {
    name: "v1",
    rank: 1,
    label: "",
    status: "Delivered",
    date: "",
    description: "",
    sheet: "Milestones",
    row: 0,
    ...o,
  };
}

export function iface(o: Partial<InterfaceCatalogue> = {}): InterfaceCatalogue {
  return {
    flowName: "F",
    version: "",
    legacyState: "",
    providerName: "A",
    flowType: "HTTP",
    description: "",
    contractLink: "",
    contractReference: "",
    comments: "",
    toConfirm: false,
    legacyRelays: "",
    expectedSheet: "FX_A_HTTP",
    introducedAt: "",
    retiredAt: "",
    sheet: "Interfaces",
    row: 0,
    ...o,
  };
}

export function consumption(o: Partial<Consumption> = {}): Consumption {
  return {
    flowName: "F",
    version: "",
    consumerName: "B",
    usage: "",
    criticality: "",
    legacyStatus: "",
    decision: "",
    comments: "",
    republishedAs: "",
    sheet: "FX_A_HTTP",
    introducedAt: "",
    retiredAt: "",
    row: 0,
    ...o,
  };
}

// The empty model, which everything is built on by override. Empty and not
// "minimal viable": a test that needs an actor says so, and the reader then
// sees in the test everything that matters to it.
export function template(o: Partial<ParsedModel> = {}): ParsedModel {
  return {
    actors: [],
    groups: [],
    groupsSheetMissing: false,
    actorTypes: [],
    flowTypes: [],
    milestones: [],
    interfaces: [],
    consumptions: [],
    fxSheetNames: [],
    missingOptionalColumns: [],
    schemaVersion: SCHEMA_VERSION,
    savedAt: null,
    ...o,
  };
}

// A test matrix, its margins computed the way buildMatrixView does: a test
// that set totals by hand could assert anything at all.
export function matrix(o: { columns: string[]; rows: MatrixRow[] }): MatrixResult {
  const total = (cells: MatrixCell[]) => cells.reduce((n, c) => n + c.count, 0);
  return {
    ...o,
    rowTotals: new Map(o.rows.map((l) => [l.actor, total([...l.cells.values()].flat())])),
    columnTotals: new Map(o.columns.map((c) => [c, total(o.rows.flatMap((l) => l.cells.get(c) ?? []))])),
  };
}
