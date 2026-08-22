import { ICONES_DISPONIBLES } from "../render/icons";

// Le même format que celui qu'accepte la palette (render/colors.ts).
const COULEUR_HEXA = /^#?[0-9a-f]{6}$/i;
import type {
  Actor,
  Consommation,
  Emplacement,
  Groupe,
  InterfaceCatalogue,
  Milestone,
  ParsedModel,
  TypeActeur,
  TypeFlux,
  ValiditePalier,
} from "../parsing/model";
import {
  buildInterfaceLookup,
  findInterfaceForConsommation,
  interfaceKey,
  interfaceLabel,
  nomKey,
  nomVersionKey,
  type InterfaceLookup,
} from "../aggregation/core";
import { lifespanOf, isLiveAt, seRencontrent, TOUJOURS, type Intervalle } from "../aggregation/milestones";
import { HEXA, SEUIL_TRAIT } from "../render/colors";
import { ratioDeContraste } from "../render/contrast";
import { LONGUEUR_MAX_ONGLET } from "../parsing/build-model";
import { isTechnicalActor } from "../aggregation/nature";
import {
  VOCABULAIRE_DIRECTION,
  VOCABULAIRE_DECISION,
  VOCABULAIRE_CRITICITE,
  VOCABULAIRE_NATURE,
  VOCABULAIRE_PERIMETRE,
} from "../aggregation/vocabularies";
import { chainesCoupees } from "../aggregation/reading";
import { normalizeText } from "../shared/text";

export interface Anomaly {
  message: string;
  // Où aller corriger. Absent quand l'anomalie ne vise aucune ligne : un
  // onglet manquant, un classeur sans palier livré. Ces anomalies-là passent
  // en tête du rapport, elles concernent le fichier et non une saisie.
  emplacement?: Emplacement;
}

// L'unique fabrique du sujet d'un message : ce dont on parle, puis où le
// retrouver. Tout message qui vise une ligne passe par ici, sinon l'adresse
// s'écrirait de trois façons selon la famille.
function adresse(e: Emplacement): string {
  return `(${e.sheet}, row ${e.row})`;
}

function situé(what: string, name: string, e: Emplacement): string {
  return `${what} "${name}" ${adresse(e)}`;
}

const nommeActeur = (a: Actor) => situé("Actor", a.name, a);
const nommeInterface = (i: InterfaceCatalogue) => situé("Interface", interfaceLabel(i.flowName, i.version), i);
const nommeConso = (c: Consommation) => situé("Consumption", c.flowName, c);
const nommeGroupe = (g: Groupe) => situé("Group", g.name, g);
const nommeTypeActeur = (t: TypeActeur) => situé("Actor type", t.type, t);
const nommeTypeFlux = (t: TypeFlux) => situé("Flow type", t.type, t);
const nommePalier = (p: Milestone) => situé("Milestone", p.name, p);

// Les éléments d'un bloc suivent le même ordre que les anomalies : la feuille,
// puis la ligne. Ils portent leur adresse dans le texte, faute d'avoir, comme
// une anomalie, un champ pour la loger.
function itemsSitués<T extends Emplacement>(rows: T[], text: (l: T) => string): string[] {
  return [...rows]
    .sort((a, b) => a.sheet.localeCompare(b.sheet, "fr") || a.row - b.row)
    .map(text);
}

function anomaly(message: string, e?: Emplacement): Anomaly {
  return e ? { message, emplacement: { sheet: e.sheet, row: e.row } } : { message };
}

// Ce qui n'a pas d'adresse d'abord -- ça vise le fichier entier, donc ça se lit
// avant toute correction de saisie. Le reste suit le classeur : feuille, puis
// ligne croissante, l'ordre dans lequel on le corrigera.
function parEmplacement(anomalies: Anomaly[]): Anomaly[] {
  return [...anomalies].sort((a, b) => {
    if (!a.emplacement || !b.emplacement) return (a.emplacement ? 1 : 0) - (b.emplacement ? 1 : 0);
    return (
      a.emplacement.sheet.localeCompare(b.emplacement.sheet, "fr") ||
      a.emplacement.row - b.emplacement.row
    );
  });
}

export interface AnomalyFamily {
  id: string;
  title: string;
  description: string;
  anomalies: Anomaly[];
}

export interface InfoBlock {
  id: string;
  title: string;
  description: string;
  items: string[];
  // « avertissement » signale une saisie à trancher, pas une faute : ça se
  // compte et se voit, mais ça ne détourne pas l'utilisateur de ses schémas
  // au chargement, contrairement aux anomalies.
  // « action » : le fichier est juste, mais une décision attend quelqu'un.
  // C'est autre chose qu'un avertissement, qui signale une saisie manquante.
  level: "info" | "action" | "warning";
}

export interface IntegrityReport {
  families: AnomalyFamily[];
  infoBlocks: InfoBlock[];
  totalAnomalies: number;
  totalActions: number;
  totalAvertissements: number;
}

function actorByName(model: ParsedModel): Map<string, Actor> {
  const map = new Map<string, Actor>();
  for (const a of model.actors) map.set(a.name.trim(), a);
  return map;
}

// Le rattachement d'une consommation à son interface est défini une seule
// fois, dans aggregation/core : le rapport et le diagramme doivent lire la
// même ligne de la même façon, sinon ils se contredisent sur le même fichier.

// Même résolution que findInterfaceForConsommation (clé exacte, repli par
// nom) : une consommation rangée dans le mauvais onglet reste rattachée à
// l'interface que le diagramme lui associe réellement (aggregation/core.ts),
// pas ignorée ici — sinon §7.3/§7.5 et le schéma se contrediraient sur la
// même ligne mal rangée.
function consommationsForInterface(lookup: InterfaceLookup, model: ParsedModel, iface: InterfaceCatalogue): Consommation[] {
  return model.consumptions.filter((c) => findInterfaceForConsommation(lookup, c) === iface);
}

function bornesCitées(où: string, v: ValiditePalier & Emplacement) {
  return [v.introducedAt, v.retiredAt]
    .filter((value) => value.trim() !== "")
    .map((value) => ({ où, value, emplacement: v as Emplacement }));
}

function duplicates(values: string[]): string[] {
  const counts = new Map<string, number>();
  for (const v of values) {
    const key = v.trim();
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].filter(([, n]) => n > 1).map(([k]) => k);
}

