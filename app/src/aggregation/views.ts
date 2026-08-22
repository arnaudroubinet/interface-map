import type { ParsedModel, Acteur } from "../parsing/model";
import {
  groupFlows,
  aggregateEdges,
  nodesFromEdges,
  groupNodeKey,
  platformDetailNodeKey,
  identityNodeKey,
  libelleInterface,
  acteurEstPlateforme,
  groupeEstExterne,
  nomEstExterne,
  icôneDuTypeActeur,
  type GraphNode,
  type GraphEdge,
  type AggregationOptions,
  type FlowInstance,
  type NodeKeyFn,
  type NodeId,
  type NodeKind,
  type Mode,
} from "./core";
import type { Lecture } from "./fonctionnel";
import { estActeurTechnique } from "./nature";
import { rayon, type Voisinage } from "./impact";
import { ordonner, type ContexteOrdre, type OrdreMatrice } from "./seriation";

// L'opacité d'un nœud selon sa distance au point d'intérêt.
function attenuationDeDistance(saut: number): number | undefined {
  if (saut <= 1) return undefined;
  return saut === 2 ? 0.7 : 0.45;
}

export interface ViewResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

const LONGUEUR_DESCRIPTION_MAX = 60;

function tronquer(texte: string, max: number): string {
  return texte.length > max ? texte.slice(0, max - 1).trimEnd() + "…" : texte;
}

// Style C4 : « Type », description et statut externe sous le nom d'un acteur réel.
function détailsActeur(
  model: ParsedModel,
  nom: string
): { sousTitre?: string; description?: string; externe?: boolean; icone?: string; technique?: boolean } {
  const acteur = model.acteurs.find((a) => a.nom === nom);
  if (!acteur) return {};
  return {
    sousTitre: acteur.typeActeur.trim() || undefined,
    icone: icôneDuTypeActeur(model, acteur.typeActeur),
    description: acteur.description.trim() ? tronquer(acteur.description.trim(), LONGUEUR_DESCRIPTION_MAX) : undefined,
    externe: groupeEstExterne(model, acteur.groupe) || undefined,
    // La nature se décide ICI, où le modèle est connu : le rendu applique une
    // forme, il ne va pas la chercher.
    technique: estActeurTechnique(model, nom) || undefined,
  };
}

// Un nœud « groupe » agrège plusieurs acteurs : pas de type/description
// unique, mais le nombre d'acteurs qu'il représente est une donnée réelle.
// `acteurs` est déjà la lecture au (rang, mode) courant -- ni la plomberie ni
// un acteur retiré n'y figurent, donc pas à re-juger ici.
function détailsGroupe(
  model: ParsedModel,
  groupe: string,
  acteurs: readonly Acteur[]
): { sousTitre?: string; externe?: boolean; agrégat?: number } {
  const membres = acteurs.filter((a) => a.groupe === groupe);
  if (membres.length === 0) return {};
  return {
    sousTitre: `${membres.length} actor${membres.length > 1 ? "s" : ""}`,
    agrégat: membres.length,
    // Le périmètre du groupe, et lui seul : c'est ce qui fait fonctionner le
    // code couleur sur les vues agrégées, où les nœuds ne sont pas des acteurs.
    externe: groupeEstExterne(model, groupe) || undefined,
  };
}

// Frontière de la plateforme, au sens C4 : un conteneur en pointillés autour
// des composants du produit, pour les distinguer d'un coup d'œil des systèmes
// tiers qui les entourent.
const ID_FRONTIERE = "__frontiere__";

// Un acteur métier devenu isolé -- dont les échanges passaient tous par des
// chaînes coupées -- reste affiché, seul (§5.2) : le faire disparaître
// retirerait de l'information sans le dire. `nodeKey` est la même résolution
// que celle qui a construit les arêtes de la vue, pour que l'acteur
// réapparaisse à la même échelle (son groupe, ou lui-même) que le reste.
function nodesIsoles(
  candidats: Acteur[],
  nodeKey: NodeKeyFn,
  présents: ReadonlySet<NodeId>,
  kindFor: (id: NodeId) => NodeKind,
  detailsFor: (id: NodeId) => { sousTitre?: string; description?: string; externe?: boolean }
): GraphNode[] {
  const ids = new Set<NodeId>();
  for (const acteur of candidats) {
    const id = nodeKey(acteur.nom);
    // Sentinel « pas de nœud » (§7.4) : un acteur sans groupe n'a rien à
    // rejoindre dans une vue repliée sur les groupes.
    if (id && !présents.has(id)) ids.add(id);
  }
  return [...ids].map((id) => ({ id, label: id, kind: kindFor(id), ...detailsFor(id) }));
}

