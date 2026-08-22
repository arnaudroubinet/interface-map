import type { Actor, ParsedModel, InterfaceCatalogue, Consumption } from "../parsing/model";
import {
  buildFlowInstances,
  interfaceLabel,
  buildInterfaceLookup,
  findInterfaceForConsommation,
  type FlowInstance,
  type InterfaceLookup,
  type Mode,
} from "./core";
import { normalizeText } from "../shared/text";
import { isTechnicalActor } from "./nature";
import { lifespanOf, isLiveAt } from "./milestones";

// La lecture fonctionnelle du parc : qui alimente qui, la plomberie retirée.
//
// Elle se DÉRIVE de l'architecture plutôt que de se saisir à part -- c'est ce
// qui garantit que les deux lectures ne divergeront jamais. Le résultat a la
// forme des flux techniques, la technologie en moins, de sorte que les vues
// existantes tournent dessus sans savoir qu'elles ont changé de mode.

export interface ChaineCoupee {
  iface: InterfaceCatalogue;
  // « sans-entree » : cette interface republiée n'est alimentée par aucune
  // consommation. La chaîne s'arrête donc là, et le lien fonctionnel qu'on en
  // attendait n'existe pas -- il vaut mieux le dire que le taire.
  reason: "no-input" | "loop";
}

// Un acteur inconnu du classeur n'est pas jugé ici : les contrôles de
// référence s'en chargent sur le classeur entier.
function actorIsLive(
  model: ParsedModel,
  name: string,
  rank: number | null,
): boolean {
  if (rank === null) return true;
  const a = model.actors.find((x) => x.name.trim() === name.trim());
  return a === undefined || isLiveAt(lifespanOf(model, a), rank);
}

// Remonte les segments tant que l'exposant est technique. Rend l'interface
// source quand elle est exposée par un acteur métier, sinon la raison de
// l'échec -- le rapport d'intégrité en a besoin pour dire OÙ la chaîne casse.
// `rang` filtre au même titre que buildFlowInstances : un segment amont retiré
// à ce palier coupe la chaîne, `null` ne filtre rien.
// Ce qu'une remontée rend : les sources métier atteintes, et les branches qui
// n'ont mené nulle part. Les deux à la fois, car une branche fautive ne doit
// pas emporter les branches saines -- perdre tout le lien pour une ligne mal
// saisie serait pire que la ligne mal saisie.
interface Remontee {
  sources: InterfaceCatalogue[];
  // Le TRAJET vers chaque source, maillon par maillon, de la source vers l'aval.
  // La traversée le reconstruisait déjà segment par segment et le jetait pour
  // n'en garder que les extrémités : c'est l'information la plus difficile à
  // obtenir du classeur, et la seule qui réponde à « par où passe ce flux ? ».
  paths: Map<InterfaceCatalogue, Hop[]>;
  cuts: ChaineCoupee[];
}

// Les entrées d'une interface republiée : les consommations de l'acteur qui
// l'expose et qui la désignent.
//
// C'est le sens de lecture qui compte ici. L'information vit sur la LIGNE DE
// CONSOMMATION, pas sur la ligne d'interface : c'est cette ligne-là qui sait de
// quel fournisseur et de quelle version vient l'entrée, et c'est elle qu'une
// liste déroulante ordinaire peut guider. Un bus qui agrège n'a rien de
// spécial à écrire -- il a simplement plusieurs lignes qui désignent la même
// interface.
// Un segment de chaîne : ce qui circule sur UN maillon, sous le nom et la
// technologie qu'il porte à cet endroit-là. C'est précisément ce que la lecture
// fonctionnelle efface -- et ce qu'on cherche quand on demande « par où passe
// ce flux ? ».
export interface Hop {
  provider: string;
  consumer: string;
  interfaceName: string;
  version: string;
  technology: string;
  attenuated: boolean;
}

function hop(iface: InterfaceCatalogue, conso: Consumption): Hop {
  return {
    provider: iface.providerName.trim(),
    consumer: conso.consumerName.trim(),
    interfaceName: iface.flowName,
    version: iface.version,
    technology: iface.flowType,
    attenuated: normalizeText(conso.decision) === normalizeText("Transform"),
  };
}