function checkStructure(model: ParsedModel): AnomalyFamily {
  const anomalies: Anomaly[] = [];

  for (const { sheet, column } of model.colonnesOptionnellesAbsentes) {
    anomalies.push({ message: `Column "${column}" missing from sheet "${sheet}".` });
  }

  for (const name of duplicates(model.actors.map((a) => a.name))) {
    // La ligne citée est la seconde : la première est légitime, c'est le doublon
    // qu'on va supprimer.
    const doublon = model.actors.filter((a) => a.name.trim() === name)[1];
    anomalies.push(anomaly(`${nommeActeur(doublon)} is declared more than once in the repository.`, doublon));
  }

  // Sur (exposant, nom, version) et non sur le nom seul. Deux versions d'un même
  // contrat sont deux lignes légitimes, c'est tout l'objet de la colonne ; et
  // deux acteurs peuvent publier un contrat de même nom sans s'être concertés,
  // ce qui fait deux interfaces distinctes -- pas un doublon.
  const identité = (i: InterfaceCatalogue) =>
    `${normalizeText(i.providerName)}\u0000${normalizeText(interfaceLabel(i.flowName, i.version))}`;
  for (const key of duplicates(model.interfaces.map(identité))) {
    const doublon = model.interfaces.filter((i) => identité(i) === key)[1];
    anomalies.push(
      anomaly(`${nommeInterface(doublon)} is published more than once by "${doublon.providerName}".`, doublon)
    );
  }

  // La frise elle-même n'était pas contrôlée. Un rang illisible vaut 0 à la
  // lecture, pour que la ligne ne disparaisse pas en silence -- encore faut-il
  // le dire : sinon la frise part de zéro et le palier courant désigne le
  // mauvais, sans une anomalie pour l'expliquer.
  for (const milestone of model.milestones) {
    if (milestone.rank > 0) continue;
    anomalies.push(anomaly(`Milestone "${milestone.name}" has no usable rank; a milestone is placed by a rank of 1 or more.`, milestone));
  }

  // Deux paliers que seuls la casse ou un accent distinguent se confondent :
  // toute ligne datée résout son rang sur le nom NORMALISÉ et prend donc le
  // premier des deux. Les acteurs et les interfaces avaient ce contrôle, la
  // frise ne l'avait pas.
  for (const name of duplicates(model.milestones.map((p) => normalizeText(p.name)))) {
    const doublon = model.milestones.filter((p) => normalizeText(p.name) === name)[1];
    anomalies.push(
      anomaly(`Milestone "${doublon.name}" repeats an earlier milestone; the timeline cannot tell them apart.`, doublon)
    );
  }

  // Le nom d'onglet est coupé à ce qu'Excel accepte : deux couples (exposant,
  // type de flux) différents peuvent donc tomber sur le même. Les fondre
  // mélangerait les consommations de deux contrats sans un mot -- on le dit, et
  // c'est un nom d'acteur ou de type qu'il faut raccourcir.
  const coupleDeLOnglet = new Map<string, { provider: string; type: string }>();
  for (const i of model.interfaces) {
    const couple = { provider: i.providerName.trim(), type: i.flowType.trim() };
    const déjà = coupleDeLOnglet.get(normalizeText(i.expectedSheet));
    if (!déjà) {
      coupleDeLOnglet.set(normalizeText(i.expectedSheet), couple);
      continue;
    }
    if (déjà.provider === couple.provider && déjà.type === couple.type) continue;
    anomalies.push(
      anomaly(
        `${nommeInterface(i)}: "${couple.provider}" / "${couple.type}" and "${déjà.provider}" / "${déjà.type}" both land on the same sheet "${i.expectedSheet}" once cut to ${LONGUEUR_MAX_ONGLET} characters. Shorten one of the names.`,
        i
      )
    );
  }

  const fxNormalises = new Set(model.fxSheetNames.map((n) => normalizeText(n)));
  for (const iface of model.interfaces) {
    if (!fxNormalises.has(normalizeText(iface.expectedSheet))) {
      anomalies.push(
        anomaly(`${nommeInterface(iface)}: sheet "${iface.expectedSheet}" missing from the workbook.`, iface)
      );
    }
  }

  const attendus = new Set(model.interfaces.map((i) => normalizeText(i.expectedSheet)));
  for (const sheet of model.fxSheetNames) {
    if (!attendus.has(normalizeText(sheet))) {
      anomalies.push(anomaly(`Sheet "${sheet}" is present but no interface points to it.`));
    }
  }

  // Le périmètre est une propriété du groupe. Sans cet onglet, on le déduit des
  // acteurs -- un groupe mixte devient alors « Plateforme » dès qu'un seul de
  // ses membres l'est, ce qui fausse couleurs et décomptes.
  if (model.typesActeur.length === 0) {
    anomalies.push({
      message: 'Sheet "ActorTypes" missing or empty, so every actor wears the neutral icon. Add an "ActorTypes" sheet with the columns "Actor type" and "Icon".',
    });
  }

  // Le périmètre est une propriété du groupe, et il ne se devine pas : sans cet
  // onglet, aucun acteur n'est situé dedans ou dehors, et les schémas cessent
  // de distinguer la plateforme de ce qui l'entoure.
  if (model.groupesAbsents) {
    anomalies.push({
      message:
        'Sheet "Groups" missing, so no perimeter is known and the diagrams no longer tell the platform from its surroundings. Add a "Groups" sheet with the columns "Group" and "Perimeter".',
    });
  }

  // L'onglet Paliers ne se contrôle que s'il existe : un classeur qui ne date
  // rien ne doit pas se mettre à parler de paliers.
  if (model.milestones.length > 0) {
    for (const rank of duplicates(model.milestones.map((p) => String(p.rank)))) {
      const names = model.milestones.filter((p) => String(p.rank) === rank).map((p) => p.name);
      anomalies.push(anomaly(`Milestones "${names.join('", "')}" share rank ${rank}, so their order is ambiguous.`));
    }
    if (!model.milestones.some((p) => normalizeText(p.statut) === normalizeText("Delivered"))) {
      anomalies.push({
        message: 'No milestone is marked "Delivered", so the current one is undetermined; the views fall back on the first declared.',
      });
    }
  }

  return { id: "structure", title: "Structure", description: "The file does not read as expected.", anomalies: parEmplacement(anomalies) };
}

