import { AVAILABLE_ICONS } from "../render/icons";

// The same format the palette accepts (render/colors.ts).
const HEX_COLOUR = /^#?[0-9a-f]{6}$/i;
import type {
  Actor,
  Consumption,
  Location,
  Group,
  InterfaceCatalogue,
  Milestone,
  ParsedModel,
  ActorType,
  FlowType,
  Validity,
} from "../parsing/model";
import {
  buildInterfaceLookup,
  findInterfaceForConsumption,
  interfaceKey,
  interfaceLabel,
  nameKey,
  nameVersionKey,
  type InterfaceLookup,
} from "../aggregation/core";
import { lifespanOf, isLiveAt, intervalsMeet, ALWAYS, type Interval } from "../aggregation/milestones";
import { HEXA, LINE_THRESHOLD } from "../render/colors";
import { contrastRatio } from "../render/contrast";
import { MAX_TAB_LENGTH } from "../parsing/build-model";
import { isTechnicalActor, isRelayActor, ACCEPTED_NATURES } from "../aggregation/nature";
import {
  VOCABULARY_DIRECTION,
  VOCABULARY_DECISION,
  VOCABULARY_CRITICALITY,
  VOCABULARY_NATURE,
  VOCABULARY_PERIMETER,
} from "../aggregation/vocabularies";
import { brokenChains } from "../aggregation/reading";
import { normalizeText, nearDuplicate } from "../shared/text";

export interface Anomaly {
  message: string;
  // Where to go and fix it. Absent when the anomaly targets no row: a missing
  // sheet, a workbook delivered without milestones. Those anomalies go at the
  // head of the report, as they concern the file and not an entry.
  location?: Location;
}

// The single factory for a message's subject: what is being talked about, then
// where to find it again. Every message targeting a row goes through here,
// otherwise the address would be written three ways depending on the family.
function address(e: Location): string {
  return `(${e.sheet}, row ${e.row})`;
}

function located(what: string, name: string, e: Location): string {
  return `${what} "${name}" ${address(e)}`;
}

const nameActor = (a: Actor) => located("Actor", a.name, a);
const nameInterface = (i: InterfaceCatalogue) => located("Interface", interfaceLabel(i.flowName, i.version), i);
const nameConsumption = (c: Consumption) => located("Consumption", c.flowName, c);
const nameGroup = (g: Group) => located("Group", g.name, g);
const nameActorType = (t: ActorType) => located("Actor type", t.type, t);
const nameFlowType = (t: FlowType) => located("Flow type", t.type, t);
const nameMilestone = (p: Milestone) => located("Milestone", p.name, p);

// A block's items follow the same order as the anomalies: the sheet, then the
// row. They carry their address in the text, for want of having, as an anomaly
// does, a field to hold it.
function locatedItems<T extends Location>(rows: T[], text: (l: T) => string): string[] {
  return [...rows]
    .sort((a, b) => a.sheet.localeCompare(b.sheet, "fr") || a.row - b.row)
    .map(text);
}

function anomaly(message: string, e?: Location): Anomaly {
  return e ? { message, location: { sheet: e.sheet, row: e.row } } : { message };
}

// What has no address first -- it targets the whole file, so it reads before
// any data-entry correction. The rest follows the workbook: sheet, then
// increasing row, the order in which it will be fixed.
function byLocation(anomalies: Anomaly[]): Anomaly[] {
  return [...anomalies].sort((a, b) => {
    if (!a.location || !b.location) return (a.location ? 1 : 0) - (b.location ? 1 : 0);
    return (
      a.location.sheet.localeCompare(b.location.sheet, "fr") ||
      a.location.row - b.location.row
    );
  });
}

export interface AnomalyFamily {
  id: string;
  title: string;
  description: string;
  anomalies: Anomaly[];
}

export interface InfoBlock {
  id: string;
  title: string;
  description: string;
  items: string[];
  // "warning" reports an entry to be decided, not a fault: it is counted and
  // seen, but it does not divert the user from their diagrams on load, unlike
  // anomalies.
  // "action": the file is correct, but a decision is waiting for someone. That
  // is something other than a warning, which reports a missing entry.
  level: "info" | "action" | "warning";
}

export interface IntegrityReport {
  families: AnomalyFamily[];
  infoBlocks: InfoBlock[];
  totalAnomalies: number;
  totalActions: number;
  totalWarnings: number;
}

function actorByName(model: ParsedModel): Map<string, Actor> {
  const map = new Map<string, Actor>();
  for (const a of model.actors) map.set(a.name.trim(), a);
  return map;
}

// The matching of a consumption to its interface is defined once, in
// aggregation/core: the report and the diagram must read the same row the same
// way, otherwise they contradict each other on the same file.

// The same resolution as findInterfaceForConsumption (exact key, name
// fallback): a consumption filed in the wrong sheet stays attached to the
// interface the diagram actually associates it with (aggregation/core.ts),
// rather than ignored here — otherwise §7.3/§7.5 and the diagram would
// contradict each other on the same misfiled row.
function consumptionsForInterface(lookup: InterfaceLookup, model: ParsedModel, iface: InterfaceCatalogue): Consumption[] {
  return model.consumptions.filter((c) => findInterfaceForConsumption(lookup, c) === iface);
}

function citedBounds(where: string, v: Validity & Location) {
  return [v.introducedAt, v.retiredAt]
    .filter((value) => value.trim() !== "")
    .map((value) => ({ where, value, location: v as Location }));
}

function duplicates(values: string[]): string[] {
  const counts = new Map<string, number>();
  for (const v of values) {
    const key = v.trim();
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].filter(([, n]) => n > 1).map(([k]) => k);
}

