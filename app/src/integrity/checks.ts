import { ICONES_DISPONIBLES } from "../render/icones";

// Le même format que celui qu'accepte la palette (render/colors.ts).
const COULEUR_HEXA = /^#?[0-9a-f]{6}$/i;
import type {
  Acteur,
  Consommation,
  Emplacement,
  Groupe,
  InterfaceCatalogue,
  Palier,
  ParsedModel,
  TypeActeur,
  TypeFlux,
  ValiditePalier,
} from "../parsing/model";
import {
  buildInterfaceLookup,
  findInterfaceForConsommation,
  interfaceKey,
  libelleInterface,
  nomVersionKey,
  type InterfaceLookup,
} from "../aggregation/core";
import { intervalleDeVie, estVivant, TOUJOURS, type Intervalle } from "../aggregation/paliers";
import { LONGUEUR_MAX_ONGLET } from "../parsing/build-model";
import { estActeurTechnique } from "../aggregation/nature";
import {
  VOCABULAIRE_DIRECTION,
  VOCABULAIRE_DECISION,
  VOCABULAIRE_CRITICITE,
  VOCABULAIRE_NATURE,
} from "../aggregation/vocabulaires";
import { chainesCoupees } from "../aggregation/fonctionnel";
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
  return `(${e.feuille}, row ${e.ligne})`;
}

function situé(quoi: string, nom: string, e: Emplacement): string {
  return `${quoi} "${nom}" ${adresse(e)}`;
}

const nommeActeur = (a: Acteur) => situé("Actor", a.nom, a);
const nommeInterface = (i: InterfaceCatalogue) => situé("Interface", libelleInterface(i.nomDuFlux, i.version), i);
const nommeConso = (c: Consommation) => situé("Consumption", c.nomDuFlux, c);
const nommeGroupe = (g: Groupe) => situé("Group", g.nom, g);
const nommeTypeActeur = (t: TypeActeur) => situé("Actor type", t.type, t);
const nommeTypeFlux = (t: TypeFlux) => situé("Flow type", t.type, t);
const nommePalier = (p: Palier) => situé("Milestone", p.nom, p);

// Les éléments d'un bloc suivent le même ordre que les anomalies : la feuille,
// puis la ligne. Ils portent leur adresse dans le texte, faute d'avoir, comme
// une anomalie, un champ pour la loger.
function itemsSitués<T extends Emplacement>(lignes: T[], texte: (l: T) => string): string[] {
  return [...lignes]
    .sort((a, b) => a.feuille.localeCompare(b.feuille, "fr") || a.ligne - b.ligne)
    .map(texte);
}

function anomalie(message: string, e?: Emplacement): Anomaly {
  return e ? { message, emplacement: { feuille: e.feuille, ligne: e.ligne } } : { message };
}

// Ce qui n'a pas d'adresse d'abord -- ça vise le fichier entier, donc ça se lit
// avant toute correction de saisie. Le reste suit le classeur : feuille, puis
// ligne croissante, l'ordre dans lequel on le corrigera.
function parEmplacement(anomalies: Anomaly[]): Anomaly[] {
  return [...anomalies].sort((a, b) => {
    if (!a.emplacement || !b.emplacement) return (a.emplacement ? 1 : 0) - (b.emplacement ? 1 : 0);
    return (
      a.emplacement.feuille.localeCompare(b.emplacement.feuille, "fr") ||
      a.emplacement.ligne - b.emplacement.ligne
    );
  });
}

export interface AnomalyFamily {
  id: string;
  titre: string;
  description: string;
  anomalies: Anomaly[];
}

export interface InfoBlock {
  id: string;
  titre: string;
  description: string;
  items: string[];
  // « avertissement » signale une saisie à trancher, pas une faute : ça se
  // compte et se voit, mais ça ne détourne pas l'utilisateur de ses schémas
  // au chargement, contrairement aux anomalies.
  // « action » : le fichier est juste, mais une décision attend quelqu'un.
  // C'est autre chose qu'un avertissement, qui signale une saisie manquante.
  niveau: "info" | "action" | "avertissement";
}

export interface IntegrityReport {
  familles: AnomalyFamily[];
  blocsInformatifs: InfoBlock[];
  totalAnomalies: number;
  totalActions: number;
  totalAvertissements: number;
}

function acteurByNom(model: ParsedModel): Map<string, Acteur> {
  const map = new Map<string, Acteur>();
  for (const a of model.acteurs) map.set(a.nom.trim(), a);
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
  return model.consommations.filter((c) => findInterfaceForConsommation(lookup, c) === iface);
}

