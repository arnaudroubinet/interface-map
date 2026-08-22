import type { ParsedModel, Acteur } from "../parsing/model";
import {
  buildFlowInstances,
  libelleInterface,
  groupeEstExterne,
  groupeEstPlateforme,
  type FlowInstance,
} from "../aggregation/core";
import { acteursVivants } from "../aggregation/paliers";
import { couleursDuModele } from "../render/colors";
import { identifiants } from "./identifiants";
import { normalizeText } from "../shared/text";

// Le classeur en LikeC4. Même matière que l'export Structurizr, autre grammaire :
// LikeC4 dit l'appartenance par l'imbrication, là où Structurizr a un mot pour
// le groupe. Un acteur imbriqué se désigne ensuite par son chemin complet.

const texte = (v: string) => v.trim().replace(/"/g, "'");


// La relation va du fournisseur au consommateur, comme la donnée et comme nos
// schémas. Elle suivait le sens de l'APPEL, si bien qu'un flux tiré sortait à
// l'envers de nos images : le même parc racontait deux histoires selon l'outil
// qui le lisait.
//
// Une relation C4 n'a qu'un sens : l'initiative ne peut pas s'y dessiner comme
// une pointe posée à l'autre bout. Elle passe donc en étiquette, où elle reste
// lisible et filtrable.
function sensDuFlux(f: FlowInstance): { de: string; vers: string } {
  return { de: f.exposant, vers: f.consommateur };
}

const ETIQUETTE_TIRE = "Pulled";
const estTire = (f: FlowInstance) => f.sens === "consommateur-exposant";

// LikeC4 refuse le fichier entier sur une relation d'un élément vers lui-même
// -- « Invalid parent-child relationship » -- et un acteur qui consomme ce
// qu'il expose en produirait une. Elle ne dirait rien de toute façon : les vues
// agrégées la masquent déjà (§4.3), et l'export Structurizr l'écarte pareil.
function fluxExportables(model: ParsedModel, rang: number | null): FlowInstance[] {
  return buildFlowInstances(model, rang).filter((f) => f.exposant.trim() !== f.consommateur.trim());
}

const parNom = (a: string, b: string) => a.localeCompare(b, "fr");

export function modeleEnLikeC4(model: ParsedModel, rang: number | null): string {
  const acteurs = acteursVivants(model, rang);
  const groupes = [...new Set(acteurs.map((a) => a.groupe.trim()).filter(Boolean))].sort(parNom);
  // Groupes et acteurs partagent l'espace des identifiants : un groupe et un
  // acteur du même nom se marcheraient dessus.
  const ids = identifiants([...groupes, ...acteurs.map((a) => a.nom.trim())]);
  const chemins = new Map(
    acteurs.map((a) => {
      const id = ids.get(a.nom.trim())!;
      const groupe = a.groupe.trim();
      return [a.nom.trim(), groupe ? `${ids.get(groupe)}.${id}` : id];
    })
  );

  const flux = fluxExportables(model, rang);
  // Les étiquettes de technologie servent aux vues par technologie. LikeC4 veut
  // des identifiants, là où le classeur écrit « REST + ESB ».
  const technos = [...new Set(flux.map((f) => f.typeDeFlux.trim()))].sort(parNom);
  const étiquettes = identifiants(technos);
  const couleurs = couleursDuModele(model);

  const lignes: string[] = [
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
    ...technos.map((t) => `    tag ${étiquettes.get(t)}`),
    // Un kind de relation par technologie. LikeC4 est la seule cible qui sache
    // dessiner notre convention : la pointe au bout CONSOMMATEUR quand le
    // fournisseur pousse, au bout FOURNISSEUR quand le consommateur tire. On
    // le lui dit enfin, au lieu de réduire la chose à une étiquette.
    //
    // `line solid` est explicite : le style de trait par défaut de LikeC4 est
    // `dashed`, et tous nos traits seraient sortis en pointillé -- ce qui
    // aurait effacé la distinction que le pointillé porte chez nous, la
    // décision « Transform ».
    ...technos.flatMap((t) => {
      const tiré = model.typesFlux.some((tf) => tf.type.trim() === t && tf.sensRepresentation === "consommateur-exposant");
      return [
        `    relationship ${étiquettes.get(t)} {`,
        `        technology "${texte(t)}"`,
        "        style {",
        "            line solid",
        `            color ${couleurs.get(t) ?? "#000000"}`,
        // `vee` est la pointe ouverte, `normal` la pleine : le même couple que
        // nos schémas, et celui qu'UML emploie sur ses messages.
        tiré ? "            head vee" : "            head normal",
        tiré ? "            tail none" : "            tail none",
        "        }",
        "    }",
      ];
    }),
    "}",
    "",
    "model {",
  ];

  const déclaration = (a: Acteur, indent: string) => {
    const nature = estUnePersonne(a) ? "person" : "system";
    const corps = [`${indent}${ids.get(a.nom.trim())} = ${nature} "${texte(a.nom)}" {`];
    // Les étiquettes passent avant les propriétés : LikeC4 l'exige.
    if (groupeEstExterne(model, a.groupe)) corps.push(`${indent}    #external`);
    if (groupeEstPlateforme(model, a.groupe)) corps.push(`${indent}    #platform`);
    if (a.description.trim()) corps.push(`${indent}    description "${texte(a.description)}"`);
    if (a.typeActeur.trim()) corps.push(`${indent}    technology "${texte(a.typeActeur)}"`);
    corps.push(
      ...métadonnées(indent + "    ", [
        ["owner", a.responsable],
        ["comments", a.commentaires],
        ["introducedAt", a.palierIntroduction],
        ["retiredAt", a.palierRetrait],
      ])
    );
    corps.push(`${indent}}`);
    return corps;
  };

  for (const groupe of groupes) {
    lignes.push(`    ${ids.get(groupe)} = group "${texte(groupe)}" {`);
    for (const a of acteurs.filter((x) => x.groupe.trim() === groupe)) lignes.push(...déclaration(a, "        "));
    lignes.push("    }");
  }
  for (const a of acteurs.filter((x) => !x.groupe.trim())) lignes.push(...déclaration(a, "    "));

  lignes.push("");
  const liens = new Map<string, string[]>();
  for (const f of flux) {
    const { de, vers } = sensDuFlux(f);
    const source = chemins.get(de.trim());
    const cible = chemins.get(vers.trim());
    if (!source || !cible) continue;
    const libellé = texte(libelleInterface(f.interfaceNom, f.version));
    const kind = étiquettes.get(f.typeDeFlux.trim());
    const corps = [
      // `-[kind]->` plutôt qu'une flèche nue : c'est le kind qui porte la
      // pointe, la couleur et le style déclarés plus haut.
      `    ${source} -[${kind}]-> ${cible} "${libellé}" {`,
      `        #${kind}`,
    ];
    // L'initiative, en étiquette : LikeC4 sait filtrer dessus, et sans elle le
    // fichier perdrait ce que la pointe porte sur nos schémas.
    if (estTire(f)) corps.push(`        #${ETIQUETTE_TIRE.toLowerCase()}`);
    // Ce que l'échange transporte, au champ que LikeC4 prévoit pour ça : la
    // relation a une description distincte de son libellé, là où Structurizr
    // n'a que le libellé et doit s'en remettre à une propriété.
    if (f.iface.description.trim()) corps.push(`        description "${texte(f.iface.description)}"`);
    corps.push(`        technology "${texte(f.typeDeFlux)}"`);
    // Le contrat est une adresse : un clic depuis le schéma vaut mieux qu'une
    // recherche dans le classeur.
    if (f.iface.lienContrat.trim()) corps.push(`        link ${f.iface.lienContrat.trim()}`);
    corps.push(
      ...métadonnées("        ", [
        ["usage", f.conso.usage],
        ["criticality", f.conso.criticite],
        ["decision", f.conso.decision],
        ["contractReference", f.iface.referenceContrat],
        // Un flux à confirmer est un flux dont le classeur n'est pas sûr : sans
        // ce drapeau, le fichier produit affirmerait plus que lui.
        ["toConfirm", f.iface.aConfirmer ? "Yes" : ""],
        // Deux colonnes de commentaires, deux sujets : le contrat d'un côté,
        // l'usage qu'un consommateur en fait de l'autre.
        ["interfaceComments", f.iface.commentaires],
        ["consumptionComments", f.conso.commentaires],
        ["introducedAt", f.conso.palierIntroduction],
        ["retiredAt", f.conso.palierRetrait],
      ])
    );
    corps.push("    }");
    liens.set(`${source} -> ${cible} "${libellé}"`, corps);
  }
  for (const clé of [...liens.keys()].sort((a, b) => a.localeCompare(b, "fr"))) lignes.push(...liens.get(clé)!);

  lignes.push("}", "", "views {", ...vues(model, acteurs, chemins, technos, étiquettes, flux, ids), "}", "");

  return lignes.join("\n");
}

// Une vue par schéma que l'outil sait dessiner, les deux vues agrégées
// comprises. Le commentaire qui les déclarait inexprimables valait pour
// Structurizr, pas pour LikeC4 : les groupes sont DÉJÀ des éléments du modèle
// exporté, et les inclure SANS leur `.*` donne une boîte par groupe.
function vues(
  model: ParsedModel,
  acteurs: Acteur[],
  chemins: Map<string, string>,
  technos: string[],
  étiquettes: Map<string, string>,
  flux: FlowInstance[],
  ids: Map<string, string>
): string[] {
  // Le nom d'une vue est un identifiant -- « tech_rest_esb » -- que personne ne
  // veut lire dans une liste. Le titre porte le vrai nom.
  const vue = (entête: string, titre: string, inclusion: string) => [
    `    view ${entête} {`,
    `        title "${texte(titre)}"`,
    `        include ${inclusion}`,
    "        autoLayout LeftRight",
    "    }",
  ];

  const lignes = [...vue("index", "Everything the workbook holds", "*")];

  // Les deux vues agrégées, que le commentaire précédent déclarait
  // inexprimables : un groupe cité SANS son `.*` est une boîte, avec son `.*`
  // il est ouvert. C'est exactement l'opposition « groupe à groupe » et
  // « plateforme détaillée ».
  const groupes = [...new Set(acteurs.map((a) => a.groupe.trim()).filter(Boolean))].sort(parNom);
  if (groupes.length > 1) {
    lignes.push(
      ...vue("group_to_group", "Group to group", groupes.map((g) => ids.get(g)!).join(", "))
    );
  }
  const plateforme = groupes.filter((g) => groupeEstPlateforme(model, g));
  if (plateforme.length > 0 && groupes.length > plateforme.length) {
    const inclusion = [
      ...plateforme.map((g) => `${ids.get(g)}.*`),
      ...groupes.filter((g) => !groupeEstPlateforme(model, g)).map((g) => ids.get(g)!),
    ];
    lignes.push(...vue("platform_detail", "Platform detail", inclusion.join(", ")));
  }

  // Le même prédicat que les schémas : comparé en strict ici, un groupe saisi
  // « platform » était une plateforme à l'écran et n'en était plus une dans le
  // fichier C4, où la vue dédiée disparaissait sans un mot.
  if (model.groupes.some((g) => groupeEstPlateforme(model, g.nom))) {
    lignes.push(...vue("platform_only", "Platform only", "* where tag is #platform"));
  }

  for (const techno of technos) {
    const tag = étiquettes.get(techno)!;
    lignes.push(...vue(`tech_${tag}`, techno, `* where tag is #${tag}`));
  }

  // Un acteur qu'aucun flux ne touche n'a pas de schéma dans l'outil : sa vue
  // ne montrerait que sa propre boîte.
  const touchés = new Set(flux.flatMap((f) => [f.exposant.trim(), f.consommateur.trim()]));
  for (const a of acteurs.filter((x) => touchés.has(x.nom.trim()))) {
    const chemin = chemins.get(a.nom.trim())!;
    lignes.push(...vue(`actor_${chemin.split(".").pop()} of ${chemin}`, a.nom, "*"));
  }

  return lignes;
}

// Le classeur nomme ses types d'acteur librement ; on ne reconnaît que celui
// qui a une forme à lui, dans les deux langues qu'un classeur peut porter.
function estUnePersonne(a: Acteur): boolean {
  return ["person", "humain"].includes(normalizeText(a.typeActeur));
}

// Ce que le schéma ne montre pas mais que le classeur sait. Un bloc vide ne se
// pose pas : il encombrerait chaque élément sans rien dire.
function métadonnées(indent: string, paires: [string, string][]): string[] {
  const remplies = paires.filter(([, v]) => v.trim() !== "");
  if (remplies.length === 0) return [];
  return [
    `${indent}metadata {`,
    ...remplies.map(([clé, v]) => `${indent}    ${clé} "${texte(v)}"`),
    `${indent}}`,
  ];
}
