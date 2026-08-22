import type { Acteur, ParsedModel, InterfaceCatalogue } from "../parsing/model";
import {
  buildFlowInstances,
  libelleInterface,
  buildInterfaceLookup,
  findInterfaceForConsommation,
  type FlowInstance,
  type InterfaceLookup,
  type Mode,
} from "./core";
import { normalizeText } from "../shared/text";
import { estActeurTechnique } from "./nature";
import { intervalleDeVie, estVivant } from "./paliers";

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
  raison: "sans-entree" | "boucle";
}

// Un acteur inconnu du classeur n'est pas jugé ici : les contrôles de
// référence s'en chargent sur le classeur entier.
function acteurVivant(
  model: ParsedModel,
  nom: string,
  rang: number | null,
): boolean {
  if (rang === null) return true;
  const a = model.acteurs.find((x) => x.nom.trim() === nom.trim());
  return a === undefined || estVivant(intervalleDeVie(model, a), rang);
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
  coupures: ChaineCoupee[];
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
function entreesDe(
  model: ParsedModel,
  lookup: InterfaceLookup,
  republiee: InterfaceCatalogue,
  rang: number | null
): InterfaceCatalogue[] {
  const vivant = (v: { palierIntroduction: string; palierRetrait: string }) =>
    rang === null || estVivant(intervalleDeVie(model, v), rang);
  const relayeur = republiee.acteurExposant.trim();
  // Le nom seul et le nom versionné sont acceptés : la liste déroulante propose
  // le second, une saisie plus ancienne peut porter le premier.
  const désigné = new Set([
    normalizeText(republiee.nomDuFlux),
    normalizeText(libelleInterface(republiee.nomDuFlux, republiee.version)),
  ]);

  const entrées: InterfaceCatalogue[] = [];
  for (const c of model.consommations) {
    if (c.acteurConsommateur.trim() !== relayeur) continue;
    if (!désigné.has(normalizeText(c.republiePar))) continue;
    if (!vivant(c)) continue;
    const amont = findInterfaceForConsommation(lookup, c);
    if (!amont || !vivant(amont) || !acteurVivant(model, amont.acteurExposant, rang)) continue;
    if (!entrées.includes(amont)) entrées.push(amont);
  }
  return entrées;
}

// Remonte les segments tant que l'exposant est technique, en suivant TOUTES les
// entrées de l'interface republiée. `chemin` porte le trajet parcouru et non
// tout ce qu'on a croisé : deux branches qui convergent sur la même source ne
// sont pas une boucle, elles sont un losange.
function remonter(
  model: ParsedModel,
  lookup: InterfaceLookup,
  départ: InterfaceCatalogue,
  rang: number | null,
  chemin: ReadonlySet<InterfaceCatalogue> = new Set()
): Remontee {
  if (!estActeurTechnique(model, départ.acteurExposant)) return { sources: [départ], coupures: [] };
  if (chemin.has(départ)) return { sources: [], coupures: [{ iface: départ, raison: "boucle" }] };

  const entrées = entreesDe(model, lookup, départ, rang);
  if (entrées.length === 0) return { sources: [], coupures: [{ iface: départ, raison: "sans-entree" }] };

  const parcouru = new Set(chemin).add(départ);
  const sources: InterfaceCatalogue[] = [];
  const coupures: ChaineCoupee[] = [];
  for (const entrée of entrées) {
    const remontée = remonter(model, lookup, entrée, rang, parcouru);
    for (const source of remontée.sources) if (!sources.includes(source)) sources.push(source);
    coupures.push(...remontée.coupures);
  }
  return { sources, coupures };
}

// Les consommations qui comptent : celles d'un acteur MÉTIER. Une consommation
// par un acteur technique n'est pas une extrémité mais un segment, traversé
// depuis l'aval.
function consommationsMetier(
  model: ParsedModel,
  rang: number | null,
): FlowInstance[] {
  return buildFlowInstances(model, rang).filter(
    (f) => !estActeurTechnique(model, f.consommateur),
  );
}

export function buildFunctionalFlows(
  model: ParsedModel,
  rang: number | null,
): FlowInstance[] {
  const lookup = buildInterfaceLookup(model);
  const flux: FlowInstance[] = [];
  for (const f of consommationsMetier(model, rang)) {
    for (const source of remonter(model, lookup, f.iface, rang).sources) {
      if (source.acteurExposant.trim() === f.consommateur.trim()) continue;
      flux.push({
        interfaceNom: source.nomDuFlux,
        version: source.version,
        // Vidée : sans elle, la clé de fusion des traits ne distingue plus les
        // médias, et la légende des technologies n'a plus rien à montrer.
        typeDeFlux: "",
        exposant: source.acteurExposant,
        consommateur: f.consommateur,
        // En architecture le sens est une convention attachée à la technologie ;
        // une chaîne en traverse plusieurs, parfois de sens opposés. La seule
        // règle qui tienne bout à bout : du fournisseur vers le consommateur.
        sens: "exposant-consommateur",
        atténué: f.atténué,
        iface: source,
        conso: f.conso,
      });
    }
  }
  return flux;
}

// Le point d'entrée unique des consommateurs de flux. Il vit ici et non dans
// les vues parce que la vue Écarts en a besoin aussi, sans passer par elles.
export function fluxDuMode(
  model: ParsedModel,
  rang: number | null,
  mode: Mode,
): FlowInstance[] {
  return mode === "fonctionnel"
    ? buildFunctionalFlows(model, rang)
    : buildFlowInstances(model, rang);
}

// Le pendant de fluxDuMode côté acteurs : mêmes deux questions, (rang, mode),
// posées à la même liste. Vivant au rang affiché -- un acteur retiré n'y est
// plus, comme ses flux -- et métier en fonctionnel, comme les nœuds qu'y
// dessinent les vues.
export function acteursDuMode(
  model: ParsedModel,
  rang: number | null,
  mode: Mode,
): Acteur[] {
  return model.acteurs.filter(
    (a) =>
      (mode !== "fonctionnel" || !estActeurTechnique(model, a.nom)) &&
      (rang === null || estVivant(intervalleDeVie(model, a), rang)),
  );
}

// Ce qu'une vue lit pour dessiner : ses flux ET ses acteurs, résolus une
// fois, au même (rang, mode). Une vue qui reçoit une Lecture ne peut plus
// aller chercher elle-même une liste d'acteurs non filtrée -- elle n'a plus
// le modèle pour ça, seulement ce qu'on lui a donné.
export interface Lecture {
  flux: FlowInstance[];
  acteurs: Acteur[];
}

export function lecture(
  model: ParsedModel,
  rang: number | null,
  mode: Mode,
): Lecture {
  return {
    flux: fluxDuMode(model, rang, mode),
    acteurs: acteursDuMode(model, rang, mode),
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
  if (model.paliers.length === 0) return lecture(model, null, mode);
  const flux: FlowInstance[] = [];
  const vus = new Set<string>();
  for (const palier of model.paliers) {
    for (const f of fluxDuMode(model, palier.rang, mode)) {
      const clé = JSON.stringify([f.exposant, f.consommateur, f.typeDeFlux, f.interfaceNom, f.version]);
      if (vus.has(clé)) continue;
      vus.add(clé);
      flux.push(f);
    }
  }
  const acteurs = model.acteurs.filter((a) => model.paliers.some((p) => acteursDuMode(model, p.rang, mode).includes(a)));
  return { flux, acteurs };
}

export function chainesCoupees(
  model: ParsedModel,
  rang: number | null,
): ChaineCoupee[] {
  const lookup = buildInterfaceLookup(model);
  const coupées: ChaineCoupee[] = [];
  for (const f of consommationsMetier(model, rang)) {
    coupées.push(...remonter(model, lookup, f.iface, rang).coupures);
  }
  return coupées;
}