function checkReferences(model: ParsedModel): AnomalyFamily {
  const anomalies: Anomaly[] = [];
  const actors = actorByName(model);
  const flowTypes = new Set(model.flowTypes.map((t) => t.type.trim()));
  const lookup = buildInterfaceLookup(model);

  for (const iface of model.interfaces) {
    if (!actors.has(iface.providerName.trim())) {
      anomalies.push(anomaly(`${nommeInterface(iface)}: provider "${iface.providerName}" unknown to the repository.`, iface));
    }
    if (!flowTypes.has(iface.flowType.trim())) {
      // La conséquence, et pas seulement la faute : sans type déclaré, le sens
      // de la flèche est indéterminable, donc l'interface et TOUTES ses
      // consommations sortent des schémas. Dit sans cela, l'énoncé passait pour
      // un rappel de vocabulaire -- sur un classeur réel, 24 interfaces sur 59
      // manquaient à tous les dessins pour cette seule raison.
      anomalies.push(
        anomaly(
          `${nommeInterface(iface)}: flow type "${iface.flowType}" unknown to the repository, so this interface and its consumptions are not drawn.`,
          iface
        )
      );
    }
  }

  for (const c of model.consumptions) {
    if (!actors.has(c.consumerName.trim())) {
      anomalies.push(anomaly(`${nommeConso(c)}: consumer "${c.consumerName}" unknown to the repository.`, c));
    }
    const parNom = lookup.byNom.get(nomKey(c.flowName));
    if (!parNom) {
      anomalies.push(anomaly(`${nommeConso(c)}: flow name missing from the Interfaces catalogue.`, c));
      continue;
    }
    // Le nom existe, la version non : on ne rattache pas au hasard, on le dit.
    const iface = lookup.byNomVersion.get(nomVersionKey(c.flowName, c.version));
    if (!iface) {
      anomalies.push(anomaly(`${nommeConso(c)}: version "${c.version}" missing from the catalogue for this flow.`, c));
      continue;
    }
    const exact = lookup.byKey.get(interfaceKey(c.sheet, c.flowName, c.version));
    if (!exact) {
      anomalies.push(anomaly(`${nommeConso(c)}: filed under "${c.sheet}" instead of "${iface.expectedSheet}".`, c));
    }
  }

  // Un palier cité mais absent de l'onglet Paliers date une ligne d'un jalon
  // qui n'existe pas : la ligne serait lue comme « depuis toujours », ce qui
  // n'est pas ce que la saisie voulait dire.
  const declaredMilestones = new Set(model.milestones.map((p) => normalizeText(p.name)));
  const citations = [
    ...model.actors.flatMap((a) => bornesCitées(nommeActeur(a), a)),
    ...model.interfaces.flatMap((i) => bornesCitées(nommeInterface(i), i)),
    ...model.consumptions.flatMap((c) => bornesCitées(nommeConso(c), c)),
  ];
  for (const { où, value, emplacement } of citations) {
    if (!declaredMilestones.has(normalizeText(value))) {
      anomalies.push(anomaly(`${où}: milestone "${value}" missing from the "Milestones" sheet.`, emplacement));
    }
  }

  // Une consommation republiée désigne l'une des interfaces de SON PROPRE
  // consommateur : republier sous l'interface d'un autre ne veut rien dire.
  // Deux versions du même flux exposées par cet acteur rendent le nom seul
  // ambigu -- on ne choisit pas au hasard, on réclame la version.
  for (const c of model.consumptions) {
    const target = c.republishedAs.trim();
    if (target === "") continue;
    const siennes = model.interfaces.filter((i) => i.providerName.trim() === c.consumerName.trim());
    const exactes = siennes.filter(
      (i) => normalizeText(interfaceLabel(i.flowName, i.version)) === normalizeText(target)
    );
    if (exactes.length === 1) continue;
    const parNom = siennes.filter((i) => normalizeText(i.flowName) === normalizeText(target));
    if (parNom.length === 1) continue;
    if (parNom.length === 0) {
      anomalies.push(
        anomaly(`${nommeConso(c)}: republished as "${target}", which "${c.consumerName}" does not provide.`, c)
      );
    } else {
      anomalies.push(
        anomaly(`${nommeConso(c)}: republished as "${target}", which "${c.consumerName}" provides in ${parNom.length} versions — name the version.`, c)
      );
    }
  }

  // La couleur d'une technologie vient du référentiel externe, en hexadécimal.
  // Une valeur qui n'en est pas une retombe silencieusement sur la palette --
  // le classeur aurait donc l'air de décider une teinte qu'il ne décide pas.
  for (const t of model.flowTypes) {
    const brut = t.colour.trim();
    if (brut === "" || COULEUR_HEXA.test(brut)) continue;
    anomalies.push(anomaly(`${nommeTypeFlux(t)}: colour "${brut}" is not a hex code such as #2a78d6.`, t));
  }

  // Deux technologies de la même couleur donnent deux traits indiscernables,
  // légende comprise. Le classeur ne le montre nulle part : deux cellules
  // voisines d'un référentiel se comparent mal à l'œil.
  const parCouleur = new Map<string, TypeFlux>();
  for (const t of model.flowTypes) {
    const brut = t.colour.trim();
    if (!COULEUR_HEXA.test(brut)) continue;
    const key = brut.replace("#", "").toLowerCase();
    const déjà = parCouleur.get(key);
    if (déjà) {
      anomalies.push(
        anomaly(`${nommeTypeFlux(t)}: colour "${brut}" is already carried by "${déjà.type}" — the two would be drawn alike.`, t)
      );
    } else {
      parCouleur.set(key, t);
    }
  }

  // Le catalogue d'icônes est embarqué (livrable hors ligne) : un nom inventé
  // ne dessinerait rien, autant le dire avec la liste des noms valides.
  for (const t of model.typesActeur) {
    if (t.icone && !ICONES_DISPONIBLES.includes(t.icone.trim())) {
      anomalies.push(
        anomaly(`${nommeTypeActeur(t)}: icon "${t.icone}" unknown. Accepted values: ${ICONES_DISPONIBLES.join(", ")}.`, t)
      );
    }
  }

  // Un classeur vierge n'est pas incohérent, il est vide : sans un seul acteur,
  // une déclaration « inutilisée » ne signale rien. Sans cette garde, le modèle
  // téléchargé s'ouvrait sur six erreurs.
  if (model.typesActeur.length > 0 && model.actors.length > 0) {
    const déclarésTypes = new Set(model.typesActeur.map((t) => normalizeText(t.type)));
    const vus = new Set<string>();
    for (const a of model.actors) {
      const type = a.typeActeur.trim();
      if (!type) continue;
      vus.add(normalizeText(type));
      if (!déclarésTypes.has(normalizeText(type))) {
        anomalies.push(anomaly(`${nommeActeur(a)}: actor type "${type}" missing from the "ActorTypes" sheet.`, a));
      }
    }
    for (const t of model.typesActeur) {
      if (!vus.has(normalizeText(t.type))) {
        anomalies.push(anomaly(`${nommeTypeActeur(t)} is declared but no actor carries it.`, t));
      }
    }
  }

  if (!model.groupesAbsents && model.actors.length > 0) {
    const déclarés = new Set(model.groups.map((g) => normalizeText(g.name)));
    const vus = new Set<string>();
    for (const a of model.actors) {
      const group = a.group.trim();
      if (!group) continue;
      vus.add(normalizeText(group));
      if (!déclarés.has(normalizeText(group))) {
        anomalies.push(anomaly(`${nommeActeur(a)}: group "${group}" missing from the "Groups" sheet.`, a));
      }
    }
    for (const g of model.groups) {
      if (!vus.has(normalizeText(g.name))) {
        anomalies.push(anomaly(`${nommeGroupe(g)} is declared but no actor belongs to it.`, g));
      }
    }
  }

  return { id: "references", title: "References", description: "A value points at nothing.", anomalies: parEmplacement(anomalies) };
}

