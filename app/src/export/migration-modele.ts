import type { Consommation, ParsedModel } from "../parsing/model";
import { VERSION_MODELE } from "../parsing/build-model";
import { libelleInterface, buildInterfaceLookup, findInterfaceForConsommation } from "../aggregation/core";
import { normalizeText } from "../shared/text";
import type { DonneesClasseur } from "./template-export";

// Le point d'ancrage de tout classeur converti : « tout ceci existait déjà au
// moment de la bascule ». Il ne prétend pas dire quand chaque objet est
// réellement apparu -- cette information n'existe nulle part dans le format
// d'origine, et l'inventer produirait un historique faux.
export const PALIER_ORIGINE = "Origin";

// Ce que le format d'origine déclarait DÉJÀ retiré était parti avant la
// bascule : il
// lui faut donc un avant, sans quoi son arrivée et son retrait tomberaient sur
// le même palier -- un intervalle vide, que les contrôles signalent à juste
// titre. « Avant » n'est créé que si quelque chose l'habite.
export const PALIER_AVANT = "Before";

// Une étape par incrément de version, dans l'ordre. La chaîne est le point
// important : elle permet d'ajouter un palier de schéma sans revenir sur les
// précédents, et de mettre à niveau un classeur resté plusieurs versions en
// arrière -- un v0 traverse les deux étapes, un v1 n'emprunte que la seconde.
// Une étape transforme le MODÈLE, pas des lignes positionnelles : c'est le
// modèle qui porte le sens, et la mise à plat en colonnes vient après. Une
// étape qui manipulerait des tableaux de cellules casserait au premier
// remaniement de colonnes.
export interface EtapeMiseANiveau {
  de: number;
  vers: number;
  appliquer: (model: ParsedModel, contexte: ContexteMiseANiveau) => ParsedModel;
}

export interface ContexteMiseANiveau {
  // La date à laquelle la migration est exécutée : c'est elle que porte le
  // palier Origin. Injectée plutôt que lue de l'horloge, pour que la
  // conversion soit reproductible et testable.
  dateMigration: Date;
}

