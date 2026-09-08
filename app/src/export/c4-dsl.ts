import type { ParsedModel, Actor } from "../parsing/model";
import {
  groupIsPlatform,
  groupIsExternal,
  interfaceLabel,
  type FlowInstance,
  type Mode,
} from "../aggregation/core";
import { PERIMETER_PLATFORM, PERIMETER_EXTERNAL } from "../aggregation/vocabularies";
import { identifiers } from "./identifiers";
import { coloursOfModel } from "../render/colors";
import { normalizeText } from "../shared/text";
import { text, PULLED_TAG, isPulled, exportableFlows, exportableActors, isAPerson, contractUrl } from "./c4-common";

// The workbook as Structurizr DSL: the model, not a board. That is the
// difference with the image exports -- what is on screen is not what is
// returned; the estate is, and the C4 tool draws whatever views it wants.
//
// An actor becomes a system: the workbook does not go below the component, and
// claiming otherwise would invent an internal architecture nobody entered.
//

// One shape per actor type, for the commonest words only: the workbook names
// its types freely, and an unknown type stays a box rather than getting a shape
// at random. The values are the ones Structurizr accepts (Box, RoundedBox,
// Circle, Ellipse, Hexagon, Diamond, Cylinder, Bucket, Pipe, Person, Robot,
// Folder, WebBrowser, Window, Terminal, Shell, MobileDevicePortrait,
// MobileDeviceLandscape, Component).
const SHAPE_BY_TYPE: Record<string, string> = {
  queue: "Pipe",
  topic: "Pipe",
  broker: "Pipe",
  bus: "Pipe",
  database: "Cylinder",
  storage: "Cylinder",
  person: "Person",
  human: "Person",
  batch: "Robot",
  screen: "Window",
  browser: "WebBrowser",
};
// The words of the grammar: an actor called "model" or "views" must not be
// declared under that identifier.
const KEYWORDS = [
  "workspace", "model", "views", "styles", "group", "person", "softwareSystem", "container", "component",
  "deploymentEnvironment", "element", "relationship", "tags", "url", "properties", "perspectives", "include",
  "exclude", "autolayout", "title", "description", "shape", "color", "background", "systemLandscape",
  "systemContext", "dynamic", "theme", "branding", "configuration", "this",
];

