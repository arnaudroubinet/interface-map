import type { ParsedModel, Acteur } from "../parsing/model";
import { groupeEstPlateforme, buildFlowInstances, libelleInterface, type FlowInstance } from "../aggregation/core";
import { intervalleDeVie, estVivant } from "../aggregation/paliers";
import { identifiants } from "./identifiants";
import { couleursDuModele } from "../render/colors";
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
const texte = (v: string) => v.trim().replace(/"/g, "'");

function acteursVivants(model: ParsedModel, rang: number | null): Acteur[] {
  if (rang === null || model.paliers.length === 0) return model.acteurs;
  return model.acteurs.filter((a) => estVivant(intervalleDeVie(model, a), rang));
}

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
  return { de: f.exposant, vers: f.consommateur };
}

const ETIQUETTE_TIRE = "Pulled";
const estTire = (f: FlowInstance) => f.sens === "consommateur-exposant";

// Un acteur qui consomme l'interface qu'il expose lui-même donnerait une
// relation d'un élément vers lui-même : elle ne dit rien dans un modèle C4, et
// les vues agrégées la masquent déjà (§4.3). Structurizr l'accepte, LikeC4
// refuse le fichier entier -- « Invalid parent-child relationship » -- mais les
// deux exports rendent le même modèle : ce qui disparaît de l'un disparaît de
// l'autre, sans quoi le classeur raconterait deux parcs selon l'outil.
function fluxExportables(model: ParsedModel, rang: number | null): FlowInstance[] {
  return buildFlowInstances(model, rang).filter((f) => f.exposant.trim() !== f.consommateur.trim());
}