function jour(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Le palier planifié où atterrit tout ce que le format d'origine déclarait en
// partance ou à venir. Un seul, parce que c'est tout ce qu'il sait dire :
// « plus tard ». Découper ce « plus tard » demanderait une information qui
// n'existe nulle part dans le fichier.
export const PALIER_SUIVANT = "Upcoming";

const est = (valeur: string, attendu: string) => normalizeText(valeur) === normalizeText(attendu);

// Premier temps : l'axe des paliers remplace État et Statut. La conversion ne
// se contente pas d'ajouter des colonnes vides, elle traduit ce que le classeur
// disait déjà du temps. Elle lit des valeurs françaises, elle passe donc AVANT
// la traduction.
function poserLesPaliers(model: ParsedModel, contexte: ContexteMiseANiveau): ParsedModel {
  const avant = {
    nom: PALIER_AVANT,
    rang: 1,
    libelle: "Before tracking",
    statut: "Delivered",
    date: "",
    description: "What had already gone before the timeline was kept.",
  };
  const origine = {
    nom: PALIER_ORIGINE,
    rang: 2,
    libelle: "Initial state",
    statut: "Delivered",
    date: jour(contexte.dateMigration),
    description: "Everything the workbook held when it moved onto milestones.",
  };
  const suivant = {
    nom: PALIER_SUIVANT,
    rang: 3,
    libelle: "Changes already announced",
    statut: "Planned",
    date: "",
    description: "What the workbook declared as going or coming before the move.",
  };

  const bornes = (v: { palierIntroduction: string; palierRetrait: string }, retrait: string, arrivee = PALIER_ORIGINE) => ({
    palierIntroduction: v.palierIntroduction.trim() || arrivee,
    palierRetrait: v.palierRetrait.trim() || retrait,
  });

  const interfaces = model.interfaces.map((i) => {
    // Retiré : déjà parti avant la bascule, donc vivant « avant » et retiré à
    // l'origine. À décommissionner : annoncé, donc partant au palier suivant.
    const déjàParti = est(i.etat, "Retiré");
    return {
      ...i,
      ...bornes(
        i,
        déjàParti ? PALIER_ORIGINE : est(i.etat, "À décommissionner") ? PALIER_SUIVANT : "",
        déjàParti ? PALIER_AVANT : PALIER_ORIGINE
      ),
    };
  });

  // La décision n'entre pas dans l'axe : « À supprimer » dit qu'on voudrait se
  // passer de cette consommation, jamais quand elle part. Seul le statut porte
  // du temps.
  const consommations = model.consommations.map((c) => {
    const déjàPartie = est(c.statut, "Décommissionné");
    return {
      ...c,
      ...bornes(
        c,
        déjàPartie ? PALIER_ORIGINE : "",
        déjàPartie ? PALIER_AVANT : est(c.statut, "En projet") ? PALIER_SUIVANT : PALIER_ORIGINE
      ),
    };
  });

  const acteurs = model.acteurs.map((a) => ({ ...a, ...bornes(a, "") }));

  const utilise = (nom: string) =>
    [...interfaces, ...consommations, ...acteurs].some(
      (l) => l.palierIntroduction === nom || l.palierRetrait === nom
    );

  return {
    ...model,
    // Un classeur qui déclarait déjà des paliers garde les siens.
    // Les rangs se posent APRÈS avoir su quels paliers existent : « Avant »
    // n'est créé que s'il sert, et laisser un trou de rang 1 donnerait une
    // numérotation qui commence à 2 sans que rien ne l'explique.
    paliers:
      model.paliers.length > 0
        ? model.paliers
        : [...(utilise(PALIER_AVANT) ? [avant] : []), origine, ...(utilise(PALIER_SUIVANT) ? [suivant] : [])].map(
            // Ces paliers n'existaient pas dans le classeur d'origine : leur
            // emplacement est celui qu'ils auront à l'écriture, en-tête compris.
            (p, i) => ({ ...p, rang: i + 1, feuille: "Milestones", ligne: i + 2 })
          ),
    acteurs,
    interfaces,
    consommations,
  };
}

// Second temps : le classeur passe en anglais. Les noms de feuilles et de
// colonnes sont portés par l'écriture, qui les produit déjà en anglais ; ce qui
// reste à traduire, ce sont les VALEURS déjà saisies. Une valeur qu'on ne
// reconnaît pas est laissée telle quelle : c'est peut-être un terme propre à
// l'équipe, et le contrôle de vocabulaire la signalera plutôt qu'on l'écrase.
const VALEURS_TRADUITES: Record<string, string> = {
  Plateforme: "Platform",
  Externe: "External",
  "À conserver": "Keep",
  "À creuser": "Investigate",
  "À transformer": "Transform",
  "À supprimer": "Remove",
  "1 - Vitale": "1 - Critical",
  "2 - Importante": "2 - Important",
  "3 - Standard": "3 - Standard",
  Oui: "Yes",
  Non: "No",
  "exposant → consommateur": "provider → consumer",
  "consommateur → exposant": "consumer → provider",
};

function traduire(valeur: string): string {
  const v = normalizeText(valeur);
  const trouvée = Object.entries(VALEURS_TRADUITES).find(([fr]) => normalizeText(fr) === v);
  return trouvée ? trouvée[1] : valeur;
}

function traduireLesValeurs(model: ParsedModel): ParsedModel {
  // Les paliers ne sont pas traduits : le format d'origine n'en a aucun, et
  // ceux que la conversion vient de poser sont déjà en anglais.
  return {
    ...model,
    groupes: model.groupes.map((g) => ({ ...g, perimetre: traduire(g.perimetre) })),
    typesFlux: model.typesFlux.map((t) => ({ ...t, sensRepresentationBrut: traduire(t.sensRepresentationBrut) })),
    consommations: model.consommations.map((c) => ({
      ...c,
      criticite: traduire(c.criticite),
      decision: traduire(c.decision),
    })),
  };
}

// Un classeur d'origine peut n'avoir aucun onglet de groupes : la colonne
// « Groupe » de ses acteurs porte alors seule l'information. La reconstruction
// écrivait model.groupes tel quel -- vide -- et les groupes disparaissaient,
// laissant autant d'acteurs renvoyer à un groupe inexistant. Sur un classeur
// réel, dix-neuf groupes perdus d'un coup.
//
// Le périmètre, lui, ne se déduit de rien : il reste vide et la complétude le
// réclame. L'inventer rendrait un classeur d'apparence complète et faux.
function déduireLesGroupes(model: ParsedModel): ParsedModel {
  if (!model.groupesAbsents) return model;
  const noms = [...new Set(model.acteurs.map((a) => a.groupe.trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "fr")
  );
  return {
    ...model,
    groupesAbsents: false,
    groupes: noms.map((nom, i) => ({ nom, perimetre: "", feuille: "Groups", ligne: i })),
  };
}

export const ETAPES_MISE_A_NIVEAU: EtapeMiseANiveau[] = [
  // Un seul format a jamais circulé : celui d'avant le versionnement. Tout ce
  // qu'il faut lui faire tient en une étape -- poser les paliers, puis
  // traduire -- et l'ordre des deux temps compte, le premier lisant du
  // français. Les colonnes nouvelles (version d'interface, bornes de validité)
  // arrivent vides : la reconstruction les produit ainsi, rien à transformer.
  {
    de: 0,
    vers: 1,
    appliquer: (model, contexte) => traduireLesValeurs(poserLesPaliers(déduireLesGroupes(model), contexte)),
  },
  // Le v1 est parti en production avec des formules qui citaient l'onglet
  // « Listes », renommé « Lists » à la traduction. Excel n'y voyait pas une
  // faute mais un renvoi vers un AUTRE CLASSEUR : avertissement de liaisons
  // externes à chaque ouverture, et listes déroulantes dépendantes muettes.
  //
  // Le modèle, lui, n'a rien à corriger : les formules ne s'y trouvent pas,
  // elles naissent à l'écriture. Cette étape ne transforme donc rien -- elle
  // existe pour que les classeurs déjà distribués soient reconnus comme
  // périmés et repassent par la reconstruction, qui les écrit correctement.
  // L'onglet Milestones y gagne au passage le tableau structuré qui lui
  // manquait.
  { de: 1, vers: 2, appliquer: (model) => model },
  // Les deux colonnes de la lecture fonctionnelle -- nature du type d'acteur,
  // relais d'interface -- changent la forme du classeur. Le modèle, lui, n'a
  // rien à convertir : elles arrivent vides, et la reconstruction les produit
  // ainsi. L'étape existe pour que les classeurs en circulation soient
  // reconnus comme périmés et repassent par l'écriture.
  { de: 2, vers: 3, appliquer: (model) => model },
  // La lecture fonctionnelle change de porteur. En v3, la ligne d'INTERFACE
  // nommait ses sources dans une colonne Relays ; en v4 c'est la ligne de
  // CONSOMMATION qui dit sous laquelle des interfaces de son consommateur elle
  // ressort. Le sens de lecture n'est pas un détail : la consommation sait de
  // quel fournisseur et de quelle version vient l'entrée -- un nom de flux seul
  // ne le savait pas --, et une valeur par ligne se guide par une liste
  // déroulante, ce qu'une case à plusieurs noms ne permettait pas.
  { de: 3, vers: 4, appliquer: (model) => deplacerLesRelais(model) },
];

// Chaque relais de la v3 retrouve la consommation qu'il désignait : celle du
// relayeur qui porte ce nom de flux. Ce qui ne se retrouve pas est laissé tel
// quel plutôt qu'inventé -- le contrôle d'intégrité le réclamera, ce qui vaut
// mieux qu'un lien fabriqué.
function deplacerLesRelais(model: ParsedModel): ParsedModel {
  const republications = new Map<Consommation, string>();
  for (const iface of model.interfaces) {
    for (const cible of iface.relais.split(";").map((c) => c.trim()).filter(Boolean)) {
      const entrée = model.consommations.find(
        (c) =>
          c.acteurConsommateur.trim() === iface.acteurExposant.trim() &&
          normalizeText(c.nomDuFlux) === normalizeText(cible) &&
          !republications.has(c)
      );
      if (entrée) republications.set(entrée, libelleInterface(iface.nomDuFlux, iface.version));
    }
  }
  if (republications.size === 0) return model;
  return {
    ...model,
    consommations: model.consommations.map((c) => ({ ...c, republiePar: republications.get(c) ?? c.republiePar })),
  };
}

// Le classeur parle anglais depuis le schéma v3, listes déroulantes comprises.
// Une valeur écrite en français n'appartient pas au vocabulaire que le même
// classeur pose sur la colonne : Excel refuse la cellule qu'il vient d'écrire.
const oui = (v: boolean) => (v ? "Yes" : "No");

// Le modèle relu, remis à plat dans l'ordre des colonnes du classeur. C'est
// une reconstruction : ce que le parseur n'a pas compris n'y est pas.
export function donneesDepuisModele(model: ParsedModel): DonneesClasseur {
  const lookup = buildInterfaceLookup(model);
  const parOnglet = new Map<string, string[][]>();
  // Excel ne distingue pas deux feuilles dont les noms ne diffèrent que par la
  // casse : il refuse d'ouvrir le classeur ENTIER, sans rien dire de la feuille
  // fautive. On range donc sous l'orthographe déjà retenue -- celle que les
  // interfaces posent en premier, qui est le nom reconstruit.
  const ongletExistant = (nom: string) =>
    [...parOnglet.keys()].find((k) => k.toLowerCase() === nom.toLowerCase()) ?? nom;

  for (const i of model.interfaces) {
    const onglet = ongletExistant(i.feuilleAttendue);
    if (!parOnglet.has(onglet)) parOnglet.set(onglet, []);
  }
  for (const c of model.consommations) {
    // Une consommation va dans l'onglet de l'interface à laquelle elle est
    // RATTACHÉE, pas dans celui dont on l'a lue. Les deux noms diffèrent dès
    // qu'un classeur tenu à la main écrit « FX_TATOOINE_HTTP » : le parseur les
    // rapproche, mais l'écriture rangeait l'interface sous le nom reconstruit
    // et la consommation sous l'ancien -- un onglet en ressortait en deux, un
    // neuf et vide, et l'ancien devenu orphelin.
    //
    // Faute de rattachement, on garde l'onglet d'origine : déplacer d'autorité
    // une ligne qui ne désigne rien la perdrait.
    const iface = findInterfaceForConsommation(lookup, c);
    const onglet = ongletExistant(iface ? iface.feuilleAttendue : c.feuille);
    const lignes = parOnglet.get(onglet) ?? [];
    lignes.push([
      c.nomDuFlux, c.version, c.acteurConsommateur, c.usage, c.criticite,
      c.decision, c.commentaires, c.republiePar, c.palierIntroduction, c.palierRetrait,
    ]);
    parOnglet.set(onglet, lignes);
  }

  return {
    // Les référentiels du classeur sont repris tels quels : les remplacer par
    // l'amorce effacerait les types déclarés par l'équipe.
    typesFlux: model.typesFlux.map((t) => [t.type, t.sensRepresentationBrut, t.description]),
    typesActeur: model.typesActeur.map((t) => [t.type, t.icone, t.nature]),
    paliers: model.paliers.map((p) => [p.nom, String(p.rang), p.libelle, p.statut, p.date, p.description]),
    groupes: model.groupes.map((g) => [g.nom, g.perimetre]),
    acteurs: model.acteurs.map((a) => [
      a.nom, a.groupe, a.typeActeur, a.responsable, a.description, a.commentaires,
      a.palierIntroduction, a.palierRetrait,
    ]),
    interfaces: model.interfaces.map((i) => [
      i.nomDuFlux,
      i.version,
      i.acteurExposant,
      i.typeDeFlux,
      i.description,
      i.lienContrat,
      i.referenceContrat,
      i.commentaires,
      oui(i.aConfirmer),
      i.palierIntroduction,
      i.palierRetrait,
    ]),
    // Tout onglet attendu par une interface existe dans le classeur produit,
    // fût-il vide. C'est ce qui remplace la macro : on ne génère plus les
    // onglets manquants depuis Excel, on rend un fichier où il n'en manque pas.
    // Un nom qu'Excel refuse est écarté -- le contrôle d'intégrité le signale
    // déjà, et fabriquer un classeur illisible n'aiderait personne.
    fx: [...parOnglet.entries()].map(([nom, lignes]) => ({ nom, lignes })),
  };
}

export function mettreANiveau(model: ParsedModel, dateMigration: Date = new Date()): DonneesClasseur {
  // Un classeur plus récent que l'outil ne traverse aucune étape et ressortirait
  // étiqueté à la version de l'outil : une rétrogradation silencieuse, qui perd
  // tout ce que ce parseur-là ne sait pas encore lire. Mieux vaut refuser et le
  // dire que rendre un fichier appauvri qui a l'air correct.
  if (model.versionModele > VERSION_MODELE) {
    throw new Error(
      `This workbook is newer than the tool (schema ${model.versionModele}, tool ${VERSION_MODELE}). Update the tool rather than downgrade the file.`
    );
  }

  const contexte: ContexteMiseANiveau = { dateMigration };
  let courant = model;
  for (const étape of ETAPES_MISE_A_NIVEAU) {
    if (étape.de < model.versionModele) continue;
    if (étape.vers > VERSION_MODELE) break;
    courant = étape.appliquer(courant, contexte);
  }
  return donneesDepuisModele(courant);
}
