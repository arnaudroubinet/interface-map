import type { ParsedModel, Actor } from "../parsing/model";
import {
  interfaceLabel,
  groupIsExternal,
  groupIsPlatform,
  type FlowInstance,
  type Mode,
} from "../aggregation/core";
import { liveActors } from "../aggregation/milestones";
import { flowsForReading } from "../aggregation/reading";
import { coloursOfModel } from "../render/colors";
import { identifiers } from "./identifiers";
import { normalizeText } from "../shared/text";

// The workbook as LikeC4. Same material as the Structurizr export, a different
// grammar: LikeC4 says belonging through nesting, where Structurizr has a word
// for the group. A nested actor is then named by its full path.

const text = (v: string) => v.trim().replace(/"/g, "'");


// The relationship goes from provider to consumer, like the data and like our
// diagrams. It used to follow the direction of the CALL, so that a pulled flow
// came out backwards from our images: the same estate told two stories
// depending on which tool read it.
//
// A C4 relationship has only one direction: the initiative cannot be drawn
// there as an arrowhead set at the other end. So it goes into a tag, where it
// stays readable and filterable.
function flowDirection(f: FlowInstance): { de: string; vers: string } {
  return { de: f.provider, vers: f.consumer };
}

const PULLED_TAG = "Pulled";
const isPulled = (f: FlowInstance) => f.direction === "consumer-to-provider";

// LikeC4 refuses the whole file on a relationship from an element to itself --
// "Invalid parent-child relationship" -- and an actor consuming what it
// publishes would produce one. It would say nothing anyway: the aggregated
// views already hide it (§4.3), and the Structurizr export drops it likewise.
function exportableFlows(model: ParsedModel, rank: number | null, mode: Mode): FlowInstance[] {
  return flowsForReading(model, rank, mode).filter((f) => f.provider.trim() !== f.consumer.trim());
}

const byName = (a: string, b: string) => a.localeCompare(b, "fr");

export function modelToLikeC4(model: ParsedModel, rank: number | null, mode: Mode = "architecture"): string {
  // The reading the file carries. It MUST say so: delivering a file that tells
  // something other than the screen is what is forbidden everywhere else.
  const fonctionnel = mode === "functional";
  const actors = liveActors(model, rank);
  const groups = [...new Set(actors.map((a) => a.group.trim()).filter(Boolean))].sort(byName);
  // Groups and actors share the identifier space: a group and an actor of the
  // same name would tread on each other.
  const ids = identifiers([...groups, ...actors.map((a) => a.name.trim())]);
  const paths = new Map(
    actors.map((a) => {
      const id = ids.get(a.name.trim())!;
      const group = a.group.trim();
      return [a.name.trim(), group ? `${ids.get(group)}.${id}` : id];
    })
  );

  const flows = exportableFlows(model, rank, mode);
  // The technology tags serve the by-technology views. LikeC4 wants identifiers,
  // where the workbook writes "REST + ESB".
  const techs = [...new Set(flows.map((f) => f.flowType.trim()))].sort(byName);
  const tags = identifiers(techs);
  const colours = coloursOfModel(model);

  const rows: string[] = [
    `// Interface map${fonctionnel ? ", functional reading: chains folded, media removed." : "."}`,
    "specification {",
    "    element group",
    "    element system",
    // A human is drawn as a stick figure, not a box: LikeC4 has the shape, the
    // workbook has the actor type, all that is left is to connect them.
    "    element person {",
    "        style {",
    "            shape person",
    "        }",
    "    }",
    "    tag external",
    "    tag platform",
    // LikeC4 refuses an undeclared tag: this one always is, even if no pulled
    // flow exists in this workbook -- a useless declaration costs nothing, an
    // invalid file costs everything.
    `    tag ${PULLED_TAG.toLowerCase()}`,
    ...techs.map((t) => `    tag ${tags.get(t)}`),
    // One relationship kind per technology. LikeC4 is the only target that can
    // draw our convention: the head at the CONSUMER end when the provider
    // pushes, at the PROVIDER end when the consumer pulls. It is finally told
    // so, instead of the thing being reduced to a tag.
    //
    // `line solid` is explicit: LikeC4's default stroke style is `dashed`, and
    // every one of our lines would have come out dashed -- which would have
    // erased the distinction dashes carry for us, the "Transform" decision.
    //
    ...techs.flatMap((t) => {
      const pulled = model.flowTypes.some((tf) => tf.type.trim() === t && tf.direction === "consumer-to-provider");
      return [
        `    relationship ${tags.get(t)} {`,
        `        technology "${text(t)}"`,
        "        style {",
        "            line solid",
        `            color ${colours.get(t) ?? "#000000"}`,
        // `vee` is the open head, `normal` the solid one: the same pair as our
        // diagrams, and the one UML uses on its messages.
        pulled ? "            head vee" : "            head normal",
        pulled ? "            tail none" : "            tail none",
        "        }",
        "    }",
      ];
    }),
    "}",
    "",
    "model {",
  ];

  const declaration = (a: Actor, indent: string) => {
    const nature = isAPerson(a) ? "person" : "system";
    const body = [`${indent}${ids.get(a.name.trim())} = ${nature} "${text(a.name)}" {`];
    // Tags come before properties: LikeC4 requires it.
    if (groupIsExternal(model, a.group)) body.push(`${indent}    #external`);
    if (groupIsPlatform(model, a.group)) body.push(`${indent}    #platform`);
    if (a.description.trim()) body.push(`${indent}    description "${text(a.description)}"`);
    if (a.actorType.trim()) body.push(`${indent}    technology "${text(a.actorType)}"`);
    body.push(
      ...metadata(indent + "    ", [
        ["owner", a.owner],
        ["comments", a.comments],
        ["introducedAt", a.introducedAt],
        ["retiredAt", a.retiredAt],
      ])
    );
    body.push(`${indent}}`);
    return body;
  };

  for (const group of groups) {
    rows.push(`    ${ids.get(group)} = group "${text(group)}" {`);
    for (const a of actors.filter((x) => x.group.trim() === group)) rows.push(...declaration(a, "        "));
    rows.push("    }");
  }
  for (const a of actors.filter((x) => !x.group.trim())) rows.push(...declaration(a, "    "));

  rows.push("");
  const links = new Map<string, string[]>();
  for (const f of flows) {
    const { de, vers } = flowDirection(f);
    const source = paths.get(de.trim());
    const target = paths.get(vers.trim());
    if (!source || !target) continue;
    const label = text(interfaceLabel(f.interfaceName, f.version));
    const kind = tags.get(f.flowType.trim());
    const body = [
      // `-[kind]->` rather than a bare arrow: it is the kind that carries the
      // head, the colour and the style declared above.
      `    ${source} -[${kind}]-> ${target} "${label}" {`,
      `        #${kind}`,
    ];
    // The initiative, as a tag: LikeC4 can filter on it, and without it the
    // file would lose what the arrowhead carries on our diagrams.
    if (isPulled(f)) body.push(`        #${PULLED_TAG.toLowerCase()}`);
    // What the exchange carries, in the field LikeC4 provides for it: the
    // relationship has a description distinct from its label, where Structurizr
    // has only the label and must fall back on a property.
    if (f.iface.description.trim()) body.push(`        description "${text(f.iface.description)}"`);
    body.push(`        technology "${text(f.flowType)}"`);
    // The contract is an address: one click from the diagram beats a search
    // through the workbook.
    if (f.iface.contractLink.trim()) body.push(`        link ${f.iface.contractLink.trim()}`);
    body.push(
      ...metadata("        ", [
        ["usage", f.consumption.usage],
        ["criticality", f.consumption.criticality],
        ["decision", f.consumption.decision],
        ["contractReference", f.iface.contractReference],
        // A flow to be confirmed is a flow the workbook is not sure about: without
        // this flag, the produced file would assert more than it does.
        ["toConfirm", f.iface.toConfirm ? "Yes" : ""],
        // Two comment columns, two subjects: the contract on one side, the use a
        // consumer makes of it on the other.
        ["interfaceComments", f.iface.comments],
        ["consumptionComments", f.consumption.comments],
        ["introducedAt", f.consumption.introducedAt],
        ["retiredAt", f.consumption.retiredAt],
      ])
    );
    body.push("    }");
    links.set(`${source} -> ${target} "${label}"`, body);
  }
  for (const key of [...links.keys()].sort((a, b) => a.localeCompare(b, "fr"))) rows.push(...links.get(key)!);

  rows.push("}", "", "views {", ...views(model, actors, paths, techs, tags, flows, ids), "}", "");

  return rows.join("\n");
}

// One view per diagram the tool can draw, including both aggregated views.
// The comment that declared them inexpressible held for Structurizr, not for
// LikeC4: the groups ARE ALREADY elements of the exported model, and including
// them WITHOUT their `.*` gives one box per group.
function views(
  model: ParsedModel,
  actors: Actor[],
  paths: Map<string, string>,
  techs: string[],
  tags: Map<string, string>,
  flows: FlowInstance[],
  ids: Map<string, string>
): string[] {
  // A view's name is an identifier -- "tech_rest_esb" -- that nobody wants to
  // read in a list. The title carries the real name.
  const view = (header: string, title: string, inclusion: string) => [
    `    view ${header} {`,
    `        title "${text(title)}"`,
    `        include ${inclusion}`,
    "        autoLayout LeftRight",
    "    }",
  ];

  const rows = [...view("index", "Everything the workbook holds", "*")];

  // The two aggregated views, which the previous comment declared
  // inexpressible: a group quoted WITHOUT its `.*` is a box, with its `.*` it
  // is opened. That is exactly the "group to group" versus "platform detail"
  // opposition.
  const groups = [...new Set(actors.map((a) => a.group.trim()).filter(Boolean))].sort(byName);
  if (groups.length > 1) {
    rows.push(
      ...view("group_to_group", "Group to group", groups.map((g) => ids.get(g)!).join(", "))
    );
  }
  const platform = groups.filter((g) => groupIsPlatform(model, g));
  if (platform.length > 0 && groups.length > platform.length) {
    const inclusion = [
      ...platform.map((g) => `${ids.get(g)}.*`),
      ...groups.filter((g) => !groupIsPlatform(model, g)).map((g) => ids.get(g)!),
    ];
    rows.push(...view("platform_detail", "Platform detail", inclusion.join(", ")));
  }

  // The same predicate as the diagrams: compared strictly here, a group entered
  // as "platform" was a platform on screen and was no longer one in the C4 file,
  // where the dedicated view vanished without a word.
  if (model.groups.some((g) => groupIsPlatform(model, g.name))) {
    rows.push(...view("platform_only", "Platform only", "* where tag is #platform"));
  }

  for (const tech of techs) {
    const tag = tags.get(tech)!;
    rows.push(...view(`tech_${tag}`, tech, `* where tag is #${tag}`));
  }

  // An actor no flow touches has no diagram in the tool: its view would show
  // nothing but its own box.
  const touched = new Set(flows.flatMap((f) => [f.provider.trim(), f.consumer.trim()]));
  for (const a of actors.filter((x) => touched.has(x.name.trim()))) {
    const path = paths.get(a.name.trim())!;
    rows.push(...view(`actor_${path.split(".").pop()} of ${path}`, a.name, "*"));
  }

  return rows;
}

// The workbook names its actor types freely; only the one with a shape of its
// own is recognised, in the two languages a workbook may carry.
function isAPerson(a: Actor): boolean {
  return ["person", "humain"].includes(normalizeText(a.actorType));
}

// What the diagram does not show but the workbook knows. An empty block is not
// set: it would clutter every element while saying nothing.
function metadata(indent: string, paires: [string, string][]): string[] {
  const filled = paires.filter(([, v]) => v.trim() !== "");
  if (filled.length === 0) return [];
  return [
    `${indent}metadata {`,
    ...filled.map(([key, v]) => `${indent}    ${key} "${text(v)}"`),
    `${indent}}`,
  ];
}
