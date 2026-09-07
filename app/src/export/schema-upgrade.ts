import type { Consumption, InterfaceCatalogue, ParsedModel } from "../parsing/model";
import {
  SCHEMA_VERSION,
  REF_ACTORS_SHEET,
  REF_GROUPS_SHEET,
  REF_ACTOR_TYPES_SHEET,
  REF_TECHNOLOGIES_SHEET,
} from "../parsing/build-model";
import { interfaceLabel, buildInterfaceLookup, findInterfaceForConsumption } from "../aggregation/core";
import { normalizeText } from "../shared/text";
import type { WorkbookData } from "./template-export";
import { NATURE_MIDDLEWARE } from "../aggregation/nature";

// What a middleware was called before the two technical roles were told apart.
const LEGACY_NATURE = "Technical";

// The anchor point of every converted workbook: "all of this already existed
// at the moment of the switch". It does not claim to say when each object
// really appeared -- that information exists nowhere in the original format,
// and inventing it would produce a false history.
export const MILESTONE_ORIGIN = "Origin";

// What the original format declared as ALREADY retired had left before the
// switch: it therefore needs a before, failing which its arrival and its
// retirement would land on the same milestone -- an empty interval, which the
// checks rightly report. "Before" is created only if something inhabits it.
//
export const MILESTONE_BEFORE = "Before";

// One step per version increment, in order. The chain is the important part:
// it allows a schema level to be added without revisiting the previous ones,
// and a workbook several versions behind to be upgraded -- a v0 crosses both
// steps, a v1 takes only the second.
// A step transforms the MODEL, not positional rows: it is the model that
// carries the meaning, and the flattening into columns comes afterwards. A
// step manipulating cell arrays would break at the first column reshuffle.
//
export interface UpgradeStep {
  de: number;
  vers: number;
  appliquer: (model: ParsedModel, context: UpgradeContext) => ParsedModel;
}

export interface UpgradeContext {
  // The date the migration runs on: it is what the Origin milestone carries.
  // Injected rather than read from the clock, so that the conversion is
  // reproducible and testable.
  dateMigration: Date;
}

