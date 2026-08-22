import type { ParsedModel, Actor } from "../parsing/model";
import {
  groupIsPlatform,
  groupIsExternal,
  interfaceLabel,
  type FlowInstance,
  type Mode,
} from "../aggregation/core";
import { PERIMETER_PLATFORM, PERIMETER_EXTERNAL } from "../aggregation/vocabularies";
import { liveActors } from "../aggregation/milestones";
import { flowsForReading } from "../aggregation/reading";
import { identifiants } from "./identifiers";
import { coloursOfModel } from "../render/colors";
import { normalizeText } from "../shared/text";

// Le classeur en Structurizr DSL : le modèle, pas une planche. C'est la
// différence avec les exports d'image -- on ne rend pas ce qui est à l'écran,
// on rend le parc, à charge pour l'outil C4 d'en tirer les vues qu'il veut.
//
// Un acteur devient un système : le classeur ne descend pas plus bas que le
// composant, et prétendre le contraire inventerait une architecture interne
// que personne n'a saisie.

// Structurizr ne sait pas échapper un guillemet dans une chaîne : un nom qui en
// porte casserait le fichier entier, pas seulement sa ligne.
const text = (v: string) => v.trim().replace(/"/g, "'");


// Un flux se lit dans le sens que le type déclare, celui-là même que dessinent
// les schémas. Un export qui inverserait la flèche raconterait autre chose que
// ce que l'utilisateur a sous les yeux.
// La relation va du fournisseur au consommateur, comme la donnée et comme nos
// schémas. Elle suivait le sens de l'APPEL, si bien qu'un flux tiré sortait à
// l'envers de nos images : le même parc racontait deux histoires selon l'outil
// qui le lisait.
//
// Une relation C4 n'a qu'un sens : l'initiative ne peut pas s'y dessiner comme
// une pointe posée à l'autre bout. Elle passe donc en étiquette, où elle reste
// lisible et filtrable.
function sensDuFlux(f: FlowInstance): { de: string; vers: string } {
  return { de: f.provider, vers: f.consumer };
}

const ETIQUETTE_TIRE = "Pulled";

// Une forme par type d'acteur, pour les mots les plus courants seulement : le
// classeur nomme ses types librement, et un type inconnu reste une boîte
// plutôt que de recevoir une forme au hasard. Les valeurs sont celles que
// Structurizr accepte (Box, RoundedBox, Circle, Ellipse, Hexagon, Diamond,
// Cylinder, Bucket, Pipe, Person, Robot, Folder, WebBrowser, Window,
// Terminal, Shell, MobileDevicePortrait, MobileDeviceLandscape, Component).
const FORME_PAR_TYPE: Record<string, string> = {
  queue: "Pipe",
  topic: "Pipe",
  broker: "Pipe",
  bus: "Pipe",
  database: "Cylinder",
  storage: "Cylinder",
  person: "Person",
  humain: "Person",
  batch: "Robot",
  screen: "Window",
  browser: "WebBrowser",
};
const isPulled = (f: FlowInstance) => f.direction === "consumer-to-provider";

// Un acteur qui consomme l'interface qu'il expose lui-même donnerait une
// relation d'un élément vers lui-même : elle ne dit rien dans un modèle C4, et
// les vues agrégées la masquent déjà (§4.3). Structurizr l'accepte, LikeC4
// refuse le fichier entier -- « Invalid parent-child relationship » -- mais les
// deux exports rendent le même modèle : ce qui disparaît de l'un disparaît de
// l'autre, sans quoi le classeur raconterait deux parcs selon l'outil.
function exportableFlows(model: ParsedModel, rank: number | null, mode: Mode): FlowInstance[] {
  return flowsForReading(model, rank, mode).filter((f) => f.provider.trim() !== f.consumer.trim());
}

export function modelToStructurizr(
  model: ParsedModel,
  rank: number | null,
  nomClasseur: string,
  milestone: string | null = null,
  // La lecture que le fichier porte. Il DOIT le dire : livrer un fichier qui
  // raconte autre chose que l'écran est ce qu'on s'interdit partout ailleurs,
  // et c'était le seul motif de fermer cet export en fonctionnel.
  mode: Mode = "architecture"
): string {
  const actors = liveActors(model, rank);
  const ids = identifiants(actors.map((a) => a.name.trim()));
  const name = nomClasseur.replace(/\.(xlsx|xlsm)$/i, "");

  const fonctionnel = mode === "functional";
  const rows: string[] = [
    `workspace "${text(name)}${fonctionnel ? " (functional reading)" : ""}" "${
      fonctionnel
        ? "Interface map, functional reading: chains folded, media removed."
        : "Interface map, exported from the workbook."
    }"`,
    "",
    "    model {",
    // Un acteur imbriqué se désigne alors par son chemin complet, ce qui rend
    // le fichier relisible quand deux groupes portent un même nom court.
    "        !identifiers hierarchical",
  ];

  const declaration = (a: Actor, indent: string) => {
    // Un humain n'est pas un système : C4 a un mot pour ça, et le classeur le
    // dit déjà dans son type d'acteur.
    const mot = isAPerson(a) ? "person" : "softwareSystem";
    const body = [`${indent}${ids.get(a.name.trim())} = ${mot} "${text(a.name)}" "${text(a.description)}" {`];
    const tags = [a.actorType, perimeter(model, a.group)].map(text).filter(Boolean);
    if (tags.length > 0) body.push(`${indent}    tags "${tags.join('" "')}"`);
    // Ce que le schéma ne montre pas mais que le classeur sait : responsable,
    // commentaires, paliers. Rangé en propriétés plutôt que perdu -- l'export
    // devient une reprise complète, pas un résumé.
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

  // Les acteurs rangés par groupe, les orphelins à plat : un acteur sans
  // groupe existe quand même, et le contrôle d'intégrité le réclame déjà.
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
  // Deux consommations d'un même contrat par le même acteur ne font qu'un lien.
  // La technologie sert deux fois : dite sur le lien pour qu'on la lise, posée
  // en étiquette pour que la vue par technologie sache le retrouver.
  const liens = new Set<string>();
  const flows = exportableFlows(model, rank, mode);
  for (const f of flows) {
    const { de, vers } = sensDuFlux(f);
    const source = ids.get(de.trim());
    const target = ids.get(vers.trim());
    if (!source || !target) continue;
    const tech = text(f.flowType);
    const body = [
      `        ${source} -> ${target} "${text(interfaceLabel(f.interfaceName, f.version))}" "${tech}" {`,
      `            tags "${[tech, ...(isPulled(f) ? [ETIQUETTE_TIRE] : [])].join('" "')}"`,
    ];
    // Le contrat est une adresse : la donner à l'outil, c'est un clic depuis le
    // schéma plutôt qu'une recherche dans le classeur.
    if (f.iface.contractLink.trim()) body.push(`            url ${f.iface.contractLink.trim()}`);
    body.push(
      ...properties("            ", [
        // Ce que l'échange transporte : la description de la relation, au sens
        // C4. Le seul emplacement de texte qu'un lien Structurizr offre est
        // déjà pris par le libellé -- nom et version du flux, comme sur les
        // schémas --, d'où la propriété plutôt que la perte.
        ["Description", f.iface.description],
        ["Usage", f.consumption.usage],
        ["Criticality", f.consumption.criticality],
        ["Decision", f.consumption.decision],
        ["Contract reference", f.iface.contractReference],
        // Un flux à confirmer est un flux dont le classeur n'est pas sûr : sans
        // ce drapeau, le fichier produit affirmerait plus que lui.
        ["To confirm", f.iface.toConfirm ? "Yes" : ""],
        // Deux colonnes de commentaires, deux sujets : le contrat d'un côté,
        // l'usage qu'un consommateur en fait de l'autre. Les fondre en une
        // seule perdrait de qui vient quoi.
        ["Interface comments", f.iface.comments],
        ["Consumption comments", f.consumption.comments],
        ["Introduced at", f.consumption.introducedAt],
        ["Retired at", f.consumption.retiredAt],
      ])
    );
    body.push("        }");
    liens.add(body.join("\n"));
  }
  rows.push(...[...liens].sort((a, b) => a.localeCompare(b, "fr")));

  rows.push("    }", "", "    views {", ...views(model, actors, ids, flows, milestone), "", "        styles {");
  rows.push('            element "External" {', "                background #6E6579", "                color #ffffff", "            }");
  // La plateforme n'avait AUCUN style : seul l'externe en portait un, si bien
  // que le fichier ouvert dans l'outil cible ne distinguait plus les deux
  // périmètres que notre schéma oppose depuis toujours.
  rows.push('            element "Platform" {', "                background #0E7DAD", "                color #ffffff", "            }");
  // Une forme par type d'acteur déclaré. La table ne propose un défaut que
  // pour les mots les plus courants : c'est le classeur qui nomme ses types,
  // et un type inconnu reste une boîte plutôt que de recevoir une forme au
  // hasard.
  for (const t of model.actorTypes) {
    const shape = FORME_PAR_TYPE[normalizeText(t.type)];
    if (!shape) continue;
    rows.push(`            element "${text(t.type)}" {`, `                shape ${shape}`, "            }");
  }
  // Chaque technologie garde la couleur qu'elle a dans l'outil : deux lectures
  // du même parc, sur deux outils, ne doivent pas changer de code couleur.
  const colours = coloursOfModel(model);
  for (const tech of [...new Set(flows.map((f) => f.flowType.trim()))].sort((a, b) => a.localeCompare(b, "fr"))) {
    rows.push(`            relationship "${text(tech)}" {`, `                color ${colours.get(tech) ?? "#000000"}`, "            }");
  }
  // Sans style, l'étiquette « Pulled » ne changeait RIEN dans l'outil cible :
  // notre convention de pointe y était invisible, alors que le tag est posé
  // depuis toujours. Structurizr ne sait pas inverser une pointe -- il sait
  // changer le trait, ce qui distingue au moins les deux cas.
  if (flows.some(isPulled)) {
    rows.push(`            relationship "${ETIQUETTE_TIRE}" {`, "                style dashed", "            }");
  }
  rows.push("        }", "    }", "}", "");

  return rows.join("\n");
}

// Une vue par schéma que l'outil sait dessiner. Deux d'entre eux n'ont pas
// d'équivalent : « groupe à groupe » et « plateforme détaillée » AGRÈGENT des
// acteurs en une boîte, ce qu'aucun des deux DSL ne sait exprimer. La vue
// d'ensemble porte la même matière, groupes compris -- Structurizr les dessine
// en frontières.
function views(
  model: ParsedModel,
  actors: Actor[],
  ids: Map<string, string>,
  flows: FlowInstance[],
  milestone: string | null
): string[] {
  // `title` est une INSTRUCTION du bloc. Le second argument positionnel de
  // `systemLandscape` est la DESCRIPTION, pas le titre : posé là, il aurait
  // laissé les vues nommées par leur clé technique -- « tech-rest-esb » --
  // dans la liste que l'outil cible présente.
  const view = (header: string, title: string, inclusion: string) => [
    `        ${header} {`,
    `            title "${text(title)}"`,
    `            include ${inclusion}`,
    "            autolayout lr",
    "        }",
  ];

  const auPalier = milestone ? ` — milestone ${milestone}` : "";
  const rows = [...view('systemLandscape "landscape"', `System landscape${auPalier}`, "*")];

  // Le même prédicat que les schémas : comparé en strict ici, un groupe saisi
  // « platform » était une plateforme à l'écran et n'en était plus une dans le
  // fichier C4, où la vue dédiée disparaissait sans un mot.
  if (model.groups.some((g) => groupIsPlatform(model, g.name))) {
    rows.push(...view('systemLandscape "platform-only"', `Platform only${auPalier}`, '"element.tag==Platform"'));
  }

  const techs = [...new Set(flows.map((f) => f.flowType.trim()))].sort((a, b) => a.localeCompare(b, "fr"));
  const keys = identifiants(techs);
  for (const tech of techs) {
    rows.push(
      ...view(
        `systemLandscape "tech-${keys.get(tech)!.replace(/_/g, "-")}"`,
        `${tech} flows${auPalier}`,
        `"relationship.tag==${text(tech)}"`
      )
    );
  }

  // Un acteur qu'aucun flux ne touche n'a pas de schéma dans l'outil : sa vue
  // de contexte ne montrerait que sa propre boîte.
  //
  // Une personne n'en a pas non plus : `systemContext` porte sur un système, et
  // Structurizr refuse le fichier entier si on lui en demande une sur un
  // humain. Le prix du mot juste (`person`) est cette vue en moins.
  const touched = new Set(flows.flatMap((f) => [f.provider.trim(), f.consumer.trim()]));
  for (const a of actors.filter((x) => touched.has(x.name.trim()) && !isAPerson(x))) {
    const id = ids.get(a.name.trim())!;
    rows.push(
      ...view(`systemContext ${id} "actor-${id.replace(/_/g, "-")}"`, `${a.name.trim()} — inbound and outbound${auPalier}`, "*")
    );
  }

  return rows;
}

// L'étiquette porte l'écriture du VOCABULAIRE, pas celle du classeur : la vue
// « platform-only » filtre sur « element.tag==Platform », et un groupe saisi
// « platform » posait l'étiquette « platform » -- la vue sortait vide sans un
// mot. Le prédicat, lui, normalise déjà des deux côtés.
function perimeter(model: ParsedModel, group: string): string {
  if (groupIsPlatform(model, group)) return PERIMETER_PLATFORM;
  if (groupIsExternal(model, group)) return PERIMETER_EXTERNAL;
  return "";
}

// Le classeur nomme ses types d'acteur librement ; on ne reconnaît que celui
// que C4 sait rendre autrement, dans les deux langues qu'un classeur peut
// porter. Tout le reste est un système.
function isAPerson(a: Actor): boolean {
  return ["person", "humain"].includes(normalizeText(a.actorType));
}

// Un bloc `properties` ne se pose que s'il a quelque chose à dire : un bloc
// vide passerait la validation mais encombrerait chaque élément.
function properties(indent: string, paires: [string, string][]): string[] {
  const remplies = paires.filter(([, v]) => v.trim() !== "");
  if (remplies.length === 0) return [];
  return [
    `${indent}properties {`,
    ...remplies.map(([key, v]) => `${indent}    "${key}" "${text(v)}"`),
    `${indent}}`,
  ];
}