// Deux lectures, une seule section. Les fautes de SAISIE se jugent sur le
// classeur entier -- un intervalle impossible reste impossible quel que soit le
// palier regardé. Ce que le SCHÉMA montre se juge au palier affiché : une
// interface qui perd son dernier consommateur en v2, une chaîne de relais que
// le temps coupe, ne se voient qu'à ce moment-là. Tout juger sur le classeur
// entier les faisait disparaître en silence, sous un schéma vide.
function checkCoherence(model: ParsedModel, auPalier: ParsedModel): AnomalyFamily {
  const anomalies: Anomaly[] = [];
  const lookup = buildInterfaceLookup(model);
  const lookupAuPalier = buildInterfaceLookup(auPalier);

  for (const c of model.consumptions) {
    const iface = findInterfaceForConsommation(lookup, c);
    if (iface && iface.providerName.trim() === c.consumerName.trim()) {
      anomalies.push(anomaly(`${nommeConso(c)}: the consumer is also the provider.`, c));
    }
  }

  for (const iface of auPalier.interfaces) {
    if (consommationsForInterface(lookupAuPalier, auPalier, iface).length === 0) {
      anomalies.push(anomaly(`${nommeInterface(iface)} has no declared consumption.`, iface));
    }
  }

  // Un consommateur ne consomme pas deux versions d'un contrat à la fois :
  // c'est une incohérence, pas une étape de migration. La migration consiste
  // à changer la version d'une ligne, pas à en ajouter une seconde.
  //
  // « À la fois » se prend au mot : deux lignes dont les intervalles ne se
  // rencontrent jamais sont la migration datée que le mode d'emploi du
  // classeur prescrit -- « Obsolete row: do not delete it: give it a
  // retirement milestone. » Les compter ensemble reprochait au fichier de
  // suivre sa propre consigne.
  const parFluxEtConsommateur = new Map<string, Consommation[]>();
  for (const c of model.consumptions) {
    const key = JSON.stringify([normalizeText(c.sheet), normalizeText(c.flowName), normalizeText(c.consumerName)]);
    parFluxEtConsommateur.set(key, [...(parFluxEtConsommateur.get(key) ?? []), c]);
  }
  for (const c of model.consumptions) {
    const key = JSON.stringify([normalizeText(c.sheet), normalizeText(c.flowName), normalizeText(c.consumerName)]);
    const rows = parFluxEtConsommateur.get(key);
    if (!rows) continue;
    const simultanées = rows.filter(
      (autre) =>
        autre !== c &&
        autre.version.trim() !== c.version.trim() &&
        seRencontrent(lifespanOf(model, c), lifespanOf(model, autre))
    );
    if (simultanées.length === 0) continue;
    const versions = new Set([c, ...simultanées].map((l) => l.version.trim()));
    parFluxEtConsommateur.delete(key);
    anomalies.push(
      anomaly(
        `${nommeConso(c)}: consumer "${c.consumerName}" is listed on two versions (${[...versions].map((v) => v || "no version").join(", ")}); a consumer consumes only one version of a contract.`,
        c
      )
    );
  }


  // L'axe des paliers, quand il est utilisé. Un intervalle qui déborde de
  // celui dont il dépend décrit une plateforme impossible : un flux exposé par
  // un acteur qui n'existe pas encore, ou plus.
  //
  // On ne juge que ce qui a été SAISI, borne par borne : une arrivée absente
  // est déjà réclamée par la complétude (§7.4), la signaler ici en plus
  // dirait deux fois la même case vide sous deux formes différentes.
  if (model.milestones.length > 0) {
    const actors = actorByName(model);
    const vieActeur = (name: string): Intervalle => {
      const a = actors.get(name.trim());
      return a ? lifespanOf(model, a) : TOUJOURS;
    };

    function contrôlerEmboitement(
      subject: string,
      validite: ValiditePalier & Emplacement,
      parents: { name: string; interval: Intervalle }[]
    ) {
      const interval = lifespanOf(model, validite);
      const arrivéeSaisie = validite.introducedAt.trim() !== "";
      const retraitSaisi = validite.retiredAt.trim() !== "";

      if (arrivéeSaisie && retraitSaisi && interval.end <= interval.start) {
        anomalies.push(anomaly(`${subject}: retirement milestone is at or before the introduction milestone.`, validite));
        return;
      }
      for (const parent of parents) {
        const tropTôt = arrivéeSaisie && interval.start < parent.interval.start;
        const tropTard = retraitSaisi && interval.end > parent.interval.end;
        // Deux intervalles qui ne se rencontrent JAMAIS ne débordent ni d'un
        // côté ni de l'autre : une consommation qui commence là où son
        // interface se retire ne déclenchait donc rien, alors qu'elle décrit
        // un lien qui n'existe à aucun palier.
        const jamaisEnsemble =
          parent.interval.start < parent.interval.end && !seRencontrent(interval, parent.interval);
        if (tropTôt || tropTard || jamaisEnsemble) {
          anomalies.push(anomaly(`${subject} lives outside the lifetime of ${parent.name}.`, validite));
        }
      }
    }

    for (const i of model.interfaces) {
      contrôlerEmboitement(nommeInterface(i), i, [
        { name: `its provider "${i.providerName}"`, interval: vieActeur(i.providerName) },
      ]);
    }

    for (const c of model.consumptions) {
      const iface = findInterfaceForConsommation(lookup, c);
      const parents = [
        { name: `its consumer "${c.consumerName}"`, interval: vieActeur(c.consumerName) },
        ...(iface
          ? [{
              name: `interface "${interfaceLabel(iface.flowName, iface.version)}"`,
              interval: lifespanOf(model, iface),
            }]
          : []),
      ];
      contrôlerEmboitement(nommeConso(c), c, parents);
    }
  }

  for (const c of model.consumptions) {
    if (c.republishedAs.trim() !== "" && !isTechnicalActor(model, c.consumerName)) {
      anomalies.push(
        anomaly(`${nommeConso(c)}: says it republishes, yet "${c.consumerName}" is a business actor — only plumbing relays.`, c)
      );
    }
  }

  // Une chaîne coupée ne produit aucun lien fonctionnel. Sans ces deux lignes
  // le lien manquait EN SILENCE, ce qui est précisément ce que le contrôle du
  // bus fourre-tout, plus bas, cherche à éviter.
  for (const coupée of chainesCoupees(auPalier, null)) {
    if (coupée.reason === "loop") {
      anomalies.push(anomaly(`${nommeInterface(coupée.iface)}: its relay chain loops back on itself.`, coupée.iface));
    }
    // Une interface republiée que rien n'alimente : l'acteur technique l'expose,
    // mais aucune de ses consommations ne la désigne. Le lien fonctionnel
    // qu'on en attendait n'existe pas, et sans cette ligne il manquerait EN
    // SILENCE.
    if (coupée.reason === "no-input") {
      anomalies.push(
        anomaly(
          `${nommeInterface(coupée.iface)}: nothing feeds it — no consumption of "${coupée.iface.providerName}" is republished as this interface, so the chain stops here.`,
          coupée.iface
        )
      );
    }
  }

  // Le bus fourre-tout : un flux entre dans la plomberie et n'en ressort pour
  // personne. Sans ce contrôle, le lien fonctionnel manquerait EN SILENCE, ce
  // qui est le pire des cas.
  for (const i of auPalier.interfaces) {
    const consommateurs = consommationsForInterface(lookupAuPalier, auPalier, i).map((c) => c.consumerName);
    if (consommateurs.length === 0) continue;
    if (!consommateurs.every((c) => isTechnicalActor(auPalier, c))) continue;
    const ressort = consommationsForInterface(lookupAuPalier, auPalier, i).some((c) => c.republishedAs.trim() !== "");
    if (!ressort) {
      anomalies.push(
        anomaly(`${nommeInterface(i)}: goes into technical actors and comes back out for nobody.`, i)
      );
    }
  }

  return {
    id: "coherence",
    title: "Coherence",
    description: "The file reads, but something does not add up.",
    anomalies: parEmplacement(anomalies),
  };
}