export function buildGroupToGroupView(model: ParsedModel, lecture: Lecture, options: AggregationOptions): ViewResult {
  const cle = groupNodeKey(model);
  const edges = aggregateEdges(lecture.flux, cle, options, true);
  const kindFor = () => "groupe" as const;
  const detailsFor = (id: NodeId) => détailsGroupe(model, id, lecture.acteurs);
  const nodes = nodesFromEdges(edges, (id) => id, kindFor, detailsFor);
  const isolés = nodesIsoles(lecture.acteurs, cle, new Set(nodes.map((n) => n.id)), kindFor, detailsFor);
  return { nodes: [...nodes, ...isolés], edges };
}

export function buildPlatformDetailView(model: ParsedModel, lecture: Lecture, options: AggregationOptions): ViewResult {
  const cle = platformDetailNodeKey(model);
  const edges = aggregateEdges(lecture.flux, cle, options, true);
  const plateformeIds = new Set(
    lecture.acteurs.filter((a) => acteurEstPlateforme(model, a)).map((a) => a.nom)
  );
  const kindFor = (id: NodeId) => (plateformeIds.has(id) ? "plateforme" as const : "groupe" as const);
  const detailsFor = (id: NodeId) => (plateformeIds.has(id) ? détailsActeur(model, id) : détailsGroupe(model, id, lecture.acteurs));
  const nodes = nodesFromEdges(edges, (id) => id, kindFor, detailsFor);
  const isolés = nodesIsoles(lecture.acteurs, cle, new Set(nodes.map((n) => n.id)), kindFor, detailsFor);
  const nodesTotal = [...nodes, ...isolés];

  // Les composants de la plateforme entrent dans la frontière ; tout le reste
  // gravite autour. Sans au moins deux composants, un cadre n'apporte rien.
  const dedans = nodesTotal.filter((n) => plateformeIds.has(n.id));
  if (dedans.length < 2) return { nodes: nodesTotal, edges };
  for (const n of dedans) n.parent = ID_FRONTIERE;
  return {
    nodes: [{ id: ID_FRONTIERE, label: "Platform", kind: "frontiere" }, ...nodesTotal],
    edges,
  };
}

// Le produit seul, sans ce qui l'entoure : on ne garde que les flux dont les
// DEUX extrémités sont dans un groupe « Plateforme ». Pas de frontière ici --
// tout ce qui est dessiné est la plateforme, un cadre autour de tout n'apprend
// rien.
export function buildPlatformOnlyView(model: ParsedModel, lecture: Lecture, options: AggregationOptions): ViewResult {
  const acteursPlateforme = lecture.acteurs.filter((a) => acteurEstPlateforme(model, a));
  const interne = (nom: string) => acteursPlateforme.some((a) => a.nom.trim() === nom.trim());
  const flows = lecture.flux.filter((f) => interne(f.exposant) && interne(f.consommateur));
  const edges = aggregateEdges(flows, identityNodeKey, options, true);
  const kindFor = () => "plateforme" as const;
  const detailsFor = (id: NodeId) => détailsActeur(model, id);
  const nodes = nodesFromEdges(edges, (id) => id, kindFor, detailsFor);
  const isolés = nodesIsoles(acteursPlateforme, identityNodeKey, new Set(nodes.map((n) => n.id)), kindFor, detailsFor);
  return { nodes: [...nodes, ...isolés], edges };
}

export interface OptionsVueTechnologie extends AggregationOptions {
  masquerExternes?: boolean;
  acteursMasques?: readonly string[];
}

// Les acteurs décochables pour une technologie donnée. La liste suit
// l'interrupteur « externes » : quand il masque, ses acteurs quittent la liste
// -- et l'interrupteur seul suffit à les faire revenir, donc rien n'est perdu.
export function optionsFiltreTechnologie(
  model: ParsedModel,
  flux: FlowInstance[],
  typeDeFlux: string,
  options: { masquerExternes?: boolean }
): string[] {
  const noms = new Set<string>();
  for (const flow of fluxDeLaTechnologie(flux, typeDeFlux)) {
    for (const nom of [flow.exposant, flow.consommateur]) {
      if (options.masquerExternes && nomEstExterne(model, nom)) continue;
      noms.add(nom);
    }
  }
  return [...noms].sort((a, b) => a.localeCompare(b, "fr"));
}