function checkStructure(model: ParsedModel): AnomalyFamily {
  const anomalies: Anomaly[] = [];

  for (const { sheet, column } of model.missingOptionalColumns) {
    anomalies.push({ message: `Column "${column}" missing from sheet "${sheet}".` });
  }

  for (const name of duplicates(model.actors.map((a) => a.name))) {
    // The row quoted is the second: the first is legitimate, it is the duplicate
    // that will be removed.
    const duplicate = model.actors.filter((a) => a.name.trim() === name)[1];
    anomalies.push(anomaly(`${nameActor(duplicate)} is declared more than once in the repository.`, duplicate));
  }

  // On (publisher, name, version) and not on the name alone. Two versions of one
  // contract are two legitimate rows, that being the column's whole point; and
  // two actors may publish a contract of the same name without having agreed on
  // it, which makes two distinct interfaces -- not a duplicate.
  const identity = (i: InterfaceCatalogue) =>
    `${normalizeText(i.providerName)}\u0000${normalizeText(interfaceLabel(i.flowName, i.version))}`;
  for (const key of duplicates(model.interfaces.map(identity))) {
    const duplicate = model.interfaces.filter((i) => identity(i) === key)[1];
    anomalies.push(
      anomaly(`${nameInterface(duplicate)} is published more than once by "${duplicate.providerName}".`, duplicate)
    );
  }

  // The roadmap itself was not checked. An unreadable rank counts as 0 on
  // reading, so that the row does not vanish silently -- but that must still be
  // said: otherwise the roadmap starts from zero and the current milestone
  // designates the wrong one, with no anomaly to explain it.
  for (const milestone of model.milestones) {
    if (milestone.rank > 0) continue;
    anomalies.push(anomaly(`Milestone "${milestone.name}" has no usable rank; a milestone is placed by a rank of 1 or more.`, milestone));
  }

  // Two milestones separated only by case or an accent blur together: every
  // dated row resolves its rank on the NORMALISED name and so takes the first of
  // the two. Actors and interfaces had this check, the roadmap did not.
  //
  for (const name of duplicates(model.milestones.map((p) => normalizeText(p.name)))) {
    const duplicate = model.milestones.filter((p) => normalizeText(p.name) === name)[1];
    anomalies.push(
      anomaly(`Milestone "${duplicate.name}" repeats an earlier milestone; the timeline cannot tell them apart.`, duplicate)
    );
  }

  // Two flow types separated only by case blur together: colour matching was
  // made case-insensitive, so "HTTP" and "http" now get the SAME colour, with
  // nothing else in the workbook to say they are meant to be the same
  // technology.
  for (const type of duplicates(model.flowTypes.map((t) => normalizeText(t.type)))) {
    const duplicate = model.flowTypes.filter((t) => normalizeText(t.type) === type)[1];
    anomalies.push(anomaly(`${nameFlowType(duplicate)} is declared more than once in the repository.`, duplicate));
  }

  // The sheet name is cut to what Excel accepts: two different (publisher, flow
  // type) pairs can therefore land on the same one. Merging them would mix two
  // contracts' consumptions without a word -- it is said, and it is an actor or
  // type name that must be shortened.
  const pairsBySheet = new Map<string, { provider: string; type: string }>();
  for (const i of model.interfaces) {
    const pair = { provider: i.providerName.trim(), type: i.flowType.trim() };
    const already = pairsBySheet.get(normalizeText(i.expectedSheet));
    if (!already) {
      pairsBySheet.set(normalizeText(i.expectedSheet), pair);
      continue;
    }
    if (already.provider === pair.provider && already.type === pair.type) continue;
    anomalies.push(
      anomaly(
        `${nameInterface(i)}: "${pair.provider}" / "${pair.type}" and "${already.provider}" / "${already.type}" both land on the same sheet "${i.expectedSheet}" once cut to ${MAX_TAB_LENGTH} characters. Shorten one of the names.`,
        i
      )
    );
  }

  const normalisedFx = new Set(model.fxSheetNames.map((n) => normalizeText(n)));
  for (const iface of model.interfaces) {
    if (!normalisedFx.has(normalizeText(iface.expectedSheet))) {
      anomalies.push(
        anomaly(`${nameInterface(iface)}: sheet "${iface.expectedSheet}" missing from the workbook.`, iface)
      );
    }
  }

  const expected = new Set(model.interfaces.map((i) => normalizeText(i.expectedSheet)));
  for (const sheet of model.fxSheetNames) {
    if (!expected.has(normalizeText(sheet))) {
      anomalies.push(anomaly(`Sheet "${sheet}" is present but no interface points to it.`));
    }
  }

  // The perimeter is a property of the group. Without this sheet it is deduced
  // from the actors -- a mixed group then becomes "Platform" as soon as a single
  // one of its members is, which distorts colours and counts.
  // Only once an actor exists: a blank workbook declares no type because it
  // takes them from the referential as it goes, and nothing wears the neutral
  // icon while there is nothing to wear it.
  if (model.actorTypes.length === 0 && model.actors.length > 0) {
    anomalies.push({
      message: 'Sheet "ActorTypes" missing or empty, so every actor wears the neutral icon. Add an "ActorTypes" sheet with the columns "Actor type" and "Icon".',
    });
  }

  // The perimeter is a property of the group, and it is not guessed: without
  // this sheet no actor is placed inside or outside, and the diagrams stop
  // telling the platform apart from what surrounds it.
  if (model.groupsSheetMissing) {
    anomalies.push({
      message:
        'Sheet "Groups" missing, so no perimeter is known and the diagrams no longer tell the platform from its surroundings. Add a "Groups" sheet with the columns "Group" and "Perimeter".',
    });
  }

  // The Milestones sheet is only checked if it exists: a workbook that dates
  // nothing must not start talking about milestones.
  if (model.milestones.length > 0) {
    for (const rank of duplicates(model.milestones.map((p) => String(p.rank)))) {
      const names = model.milestones.filter((p) => String(p.rank) === rank).map((p) => p.name);
      anomalies.push(anomaly(`Milestones "${names.join('", "')}" share rank ${rank}, so their order is ambiguous.`));
    }
    if (!model.milestones.some((p) => normalizeText(p.status) === normalizeText("Delivered"))) {
      anomalies.push({
        message: 'No milestone is marked "Delivered", so the current one is undetermined; the views fall back on the first declared.',
      });
    }
  }

  return { id: "structure", title: "Structure", description: "The file does not read as expected.", anomalies: byLocation(anomalies) };
}