function entreesDe(
  model: ParsedModel,
  lookup: InterfaceLookup,
  republished: InterfaceCatalogue,
  rank: number | null
): { iface: InterfaceCatalogue; conso: Consumption }[] {
  const live = (v: { introducedAt: string; retiredAt: string }) =>
    rank === null || isLiveAt(lifespanOf(model, v), rank);
  const relay = republished.providerName.trim();
  // Le nom seul et le nom versionné sont acceptés : la liste déroulante propose
  // le second, une saisie plus ancienne peut porter le premier.
  const designated = new Set([
    normalizeText(republished.flowName),
    normalizeText(interfaceLabel(republished.flowName, republished.version)),
  ]);

  const inputs: { iface: InterfaceCatalogue; conso: Consumption }[] = [];
  for (const c of model.consumptions) {
    if (c.consumerName.trim() !== relay) continue;
    if (!designated.has(normalizeText(c.republishedAs))) continue;
    if (!live(c)) continue;
    const upstream = findInterfaceForConsommation(lookup, c);
    if (!upstream || !live(upstream) || !actorIsLive(model, upstream.providerName, rank)) continue;
    if (!inputs.some((e) => e.iface === upstream)) inputs.push({ iface: upstream, conso: c });
  }
  return inputs;
}

// Remonte les segments tant que l'exposant est technique, en suivant TOUTES les
// entrées de l'interface republiée. `chemin` porte le trajet parcouru et non
// tout ce qu'on a croisé : deux branches qui convergent sur la même source ne
// sont pas une boucle, elles sont un losange.
function walkUp(
  model: ParsedModel,
  lookup: InterfaceLookup,
  start: InterfaceCatalogue,
  rank: number | null,
  path: ReadonlySet<InterfaceCatalogue> = new Set()
): Remontee {
  if (!isTechnicalActor(model, start.providerName)) {
    return { sources: [start], paths: new Map([[start, []]]), cuts: [] };
  }
  if (path.has(start)) return { sources: [], paths: new Map(), cuts: [{ iface: start, reason: "loop" }] };

  const inputs = entreesDe(model, lookup, start, rank);
  if (inputs.length === 0) {
    return { sources: [], paths: new Map(), cuts: [{ iface: start, reason: "no-input" }] };
  }

  const walked = new Set(path).add(start);
  const sources: InterfaceCatalogue[] = [];
  const paths = new Map<InterfaceCatalogue, Hop[]>();
  const cuts: ChaineCoupee[] = [];
  for (const input of inputs) {
    const remontee = walkUp(model, lookup, input.iface, rank, walked);
    for (const source of remontee.sources) {
      if (!sources.includes(source)) sources.push(source);
      // Le maillon qui vient d'être franchi s'ajoute EN AVAL de ce que la
      // remontée a rapporté : le trajet se lit de la source vers le
      // consommateur, comme le trait.
      if (!paths.has(source)) {
        paths.set(source, [...(remontee.paths.get(source) ?? []), hop(input.iface, input.conso)]);
      }
    }
    cuts.push(...remontee.cuts);
  }
  return { sources, paths, cuts };
}

// La chaîne complète d'un flux fonctionnel : un maillon par segment, chacun
// portant le nom sous lequel l'échange circule À CET ENDROIT et la technologie
// qui l'y porte. Un lien direct est une chaîne d'un seul maillon : ce n'est pas
// un cas particulier.
// `f` est la consommation MÉTIER d'origine -- celle dont l'interface est le
// DERNIER maillon. Un flux fonctionnel ne convient pas : son `iface` a déjà été
// remplacée par la source, et la chaîne se réduirait à un maillon.
export function chainsOfFlow(model: ParsedModel, rank: number | null, f: FlowInstance): Hop[][] {
  const lookup = buildInterfaceLookup(model);
  const walked = walkUp(model, lookup, f.iface, rank);
  return walked.sources
    .filter((source) => source.providerName.trim() !== f.consumer.trim())
    .map((source) => [...(walked.paths.get(source) ?? []), hop(f.iface, f.conso)]);
}

// Les consommations qui comptent : celles d'un acteur MÉTIER. Une consommation
// par un acteur technique n'est pas une extrémité mais un segment, traversé
// depuis l'aval.
export function consommationsMetier(
  model: ParsedModel,
  rank: number | null,
): FlowInstance[] {
  return buildFlowInstances(model, rank).filter(
    (f) => !isTechnicalActor(model, f.consumer),
  );
}