function fluxDeLaTechnologie(flux: FlowInstance[], typeDeFlux: string) {
  return flux.filter((f) => f.typeDeFlux.trim() === typeDeFlux.trim());
}

export function buildByTechnologyView(
  model: ParsedModel,
  flux: FlowInstance[],
  typeDeFlux: string,
  options: OptionsVueTechnologie
): ViewResult {
  const masqués = new Set(options.acteursMasques ?? []);
  // Un flux tombe dès qu'UNE de ses deux extrémités est masquée : un trait vers
  // une boîte absente ne veut rien dire.
  const caché = (nom: string) => masqués.has(nom) || (options.masquerExternes === true && nomEstExterne(model, nom));
  const flows = fluxDeLaTechnologie(flux, typeDeFlux).filter(
    (f) => !caché(f.exposant) && !caché(f.consommateur)
  );
  const edges = aggregateEdges(flows, identityNodeKey, options, true);
  const nodes = nodesFromEdges(edges, (id) => id, () => "acteur", (id) => détailsActeur(model, id));
  return { nodes, edges };
}

// Ce qu'on peut décocher dans la vue par acteur : la liste COMPLÈTE, calculée
// avant tout filtrage. Sinon, masquer une technologie ferait disparaître sa
// propre case à cocher et il n'y aurait plus moyen de la rétablir.
export interface FiltresActeur {
  technologies: string[];
  acteurs: string[];
}

export function optionsFiltreActeur(flux: FlowInstance[], acteurNom: string): FiltresActeur {
  const technologies = new Set<string>();
  const acteurs = new Set<string>();
  for (const flow of fluxDeLActeur(flux, acteurNom)) {
    // Une technologie vide n'en est pas une : en mode fonctionnel, toutes les
    // arêtes la portent vide (§5.2), et la proposer donnerait une case à
    // cocher sans étiquette qui vide tout le schéma en un clic muet.
    if (flow.typeDeFlux.trim() !== "") technologies.add(flow.typeDeFlux);
    const autre = flow.exposant.trim() === acteurNom.trim() ? flow.consommateur : flow.exposant;
    if (autre.trim() !== acteurNom.trim()) acteurs.add(autre);
  }
  const parNom = (a: string, b: string) => a.localeCompare(b, "fr");
  return { technologies: [...technologies].sort(parNom), acteurs: [...acteurs].sort(parNom) };
}

function fluxDeLActeur(flux: FlowInstance[], acteurNom: string) {
  return flux.filter(
    (f) => f.exposant.trim() === acteurNom.trim() || f.consommateur.trim() === acteurNom.trim()
  );
}

export interface OptionsVueActeur {
  technosMasquees?: readonly string[];
  acteursMasques?: readonly string[];
  // Jusqu'où porte le regard : les voisins immédiats, ce dont l'acteur dépend,
  // ou ce qui dépend de lui -- c'est-à-dire ce que sa chute toucherait.
  voisinage?: Voisinage;
}