function checkReferences(model: ParsedModel): AnomalyFamily {
  // Judged on the WHOLE workbook, like every other reference: the row exists in
  // the file whichever milestone is on screen.
  const anomalies: Anomaly[] = [...notInReferential(model)];
  const actors = actorByName(model);
  const flowTypes = new Set(model.flowTypes.map((t) => t.type.trim()));
  const lookup = buildInterfaceLookup(model);

  for (const iface of model.interfaces) {
    if (!actors.has(iface.providerName.trim())) {
      anomalies.push(anomaly(`${nameInterface(iface)}: provider "${iface.providerName}" unknown to the repository.`, iface));
    }
    if (!flowTypes.has(iface.flowType.trim())) {
      // The consequence, and not merely the fault: with no declared type the
      // arrow's direction cannot be determined, so the interface and ALL its
      // consumptions drop out of the diagrams. Said without that, the statement
      // passed for a vocabulary reminder -- on a real workbook, 24 interfaces out
      // of 59 were missing from every drawing for that reason alone.
      anomalies.push(
        anomaly(
          `${nameInterface(iface)}: flow type "${iface.flowType}" unknown to the repository, so this interface and its consumptions are not drawn.`,
          iface
        )
      );
    }
  }

  for (const c of model.consumptions) {
    if (!actors.has(c.consumerName.trim())) {
      anomalies.push(anomaly(`${nameConsumption(c)}: consumer "${c.consumerName}" unknown to the repository.`, c));
    }
    const byName = lookup.byName.get(nameKey(c.flowName));
    if (!byName) {
      anomalies.push(anomaly(`${nameConsumption(c)}: flow name missing from the Interfaces catalogue.`, c));
      continue;
    }
    // The name exists, the version does not: nothing is matched at random, it is said.
    const iface = lookup.byNameVersion.get(nameVersionKey(c.flowName, c.version));
    if (!iface) {
      anomalies.push(anomaly(`${nameConsumption(c)}: version "${c.version}" missing from the catalogue for this flow.`, c));
      continue;
    }
    const exact = lookup.byKey.get(interfaceKey(c.sheet, c.flowName, c.version));
    if (!exact) {
      anomalies.push(anomaly(`${nameConsumption(c)}: filed under "${c.sheet}" instead of "${iface.expectedSheet}".`, c));
    }
  }

  // A milestone quoted but absent from the Milestones sheet dates a row against
  // a marker that does not exist: the row would be read as "always been there",
  // which is not what the entry meant.
  const declaredMilestones = new Set(model.milestones.map((p) => normalizeText(p.name)));
  const citations = [
    ...model.actors.flatMap((a) => citedBounds(nameActor(a), a)),
    ...model.interfaces.flatMap((i) => citedBounds(nameInterface(i), i)),
    ...model.consumptions.flatMap((c) => citedBounds(nameConsumption(c), c)),
  ];
  for (const { where, value, location } of citations) {
    if (!declaredMilestones.has(normalizeText(value))) {
      anomalies.push(anomaly(`${where}: milestone "${value}" missing from the "Milestones" sheet.`, location));
    }
  }

  // A republished consumption names one of ITS OWN consumer's interfaces:
  // republishing under someone else's interface means nothing. Two versions of
  // the same flow published by that actor make the name alone ambiguous --
  // nothing is chosen at random, the version is asked for.
  for (const c of model.consumptions) {
    const target = c.republishedAs.trim();
    if (target === "") continue;
    const own = model.interfaces.filter((i) => i.providerName.trim() === c.consumerName.trim());
    const exactMatches = own.filter(
      (i) => normalizeText(interfaceLabel(i.flowName, i.version)) === normalizeText(target)
    );
    if (exactMatches.length === 1) continue;
    const byName = own.filter((i) => normalizeText(i.flowName) === normalizeText(target));
    if (byName.length === 1) continue;
    if (byName.length === 0) {
      anomalies.push(
        anomaly(`${nameConsumption(c)}: republished as "${target}", which "${c.consumerName}" does not provide.`, c)
      );
    } else {
      anomalies.push(
        anomaly(`${nameConsumption(c)}: republished as "${target}", which "${c.consumerName}" provides in ${byName.length} versions — name the version.`, c)
      );
    }
  }

  // A technology's colour comes from the external referential, in hexadecimal.
  // A value that is not one falls back silently to the palette -- the workbook
  // would then appear to decide a hue that it does not decide.
  for (const t of model.flowTypes) {
    const raw = t.colour.trim();
    if (raw === "" || HEX_COLOUR.test(raw)) continue;
    anomalies.push(anomaly(`${nameFlowType(t)}: colour "${raw}" is not a hex code such as #2a78d6.`, t));
  }

  // Two technologies of the same colour give two indistinguishable lines, legend
  // included. The workbook shows this nowhere: two neighbouring cells of a
  // referential compare badly by eye.
  const byColour = new Map<string, FlowType>();
  for (const t of model.flowTypes) {
    const raw = t.colour.trim();
    if (!HEX_COLOUR.test(raw)) continue;
    const key = raw.replace("#", "").toLowerCase();
    const already = byColour.get(key);
    if (already) {
      anomalies.push(
        anomaly(`${nameFlowType(t)}: colour "${raw}" is already carried by "${already.type}" — the two would be drawn alike.`, t)
      );
    } else {
      byColour.set(key, t);
    }
  }

  // The icon catalogue is embedded (offline deliverable): an invented name would
  // draw nothing, so it may as well be said along with the list of valid names.
  for (const t of model.actorTypes) {
    if (t.icon && !AVAILABLE_ICONS.includes(t.icon.trim())) {
      anomalies.push(
        anomaly(`${nameActorType(t)}: icon "${t.icon}" unknown. Accepted values: ${AVAILABLE_ICONS.join(", ")}.`, t)
      );
    }
  }

  // A blank workbook is not inconsistent, it is empty: with not a single actor,
  // an "unused" declaration reports nothing. Without this guard, the downloaded
  // template opened on six errors.
  if (model.actorTypes.length > 0 && model.actors.length > 0) {
    const declaredTypes = new Set(model.actorTypes.map((t) => normalizeText(t.type)));
    const visited = new Set<string>();
    for (const a of model.actors) {
      const type = a.actorType.trim();
      if (!type) continue;
      visited.add(normalizeText(type));
      if (!declaredTypes.has(normalizeText(type))) {
        anomalies.push(anomaly(`${nameActor(a)}: actor type "${type}" missing from the "ActorTypes" sheet.`, a));
      }
    }
    for (const t of model.actorTypes) {
      if (!visited.has(normalizeText(t.type))) {
        anomalies.push(anomaly(`${nameActorType(t)} is declared but no actor carries it.`, t));
      }
    }
  }

  if (!model.groupsSheetMissing && model.actors.length > 0) {
    const declared = new Set(model.groups.map((g) => normalizeText(g.name)));
    const visited = new Set<string>();
    for (const a of model.actors) {
      const group = a.group.trim();
      if (!group) continue;
      visited.add(normalizeText(group));
      if (!declared.has(normalizeText(group))) {
        anomalies.push(anomaly(`${nameActor(a)}: group "${group}" missing from the "Groups" sheet.`, a));
      }
    }
    for (const g of model.groups) {
      if (!visited.has(normalizeText(g.name))) {
        anomalies.push(anomaly(`${nameGroup(g)} is declared but no actor belongs to it.`, g));
      }
    }
  }

  return { id: "references", title: "References", description: "A value points at nothing.", anomalies: byLocation(anomalies) };
}