export function modeleEnStructurizr(model: ParsedModel, rang: number | null, nomClasseur: string): string {
  const acteurs = acteursVivants(model, rang);
  const ids = identifiants(acteurs.map((a) => a.nom.trim()));
  const nom = nomClasseur.replace(/\.(xlsx|xlsm)$/i, "");

  const lignes: string[] = [`workspace "${texte(nom)}" "Interface map, exported from the workbook."`, "", "    model {"];

  const déclaration = (a: Acteur, indent: string) => {
    // Un humain n'est pas un système : C4 a un mot pour ça, et le classeur le
    // dit déjà dans son type d'acteur.
    const mot = estUnePersonne(a) ? "person" : "softwareSystem";
    const corps = [`${indent}${ids.get(a.nom.trim())} = ${mot} "${texte(a.nom)}" "${texte(a.description)}" {`];
    const tags = [a.typeActeur, périmètre(model, a.groupe)].map(texte).filter(Boolean);
    if (tags.length > 0) corps.push(`${indent}    tags "${tags.join('" "')}"`);
    // Ce que le schéma ne montre pas mais que le classeur sait : responsable,
    // commentaires, paliers. Rangé en propriétés plutôt que perdu -- l'export
    // devient une reprise complète, pas un résumé.
    corps.push(
      ...propriétés(indent + "    ", [
        ["Owner", a.responsable],
        ["Comments", a.commentaires],
        ["Introduced at", a.palierIntroduction],
        ["Retired at", a.palierRetrait],
      ])
    );
    corps.push(`${indent}}`);
    return corps;
  };

  // Les acteurs rangés par groupe, les orphelins à plat : un acteur sans
  // groupe existe quand même, et le contrôle d'intégrité le réclame déjà.
  const groupes = [...new Set(acteurs.map((a) => a.groupe.trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "fr")
  );
  for (const groupe of groupes) {
    lignes.push(`        group "${texte(groupe)}" {`);
    for (const a of acteurs.filter((x) => x.groupe.trim() === groupe)) lignes.push(...déclaration(a, "            "));
    lignes.push("        }");
  }
  for (const a of acteurs.filter((x) => !x.groupe.trim())) lignes.push(...déclaration(a, "        "));

  lignes.push("");
  // Deux consommations d'un même contrat par le même acteur ne font qu'un lien.
  // La technologie sert deux fois : dite sur le lien pour qu'on la lise, posée
  // en étiquette pour que la vue par technologie sache le retrouver.
  const liens = new Set<string>();
  const flux = fluxExportables(model, rang);
  for (const f of flux) {
    const { de, vers } = sensDuFlux(f);
    const source = ids.get(de.trim());
    const cible = ids.get(vers.trim());
    if (!source || !cible) continue;
    const techno = texte(f.typeDeFlux);
    const corps = [
      `        ${source} -> ${cible} "${texte(libelleInterface(f.interfaceNom, f.version))}" "${techno}" {`,
      `            tags "${[techno, ...(estTire(f) ? [ETIQUETTE_TIRE] : [])].join('" "')}"`,
    ];
    // Le contrat est une adresse : la donner à l'outil, c'est un clic depuis le
    // schéma plutôt qu'une recherche dans le classeur.
    if (f.iface.lienContrat.trim()) corps.push(`            url ${f.iface.lienContrat.trim()}`);
    corps.push(
      ...propriétés("            ", [
        // Ce que l'échange transporte : la description de la relation, au sens
        // C4. Le seul emplacement de texte qu'un lien Structurizr offre est
        // déjà pris par le libellé -- nom et version du flux, comme sur les
        // schémas --, d'où la propriété plutôt que la perte.
        ["Description", f.iface.description],
        ["Usage", f.conso.usage],
        ["Criticality", f.conso.criticite],
        ["Decision", f.conso.decision],
        ["Contract reference", f.iface.referenceContrat],
        // Un flux à confirmer est un flux dont le classeur n'est pas sûr : sans
        // ce drapeau, le fichier produit affirmerait plus que lui.
        ["To confirm", f.iface.aConfirmer ? "Yes" : ""],
        // Deux colonnes de commentaires, deux sujets : le contrat d'un côté,
        // l'usage qu'un consommateur en fait de l'autre. Les fondre en une
        // seule perdrait de qui vient quoi.
        ["Interface comments", f.iface.commentaires],
        ["Consumption comments", f.conso.commentaires],
        ["Introduced at", f.conso.palierIntroduction],
        ["Retired at", f.conso.palierRetrait],
      ])
    );
    corps.push("        }");
    liens.add(corps.join("\n"));
  }
  lignes.push(...[...liens].sort((a, b) => a.localeCompare(b, "fr")));

  lignes.push("    }", "", "    views {", ...vues(model, acteurs, ids, flux), "", "        styles {");
  lignes.push('            element "External" {', "                background #999999", "            }");
  // Chaque technologie garde la couleur qu'elle a dans l'outil : deux lectures
  // du même parc, sur deux outils, ne doivent pas changer de code couleur.
  const couleurs = couleursDuModele(model);
  for (const techno of [...new Set(flux.map((f) => f.typeDeFlux.trim()))].sort((a, b) => a.localeCompare(b, "fr"))) {
    lignes.push(`            relationship "${texte(techno)}" {`, `                color ${couleurs.get(techno) ?? "#000000"}`, "            }");
  }
  lignes.push("        }", "    }", "}", "");

  return lignes.join("\n");
}

// Une vue par schéma que l'outil sait dessiner. Deux d'entre eux n'ont pas
// d'équivalent : « groupe à groupe » et « plateforme détaillée » AGRÈGENT des
// acteurs en une boîte, ce qu'aucun des deux DSL ne sait exprimer. La vue
// d'ensemble porte la même matière, groupes compris -- Structurizr les dessine
// en frontières.
function vues(
  model: ParsedModel,
  acteurs: Acteur[],
  ids: Map<string, string>,
  flux: FlowInstance[]
): string[] {
  const vue = (entête: string, inclusion: string) => [
    `        ${entête} {`,
    `            include ${inclusion}`,
    "            autolayout lr",
    "        }",
  ];

  const lignes = [...vue('systemLandscape "landscape"', "*")];

  // Le même prédicat que les schémas : comparé en strict ici, un groupe saisi
  // « platform » était une plateforme à l'écran et n'en était plus une dans le
  // fichier C4, où la vue dédiée disparaissait sans un mot.
  if (model.groupes.some((g) => groupeEstPlateforme(model, g.nom))) {
    lignes.push(...vue('systemLandscape "platform-only"', '"element.tag==Platform"'));
  }

  const technos = [...new Set(flux.map((f) => f.typeDeFlux.trim()))].sort((a, b) => a.localeCompare(b, "fr"));
  const clés = identifiants(technos);
  for (const techno of technos) {
    lignes.push(
      ...vue(`systemLandscape "tech-${clés.get(techno)!.replace(/_/g, "-")}"`, `"relationship.tag==${texte(techno)}"`)
    );
  }

  // Un acteur qu'aucun flux ne touche n'a pas de schéma dans l'outil : sa vue
  // de contexte ne montrerait que sa propre boîte.
  //
  // Une personne n'en a pas non plus : `systemContext` porte sur un système, et
  // Structurizr refuse le fichier entier si on lui en demande une sur un
  // humain. Le prix du mot juste (`person`) est cette vue en moins.
  const touchés = new Set(flux.flatMap((f) => [f.exposant.trim(), f.consommateur.trim()]));
  for (const a of acteurs.filter((x) => touchés.has(x.nom.trim()) && !estUnePersonne(x))) {
    const id = ids.get(a.nom.trim())!;
    lignes.push(...vue(`systemContext ${id} "actor-${id.replace(/_/g, "-")}"`, "*"));
  }

  return lignes;
}

function périmètre(model: ParsedModel, groupe: string): string {
  return model.groupes.find((g) => g.nom.trim() === groupe.trim())?.perimetre ?? "";
}

// Le classeur nomme ses types d'acteur librement ; on ne reconnaît que celui
// que C4 sait rendre autrement, dans les deux langues qu'un classeur peut
// porter. Tout le reste est un système.
function estUnePersonne(a: Acteur): boolean {
  return ["person", "humain"].includes(normalizeText(a.typeActeur));
}

// Un bloc `properties` ne se pose que s'il a quelque chose à dire : un bloc
// vide passerait la validation mais encombrerait chaque élément.
function propriétés(indent: string, paires: [string, string][]): string[] {
  const remplies = paires.filter(([, v]) => v.trim() !== "");
  if (remplies.length === 0) return [];
  return [
    `${indent}properties {`,
    ...remplies.map(([clé, v]) => `${indent}    "${clé}" "${texte(v)}"`),
    `${indent}}`,
  ];
}
