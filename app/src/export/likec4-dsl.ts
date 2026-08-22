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

// Le classeur en LikeC4. Même matière que l'export Structurizr, autre grammaire :
// LikeC4 dit l'appartenance par l'imbrication, là où Structurizr a un mot pour
// le groupe. Un acteur imbriqué se désigne ensuite par son chemin complet.

const text = (v: string) => v.trim().replace(/"/g, "'");


// La relation va du fournisseur au consommateur, comme la donnée et comme nos
// schémas. Elle suivait le sens de l'APPEL, si bien qu'un flux tiré sortait à
// l'envers de nos images : le même parc racontait deux histoires selon l'outil
// qui le lisait.
//
// Une relation C4 n'a qu'un sens : l'initiative ne peut pas s'y dessiner comme
// une pointe posée à l'autre bout. Elle passe donc en étiquette, où elle reste
// lisible et filtrable.
function flowDirection(f: FlowInstance): { de: string; vers: string } {
  return { de: f.provider, vers: f.consumer };
}

const ETIQUETTE_TIRE = "Pulled";
const isPulled = (f: FlowInstance) => f.direction === "consumer-to-provider";

// LikeC4 refuse le fichier entier sur une relation d'un élément vers lui-même
// -- « Invalid parent-child relationship » -- et un acteur qui consomme ce
// qu'il expose en produirait une. Elle ne dirait rien de toute façon : les vues
// agrégées la masquent déjà (§4.3), et l'export Structurizr l'écarte pareil.
function exportableFlows(model: ParsedModel, rank: number | null, mode: Mode): FlowInstance[] {
  return flowsForReading(model, rank, mode).filter((f) => f.provider.trim() !== f.consumer.trim());
}

const byName = (a: string, b: string) => a.localeCompare(b, "fr");

export function modelToLikeC4(model: ParsedModel, rank: number | null, mode: Mode = "architecture"): string {
  // La lecture que le fichier porte. Il DOIT le dire : livrer un fichier qui
  // raconte autre chose que l'écran est ce qu'on s'interdit partout ailleurs.
  const fonctionnel = mode === "functional";
  const actors = liveActors(model, rank);
  const groups = [...new Set(actors.map((a) => a.group.trim()).filter(Boolean))].sort(byName);
  // Groupes et acteurs partagent l'espace des identifiants : un groupe et un
  // acteur du même nom se marcheraient dessus.
  const ids = identifiers([...groups, ...actors.map((a) => a.name.trim())]);
  const paths = new Map(
    actors.map((a) => {
      const id = ids.get(a.name.trim())!;
      const group = a.group.trim();
      return [a.name.trim(), group ? `${ids.get(group)}.${id}` : id];
    })
  );

  const flows = exportableFlows(model, rank, mode);
  // Les étiquettes de technologie servent aux vues par technologie. LikeC4 veut
  // des identifiants, là où le classeur écrit « REST + ESB ».
  const techs = [...new Set(flows.map((f) => f.flowType.trim()))].sort(byName);
  const tags = identifiers(techs);
  const colours = coloursOfModel(model);

  const rows: string[] = [
    `// Interface map${fonctionnel ? ", functional reading: chains folded, media removed." : "."}`,
    "specification {",
    "    element group",
    "    element system",
    // Un humain se dessine en bonhomme, pas en boîte : LikeC4 a la forme, le
    // classeur a le type d'acteur, il n'y a qu'à les relier.
    "    element person {",
    "        style {",
    "            shape person",
    "        }",
    "    }",
    "    tag external",
    "    tag platform",
    // LikeC4 refuse une étiquette non déclarée : celle-ci l'est toujours, même
    // si aucun flux tiré n'existe dans ce classeur -- une déclaration inutile
    // ne coûte rien, un fichier invalide coûte tout.
    `    tag ${ETIQUETTE_TIRE.toLowerCase()}`,
    ...techs.map((t) => `    tag ${tags.get(t)}`),
    // Un kind de relation par technologie. LikeC4 est la seule cible qui sache
    // dessiner notre convention : la pointe au bout CONSOMMATEUR quand le
    // fournisseur pousse, au bout FOURNISSEUR quand le consommateur tire. On
    // le lui dit enfin, au lieu de réduire la chose à une étiquette.
    //
    // `line solid` est explicite : le style de trait par défaut de LikeC4 est
    // `dashed`, et tous nos traits seraient sortis en pointillé -- ce qui
    // aurait effacé la distinction que le pointillé porte chez nous, la
    // décision « Transform ».
    ...techs.flatMap((t) => {
      const pulled = model.flowTypes.some((tf) => tf.type.trim() === t && tf.direction === "consumer-to-provider");
      return [
        `    relationship ${tags.get(t)} {`,
        `        technology "${text(t)}"`,
        "        style {",
        "            line solid",
        `            color ${colours.get(t) ?? "#000000"}`,
        // `vee` est la pointe ouverte, `normal` la pleine : le même couple que
        // nos schémas, et celui qu'UML emploie sur ses messages.
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
    // Les étiquettes passent avant les propriétés : LikeC4 l'exige.
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
      // `-[kind]->` plutôt qu'une flèche nue : c'est le kind qui porte la
      // pointe, la couleur et le style déclarés plus haut.
      `    ${source} -[${kind}]-> ${target} "${label}" {`,
      `        #${kind}`,
    ];
    // L'initiative, en étiquette : LikeC4 sait filtrer dessus, et sans elle le
    // fichier perdrait ce que la pointe porte sur nos schémas.
    if (isPulled(f)) body.push(`        #${ETIQUETTE_TIRE.toLowerCase()}`);
    // Ce que l'échange transporte, au champ que LikeC4 prévoit pour ça : la
    // relation a une description distincte de son libellé, là où Structurizr
    // n'a que le libellé et doit s'en remettre à une propriété.
    if (f.iface.description.trim()) body.push(`        description "${text(f.iface.description)}"`);
    body.push(`        technology "${text(f.flowType)}"`);
    // Le contrat est une adresse : un clic depuis le schéma vaut mieux qu'une
    // recherche dans le classeur.
    if (f.iface.contractLink.trim()) body.push(`        link ${f.iface.contractLink.trim()}`);
    body.push(
      ...metadata("        ", [
        ["usage", f.consumption.usage],
        ["criticality", f.consumption.criticality],
        ["decision", f.consumption.decision],
        ["contractReference", f.iface.contractReference],
        // Un flux à confirmer est un flux dont le classeur n'est pas sûr : sans
        // ce drapeau, le fichier produit affirmerait plus que lui.
        ["toConfirm", f.iface.toConfirm ? "Yes" : ""],
        // Deux colonnes de commentaires, deux sujets : le contrat d'un côté,
        // l'usage qu'un consommateur en fait de l'autre.
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

// Une vue par schéma que l'outil sait dessiner, les deux vues agrégées
// comprises. Le commentaire qui les déclarait inexprimables valait pour
// Structurizr, pas pour LikeC4 : les groupes sont DÉJÀ des éléments du modèle
// exporté, et les inclure SANS leur `.*` donne une boîte par groupe.
function views(
  model: ParsedModel,
  actors: Actor[],
  paths: Map<string, string>,
  techs: string[],
  tags: Map<string, string>,
  flows: FlowInstance[],
  ids: Map<string, string>
): string[] {
  // Le nom d'une vue est un identifiant -- « tech_rest_esb » -- que personne ne
  // veut lire dans une liste. Le titre porte le vrai nom.
  const view = (header: string, title: string, inclusion: string) => [
    `    view ${header} {`,
    `        title "${text(title)}"`,
    `        include ${inclusion}`,
    "        autoLayout LeftRight",
    "    }",
  ];

  const rows = [...view("index", "Everything the workbook holds", "*")];

  // Les deux vues agrégées, que le commentaire précédent déclarait
  // inexprimables : un groupe cité SANS son `.*` est une boîte, avec son `.*`
  // il est ouvert. C'est exactement l'opposition « groupe à groupe » et
  // « plateforme détaillée ».
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

  // Le même prédicat que les schémas : comparé en strict ici, un groupe saisi
  // « platform » était une plateforme à l'écran et n'en était plus une dans le
  // fichier C4, où la vue dédiée disparaissait sans un mot.
  if (model.groups.some((g) => groupIsPlatform(model, g.name))) {
    rows.push(...view("platform_only", "Platform only", "* where tag is #platform"));
  }

  for (const tech of techs) {
    const tag = tags.get(tech)!;
    rows.push(...view(`tech_${tag}`, tech, `* where tag is #${tag}`));
  }

  // Un acteur qu'aucun flux ne touche n'a pas de schéma dans l'outil : sa vue
  // ne montrerait que sa propre boîte.
  const touched = new Set(flows.flatMap((f) => [f.provider.trim(), f.consumer.trim()]));
  for (const a of actors.filter((x) => touched.has(x.name.trim()))) {
    const path = paths.get(a.name.trim())!;
    rows.push(...view(`actor_${path.split(".").pop()} of ${path}`, a.name, "*"));
  }

  return rows;
}

// Le classeur nomme ses types d'acteur librement ; on ne reconnaît que celui
// qui a une forme à lui, dans les deux langues qu'un classeur peut porter.
function isAPerson(a: Actor): boolean {
  return ["person", "humain"].includes(normalizeText(a.actorType));
}

// Ce que le schéma ne montre pas mais que le classeur sait. Un bloc vide ne se
// pose pas : il encombrerait chaque élément sans rien dire.
function metadata(indent: string, paires: [string, string][]): string[] {
  const filled = paires.filter(([, v]) => v.trim() !== "");
  if (filled.length === 0) return [];
  return [
    `${indent}metadata {`,
    ...filled.map(([key, v]) => `${indent}    ${key} "${text(v)}"`),
    `${indent}}`,
  ];
}