// Two readings, one section. DATA-ENTRY faults are judged on the whole
// workbook -- an impossible interval stays impossible whatever milestone is
// looked at. What the DIAGRAM shows is judged at the displayed milestone: an
// interface losing its last consumer at v2, a relay chain that time cuts, are
// only visible then. Judging everything on the whole workbook made them vanish
// silently, under an empty diagram.
function checkCoherence(model: ParsedModel, atMilestone: ParsedModel): AnomalyFamily {
  const anomalies: Anomaly[] = [];
  const lookup = buildInterfaceLookup(model);
  const lookupAtMilestone = buildInterfaceLookup(atMilestone);

  for (const c of model.consumptions) {
    const iface = findInterfaceForConsumption(lookup, c);
    if (iface && iface.providerName.trim() === c.consumerName.trim()) {
      anomalies.push(anomaly(`${nameConsumption(c)}: the consumer is also the provider.`, c));
    }
  }

  for (const iface of atMilestone.interfaces) {
    if (consumptionsForInterface(lookupAtMilestone, atMilestone, iface).length === 0) {
      anomalies.push(anomaly(`${nameInterface(iface)} has no declared consumption.`, iface));
    }
  }

  // A consumer does not consume two versions of a contract at once: that is an
  // inconsistency, not a migration step. Migration means changing a row's
  // version, not adding a second one.
  //
  // "At once" is taken literally: two rows whose intervals never meet are the
  // dated migration the workbook's instructions prescribe -- "Obsolete row: do
  // not delete it: give it a retirement milestone." Counting them together
  // reproached the file for following its own instruction.
  //
  const byFlowAndConsumer = new Map<string, Consumption[]>();
  for (const c of model.consumptions) {
    const key = JSON.stringify([normalizeText(c.sheet), normalizeText(c.flowName), normalizeText(c.consumerName)]);
    byFlowAndConsumer.set(key, [...(byFlowAndConsumer.get(key) ?? []), c]);
  }
  for (const c of model.consumptions) {
    const key = JSON.stringify([normalizeText(c.sheet), normalizeText(c.flowName), normalizeText(c.consumerName)]);
    const rows = byFlowAndConsumer.get(key);
    if (!rows) continue;
    const simultaneous = rows.filter(
      (other) =>
        other !== c &&
        other.version.trim() !== c.version.trim() &&
        intervalsMeet(lifespanOf(model, c), lifespanOf(model, other))
    );
    if (simultaneous.length === 0) continue;
    const versions = new Set([c, ...simultaneous].map((l) => l.version.trim()));
    byFlowAndConsumer.delete(key);
    anomalies.push(
      anomaly(
        `${nameConsumption(c)}: consumer "${c.consumerName}" is listed on two versions (${[...versions].map((v) => v || "no version").join(", ")}); a consumer consumes only one version of a contract.`,
        c
      )
    );
  }


  // The milestone axis, when it is used. An interval spilling out of the one it
  // depends on describes an impossible platform: a flow published by an actor
  // that does not exist yet, or any more.
  //
  // Only what was ENTERED is judged, bound by bound: a missing arrival is
  // already asked for by completeness (§7.4); reporting it here as well would
  // say the same empty cell twice under two different forms.
  if (model.milestones.length > 0) {
    const actors = actorByName(model);
    const actorLifespan = (name: string): Interval => {
      const a = actors.get(name.trim());
      return a ? lifespanOf(model, a) : ALWAYS;
    };

    function checkNesting(
      subject: string,
      validity: Validity & Location,
      parents: { name: string; interval: Interval }[]
    ) {
      const interval = lifespanOf(model, validity);
      const arrivalFilled = validity.introducedAt.trim() !== "";
      const retirementFilled = validity.retiredAt.trim() !== "";

      if (arrivalFilled && retirementFilled && interval.end <= interval.start) {
        anomalies.push(anomaly(`${subject}: retirement milestone is at or before the introduction milestone.`, validity));
        return;
      }
      for (const parent of parents) {
        const tooEarly = arrivalFilled && interval.start < parent.interval.start;
        const tooLate = retirementFilled && interval.end > parent.interval.end;
        // Two intervals that NEVER meet spill on neither side: a consumption
        // starting where its interface retires therefore triggered nothing, while
        // describing a link that exists at no milestone at all.
        //
        const neverTogether =
          parent.interval.start < parent.interval.end && !intervalsMeet(interval, parent.interval);
        if (tooEarly || tooLate || neverTogether) {
          anomalies.push(anomaly(`${subject} lives outside the lifetime of ${parent.name}.`, validity));
        }
      }
    }

    for (const i of model.interfaces) {
      checkNesting(nameInterface(i), i, [
        { name: `its provider "${i.providerName}"`, interval: actorLifespan(i.providerName) },
      ]);
    }

    for (const c of model.consumptions) {
      const iface = findInterfaceForConsumption(lookup, c);
      const parents = [
        { name: `its consumer "${c.consumerName}"`, interval: actorLifespan(c.consumerName) },
        ...(iface
          ? [{
              name: `interface "${interfaceLabel(iface.flowName, iface.version)}"`,
              interval: lifespanOf(model, iface),
            }]
          : []),
      ];
      checkNesting(nameConsumption(c), c, parents);
    }
  }

  for (const c of model.consumptions) {
    if (c.republishedAs.trim() !== "" && !isTechnicalActor(model, c.consumerName)) {
      anomalies.push(
        anomaly(`${nameConsumption(c)}: says it republishes, yet "${c.consumerName}" is a business actor — only plumbing relays.`, c)
      );
    }
  }

  // A broken chain produces no functional link. Without these two rows the link
  // was missing IN SILENCE, which is precisely what the catch-all bus check
  // below sets out to avoid.
  for (const cut of brokenChains(atMilestone, null)) {
    if (cut.reason === "loop") {
      anomalies.push(anomaly(`${nameInterface(cut.iface)}: its relay chain loops back on itself.`, cut.iface));
    }
    // A republished interface that nothing feeds: the technical actor publishes
    // it, but none of its consumptions names it. The functional link one
    // expected from it does not exist, and without this row it would be missing
    // IN SILENCE.
    if (cut.reason === "no-input") {
      anomalies.push(
        anomaly(
          `${nameInterface(cut.iface)}: nothing feeds it — no consumption of "${cut.iface.providerName}" is republished as this interface, so the chain stops here.`,
          cut.iface
        )
      );
    }
  }

  // The catch-all bus: a flow goes into the plumbing and comes out for nobody.
  // Without this check, the functional link would be missing IN SILENCE, which
  // is the worst case of all.
  //
  // MIDDLEWARE consumers only. A storage is a terminus -- an S3 bucket, a
  // database, an archive -- and a flow that stops there stops where it was
  // meant to. Judging it by this rule reported every write to a bucket as
  // plumbing swallowing a flow.
  for (const i of atMilestone.interfaces) {
    const consumers = consumptionsForInterface(lookupAtMilestone, atMilestone, i).map((c) => c.consumerName);
    if (consumers.length === 0) continue;
    if (!consumers.every((c) => isRelayActor(atMilestone, c))) continue;
    const springs = consumptionsForInterface(lookupAtMilestone, atMilestone, i).some((c) => c.republishedAs.trim() !== "");
    if (!springs) {
      anomalies.push(
        anomaly(`${nameInterface(i)}: goes into technical actors and comes back out for nobody.`, i)
      );
    }
  }

  return {
    id: "coherence",
    title: "Coherence",
    description: "The file reads, but something does not add up.",
    anomalies: byLocation(anomalies),
  };
}