// Vocabulaires fermés. C'est le seul endroit où une faute de frappe produit un
// schéma FAUX sans rien dire : « Décomissionné » avec un m manquant n'est plus
// reconnu, le flux cesse d'être atténué et l'option cible ne l'exclut plus. Un
// sens de représentation inconnu, lui, INVERSE la flèche (build-model.ts
// retombe silencieusement sur consommateur → exposant).
//
// Les valeurs elles-mêmes viennent d'aggregation/vocabulaires.ts : ce sont les
// mêmes que celles proposées dans les listes déroulantes du classeur, et les
// deux ne doivent pas pouvoir diverger.
const VOCABULAIRES = {
  decision: VOCABULAIRE_DECISION,
  criticality: VOCABULAIRE_CRITICITE,
  direction: VOCABULAIRE_DIRECTION,
  nature: VOCABULAIRE_NATURE,
  perimeter: VOCABULAIRE_PERIMETRE,
};

function horsVocabulaire(value: string, admises: readonly string[]): boolean {
  const v = normalizeText(value);
  return v !== "" && !admises.some((a) => normalizeText(a) === v);
}

function checkVocabulaires(model: ParsedModel): AnomalyFamily {
  const anomalies: Anomaly[] = [];

  // Le périmètre décide de ce qui entre dans la frontière et de ce qui reste
  // dehors. Une valeur fautive ne faisait rien basculer : le groupe n'était ni
  // plateforme ni externe, sans un mot.
  for (const g of model.groups) {
    if (horsVocabulaire(g.perimeter, VOCABULAIRES.perimeter)) {
      anomalies.push(
        anomaly(
          `${nommeGroupe(g)}: perimeter "${g.perimeter}" unknown. Accepted values: ${VOCABULAIRES.perimeter.join(", ")}.`,
          g
        )
      );
    }
  }

  for (const t of model.flowTypes) {
    if (horsVocabulaire(t.sensRepresentationBrut, VOCABULAIRES.direction)) {
      anomalies.push(
        anomaly(
          `${nommeTypeFlux(t)}: direction "${t.sensRepresentationBrut}" unknown. Accepted values: ${VOCABULAIRES.direction.join(", ")}.`,
          t
        )
      );
    }
  }


  for (const t of model.typesActeur) {
    if (horsVocabulaire(t.nature, VOCABULAIRES.nature)) {
      anomalies.push(
        anomaly(`${nommeTypeActeur(t)}: nature "${t.nature}" unknown. Accepted values: ${VOCABULAIRES.nature.join(", ")}.`, t)
      );
    }
  }

  for (const c of model.consumptions) {
    const où = nommeConso(c);
    if (horsVocabulaire(c.decision, VOCABULAIRES.decision)) {
      anomalies.push(anomaly(`${où}: decision "${c.decision}" unknown. Accepted values: ${VOCABULAIRES.decision.join(", ")}.`, c));
    }
    if (horsVocabulaire(c.criticality, VOCABULAIRES.criticality)) {
      anomalies.push(anomaly(`${où}: criticality "${c.criticality}" unknown. Accepted values: ${VOCABULAIRES.criticality.join(", ")}.`, c));
    }
  }

  return {
    id: "vocabulaires",
    title: "Vocabularies",
    description: "An entered value falls outside its accepted list, and changes the drawing without saying so.",
    anomalies: parEmplacement(anomalies),
  };
}