export function buildByActorView(model: ParsedModel, flux: FlowInstance[], acteurNom: string, options: OptionsVueActeur): ViewResult {
  const voisinage = options.voisinage ?? "direct";
  const distances = rayon(flux, acteurNom, voisinage);
  // En direct, le comportement historique : les flux qui TOUCHENT l'acteur.
  // Au-delà, tout flux dont les deux bouts sont dans le rayon -- sinon la
  // planche montrerait des boîtes sans les liens qui les y ont amenées.
  const flows =
    voisinage === "direct"
      ? fluxDeLActeur(flux, acteurNom)
      : flux.filter((f) => distances.has(f.exposant.trim()) && distances.has(f.consommateur.trim()));
  const technosMasquees = new Set(options.technosMasquees ?? []);
  const acteursMasques = new Set(options.acteursMasques ?? []);

  const edges: GraphEdge[] = [];
  const nodeIds = new Set<string>([acteurNom]);

  for (const flow of flows) {
    // Masquer une technologie retire ses flux, donc les acteurs qui n'étaient
    // reliés que par elle ; masquer un acteur retire les flux qui y menaient.
    // Les deux sens tombent de la même règle : les nœuds suivent les arêtes.
    if (technosMasquees.has(flow.typeDeFlux)) continue;
    const autre = flow.exposant.trim() === acteurNom.trim() ? flow.consommateur : flow.exposant;
    if (acteursMasques.has(autre)) continue;
    // La même règle que partout ailleurs : le trait suit la DONNÉE, du
    // fournisseur vers le consommateur, et la pointe dit qui appelle. Cette vue
    // construit ses arêtes elle-même plutôt que par groupFlows, et elle avait
    // gardé l'ancienne convention : elle inversait le trait sur un flux tiré.
    // Un même fichier draw.io racontait donc deux architectures selon l'onglet.
    //
    // Cette vue nomme DÉJÀ l'échange plutôt que le tuyau : un trait y porte un
    // seul flux, donc la technologie n'a rien à agréger et se lit en
    // sous-ligne. Le réglage « Label » ne la concerne pas.
    const from = flow.exposant;
    const to = flow.consommateur;
    nodeIds.add(from);
    nodeIds.add(to);
    edges.push({
      from,
      to,
      technologie: flow.typeDeFlux,
      count: 1,
      criticite: flow.conso.criticite.trim() || undefined,
      tire: flow.sens === "consommateur-exposant",
      label: libelleInterface(flow.interfaceNom, flow.version),
      atténué: flow.atténué,
    });
  }

  const nodes: GraphNode[] = [...nodeIds].map((id) => ({
    id,
    label: id,
    kind: id === acteurNom ? "acteur-selectionne" : "acteur",
    ...détailsActeur(model, id),
    // Atténué selon la distance : un saut à plein, deux à 70 %, au-delà à
    // 45 %. C'est le degree-of-interest -- ce qui est loin reste visible mais
    // cesse de disputer l'attention au point de départ.
    ...(voisinage === "direct" ? {} : { attenuation: attenuationDeDistance(distances.get(id) ?? 0) }),
  }));

  return { nodes, edges };
}

export interface MatrixCell {
  technologie: string;
  count: number;
  atténué: boolean;
  noms: string[];
}

export interface MatrixRow {
  acteur: string;
  cellules: Map<string, MatrixCell[]>;
}

// Les deux axes sont jugés chacun de son côté : une ligne par émetteur réel,
// une colonne par destinataire réel. Ce qui n'émet rien n'a pas de ligne, ce
// qui ne reçoit rien n'a pas de colonne -- une bande entièrement vide occupe
// de la place sans rien apprendre. Le tableau qui sort d'ici est définitif :
// ni l'affichage ni l'export ne le retaillent.
export interface MatrixResult {
  colonnes: string[];
  lignes: MatrixRow[];
  // Les marges du tableau : degré sortant par ligne, entrant par colonne. Une
  // matrice sans totaux oblige à compter des cases à l'œil pour savoir qui est
  // le moyeu.
  totauxLigne: Map<string, number>;
  totauxColonne: Map<string, number>;
}

// La matrice se lit aux mêmes trois échelles que les vues graphiques : acteur
// par acteur, tout replié sur les groupes, ou les composants de la plateforme
// détaillés face aux groupes qui les entourent.
export type GranulariteMatrice = "acteur" | "groupe" | "plateforme";

export interface OptionsVueMatrice {
  mode: Mode;
  granularite?: GranulariteMatrice;
  ordre?: OrdreMatrice;
  masquerExternes?: boolean;
  acteursMasques?: readonly string[];
}

// À chaque granularité son repli et sa lecture du périmètre : un id de ligne
// est un nom d'acteur en « acteur », un nom de groupe en « groupe », et l'un ou
// l'autre en « plateforme ».
function replisMatrice(
  model: ParsedModel,
  granularite: GranulariteMatrice
): { cle: NodeKeyFn; externe: (id: string) => boolean } {
  if (granularite === "groupe") {
    return { cle: groupNodeKey(model), externe: (id) => groupeEstExterne(model, id) };
  }
  if (granularite === "plateforme") {
    const plateforme = new Set(
      model.acteurs.filter((a) => acteurEstPlateforme(model, a)).map((a) => a.nom.trim())
    );
    return {
      cle: platformDetailNodeKey(model),
      externe: (id) => !plateforme.has(id) && groupeEstExterne(model, id),
    };
  }
  return { cle: identityNodeKey, externe: (id) => nomEstExterne(model, id) };
}