// Closed vocabularies. This is the only place where a typo produces a WRONG
// diagram without saying a word: "Decomissioned" with an m missing is no
// longer recognised, the flow stops being dimmed and the target option no
// longer excludes it. An unknown representation direction, for its part,
// REVERSES the arrow (build-model.ts falls back silently to consumer →
//
// publisher). The values themselves come from aggregation/vocabularies.ts:
// they are the same as those offered in the workbook's drop-downs, and the two
// must not be able to drift apart.
const VOCABULARIES = {
  decision: VOCABULARY_DECISION,
  criticality: VOCABULARY_CRITICALITY,
  direction: VOCABULARY_DIRECTION,
  // The accepted spellings, not the offered ones: "Technical" is still read as
  // a middleware, so it must not be reported as unknown.
  nature: ACCEPTED_NATURES,
  perimeter: VOCABULARY_PERIMETER,
};

function outOfVocabulary(value: string, allowed: readonly string[]): boolean {
  const v = normalizeText(value);
  return v !== "" && !allowed.some((a) => normalizeText(a) === v);
}

function checkVocabularies(model: ParsedModel): AnomalyFamily {
  const anomalies: Anomaly[] = [];

  // The perimeter decides what goes inside the boundary and what stays outside.
  // A faulty value tipped nothing either way: the group was neither platform nor
  // external, without a word.
  for (const g of model.groups) {
    if (outOfVocabulary(g.perimeter, VOCABULARIES.perimeter)) {
      anomalies.push(
        anomaly(
          `${nameGroup(g)}: perimeter "${g.perimeter}" unknown. Accepted values: ${VOCABULARIES.perimeter.join(", ")}.`,
          g
        )
      );
    }
  }

  for (const t of model.flowTypes) {
    if (outOfVocabulary(t.rawDirection, VOCABULARIES.direction)) {
      anomalies.push(
        anomaly(
          `${nameFlowType(t)}: direction "${t.rawDirection}" unknown. Accepted values: ${VOCABULARIES.direction.join(", ")}.`,
          t
        )
      );
    }
  }


  for (const t of model.actorTypes) {
    if (outOfVocabulary(t.nature, VOCABULARIES.nature)) {
      anomalies.push(
        anomaly(`${nameActorType(t)}: nature "${t.nature}" unknown. Accepted values: ${VOCABULARIES.nature.join(", ")}.`, t)
      );
    }
  }

  for (const c of model.consumptions) {
    const where = nameConsumption(c);
    if (outOfVocabulary(c.decision, VOCABULARIES.decision)) {
      anomalies.push(anomaly(`${where}: decision "${c.decision}" unknown. Accepted values: ${VOCABULARIES.decision.join(", ")}.`, c));
    }
    if (outOfVocabulary(c.criticality, VOCABULARIES.criticality)) {
      anomalies.push(anomaly(`${where}: criticality "${c.criticality}" unknown. Accepted values: ${VOCABULARIES.criticality.join(", ")}.`, c));
    }
  }

  return {
    id: "vocabularies",
    title: "Vocabularies",
    description: "An entered value falls outside its accepted list, and changes the drawing without saying so.",
    anomalies: byLocation(anomalies),
  };
}

function checkCompleteness(model: ParsedModel): AnomalyFamily {
  const anomalies: Anomaly[] = [];

  for (const iface of model.interfaces) {
    if (!iface.description.trim()) {
      anomalies.push(anomaly(`${nameInterface(iface)}: description empty.`, iface));
    }
    if (!iface.contractLink.trim() && !iface.contractReference.trim()) {
      anomalies.push(anomaly(`${nameInterface(iface)}: no contract, neither link nor reference.`, iface));
    }
  }

  for (const c of model.consumptions) {
    if (!c.usage.trim()) anomalies.push(anomaly(`${nameConsumption(c)}: usage not described.`, c));
    // A retirement milestone stands in for a decision: it says the consumption
    // is leaving, and when. Asking for a judgement as well would ask for the
    // same thing twice.
    if (!c.decision.trim() && !c.retiredAt.trim()) {
      anomalies.push(anomaly(`${nameConsumption(c)}: decision empty.`, c));
    }
  }

  for (const a of model.actors) {
    if (!a.group.trim()) {
      anomalies.push(anomaly(`${nameActor(a)}: group empty, so it stays out of the aggregated views until filled in.`, a));
    }
  }

  for (const t of model.actorTypes) {
    if (!t.icon.trim()) {
      anomalies.push(anomaly(`${nameActorType(t)}: icon not filled in.`, t));
    }
  }

  for (const g of model.groups) {
    if (!g.perimeter.trim()) {
      anomalies.push(anomaly(`${nameGroup(g)}: perimeter not filled in.`, g));
    }
  }

  // The arrival on the milestone axis: without it, there is no knowing from when
  // the row counts, and no view can place it in time. An empty retirement, for
  // its part, is not a gap: it is a fact, the row is still there.
  //
  //
  // Asked for only once the team has adopted the axis -- a workbook with no
  // milestone declared must not start talking about milestones.
  if (model.milestones.length > 0) {
    for (const a of model.actors) {
      if (!a.introducedAt.trim()) {
        anomalies.push(anomaly(`${nameActor(a)}: introduction milestone empty.`, a));
      }
    }
    for (const i of model.interfaces) {
      if (!i.introducedAt.trim()) {
        anomalies.push(anomaly(`${nameInterface(i)}: introduction milestone empty.`, i));
      }
    }
    for (const c of model.consumptions) {
      if (!c.introducedAt.trim()) {
        anomalies.push(
          anomaly(`${nameConsumption(c)}: introduction milestone empty, so it is unknown when this consumer arrived.`, c)
        );
      }
    }
  }

  // As long as no type declares a nature, the team has not adopted the
  // distinction and the tool says nothing of it -- the same rule as for milestones.
  const adoptedNature = model.actorTypes.some((t) => t.nature.trim() !== "");
  if (adoptedNature) {
    for (const t of model.actorTypes) {
      if (!t.nature.trim()) anomalies.push(anomaly(`${nameActorType(t)}: nature not filled in.`, t));
    }
  }

  return {
    id: "completeness",
    title: "Completeness",
    description: "Something is missing from the entry.",
    anomalies: byLocation(anomalies),
  };
}