function checkCompletude(model: ParsedModel): AnomalyFamily {
  const anomalies: Anomaly[] = [];

  for (const iface of model.interfaces) {
    if (!iface.description.trim()) {
      anomalies.push(anomaly(`${nommeInterface(iface)}: description empty.`, iface));
    }
    if (!iface.lienContrat.trim() && !iface.referenceContrat.trim()) {
      anomalies.push(anomaly(`${nommeInterface(iface)}: no contract, neither link nor reference.`, iface));
    }
  }

  for (const c of model.consumptions) {
    if (!c.usage.trim()) anomalies.push(anomaly(`${nommeConso(c)}: usage not described.`, c));
    // Un palier de retrait tient lieu de décision : il dit que la consommation
    // part, et quand. Réclamer en plus un jugement demanderait deux fois la
    // même chose.
    if (!c.decision.trim() && !c.retiredAt.trim()) {
      anomalies.push(anomaly(`${nommeConso(c)}: decision empty.`, c));
    }
  }

  for (const a of model.actors) {
    if (!a.group.trim()) {
      anomalies.push(anomaly(`${nommeActeur(a)}: group empty, so it stays out of the aggregated views until filled in.`, a));
    }
  }

  for (const t of model.typesActeur) {
    if (!t.icone.trim()) {
      anomalies.push(anomaly(`${nommeTypeActeur(t)}: icon not filled in.`, t));
    }
  }

  for (const g of model.groups) {
    if (!g.perimeter.trim()) {
      anomalies.push(anomaly(`${nommeGroupe(g)}: perimeter not filled in.`, g));
    }
  }

  // L'arrivée sur l'axe des paliers : sans elle, on ne sait pas à partir de
  // quand la ligne compte, et aucune vue ne peut la placer dans le temps. Le
  // retrait vide, lui, n'est pas un manque : c'est un fait, la ligne est
  // encore là.
  //
  // Réclamé seulement quand l'équipe a adopté l'axe -- un classeur sans aucun
  // palier déclaré ne doit pas se mettre à parler de paliers.
  if (model.milestones.length > 0) {
    for (const a of model.actors) {
      if (!a.introducedAt.trim()) {
        anomalies.push(anomaly(`${nommeActeur(a)}: introduction milestone empty.`, a));
      }
    }
    for (const i of model.interfaces) {
      if (!i.introducedAt.trim()) {
        anomalies.push(anomaly(`${nommeInterface(i)}: introduction milestone empty.`, i));
      }
    }
    for (const c of model.consumptions) {
      if (!c.introducedAt.trim()) {
        anomalies.push(
          anomaly(`${nommeConso(c)}: introduction milestone empty, so it is unknown when this consumer arrived.`, c)
        );
      }
    }
  }

  // Tant qu'aucun type ne déclare de nature, l'équipe n'a pas adopté la
  // distinction et l'outil n'en parle pas -- même règle que pour les paliers.
  const natureAdoptee = model.typesActeur.some((t) => t.nature.trim() !== "");
  if (natureAdoptee) {
    for (const t of model.typesActeur) {
      if (!t.nature.trim()) anomalies.push(anomaly(`${nommeTypeActeur(t)}: nature not filled in.`, t));
    }
  }

  return {
    id: "completude",
    title: "Completeness",
    description: "Something is missing from the entry.",
    anomalies: parEmplacement(anomalies),
  };
}

function decommissionCandidates(model: ParsedModel): InfoBlock {
  const lookup = buildInterfaceLookup(model);
  const candidates: InterfaceCatalogue[] = [];

  for (const iface of model.interfaces) {
    const consumptions = consommationsForInterface(lookup, model, iface);
    if (consumptions.length === 0) continue;

    // L'état est porté par le flux : l'acteur n'en a plus.
    // Tout ce qui consomme cette interface a un palier de retrait : elle n'aura
    // plus personne. Une décision « Remove » ne compte pas ici : elle dit qu'on
    // voudrait s'en passer, pas qu'un départ est daté.
    const toutesEligibles = consumptions.every((c) => c.retiredAt.trim() !== "");

    if (toutesEligibles) candidates.push(iface);
  }
  const items = itemsSitués(candidates, (i) => `${interfaceLabel(i.flowName, i.version)} ${adresse(i)}`);

  return {
    id: "decommissionnement",
    title: "Decommissioning candidates",
    description: "Interfaces whose every consumption is scheduled to go — a call to make.",
    items,
    level: "action",
  };
}

// Un composant qu'aucun flux ne touche n'invalide pas les schémas : il n'y
// apparaît simplement pas. C'est un signal, pas une faute -- et un flux
// décommissionné reste un flux, donc il compte ici comme les autres.
function actorsWithNoFlow(model: ParsedModel): InfoBlock {
  const touchés = new Set<string>();
  for (const iface of model.interfaces) touchés.add(iface.providerName.trim());
  for (const c of model.consumptions) touchés.add(c.consumerName.trim());
  return {
    id: "acteurs-sans-flux",
    title: "Components with no flow",
    description: "They appear on no diagram until some interface reaches them.",
    items: itemsSitués(model.actors.filter((a) => !touchés.has(a.name.trim())), (a) => `${a.name} ${adresse(a)}`),
    level: "warning",
  };
}

// La criticité sert à arbitrer : sans elle on ne peut pas trancher, mais le
// schéma reste juste.
function criticitesManquantes(model: ParsedModel): InfoBlock {
  return {
    id: "criticite-manquante",
    title: "Criticality not filled in",
    description: "Consumptions whose criticality for the consumer is left empty.",
    items: itemsSitués(
      model.consumptions.filter((c) => !c.criticality.trim()),
      (c) => `${c.flowName} ${adresse(c)} — ${c.consumerName}`
    ),
    level: "warning",
  };
}

