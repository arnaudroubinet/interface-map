import type { ParsedModel, Actor } from "../parsing/model";
import {
  interfaceLabel,
  groupIsExternal,
  groupIsPlatform,
  type FlowInstance,
  type Mode,
} from "../aggregation/core";
import { coloursOfModel } from "../render/colors";
import { identifiers } from "./identifiers";
import { text, PULLED_TAG, isPulled, exportableFlows, exportableActors, isAPerson, contractUrl } from "./c4-common";

// The workbook as LikeC4. Same material as the Structurizr export, a different
// grammar: LikeC4 says belonging through nesting, where Structurizr has a word
// for the group. A nested actor is then named by its full path.

// The words of the grammar, and the tags the specification always declares:
// an actor called "model", a group called "views", a technology called
// "External" must not be declared under those identifiers.
const KEYWORDS = [
  "specification", "model", "views", "view", "element", "tag", "relationship", "group", "system", "person",
  "style", "shape", "color", "line", "head", "tail", "include", "exclude", "where", "is", "and", "or", "not",
  "title", "description", "technology", "link", "metadata", "autoLayout", "navigateTo", "of", "this", "it",
  "extends", "global", "dynamic", "deployment", "external", "platform", PULLED_TAG.toLowerCase(),
];

const byName = (a: string, b: string) => a.localeCompare(b, "fr");

export function modelToLikeC4(
  model: ParsedModel,
  rank: number | null,
  mode: Mode = "architecture",
  // The milestone the file is filtered at. It MUST say so, like the reading:
  // a file filtered at v3 that announces nothing is a file that lies by
  // omission about everything v4 added.
  milestone: string | null = null
): string {
  // The reading the file carries. It MUST say so: delivering a file that tells
  // something other than the screen is what is forbidden everywhere else.
  const fonctionnel = mode === "functional";
  const actors = exportableActors(model, rank);
  const groups = [...new Set(actors.map((a) => a.group.trim()).filter(Boolean))].sort(byName);
  // Groups and actors share LikeC4's namespace, and are looked up by name: two
  // tables, the second staying clear of the first, so that a group and an actor
  // of the same name get two identifiers rather than one for two declarations.
  const groupIds = identifiers(groups, KEYWORDS);
  const actorIds = identifiers(actors.map((a) => a.name.trim()), [...KEYWORDS, ...groupIds.values()]);
  const paths = new Map(
    actors.map((a) => {
      const id = actorIds.get(a.name.trim())!;
      const group = a.group.trim();
      return [a.name.trim(), group ? `${groupIds.get(group)}.${id}` : id];
    })
  );

  const flows = exportableFlows(model, rank, mode);
  // The technology tags serve the by-technology views. LikeC4 wants identifiers,
  // where the workbook writes "REST + ESB".
  // Prefixed: a technology called "External" or "Platform" would otherwise
  // declare a tag the specification already declares, and the file be refused.
  const techs = [...new Set(flows.map((f) => f.flowType.trim()))].sort(byName);
  const tags = new Map([...identifiers(techs)].map(([name, id]) => [name, `tech_${id}`]));
  const colours = coloursOfModel(model);

  const rows: string[] = [
    `// Interface map${fonctionnel ? ", functional reading: chains folded, media removed." : "."}${milestone ? ` Milestone ${text(milestone)}.` : ""}`,
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
    const body = [`${indent}${actorIds.get(a.name.trim())} = ${nature} "${text(a.name)}" {`];
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
    rows.push(`    ${groupIds.get(group)} = group "${text(group)}" {`);
    for (const a of actors.filter((x) => x.group.trim() === group)) rows.push(...declaration(a, "        "));
    rows.push("    }");
  }
  for (const a of actors.filter((x) => !x.group.trim())) rows.push(...declaration(a, "    "));

  rows.push("");
  const links = new Map<string, string[]>();
  for (const f of flows) {
    const source = paths.get(f.provider.trim());
    const target = paths.get(f.consumer.trim());
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
    const url = contractUrl(f.iface.contractLink);
    if (url) body.push(`        link ${url}`);
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

  rows.push("}", "", "views {", ...views(model, actors, paths, techs, tags, flows, groupIds, milestone), "}", "");

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
  ids: Map<string, string>,
  milestone: string | null
): string[] {
  // A view's name is an identifier -- "tech_rest_esb" -- that nobody wants to
  // read in a list. The title carries the real name, and the milestone.
  const atMilestone = milestone ? ` — milestone ${milestone}` : "";
  const view = (header: string, title: string, inclusion: string) => [
    `    view ${header} {`,
    `        title "${text(title + atMilestone)}"`,
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
    rows.push(...view(tag, tech, `* where tag is #${tag}`));
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