function decommissionCandidates(model: ParsedModel): InfoBlock {
  const lookup = buildInterfaceLookup(model);
  const candidates: InterfaceCatalogue[] = [];

  for (const iface of model.interfaces) {
    const consumptions = consumptionsForInterface(lookup, model, iface);
    if (consumptions.length === 0) continue;

    // The state is carried by the flow: the actor no longer has one.
    // Everything consuming this interface has a retirement milestone: it will
    // have nobody left. A "Remove" decision does not count here: it says one
    // would like to do without it, not that a departure is dated.
    const allEligible = consumptions.every((c) => c.retiredAt.trim() !== "");

    if (allEligible) candidates.push(iface);
  }
  const items = locatedItems(candidates, (i) => `${interfaceLabel(i.flowName, i.version)} ${address(i)}`);

  return {
    id: "decommissioning",
    title: "Decommissioning candidates",
    description: "Interfaces whose every consumption is scheduled to go — a call to make.",
    items,
    level: "action",
  };
}

// A component no flow touches does not invalidate the diagrams: it simply does
// not appear in them. It is a signal, not a fault -- and a decommissioned flow
// is still a flow, so it counts here like the others.
function actorsWithNoFlow(model: ParsedModel): InfoBlock {
  const touched = new Set<string>();
  for (const iface of model.interfaces) touched.add(iface.providerName.trim());
  for (const c of model.consumptions) touched.add(c.consumerName.trim());
  return {
    id: "actors-with-no-flow",
    title: "Components with no flow",
    description: "They appear on no diagram until some interface reaches them.",
    items: locatedItems(model.actors.filter((a) => !touched.has(a.name.trim())), (a) => `${a.name} ${address(a)}`),
    level: "warning",
  };
}

// Criticality is there to arbitrate: without it nothing can be decided, but
// the diagram stays correct.
function missingCriticalities(model: ParsedModel): InfoBlock {
  return {
    id: "missing-criticality",
    title: "Criticality not filled in",
    description: "Consumptions whose criticality for the consumer is left empty.",
    items: locatedItems(
      model.consumptions.filter((c) => !c.criticality.trim()),
      (c) => `${c.flowName} ${address(c)} — ${c.consumerName}`
    ),
    level: "warning",
  };
}

// Two components may exchange several times over the same technology: that is
// legitimate, but it is worth seeing, if only to check that these are not two
// entries of the same flow.
function repeatedExchanges(model: ParsedModel): InfoBlock {
  const lookup = buildInterfaceLookup(model);
  const counts = new Map<string, number>();
  for (const c of model.consumptions) {
    const iface = findInterfaceForConsumption(lookup, c);
    if (!iface) continue;
    const key = `${iface.providerName.trim()} → ${c.consumerName.trim()} over ${iface.flowType.trim()}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return {
    id: "repeated-exchanges",
    title: "Repeated exchanges",
    description: "Pairs of components linked more than once by the same technology.",
    items: [...counts.entries()]
      .filter(([, n]) => n > 1)
      .sort(([a], [b]) => a.localeCompare(b, "fr"))
      .map(([key, n]) => `${key} (${n} flows)`),
    level: "info",
  };
}

// Who needs whom: consuming an interface means depending on whoever publishes
// it. An actor consuming its own does not count -- that is an internal loop,
// which the aggregated views already hide, and not a dependency between
// components.
function dependencies(model: ParsedModel): Map<string, Set<string>> {
  const lookup = buildInterfaceLookup(model);
  const arcs = new Map<string, Set<string>>();
  for (const c of model.consumptions) {
    const iface = findInterfaceForConsumption(lookup, c);
    if (!iface) continue;
    const from = c.consumerName.trim();
    const to = iface.providerName.trim();
    if (!from || !to || from === to) continue;
    if (!arcs.has(from)) arcs.set(from, new Set());
    arcs.get(from)!.add(to);
  }
  return arcs;
}

function reachable(start: string, arcs: Map<string, Set<string>>): Set<string> {
  const visited = new Set<string>();
  const toVisit = [...(arcs.get(start) ?? [])];
  while (toVisit.length > 0) {
    const n = toVisit.pop()!;
    if (visited.has(n)) continue;
    visited.add(n);
    toVisit.push(...(arcs.get(n) ?? []));
  }
  return visited;
}

// Who, in falling, takes the most people down. The dependency graph already
// existed here and served only to detect cycles; yet it is the question asked
// on the day a migration has to be arbitrated.
//
// Only those who take somebody down are listed: naming the others with a zero
// would lengthen the list without adding anything to it.
function blastRadius(model: ParsedModel): InfoBlock {
  const arcs = dependencies(model);
  const downstream = new Map<string, Set<string>>();
  for (const [from, to] of arcs) {
    for (const v of to) {
      if (!downstream.has(v)) downstream.set(v, new Set());
      downstream.get(v)!.add(from);
    }
  }
  const reach = [...downstream.keys()]
    // Subtracted from itself: a cycle brings the actor back into its own
    // downstream, and "how many I take down" does not count me. On the sample
    // workbook, which contains a four-component cycle, this showed.
    .map((name) => ({ name, downstream: [...reachable(name, downstream)].filter((x) => x !== name).length }))
    .filter((x) => x.downstream > 0)
    .sort((a, b) => b.downstream - a.downstream || a.name.localeCompare(b.name, "fr"));

  return {
    id: "blast-radius",
    title: "Blast radius",
    description: "How many components each one takes with it, directly or through others.",
    items: reach.map((x) => `${x.name}: ${x.downstream} component${x.downstream > 1 ? "s" : ""} downstream.`),
    level: "info",
  };
}

// Components that need one another, directly or step by step. None can arrive,
// leave or change contract without the others: that is an architectural
// constraint, not a data-entry fault.
//
// The groups are named rather than the paths: enumerating every path of a
// tangle produces a number that explodes, where the group says the same thing
// in one line. Two components belong to the same group when each reaches the
// other -- a workbook holds a few hundred actors, so the walk is immediate.
//
function dependencyCycles(model: ParsedModel): InfoBlock {
  const arcs = dependencies(model);
  // Only actors depending on at least one other can form a cycle.
  const candidates = [...arcs.keys()];
  const reach = new Map(candidates.map((n) => [n, reachable(n, arcs)]));

  const groups: string[] = [];
  const placed = new Set<string>();
  for (const n of candidates) {
    if (placed.has(n) || !reach.get(n)!.has(n)) continue;
    const group = candidates
      .filter((m) => reach.get(n)!.has(m) && reach.get(m)!.has(n))
      .sort((a, b) => a.localeCompare(b, "fr"));
    for (const m of group) placed.add(m);
    groups.push(`${group.join(", ")} (${group.length} components)`);
  }

  return {
    id: "cycles",
    title: "Dependency cycles",
    description: "Components that need one another, directly or through others — none of them stands alone.",
    items: groups.sort((a, b) => a.localeCompare(b, "fr")),
    level: "info",
  };
}

// A declared type nobody uses: the referential says more than the estate does.
function unusedFlowTypes(model: ParsedModel): InfoBlock {
  const used = new Set(model.interfaces.map((i) => normalizeText(i.flowType)));
  return {
    id: "unused-flow-types",
    title: "Unused flow types",
    description: "Declared in FlowTypes, but no interface uses them.",
    items: locatedItems(model.flowTypes.filter((t) => !used.has(normalizeText(t.type))), (t) => `${t.type} ${address(t)}`),
    level: "info",
  };
}

// A colour that is too light is CORRECTED on display so that the line stays
// visible. The workbook must learn of it here: otherwise the hue on screen is
// not the one it wrote, and nothing explains it.
function unreadableColours(model: ParsedModel): InfoBlock {
  const items: string[] = [];
  for (const t of model.flowTypes) {
    const declared = HEXA.exec(t.colour.trim());
    if (!declared) continue;
    const hex = `#${declared[1].toLowerCase()}`;
    const ratio = contrastRatio(hex, "#ffffff");
    if (ratio < LINE_THRESHOLD) {
      items.push(
        `${t.type} ${address(t)}: colour ${hex} only reaches ${ratio.toFixed(2)}:1 on white; it is darkened on screen so the line stays visible.`
      );
    }
  }
  return {
    id: "contrast",
    title: "Colours too light to draw",
    description: "A declared colour is darkened on screen so the line remains visible.",
    items,
    level: "warning",
  };
}