// Deux composants peuvent échanger plusieurs fois par la même technologie :
// c'est légitime, mais ça vaut d'être vu, ne serait-ce que pour vérifier que ce
// ne sont pas deux saisies du même flux.
function echangesRepetes(model: ParsedModel): InfoBlock {
  const lookup = buildInterfaceLookup(model);
  const comptes = new Map<string, number>();
  for (const c of model.consumptions) {
    const iface = findInterfaceForConsommation(lookup, c);
    if (!iface) continue;
    const key = `${iface.providerName.trim()} → ${c.consumerName.trim()} over ${iface.flowType.trim()}`;
    comptes.set(key, (comptes.get(key) ?? 0) + 1);
  }
  return {
    id: "echanges-repetes",
    title: "Repeated exchanges",
    description: "Pairs of components linked more than once by the same technology.",
    items: [...comptes.entries()]
      .filter(([, n]) => n > 1)
      .sort(([a], [b]) => a.localeCompare(b, "fr"))
      .map(([key, n]) => `${key} (${n} flows)`),
    level: "info",
  };
}

// Qui a besoin de qui : consommer une interface, c'est dépendre de celui qui
// l'expose. Un acteur qui consomme la sienne ne compte pas -- c'est une boucle
// interne, que les vues agrégées masquent déjà, et non une dépendance entre
// composants.
function dependances(model: ParsedModel): Map<string, Set<string>> {
  const lookup = buildInterfaceLookup(model);
  const arcs = new Map<string, Set<string>>();
  for (const c of model.consumptions) {
    const iface = findInterfaceForConsommation(lookup, c);
    if (!iface) continue;
    const de = c.consumerName.trim();
    const vers = iface.providerName.trim();
    if (!de || !vers || de === vers) continue;
    if (!arcs.has(de)) arcs.set(de, new Set());
    arcs.get(de)!.add(vers);
  }
  return arcs;
}

function atteignables(depuis: string, arcs: Map<string, Set<string>>): Set<string> {
  const vus = new Set<string>();
  const àVoir = [...(arcs.get(depuis) ?? [])];
  while (àVoir.length > 0) {
    const n = àVoir.pop()!;
    if (vus.has(n)) continue;
    vus.add(n);
    àVoir.push(...(arcs.get(n) ?? []));
  }
  return vus;
}

// Qui, en tombant, entraîne le plus de monde. Le graphe de dépendances existait
// déjà ici et ne servait qu'à détecter les cycles ; c'est pourtant la question
// qu'on pose le jour où il faut arbitrer une migration.
//
// On ne liste que ceux qui entraînent quelqu'un : nommer les autres avec un
// zéro allongerait la liste sans rien y ajouter.
function rayonDImpact(model: ParsedModel): InfoBlock {
  const arcs = dependances(model);
  const versLAval = new Map<string, Set<string>>();
  for (const [de, vers] of arcs) {
    for (const v of vers) {
      if (!versLAval.has(v)) versLAval.set(v, new Set());
      versLAval.get(v)!.add(de);
    }
  }
  const portée = [...versLAval.keys()]
    // Retranché de lui-même : un cycle ramène l'acteur dans son propre aval, et
    // « combien j'en entraîne » ne me compte pas. Sur le classeur d'exemple,
    // qui contient un cycle à quatre composants, cela se voyait.
    .map((name) => ({ name, downstream: [...atteignables(name, versLAval)].filter((x) => x !== name).length }))
    .filter((x) => x.downstream > 0)
    .sort((a, b) => b.downstream - a.downstream || a.name.localeCompare(b.name, "fr"));

  return {
    id: "rayon-impact",
    title: "Blast radius",
    description: "How many components each one takes with it, directly or through others.",
    items: portée.map((x) => `${x.name}: ${x.downstream} component${x.downstream > 1 ? "s" : ""} downstream.`),
    level: "info",
  };
}

// Des composants qui ont besoin les uns des autres, directement ou de proche en
// proche. Aucun ne peut arriver, partir ou changer de contrat sans les autres :
// c'est une contrainte d'architecture, pas une faute de saisie.
//
// On nomme les groupes plutôt que les chemins : énumérer tous les chemins d'un
// enchevêtrement en produit un nombre qui explose, là où le groupe dit la même
// chose en une ligne. Deux composants sont du même groupe quand chacun atteint
// l'autre -- un classeur tient quelques centaines d'acteurs, le parcours est
// immédiat.
function cyclesDeDependance(model: ParsedModel): InfoBlock {
  const arcs = dependances(model);
  // Seuls les acteurs qui dépendent d'au moins un autre peuvent boucler.
  const candidats = [...arcs.keys()];
  const portée = new Map(candidats.map((n) => [n, atteignables(n, arcs)]));

  const groups: string[] = [];
  const placés = new Set<string>();
  for (const n of candidats) {
    if (placés.has(n) || !portée.get(n)!.has(n)) continue;
    const group = candidats
      .filter((m) => portée.get(n)!.has(m) && portée.get(m)!.has(n))
      .sort((a, b) => a.localeCompare(b, "fr"));
    for (const m of group) placés.add(m);
    groups.push(`${group.join(", ")} (${group.length} components)`);
  }

  return {
    id: "cycles",
    title: "Dependency cycles",
    description: "Components that need one another, directly or through others — none of them stands alone.",
    items: groups.sort((a, b) => a.localeCompare(b, "fr")),
    level: "info",
  };
}

// Un type déclaré que personne n'emploie : le référentiel dit plus que le parc.
function typesFluxInutilises(model: ParsedModel): InfoBlock {
  const utilisés = new Set(model.interfaces.map((i) => normalizeText(i.flowType)));
  return {
    id: "typesflux-inutilises",
    title: "Unused flow types",
    description: "Declared in FlowTypes, but no interface uses them.",
    items: itemsSitués(model.flowTypes.filter((t) => !utilisés.has(normalizeText(t.type))), (t) => `${t.type} ${adresse(t)}`),
    level: "info",
  };
}

// Une couleur trop claire est CORRIGÉE à l'affichage pour que le trait reste
// visible. Le classeur doit l'apprendre ici : sinon la teinte à l'écran n'est
// pas celle qu'il a écrite, et rien ne l'explique.
function couleursIllisibles(model: ParsedModel): InfoBlock {
  const items: string[] = [];
  for (const t of model.flowTypes) {
    const déclarée = HEXA.exec(t.colour.trim());
    if (!déclarée) continue;
    const hex = `#${déclarée[1].toLowerCase()}`;
    const ratio = ratioDeContraste(hex, "#ffffff");
    if (ratio < SEUIL_TRAIT) {
      items.push(
        `${t.type} ${adresse(t)}: colour ${hex} only reaches ${ratio.toFixed(2)}:1 on white; it is darkened on screen so the line stays visible.`
      );
    }
  }
  return {
    id: "contraste",
    title: "Colours too light to draw",
    description: "A declared colour is darkened on screen so the line remains visible.",
    items,
    level: "warning",
  };
}