// Les lignes décochables de la matrice : tout ce qui porte au moins un flux à
// la granularité courante, sous réserve de l'interrupteur « externes ».
export function optionsFiltreMatrice(
  model: ParsedModel,
  flux: FlowInstance[],
  options: { granularite?: GranulariteMatrice; masquerExternes?: boolean }
): string[] {
  const { cle, externe } = replisMatrice(model, options.granularite ?? "acteur");
  const ids = new Set<string>();
  for (const flow of flux) {
    for (const nom of [flow.exposant, flow.consommateur]) {
      const id = cle(nom);
      // Sentinel « pas de nœud » : un acteur sans groupe est absent des vues
      // repliées, il n'a donc pas de case à cocher.
      if (!id) continue;
      if (options.masquerExternes && externe(id)) continue;
      ids.add(id);
    }
  }
  return [...ids].sort((a, b) => a.localeCompare(b, "fr"));
}

export function buildMatrixView(model: ParsedModel, lecture: Lecture, options: OptionsVueMatrice): MatrixResult {
  const { cle, externe } = replisMatrice(model, options.granularite ?? "acteur");
  const masqués = new Set(options.acteursMasques ?? []);
  const caché = (id: string) => masqués.has(id) || (options.masquerExternes === true && externe(id));
  // Un lien tombe dès qu'une de ses deux extrémités est masquée : une ligne ou
  // une colonne vers un acteur absent ne veut rien dire. Le masquage porte sur
  // l'id replié, donc décocher un groupe emporte tous ses acteurs.
  const flows = lecture.flux.filter((f) => !caché(cle(f.exposant)) && !caché(cle(f.consommateur)));
  const groups = groupFlows(flows, cle, false);

  const parNom = (a: string, b: string) => a.localeCompare(b, "fr");

  const lignesMap = new Map<string, MatrixRow>();
  for (const g of groups) {
    let ligne = lignesMap.get(g.from);
    if (!ligne) {
      ligne = { acteur: g.from, cellules: new Map() };
      lignesMap.set(g.from, ligne);
    }
    const cell: MatrixCell = { technologie: g.technologie, count: g.count, atténué: g.atténué, noms: g.noms };
    const existing = ligne.cellules.get(g.to);
    if (existing) existing.push(cell);
    else ligne.cellules.set(g.to, [cell]);
  }

  // Un acteur métier devenu isolé (§5.2) garde sa ligne, vide plutôt
  // qu'absente : disparaître de la matrice retirerait de l'information sans
  // le dire, comme dans les vues graphiques.
  if (options.mode === "fonctionnel") {
    for (const acteur of lecture.acteurs) {
      const id = cle(acteur.nom);
      if (!id || lignesMap.has(id) || caché(id)) continue;
      lignesMap.set(id, { acteur: id, cellules: new Map() });
    }
  }

  // L'ordre se décide ICI, une fois, et l'affichage comme l'export le suivent :
  // « ce qui est à l'écran est ce qui s'exporte ».
  const voisinage = new Map<string, Set<string>>();
  const ajouterVoisin = (a: string, b: string) => {
    const v = voisinage.get(a) ?? new Set<string>();
    v.add(b);
    voisinage.set(a, v);
  };
  for (const g of groups) {
    ajouterVoisin(g.from, g.to);
    ajouterVoisin(g.to, g.from);
  }
  const ctxOrdre: ContexteOrdre = {
    groupeDe: (id) => model.acteurs.find((a) => a.nom.trim() === id)?.groupe.trim() ?? id,
    degre: (id) => voisinage.get(id)?.size ?? 0,
    voisins: (id) => [...(voisinage.get(id) ?? [])],
  };
  const ordre = options.ordre ?? "alphabetique";
  const colonnes = ordonner([...new Set(groups.map((g) => g.to))], ordre, ctxOrdre);

  const lignes = ordonner([...lignesMap.keys()], ordre, ctxOrdre).map((id) => lignesMap.get(id)!);
  for (const ligne of lignes) {
    for (const cellules of ligne.cellules.values()) {
      cellules.sort((a, b) => parNom(a.technologie, b.technologie));
    }
  }

  // Les marges : combien de flux partent de chaque ligne, combien arrivent sur
  // chaque colonne. C'est ce qui NOMME le moyeu sans compter les cases à l'œil.
  const totauxLigne = new Map(lignes.map((l) => [l.acteur, [...l.cellules.values()].flat().reduce((n, c) => n + c.count, 0)]));
  const totauxColonne = new Map(
    colonnes.map((c) => [c, lignes.reduce((n, l) => n + (l.cellules.get(c) ?? []).reduce((m, x) => m + x.count, 0), 0)])
  );

  return { colonnes, lignes, totauxLigne, totauxColonne };
}