function interfacesToConfirm(model: ParsedModel): InfoBlock {
  return {
    id: "to-confirm",
    title: "Interfaces to confirm",
    description: "Interfaces whose To confirm column reads Yes — to confirm or to drop.",
    items: locatedItems(model.interfaces.filter((i) => i.toConfirm), (i) => `${interfaceLabel(i.flowName, i.version)} ${address(i)}`),
    level: "action",
  };
}

// Who has not moved yet. An interface to be decommissioned that still carries
// consumers is work in progress, not a fault of the workbook: it is a decision
// waiting for someone, hence an "action" block.
function migrationsInProgress(model: ParsedModel): InfoBlock {
  const lookup = buildInterfaceLookup(model);
  const inProgress: { iface: InterfaceCatalogue; text: string }[] = [];

  for (const iface of model.interfaces) {
    if (iface.retiredAt.trim() === "") continue;
    const remaining = [...new Set(consumptionsForInterface(lookup, model, iface).map((c) => c.consumerName.trim()))];
    if (remaining.length === 0) continue;

    // The target is the active versions of the SAME flow on the same sheet. They
    // are all named rather than one being elected: choosing on the workbook's
    // behalf would amount to inventing the destination.
    const actives = model.interfaces
      .filter(
        (other) =>
          normalizeText(other.flowName) === normalizeText(iface.flowName) &&
          normalizeText(other.expectedSheet) === normalizeText(iface.expectedSheet) &&
          other.retiredAt.trim() === ""
      )
      .map((other) => other.version.trim() || "no version");

    const to = actives.length > 0 ? actives.join(", ") : "no active version";
    inProgress.push({
      iface,
      text: `${interfaceLabel(iface.flowName, iface.version)} ${address(iface)} → ${to}: ${remaining.join(", ")}`,
    });
  }
  const items = locatedItems(inProgress.map((e) => ({ ...e.iface, text: e.text })), (e) => e.text);

  return {
    id: "migrations",
    title: "Migrations under way",
    description: "Interfaces on their way out that still carry consumers, and the active version to move them to.",
    items,
    level: "action",
  };
}

// An inventory of every group teaches nothing by itself -- it is just
// scrolled past. What is worth a look is a PAIR of group names close enough
// to be the same group, split by a spelling variant: a case difference, a
// stray hyphen, a swapped letter. So this reports pairs, not the inventory,
// and stays silent when every group is clearly its own.
function usedGroups(model: ParsedModel): InfoBlock {
  const counts = new Map<string, number>();
  for (const a of model.actors) {
    const group = a.group.trim();
    if (!group) continue;
    counts.set(group, (counts.get(group) ?? 0) + 1);
  }
  const names = [...counts.keys()];
  // Uppercase before lowercase: a case variant then reads "Core ... core",
  // the form with the capital first.
  const byName = (a: string, b: string) => a.localeCompare(b, "fr", { caseFirst: "upper" });

  const candidates: { a: string; b: string; distance: number | null; reason: string }[] = [];
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const match = nearDuplicate(names[i], names[j]);
      if (!match) continue;
      const [a, b] = [names[i], names[j]].sort(byName);
      candidates.push({ a, b, ...match });
    }
  }

  // The fuzzy rule (distance not null) only: a name equally close to two
  // different others is dropped from both pairs -- a wrong suggestion is
  // worse than none, and it would send someone to rename a group that was
  // right. The two exact rules carry no such ambiguity.
  const tiedAt = (name: string, distance: number) =>
    candidates.filter((c) => c.distance === distance && (c.a === name || c.b === name)).length > 1;
  const unambiguous = candidates.filter(
    (c) => c.distance === null || (!tiedAt(c.a, c.distance) && !tiedAt(c.b, c.distance))
  );

  const items = unambiguous
    .sort((x, y) => byName(x.a, y.a) || byName(x.b, y.b))
    .map((c) => `${c.a} (${counts.get(c.a)}) and ${c.b} (${counts.get(c.b)}) — ${c.reason}`);

  return {
    id: "groups",
    title: "Groups that may be the same, misspelled",
    description:
      "Pairs of group names close enough to be the same group entered twice. Two close names can be " +
      "genuinely distinct, so this stays a remark, not a verdict.",
    items,
    level: "info",
  };
}