function day(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// The planned milestone where everything the original format declared as
// leaving or upcoming lands. Just one, because that is all it can say: "later
// on". Splitting that "later on" would require information that exists nowhere
// in the file.
export const MILESTONE_NEXT = "Upcoming";

const matches = (value: string, expected: string) => normalizeText(value) === normalizeText(expected);

// First movement: the milestone axis replaces State and Status. The conversion
// does not merely add empty columns, it translates what the workbook already
// said about time. It reads French values, so it runs BEFORE the translation.
//
function seedMilestones(model: ParsedModel, context: UpgradeContext): ParsedModel {
  const before = {
    name: MILESTONE_BEFORE,
    rank: 1,
    label: "Before tracking",
    status: "Delivered",
    date: "",
    description: "What had already gone before the timeline was kept.",
  };
  const origin = {
    name: MILESTONE_ORIGIN,
    rank: 2,
    label: "Initial state",
    status: "Delivered",
    date: day(context.dateMigration),
    description: "Everything the workbook held when it moved onto milestones.",
  };
  const next = {
    name: MILESTONE_NEXT,
    rank: 3,
    label: "Changes already announced",
    status: "Planned",
    date: "",
    description: "What the workbook declared as going or coming before the move.",
  };

  const bounds = (v: { introducedAt: string; retiredAt: string }, removed: string, arrival = MILESTONE_ORIGIN) => ({
    introducedAt: v.introducedAt.trim() || arrival,
    retiredAt: v.retiredAt.trim() || removed,
  });

  const interfaces = model.interfaces.map((i) => {
    // Retired: already gone before the switch, hence alive "before" and retired
    // at the origin. To be decommissioned: announced, hence leaving at the next.
    const alreadyGone = matches(i.legacyState, "Retiré");
    return {
      ...i,
      ...bounds(
        i,
        alreadyGone ? MILESTONE_ORIGIN : matches(i.legacyState, "À décommissionner") ? MILESTONE_NEXT : "",
        alreadyGone ? MILESTONE_BEFORE : MILESTONE_ORIGIN
      ),
    };
  });

  // The decision does not enter the axis: "To remove" says one would like to do
  // without that consumption, never when it leaves. Only the status carries any
  // time.
  const consumptions = model.consumptions.map((c) => {
    const alreadyGone = matches(c.legacyStatus, "Décommissionné");
    return {
      ...c,
      ...bounds(
        c,
        alreadyGone ? MILESTONE_ORIGIN : "",
        alreadyGone ? MILESTONE_BEFORE : matches(c.legacyStatus, "En projet") ? MILESTONE_NEXT : MILESTONE_ORIGIN
      ),
    };
  });

  const actors = model.actors.map((a) => ({ ...a, ...bounds(a, "") }));

  const isUsed = (name: string) =>
    [...interfaces, ...consumptions, ...actors].some(
      (l) => l.introducedAt === name || l.retiredAt === name
    );

  return {
    ...model,
    // A workbook that already declared milestones keeps its own.
    // The ranks are set AFTER knowing which milestones exist: "Before" is
    // created only if it serves, and leaving a hole at rank 1 would give a
    // numbering starting at 2 with nothing to explain it.
    milestones:
      model.milestones.length > 0
        ? model.milestones
        : [...(isUsed(MILESTONE_BEFORE) ? [before] : []), origin, ...(isUsed(MILESTONE_NEXT) ? [next] : [])].map(
            // These milestones did not exist in the original workbook: their location
            // is the one they will have on writing, header included.
            (p, i) => ({ ...p, rank: i + 1, sheet: "Milestones", row: i + 2 })
          ),
    actors,
    interfaces,
    consumptions,
  };
}

// Second movement: the workbook switches to English. Sheet and column names
// are carried by the writing, which already produces them in English; what is
// left to translate is the VALUES already entered. A value that is not
// recognised is left as it is: it may be a term of the team's own, and the
// vocabulary check will report it rather than have it overwritten.
const TRANSLATED_VALUES: Record<string, string> = {
  Plateforme: "Platform",
  Externe: "External",
  "À conserver": "Keep",
  "À creuser": "Investigate",
  "À transformer": "Transform",
  "À supprimer": "Remove",
  "1 - Vitale": "1 - Critical",
  "2 - Importante": "2 - Important",
  "3 - Standard": "3 - Standard",
  Oui: "Yes",
  Non: "No",
  "exposant → consommateur": "provider → consumer",
  "consommateur → exposant": "consumer → provider",
};

function translate(value: string): string {
  const v = normalizeText(value);
  const found = Object.entries(TRANSLATED_VALUES).find(([fr]) => normalizeText(fr) === v);
  return found ? found[1] : value;
}

function translateTheValues(model: ParsedModel): ParsedModel {
  // The milestones are not translated: the original format has none, and those
  // the conversion has just set are already in English.
  return {
    ...model,
    groups: model.groups.map((g) => ({ ...g, perimeter: translate(g.perimeter) })),
    flowTypes: model.flowTypes.map((t) => ({ ...t, rawDirection: translate(t.rawDirection) })),
    consumptions: model.consumptions.map((c) => ({
      ...c,
      criticality: translate(c.criticality),
      decision: translate(c.decision),
    })),
  };
}

// An original workbook may have no groups sheet: its actors' "Groupe" column
// then carries the information on its own. The rebuild wrote model.groups as
// it was -- empty -- and the groups disappeared, leaving as many actors
// referring to a non-existent group. On a real workbook, nineteen groups lost
// at once.
//
// The perimeter, for its part, is deduced from nothing: it stays empty and
// completeness asks for it. Inventing it would give a workbook that looks
function deriveGroups(model: ParsedModel): ParsedModel {
  if (!model.groupsSheetMissing) return model;
  const names = [...new Set(model.actors.map((a) => a.group.trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "fr")
  );
  return {
    ...model,
    groupsSheetMissing: false,
    groups: names.map((name, i) => ({ name, perimeter: "", sheet: "Groups", row: i })),
  };
}

export const UPGRADE_STEPS: UpgradeStep[] = [
  // complete and is wrong.
  // Only one format ever circulated: the one from before versioning. Everything
  // that must be done to it fits in one step -- set the milestones, then
  // translate -- and the order of the two movements matters, the first reading
  // French. The new columns (interface version, validity bounds) arrive empty:
  {
    de: 0,
    vers: 1,
    appliquer: (model, context) => translateTheValues(seedMilestones(deriveGroups(model), context)),
  },
  // the rebuild produces them that way, nothing to transform.
  // v1 went to production with formulas quoting the "Listes" sheet, renamed
  // "Lists" at translation time. Excel saw in it not a mistake but a reference
  // to ANOTHER WORKBOOK: an external-links warning at every opening, and mute
  //
  // dependent drop-downs.
  // The model itself has nothing to fix: the formulas are not in it, they are
  // born at writing time. This step therefore transforms nothing -- it exists so
  // that the workbooks already distributed are recognised as stale and go back
  // through the rebuild, which writes them correctly. The Milestones sheet gains
  // the structured table it was missing along the way.
  { de: 1, vers: 2, appliquer: (model) => model },
  // The functional reading's two columns -- actor type nature, interface relay
  // -- change the workbook's shape. The model itself has nothing to convert:
  // they arrive empty, and the rebuild produces them that way. The step exists
  // so that the workbooks in circulation are recognised as stale and go back
  // through the writing.
  { de: 2, vers: 3, appliquer: (model) => model },
  // The functional reading changes carrier. In v3, the INTERFACE row named its
  // sources in a Relays column; in v4 it is the CONSUMPTION row that says under
  // which of its consumer's interfaces it comes back out. The reading direction
  // is not a detail: the consumption knows which provider and which version the
  // input comes from -- a flow name alone did not -- and one value per row can
  // be guided by a drop-down, which a cell holding several names could not.
  //
  { de: 3, vers: 4, appliquer: (model) => moveRelays(model) },
  // The workbook gains its two referential sheets and the queries that fill
  // them. The model itself has nothing to convert -- they are born at writing
  // time, like the formulas of v2. The step exists so that the workbooks
  // already distributed are recognised as stale and go back through the
  // rebuild, which is what writes the queries.
  { de: 4, vers: 5, appliquer: (model) => model },
  // The referential becomes ONE workbook read through two named tables, where
  // v5 fetched two separate CSV files. Nothing to convert here either: the
  // address does not live in the model but in the Power Query stream, and the
  // v5 one cannot be carried over -- a CSV of actors handed to Excel.Workbook
  // fails on every refresh. The step exists so that the workbooks already
  // distributed are recognised as stale, go back through the rebuild, and have
  // their URL typed once more on the repair screen.
  { de: 5, vers: 6, appliquer: (model) => model },
  // The referential gains its groups and its actor types, and its technologies
  // sheet becomes one the tool itself produces. Nothing to convert once more:
  // the two new sheets are born at writing time, empty, waiting for the query
  // to pour into them. The step exists so that the workbooks in circulation go
  // back through the rebuild, which is what creates them.
  { de: 6, vers: 7, appliquer: (model) => model },
  // The icon, the nature, the direction, the description and the colour stop
  // being typed on the cartography: they are read from the hidden lists, in
  // calculated columns. The icon preview goes with them -- it previewed a value
  // nobody chooses here any more, and it now sits in the referential, on the
  // sheet where an icon IS chosen.
  //
  // Nothing to convert in the model: what the workbook declared is carried into
  // the hidden lists by dataFromModel, so a workbook upgraded before it has any
  // referential keeps every icon and every direction it had.
  { de: 7, vers: 8, appliquer: (model) => model },
  // "Technical" splits in two. It meant CROSSED -- a bus, a gateway -- and
  // every actor wearing it was expected to republish what it consumed. That is
  // false of a bucket or a database, where the data legitimately stops, and
  // every write to one was reported as plumbing swallowing a flow.
  //
  // The word is renamed rather than reinterpreted: what was Technical is a
  // middleware, which is exactly what it used to mean. Storage is a decision
  // nobody has taken yet, so it is not taken for them -- the buckets keep the
  // type they had, and it moves the day someone says so.
  { de: 8, vers: 9, appliquer: (model) => middlewareInsteadOfTechnical(model) },
  // No step for the referential's change of carrier -- an address Excel
  // fetched, now a file dropped beside the cartography. The SHEETS did not
  // move: a v9 workbook reads exactly as before, its query is inert until
  // someone refreshes in Excel, and any rewrite by the tool leaves it out.
  // Bumping would have sent every workbook in circulation through the upgrade
  // screen for a change it cannot see.
];

// The nature is read from the hidden list now, so both sides carry it: the
// sheet the workbook declares, and the list it reads from.
function middlewareInsteadOfTechnical(model: ParsedModel): ParsedModel {
  const renamed = (nature: string) =>
    normalizeText(nature) === normalizeText(LEGACY_NATURE) ? NATURE_MIDDLEWARE : nature;
  return {
    ...model,
    actorTypes: model.actorTypes.map((t) => ({ ...t, nature: renamed(t.nature) })),
    referentialActorTypes: model.referentialActorTypes.map((t) => ({ ...t, nature: renamed(t.nature) })),
  };
}

// Each v3 relay finds the consumption it named again: the relayer's one
// carrying that flow name. What is not found is not invented -- a manufactured
// link would be worse -- but it is not lost for all that: the name v3 carried
// is copied into the interface's comments. Without that line, the cell
// disappeared at conversion and nobody ever learned what the workbook said
// before.
function moveRelays(model: ParsedModel): ParsedModel {
  const republications = new Map<Consumption, string>();
  const lost = new Map<InterfaceCatalogue, string[]>();
  for (const iface of model.interfaces) {
    for (const target of iface.legacyRelays.split(";").map((c) => c.trim()).filter(Boolean)) {
      const input = model.consumptions.find(
        (c) =>
          c.consumerName.trim() === iface.providerName.trim() &&
          normalizeText(c.flowName) === normalizeText(target) &&
          !republications.has(c)
      );
      if (input) republications.set(input, interfaceLabel(iface.flowName, iface.version));
      else lost.set(iface, [...(lost.get(iface) ?? []), target]);
    }
  }
  if (republications.size === 0 && lost.size === 0) return model;
  return {
    ...model,
    interfaces: model.interfaces.map((i) => {
      const names = lost.get(i);
      if (!names) return i;
      const note = `Schema v3 relayed: ${names.join(", ")} — no consumption of "${i.providerName}" matched, set "Republished as" by hand.`;
      return { ...i, comments: [i.comments.trim(), note].filter(Boolean).join(" ") };
    }),
    consumptions: model.consumptions.map((c) => ({ ...c, republishedAs: republications.get(c) ?? c.republishedAs })),
  };
}

// The workbook has spoken English since schema v3, drop-downs included. A
// value written in French does not belong to the vocabulary that same workbook
// sets on the column: Excel refuses the cell it has just written.
const yes = (v: boolean) => (v ? "Yes" : "No");

// The model reread, flattened back into the workbook's column order. This is a
// rebuild: what the parser did not understand is not in it.
export function dataFromModel(model: ParsedModel): WorkbookData {
  const lookup = buildInterfaceLookup(model);
  const byTab = new Map<string, string[][]>();
  // Excel does not tell apart two sheets whose names differ only by case: it
  // refuses to open the WHOLE workbook, saying nothing of the offending sheet.
  // So things are filed under the spelling already chosen -- the one the
  // interfaces set first, which is the rebuilt name.
  const existingTab = (name: string) =>
    [...byTab.keys()].find((k) => k.toLowerCase() === name.toLowerCase()) ?? name;

  for (const i of model.interfaces) {
    const tab = existingTab(i.expectedSheet);
    if (!byTab.has(tab)) byTab.set(tab, []);
  }
  for (const c of model.consumptions) {
    // A consumption goes into the sheet of the interface it is ATTACHED to, not
    // the one it was read from. The two names differ as soon as a hand-kept
    // workbook writes "FX_TATOOINE_HTTP": the parser brings them together, but
    // the writing filed the interface under the rebuilt name and the consumption
    // under the old one -- one sheet came out as two, one new and empty, and the
    // old one orphaned.
    //
    // With no match, the original sheet is kept: moving a row that names
    // nothing on one's own authority would lose it.
    const iface = findInterfaceForConsumption(lookup, c);
    const tab = existingTab(iface ? iface.expectedSheet : c.sheet);
    const rows = byTab.get(tab) ?? [];
    rows.push([
      c.flowName, c.version, c.consumerName, c.usage, c.criticality,
      c.decision, c.comments, c.republishedAs, c.introducedAt, c.retiredAt,
    ]);
    byTab.set(tab, rows);
  }

  return {
    // The workbook's own vocabularies are taken as they are: replacing them
    // with the seed would erase the types the team declared.
    flowTypes: model.flowTypes.map((t) => [t.type, t.rawDirection, t.description]),
    actorTypes: model.actorTypes.map((t) => [t.type, t.icon, t.nature]),
    milestones: model.milestones.map((p) => [p.name, String(p.rank), p.label, p.status, p.date, p.description]),
    groups: model.groups.map((g) => [g.name, g.perimeter]),
    actors: model.actors.map((a) => [
      a.name, a.group, a.actorType, a.owner, a.description, a.comments,
      a.introducedAt, a.retiredAt,
    ]),
    interfaces: model.interfaces.map((i) => [
      i.flowName,
      i.version,
      i.providerName,
      i.flowType,
      i.description,
      i.contractLink,
      i.contractReference,
      i.comments,
      yes(i.toConfirm),
      i.introducedAt,
      i.retiredAt,
    ]),
    // Every sheet an interface expects exists in the produced workbook, even if
    // empty. This is what replaces the macro: the missing sheets are no longer
    // generated from Excel, a file is returned in which none is missing. A name
    // Excel refuses is dropped -- the integrity check already reports it, and
    // manufacturing an unreadable workbook would help nobody.
    fx: [...byTab.entries()].map(([name, rows]) => ({ name, rows })),
    // The hidden lists as the workbook held them. They are what its drop-downs
    // and its calculated columns read: rewriting without them would hand back a
    // workbook whose every derived cell resolves to nothing.
    referentialRows: {
      [REF_ACTORS_SHEET]: model.referentialActors.map((a) => [a.name, a.group, a.actorType, a.owner, a.description]),
      [REF_GROUPS_SHEET]: model.referentialGroups.map((g) => [g.name, g.description]),
      [REF_ACTOR_TYPES_SHEET]: model.referentialActorTypes.map((t) => [t.type, t.icon, t.nature, t.description]),
      [REF_TECHNOLOGIES_SHEET]: model.referentialTechnologies.map((t) => [t.type, t.direction, t.description, t.colour]),
    },
  };
}

export function upgrade(model: ParsedModel, dateMigration: Date = new Date()): WorkbookData {
  // A workbook newer than the tool crosses no step and would come out labelled
  // with the tool's version: a silent downgrade, losing everything that parser
  // cannot yet read. Better to refuse and say so than to return an impoverished
  // file that looks correct.
  if (model.schemaVersion > SCHEMA_VERSION) {
    throw new Error(
      `This workbook is newer than the tool (schema ${model.schemaVersion}, tool ${SCHEMA_VERSION}). Update the tool rather than downgrade the file.`
    );
  }

  const context: UpgradeContext = { dateMigration };
  let current = model;
  for (const step of UPGRADE_STEPS) {
    if (step.de < model.schemaVersion) continue;
    if (step.vers > SCHEMA_VERSION) break;
    current = step.appliquer(current, context);
  }
  return dataFromModel(current);
}