export function modelToStructurizr(
  model: ParsedModel,
  rank: number | null,
  workbookName: string,
  milestone: string | null = null,
  // The reading the file carries. It MUST say so: delivering a file that tells
  // something other than the screen is what is forbidden everywhere else, and
  // it was the only reason to close this export in the functional reading.
  mode: Mode = "architecture"
): string {
  const actors = exportableActors(model, rank);
  const ids = identifiers(actors.map((a) => a.name.trim()), KEYWORDS);
  const name = workbookName.replace(/\.(xlsx|xlsm)$/i, "");

  const fonctionnel = mode === "functional";
  const rows: string[] = [
    `workspace "${text(name)}${fonctionnel ? " (functional reading)" : ""}" "${
      fonctionnel
        ? "Interface map, functional reading: chains folded, media removed."
        : "Interface map, exported from the workbook."
    }"`,
    "",
    "    model {",
    // A nested actor is then named by its full path, which makes the file
    // re-readable when two groups carry the same short name.
    "        !identifiers hierarchical",
  ];

  const declaration = (a: Actor, indent: string) => {
    // A human is not a system: C4 has a word for that, and the workbook already
    // says it in its actor type.
    const word = isAPerson(a) ? "person" : "softwareSystem";
    const body = [`${indent}${ids.get(a.name.trim())} = ${word} "${text(a.name)}" "${text(a.description)}" {`];
    const tags = [a.actorType, perimeter(model, a.group)].map(text).filter(Boolean);
    if (tags.length > 0) body.push(`${indent}    tags "${tags.join('" "')}"`);
    // What the diagram does not show but the workbook knows: owner, comments,
    // milestones. Filed as properties rather than lost -- the export becomes a
    // complete carry-over, not a summary.
    body.push(
      ...properties(indent + "    ", [
        ["Owner", a.owner],
        ["Comments", a.comments],
        ["Introduced at", a.introducedAt],
        ["Retired at", a.retiredAt],
      ])
    );
    body.push(`${indent}}`);
    return body;
  };

  // The actors filed by group, the orphans flat: an actor with no group still
  // exists, and the integrity check already asks for it.
  const groups = [...new Set(actors.map((a) => a.group.trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "fr")
  );
  for (const group of groups) {
    rows.push(`        group "${text(group)}" {`);
    for (const a of actors.filter((x) => x.group.trim() === group)) rows.push(...declaration(a, "            "));
    rows.push("        }");
  }
  for (const a of actors.filter((x) => !x.group.trim())) rows.push(...declaration(a, "        "));

  rows.push("");
  // Two consumptions of one contract by the same actor make a single link. The
  // technology serves twice: stated on the link so it can be read, set as a tag
  // so the by-technology view can find it again.
  const links = new Set<string>();
  const flows = exportableFlows(model, rank, mode);
  for (const f of flows) {
    const source = ids.get(f.provider.trim());
    const target = ids.get(f.consumer.trim());
    if (!source || !target) continue;
    const tech = text(f.flowType);
    const body = [
      `        ${source} -> ${target} "${text(interfaceLabel(f.interfaceName, f.version))}" "${tech}" {`,
      `            tags "${[tech, ...(isPulled(f) ? [PULLED_TAG] : [])].join('" "')}"`,
    ];
    // The contract is an address: giving it to the tool means one click from the
    // diagram rather than a search through the workbook.
    const url = contractUrl(f.iface.contractLink);
    if (url) body.push(`            url ${url}`);
    body.push(
      ...properties("            ", [
        // What the exchange carries: the relationship's description, in the C4
        // sense. The only text slot a Structurizr link offers is already taken by
        // the label -- the flow's name and version, as on the diagrams -- hence the
        // property rather than the loss.
        ["Description", f.iface.description],
        ["Usage", f.consumption.usage],
        ["Criticality", f.consumption.criticality],
        ["Decision", f.consumption.decision],
        ["Contract reference", f.iface.contractReference],
        // A flow to be confirmed is a flow the workbook is not sure about: without
        // this flag, the produced file would assert more than it does.
        ["To confirm", f.iface.toConfirm ? "Yes" : ""],
        // Two comment columns, two subjects: the contract on one side, the use a
        // consumer makes of it on the other. Merging them into one would lose which
        // came from whom.
        ["Interface comments", f.iface.comments],
        ["Consumption comments", f.consumption.comments],
        ["Introduced at", f.consumption.introducedAt],
        ["Retired at", f.consumption.retiredAt],
      ])
    );
    body.push("        }");
    links.add(body.join("\n"));
  }
  rows.push(...[...links].sort((a, b) => a.localeCompare(b, "fr")));

  rows.push("    }", "", "    views {", ...views(model, actors, ids, flows, milestone), "", "        styles {");
  rows.push('            element "External" {', "                background #6E6579", "                color #ffffff", "            }");
  // The platform had NO style at all: only the external side carried one, so
  // that the file opened in the target tool no longer told apart the two
  // perimeters our diagram has always opposed.
  rows.push('            element "Platform" {', "                background #0E7DAD", "                color #ffffff", "            }");
  // One shape per declared actor type. The table offers a default only for the
  // commonest words: it is the workbook that names its types, and an unknown
  // type stays a box rather than getting a shape at random.
  //
  for (const t of model.actorTypes) {
    const shape = SHAPE_BY_TYPE[normalizeText(t.type)];
    if (!shape) continue;
    rows.push(`            element "${text(t.type)}" {`, `                shape ${shape}`, "            }");
  }
  // Each technology keeps the colour it has in the tool: two readings of the
  // same estate, on two tools, must not change colour code.
  const colours = coloursOfModel(model);
  for (const tech of [...new Set(flows.map((f) => f.flowType.trim()))].sort((a, b) => a.localeCompare(b, "fr"))) {
    rows.push(`            relationship "${text(tech)}" {`, `                color ${colours.get(tech) ?? "#000000"}`, "            }");
  }
  // With no style, the "Pulled" tag changed NOTHING in the target tool: our
  // arrowhead convention was invisible there, although the tag has been set
  // since day one. Structurizr cannot reverse an arrowhead -- it can change the
  // stroke, which at least tells the two cases apart.
  if (flows.some(isPulled)) {
    rows.push(`            relationship "${PULLED_TAG}" {`, "                style dashed", "            }");
  }
  rows.push("        }", "    }", "}", "");

  return rows.join("\n");
}

// One view per diagram the tool can draw. Two of them have no equivalent:
// "group to group" and "platform detail" AGGREGATE actors into one box, which
// neither DSL can express. The overview carries the same material, groups
// included -- Structurizr draws them as boundaries.
//
function views(
  model: ParsedModel,
  actors: Actor[],
  ids: Map<string, string>,
  flows: FlowInstance[],
  milestone: string | null
): string[] {
  // `title` is an INSTRUCTION of the block. `systemLandscape`'s second
  // positional argument is the DESCRIPTION, not the title: set there, it
  // would have left the views named by their technical key -- "tech-rest-esb"
  // -- in the list the target tool presents.
  const view = (header: string, title: string, inclusion: string) => [
    `        ${header} {`,
    `            title "${text(title)}"`,
    `            include ${inclusion}`,
    "            autolayout lr",
    "        }",
  ];

  const atMilestone = milestone ? ` — milestone ${milestone}` : "";
  const rows = [...view('systemLandscape "landscape"', `System landscape${atMilestone}`, "*")];

  // The same predicate as the diagrams: compared strictly here, a group entered
  // as "platform" was a platform on screen and was no longer one in the C4 file,
  // where the dedicated view vanished without a word.
  if (model.groups.some((g) => groupIsPlatform(model, g.name))) {
    rows.push(...view('systemLandscape "platform-only"', `Platform only${atMilestone}`, '"element.tag==Platform"'));
  }

  const techs = [...new Set(flows.map((f) => f.flowType.trim()))].sort((a, b) => a.localeCompare(b, "fr"));
  const keys = identifiers(techs);
  for (const tech of techs) {
    rows.push(
      ...view(
        `systemLandscape "tech-${keys.get(tech)!.replace(/_/g, "-")}"`,
        `${tech} flows${atMilestone}`,
        `"relationship.tag==${text(tech)}"`
      )
    );
  }

  // An actor no flow touches has no diagram in the tool: its view would show
  // show nothing but its own box.
  //
  // A person has none either: `systemContext` applies to a system, and
  // Structurizr refuses the whole file if asked for one on a human. The price
  // of the right word (`person`) is that one missing view.
  const touched = new Set(flows.flatMap((f) => [f.provider.trim(), f.consumer.trim()]));
  for (const a of actors.filter((x) => touched.has(x.name.trim()) && !isAPerson(x))) {
    const id = ids.get(a.name.trim())!;
    rows.push(
      ...view(`systemContext ${id} "actor-${id.replace(/_/g, "-")}"`, `${a.name.trim()} — inbound and outbound${atMilestone}`, "*")
    );
  }

  return rows;
}

// The tag carries the VOCABULARY's spelling, not the workbook's: the
// "platform-only" view filters on "element.tag==Platform", and a group entered
// as "platform" set the tag "platform" -- the view came out empty without a
// word. The predicate, for its part, already normalises on both sides.
function perimeter(model: ParsedModel, group: string): string {
  if (groupIsPlatform(model, group)) return PERIMETER_PLATFORM;
  if (groupIsExternal(model, group)) return PERIMETER_EXTERNAL;
  return "";
}

// A `properties` block is only set if it has something to say: an empty block
// would pass validation but would clutter every element.
function properties(indent: string, paires: [string, string][]): string[] {
  const filled = paires.filter(([, v]) => v.trim() !== "");
  if (filled.length === 0) return [];
  return [
    `${indent}properties {`,
    ...filled.map(([key, v]) => `${indent}    "${key}" "${text(v)}"`),
    `${indent}}`,
  ];
}
