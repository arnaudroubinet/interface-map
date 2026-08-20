import type { ParsedModel } from "../parsing/model";
import { libelleInterface, type GraphEdge, type Mode } from "./core";
import { fluxDuMode, lecture as lectureDuMode } from "./fonctionnel";
import { buildPlatformDetailView, type ViewResult } from "./views";
import { intervalleDeVie, estVivant } from "./paliers";

// L'écart entre deux paliers, entièrement CALCULÉ : rien de tout ceci n'est
// saisi quelque part, donc rien ne peut se contredire. C'est la différence
// entre deux photos que le classeur sait déjà produire.
export interface Ecarts {
  acteurs: Difference;
  interfaces: Difference;
  consommations: Difference;
}

export interface Difference {
  ajoutes: string[];
  retires: string[];
}

function différence(avant: Set<string>, après: Set<string>): Difference {
  const parNom = (a: string, b: string) => a.localeCompare(b, "fr");
  return {
    ajoutes: [...après].filter((x) => !avant.has(x)).sort(parNom),
    retires: [...avant].filter((x) => !après.has(x)).sort(parNom),
  };
}

function acteursVivants(model: ParsedModel, rang: number): Set<string> {
  return new Set(
    model.acteurs.filter((a) => estVivant(intervalleDeVie(model, a), rang)).map((a) => a.nom.trim())
  );
}

function interfacesVivantes(model: ParsedModel, rang: number): Set<string> {
  return new Set(
    model.interfaces
      .filter((i) => estVivant(intervalleDeVie(model, i), rang))
      .map((i) => libelleInterface(i.nomDuFlux, i.version))
  );
}

// Une consommation se nomme par le couple qu'elle crée : c'est ce qu'on lit
// sur le schéma, et c'est ce qui parle en réunion.
function consommationsVivantes(model: ParsedModel, rang: number, mode: Mode): Set<string> {
  return new Set(
    fluxDuMode(model, rang, mode).map(
      (f) => `${f.consommateur} → ${libelleInterface(f.interfaceNom, f.version)}`
    )
  );
}

export function calculerEcarts(model: ParsedModel, rangAvant: number, rangApres: number, mode: Mode): Ecarts {
  return {
    acteurs: différence(acteursVivants(model, rangAvant), acteursVivants(model, rangApres)),
    interfaces: différence(interfacesVivantes(model, rangAvant), interfacesVivantes(model, rangApres)),
    consommations: différence(consommationsVivantes(model, rangAvant, mode), consommationsVivantes(model, rangApres, mode)),
  };
}

// Le schéma de l'écart : le paysage du palier d'arrivée, plus ce qui vient
// d'en disparaître. Un trait présent des deux côtés se dessine normalement ;
// les autres portent leur marque, et le rendu les distingue.
//
// Base « plateforme détaillée », sans choix de granularité : on veut savoir
// QUEL composant a gagné ou perdu un flux, pas seulement quel groupe, tout en
// gardant l'extérieur replié. Un sélecteur de plus sur une vue de comparaison
// rendrait la lecture plus lourde qu'utile.
export function buildEcartsView(model: ParsedModel, rangAvant: number, rangApres: number, mode: Mode): ViewResult {
  const options = { compteurs: true };
  const avant = buildPlatformDetailView(model, lectureDuMode(model, rangAvant, mode), options);
  const apres = buildPlatformDetailView(model, lectureDuMode(model, rangApres, mode), options);

  // Un lien porte le DELTA de son volume, pas son volume : c'est ce qui a
  // changé qui est le sujet. Sans ça, un lien passant de six à quatre flux
  // restait un trait ordinaire, et le seul cas que le schéma devait rendre
  // visible ne l'était pas.
  const cle = (e: GraphEdge) => JSON.stringify([e.from, e.to, e.technologie]);
  const parCle = (r: ViewResult) => new Map(r.edges.map((e) => [cle(e), e]));
  const avantParCle = parCle(avant);
  const apresParCle = parCle(apres);

  const edges: GraphEdge[] = [];
  for (const k of new Set([...apresParCle.keys(), ...avantParCle.keys()])) {
    const a = avantParCle.get(k);
    const b = apresParCle.get(k);
    const delta = (b?.count ?? 0) - (a?.count ?? 0);
    // Le lien se dessine tel qu'il est à l'arrivée quand il y survit, sinon
    // tel qu'il était : dans les deux cas il faut bien un trait à colorier.
    const base = b ?? a!;
    // Un lien inchangé n'a rien à faire ici : le schéma ne montre QUE l'écart.
    // Mêler le décor aux quelques traits qui portent l'information les noierait.
    if (delta === 0) continue;
    edges.push({
      ...base,
      ecart: delta > 0 ? "ajout" : "retrait",
      // Le signe et le nombre seuls : la technologie s'affiche d'elle-même en
      // sous-libellé, puisque le libellé ne la nomme pas (sousLibellé).
      label: `${delta > 0 ? "+" : "−"}${Math.abs(delta)}`,
    });
  }

  // Seulement les nœuds que les traits restants accostent, pris des deux côtés
  // -- un lien retiré a besoin de boîtes qui n'existent peut-être plus après.
  const connus = [...apres.nodes, ...avant.nodes].filter(
    (n, i, tous) => tous.findIndex((autre) => autre.id === n.id) === i
  );
  const requis = new Set(edges.flatMap((e) => [e.from, e.to]));
  const retenus = connus.filter((n) => requis.has(n.id));

  // La frontière de la plateforme est un nœud PARENT : aucun trait ne
  // l'accoste, donc l'élagage l'emporterait en laissant ses enfants pointer
  // vers un conteneur absent. On la rétablit quand elle contient encore de
  // quoi cadrer, et on coupe le lien de parenté sinon -- même règle qu'ailleurs
  // : sous deux composants, un cadre n'apporte rien.
  const dedans = retenus.filter((n) => n.parent !== undefined);
  if (dedans.length < 2) {
    return { nodes: retenus.map((n) => ({ ...n, parent: undefined })), edges };
  }
  const frontiere = connus.find((n) => n.kind === "frontiere");
  return { nodes: frontiere ? [frontiere, ...retenus] : retenus, edges };
}