function interfacesAConfirmer(model: ParsedModel): InfoBlock {
  return {
    id: "a-confirmer",
    title: "Interfaces to confirm",
    description: "Interfaces whose To confirm column reads Yes — to confirm or to drop.",
    items: itemsSitués(model.interfaces.filter((i) => i.aConfirmer), (i) => `${interfaceLabel(i.flowName, i.version)} ${adresse(i)}`),
    level: "action",
  };
}

// Qui n'a pas encore bougé. Une interface à décommissionner qui porte encore
// des consommateurs est un travail en cours, pas une faute du classeur : c'est
// une décision qui attend quelqu'un, donc un bloc « action ».
function migrationsEnCours(model: ParsedModel): InfoBlock {
  const lookup = buildInterfaceLookup(model);
  const enCours: { iface: InterfaceCatalogue; text: string }[] = [];

  for (const iface of model.interfaces) {
    if (iface.retiredAt.trim() === "") continue;
    const restants = [...new Set(consommationsForInterface(lookup, model, iface).map((c) => c.consumerName.trim()))];
    if (restants.length === 0) continue;

    // La cible, ce sont les versions actives du MÊME flux sur le même onglet.
    // On les nomme toutes plutôt que d'en élire une : choisir à la place du
    // classeur reviendrait à inventer la destination.
    const actives = model.interfaces
      .filter(
        (autre) =>
          normalizeText(autre.flowName) === normalizeText(iface.flowName) &&
          normalizeText(autre.expectedSheet) === normalizeText(iface.expectedSheet) &&
          autre.retiredAt.trim() === ""
      )
      .map((autre) => autre.version.trim() || "sans version");

    const vers = actives.length > 0 ? actives.join(", ") : "no active version";
    enCours.push({
      iface,
      text: `${interfaceLabel(iface.flowName, iface.version)} ${adresse(iface)} → ${vers}: ${restants.join(", ")}`,
    });
  }
  const items = itemsSitués(enCours.map((e) => ({ ...e.iface, text: e.text })), (e) => e.text);

  return {
    id: "migrations",
    title: "Migrations under way",
    description: "Interfaces on their way out that still carry consumers, and the active version to move them to.",
    items,
    level: "action",
  };
}

function groupesUtilises(model: ParsedModel): InfoBlock {
  const counts = new Map<string, number>();
  for (const a of model.actors) {
    const group = a.group.trim();
    if (!group) continue;
    counts.set(group, (counts.get(group) ?? 0) + 1);
  }
  const items = [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b, "fr"))
    .map(([group, n]) => `${group} (${n})`);

  return {
    id: "groupes",
    title: "Groups in use",
    description: "Distinct groups found in Actors, with how many actors each holds.",
    items,
    level: "info",
  };
}

// Le classeur réduit à ce qui vit au palier affiché. Les contrôles qui jugent
// un ÉTAT de la plateforme -- cohérence, complétude, blocs informatifs -- s'y
// appliquent ; ceux qui jugent le FICHIER -- structure, références,
// vocabulaires, contrôles temporels -- travaillent sur le classeur entier.
//
// Sans cette distinction, l'axe se saborde : un acteur retiré au palier 2 n'a
// évidemment plus de flux au palier 3, et le rapport se remplirait d'anomalies
// fausses dès la première ligne retirée.
function modeleAuPalier(model: ParsedModel, rank: number | null): ParsedModel {
  if (rank === null || model.milestones.length === 0) return model;
  const live = (v: { introducedAt: string; retiredAt: string }) =>
    isLiveAt(lifespanOf(model, v), rank);
  // Un flux n'existe au palier que si TOUTE sa chaîne y existe : exposant,
  // interface, consommation, consommateur. C'est la règle que les schémas
  // appliquent (buildFlowInstances). Filtrer les trois tables chacune de son
  // côté gardait une consommation dont l'acteur avait disparu : le rapport
  // contredisait alors le schéma du même palier, affiché juste à côté.
  //
  // Une consommation qui ne désigne aucune interface disparaît donc aussi --
  // c'est bien une faute, mais elle relève des contrôles de référence, qui
  // jugent le classeur entier.
  const actors = model.actors.filter(live);
  // Un acteur INCONNU du classeur n'est pas un acteur mort. C'est une faute de
  // référence, que les contrôles signalent par ailleurs, et les schémas
  // dessinent son flux (buildFlowInstances traite l'introuvable comme vivant,
  // délibérément). Juger l'existence ici faisait dire au rapport « B sans flux »
  // sous un schéma qui montre justement un flux vers B.
  const retired = (name: string) => {
    const a = model.actors.find((x) => x.name.trim() === name.trim());
    return a !== undefined && !live(a);
  };
  const interfaces = model.interfaces.filter((i) => live(i) && !retired(i.providerName));
  const lookup = buildInterfaceLookup({ ...model, interfaces });
  const consumptions = model.consumptions.filter(
    (c) => live(c) && !retired(c.consumerName) && findInterfaceForConsommation(lookup, c) !== undefined
  );
  return { ...model, actors, interfaces, consumptions };
}

export function runIntegrityChecks(model: ParsedModel, rank: number | null = null): IntegrityReport {
  const auPalier = modeleAuPalier(model, rank);
  const families = [
    checkStructure(model),
    checkReferences(model),
    checkVocabulaires(model),
    checkCoherence(model, auPalier),
    checkCompletude(auPalier),
  ];
  const infoBlocks = [
    actorsWithNoFlow(auPalier),
    criticitesManquantes(auPalier),
    interfacesAConfirmer(auPalier),
    migrationsEnCours(auPalier),
    decommissionCandidates(auPalier),
    echangesRepetes(auPalier),
    cyclesDeDependance(auPalier),
    typesFluxInutilises(auPalier),
    // Une couleur ne dépend d'aucun palier : le classeur entier.
    couleursIllisibles(model),
    rayonDImpact(auPalier),
    groupesUtilises(auPalier),
  ];
  const totalAnomalies = families.reduce((sum, f) => sum + f.anomalies.length, 0);
  const total = (level: InfoBlock["level"]) =>
    infoBlocks.filter((b) => b.level === level).reduce((sum, b) => sum + b.items.length, 0);

  return {
    families,
    infoBlocks,
    totalAnomalies,
    totalActions: total("action"),
    totalAvertissements: total("warning"),
  };
}
