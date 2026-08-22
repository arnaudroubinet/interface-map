import type { ParsedModel } from "../parsing/model";
import { interfaceLabel, type GraphEdge, type Mode } from "./core";
import { flowsForReading, reading as lectureDuMode } from "./reading";
import { buildPlatformDetailView, type ViewResult } from "./views";
import { lifespanOf, isLiveAt } from "./milestones";

// L'écart entre deux paliers, entièrement CALCULÉ : rien de tout ceci n'est
// saisi quelque part, donc rien ne peut se contredire. C'est la différence
// entre deux photos que le classeur sait déjà produire.
export interface Ecarts {
  actors: Difference;
  interfaces: Difference;
  consumptions: Difference;
}

export interface Difference {
  ajoutes: string[];
  retires: string[];
}

function difference(avant: Set<string>, after: Set<string>): Difference {
  const parNom = (a: string, b: string) => a.localeCompare(b, "fr");
  return {
    ajoutes: [...after].filter((x) => !avant.has(x)).sort(parNom),
    retires: [...avant].filter((x) => !after.has(x)).sort(parNom),
  };
}

function liveActors(model: ParsedModel, rank: number): Set<string> {
  return new Set(
    model.actors.filter((a) => isLiveAt(lifespanOf(model, a), rank)).map((a) => a.name.trim())
  );
}

function interfacesVivantes(model: ParsedModel, rank: number): Set<string> {
  return new Set(
    model.interfaces
      .filter((i) => isLiveAt(lifespanOf(model, i), rank))
      .map((i) => interfaceLabel(i.flowName, i.version))
  );
}

// Une consommation se nomme par le couple qu'elle crée : c'est ce qu'on lit
// sur le schéma, et c'est ce qui parle en réunion.
function consommationsVivantes(model: ParsedModel, rank: number, mode: Mode): Set<string> {
  return new Set(
    flowsForReading(model, rank, mode).map(
      (f) => `${f.consumer} → ${interfaceLabel(f.interfaceName, f.version)}`
    )
  );
}

export function calculerEcarts(model: ParsedModel, rangAvant: number, rangApres: number, mode: Mode): Ecarts {
  return {
    actors: difference(liveActors(model, rangAvant), liveActors(model, rangApres)),
    interfaces: difference(interfacesVivantes(model, rangAvant), interfacesVivantes(model, rangApres)),
    consumptions: difference(consommationsVivantes(model, rangAvant, mode), consommationsVivantes(model, rangApres, mode)),
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
  const options = { counters: true };
  const avant = buildPlatformDetailView(model, lectureDuMode(model, rangAvant, mode), options);
  const apres = buildPlatformDetailView(model, lectureDuMode(model, rangApres, mode), options);

  // Un lien porte le DELTA de son volume, pas son volume : c'est ce qui a
  // changé qui est le sujet. Sans ça, un lien passant de six à quatre flux
  // restait un trait ordinaire, et le seul cas que le schéma devait rendre
  // visible ne l'était pas.
  const key = (e: GraphEdge) => JSON.stringify([e.from, e.to, e.technology]);
  const parCle = (r: ViewResult) => new Map(r.edges.map((e) => [key(e), e]));
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
      ecart: delta > 0 ? "added" : "removed",
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
  const frontiere = connus.find((n) => n.kind === "boundary");
  return { nodes: frontiere ? [frontiere, ...retenus] : retenus, edges };
}