// What the workbook declares and the hidden referential list does not carry.
//
// This is a FAULT, and it was not always one: the referential used to lag
// behind the cartography by construction, so an unknown name was a decision
// waiting for someone. The lists became what the drop-downs are made of --
// a name absent from them could not have been picked, it was typed or it comes
// from a workbook filled before the referential carried it -- and what the
// referential says about that name, an icon, a direction, resolves to nothing.
// The row is then half drawn, or not drawn at all.
//
// A vocabulary the referential publishes NOTHING for says nothing: it is not
// that every name is unknown, it is that nobody was asked.
//
// A referential name close enough to the unknown one to likely be the same
// thing, misspelled -- acronym-guarded, since protocol acronyms (FTP/SFTP,
// HTTP/HTTPS...) sit within the usual edit-distance threshold despite naming
// distinct things.
function suggestion(name: string, referentialNames: string[]): string | undefined {
  return referentialNames.find((candidate) => nearDuplicate(name, candidate, { skipFuzzyForAcronyms: true }));
}

function notInReferential(model: ParsedModel): Anomaly[] {
  const gap = <T extends Location>(
    published: string[],
    declared: readonly T[],
    nameOf: (item: T) => string,
    label: string
  ): Anomaly[] => {
    const known = new Set(published.map(normalizeText));
    if (known.size === 0) return [];
    return declared
      .filter((d) => nameOf(d).trim() !== "" && !known.has(normalizeText(nameOf(d))))
      .map((d) => {
        const match = suggestion(nameOf(d), published);
        const said = `${label} "${nameOf(d)}" ${address(d)}: not in the referential`;
        return anomaly(match ? `${said} — did you mean "${match}"?` : `${said}.`, d);
      });
  };

  return [
    ...gap(model.referentialActors.map((a) => a.name), model.actors, (a) => a.name, "Actor"),
    ...gap(model.referentialGroups.map((g) => g.name), model.groups, (g) => g.name, "Group"),
    ...gap(model.referentialActorTypes.map((t) => t.type), model.actorTypes, (t) => t.type, "Actor type"),
    ...gap(model.referentialTechnologies.map((t) => t.type), model.flowTypes, (t) => t.type, "Technology"),
  ];
}

// The workbook cut down to what lives at the displayed milestone. The checks
// that judge a STATE of the platform -- consistency, completeness,
// informational blocks -- apply to it; those that judge the FILE -- structure,
// references, vocabularies, temporal checks -- work on the whole workbook.
//
// Without that distinction the axis scuttles itself: an actor retired at
// milestone 2 obviously has no flow left at milestone 3, and the report would
// fill with false anomalies from the first retired row onwards.
function modelAtMilestone(model: ParsedModel, rank: number | null): ParsedModel {
  if (rank === null || model.milestones.length === 0) return model;
  const live = (v: { introducedAt: string; retiredAt: string }) =>
    isLiveAt(lifespanOf(model, v), rank);
  // A flow exists at the milestone only if its WHOLE chain exists there:
  // publisher, interface, consumption, consumer. That is the rule the diagrams
  // apply (buildFlowInstances). Filtering the three tables each on its own side
  // kept a consumption whose actor had disappeared: the report then
  // contradicted the diagram of the same milestone, displayed right beside it.
  //
  // A consumption naming no interface therefore disappears too -- that is
  // indeed a fault, but it falls to the reference checks, which judge the
  // whole workbook.
  const actors = model.actors.filter(live);
  // An actor UNKNOWN to the workbook is not a dead actor. It is a reference
  // fault, which the checks report separately, and the diagrams do draw its
  // flow (buildFlowInstances treats the not-found as live, deliberately).
  // Judging existence here made the report say "B has no flow" under a diagram
  // showing precisely a flow towards B.
  const retired = (name: string) => {
    const a = model.actors.find((x) => x.name.trim() === name.trim());
    return a !== undefined && !live(a);
  };
  const interfaces = model.interfaces.filter((i) => live(i) && !retired(i.providerName));
  const lookup = buildInterfaceLookup({ ...model, interfaces });
  const consumptions = model.consumptions.filter(
    (c) => live(c) && !retired(c.consumerName) && findInterfaceForConsumption(lookup, c) !== undefined
  );
  return { ...model, actors, interfaces, consumptions };
}

export function runIntegrityChecks(model: ParsedModel, rank: number | null = null): IntegrityReport {
  const atMilestone = modelAtMilestone(model, rank);
  const families = [
    checkStructure(model),
    checkReferences(model),
    checkVocabularies(model),
    checkCoherence(model, atMilestone),
    checkCompleteness(atMilestone),
  ];
  const infoBlocks = [
    actorsWithNoFlow(atMilestone),
    missingCriticalities(atMilestone),
    interfacesToConfirm(atMilestone),
    migrationsInProgress(atMilestone),
    decommissionCandidates(atMilestone),
    repeatedExchanges(atMilestone),
    dependencyCycles(atMilestone),
    unusedFlowTypes(atMilestone),
    // A colour depends on no milestone: the whole workbook.
    unreadableColours(model),
    blastRadius(atMilestone),
  ];
  // Left out entirely rather than shown empty, like the referential gap
  // below: an empty inventory of near-duplicate groups is not reassuring, it
  // is nothing -- a checkmark row nobody needed to see.
  const groupes = usedGroups(atMilestone);
  if (groupes.items.length > 0) infoBlocks.push(groupes);
  const totalAnomalies = families.reduce((sum, f) => sum + f.anomalies.length, 0);
  const total = (level: InfoBlock["level"]) =>
    infoBlocks.filter((b) => b.level === level).reduce((sum, b) => sum + b.items.length, 0);

  return {
    families,
    infoBlocks,
    totalAnomalies,
    totalActions: total("action"),
    totalWarnings: total("warning"),
  };
}