function bornesCitées(où: string, v: ValiditePalier & Emplacement) {
  return [v.palierIntroduction, v.palierRetrait]
    .filter((valeur) => valeur.trim() !== "")
    .map((valeur) => ({ où, valeur, emplacement: v as Emplacement }));
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

  for (const { feuille, colonne } of model.colonnesOptionnellesAbsentes) {
    anomalies.push({ message: `Column "${colonne}" missing from sheet "${feuille}".` });
  }

  for (const nom of duplicates(model.acteurs.map((a) => a.nom))) {
    // La ligne citée est la seconde : la première est légitime, c'est le doublon
    // qu'on va supprimer.
    const doublon = model.acteurs.filter((a) => a.nom.trim() === nom)[1];
    anomalies.push(anomalie(`${nommeActeur(doublon)} is declared more than once in the repository.`, doublon));
  }

  // Sur (exposant, nom, version) et non sur le nom seul. Deux versions d'un même
  // contrat sont deux lignes légitimes, c'est tout l'objet de la colonne ; et
  // deux acteurs peuvent publier un contrat de même nom sans s'être concertés,
  // ce qui fait deux interfaces distinctes -- pas un doublon.
  const identité = (i: InterfaceCatalogue) =>
    `${normalizeText(i.acteurExposant)}\u0000${normalizeText(libelleInterface(i.nomDuFlux, i.version))}`;
  for (const cle of duplicates(model.interfaces.map(identité))) {
    const doublon = model.interfaces.filter((i) => identité(i) === cle)[1];
    anomalies.push(
      anomalie(`${nommeInterface(doublon)} is published more than once by "${doublon.acteurExposant}".`, doublon)
    );
  }

  // La frise elle-même n'était pas contrôlée. Un rang illisible vaut 0 à la
  // lecture, pour que la ligne ne disparaisse pas en silence -- encore faut-il
  // le dire : sinon la frise part de zéro et le palier courant désigne le
  // mauvais, sans une anomalie pour l'expliquer.
  for (const palier of model.paliers) {
    if (palier.rang > 0) continue;
    anomalies.push(anomalie(`Milestone "${palier.nom}" has no usable rank; a milestone is placed by a rank of 1 or more.`, palier));
  }

  // Deux paliers que seuls la casse ou un accent distinguent se confondent :
  // toute ligne datée résout son rang sur le nom NORMALISÉ et prend donc le
  // premier des deux. Les acteurs et les interfaces avaient ce contrôle, la
  // frise ne l'avait pas.
  for (const nom of duplicates(model.paliers.map((p) => normalizeText(p.nom)))) {
    const doublon = model.paliers.filter((p) => normalizeText(p.nom) === nom)[1];
    anomalies.push(
      anomalie(`Milestone "${doublon.nom}" repeats an earlier milestone; the timeline cannot tell them apart.`, doublon)
    );
  }

  // Le nom d'onglet est coupé à ce qu'Excel accepte : deux couples (exposant,
  // type de flux) différents peuvent donc tomber sur le même. Les fondre
  // mélangerait les consommations de deux contrats sans un mot -- on le dit, et
  // c'est un nom d'acteur ou de type qu'il faut raccourcir.
  const coupleDeLOnglet = new Map<string, { exposant: string; type: string }>();
  for (const i of model.interfaces) {
    const couple = { exposant: i.acteurExposant.trim(), type: i.typeDeFlux.trim() };
    const déjà = coupleDeLOnglet.get(normalizeText(i.feuilleAttendue));
    if (!déjà) {
      coupleDeLOnglet.set(normalizeText(i.feuilleAttendue), couple);
      continue;
    }
    if (déjà.exposant === couple.exposant && déjà.type === couple.type) continue;
    anomalies.push(
      anomalie(
        `${nommeInterface(i)}: "${couple.exposant}" / "${couple.type}" and "${déjà.exposant}" / "${déjà.type}" both land on the same sheet "${i.feuilleAttendue}" once cut to ${LONGUEUR_MAX_ONGLET} characters. Shorten one of the names.`,
        i
      )
    );
  }

  const fxNormalises = new Set(model.fxSheetNames.map((n) => normalizeText(n)));
  for (const iface of model.interfaces) {
    if (!fxNormalises.has(normalizeText(iface.feuilleAttendue))) {
      anomalies.push(
        anomalie(`${nommeInterface(iface)}: sheet "${iface.feuilleAttendue}" missing from the workbook.`, iface)
      );
    }
  }

  const attendus = new Set(model.interfaces.map((i) => normalizeText(i.feuilleAttendue)));
  for (const feuille of model.fxSheetNames) {
    if (!attendus.has(normalizeText(feuille))) {
      anomalies.push(anomalie(`Sheet "${feuille}" is present but no interface points to it.`));
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
  if (model.paliers.length > 0) {
    for (const rang of duplicates(model.paliers.map((p) => String(p.rang)))) {
      const noms = model.paliers.filter((p) => String(p.rang) === rang).map((p) => p.nom);
      anomalies.push(anomalie(`Milestones "${noms.join('", "')}" share rank ${rang}, so their order is ambiguous.`));
    }
    if (!model.paliers.some((p) => normalizeText(p.statut) === normalizeText("Delivered"))) {
      anomalies.push({
        message: 'No milestone is marked "Delivered", so the current one is undetermined; the views fall back on the first declared.',
      });
    }
  }

  return { id: "structure", titre: "Structure", description: "The file does not read as expected.", anomalies: parEmplacement(anomalies) };
}

function checkReferences(model: ParsedModel): AnomalyFamily {
  const anomalies: Anomaly[] = [];
  const acteurs = acteurByNom(model);
  const typesFlux = new Set(model.typesFlux.map((t) => t.type.trim()));
  const lookup = buildInterfaceLookup(model);

  for (const iface of model.interfaces) {
    if (!acteurs.has(iface.acteurExposant.trim())) {
      anomalies.push(anomalie(`${nommeInterface(iface)}: provider "${iface.acteurExposant}" unknown to the repository.`, iface));
    }
    if (!typesFlux.has(iface.typeDeFlux.trim())) {
      // La conséquence, et pas seulement la faute : sans type déclaré, le sens
      // de la flèche est indéterminable, donc l'interface et TOUTES ses
      // consommations sortent des schémas. Dit sans cela, l'énoncé passait pour
      // un rappel de vocabulaire -- sur un classeur réel, 24 interfaces sur 59
      // manquaient à tous les dessins pour cette seule raison.
      anomalies.push(
        anomalie(
          `${nommeInterface(iface)}: flow type "${iface.typeDeFlux}" unknown to the repository, so this interface and its consumptions are not drawn.`,
          iface
        )
      );
    }
  }

  for (const c of model.consommations) {
    if (!acteurs.has(c.acteurConsommateur.trim())) {
      anomalies.push(anomalie(`${nommeConso(c)}: consumer "${c.acteurConsommateur}" unknown to the repository.`, c));
    }
    const parNom = lookup.byNom.get(c.nomDuFlux.trim());
    if (!parNom) {
      anomalies.push(anomalie(`${nommeConso(c)}: flow name missing from the Interfaces catalogue.`, c));
      continue;
    }
    // Le nom existe, la version non : on ne rattache pas au hasard, on le dit.
    const iface = lookup.byNomVersion.get(nomVersionKey(c.nomDuFlux, c.version));
    if (!iface) {
      anomalies.push(anomalie(`${nommeConso(c)}: version "${c.version}" missing from the catalogue for this flow.`, c));
      continue;
    }
    const exact = lookup.byKey.get(interfaceKey(c.feuille, c.nomDuFlux, c.version));
    if (!exact) {
      anomalies.push(anomalie(`${nommeConso(c)}: filed under "${c.feuille}" instead of "${iface.feuilleAttendue}".`, c));
    }
  }

  // Un palier cité mais absent de l'onglet Paliers date une ligne d'un jalon
  // qui n'existe pas : la ligne serait lue comme « depuis toujours », ce qui
  // n'est pas ce que la saisie voulait dire.
  const paliersDéclarés = new Set(model.paliers.map((p) => normalizeText(p.nom)));
  const citations = [
    ...model.acteurs.flatMap((a) => bornesCitées(nommeActeur(a), a)),
    ...model.interfaces.flatMap((i) => bornesCitées(nommeInterface(i), i)),
    ...model.consommations.flatMap((c) => bornesCitées(nommeConso(c), c)),
  ];
  for (const { où, valeur, emplacement } of citations) {
    if (!paliersDéclarés.has(normalizeText(valeur))) {
      anomalies.push(anomalie(`${où}: milestone "${valeur}" missing from the "Milestones" sheet.`, emplacement));
    }
  }

  // Une consommation republiée désigne l'une des interfaces de SON PROPRE
  // consommateur : republier sous l'interface d'un autre ne veut rien dire.
  // Deux versions du même flux exposées par cet acteur rendent le nom seul
  // ambigu -- on ne choisit pas au hasard, on réclame la version.
  for (const c of model.consommations) {
    const cible = c.republiePar.trim();
    if (cible === "") continue;
    const siennes = model.interfaces.filter((i) => i.acteurExposant.trim() === c.acteurConsommateur.trim());
    const exactes = siennes.filter(
      (i) => normalizeText(libelleInterface(i.nomDuFlux, i.version)) === normalizeText(cible)
    );
    if (exactes.length === 1) continue;
    const parNom = siennes.filter((i) => normalizeText(i.nomDuFlux) === normalizeText(cible));
    if (parNom.length === 1) continue;
    if (parNom.length === 0) {
      anomalies.push(
        anomalie(`${nommeConso(c)}: republished as "${cible}", which "${c.acteurConsommateur}" does not provide.`, c)
      );
    } else {
      anomalies.push(
        anomalie(`${nommeConso(c)}: republished as "${cible}", which "${c.acteurConsommateur}" provides in ${parNom.length} versions — name the version.`, c)
      );
    }
  }

  // La couleur d'une technologie vient du référentiel externe, en hexadécimal.
  // Une valeur qui n'en est pas une retombe silencieusement sur la palette --
  // le classeur aurait donc l'air de décider une teinte qu'il ne décide pas.
  for (const t of model.typesFlux) {
    const brut = t.couleur.trim();
    if (brut === "" || COULEUR_HEXA.test(brut)) continue;
    anomalies.push(anomalie(`${nommeTypeFlux(t)}: colour "${brut}" is not a hex code such as #2a78d6.`, t));
  }

  // Deux technologies de la même couleur donnent deux traits indiscernables,
  // légende comprise. Le classeur ne le montre nulle part : deux cellules
  // voisines d'un référentiel se comparent mal à l'œil.
  const parCouleur = new Map<string, TypeFlux>();
  for (const t of model.typesFlux) {
    const brut = t.couleur.trim();
    if (!COULEUR_HEXA.test(brut)) continue;
    const clé = brut.replace("#", "").toLowerCase();
    const déjà = parCouleur.get(clé);
    if (déjà) {
      anomalies.push(
        anomalie(`${nommeTypeFlux(t)}: colour "${brut}" is already carried by "${déjà.type}" — the two would be drawn alike.`, t)
      );
    } else {
      parCouleur.set(clé, t);
    }
  }

  // Le catalogue d'icônes est embarqué (livrable hors ligne) : un nom inventé
  // ne dessinerait rien, autant le dire avec la liste des noms valides.
  for (const t of model.typesActeur) {
    if (t.icone && !ICONES_DISPONIBLES.includes(t.icone.trim())) {
      anomalies.push(
        anomalie(`${nommeTypeActeur(t)}: icon "${t.icone}" unknown. Accepted values: ${ICONES_DISPONIBLES.join(", ")}.`, t)
      );
    }
  }

  // Un classeur vierge n'est pas incohérent, il est vide : sans un seul acteur,
  // une déclaration « inutilisée » ne signale rien. Sans cette garde, le modèle
  // téléchargé s'ouvrait sur six erreurs.
  if (model.typesActeur.length > 0 && model.acteurs.length > 0) {
    const déclarésTypes = new Set(model.typesActeur.map((t) => normalizeText(t.type)));
    const vus = new Set<string>();
    for (const a of model.acteurs) {
      const type = a.typeActeur.trim();
      if (!type) continue;
      vus.add(normalizeText(type));
      if (!déclarésTypes.has(normalizeText(type))) {
        anomalies.push(anomalie(`${nommeActeur(a)}: actor type "${type}" missing from the "ActorTypes" sheet.`, a));
      }
    }
    for (const t of model.typesActeur) {
      if (!vus.has(normalizeText(t.type))) {
        anomalies.push(anomalie(`${nommeTypeActeur(t)} is declared but no actor carries it.`, t));
      }
    }
  }

  if (!model.groupesAbsents && model.acteurs.length > 0) {
    const déclarés = new Set(model.groupes.map((g) => normalizeText(g.nom)));
    const vus = new Set<string>();
    for (const a of model.acteurs) {
      const groupe = a.groupe.trim();
      if (!groupe) continue;
      vus.add(normalizeText(groupe));
      if (!déclarés.has(normalizeText(groupe))) {
        anomalies.push(anomalie(`${nommeActeur(a)}: group "${groupe}" missing from the "Groups" sheet.`, a));
      }
    }
    for (const g of model.groupes) {
      if (!vus.has(normalizeText(g.nom))) {
        anomalies.push(anomalie(`${nommeGroupe(g)} is declared but no actor belongs to it.`, g));
      }
    }
  }

  return { id: "references", titre: "References", description: "A value points at nothing.", anomalies: parEmplacement(anomalies) };
}

function checkCoherence(model: ParsedModel): AnomalyFamily {
  const anomalies: Anomaly[] = [];
  const lookup = buildInterfaceLookup(model);

  for (const c of model.consommations) {
    const iface = findInterfaceForConsommation(lookup, c);
    if (iface && iface.acteurExposant.trim() === c.acteurConsommateur.trim()) {
      anomalies.push(anomalie(`${nommeConso(c)}: the consumer is also the provider.`, c));
    }
  }

  for (const iface of model.interfaces) {
    if (consommationsForInterface(lookup, model, iface).length === 0) {
      anomalies.push(anomalie(`${nommeInterface(iface)} has no declared consumption.`, iface));
    }
  }

  // Un consommateur ne consomme pas deux versions d'un contrat à la fois :
  // c'est une incohérence, pas une étape de migration. La migration consiste
  // à changer la version d'une ligne, pas à en ajouter une seconde.
  const parFluxEtConsommateur = new Map<string, Set<string>>();
  for (const c of model.consommations) {
    const cle = JSON.stringify([normalizeText(c.feuille), normalizeText(c.nomDuFlux), normalizeText(c.acteurConsommateur)]);
    const versions = parFluxEtConsommateur.get(cle) ?? new Set<string>();
    versions.add(c.version.trim());
    parFluxEtConsommateur.set(cle, versions);
  }
  for (const c of model.consommations) {
    const cle = JSON.stringify([normalizeText(c.feuille), normalizeText(c.nomDuFlux), normalizeText(c.acteurConsommateur)]);
    const versions = parFluxEtConsommateur.get(cle);
    if (!versions || versions.size < 2) continue;
    parFluxEtConsommateur.delete(cle);
    anomalies.push(
      anomalie(
        `${nommeConso(c)}: consumer "${c.acteurConsommateur}" is listed on two versions (${[...versions].map((v) => v || "no version").join(", ")}); a consumer consumes only one version of a contract.`,
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
  if (model.paliers.length > 0) {
    const acteurs = acteurByNom(model);
    const vieActeur = (nom: string): Intervalle => {
      const a = acteurs.get(nom.trim());
      return a ? intervalleDeVie(model, a) : TOUJOURS;
    };

    function contrôlerEmboitement(
      sujet: string,
      validite: ValiditePalier & Emplacement,
      parents: { nom: string; intervalle: Intervalle }[]
    ) {
      const intervalle = intervalleDeVie(model, validite);
      const arrivéeSaisie = validite.palierIntroduction.trim() !== "";
      const retraitSaisi = validite.palierRetrait.trim() !== "";

      if (arrivéeSaisie && retraitSaisi && intervalle.fin <= intervalle.debut) {
        anomalies.push(anomalie(`${sujet}: retirement milestone is at or before the introduction milestone.`, validite));
        return;
      }
      for (const parent of parents) {
        const tropTôt = arrivéeSaisie && intervalle.debut < parent.intervalle.debut;
        const tropTard = retraitSaisi && intervalle.fin > parent.intervalle.fin;
        if (tropTôt || tropTard) {
          anomalies.push(anomalie(`${sujet} lives outside the lifetime of ${parent.nom}.`, validite));
        }
      }
    }

    for (const i of model.interfaces) {
      contrôlerEmboitement(nommeInterface(i), i, [
        { nom: `its provider "${i.acteurExposant}"`, intervalle: vieActeur(i.acteurExposant) },
      ]);
    }

    for (const c of model.consommations) {
      const iface = findInterfaceForConsommation(lookup, c);
      const parents = [
        { nom: `its consumer "${c.acteurConsommateur}"`, intervalle: vieActeur(c.acteurConsommateur) },
        ...(iface
          ? [{
              nom: `interface "${libelleInterface(iface.nomDuFlux, iface.version)}"`,
              intervalle: intervalleDeVie(model, iface),
            }]
          : []),
      ];
      contrôlerEmboitement(nommeConso(c), c, parents);
    }
  }

  for (const c of model.consommations) {
    if (c.republiePar.trim() !== "" && !estActeurTechnique(model, c.acteurConsommateur)) {
      anomalies.push(
        anomalie(`${nommeConso(c)}: says it republishes, yet "${c.acteurConsommateur}" is a business actor — only plumbing relays.`, c)
      );
    }
  }

  // Une chaîne coupée ne produit aucun lien fonctionnel. Sans ces deux lignes
  // le lien manquait EN SILENCE, ce qui est précisément ce que le contrôle du
  // bus fourre-tout, plus bas, cherche à éviter.
  for (const coupée of chainesCoupees(model, null)) {
    if (coupée.raison === "boucle") {
      anomalies.push(anomalie(`${nommeInterface(coupée.iface)}: its relay chain loops back on itself.`, coupée.iface));
    }
    // Une interface republiée que rien n'alimente : l'acteur technique l'expose,
    // mais aucune de ses consommations ne la désigne. Le lien fonctionnel
    // qu'on en attendait n'existe pas, et sans cette ligne il manquerait EN
    // SILENCE.
    if (coupée.raison === "sans-entree") {
      anomalies.push(
        anomalie(
          `${nommeInterface(coupée.iface)}: nothing feeds it — no consumption of "${coupée.iface.acteurExposant}" is republished as this interface, so the chain stops here.`,
          coupée.iface
        )
      );
    }
  }

  // Le bus fourre-tout : un flux entre dans la plomberie et n'en ressort pour
  // personne. Sans ce contrôle, le lien fonctionnel manquerait EN SILENCE, ce
  // qui est le pire des cas.
  for (const i of model.interfaces) {
    const consommateurs = consommationsForInterface(lookup, model, i).map((c) => c.acteurConsommateur);
    if (consommateurs.length === 0) continue;
    if (!consommateurs.every((c) => estActeurTechnique(model, c))) continue;
    const ressort = consommationsForInterface(lookup, model, i).some((c) => c.republiePar.trim() !== "");
    if (!ressort) {
      anomalies.push(
        anomalie(`${nommeInterface(i)}: goes into technical actors and comes back out for nobody.`, i)
      );
    }
  }

  return {
    id: "coherence",
    titre: "Coherence",
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
  criticite: VOCABULAIRE_CRITICITE,
  sens: VOCABULAIRE_DIRECTION,
  nature: VOCABULAIRE_NATURE,
};

function horsVocabulaire(valeur: string, admises: readonly string[]): boolean {
  const v = normalizeText(valeur);
  return v !== "" && !admises.some((a) => normalizeText(a) === v);
}

function checkVocabulaires(model: ParsedModel): AnomalyFamily {
  const anomalies: Anomaly[] = [];

  for (const t of model.typesFlux) {
    if (horsVocabulaire(t.sensRepresentationBrut, VOCABULAIRES.sens)) {
      anomalies.push(
        anomalie(
          `${nommeTypeFlux(t)}: direction "${t.sensRepresentationBrut}" unknown. Accepted values: ${VOCABULAIRES.sens.join(", ")}.`,
          t
        )
      );
    }
  }


  for (const t of model.typesActeur) {
    if (horsVocabulaire(t.nature, VOCABULAIRES.nature)) {
      anomalies.push(
        anomalie(`${nommeTypeActeur(t)}: nature "${t.nature}" unknown. Accepted values: ${VOCABULAIRES.nature.join(", ")}.`, t)
      );
    }
  }

  for (const c of model.consommations) {
    const où = nommeConso(c);
    if (horsVocabulaire(c.decision, VOCABULAIRES.decision)) {
      anomalies.push(anomalie(`${où}: decision "${c.decision}" unknown. Accepted values: ${VOCABULAIRES.decision.join(", ")}.`, c));
    }
    if (horsVocabulaire(c.criticite, VOCABULAIRES.criticite)) {
      anomalies.push(anomalie(`${où}: criticality "${c.criticite}" unknown. Accepted values: ${VOCABULAIRES.criticite.join(", ")}.`, c));
    }
  }

  return {
    id: "vocabulaires",
    titre: "Vocabularies",
    description: "An entered value falls outside its accepted list, and changes the drawing without saying so.",
    anomalies: parEmplacement(anomalies),
  };
}

function checkCompletude(model: ParsedModel): AnomalyFamily {
  const anomalies: Anomaly[] = [];

  for (const iface of model.interfaces) {
    if (!iface.description.trim()) {
      anomalies.push(anomalie(`${nommeInterface(iface)}: description empty.`, iface));
    }
    if (!iface.lienContrat.trim() && !iface.referenceContrat.trim()) {
      anomalies.push(anomalie(`${nommeInterface(iface)}: no contract, neither link nor reference.`, iface));
    }
  }

  for (const c of model.consommations) {
    if (!c.usage.trim()) anomalies.push(anomalie(`${nommeConso(c)}: usage not described.`, c));
    // Un palier de retrait tient lieu de décision : il dit que la consommation
    // part, et quand. Réclamer en plus un jugement demanderait deux fois la
    // même chose.
    if (!c.decision.trim() && !c.palierRetrait.trim()) {
      anomalies.push(anomalie(`${nommeConso(c)}: decision empty.`, c));
    }
  }

  for (const a of model.acteurs) {
    if (!a.groupe.trim()) {
      anomalies.push(anomalie(`${nommeActeur(a)}: group empty, so it stays out of the aggregated views until filled in.`, a));
    }
  }

  for (const t of model.typesActeur) {
    if (!t.icone.trim()) {
      anomalies.push(anomalie(`${nommeTypeActeur(t)}: icon not filled in.`, t));
    }
  }

  for (const g of model.groupes) {
    if (!g.perimetre.trim()) {
      anomalies.push(anomalie(`${nommeGroupe(g)}: perimeter not filled in.`, g));
    }
  }

  // L'arrivée sur l'axe des paliers : sans elle, on ne sait pas à partir de
  // quand la ligne compte, et aucune vue ne peut la placer dans le temps. Le
  // retrait vide, lui, n'est pas un manque : c'est un fait, la ligne est
  // encore là.
  //
  // Réclamé seulement quand l'équipe a adopté l'axe -- un classeur sans aucun
  // palier déclaré ne doit pas se mettre à parler de paliers.
  if (model.paliers.length > 0) {
    for (const a of model.acteurs) {
      if (!a.palierIntroduction.trim()) {
        anomalies.push(anomalie(`${nommeActeur(a)}: introduction milestone empty.`, a));
      }
    }
    for (const i of model.interfaces) {
      if (!i.palierIntroduction.trim()) {
        anomalies.push(anomalie(`${nommeInterface(i)}: introduction milestone empty.`, i));
      }
    }
    for (const c of model.consommations) {
      if (!c.palierIntroduction.trim()) {
        anomalies.push(
          anomalie(`${nommeConso(c)}: introduction milestone empty, so it is unknown when this consumer arrived.`, c)
        );
      }
    }
  }

  // Tant qu'aucun type ne déclare de nature, l'équipe n'a pas adopté la
  // distinction et l'outil n'en parle pas -- même règle que pour les paliers.
  const natureAdoptee = model.typesActeur.some((t) => t.nature.trim() !== "");
  if (natureAdoptee) {
    for (const t of model.typesActeur) {
      if (!t.nature.trim()) anomalies.push(anomalie(`${nommeTypeActeur(t)}: nature not filled in.`, t));
    }
  }

  return {
    id: "completude",
    titre: "Completeness",
    description: "Something is missing from the entry.",
    anomalies: parEmplacement(anomalies),
  };
}

function decommissionCandidates(model: ParsedModel): InfoBlock {
  const lookup = buildInterfaceLookup(model);
  const candidates: InterfaceCatalogue[] = [];

  for (const iface of model.interfaces) {
    const consommations = consommationsForInterface(lookup, model, iface);
    if (consommations.length === 0) continue;

    // L'état est porté par le flux : l'acteur n'en a plus.
    // Tout ce qui consomme cette interface a un palier de retrait : elle n'aura
    // plus personne. Une décision « Remove » ne compte pas ici : elle dit qu'on
    // voudrait s'en passer, pas qu'un départ est daté.
    const toutesEligibles = consommations.every((c) => c.palierRetrait.trim() !== "");

    if (toutesEligibles) candidates.push(iface);
  }
  const items = itemsSitués(candidates, (i) => `${libelleInterface(i.nomDuFlux, i.version)} ${adresse(i)}`);

  return {
    id: "decommissionnement",
    titre: "Decommissioning candidates",
    description: "Interfaces whose every consumption is scheduled to go — a call to make.",
    items,
    niveau: "action",
  };
}

// Un composant qu'aucun flux ne touche n'invalide pas les schémas : il n'y
// apparaît simplement pas. C'est un signal, pas une faute -- et un flux
// décommissionné reste un flux, donc il compte ici comme les autres.
function acteursSansFlux(model: ParsedModel): InfoBlock {
  const touchés = new Set<string>();
  for (const iface of model.interfaces) touchés.add(iface.acteurExposant.trim());
  for (const c of model.consommations) touchés.add(c.acteurConsommateur.trim());
  return {
    id: "acteurs-sans-flux",
    titre: "Components with no flow",
    description: "They appear on no diagram until some interface reaches them.",
    items: itemsSitués(model.acteurs.filter((a) => !touchés.has(a.nom.trim())), (a) => `${a.nom} ${adresse(a)}`),
    niveau: "avertissement",
  };
}

// La criticité sert à arbitrer : sans elle on ne peut pas trancher, mais le
// schéma reste juste.
function criticitesManquantes(model: ParsedModel): InfoBlock {
  return {
    id: "criticite-manquante",
    titre: "Criticality not filled in",
    description: "Consumptions whose criticality for the consumer is left empty.",
    items: itemsSitués(
      model.consommations.filter((c) => !c.criticite.trim()),
      (c) => `${c.nomDuFlux} ${adresse(c)} — ${c.acteurConsommateur}`
    ),
    niveau: "avertissement",
  };
}

// Deux composants peuvent échanger plusieurs fois par la même technologie :
// c'est légitime, mais ça vaut d'être vu, ne serait-ce que pour vérifier que ce
// ne sont pas deux saisies du même flux.
function echangesRepetes(model: ParsedModel): InfoBlock {
  const lookup = buildInterfaceLookup(model);
  const comptes = new Map<string, number>();
  for (const c of model.consommations) {
    const iface = findInterfaceForConsommation(lookup, c);
    if (!iface) continue;
    const clé = `${iface.acteurExposant.trim()} → ${c.acteurConsommateur.trim()} over ${iface.typeDeFlux.trim()}`;
    comptes.set(clé, (comptes.get(clé) ?? 0) + 1);
  }
  return {
    id: "echanges-repetes",
    titre: "Repeated exchanges",
    description: "Pairs of components linked more than once by the same technology.",
    items: [...comptes.entries()]
      .filter(([, n]) => n > 1)
      .sort(([a], [b]) => a.localeCompare(b, "fr"))
      .map(([clé, n]) => `${clé} (${n} flows)`),
    niveau: "info",
  };
}

// Qui a besoin de qui : consommer une interface, c'est dépendre de celui qui
// l'expose. Un acteur qui consomme la sienne ne compte pas -- c'est une boucle
// interne, que les vues agrégées masquent déjà, et non une dépendance entre
// composants.
function dependances(model: ParsedModel): Map<string, Set<string>> {
  const lookup = buildInterfaceLookup(model);
  const arcs = new Map<string, Set<string>>();
  for (const c of model.consommations) {
    const iface = findInterfaceForConsommation(lookup, c);
    if (!iface) continue;
    const de = c.acteurConsommateur.trim();
    const vers = iface.acteurExposant.trim();
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

  const groupes: string[] = [];
  const placés = new Set<string>();
  for (const n of candidats) {
    if (placés.has(n) || !portée.get(n)!.has(n)) continue;
    const groupe = candidats
      .filter((m) => portée.get(n)!.has(m) && portée.get(m)!.has(n))
      .sort((a, b) => a.localeCompare(b, "fr"));
    for (const m of groupe) placés.add(m);
    groupes.push(`${groupe.join(", ")} (${groupe.length} components)`);
  }

  return {
    id: "cycles",
    titre: "Dependency cycles",
    description: "Components that need one another, directly or through others — none of them stands alone.",
    items: groupes.sort((a, b) => a.localeCompare(b, "fr")),
    niveau: "info",
  };
}

// Un type déclaré que personne n'emploie : le référentiel dit plus que le parc.
function typesFluxInutilises(model: ParsedModel): InfoBlock {
  const utilisés = new Set(model.interfaces.map((i) => normalizeText(i.typeDeFlux)));
  return {
    id: "typesflux-inutilises",
    titre: "Unused flow types",
    description: "Declared in FlowTypes, but no interface uses them.",
    items: itemsSitués(model.typesFlux.filter((t) => !utilisés.has(normalizeText(t.type))), (t) => `${t.type} ${adresse(t)}`),
    niveau: "info",
  };
}

function interfacesAConfirmer(model: ParsedModel): InfoBlock {
  return {
    id: "a-confirmer",
    titre: "Interfaces to confirm",
    description: "Interfaces whose To confirm column reads Yes — to confirm or to drop.",
    items: itemsSitués(model.interfaces.filter((i) => i.aConfirmer), (i) => `${libelleInterface(i.nomDuFlux, i.version)} ${adresse(i)}`),
    niveau: "action",
  };
}

// Qui n'a pas encore bougé. Une interface à décommissionner qui porte encore
// des consommateurs est un travail en cours, pas une faute du classeur : c'est
// une décision qui attend quelqu'un, donc un bloc « action ».
function migrationsEnCours(model: ParsedModel): InfoBlock {
  const lookup = buildInterfaceLookup(model);
  const enCours: { iface: InterfaceCatalogue; texte: string }[] = [];

  for (const iface of model.interfaces) {
    if (iface.palierRetrait.trim() === "") continue;
    const restants = [...new Set(consommationsForInterface(lookup, model, iface).map((c) => c.acteurConsommateur.trim()))];
    if (restants.length === 0) continue;

    // La cible, ce sont les versions actives du MÊME flux sur le même onglet.
    // On les nomme toutes plutôt que d'en élire une : choisir à la place du
    // classeur reviendrait à inventer la destination.
    const actives = model.interfaces
      .filter(
        (autre) =>
          normalizeText(autre.nomDuFlux) === normalizeText(iface.nomDuFlux) &&
          normalizeText(autre.feuilleAttendue) === normalizeText(iface.feuilleAttendue) &&
          autre.palierRetrait.trim() === ""
      )
      .map((autre) => autre.version.trim() || "sans version");

    const vers = actives.length > 0 ? actives.join(", ") : "no active version";
    enCours.push({
      iface,
      texte: `${libelleInterface(iface.nomDuFlux, iface.version)} ${adresse(iface)} → ${vers}: ${restants.join(", ")}`,
    });
  }
  const items = itemsSitués(enCours.map((e) => ({ ...e.iface, texte: e.texte })), (e) => e.texte);

  return {
    id: "migrations",
    titre: "Migrations under way",
    description: "Interfaces on their way out that still carry consumers, and the active version to move them to.",
    items,
    niveau: "action",
  };
}

function groupesUtilises(model: ParsedModel): InfoBlock {
  const counts = new Map<string, number>();
  for (const a of model.acteurs) {
    const groupe = a.groupe.trim();
    if (!groupe) continue;
    counts.set(groupe, (counts.get(groupe) ?? 0) + 1);
  }
  const items = [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b, "fr"))
    .map(([groupe, n]) => `${groupe} (${n})`);

  return {
    id: "groupes",
    titre: "Groups in use",
    description: "Distinct groups found in Actors, with how many actors each holds.",
    items,
    niveau: "info",
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
function modeleAuPalier(model: ParsedModel, rang: number | null): ParsedModel {
  if (rang === null || model.paliers.length === 0) return model;
  const vivant = (v: { palierIntroduction: string; palierRetrait: string }) =>
    estVivant(intervalleDeVie(model, v), rang);
  // Un flux n'existe au palier que si TOUTE sa chaîne y existe : exposant,
  // interface, consommation, consommateur. C'est la règle que les schémas
  // appliquent (buildFlowInstances). Filtrer les trois tables chacune de son
  // côté gardait une consommation dont l'acteur avait disparu : le rapport
  // contredisait alors le schéma du même palier, affiché juste à côté.
  //
  // Une consommation qui ne désigne aucune interface disparaît donc aussi --
  // c'est bien une faute, mais elle relève des contrôles de référence, qui
  // jugent le classeur entier.
  const acteurs = model.acteurs.filter(vivant);
  const présents = new Set(acteurs.map((a) => a.nom.trim()));
  const interfaces = model.interfaces.filter((i) => vivant(i) && présents.has(i.acteurExposant.trim()));
  const lookup = buildInterfaceLookup({ ...model, interfaces });
  const consommations = model.consommations.filter(
    (c) =>
      vivant(c) &&
      présents.has(c.acteurConsommateur.trim()) &&
      findInterfaceForConsommation(lookup, c) !== undefined
  );
  return { ...model, acteurs, interfaces, consommations };
}

export function runIntegrityChecks(model: ParsedModel, rang: number | null = null): IntegrityReport {
  const auPalier = modeleAuPalier(model, rang);
  const familles = [
    checkStructure(model),
    checkReferences(model),
    checkVocabulaires(model),
    // La cohérence porte les contrôles temporels, qui jugent le classeur
    // entier : elle reçoit donc le modèle complet.
    checkCoherence(model),
    checkCompletude(auPalier),
  ];
  const blocsInformatifs = [
    acteursSansFlux(auPalier),
    criticitesManquantes(auPalier),
    interfacesAConfirmer(auPalier),
    migrationsEnCours(auPalier),
    decommissionCandidates(auPalier),
    echangesRepetes(auPalier),
    cyclesDeDependance(auPalier),
    typesFluxInutilises(auPalier),
    groupesUtilises(auPalier),
  ];
  const totalAnomalies = familles.reduce((sum, f) => sum + f.anomalies.length, 0);
  const total = (niveau: InfoBlock["niveau"]) =>
    blocsInformatifs.filter((b) => b.niveau === niveau).reduce((sum, b) => sum + b.items.length, 0);

  return {
    familles,
    blocsInformatifs,
    totalAnomalies,
    totalActions: total("action"),
    totalAvertissements: total("avertissement"),
  };
}