export function buildFunctionalFlows(
  model: ParsedModel,
  rank: number | null,
): FlowInstance[] {
  const lookup = buildInterfaceLookup(model);
  const flows: FlowInstance[] = [];
  for (const f of consommationsMetier(model, rank)) {
    for (const source of walkUp(model, lookup, f.iface, rank).sources) {
      if (source.providerName.trim() === f.consumer.trim()) continue;
      flows.push({
        interfaceName: source.flowName,
        version: source.version,
        // Vidée : sans elle, la clé de fusion des traits ne distingue plus les
        // médias, et la légende des technologies n'a plus rien à montrer.
        flowType: "",
        provider: source.providerName,
        consumer: f.consumer,
        // En architecture le sens est une convention attachée à la technologie ;
        // une chaîne en traverse plusieurs, parfois de sens opposés. La seule
        // règle qui tienne bout à bout : du fournisseur vers le consommateur.
        direction: "provider-to-consumer",
        attenuated: f.attenuated,
        iface: source,
        conso: f.conso,
      });
    }
  }
  return flows;
}

// Le point d'entrée unique des consommateurs de flux. Il vit ici et non dans
// les vues parce que la vue Écarts en a besoin aussi, sans passer par elles.
export function flowsForReading(
  model: ParsedModel,
  rank: number | null,
  mode: Mode,
): FlowInstance[] {
  return mode === "functional"
    ? buildFunctionalFlows(model, rank)
    : buildFlowInstances(model, rank);
}

// Le pendant de fluxDuMode côté acteurs : mêmes deux questions, (rang, mode),
// posées à la même liste. Vivant au rang affiché -- un acteur retiré n'y est
// plus, comme ses flux -- et métier en fonctionnel, comme les nœuds qu'y
// dessinent les vues.
export function actorsForReading(
  model: ParsedModel,
  rank: number | null,
  mode: Mode,
): Actor[] {
  return model.actors.filter(
    (a) =>
      (mode !== "functional" || !isTechnicalActor(model, a.name)) &&
      (rank === null || isLiveAt(lifespanOf(model, a), rank)),
  );
}

// Ce qu'une vue lit pour dessiner : ses flux ET ses acteurs, résolus une
// fois, au même (rang, mode). Une vue qui reçoit une Lecture ne peut plus
// aller chercher elle-même une liste d'acteurs non filtrée -- elle n'a plus
// le modèle pour ça, seulement ce qu'on lui a donné.
export interface Lecture {
  flows: FlowInstance[];
  actors: Actor[];
}

export function reading(
  model: ParsedModel,
  rank: number | null,
  mode: Mode,
): Lecture {
  return {
    flows: flowsForReading(model, rank, mode),
    actors: actorsForReading(model, rank, mode),
  };
}

// La lecture RÉUNIE de tous les paliers. Elle ne sert pas à dessiner : elle
// sert à PLACER. Le placement se fait une fois sur l'union, puis chaque palier
// n'en montre que son sous-ensemble, aux positions déjà connues du lecteur --
// c'est la sémantique des « filtered views » de Structurizr.
//
// Sans elle, trois arêtes de plus suffisaient à déplacer les treize mêmes
// boîtes de 400 px en médiane entre deux paliers, et l'axe du temps ne servait
// qu'à lire un relevé texte. Aucun réglage interactif d'ELK n'y remédie : sur
// une planche à frontière, le mode interactif ne reproduit même pas son propre
// résultat (277 px de médiane sur une entrée identique).
export function lectureUnion(model: ParsedModel, mode: Mode): Lecture {
  if (model.milestones.length === 0) return reading(model, null, mode);
  const flows: FlowInstance[] = [];
  const vus = new Set<string>();
  for (const milestone of model.milestones) {
    for (const f of flowsForReading(model, milestone.rank, mode)) {
      const key = JSON.stringify([f.provider, f.consumer, f.flowType, f.interfaceName, f.version]);
      if (vus.has(key)) continue;
      vus.add(key);
      flows.push(f);
    }
  }
  const actors = model.actors.filter((a) => model.milestones.some((p) => actorsForReading(model, p.rank, mode).includes(a)));
  return { flows, actors };
}

export function chainesCoupees(
  model: ParsedModel,
  rank: number | null,
): ChaineCoupee[] {
  const lookup = buildInterfaceLookup(model);
  const cut: ChaineCoupee[] = [];
  for (const f of consommationsMetier(model, rank)) {
    cut.push(...walkUp(model, lookup, f.iface, rank).cuts);
  }
  return cut;
}
