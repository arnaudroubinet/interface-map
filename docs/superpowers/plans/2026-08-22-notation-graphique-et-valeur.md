# Notation graphique, lisibilité et ajouts de valeur — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** rendre chaque schéma produit par Interface Map auto-descriptif, lisible et accessible, stabiliser sa géométrie dans le temps, enrichir les trois exports de leur notation, puis ajouter les sept vues et lectures que les données du classeur permettent déjà.

**Architecture :** l'essentiel se joue dans `render/` (le SVG se décrit lui-même : cartouche, légende complète, contrastes, formes redondantes) et dans `layout/graph-layout.ts` (mode interactif d'ELK pour que les boîtes cessent de sauter d'un palier à l'autre). Deux modules de données naissent pour être partagés entre l'écran et les exports — `render/legende.ts` (les entrées de légende comme données) et `render/cartouche.ts` (le contexte d'un schéma) — parce que draw.io doit dessiner la même légende que le SVG. Les ajouts de valeur réutilisent des traversées déjà écrites : `remonter()` pour la vue Chaîne, `atteignables()` pour le rayon d'impact.

**Tech Stack :** TypeScript strict, esbuild (bundle mono-fichier), vitest + jsdom, elkjs 0.9 dans un Web Worker, SheetJS (`xlsx`), DOM à la main (aucun framework UI).

**Spec :** `.superpowers/notes/rapport-graphisme-c4.md` — la revue graphique/C4/cartographie dont ce plan est l'exécution. Les numéros §2.x, P1–P14 et A1–A7 employés ici renvoient à ses sections.

## Global Constraints

Ces contraintes lient **toutes** les tâches. Aucune ne se négocie tâche par tâche.

- **Livrable mono-fichier.** `npm run build` doit continuer à produire un unique `app/dist/interface-map.html` autonome, ouvrable en `file://`, sans réseau ni CDN. Toute dépendance nouvelle est inlinée : son poids compte, le bundle fait déjà ~2,19 Mo. **N'ajouter aucune dépendance npm sans mesurer le delta de poids et le mentionner dans le message de commit.**
- **Pas de backend, pas de framework UI.** Le DOM se construit à la main, comme partout dans `src/ui/` et `src/render/`.
- **`npx tsc --noEmit` doit rester propre** et `npx vitest run` doit rester vert à la fin de **chaque** tâche. Point de départ : 661 tests, 37 fichiers.
- **L'interface parle anglais ; les commentaires de code parlent français.** Tout texte visible par l'utilisateur (libellé de bouton, message, entrée de légende, titre de vue, contenu d'un fichier exporté) s'écrit en anglais. Les commentaires expliquent *pourquoi*, jamais *quoi*.
- **Messages de commit en anglais, style *conventional commits*** (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`). **Jamais** de `Co-Authored-By` ni de mention d'un assistant.
- **Aucune opération git sans accord explicite de l'utilisateur** au-delà de `git add` / `git commit` prescrits par les étapes. Ne jamais pousser, ne jamais forcer.
- **La convention de flèche ne change pas :** le TRAIT suit la donnée, du fournisseur vers le consommateur ; la POINTE dit qui appelle — `marker-end` pour un flux poussé (`exposant-consommateur`), `marker-start` pour un flux tiré (`consommateur-exposant`). Toute vue, toute matrice, tout export s'y conforme.
- **Une technologie doit être déclarée au référentiel** (`FlowTypes`). Une technologie employée sans y figurer n'est ni dessinée ni colorée ; c'est une règle non discutable du produit.
- **Ne pas ajouter de commentaires, docstrings ou annotations de type à du code qu'on ne modifie pas.**
- **Vérifier dans Chrome, pas seulement par vitest.** Le rendu est le produit. Recette : `npm run build` dans `app/`, servir la racine du dépôt (`npx http-server -p 8899 -c-1 .`), ouvrir `http://127.0.0.1:8899/app/dist/interface-map.html`. Le chargement d'un classeur ne passe **que** par le glisser-déposer :
  ```js
  const buf = await fetch("/Exemples/exemple.xlsx").then(r => r.arrayBuffer());
  const f = new File([buf], "exemple.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const dt = new DataTransfer(); dt.items.add(f);
  document.querySelector(".cible-depot").dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
  ```
  Le classeur d'exemple se régénère depuis `DONNEES_EXEMPLE` (`src/export/exemple-donnees.ts`) via `écrireModele`. Les captures d'écran expirent souvent sur ce projet : **mesurer dans le DOM** plutôt que regarder.
- **Un test qui ne meurt pas quand on casse le code qu'il prétend couvrir ne vaut rien.** Après chaque tâche, muter la ligne clé (inverser une condition, supprimer un `push`) et vérifier que le test rougit, puis restaurer. **Commiter avant de muter** — un `git checkout --` sur du travail non commité l'efface sans un mot ; c'est arrivé deux fois sur ce dépôt.
- **Ne jamais coder une information par la seule couleur** (WCAG 1.4.1, technique G111 : « ensure that when color differences are used to convey information within non-text content, patterns are included to convey the same information in a manner that does not depend on color » — <https://www.w3.org/WAI/WCAG22/Techniques/general/G111>).
- **Seuil de contraste : 4,5:1** pour tout texte sous 18 pt, **3:1** pour un trait ou une bordure porteuse de sens (WCAG 1.4.3 et 1.4.11).

---

## Structure de fichiers

**Fichiers créés**

| Fichier | Responsabilité |
|---|---|
| `app/src/render/legende.ts` | Les entrées de légende **comme données** (`EntreeLegende[]`), calculées depuis un `LayoutResult`. Partagé par le SVG et par draw.io, pour qu'un même schéma ne puisse pas avoir deux légendes. |
| `app/src/render/cartouche.ts` | Le `ContexteSchema` (titre, lecture, palier, source, date, comptes) et son dessin SVG, plus les attributs d'accessibilité de la racine. |
| `app/src/render/zoom.ts` | Le `viewBox` piloté : ajuster, zoomer, déplacer. Aucune dépendance. |
| `app/src/aggregation/seriation.ts` | Les ordres de la matrice : alphabétique, par groupe, par degré, RCM. Fonctions pures sur une liste d'identifiants et une fonction d'adjacence. |
| `app/src/aggregation/chaine.ts` | La vue Chaîne (A1) : d'un flux fonctionnel vers la suite de ses maillons. |
| `app/src/aggregation/impact.ts` | Le rayon d'impact (A2) : amont/aval transitifs et distance en sauts. |
| `app/src/aggregation/frise.ts` | La frise des paliers (A4) : un segment `[introduction, retrait[` par ligne du classeur. |
| `app/src/render/frise.ts` | Le dessin de la frise (A4), sans ELK : une grille, pas un graphe. |
| `app/src/export/pdf-export.ts` | L'assemblage DOM d'un document paginé pour `window.print()` (A7). |

**Fichiers modifiés en profondeur**

| Fichier | Ce qui change |
|---|---|
| `app/src/render/svg-builder.ts` (786 l.) | Cartouche, légende étendue, contrastes, formes, infobulles, `viewBox` seul. **Ce fichier ne doit pas dépasser ~900 lignes** : la légende et le cartouche en sortent (voir fichiers créés). |
| `app/src/layout/graph-layout.ts` (634 l.) | Mode interactif d'ELK, ordre d'entrée stable, options de rapport de forme. |
| `app/src/aggregation/views.ts` (391 l.) | Ordre de la matrice, profondeur de la vue par acteur, criticité sur les arêtes. |
| `app/src/export/c4-dsl.ts`, `likec4-dsl.ts`, `drawio-export.ts` | Titres, styles, notation, légende. |
| `app/src/ui/rail.ts`, `state.ts`, `banner.ts`, `app.ts` | Les réglages nouveaux et leur câblage. |
| `app/index.html` | Feuille de style d'impression, CSS du SVG ajusté. |

---

## Ordre d'exécution et dépendances

```
Phase 1 — La notation (le schéma se décrit lui-même)
  T1  legende.ts (refactor)  ──┬──> T2 (P2 légende complète)
                               └──> T22 (P11 draw.io)
  T3  cartouche.ts (P1)  ─────────> T22, T30 (A5)
  T4→T6  contrastes (P4)
  T7→T8  ce qui circule (P3)
  T9  formes (P8)

Phase 2 — La géométrie
  T10 ordre d'entrée stable ──> T11 (P5 interactif) ──> T12 (P5 union, conditionnel)
  T13→T15 ajustement et rapport de forme (P7)
  T16 garde-fou d'échelle (P13)

Phase 3 — La matrice
  T17 ordres simples + sémantique du tableau (P6) ──> T18 (RCM) ──> T19 (Excel)

Phase 4 — Les exports
  T20 (P9)   T21 (P10)   T22 (P11, dépend de T1 et T3)   T23 (P12)

Phase 5 — Le vocabulaire
  T24 (P14 a) ──> T25 (P14 b)

Phase 6 — Les ajouts de valeur
  T26 (A1) ──> enrichit T20/T21 en vues dynamiques
  T27 (A2)   T28 (A3)   T29 (A4)   T30 (A5, dépend de T3)   T31 (A6)   T32 (A7, dépend de T23)
```

**Une tâche = un commit.** Ne jamais dispatcher deux tâches d'implémentation en parallèle : elles se marchent dessus dans `svg-builder.ts`.

---

## Ce que la recherche a établi, et qui corrige le rapport

Ces cinq points ont été vérifiés à la source pendant la rédaction de ce plan. **Ils priment sur le texte du rapport.**

1. **ELK : le mode interactif lit les coordonnées `x`/`y` posées sur les nœuds d'ENTRÉE.** `InteractiveLayerer` lit `node.getPosition().x` pour décider les rangs ; `InteractiveCycleBreaker` et `InteractiveCrossingMinimizer` lisent `node.getInteractiveReferencePoint().x` et `.y`. `interactiveReferencePoint` (défaut `CENTER`, autre valeur `TOP_LEFT`) choisit quel point du nœud est lu, et il **ne prend effet que si `cycleBreaking.strategy` ou `crossingMinimization.strategy` vaut `INTERACTIVE`** (<https://eclipse.dev/elk/reference/options/org-eclipse-elk-layered-interactiveReferencePoint.html>).
2. **`crossingMinimization.semiInteractive` n'est PAS l'option qu'il nous faut.** Elle « derives the desired order from positions specified by the `org.eclipse.elk.position` layout option » et « requires the crossing minimization strategy to be set to `LAYER_SWEEP` ». Nous avons les coordonnées complètes du tour précédent : `crossingMinimization.strategy: INTERACTIVE` est la bonne porte. Le billet de l'équipe ELK (<https://eclipse.dev/elk/blog/posts/2023/23-01-09-constraining-the-model.html>) recommande `semiInteractive` parce qu'il s'adresse à un cas différent — des contraintes posées à la main dans un éditeur.
3. **`elk.position` est un `KVector`** (un couple de coordonnées destiné à l'algorithme *Fixed Layout*), et non un rang ordinal — contrairement à ce que son nom laisse croire.
4. **Structurizr : le second argument positionnel d'une vue est sa DESCRIPTION, pas son titre.** La grammaire est `systemLandscape [key] [description] { … }` ; le titre s'écrit avec l'instruction `title <title>` **à l'intérieur** du bloc (<https://docs.structurizr.com/dsl/language>). Le point 1 de P9 est donc à corriger.
5. **LikeC4 : les types de pointe autorisés sont `normal, onormal, diamond, odiamond, crow, vee, open, none`**, avec `head` valant `normal` et `tail` valant `none` par défaut, et **le style de trait par défaut est `dashed`** — il faut donc écrire `line solid` explicitement, sinon tous nos traits sortent en pointillé et la distinction « décision Transform » disparaît (<https://likec4.dev/dsl/styling/>).

Deux points du rapport ont par ailleurs été **confirmés** par le calcul et n'appellent aucune correction : les ratios de contraste (§2.5) sont exacts au centième près, et `elk.aspectRatio` vaut bien déjà `1.6` par défaut sous `layered`.

---

# Phase 1 — La notation : le schéma se décrit lui-même

### Task 1: Extraire la légende en données (`render/styles-noeud.ts` + `render/legende.ts`)

Refactor pur, **sans changement visible** : la légende sort de `svg-builder.ts` sous forme de données, pour que la tâche 2 l'étende et que la tâche 22 la redessine en draw.io. Deux légendes divergentes pour un même schéma est exactement ce qu'on veut rendre impossible.

**Files:**
- Create: `app/src/render/styles-noeud.ts`
- Create: `app/src/render/legende.ts`
- Create: `app/src/render/legende.test.ts`
- Modify: `app/src/render/svg-builder.ts:22-26` (constantes), `:258-262` (`COULEUR_ECART`), `:323-350` (`StyleNoeud`/`styleDuNoeud`), `:593-672` (légende), `:684-700` et `:770-783` (appel)
- Test: `app/src/render/legende.test.ts`, `app/src/render/svg-builder.test.ts` (doit rester vert sans modification)

**Interfaces:**
- Produces: `styles-noeud.ts` exporte `PAPIER: string`, `ENCRE: string`, `ÉPAISSEUR_TRAIT: number`, `COULEUR_ECART: Record<"ajout"|"retrait", string>`, `interface StyleNoeud { fond: string; bord: string; texteClair: boolean; épaisseurBord: number }`, `styleDuNoeud(node: Pick<LayoutNode, "kind" | "externe">): StyleNoeud`.
- Produces: `legende.ts` exporte `type ÉchantillonLegende`, `interface EntreeLegende`, `interface ArêteLegendable`, `entreesDeLegende(edges, nodes, colorFor): EntreeLegende[]`.
- Consumes: `LayoutNode` depuis `../layout/graph-layout`.

- [ ] **Step 1: Écrire le test qui échoue**

Créer `app/src/render/legende.test.ts` :

```ts
import { describe, it, expect } from "vitest";
import { entreesDeLegende } from "./legende";
import type { LayoutNode } from "../layout/graph-layout";

const noeud = (o: Partial<LayoutNode> = {}): LayoutNode =>
  ({ id: "A", label: "A", kind: "acteur", externe: false, x: 0, y: 0, width: 240, height: 120, ...o }) as LayoutNode;

describe("entreesDeLegende", () => {
  it("énumère une entrée par technologie dessinée, dans l'ordre alphabétique", () => {
    const entrées = entreesDeLegende(
      [{ technologie: "SFTP" }, { technologie: "HTTP" }, { technologie: "HTTP" }],
      [noeud()],
      () => "#111111"
    );
    expect(entrées.map((e) => e.texte)).toEqual(["HTTP", "SFTP"]);
  });

  // Le mode fonctionnel vide `technologie` sur toutes ses arêtes : une entrée
  // sans nom annoncerait un code couleur introuvable sur le dessin.
  it("ignore une technologie vide", () => {
    expect(entreesDeLegende([{ technologie: "" }], [noeud()], () => "#111111")).toEqual([]);
  });

  // Un trait marqué d'un écart ne porte plus la couleur de sa technologie.
  it("annonce les écarts et tait les technologies quand le schéma est un écart", () => {
    const entrées = entreesDeLegende(
      [{ technologie: "HTTP", ecart: "ajout" }, { technologie: "SFTP", ecart: "retrait" }],
      [noeud()],
      () => "#111111"
    );
    expect(entrées.map((e) => e.texte)).toEqual(["+n : flows added", "−n : flows removed"]);
  });

  // Les deux périmètres ne s'annoncent que si les deux sont dessinés : sur une
  // planche entièrement interne, « External » n'apprendrait rien.
  it("n'annonce les périmètres que lorsque les deux sont présents", () => {
    const mixte = entreesDeLegende([{ technologie: "HTTP" }], [noeud(), noeud({ id: "B", externe: true })], () => "#111111");
    expect(mixte.map((e) => e.texte)).toContain("Platform");
    expect(mixte.map((e) => e.texte)).toContain("External");
    const interne = entreesDeLegende([{ technologie: "HTTP" }], [noeud()], () => "#111111");
    expect(interne.map((e) => e.texte)).not.toContain("External");
  });

  // La frontière de plateforme est un repère de fond, pas un acteur : la
  // compter parmi les périmètres ferait apparaître « External » toute seule.
  it("ne compte pas la frontière parmi les nœuds", () => {
    const entrées = entreesDeLegende([{ technologie: "HTTP" }], [noeud({ kind: "frontiere" }), noeud()], () => "#111111");
    expect(entrées.map((e) => e.texte)).not.toContain("External");
  });
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `cd app && npx vitest run src/render/legende.test.ts`
Expected: FAIL — `Failed to resolve import "./legende"`.

- [ ] **Step 3: Créer `render/styles-noeud.ts`**

Déplacer tel quel depuis `svg-builder.ts` (lignes 22-23, 49, 258-262, 323-350), **sans rien changer aux valeurs** — les contrastes sont l'objet de la tâche 4, pas de celle-ci :

```ts
import type { LayoutNode } from "../layout/graph-layout";

export const PAPIER = "#ffffff";
export const ENCRE = "#14181f";

// Épaisseur uniforme pour tous les traits. Faire varier l'épaisseur avec le
// nombre de flux agrégés produisait un effet de gras sur les troncs fusionnés,
// qui écrasait visuellement leurs voisins ; le volume se lit dans le « ×N » du
// libellé, pas dans la graisse du trait.
export const ÉPAISSEUR_TRAIT = 2;

export const COULEUR_ECART: Record<"ajout" | "retrait", string> = {
  ajout: "#1a7f43",
  retrait: "#d03b3b",
};

export interface StyleNoeud {
  fond: string;
  bord: string;
  texteClair: boolean;
  épaisseurBord: number;
}

// Couleurs relevées dans la source du gabarit C4 de draw.io (Sidebar-C4.js).
export function styleDuNoeud(node: Pick<LayoutNode, "kind" | "externe">): StyleNoeud {
  if (node.kind === "acteur-selectionne") {
    return { fond: "#083F75", bord: "#06315C", texteClair: true, épaisseurBord: 2 };
  }
  if (node.externe) {
    return { fond: "#8C8496", bord: "#736782", texteClair: true, épaisseurBord: 1 };
  }
  if (node.kind === "plateforme") {
    return { fond: "#23A2D9", bord: "#0E7DAD", texteClair: true, épaisseurBord: 1 };
  }
  return { fond: "#1061B0", bord: "#0D5091", texteClair: true, épaisseurBord: 1 };
}
```

Les valeurs ci-dessus sont celles du fichier, relevées à `svg-builder.ts:258-261` : ce refactor ne change **aucune** couleur. Ne pas en profiter pour corriger `#d03b3b` — le contraste est l'objet de la tâche 4.

- [ ] **Step 4: Créer `render/legende.ts`**

```ts
import type { LayoutNode } from "../layout/graph-layout";
import { COULEUR_ECART, styleDuNoeud } from "./styles-noeud";

// Ce que la légende annonce doit être ce que le dessin utilise. Elle vit ici,
// en DONNÉES, et non dans le constructeur SVG : le fichier draw.io doit
// dessiner exactement la même, et deux légendes divergentes pour un même
// schéma sont précisément ce qu'on veut rendre impossible.
export type ÉchantillonLegende =
  | { forme: "trait"; couleur: string; pointillé?: boolean; pointe?: "debut" | "fin" }
  | { forme: "boite"; fond: string; bord: string; pointillé?: boolean };

export interface EntreeLegende {
  échantillon: ÉchantillonLegende;
  texte: string;
}

// Le strict nécessaire pour décider d'une entrée : la légende ne connaît pas
// le type interne du constructeur SVG, et n'a pas à le connaître.
export interface ArêteLegendable {
  technologie: string;
  ecart?: "ajout" | "retrait";
}

const LIBELLE_ECART: Record<"ajout" | "retrait", string> = {
  ajout: "+n : flows added",
  retrait: "−n : flows removed",
};

export function entreesDeLegende(
  edges: readonly ArêteLegendable[],
  nodes: readonly Pick<LayoutNode, "kind" | "externe">[],
  colorFor: (tech: string) => string
): EntreeLegende[] {
  const entrées: EntreeLegende[] = [];

  for (const ecart of ["ajout", "retrait"] as const) {
    if (edges.some((e) => e.ecart === ecart)) {
      entrées.push({ échantillon: { forme: "trait", couleur: COULEUR_ECART[ecart] }, texte: LIBELLE_ECART[ecart] });
    }
  }

  // Un trait marqué d'un écart ne porte plus la couleur de sa technologie :
  // l'annoncer désignerait un code couleur absent du dessin.
  const technologies = [...new Set(edges.filter((e) => !e.ecart && e.technologie !== "").map((e) => e.technologie))].sort((a, b) =>
    a.localeCompare(b, "fr")
  );
  for (const tech of technologies) {
    entrées.push({ échantillon: { forme: "trait", couleur: colorFor(tech) }, texte: tech });
  }

  // La frontière de plateforme est un repère de fond, pas un acteur.
  const dessinables = nodes.filter((n) => n.kind !== "frontiere");
  if (dessinables.some((n) => n.externe) && dessinables.some((n) => !n.externe)) {
    for (const [texte, externe] of [["Platform", false], ["External", true]] as [string, boolean][]) {
      const style = styleDuNoeud({ kind: "acteur", externe });
      entrées.push({ échantillon: { forme: "boite", fond: style.fond, bord: style.bord, pointillé: externe }, texte });
    }
  }

  return entrées;
}
```

- [ ] **Step 5: Câbler `svg-builder.ts` sur les nouvelles données**

Dans `svg-builder.ts` : supprimer `PAPIER`, `ENCRE`, `ÉPAISSEUR_TRAIT`, `COULEUR_ECART`, `StyleNoeud`, `styleDuNoeud`, `LIBELLE_ECART` et les importer de `./styles-noeud` ; réécrire `construireLegende` pour qu'elle prenne `(entrées: EntreeLegende[], x, y, largeur, hauteur)` et dessine chaque échantillon selon sa `forme` ; dans `buildGraphSvg`, remplacer le calcul de `ecarts`/`technologies`/`périmètres`/`entrées` par un unique :

```ts
  const entrées = entreesDeLegende(renderEdges, layout.nodes, colorFor);
  const légendeL = entrées.length ? largeurLegende(entrées.map((e) => e.texte)) : 0;
  const légendeH = entrées.length ? LEGENDE_PAD * 2 + entrées.length * LEGENDE_LIGNE : 0;
```

et l'appel final par `construireLegende(entrées, bornes.x1 - légendeL, bornes.y1 - légendeH, légendeL, légendeH)`.

- [ ] **Step 6: Vérifier que rien n'a bougé**

Run: `cd app && npx tsc --noEmit && npx vitest run`
Expected: PASS — 661 tests + les 5 nouveaux = 666, et **`src/render/svg-builder.test.ts` passe sans avoir été modifié**. C'est le critère du refactor : si un test de rendu a dû changer, c'est que le dessin a changé, et ce n'était pas le contrat.

- [ ] **Step 7: Muter pour vérifier que le test mord**

```bash
cd app && git add -A && git commit -m "refactor(render): legend entries become data, shared with the exports"
# muter : dans legende.ts, retirer le filtre `e.technologie !== ""`
npx vitest run src/render/legende.test.ts   # attendu : 1 échec
git checkout -- src/render/legende.ts
```

- [ ] **Step 8: Commit**

Déjà fait à l'étape 7. Vérifier `git status` propre.

---

### Task 2: P2 — La légende annonce toute la notation

Sept signes graphiques sur huit sont muets, dont la convention de pointe, qui est l'invention de l'outil : non annoncée, elle se lit comme une erreur.

**Files:**
- Modify: `app/src/render/legende.ts` (`ArêteLegendable`, `entreesDeLegende`), `app/src/render/svg-builder.ts` (dessin des échantillons `pointe` et `pointillé`)
- Test: `app/src/render/legende.test.ts`, `app/src/render/svg-builder.test.ts`

**Interfaces:**
- Consumes: `EntreeLegende`, `ÉchantillonLegende`, `entreesDeLegende` (Task 1).
- Produces: `ArêteLegendable` gagne `tire?: boolean` et `atténué?: boolean`.

- [ ] **Step 1: Écrire les tests qui échouent**

Ajouter à `app/src/render/legende.test.ts` :

```ts
describe("entreesDeLegende — la notation, pas seulement la couleur", () => {
  // La convention de pointe est l'invention de l'outil : le trait suit la
  // donnée, la pointe dit qui appelle. Non annoncée, elle se lit comme une
  // erreur de sens de flèche.
  it("explique la pointe dès qu'un flux tiré est dessiné", () => {
    const textes = entreesDeLegende(
      [{ technologie: "HTTP", tire: true }, { technologie: "Kafka", tire: false }],
      [noeud()],
      () => "#111111"
    ).map((e) => e.texte);
    expect(textes).toContain("provider pushes — head at the consumer");
    expect(textes).toContain("consumer pulls — head at the provider");
  });

  it("n'explique pas la pointe quand aucun flux n'est tiré", () => {
    const textes = entreesDeLegende([{ technologie: "Kafka", tire: false }], [noeud()], () => "#111111").map((e) => e.texte);
    expect(textes.some((t) => t.includes("pulls"))).toBe(false);
  });

  // Le pointillé dit qu'un maillon transforme le contenu. C'est une
  // affirmation forte -- le lien dit que l'information circule, pas qu'elle
  // arrive intacte -- et elle était muette.
  it("explique le pointillé dès qu'un flux est atténué", () => {
    const textes = entreesDeLegende([{ technologie: "HTTP", atténué: true }], [noeud()], () => "#111111").map((e) => e.texte);
    expect(textes).toContain("decision: Transform — content changes on the way");
  });

  it("n'explique pas le pointillé quand aucun flux ne l'est", () => {
    const textes = entreesDeLegende([{ technologie: "HTTP" }], [noeud()], () => "#111111").map((e) => e.texte);
    expect(textes.some((t) => t.includes("Transform"))).toBe(false);
  });

  // L'ordre de lecture : ce qui explique la FORME d'abord, ce qui explique la
  // COULEUR ensuite. La notation se lit avant le code couleur.
  it("place la notation avant les technologies", () => {
    const textes = entreesDeLegende([{ technologie: "HTTP", tire: true }], [noeud()], () => "#111111").map((e) => e.texte);
    expect(textes.indexOf("HTTP")).toBeGreaterThan(textes.findIndex((t) => t.includes("pushes")));
  });
});
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `cd app && npx vitest run src/render/legende.test.ts`
Expected: FAIL — 5 échecs, les textes de notation étant absents.

- [ ] **Step 3: Étendre `entreesDeLegende`**

Dans `legende.ts`, étendre l'entrée et insérer le bloc de notation **entre** les écarts et les technologies :

```ts
export interface ArêteLegendable {
  technologie: string;
  ecart?: "ajout" | "retrait";
  // La pointe et le pointillé sont de la NOTATION : ils disent qui appelle et
  // si le contenu change en route. La couleur, elle, n'est qu'un rappel.
  tire?: boolean;
  atténué?: boolean;
}
```

```ts
  // La notation avant le code couleur : un lecteur doit savoir lire la FORME
  // du trait avant de se demander ce que sa teinte veut dire.
  const surDuDessin = edges.length > 0;
  if (surDuDessin && edges.some((e) => e.tire !== true)) {
    entrées.push({
      échantillon: { forme: "trait", couleur: ENCRE, pointe: "fin" },
      texte: "provider pushes — head at the consumer",
    });
  }
  if (edges.some((e) => e.tire === true)) {
    entrées.push({
      échantillon: { forme: "trait", couleur: ENCRE, pointe: "debut" },
      texte: "consumer pulls — head at the provider",
    });
  }
  if (edges.some((e) => e.atténué === true)) {
    entrées.push({
      échantillon: { forme: "trait", couleur: ENCRE, pointillé: true },
      texte: "decision: Transform — content changes on the way",
    });
  }
```

Importer `ENCRE` depuis `./styles-noeud`.

- [ ] **Step 4: Dessiner les nouveaux échantillons**

Dans `svg-builder.ts`, la fonction qui dessine un échantillon `forme: "trait"` doit maintenant honorer `pointillé` et `pointe`. Le marqueur existe déjà (`ajouterMarqueurFlèche`) et `orient="auto-start-reverse"` fait qu'un seul marqueur sert aux deux bouts :

```ts
  const traitDeLegende = (é: Extract<ÉchantillonLegende, { forme: "trait" }>): SVGLineElement => {
    const trait = el("line");
    trait.setAttribute("x1", String(x + LEGENDE_PAD));
    trait.setAttribute("y1", String(ligne));
    trait.setAttribute("x2", String(x + LEGENDE_PAD + LEGENDE_ECHANTILLON));
    trait.setAttribute("y2", String(ligne));
    trait.setAttribute("stroke", é.couleur);
    trait.setAttribute("stroke-width", String(ÉPAISSEUR_TRAIT));
    if (é.pointillé) trait.setAttribute("stroke-dasharray", "6 4");
    if (é.pointe === "fin") trait.setAttribute("marker-end", `url(#${idMarqueurFlèche(é.couleur)})`);
    if (é.pointe === "debut") trait.setAttribute("marker-start", `url(#${idMarqueurFlèche(é.couleur)})`);
    return trait;
  };
```

Et dans `buildGraphSvg`, s'assurer que le marqueur de la couleur `ENCRE` est bien déclaré dans `<defs>` quand la légende en pose un :

```ts
  const couleursAvecFlèche = new Set(renderEdges.filter((e) => e.fleche).map((e) => couleurArête(e, colorFor)));
  // La légende dessine ses propres échantillons fléchés : son marqueur doit
  // exister dans <defs>, sans quoi l'entrée sort sans pointe -- c'est-à-dire
  // qu'elle explique une notation en ne la montrant pas.
  if (entrées.some((e) => e.échantillon.forme === "trait" && e.échantillon.pointe)) couleursAvecFlèche.add(ENCRE);
  for (const couleur of couleursAvecFlèche) ajouterMarqueurFlèche(defs, couleur);
```

- [ ] **Step 5: Vérifier**

Run: `cd app && npx tsc --noEmit && npx vitest run`
Expected: PASS. Les tests de `svg-builder.test.ts` qui comptent les lignes de légende devront être ajustés en nombre — c'est attendu, la légende s'allonge ; **vérifier ligne à ligne que chaque ajustement traduit un ajout voulu et non une régression**.

- [ ] **Step 6: Vérifier dans Chrome**

Servir, charger le classeur d'exemple, ouvrir « Platform detail » en mode Architecture, puis :

```js
[...document.querySelectorAll(".fx-legende text")].map(t => t.textContent)
```

Attendu : les entrées de notation présentes, suivies des technologies, suivies de `Platform`/`External`. Vérifier aussi qu'un échantillon porte bien `marker-start` :

```js
document.querySelectorAll(".fx-legende line[marker-start]").length
```

- [ ] **Step 7: Commit**

```bash
cd app && git add -A
git commit -m "feat(legend): the legend explains the whole notation, not just the colours

Seven of the eight graphic signs were silent, including the arrowhead
convention -- the tool's own invention. Unannounced, it reads as a mistake."
```

---

### Task 3: P1 — Un cartouche et une accessibilité programmatique

Aucun schéma exporté ne dit ce qu'il montre : ni le classeur, ni le palier, ni la lecture. C'est la règle n°1 de C4 (« diagrams should be self-describing »), et l'information est déjà dans `AppState`.

**Files:**
- Create: `app/src/render/cartouche.ts`
- Create: `app/src/render/cartouche.test.ts`
- Modify: `app/src/render/svg-builder.ts:674` (signature `buildGraphSvg`), `:543` (`calculerBornes`, réserver la hauteur), `app/src/ui/app.ts:365-370` (passer le contexte), `app/src/ui/export-handlers.ts` (le contexte pour l'export SVG/PNG)
- Test: `app/src/render/cartouche.test.ts`, `app/src/render/svg-builder.test.ts`

**Interfaces:**
- Produces: `interface ContexteSchema { titre: string; lecture: string; palier: string | null; source: string; date: string; composants: number; flux: number; technologies: number }`, `libelléCartouche(c: ContexteSchema): { titre: string; sousTitre: string }`, `descriptionAccessible(c: ContexteSchema): string`, `construireCartouche(c, x, y): SVGGElement`, `HAUTEUR_CARTOUCHE: number`.
- Consumes: rien des autres tâches.
- Produces pour la suite : `ContexteSchema` est repris tel quel par la Task 22 (draw.io) et la Task 30 (planche Contexte). `buildGraphSvg` devient `buildGraphSvg(layout: LayoutResult, colorFor: (t: string) => string, contexte: ContexteSchema | null): SVGSVGElement` — le `null` couvre les tests de rendu existants et les appels internes qui n'ont pas de contexte.

- [ ] **Step 1: Écrire le test qui échoue**

Créer `app/src/render/cartouche.test.ts` :

```ts
import { describe, it, expect } from "vitest";
import { libelléCartouche, descriptionAccessible, type ContexteSchema } from "./cartouche";

const ctx = (o: Partial<ContexteSchema> = {}): ContexteSchema => ({
  titre: "Platform detail",
  lecture: "architecture",
  palier: "v2",
  source: "carto.xlsx",
  date: "2026-08-22",
  composants: 12,
  flux: 24,
  technologies: 5,
  ...o,
});

describe("libelléCartouche", () => {
  it("dit la vue, la lecture et le palier sur la première ligne", () => {
    expect(libelléCartouche(ctx()).titre).toBe("Platform detail — architecture reading, milestone v2");
  });

  // Un classeur sans palier ne doit pas afficher « milestone null ».
  it("tait le palier quand le classeur n'en déclare aucun", () => {
    expect(libelléCartouche(ctx({ palier: null })).titre).toBe("Platform detail — architecture reading");
  });

  it("dit la source, les comptes et la date sur la seconde ligne", () => {
    expect(libelléCartouche(ctx()).sousTitre).toBe("carto.xlsx · 12 components, 24 flows · 2026-08-22");
  });

  // Le singulier compte : « 1 components » signale un texte fabriqué à la main.
  it("accorde le singulier", () => {
    expect(libelléCartouche(ctx({ composants: 1, flux: 1 })).sousTitre).toContain("1 component, 1 flow");
  });
});

describe("descriptionAccessible", () => {
  // Ce que lit un lecteur d'écran : les comptes ET la convention de lecture,
  // qu'aucun texte du schéma ne porte par ailleurs.
  it("énonce les comptes puis la convention de lecture", () => {
    const d = descriptionAccessible(ctx());
    expect(d).toContain("12 components, 24 flows, 5 technologies");
    expect(d).toContain("Line = data, provider to consumer");
    expect(d).toContain("Arrowhead = who calls");
  });
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `cd app && npx vitest run src/render/cartouche.test.ts`
Expected: FAIL — `Failed to resolve import "./cartouche"`.

- [ ] **Step 3: Créer `render/cartouche.ts`**

```ts
import { ENCRE } from "./styles-noeud";

// Ce qu'un schéma doit dire de lui-même. C4 en fait sa règle première : un
// diagramme collé dans un dossier, un ticket ou une présentation ne dit
// aujourd'hui ni de quel classeur il vient, ni à quel palier il se lit, ni
// selon quelle lecture -- et ces trois informations changent tout son sens.
export interface ContexteSchema {
  titre: string;
  lecture: string;
  palier: string | null;
  source: string;
  date: string;
  composants: number;
  flux: number;
  technologies: number;
}

const pluriel = (n: number, mot: string) => `${n} ${mot}${n > 1 ? "s" : ""}`;

export function libelléCartouche(c: ContexteSchema): { titre: string; sousTitre: string } {
  const palier = c.palier ? `, milestone ${c.palier}` : "";
  return {
    titre: `${c.titre} — ${c.lecture} reading${palier}`,
    sousTitre: `${c.source} · ${pluriel(c.composants, "component")}, ${pluriel(c.flux, "flow")} · ${c.date}`,
  };
}

// La convention de lecture ne figure NULLE PART dans le texte du schéma : un
// lecteur d'écran ne peut pas la déduire du dessin. Elle appartient donc à la
// description, avec les comptes.
export function descriptionAccessible(c: ContexteSchema): string {
  return (
    `${c.source} · ${pluriel(c.composants, "component")}, ${pluriel(c.flux, "flow")}, ` +
    `${pluriel(c.technologies, "technology").replace("technologys", "technologies")}. ` +
    "Line = data, provider to consumer. Arrowhead = who calls."
  );
}

export const HAUTEUR_CARTOUCHE = 40;

export function construireCartouche(c: ContexteSchema, x: number, y: number): SVGGElement {
  const { titre, sousTitre } = libelléCartouche(c);
  const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
  g.setAttribute("class", "fx-cartouche");
  const ligne = (texte: string, dy: number, taille: number, gras: boolean, couleur: string) => {
    const t = document.createElementNS("http://www.w3.org/2000/svg", "text");
    t.setAttribute("x", String(x));
    t.setAttribute("y", String(y + dy));
    t.setAttribute("font-size", String(taille));
    if (gras) t.setAttribute("font-weight", "600");
    t.setAttribute("fill", couleur);
    t.textContent = texte;
    g.appendChild(t);
  };
  ligne(titre, 14, 14, true, ENCRE);
  ligne(sousTitre, 30, 10, false, "#5b6472");
  return g;
}
```

> `#5b6472` sur `#ffffff` donne **5,05:1** — au-dessus du seuil de 4,5:1. Ne pas le remplacer par un gris plus clair « pour la hiérarchie » : c'est exactement l'erreur que la tâche 4 corrige ailleurs.

- [ ] **Step 4: Poser le cartouche et les attributs d'accessibilité**

Dans `svg-builder.ts` : `buildGraphSvg(layout, colorFor, contexte: ContexteSchema | null = null)`. Quand `contexte` n'est pas `null` :

1. réserver la hauteur en haut : `bornes.y0 -= MARGE_CADRE + HAUTEUR_CARTOUCHE;`
2. poser le groupe : `svg.appendChild(construireCartouche(contexte, bornes.x0 + MARGE_CADRE, bornes.y0 + MARGE_CADRE));`
3. poser le patron d'accessibilité — **c'est le patron n°11 de l'étude Deque, le plus fiable des douze testés sur l'ensemble navigateurs × lecteurs d'écran** (<https://www.deque.com/blog/creating-accessible-svgs/>) :

```ts
  // `<title>` et `<desc>` doivent être ENFANTS DIRECTS de <svg> (SVG-AAM ne
  // remonte pas plus profond), et `aria-labelledby` prime sur `<title>` seul,
  // notoirement peu fiable en NVDA + Firefox.
  if (contexte) {
    const idTitre = "fx-titre";
    const idDesc = "fx-desc";
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-labelledby", `${idTitre} ${idDesc}`);
    const titre = el("title");
    titre.setAttribute("id", idTitre);
    titre.textContent = libelléCartouche(contexte).titre;
    const desc = el("desc");
    desc.setAttribute("id", idDesc);
    desc.textContent = descriptionAccessible(contexte);
    svg.insertBefore(desc, svg.firstChild);
    svg.insertBefore(titre, svg.firstChild);
  }
```

- [ ] **Step 5: Fournir le contexte depuis `app.ts`**

Dans `src/ui/app.ts`, à l'endroit du `.then((positioned) => …)` :

```ts
        const contexte: ContexteSchema = {
          titre: LIBELLE_VUE[state.vue],
          lecture: state.mode === "fonctionnel" ? "functional" : "architecture",
          palier: state.palierAffiche,
          source: fichier.nom,
          // La date de sauvegarde du classeur, pas celle du jour : c'est
          // l'âge de la DONNÉE qui compte, pas celui de l'impression.
          date: fichier.dateModification ? fichier.dateModification.toISOString().slice(0, 10) : "save date unknown",
          composants: vueDuCalcul.nodes.filter((n) => n.kind !== "frontiere").length,
          flux: vueDuCalcul.edges.length,
          technologies: new Set(vueDuCalcul.edges.map((e) => e.technologie).filter(Boolean)).size,
        };
        zoneRendu.appendChild(buildGraphSvg(positioned, (t) => couleurs.get(t) ?? "#000", contexte));
```

- [ ] **Step 6: Écrire le test d'intégration du SVG**

Ajouter à `app/src/render/svg-builder.test.ts` :

```ts
// --- Un schéma doit se décrire lui-même (C4, règle n°1). Collé dans un
// ticket, un PNG ne disait ni son classeur, ni son palier, ni sa lecture.
describe("buildGraphSvg — le cartouche", () => {
  it("pose titre et description en enfants DIRECTS de <svg>, référencés par aria-labelledby", () => {
    const svg = buildGraphSvg(layoutSimple(), () => "#111", {
      titre: "Platform detail", lecture: "architecture", palier: "v2",
      source: "carto.xlsx", date: "2026-08-22", composants: 2, flux: 1, technologies: 1,
    });
    expect(svg.getAttribute("role")).toBe("img");
    const ids = (svg.getAttribute("aria-labelledby") ?? "").split(" ");
    for (const id of ids) {
      const cible = [...svg.children].find((c) => c.getAttribute("id") === id);
      expect(cible, `#${id} doit être un enfant direct de <svg>`).toBeDefined();
    }
  });

  it("n'ajoute ni rôle ni cartouche quand aucun contexte n'est fourni", () => {
    const svg = buildGraphSvg(layoutSimple(), () => "#111", null);
    expect(svg.getAttribute("role")).toBeNull();
    expect(svg.querySelector(".fx-cartouche")).toBeNull();
  });
});
```

(`layoutSimple()` est le constructeur de terrain déjà utilisé dans ce fichier ; reprendre le nom exact qui s'y trouve.)

- [ ] **Step 7: Vérifier, muter, commiter**

```bash
cd app && npx tsc --noEmit && npx vitest run
git add -A && git commit -m "feat(svg): every diagram carries its title, milestone, reading and source

C4's first rule is that a diagram describes itself. A PNG pasted into a
ticket said neither which workbook it came from, nor at which milestone,
nor under which reading -- and those three change its whole meaning.
The same block carries the accessible name and description."
# muter : retirer svg.setAttribute("role", "img")  ->  le test doit rougir
```

- [ ] **Step 8: Vérifier dans Chrome**

```js
const svg = document.querySelector(".zone-rendu svg");
[svg.getAttribute("role"), svg.getAttribute("aria-labelledby"),
 svg.querySelector(":scope > title")?.textContent,
 svg.querySelector(":scope > desc")?.textContent];
```

Attendu : `["img", "fx-titre fx-desc", "Platform detail — architecture reading, milestone v2", "…"]`. Le `:scope >` est essentiel : c'est l'enfant **direct** qu'on vérifie.

---

### Task 4: P4a — Les fonds de boîte et la description passent le seuil de contraste

Blanc sur `#23A2D9` donne **2,90:1** et la description `#cccccc` sur ce même fond **1,81:1** — sous le seuil WCAG de 4,5:1, et 100 % des schémas produits sont concernés.

**Files:**
- Modify: `app/src/render/styles-noeud.ts` (`styleDuNoeud`), `app/src/render/svg-builder.ts:439-441` (`grisDesc`)
- Create: `app/src/render/contraste.ts`
- Create: `app/src/render/contraste.test.ts`
- Test: `app/src/render/contraste.test.ts`, `app/src/render/styles-noeud.test.ts` (créé ici)

**Interfaces:**
- Produces: `contraste.ts` exporte `luminanceRelative(hex: string): number`, `ratioDeContraste(a: string, b: string): number`, `assombrirJusquA(hex: string, cible: number, sur?: string): string`.
- Consumes: rien.
- Produces pour la suite : `ratioDeContraste` est repris par la Task 6 (garde-fou de palette).

- [ ] **Step 1: Écrire le test qui échoue**

Créer `app/src/render/contraste.test.ts` :

```ts
import { describe, it, expect } from "vitest";
import { ratioDeContraste, assombrirJusquA } from "./contraste";
import { styleDuNoeud } from "./styles-noeud";

describe("ratioDeContraste", () => {
  // Les bornes de la formule WCAG : elles cadrent tout le reste.
  it("donne 21 entre le noir et le blanc, et 1 entre une couleur et elle-même", () => {
    expect(ratioDeContraste("#000000", "#ffffff")).toBeCloseTo(21, 2);
    expect(ratioDeContraste("#3a7bd5", "#3a7bd5")).toBeCloseTo(1, 5);
  });

  it("est symétrique", () => {
    expect(ratioDeContraste("#0E7DAD", "#ffffff")).toBeCloseTo(ratioDeContraste("#ffffff", "#0E7DAD"), 5);
  });

  // Valeur de référence recalculée à la main : c'est elle qui justifie tout P4.
  it("retrouve les valeurs mesurées sur les couleurs du produit", () => {
    expect(ratioDeContraste("#ffffff", "#23A2D9")).toBeCloseTo(2.90, 2);
    expect(ratioDeContraste("#cccccc", "#23A2D9")).toBeCloseTo(1.81, 2);
    expect(ratioDeContraste("#ffffff", "#0E7DAD")).toBeCloseTo(4.61, 2);
  });
});

describe("assombrirJusquA", () => {
  it("assombrit une couleur trop claire jusqu'à atteindre la cible sur blanc", () => {
    const corrigée = assombrirJusquA("#eda100", 4.5);
    expect(ratioDeContraste(corrigée, "#ffffff")).toBeGreaterThanOrEqual(4.5);
  });

  // Une couleur déjà conforme ne doit pas bouger : la corriger changerait une
  // teinte que le classeur a délibérément choisie.
  it("laisse intacte une couleur qui passe déjà", () => {
    expect(assombrirJusquA("#4a3aa7", 4.5)).toBe("#4a3aa7");
  });
});

describe("styleDuNoeud — chaque fond porte son texte", () => {
  // Le texte des boîtes est TOUJOURS blanc (texteClair). Chaque fond doit donc
  // le supporter, sans exception : c'est 100 % des schémas produits.
  it("laisse le blanc lisible sur tous les fonds", () => {
    const cas = [
      { kind: "acteur", externe: false },
      { kind: "acteur", externe: true },
      { kind: "plateforme", externe: false },
      { kind: "acteur-selectionne", externe: false },
    ] as const;
    for (const c of cas) {
      const style = styleDuNoeud(c);
      expect(ratioDeContraste("#ffffff", style.fond), `fond ${style.fond}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  // La bordure doit rester distinguable du fond : elle porte l'épaisseur qui
  // signale l'acteur sélectionné.
  it("garde la bordure distinguable de son fond", () => {
    for (const c of [{ kind: "acteur", externe: false }, { kind: "plateforme", externe: false }] as const) {
      const style = styleDuNoeud(c);
      expect(ratioDeContraste(style.bord, style.fond)).toBeGreaterThan(1.1);
    }
  });
});
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `cd app && npx vitest run src/render/contraste.test.ts`
Expected: FAIL — le module n'existe pas, puis (une fois créé) `fond #23A2D9` et `fond #8C8496` rougissent à 2,90 et 3,59.

- [ ] **Step 3: Créer `render/contraste.ts`**

```ts
// La formule de luminance relative de WCAG 2 (§ relative luminance). Deux
// raisons de la porter ici plutôt que de faire confiance à l'œil : les fonds
// de boîte de l'outil échouaient à 2,90:1 alors qu'ils « avaient l'air »
// contrastés, et cette même formule EST celle du niveau de gris Rec. 709 --
// corriger le contraste rend donc le schéma lisible à l'impression en noir et
// blanc et pour un daltonien, du même geste.
function canal(v: number): number {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function composantes(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function luminanceRelative(hex: string): number {
  const [r, v, b] = composantes(hex);
  return 0.2126 * canal(r) + 0.7152 * canal(v) + 0.0722 * canal(b);
}

export function ratioDeContraste(a: string, b: string): number {
  const [haut, bas] = [luminanceRelative(a), luminanceRelative(b)].sort((x, y) => y - x);
  return (haut + 0.05) / (bas + 0.05);
}

// Assombrit par pas de 2 % jusqu'à atteindre la cible. On ne change JAMAIS la
// teinte : une couleur déclarée au référentiel appartient à celui qui tient le
// classeur, on ne fait que la rendre lisible.
export function assombrirJusquA(hex: string, cible: number, sur = "#ffffff"): string {
  let [r, v, b] = composantes(hex);
  for (let i = 0; i < 50; i += 1) {
    const courant = `#${[r, v, b].map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;
    if (ratioDeContraste(courant, sur) >= cible) return courant;
    [r, v, b] = [r * 0.98, v * 0.98, b * 0.98];
  }
  return "#000000";
}
```

- [ ] **Step 4: Corriger les fonds et la description**

Dans `styles-noeud.ts` — les trois valeurs de remplacement ont été **recalculées et vérifiées** :

```ts
  // Les fonds relevés dans le gabarit C4 de draw.io échouaient au contraste :
  // blanc sur #23A2D9 donnait 2,90:1 et blanc sur #8C8496 3,59:1, pour un
  // seuil de 4,5:1. On reprend, pour chacun, la teinte de sa PROPRE BORDURE
  // (ou son équivalent assombri) : la famille de couleur ne change pas, seule
  // sa clarté descend -- #0E7DAD donne 4,61:1 et #6E6579 donne 5,53:1.
  if (node.externe) {
    return { fond: "#6E6579", bord: "#514A5A", texteClair: true, épaisseurBord: 1 };
  }
  if (node.kind === "plateforme") {
    return { fond: "#0E7DAD", bord: "#0A5E82", texteClair: true, épaisseurBord: 1 };
  }
```

Dans `svg-builder.ts:440`, remplacer :

```ts
  const grisDesc = "#cccccc";
```

par :

```ts
  // Blanc, pas gris. #cccccc tombait à 1,81:1 ; une demi-teinte ne suffit pas
  // non plus (#e8eef2 ne donne que 3,94:1). La hiérarchie visuelle est déjà
  // portée par la taille -- 16 px gras, 12 px, 11 px -- la couleur n'a pas à
  // la porter en plus.
  const grisDesc = "#ffffff";
```

- [ ] **Step 5: Vérifier, muter, commiter**

```bash
cd app && npx tsc --noEmit && npx vitest run
git add -A && git commit -m "fix(render): every box background carries its white text

White on #23A2D9 was 2.90:1 and the description #cccccc on it 1.81:1,
against a 4.5:1 threshold -- on 100% of the diagrams the tool produces.
Each background drops to its own border hue; the description turns white.
WCAG relative luminance is the Rec. 709 grey formula, so this fixes the
black-and-white printout and colour blindness in the same move."
```

- [ ] **Step 6: Vérifier dans Chrome**

```js
const boites = [...document.querySelectorAll(".fx-noeuds rect")].map(r => r.getAttribute("fill"));
[...new Set(boites)]
```

Attendu : plus aucun `#23A2D9` ni `#8C8496`.

---

### Task 5: P4b — L'étiquette d'un trait cesse d'écrire en couleur

Huit teintes sur huit passent sous 4,5:1 comme encre. La matrice a déjà résolu le problème : texte en encre, petit disque coloré devant.

**Files:**
- Modify: `app/src/render/svg-builder.ts:214-262` (`construireLibelléArête`)
- Test: `app/src/render/svg-builder.test.ts`

**Interfaces:**
- Consumes: `ENCRE` (`styles-noeud.ts`, Task 1), `ratioDeContraste` (`contraste.ts`, Task 4).
- Produces: aucune signature nouvelle — `construireLibelléArête` garde la sienne.

- [ ] **Step 1: Écrire le test qui échoue**

```ts
// --- Le rappel visuel de la technologie doit rester, la lisibilité doit
// s'ajouter. Écrire en couleur faisait échouer les huit teintes de la palette
// sous 4,5:1, et rendait le schéma illisible en niveaux de gris.
describe("construireLibelléArête — l'encre n'est pas la couleur du trait", () => {
  it("écrit le texte en encre et pose un disque de la couleur de la technologie", () => {
    const g = construireLibelléArête(0, 0, "HTTP", undefined, "#eda100", false);
    const textes = [...g.querySelectorAll("text")];
    expect(textes.length).toBeGreaterThan(0);
    for (const t of textes) {
      expect(ratioDeContraste(t.getAttribute("fill")!, "#ffffff")).toBeGreaterThanOrEqual(4.5);
    }
    const disque = g.querySelector("circle");
    expect(disque?.getAttribute("fill")).toBe("#eda100");
  });

  // Le mode fonctionnel vide `technologie` : un disque sans couleur de
  // technologie n'aurait rien à rappeler.
  it("ne pose pas de disque quand aucune technologie n'est nommée", () => {
    const g = construireLibelléArête(0, 0, "Policy events 1.0", undefined, "#111111", false);
    expect(g.querySelector("circle")).toBeNull();
  });
});
```

> **Note :** `construireLibelléArête` n'est pas exportée aujourd'hui. L'exporter, ou tester à travers `buildGraphSvg` en interrogeant `.fx-libelles text`. Préférer la seconde : elle teste ce qui est réellement produit. Si l'on choisit l'export, marquer la fonction d'un commentaire disant qu'elle n'est exportée que pour le test.

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `cd app && npx vitest run src/render/svg-builder.test.ts -t "encre"`
Expected: FAIL — le texte sort en `#eda100`, à 2,17:1.

- [ ] **Step 3: Implémenter**

Dans `construireLibelléArête`, remplacer la couleur du texte par `ENCRE` et insérer un disque de 4 px de rayon devant la première ligne, en décalant le texte de `RAYON_DISQUE * 2 + 4` px. Le disque ne se pose que si la technologie est nommée. Recalculer la largeur de la pastille en conséquence — `taillePastille` (`layout/graph-layout.ts:117`) est déjà le point unique où cette largeur se décide, **c'est là qu'il faut ajouter la place du disque**, sinon ELK réservera une place trop courte et le texte débordera de sa pastille.

- [ ] **Step 4: Vérifier, muter, commiter**

```bash
cd app && npx tsc --noEmit && npx vitest run
git add -A && git commit -m "fix(render): edge labels write in ink, and recall the technology with a dot

All eight palette hues failed 4.5:1 as text. The matrix already solved
this: ink for the text, a small coloured disc in front. The visual recall
stays, legibility is gained, and the board reads in greyscale."
```

- [ ] **Step 5: Vérifier dans Chrome**

```js
[...new Set([...document.querySelectorAll(".fx-libelles text")].map(t => t.getAttribute("fill")))]
```

Attendu : une seule valeur, l'encre.

---

### Task 6: P4c — Une palette de repli lisible et un garde-fou sur les couleurs déclarées

La palette de repli n'a jamais été jugée comme encre ni comme trait : `#eda100` donne 2,17:1, `#1baf7a` 2,82:1. Et le classeur peut imposer n'importe quelle teinte sans aucun contrôle.

**Files:**
- Modify: `app/src/render/colors.ts:8` (`PALETTE`), `:32-76` (`couleursDuModele`)
- Modify: `app/src/integrity/checks.ts` (nouveau bloc informatif)
- Test: `app/src/render/colors.test.ts`, `app/src/integrity/checks.test.ts`

**Interfaces:**
- Consumes: `ratioDeContraste`, `assombrirJusquA` (Task 4).
- Produces: `couleursDuModele` garde sa signature. Nouveau bloc informatif d'id `"contraste"` dans le rapport d'intégrité.

- [ ] **Step 1: Écrire les tests qui échouent**

Dans `app/src/render/colors.test.ts` :

```ts
// --- QA : la palette de repli n'avait jamais été jugée comme ENCRE. Cinq
// teintes sur huit passaient sous 3:1 comme trait, huit sur huit sous 4,5:1
// comme texte.
describe("la palette de repli est lisible", () => {
  it("place chaque teinte au-dessus de 4,5:1 sur blanc", () => {
    for (const c of PALETTE) expect(ratioDeContraste(c, "#ffffff"), c).toBeGreaterThanOrEqual(4.5);
  });

  // Huit teintes qui passent le contraste mais se ressemblent ne valent rien :
  // la légende les distingue par le nom, le dessin par la teinte.
  it("garde les teintes distinguables les unes des autres", () => {
    for (let i = 0; i < PALETTE.length; i += 1) {
      for (let j = i + 1; j < PALETTE.length; j += 1) {
        expect(PALETTE[i], `${PALETTE[i]} vs ${PALETTE[j]}`).not.toBe(PALETTE[j]);
        expect(Math.abs(luminanceRelative(PALETTE[i]) - luminanceRelative(PALETTE[j]))).toBeGreaterThan(0.002);
      }
    }
  });
});

// --- Le référentiel peut imposer n'importe quelle teinte. Un jaune clair
// déclaré au classeur produisait un trait invisible, sans un mot.
describe("couleursDuModele — garde-fou de contraste", () => {
  it("assombrit une couleur déclarée illisible plutôt que de la dessiner telle quelle", () => {
    const couleurs = couleursDuModele({
      interfaces: [{ typeDeFlux: "HTTP" }],
      typesFlux: [{ type: "HTTP", couleur: "#ffee00" }],
    });
    expect(ratioDeContraste(couleurs.get("HTTP")!, "#ffffff")).toBeGreaterThanOrEqual(3);
  });

  it("respecte telle quelle une couleur déclarée qui passe le seuil", () => {
    const couleurs = couleursDuModele({
      interfaces: [{ typeDeFlux: "HTTP" }],
      typesFlux: [{ type: "HTTP", couleur: "#1f5fae" }],
    });
    expect(couleurs.get("HTTP")).toBe("#1f5fae");
  });
});
```

Dans `app/src/integrity/checks.test.ts` :

```ts
// --- Le classeur fait foi sur la couleur, mais il doit savoir qu'on a dû la
// corriger : sinon la teinte à l'écran n'est pas celle qu'il a écrite, et
// personne ne comprend pourquoi.
describe("contrôles — couleurs illisibles", () => {
  it("signale une couleur déclarée trop claire pour un trait", () => {
    const m = modele({ typesFlux: [typeFlux({ type: "HTTP", couleur: "#ffee00" })] });
    const bloc = runIntegrityChecks(m).blocsInformatifs.find((b) => b.id === "contraste");
    expect(bloc?.items.join(" ")).toContain("HTTP");
    expect(bloc?.niveau).toBe("avertissement");
  });

  it("ne signale rien quand toutes les couleurs déclarées passent le seuil", () => {
    const m = modele({ typesFlux: [typeFlux({ type: "HTTP", couleur: "#1f5fae" })] });
    expect(runIntegrityChecks(m).blocsInformatifs.find((b) => b.id === "contraste")?.items).toEqual([]);
  });
});
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `cd app && npx vitest run src/render/colors.test.ts src/integrity/checks.test.ts`
Expected: FAIL — la palette actuelle échoue sur cinq teintes, et le bloc `"contraste"` n'existe pas.

- [ ] **Step 3: Remplacer la palette**

Dans `colors.ts:8` — jeu **recalculé et vérifié**, les huit passent 4,5:1 sur blanc et restent distinguables :

```ts
// Palette catégorielle, ordre fixe. Les huit teintes passent 4,5:1 sur blanc :
// elles servent d'ENCRE autant que de trait, et l'ancienne palette échouait
// des deux côtés -- #eda100 à 2,17:1, #1baf7a à 2,82:1. La couleur reste un
// rappel : le nom de la technologie est écrit partout où elle apparaît, donc
// au-delà de huit on reboucle plutôt que d'inventer une teinte non validée.
const PALETTE = ["#1f5fae", "#b8481f", "#0e7f56", "#8a5f00", "#a8446a", "#008300", "#4a3aa7", "#b32d2c"];
```

Ratios mesurés, dans l'ordre : 6,35 · 5,27 · 5,01 · 5,65 · 5,68 · 4,95 · 8,56 · 6,31.

- [ ] **Step 4: Poser le garde-fou dans `couleursDuModele`**

```ts
// Le référentiel fait foi sur la TEINTE, pas sur la clarté : un jaune déclaré
// reste jaune, mais assez foncé pour qu'on voie le trait. Sans ce garde-fou, le
// classeur pouvait rendre un flux invisible sans que rien ne le dise.
const SEUIL_TRAIT = 3;

function couleurDeclaree(brut: string): string | undefined {
  const m = HEXA.exec(brut.trim());
  if (!m) return undefined;
  const brute = `#${m[1].toLowerCase()}`;
  return ratioDeContraste(brute, PAPIER_BLANC) >= SEUIL_TRAIT ? brute : assombrirJusquA(brute, SEUIL_TRAIT);
}
```

- [ ] **Step 5: Ajouter le bloc informatif au rapport d'intégrité**

Dans `checks.ts`, sur le modèle des blocs existants (`typesFluxInutilises`), ajouter :

```ts
// La couleur d'une technologie est corrigée à l'affichage si elle est trop
// claire pour qu'on voie le trait. Le classeur doit l'apprendre ici : sinon la
// teinte à l'écran n'est pas celle qu'il a écrite, et rien ne l'explique.
function couleursIllisibles(model: ParsedModel): InfoBlock {
  const items: string[] = [];
  for (const t of model.typesFlux) {
    const déclarée = HEXA.exec(t.couleur.trim());
    if (!déclarée) continue;
    const hex = `#${déclarée[1].toLowerCase()}`;
    const ratio = ratioDeContraste(hex, "#ffffff");
    if (ratio < 3) {
      items.push(
        `${nommeTypeFlux(t)}: colour ${hex} only reaches ${ratio.toFixed(2)}:1 on white; it is darkened on screen so the line stays visible.`
      );
    }
  }
  return {
    id: "contraste",
    titre: "Colours too light to draw",
    description: "A declared colour is darkened on screen so the line remains visible.",
    items,
    niveau: "avertissement",
  };
}
```

L'ajouter à la liste `blocsInformatifs` de `runIntegrityChecks`. **Il juge le classeur entier** (une couleur ne dépend pas du palier) : lui passer `model`, pas `auPalier`.

- [ ] **Step 6: Vérifier, muter, commiter**

```bash
cd app && npx tsc --noEmit && npx vitest run
git add -A && git commit -m "fix(colors): the fallback palette reads as ink, and a declared colour cannot vanish

Five of the eight fallback hues were under 3:1 as a line and all eight
under 4.5:1 as text. The workbook could also impose any hue at all with no
check: a light yellow drew an invisible line. The hue is kept, its
lightness is lowered, and the integrity report says so."
```

- [ ] **Step 7: Vérifier dans Chrome**

Charger le classeur d'exemple, ouvrir « Integrity checks » : le bloc « Colours too light to draw » doit être vide (les couleurs de l'exemple sont saines) et donc replié avec sa coche.

---

### Task 7: P3a — L'infobulle est toujours posée

23 arêtes sur 24 n'ont aucune infobulle : la condition `noms.length > 1` en prive toute arête qui ne porte qu'un seul échange.

**Files:**
- Modify: `app/src/render/svg-builder.ts:272-278`
- Test: `app/src/render/svg-builder.test.ts`

- [ ] **Step 1: Écrire le test qui échoue**

```ts
// --- QA : l'infobulle ne se posait qu'à partir de DEUX noms. Sur le classeur
// d'exemple, 23 arêtes sur 24 n'en portaient donc aucune, et le nom de
// l'échange n'était lisible nulle part.
it("pose l'infobulle même quand l'arête ne porte qu'un seul échange", () => {
  const svg = buildGraphSvg(layoutAvecArête({ noms: ["Policy events 1.0"] }), () => "#111", null);
  const titres = [...svg.querySelectorAll(".fx-aretes title")].map((t) => t.textContent);
  expect(titres).toContain("Policy events 1.0");
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `cd app && npx vitest run src/render/svg-builder.test.ts -t "un seul échange"`
Expected: FAIL — aucun `<title>` dans `.fx-aretes`.

- [ ] **Step 3: Implémenter**

```ts
  // Le nom de l'échange se lit au survol, dans le navigateur comme dans un
  // .svg ouvert seul. La condition « au moins deux noms » en privait toute
  // arête simple, c'est-à-dire la quasi-totalité d'entre elles.
  if (edge.noms && edge.noms.length > 0) {
    const infobulle = el("title");
    infobulle.textContent = edge.noms.join("\n");
    g.appendChild(infobulle);
  }
```

- [ ] **Step 4: Vérifier, muter, commiter**

```bash
cd app && npx tsc --noEmit && npx vitest run
git add -A && git commit -m "fix(svg): every edge carries its tooltip, not just the merged ones"
```

- [ ] **Step 5: Vérifier dans Chrome**

```js
const aretes = document.querySelectorAll(".fx-aretes > g").length;
const avecTitre = document.querySelectorAll(".fx-aretes > g > title").length;
[aretes, avecTitre]   // attendu : les deux nombres égaux
```

---

### Task 8: P3b — Un sélecteur « ce qui circule / la technologie / les deux »

L'étiquette nomme le tuyau, jamais ce qui passe dedans. C'est la différence entre une carte des tuyaux et une carte des échanges.

**Files:**
- Modify: `app/src/aggregation/core.ts:86-92` (`libelleCellule`) et la construction des `EdgeGroup`, `app/src/ui/state.ts:54-56` (`AppOptions`), `app/src/ui/rail.ts:293-305` (la case à cocher devient un sélecteur), `app/src/aggregation/views.ts` (propagation de l'option)
- Test: `app/src/aggregation/core.test.ts`, `app/src/ui/rail.test.ts`, `app/src/ui/state.test.ts`

**Interfaces:**
- Produces: `export type LibelléArête = "technology" | "exchanges" | "both"` dans `aggregation/core.ts` ; `AppOptions` devient `{ compteurs: boolean; libelléArête: LibelléArête }` ; `withOptions` accepte la nouvelle clé.
- Consumes: `sousLibellé` (`layout/graph-layout.ts:111`), qui sait déjà produire une ligne principale et une sous-ligne.

- [ ] **Step 1: Écrire le test qui échoue**

Dans `app/src/aggregation/core.test.ts` :

```ts
// --- Une carte des TUYAUX ou une carte des ÉCHANGES : l'étiquette ne disait
// que le protocole, et le nom de ce qui circule n'apparaissait nulle part.
describe("libelleCellule — ce qui s'écrit sur le trait", () => {
  const noms = ["Policy events 1.0", "Claims 2.0"];

  it("nomme la technologie seule par défaut", () => {
    expect(libelleCellule("Kafka", 2, noms, "technology")).toBe("Kafka ×2");
  });

  it("nomme les échanges quand on le demande", () => {
    expect(libelleCellule("Kafka", 2, noms, "exchanges")).toBe("Policy events 1.0, Claims 2.0");
  });

  it("nomme les deux, l'échange en tête", () => {
    expect(libelleCellule("Kafka", 2, noms, "both")).toBe("Policy events 1.0, Claims 2.0 — Kafka");
  });

  // Au-delà de deux noms l'étiquette mangerait le dessin : le reste se compte,
  // et se lit dans l'infobulle (tâche 7).
  it("s'arrête à deux noms et compte le reste", () => {
    expect(libelleCellule("Kafka", 5, [...noms, "A", "B", "C"], "exchanges")).toBe("Policy events 1.0, Claims 2.0 +3");
  });

  // En lecture fonctionnelle la technologie est vide : « technology » ne peut
  // pas laisser une étiquette muette.
  it("retombe sur les échanges quand aucune technologie n'est nommée", () => {
    expect(libelleCellule("", 1, ["Policy events 1.0"], "technology")).toBe("Policy events 1.0");
  });
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `cd app && npx vitest run src/aggregation/core.test.ts -t "ce qui s'écrit"`
Expected: FAIL — `libelleCellule` n'accepte que trois arguments.

- [ ] **Step 3: Implémenter le libellé**

Étendre `libelleCellule(technologie, count, noms, quoi: LibelléArête = "technology")`. **Conserver le comportement actuel comme valeur par défaut** : tous les appelants existants (matrice comprise) continuent de fonctionner sans changement, et la constante `ECHANGES_NOMMES = 2` reste le seuil.

- [ ] **Step 4: Câbler le réglage dans le rail et l'état**

`AppOptions` gagne `libelléArête: LibelléArête` (défaut `"technology"`). Dans `rail.ts`, remplacer la case « counters » par un `<select class="rail-selecteur">` à trois options — libellés anglais : `Label: technology` / `Label: what flows` / `Label: both`. La case « counters » reste, elle ne fait pas la même chose (elle décide du `×N`).

- [ ] **Step 5: Vérifier la largeur des pastilles**

`taillePastille` (`layout/graph-layout.ts:117`) calcule la place qu'ELK réserve à l'étiquette. Un libellé plus long doit y être vu **avant** le layout, sinon l'étiquette déborde de sa pastille. Vérifier par un test que `taillePastille("Policy events 1.0 — Kafka", "Kafka").width > taillePastille("Kafka", "Kafka").width`.

- [ ] **Step 6: Vérifier, muter, commiter**

```bash
cd app && npx tsc --noEmit && npx vitest run
git add -A && git commit -m "feat(view): choose what the edge label names -- the pipe, the exchange, or both

24 labels out of 24 named the protocol and none named the exchange. The
difference between a map of pipes and a map of exchanges."
```

- [ ] **Step 7: Vérifier dans Chrome**

Basculer le sélecteur sur « what flows » et relever `[...document.querySelectorAll(".fx-libelles text")].map(t => t.textContent)` : les noms d'échange doivent remplacer les protocoles, et **aucune étiquette ne doit dépasser de sa pastille** (comparer `getBBox().width` du texte à celle du `rect` frère).

---

### Task 9: P8 — Une seconde forme, pour que la couleur ne soit plus seule

Une seule forme de nœud dans tout l'outil : nature, agrégat et retrait ne se lisent qu'à la couleur.

**Files:**
- Modify: `app/src/render/svg-builder.ts:403-423` (`buildFrontiereElement`), `:425-498` (`buildNodeElement`), `app/src/render/styles-noeud.ts`
- Modify: `app/src/aggregation/views.ts` (poser `technique` et `agrégat` sur les nœuds)
- Modify: `app/src/layout/graph-layout.ts:17-23` (`LayoutNode`/`GraphNode` gagnent les deux drapeaux)
- Test: `app/src/render/svg-builder.test.ts`, `app/src/aggregation/views.test.ts`

**Interfaces:**
- Produces: `GraphNode` gagne `technique?: boolean` et `agrégat?: number` (le nombre d'acteurs repliés, absent si le nœud n'en replie pas).
- Consumes: `estActeurTechnique` (`aggregation/nature.ts`).

**Décision de conception (à ne pas élargir) :** **deux** variantes de forme, pas plus. ArchiMate a tranché la convention et elle est gratuite (§3.9 : « Square corners are used to denote structure elements; round corners are used to denote behavior elements »). Au-delà de deux, on tombe dans le zoo UML et la lecture y perd.

- [ ] **Step 1: Écrire les tests qui échouent**

```ts
// --- WCAG 1.4.1 / G111 : ce que la couleur dit, une forme doit le redire. Un
// acteur technique, un groupe replié et un retrait ne se distinguaient qu'à la
// teinte -- donc pas du tout à l'impression ni pour un daltonien.
describe("buildNodeElement — la forme redit ce que la couleur dit", () => {
  it("coupe le coin d'un acteur technique", () => {
    const svg = buildGraphSvg(layoutAvecNoeud({ technique: true }), () => "#111", null);
    expect(svg.querySelector(".fx-noeuds path.fx-coin-coupe")).not.toBeNull();
  });

  it("laisse la boîte rectangulaire pour un acteur métier", () => {
    const svg = buildGraphSvg(layoutAvecNoeud({ technique: false }), () => "#111", null);
    expect(svg.querySelector(".fx-noeuds path.fx-coin-coupe")).toBeNull();
  });

  it("empile la boîte d'un groupe replié", () => {
    const svg = buildGraphSvg(layoutAvecNoeud({ agrégat: 4 }), () => "#111", null);
    expect(svg.querySelectorAll(".fx-noeuds .fx-pile rect").length).toBeGreaterThan(1);
  });

  // Le retrait d'un écart était rouge, et seulement rouge.
  it("met en pointillé le trait d'un retrait", () => {
    const svg = buildGraphSvg(layoutAvecArête({ ecart: "retrait" }), () => "#111", null);
    const trait = svg.querySelector(".fx-aretes path");
    expect(trait?.getAttribute("stroke-dasharray")).not.toBeNull();
  });
});
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `cd app && npx vitest run src/render/svg-builder.test.ts -t "la forme redit"`
Expected: FAIL — quatre échecs.

- [ ] **Step 3: Poser les drapeaux à la source**

Dans `views.ts`, les fabriques de nœuds posent `technique: estActeurTechnique(model, a.nom)` et, pour un nœud de groupe, `agrégat: acteursDuGroupe.length`. **Ne pas recalculer ces deux choses dans le rendu** : le rendu ne connaît pas le modèle, et c'est très bien ainsi.

- [ ] **Step 4: Dessiner les deux variantes**

Dans `buildNodeElement` : si `node.technique`, remplacer le `rect` par un `path` de rectangle à coin supérieur droit coupé (12 px), classe `fx-coin-coupe`. Si `node.agrégat && node.agrégat > 1`, poser deux `rect` décalés de 4 px derrière la boîte, dans un `<g class="fx-pile">`. Dans `buildEdgeElement`, poser `stroke-dasharray="8 4"` quand `edge.ecart === "retrait"`.

- [ ] **Step 5: Annoncer les nouvelles formes dans la légende**

Étendre `entreesDeLegende` (Task 1) : une entrée « technical component » quand au moins un nœud porte `technique`, une entrée « group, n components » quand au moins un porte `agrégat`. **Une forme non annoncée est une notation muette de plus** — c'est exactement ce que la tâche 2 vient de corriger.

- [ ] **Step 6: Vérifier, muter, commiter**

```bash
cd app && npx tsc --noEmit && npx vitest run
git add -A && git commit -m "feat(render): shape says what colour says, a second time

Nature, aggregation and removal read from the hue alone -- so not at all
on a black-and-white printout, nor for a colour-blind reader. ArchiMate
§3.9 already settled the convention; two variants, no more."
```

- [ ] **Step 7: Vérifier dans Chrome**

Ouvrir « Platform detail » (l'exemple porte Kafka et l'ESB, tous deux techniques) et vérifier `document.querySelectorAll(".fx-coin-coupe").length === 2`. Puis ouvrir « Group to group » et vérifier la présence de `.fx-pile`.

---

# Phase 2 — La géométrie : la carte cesse de sauter

### Task 10: P5a — Un ordre d'entrée stable (prérequis)

`nodesFromEdges` (`aggregation/core.ts:377-389`) remplit un `Set` dans l'ordre de parcours des arêtes. Cet ordre change dès qu'une arête change, et **c'est la condition de tout ce qui suit** : ni le mode interactif ni `considerModelOrder` ne valent quoi que ce soit sur une entrée qui bouge d'elle-même.

**Files:**
- Modify: `app/src/aggregation/core.ts:377-389` (`nodesFromEdges`)
- Test: `app/src/aggregation/core.test.ts`

- [ ] **Step 1: Écrire le test qui échoue**

```ts
// --- L'ordre des nœuds transmis au moteur de placement doit être une
// FONCTION du contenu, pas de l'ordre de parcours : sans ça, ajouter une arête
// suffit à redistribuer toute la planche, et aucune option de stabilité d'ELK
// ne peut rattraper une entrée qui bouge d'elle-même.
it("rend les nœuds dans un ordre qui ne dépend pas de celui des arêtes", () => {
  const arêtes = [
    { from: "Zeffo", to: "Bracca" },
    { from: "Crait", to: "Zeffo" },
    { from: "Bracca", to: "Crait" },
  ];
  const direct = nodesFromEdges(arêtes as never).map((n) => n.id);
  const inverse = nodesFromEdges([...arêtes].reverse() as never).map((n) => n.id);
  expect(direct).toEqual(inverse);
  expect(direct).toEqual(["Bracca", "Crait", "Zeffo"]);
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `cd app && npx vitest run src/aggregation/core.test.ts -t "ordre qui ne dépend pas"`
Expected: FAIL — `["Zeffo","Bracca","Crait"]` contre `["Bracca","Crait","Zeffo"]`.

- [ ] **Step 3: Implémenter**

Trier par nom avant de rendre : `return [...ids].sort((a, b) => a.localeCompare(b, "fr")).map(…)`. Une ligne, avec le commentaire qui dit **pourquoi** (c'est un prérequis de stabilité, pas une coquetterie).

- [ ] **Step 4: Mesurer que rien ne se dégrade**

Le tri change l'ordre d'entrée d'ELK, donc potentiellement le dessin. Ce fichier a déjà la culture de la mesure (voir `graph-layout.ts:399-402`) : écrire un script de mesure jetable dans le scratchpad qui, pour les cinq vues du classeur d'exemple, compte les **croisements d'arêtes** et la **surface** avant et après. Consigner les deux relevés dans le message de commit. **Si les croisements augmentent de plus de 10 %, s'arrêter et le signaler plutôt que de poursuivre.**

- [ ] **Step 5: Commit**

```bash
cd app && npx tsc --noEmit && npx vitest run
git add -A && git commit -m "refactor(layout): node order fed to ELK is a function of content, not of edge order

Prerequisite for every stability option: no interactive mode can hold a
layout still when its own input order moves. Crossings before/after: <x>/<y>."
```

---

### Task 11: P5b — Le mode interactif d'ELK

Entre v1 et v2, les 12 mêmes acteurs sont présents et **les 12 boîtes bougent** : déplacement médian 435 px, maximum 1 599 px. Le seul usage de l'axe du temps est celui que le rendu sabote.

**Files:**
- Modify: `app/src/layout/graph-layout.ts:196-230` (options), `:385-431` (construction du nœud ELK), `:317` (`centre`)
- Modify: `app/src/ui/app.ts` (mémoire du placement précédent)
- Test: `app/src/layout/graph-layout.test.ts`

**Interfaces:**
- Produces: `computeLayout(nodes: GraphNode[], edges: GraphEdge[], précédent?: LayoutResult | null): Promise<LayoutResult>`. Le troisième argument est **optionnel** : tous les appelants existants continuent de compiler.

**Ce que la documentation établit — lire avant de coder :**

- Les stratégies interactives lisent les coordonnées posées sur les nœuds **d'entrée**. `InteractiveLayerer` lit `node.getPosition().x` ; `InteractiveCycleBreaker` et `InteractiveCrossingMinimizer` lisent `node.getInteractiveReferencePoint().x` / `.y`.
- `elk.layered.interactiveReferencePoint` vaut **`CENTER`** par défaut ; l'autre valeur est `TOP_LEFT`. Il **ne prend effet que si** `cycleBreaking.strategy` ou `crossingMinimization.strategy` vaut `INTERACTIVE` (<https://eclipse.dev/elk/reference/options/org-eclipse-elk-layered-interactiveReferencePoint.html>).
- **Ne pas employer `crossingMinimization.semiInteractive`** : elle dérive l'ordre de `org.eclipse.elk.position` et **exige `LAYER_SWEEP`**. Nous avons les coordonnées complètes du tour précédent ; c'est `crossingMinimization.strategy: INTERACTIVE` qu'il nous faut.
- **`LayoutNode.x`/`y` de ce dépôt est le CENTRE de la boîte**, alors qu'ELK attend un coin haut-gauche dans `position`. La conversion est donc obligatoire : `x = centre.x - width / 2`.

- [ ] **Step 1: Écrire le test qui échoue**

```ts
// --- §2.4 : entre deux paliers, les 12 mêmes acteurs bougeaient tous, de 435
// px en médiane. C'est la fonctionnalité « paliers » que le rendu sabote : on
// compare deux états en cherchant les boîtes.
describe("computeLayout — stabilité d'un tour à l'autre", () => {
  const déplacementMédian = (a: LayoutResult, b: LayoutResult): number => {
    const avant = new Map(a.nodes.map((n) => [n.id, n]));
    const écarts = b.nodes
      .filter((n) => avant.has(n.id))
      .map((n) => Math.hypot(n.x - avant.get(n.id)!.x, n.y - avant.get(n.id)!.y))
      .sort((x, y) => x - y);
    return écarts.length ? écarts[Math.floor(écarts.length / 2)] : 0;
  };

  it("garde les nœuds communs quasiment en place quand une arête s'ajoute", async () => {
    const v1 = await computeLayout(NOEUDS, ARÊTES_V1);
    const v2 = await computeLayout(NOEUDS, [...ARÊTES_V1, ARÊTE_NOUVELLE], v1);
    expect(déplacementMédian(v1, v2)).toBeLessThan(50);
  });

  // Sans le placement précédent, rien ne change : l'option est un service
  // rendu à l'appelant, pas un comportement imposé.
  it("se comporte comme avant quand aucun placement précédent n'est fourni", async () => {
    const a = await computeLayout(NOEUDS, ARÊTES_V1);
    const b = await computeLayout(NOEUDS, ARÊTES_V1);
    expect(b.nodes.map((n) => [n.x, n.y])).toEqual(a.nodes.map((n) => [n.x, n.y]));
  });
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `cd app && npx vitest run src/layout/graph-layout.test.ts -t "stabilité"`
Expected: FAIL — `computeLayout` n'accepte que deux arguments, et le déplacement médian dépasse largement 50 px.

- [ ] **Step 3: Implémenter**

```ts
// Les stratégies interactives d'ELK lisent les coordonnées posées sur les
// nœuds d'ENTRÉE : InteractiveLayerer lit position.x pour décider les rangs,
// InteractiveCrossingMinimizer lit le point de référence en y pour décider
// l'ordre dans un rang. On leur repose donc le placement du tour précédent.
//
// interactiveReferencePoint vaut CENTER par défaut et ELK positionne par le
// coin haut-gauche : nos x/y étant des CENTRES, la conversion est obligatoire.
const OPTIONS_INTERACTIF: Record<string, string> = {
  "elk.layered.cycleBreaking.strategy": "INTERACTIVE",
  "elk.layered.layering.strategy": "INTERACTIVE",
  "elk.layered.crossingMinimization.strategy": "INTERACTIVE",
  "elk.layered.nodePlacement.strategy": "INTERACTIVE",
  "elk.layered.interactiveReferencePoint": "CENTER",
};
```

et, dans la construction du nœud ELK, quand un `précédent` est fourni et que le nœud y figure :

```ts
      const avant = précédentParId.get(node.id);
      ...(avant ? { x: avant.x - largeur / 2, y: avant.y - hauteur / 2 } : {}),
```

Un nœud **absent** du placement précédent ne reçoit aucune position : ELK le placera lui-même, ce qui est le comportement voulu pour un acteur qui apparaît à ce palier.

- [ ] **Step 4: Mémoriser le placement dans `app.ts`**

Une `Map<string, LayoutResult>` dont la clé est `(vue, mode, granularité, filtres)` — **et surtout pas le palier** : c'est précisément d'un palier à l'autre qu'on veut la continuité. Vider la mémoire au chargement d'un nouveau classeur.

- [ ] **Step 5: Mesurer**

Reprendre le script de mesure de la tâche 10 et produire, sur le classeur d'exemple, le tableau `palier v1→v2` : déplacement médian, maximum, nombre de croisements avant/après. **Critère d'acceptation : médiane sous 50 px et croisements en hausse de moins de 15 %.** Consigner les chiffres dans le message de commit.

- [ ] **Step 6: Décider de la suite**

Si le critère est tenu, **la tâche 12 n'a pas lieu d'être** : la noter « sans objet » dans le journal et passer à la tâche 13. Si la médiane reste au-dessus de 50 px ou si les croisements explosent, faire la tâche 12.

- [ ] **Step 7: Commit**

```bash
cd app && npx tsc --noEmit && npx vitest run
git add -A && git commit -m "feat(layout): a milestone change no longer redraws the whole board

12 of 12 actors moved between v1 and v2, 435 px median. ELK's interactive
strategies read the coordinates carried by the input nodes, so the previous
layout is fed back in. Median now <x> px, crossings <before>/<after>."
```

- [ ] **Step 8: Vérifier dans Chrome**

Relever les centres des boîtes en v1, basculer en v2, les relever à nouveau, et calculer la médiane des déplacements pour les acteurs présents aux deux paliers :

```js
const centres = () => Object.fromEntries([...document.querySelectorAll(".fx-noeuds > g")]
  .map(g => { const r = g.querySelector("rect"); const t = g.querySelector("text")?.textContent;
              return [t, [+r.getAttribute("x") + +r.getAttribute("width")/2, +r.getAttribute("y") + +r.getAttribute("height")/2]]; }));
```

---

### Task 12: P5c — Le layout d'union (conditionnel)

**À n'exécuter que si la tâche 11 n'a pas tenu son critère.** Stabilité exacte plutôt qu'approchée : placer une fois sur l'**union** de tous les paliers, puis ne rendre que le sous-ensemble vivant. C'est la sémantique des *filtered views* de Structurizr (<https://docs.structurizr.com/ui/diagrams/filtered-view>).

**Files:**
- Modify: `app/src/aggregation/planches.ts` (ajouter `vueUnionDesPaliers`), `app/src/ui/app.ts:240-400` (cache de placement), `app/src/aggregation/ecarts.ts:69-121`
- Test: `app/src/aggregation/planches.test.ts`, `app/src/ui/app.test.ts`

**Interfaces:**
- Produces: `vueUnionDesPaliers(model: ParsedModel, mode: Mode, vue: Vue): ViewResult` — l'union des `nodes`/`edges` de `lecture(model, rang, mode)` pour tous les `rang` déclarés.

- [ ] **Step 1: Écrire le test qui échoue**

```ts
// Un acteur qui n'existe qu'en v2 doit figurer dans l'union, sans quoi il
// n'aurait pas de place réservée et sa boîte pousserait tout le reste.
it("réunit les nœuds de tous les paliers", () => {
  const union = vueUnionDesPaliers(modeleDeuxPaliers(), "architecture", "plateforme-detaillee");
  expect(union.nodes.map((n) => n.id).sort()).toEqual(["Bracca", "Crait", "Vjun"]);
});

it("n'invente pas d'arête entre deux nœuds qui ne se sont jamais rencontrés", () => {
  const union = vueUnionDesPaliers(modeleDeuxPaliers(), "architecture", "plateforme-detaillee");
  expect(union.edges.some((e) => e.from === "Vjun" && e.to === "Crait")).toBe(false);
});
```

- [ ] **Step 2: Lancer, implémenter, vérifier**

Run: `cd app && npx vitest run src/aggregation/planches.test.ts`
Puis implémenter, puis relancer.

- [ ] **Step 3: Rendre le sous-ensemble vivant sans replacer**

Dans `app.ts`, filtrer `layout.nodes`/`layout.edges` par vivacité au palier affiché. **Les nœuds absents restent en place, très atténués** (`opacity: 0.15`, pas de bordure) : le trou devient lui-même une information — c'est le principe du *ghosting* / focus+context. Ajouter une entrée de légende « not present at this milestone » (la légende est déjà des données depuis la tâche 1).

- [ ] **Step 4: Faire hériter la vue Écarts du même placement**

`ecarts.ts` doit réutiliser le placement de « Platform detail » pour que les traits verts et rouges tombent aux positions déjà connues du lecteur.

- [ ] **Step 5: Vérifier, mesurer, commiter**

Critère : déplacement médian **exactement 0** pour tout nœud présent aux deux paliers.

```bash
cd app && npx tsc --noEmit && npx vitest run
git add -A && git commit -m "feat(layout): one layout per (view, reading), filtered per milestone

Exact stability rather than approximate: the board is laid out once on the
union of every milestone, then only the live subset is drawn. Same semantics
as Structurizr's filtered views. Absent nodes stay in place, ghosted."
```

---

### Task 13: P7a — Le schéma tient dans la fenêtre

47 % du schéma est visible, et rien ne le dit.

**Files:**
- Modify: `app/src/render/svg-builder.ts:708-716` (attributs de la racine), `app/index.html:186-191` (CSS), `app/src/export/svg-export.ts` (reposer les dimensions à l'export)
- Test: `app/src/render/svg-builder.test.ts`, `app/src/export/svg-export.test.ts`

- [ ] **Step 1: Écrire les tests qui échouent**

```ts
// --- §2.9 : le SVG portait width/height en pixels absolus, donc débordait de
// la zone de rendu, sans zoom ni ajustement.
it("ne pose pas de dimensions absolues sur le SVG affiché", () => {
  const svg = buildGraphSvg(layoutSimple(), () => "#111", null);
  expect(svg.getAttribute("viewBox")).not.toBeNull();
  expect(svg.getAttribute("width")).toBeNull();
  expect(svg.getAttribute("height")).toBeNull();
});

// Le fichier exporté, lui, DOIT porter ses dimensions : un .svg sans width ni
// height s'ouvre à une taille arbitraire dans Word ou PowerPoint.
it("repose les dimensions dans le fichier exporté, depuis le viewBox", () => {
  const texte = serializeSvg(buildGraphSvg(layoutSimple(), () => "#111", null), "#ffffff");
  expect(texte).toMatch(/width="\d+(\.\d+)?"/);
  expect(texte).toMatch(/height="\d+(\.\d+)?"/);
});
```

- [ ] **Step 2: Lancer les tests, implémenter, vérifier**

Retirer `svg.setAttribute("width", …)` et `svg.setAttribute("height", …)` de `buildGraphSvg` ; vérifier que `serializeSvg` les repose bien depuis le `viewBox` (il le fait déjà — le confirmer par le test avant de toucher quoi que ce soit). Dans `index.html` :

```css
.zone-rendu svg { width: 100%; height: auto; max-height: 100%; }
```

- [ ] **Step 3: Vérifier dans Chrome**

```js
const svg = document.querySelector(".zone-rendu svg");
const zone = document.querySelector(".zone-rendu");
[svg.getBoundingClientRect().width <= zone.clientWidth + 1,
 svg.getBoundingClientRect().height <= zone.clientHeight + 1]   // attendu : [true, true]
```

- [ ] **Step 4: Commit**

```bash
cd app && npx tsc --noEmit && npx vitest run
git add -A && git commit -m "fix(render): the board fits the window; the exported file keeps its size"
```

---

### Task 14: P7b — Zoom et panoramique

**Files:**
- Create: `app/src/render/zoom.ts`, `app/src/render/zoom.test.ts`
- Modify: `app/src/ui/app.ts` (brancher sur le SVG rendu), `app/index.html` (les trois boutons)

**Interfaces:**
- Produces: `interface Cadre { x: number; y: number; largeur: number; hauteur: number }`, `cadreInitial(svg: SVGSVGElement): Cadre`, `zoomer(cadre: Cadre, facteur: number, ancre: { x: number; y: number }): Cadre`, `deplacer(cadre: Cadre, dx: number, dy: number): Cadre`, `appliquer(svg: SVGSVGElement, cadre: Cadre): void`, `brancherZoom(svg: SVGSVGElement): { ajuster(): void; zoomer(f: number): void }`.

- [ ] **Step 1: Écrire les tests qui échouent**

```ts
describe("zoomer", () => {
  const cadre = { x: 0, y: 0, largeur: 100, hauteur: 100 };

  it("réduit le cadre quand on zoome, l'agrandit quand on dézoome", () => {
    expect(zoomer(cadre, 2, { x: 50, y: 50 }).largeur).toBeCloseTo(50);
    expect(zoomer(cadre, 0.5, { x: 50, y: 50 }).largeur).toBeCloseTo(200);
  });

  // Le point sous le curseur ne doit pas bouger : c'est ce qui distingue un
  // zoom utilisable d'un zoom qui perd le lecteur.
  it("garde le point d'ancrage immobile", () => {
    const après = zoomer(cadre, 2, { x: 25, y: 75 });
    expect(après.x).toBeCloseTo(12.5);
    expect(après.y).toBeCloseTo(62.5);
  });

  it("conserve le rapport de forme", () => {
    const après = zoomer({ x: 0, y: 0, largeur: 200, hauteur: 100 }, 1.7, { x: 10, y: 10 });
    expect(après.largeur / après.hauteur).toBeCloseTo(2);
  });

  // Sans bornes, deux coups de molette suffisent à sortir du dessin.
  it("borne le zoom entre 0,2× et 8×", () => {
    let c = cadre;
    for (let i = 0; i < 40; i += 1) c = zoomer(c, 2, { x: 50, y: 50 });
    expect(c.largeur).toBeGreaterThanOrEqual(100 / 8);
  });
});
```

- [ ] **Step 2: Lancer, implémenter, vérifier**

`zoomer` : `largeur' = largeur / facteur`, et `x' = ancre.x - (ancre.x - x) / facteur`. Les bornes se posent sur le rapport `largeurInitiale / largeur`.

- [ ] **Step 3: Brancher l'interface**

Trois boutons dans le bandeau : `Fit`, `+`, `−`. Molette pour zoomer (avec `event.preventDefault()`), glisser à la souris pour déplacer. **Aucune bibliothèque** : ~60 lignes.

- [ ] **Step 4: Vérifier, commiter**

```bash
cd app && npx tsc --noEmit && npx vitest run
git add -A && git commit -m "feat(ui): fit, zoom and pan on the board"
```

- [ ] **Step 5: Vérifier dans Chrome**

Zoomer deux crans, vérifier que `svg.getAttribute("viewBox")` a changé et que « Fit » le ramène exactement à sa valeur initiale.

---

### Task 15: P7c — Le rapport de forme, mesuré avant d'être adopté

Le schéma sort à 2,51 de rapport de forme. **`elk.aspectRatio` vaut déjà `1.6` par défaut sous `layered`** : ce n'est donc pas le levier, il ne pilote que l'empaquetage des composantes connexes.

**Files:**
- Modify: `app/src/layout/graph-layout.ts:196-230`
- Test: `app/src/layout/graph-layout.test.ts`

**Ce que la documentation établit :**
- `elk.layered.wrapping.strategy` ∈ `OFF | SINGLE_EDGE | MULTI_EDGE`, défaut `OFF` — « For certain graphs and certain prescribed drawing areas it may be desirable to split the laid out graph into chunks that are placed side by side. The edges that connect different chunks are "wrapped" around from the end of one chunk to the start of the other chunk. » Options compagnes : `wrapping.cutting.strategy`, `wrapping.additionalEdgeSpacing`, `wrapping.correctionFactor`.
- `elk.layered.layering.nodePromotion.strategy` (défaut `NONE`) réduit le nombre de nœuds fictifs, donc les couloirs de longues arêtes, donc la largeur.
- **Piège :** `elk.layered.spacing.baseValue` **n'est pas hérité** — « it must be set for each hierarchical node ». Il ne descendrait donc pas dans la frontière de plateforme, qui est un nœud composé. Ne pas s'en servir.

- [ ] **Step 1: Mesurer AVANT de changer quoi que ce soit**

Écrire dans le scratchpad un script qui, pour les cinq vues du classeur d'exemple et pour chaque combinaison à tester, relève **croisements**, **surface** et **rapport de forme**. Combinaisons : témoin ; `wrapping.strategy=SINGLE_EDGE` ; `+ MULTI_EDGE` ; `+ nodePromotion.strategy=NIKOLOV_IMPROVED` ; `+ compaction.postCompaction.strategy=LEFT`.

- [ ] **Step 2: Écrire le test de non-régression**

```ts
// Le rapport de forme est un CONFORT, jamais au prix de la lisibilité : une
// planche plus carrée mais plus croisée est un mauvais échange.
it("ne dégrade pas le nombre de croisements en resserrant la planche", async () => {
  const l = await computeLayout(NOEUDS_LARGES, ARÊTES_LARGES);
  expect(croisements(l)).toBeLessThanOrEqual(CROISEMENTS_TEMOIN);
  expect(rapportDeForme(l)).toBeLessThan(2.2);
});
```

- [ ] **Step 3: Adopter la combinaison mesurée comme la meilleure**

**Si aucune combinaison ne fait mieux que le témoin, ne rien changer** et l'écrire dans le journal. C'est un résultat, pas un échec.

- [ ] **Step 4: Commit**

```bash
cd app && npx tsc --noEmit && npx vitest run
git add -A && git commit -m "perf(layout): a squarer board without paying in crossings

aspectRatio already defaults to 1.6 under layered and only drives connected
component packing; on a single connected graph the lever is wrapping.
Measured on the five views: <tableau>."
```

---

### Task 16: P13 — Un garde-fou d'échelle

Aucun avertissement quand une planche devient illisible. Le seuil se calcule, il ne se devine pas : densité `d = |E| / |V|²`.

**Files:**
- Modify: `app/src/ui/app.ts:320-380`, `app/src/ui/state.ts`
- Test: nouveau `app/src/ui/echelle.test.ts` (fonction pure, testée à part)

**Interfaces:**
- Produces: `conseilDEchelle(nbNoeuds: number, nbAretes: number): { message: string; vues: Vue[] } | null` — à placer dans `app/src/ui/echelle.ts`.

- [ ] **Step 1: Écrire le test qui échoue**

```ts
describe("conseilDEchelle", () => {
  // Sur le classeur d'exemple : |V| = 15, d = 27/225 = 0,12. Aucun bandeau,
  // et c'est le bon comportement -- un avertissement qui crie sur un petit
  // parc apprend à l'utilisateur à l'ignorer.
  it("se tait sur une planche que le nœud-lien sert bien", () => {
    expect(conseilDEchelle(15, 27)).toBeNull();
  });

  // Au-delà de 20 nœuds ET 0,15 de densité, la matrice lit mieux.
  it("suggère la matrice sur une planche grande ET dense", () => {
    const c = conseilDEchelle(47, 400);
    expect(c?.vues).toContain("matrice");
    expect(c?.message).toContain("47");
  });

  // Grande mais creuse : le nœud-lien reste meilleur, c'est la SURFACE qui
  // gêne -- donc on oriente vers la vue par acteur, pas vers la matrice.
  it("suggère la vue par acteur sur une planche grande et creuse", () => {
    const c = conseilDEchelle(47, 60);
    expect(c?.vues).toContain("par-acteur");
    expect(c?.vues).not.toContain("matrice");
  });
});
```

- [ ] **Step 2: Lancer, implémenter, vérifier**

```ts
// Le seuil se calcule : densité d = |E| / |V|². Au-delà de 20 nœuds, une
// planche dense se lit mieux en matrice, une planche creuse en vue par acteur
// -- c'est la surface qui gêne, pas l'enchevêtrement. On ne bloque ni ne
// tronque jamais : on dit, et on propose.
export function conseilDEchelle(nbNoeuds: number, nbAretes: number): { message: string; vues: Vue[] } | null {
  if (nbNoeuds <= 20) return null;
  const densité = nbAretes / (nbNoeuds * nbNoeuds);
  const vues: Vue[] = densité > 0.15 ? ["matrice", "par-acteur"] : ["par-acteur"];
  const cible = densité > 0.15 ? "The Matrix view" : "A By-actor view";
  return { message: `${nbNoeuds} components and ${nbAretes} flows on one board — ${cible} will read better.`, vues };
}
```

- [ ] **Step 3: Afficher le bandeau**

Au-dessus du schéma, discret, avec un bouton par vue proposée. **Ne jamais bloquer ni tronquer.**

- [ ] **Step 4: Vérifier, commiter**

```bash
cd app && npx tsc --noEmit && npx vitest run
git add -A && git commit -m "feat(ui): say when a board has outgrown the node-link form

The threshold is computed, not guessed: density d = |E|/|V|². On the sample
|V|=15 and d=0.12, so nothing shows -- which is the right behaviour."
```

---

# Phase 3 — La matrice

### Task 17: P6a — Ordonner autrement qu'alphabétiquement, et donner ses marges au tableau

143 cases, 18 % de densité, tri alphabétique, aucun total, aucun `caption`.

**Files:**
- Create: `app/src/aggregation/seriation.ts`, `app/src/aggregation/seriation.test.ts`
- Modify: `app/src/aggregation/views.ts:346-391` (`buildMatrixView` : **l'ordre se décide ici, pas au rendu**), `app/src/render/matrix-table.ts`, `app/src/ui/rail.ts:272-291`, `app/src/ui/state.ts:74-78`
- Test: `app/src/aggregation/seriation.test.ts`, `app/src/aggregation/views.test.ts`, `app/src/render/render.test.ts`

**Interfaces:**
- Produces: `export type OrdreMatrice = "alphabetique" | "groupe" | "degre" | "blocs"` ; `ordonner(ids: string[], ordre: OrdreMatrice, ctx: { groupeDe(id: string): string; degre(id: string): number; voisins(id: string): string[] }): string[]`.
- `FiltresVueMatrice` gagne `ordre: OrdreMatrice` (défaut `"alphabetique"`).
- `MatrixResult` gagne `totauxLigne: Map<string, number>` et `totauxColonne: Map<string, number>`.

- [ ] **Step 1: Écrire les tests qui échouent**

```ts
describe("ordonner", () => {
  const ctx = {
    groupeDe: (id: string) => ({ A: "Core", B: "Partners", C: "Core" })[id] ?? "",
    degre: (id: string) => ({ A: 3, B: 1, C: 2 })[id] ?? 0,
    voisins: () => [],
  };

  it("laisse l'ordre alphabétique tel quel", () => {
    expect(ordonner(["C", "A", "B"], "alphabetique", ctx)).toEqual(["A", "B", "C"]);
  });

  // Regrouper fait apparaître les blocs intra-groupe et inter-groupes, ce que
  // l'ordre alphabétique disperse.
  it("regroupe par groupe puis par nom", () => {
    expect(ordonner(["B", "C", "A"], "groupe", ctx)).toEqual(["A", "C", "B"]);
  });

  it("place les moyeux en tête par degré décroissant", () => {
    expect(ordonner(["B", "C", "A"], "degre", ctx)).toEqual(["A", "C", "B"]);
  });
});
```

- [ ] **Step 2: Lancer, implémenter les trois ordres simples, vérifier**

Run: `cd app && npx vitest run src/aggregation/seriation.test.ts`

- [ ] **Step 3: Ajouter les totaux et la sémantique du tableau**

Dans `matrix-table.ts` : un `<caption>` portant le même texte que le cartouche des schémas (`libelléCartouche(...).titre`, Task 3), `scope="col"` sur les `<th>` d'en-tête de colonne et `scope="row"` sur ceux de ligne, une colonne et une ligne de totaux en gris (degré sortant / entrant).

- [ ] **Step 4: Le sélecteur d'ordre dans le rail**

À côté du sélecteur de granularité : `Order: alphabetical / by group / by degree / blocks`. **`alphabetical` reste le défaut** — voir la tâche 18 pour pourquoi la seriation ne doit jamais être un défaut silencieux.

- [ ] **Step 5: Vérifier, commiter**

```bash
cd app && npx tsc --noEmit && npx vitest run
git add -A && git commit -m "feat(matrix): order by group or by degree, with margins and table semantics

143 cells at 18% density, sorted alphabetically, with no totals and no
caption. Grouping alone makes the intra/inter-group blocks appear."
```

---

### Task 18: P6b — La seriation par Reverse Cuthill-McKee

L'ordre d'implémentation que la revue de référence recommande explicitement (Behrisch et al., *Computer Graphics Forum* 35(3):693-716, 2016, <https://doi.org/10.1111/cgf.12935>, §11.1) : **« Fast algorithms first »** — RCM, temps linéaire, « produce results at near-interactive processing rates, almost independently of the matrix density ». Et sa règle d'arrêt : **« if a fast algorithm reveals desired patterns, a more sophisticated one is unlikely to improve on its quality significantly. »**

**Files:**
- Modify: `app/src/aggregation/seriation.ts`
- Test: `app/src/aggregation/seriation.test.ts`

**Décision de conception :** **écrire les ~40 lignes de RCM, ne pas ajouter `reorder.js`.** Le livrable est un fichier HTML autonome où chaque dépendance pèse ; et la revue elle-même dit qu'un algorithme rapide suffit le plus souvent. Si un jour RCM ne suffit pas, l'étape suivante est *Optimal Leaf Ordering* (O(n² log n) depuis Brandes 2007), pas une bibliothèque.

**Avertissement de la revue, à reprendre tel quel :** RCM « tends to produce strong **bandwidth anti-patterns** » — une bande diagonale qui n'apprend rien. Il faut donc pouvoir revenir à l'ordre alphabétique d'un clic, et **ne jamais faire de la seriation le défaut silencieux**.

- [ ] **Step 1: Écrire les tests qui échouent**

```ts
describe("ordonner — seriation RCM", () => {
  // Deux amas qui ne se touchent pas : RCM doit les rendre contigus, sans quoi
  // la matrice ne montre aucun bloc.
  it("rend contigus les sommets d'un même amas", () => {
    const arêtes: Record<string, string[]> = {
      A: ["B", "C"], B: ["A", "C"], C: ["A", "B"],
      X: ["Y", "Z"], Y: ["X", "Z"], Z: ["X", "Y"],
    };
    const ordre = ordonner(["A", "X", "B", "Y", "C", "Z"], "blocs", {
      groupeDe: () => "", degre: (id) => arêtes[id].length, voisins: (id) => arêtes[id],
    });
    const pos = new Map(ordre.map((id, i) => [id, i]));
    const amas1 = ["A", "B", "C"].map((i) => pos.get(i)!).sort((a, b) => a - b);
    expect(amas1[2] - amas1[0]).toBe(2);
  });

  it("rend tous les sommets, une fois chacun", () => {
    const ids = ["A", "B", "C", "X", "Y", "Z"];
    const ordre = ordonner(ids, "blocs", { groupeDe: () => "", degre: () => 0, voisins: () => [] });
    expect([...ordre].sort()).toEqual([...ids].sort());
  });

  // Déterminisme : deux exécutions doivent donner le même tableau, sinon
  // l'export Excel et l'écran divergent.
  it("est déterministe", () => {
    const ctx = { groupeDe: () => "", degre: (id: string) => id.length, voisins: (id: string) => (id === "A" ? ["B"] : ["A"]) };
    expect(ordonner(["A", "B"], "blocs", ctx)).toEqual(ordonner(["A", "B"], "blocs", ctx));
  });
});
```

- [ ] **Step 2: Lancer, implémenter, vérifier**

```ts
// Reverse Cuthill-McKee : un parcours en largeur depuis le sommet de plus
// faible degré, les voisins visités par degré croissant, puis on renverse.
// C'est l'algorithme que la revue de référence recommande d'essayer EN
// PREMIER -- linéaire, et « almost independently of the matrix density ».
// Son défaut est connu et assumé : il produit volontiers une bande diagonale
// qui n'apprend rien, d'où l'obligation de pouvoir revenir à l'alphabétique.
function rcm(ids: string[], degre: (id: string) => number, voisins: (id: string) => string[]): string[] {
  const restants = new Set(ids);
  const ordre: string[] = [];
  const parNom = (a: string, b: string) => degre(a) - degre(b) || a.localeCompare(b, "fr");
  while (restants.size > 0) {
    const départ = [...restants].sort(parNom)[0];
    const file = [départ];
    restants.delete(départ);
    while (file.length > 0) {
      const courant = file.shift()!;
      ordre.push(courant);
      const suivants = voisins(courant).filter((v) => restants.has(v)).sort(parNom);
      for (const v of suivants) { restants.delete(v); file.push(v); }
    }
  }
  return ordre.reverse();
}
```

- [ ] **Step 3: Vérifier, commiter**

```bash
cd app && npx tsc --noEmit && npx vitest run
git add -A && git commit -m "feat(matrix): block seriation by Reverse Cuthill-McKee

Behrisch et al. (CGF 35(3), 2016) §11.1 says to try a fast algorithm first
and stop there if it reveals the patterns. ~40 lines beat a dependency in a
2 MB single-file deliverable. Never the silent default: RCM is known to
produce bandwidth anti-patterns, so alphabetical stays one click away."
```

---

### Task 19: P6c — L'ordre choisi sort dans Excel

La promesse du produit est « ce qui est à l'écran est ce qui s'exporte ».

**Files:**
- Modify: `app/src/export/xlsx-export.ts:9-23` (`grilleMatrice`, `listeDesFlux`)
- Test: `app/src/export/xlsx-export.test.ts`

- [ ] **Step 1: Écrire le test qui échoue**

```ts
// Le classeur exporté doit être le tableau qu'on avait sous les yeux : un
// ordre différent à l'écran et dans le fichier fait mentir la promesse « ce
// qui est à l'écran est ce qui s'exporte ».
it("écrit les lignes dans l'ordre du tableau reçu, pas dans l'ordre alphabétique", () => {
  const matrix = matriceOrdonnée(["Zeffo", "Bracca", "Crait"]);
  const feuille = construireClasseurMatrice(matrix).Sheets["Matrix"];
  expect([feuille.A2.v, feuille.A3.v, feuille.A4.v]).toEqual(["Zeffo", "Bracca", "Crait"]);
});
```

- [ ] **Step 2: Lancer, implémenter, vérifier**

`grilleMatrice` ne doit trier **nulle part** : `MatrixResult` arrive déjà ordonné, c'est le contrat posé par le commentaire de `views.ts:281-284` (« Le tableau qui sort d'ici est définitif : ni l'affichage ni l'export ne le retaillent »). Vérifier qu'aucun `.sort(` ne subsiste dans `xlsx-export.ts`.

- [ ] **Step 3: Vérifier, commiter**

```bash
cd app && npx tsc --noEmit && npx vitest run
git add -A && git commit -m "fix(export): the Excel matrix keeps the order shown on screen"
```

---

# Phase 4 — Les exports portent leur notation

### Task 20: P9 — Titres et styles dans l'export Structurizr

21 vues sans titre, un seul style d'élément (`External`), et la convention de pointe invisible dans l'outil cible.

**Files:**
- Modify: `app/src/export/c4-dsl.ts` (`vues`, le bloc `styles`, l'en-tête de `model`)
- Test: `app/src/export/c4-dsl.test.ts`

**Ce que la documentation établit — corrige le rapport :** la grammaire est `systemLandscape [key] [description] { … }`. **Le second argument positionnel est la DESCRIPTION, pas le titre.** Le titre s'écrit avec l'instruction `title <title>` **à l'intérieur** du bloc (<https://docs.structurizr.com/dsl/language>). Formes d'élément disponibles : `Box, RoundedBox, Circle, Ellipse, Hexagon, Diamond, Cylinder, Bucket, Pipe, Person, Robot, Folder, WebBrowser, Window, Terminal, Shell, MobileDevicePortrait, MobileDeviceLandscape, Component`. Styles de relation : `thickness, color, style (solid|dashed|dotted), routing, fontSize, position, opacity`.

- [ ] **Step 1: Écrire les tests qui échouent**

```ts
// --- §2.12 : 21 vues sans titre. Ouvert dans Structurizr, le fichier
// présentait une liste de clés techniques -- « tech-rest-esb » -- que
// personne ne peut lire.
describe("modeleEnStructurizr — les vues portent un titre", () => {
  it("écrit `title` DANS le bloc de la vue, pas en second argument", () => {
    const dsl = modeleEnStructurizr(parc(), "v2", "carto.xlsx");
    expect(dsl).toMatch(/systemLandscape "landscape" \{[\s\S]*?title "System landscape — milestone v2"/);
  });

  it("titre chaque vue de technologie du nom de la technologie", () => {
    expect(modeleEnStructurizr(parc(), null, "carto.xlsx")).toContain('title "HTTP flows"');
  });
});

describe("modeleEnStructurizr — la notation passe dans le fichier", () => {
  // Sans style, la pointe inversée est invisible dans l'outil cible : le tag
  // « Pulled » y est posé depuis toujours et n'y change rien.
  it("donne un style au tag Pulled", () => {
    expect(modeleEnStructurizr(parcTire(), null, "carto.xlsx")).toMatch(/relationship "Pulled" \{[\s\S]*?style dashed/);
  });

  it("style la plateforme, et pas seulement l'externe", () => {
    const dsl = modeleEnStructurizr(parc(), null, "carto.xlsx");
    expect(dsl).toMatch(/element "Platform" \{[\s\S]*?background/);
  });

  // Une forme par type d'acteur déclaré : c'est le classeur qui décide, pas
  // une table figée dans le code.
  it("donne une forme à chaque type d'acteur déclaré", () => {
    const dsl = modeleEnStructurizr(parcAvecTypes(["Application", "Queue", "Database"]), null, "carto.xlsx");
    expect(dsl).toContain('element "Queue" {');
    expect(dsl).toContain("shape Pipe");
    expect(dsl).toContain("shape Cylinder");
  });

  it("déclare les identifiants hiérarchiques en tête du modèle", () => {
    expect(modeleEnStructurizr(parc(), null, "carto.xlsx")).toContain("!identifiers hierarchical");
  });
});
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `cd app && npx vitest run src/export/c4-dsl.test.ts`
Expected: FAIL — six échecs.

- [ ] **Step 3: Implémenter**

Modifier le fabricant de vue pour qu'il accepte un titre et l'écrive **dans** le bloc :

```ts
  const vue = (entête: string, titre: string, inclusion: string) => [
    `        ${entête} {`,
    // `title` est une INSTRUCTION du bloc. Le second argument positionnel de
    // `systemLandscape` est la description, pas le titre : le poser là aurait
    // laissé les vues nommées par leur clé technique.
    `            title "${texte(titre)}"`,
    `            include ${inclusion}`,
    "            autolayout lr",
    "        }",
  ];
```

Table de formes par défaut, **surchargée par ce que le classeur déclare** :

```ts
// Une forme par type d'acteur. La table ne fait que proposer un défaut pour
// les mots les plus courants : c'est le classeur qui nomme ses types, et un
// type inconnu reste une boîte plutôt que de se voir attribuer une forme au
// hasard.
const FORME_PAR_TYPE: Record<string, string> = {
  queue: "Pipe",
  topic: "Pipe",
  database: "Cylinder",
  storage: "Cylinder",
  person: "Person",
  humain: "Person",
  batch: "Robot",
  screen: "Window",
  browser: "WebBrowser",
};
```

Ajouter `!identifiers hierarchical` en tête du bloc `model`, `element "Platform" { background <bleu> color #ffffff }`, `relationship "Pulled" { style dashed }`, et — quand une relation porte la décision `Transform` — le tag correspondant plus `relationship "Transform" { style dotted opacity 50 }`.

- [ ] **Step 4: Vérifier que le fichier reste valide**

Le dépôt ne peut pas exécuter Structurizr. Le test tient donc lieu de garde-fou **de forme**, et la vérification de fond se fait à la main une fois : exporter depuis le classeur d'exemple et coller le résultat dans <https://structurizr.com/dsl>. Consigner dans le journal que la validation a été faite et à quelle date.

- [ ] **Step 5: Vérifier, commiter**

```bash
cd app && npx tsc --noEmit && npx vitest run
git add -A && git commit -m "feat(structurizr): views carry titles, and the notation survives the export

21 views were named by their technical key, and the Pulled tag -- posted
since day one -- had no style, so the reversed arrowhead was invisible in
the target tool. Note: the second positional argument of a view is its
DESCRIPTION; the title is a statement inside the block."
```

---

### Task 21: P10 — Kinds, formes, pointes et notation dans l'export LikeC4

LikeC4 est **la seule cible qui sache dessiner notre convention de pointe**. Trois kinds pour N types d'acteur, aucune légende, et la convention réduite à un tag.

**Files:**
- Modify: `app/src/export/likec4-dsl.ts` (bloc `specification`, relations, `vues`)
- Test: `app/src/export/likec4-dsl.test.ts`

**Ce que la documentation établit :**
- Types de pointe autorisés : **`normal, onormal, diamond, odiamond, crow, vee, open, none`**. Défaut : `head normal`, `tail none`.
- **Le style de trait par défaut est `dashed`** : il faut écrire `line solid` explicitement, sinon tous nos traits sortent en pointillé et la distinction « décision Transform » disparaît.
- `element <kind> { notation "…" ; style { shape … ; icon … ; color … } }` et `relationship <kind> { technology … ; style { … } }` dans `specification`.
- Formes : `person, rectangle, component, browser, storage, queue, cylinder, mobile`.

- [ ] **Step 1: Écrire les tests qui échouent**

```ts
describe("modeleEnLikeC4 — la notation traverse l'export", () => {
  // La seule cible qui sache dessiner notre convention : le trait suit la
  // donnée, la pointe dit qui appelle. Un flux tiré porte donc la pointe au
  // DÉBUT du trait, c'est-à-dire chez le fournisseur.
  it("pose head none / tail normal sur une technologie tirée", () => {
    const dsl = modeleEnLikeC4(parcTire("HTTP"), null, "carto.xlsx");
    expect(dsl).toMatch(/relationship http \{[\s\S]*?head none[\s\S]*?tail normal/);
  });

  it("pose head normal / tail none sur une technologie poussée", () => {
    const dsl = modeleEnLikeC4(parcPousse("Kafka"), null, "carto.xlsx");
    expect(dsl).toMatch(/relationship kafka \{[\s\S]*?head normal[\s\S]*?tail none/);
  });

  // Le style de trait par défaut de LikeC4 est `dashed` : sans `line solid`,
  // TOUS nos traits sortent en pointillé et « Transform » ne se distingue plus.
  it("écrit line solid explicitement", () => {
    expect(modeleEnLikeC4(parcPousse("Kafka"), null, "carto.xlsx")).toContain("line solid");
  });

  it("déclare un element kind par type d'acteur du classeur, avec sa notation", () => {
    const dsl = modeleEnLikeC4(parcAvecTypes(["Application", "Middleware"]), null, "carto.xlsx");
    expect(dsl).toContain("element application {");
    expect(dsl).toContain('notation "Application"');
    expect(dsl).toContain("element middleware {");
  });

  // Les groupes sont DÉJÀ des éléments du modèle exporté : il ne manquait que
  // les vues. Le commentaire qui les déclarait inexprimables vaut pour
  // Structurizr, pas pour LikeC4.
  it("produit la vue groupe à groupe et la vue plateforme détaillée", () => {
    const dsl = modeleEnLikeC4(parc(), null, "carto.xlsx");
    expect(dsl).toContain("view group_to_group {");
    expect(dsl).toContain("view platform_detail {");
  });
});
```

- [ ] **Step 2: Lancer, implémenter, vérifier**

Un `element <kind>` par type d'acteur déclaré, avec `notation "<type>"`, `style { shape … }` et `icon tech:<…>` quand la correspondance existe. Un `relationship <kind>` par technologie, portant `technology`, la couleur du référentiel, `line solid`, et `head`/`tail` selon le sens. Corriger au passage le commentaire `likec4-dsl.ts:165-168`, qui déclare les deux vues agrégées inexprimables : c'est vrai de Structurizr, pas de LikeC4.

- [ ] **Step 3: Vérifier le fichier à la main une fois**

Coller l'export du classeur d'exemple dans <https://likec4.dev/playground/> et vérifier que les deux nouvelles vues s'affichent et que la pointe d'un flux HTTP est bien du côté du fournisseur. Consigner dans le journal.

- [ ] **Step 4: Commit**

```bash
cd app && npx tsc --noEmit && npx vitest run
git add -A && git commit -m "feat(likec4): the tool that can draw our arrowhead convention is finally told

head/tail per technology, one element kind per declared actor type with its
notation, and the two aggregated views -- the groups were already elements
of the exported model, only the views were missing. line solid is explicit:
LikeC4 defaults to dashed."
```

---

### Task 22: P11 — Légende et cartouche dans le fichier draw.io

23 pages sans légende ni titre, et draw.io est justement le format destiné à circuler.

**Files:**
- Modify: `app/src/export/drawio-export.ts:85-172` (`diagramme`), `:65-83` (`construireDrawio`)
- Test: `app/src/export/drawio-export.test.ts`

**Interfaces:**
- Consumes: `entreesDeLegende` + `EntreeLegende` (Task 1), `ContexteSchema` + `libelléCartouche` (Task 3).
- `PlanchePlacée` gagne `contexte: ContexteSchema`.

**Format cible :** `mxfile > diagram > mxGraphModel > root > mxCell`. Un `mxCell` porte `id`, `value`, `style`, `vertex="1"` (ou `edge="1"`), `parent`, et contient un `<mxGeometry x y width height as="geometry"/>`. Un rectangle : `style="rounded=0;whiteSpace=wrap;html=1;fillColor=#…;strokeColor=#…"`. Un texte seul : `style="text;html=1;align=left;verticalAlign=middle;fontSize=10"`. Un trait d'échantillon : un `mxCell` `edge="1"` sans `source`/`target`, avec des points d'ancrage explicites.

- [ ] **Step 1: Écrire les tests qui échouent**

```ts
// --- §2.14 : le fichier destiné à CIRCULER partait sans légende ni titre.
describe("construireDrawio — chaque page se décrit", () => {
  it("pose le titre de la planche sur chaque page", () => {
    const xml = construireDrawio(planchesAvecContexte(), () => "#000");
    const pages = xml.split("<diagram ").slice(1);
    for (const page of pages) expect(page).toContain("milestone v2");
  });

  it("reprend la MÊME légende que le SVG, entrée pour entrée", () => {
    const planches = planchesAvecContexte();
    const attendu = entreesDeLegende(planches[0].layout.edges, planches[0].layout.nodes, () => "#000").map((e) => e.texte);
    const xml = construireDrawio(planches, () => "#000");
    for (const texte of attendu) expect(xml).toContain(texte);
  });

  // La légende ne doit pas se poser SUR le dessin : c'est un bloc à côté,
  // comme dans le SVG.
  it("pose la légende hors de la boîte englobante des nœuds", () => {
    const xml = construireDrawio(planchesAvecContexte(), () => "#000");
    const yLegende = Number(/id="legende_0"[^>]*>\s*<mxGeometry[^>]*y="(-?\d+)"/.exec(xml)![1]);
    const yMaxNoeud = Math.max(...planchesAvecContexte()[0].layout.nodes.map((n) => n.y + n.height / 2));
    expect(yLegende).toBeGreaterThanOrEqual(yMaxNoeud);
  });
});
```

- [ ] **Step 2: Lancer, implémenter, vérifier**

Réutiliser `entreesDeLegende` et `libelléCartouche` — **ne rien recalculer** : deux légendes divergentes pour un même schéma est ce que la tâche 1 est allée rendre impossible.

- [ ] **Step 3: Ouvrir le fichier une fois à la main**

Exporter depuis le classeur d'exemple et ouvrir le `.drawio` dans <https://app.diagrams.net/>. Vérifier que les 23 pages portent leur titre et leur légende, et que rien ne chevauche le dessin. Consigner dans le journal.

- [ ] **Step 4: Commit**

```bash
cd app && npx tsc --noEmit && npx vitest run
git add -A && git commit -m "feat(drawio): every page carries the same legend and title block as the SVG

23 pages went out with neither -- in the very format meant to circulate.
The entries are the shared data, not a second computation."
```

---

### Task 23: P12 — Une feuille de style d'impression, et l'échelle du PNG

Aucune règle `@media print`, et un facteur d'échelle PNG codé en dur à 2.

**Files:**
- Modify: `app/index.html` (bloc `@media print`), `app/src/ui/export-handlers.ts:81` (échelle), `app/src/ui/banner.ts` (le choix d'échelle)
- Test: `app/src/ui/export-handlers.test.ts`

**Ce que la documentation établit :** `print-color-adjust` vaut **`economy` par défaut**, ce qui autorise le navigateur à « leave out all background images and to adjust text colors » — donc à supprimer les aplats de couleur des boîtes. La propriété n'est **Baseline que depuis mai 2025** : écrire **les deux formes**, `-webkit-print-color-adjust` puis `print-color-adjust` (<https://developer.mozilla.org/en-US/docs/Web/CSS/print-color-adjust>). Et parce que `exact` reste une *demande* que l'utilisateur peut désactiver, la notation ne doit de toute façon pas reposer sur la seule couleur — ce que les tâches 2 et 9 ont réglé.

- [ ] **Step 1: Écrire le test qui échoue**

```ts
// L'échelle du PNG était codée en dur à 2. Un schéma d'architecture est du
// trait fin avec de petits caractères : c'est le cas où 600 dpi paie encore.
it("exporte le PNG à l'échelle choisie", async () => {
  const { handlers } = contexte(withOptions(chargé(), { echellePng: 4 }));
  await handlers.onExportPng();
  expect(dernierAppelExportPng().scale).toBe(4);
});

it("garde 2 comme échelle par défaut", async () => {
  const { handlers } = contexte(chargé());
  await handlers.onExportPng();
  expect(dernierAppelExportPng().scale).toBe(2);
});
```

- [ ] **Step 2: Lancer, implémenter, vérifier**

`AppOptions` gagne `echellePng: 1 | 2 | 4` (défaut `2`). Le bandeau propose le choix à côté du bouton PNG.

- [ ] **Step 3: Écrire la feuille d'impression**

Dans `app/index.html` :

```css
@media print {
  .bandeau, .rail { display: none; }
  .zone-rendu { overflow: visible; padding: 0; background: none; }
  .zone-rendu svg { max-width: 100%; height: auto; page-break-inside: avoid; }
  /* `economy` -- la valeur par défaut -- autorise le navigateur à supprimer
     les aplats de couleur des boîtes et à « corriger » les textes. Les deux
     écritures : la propriété n'est Baseline que depuis mai 2025. */
  .zone-rendu { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  /* Une matrice de 143 cases tient rarement sur une page : sans cette règle,
     les pages suivantes sortent sans en-têtes et deviennent illisibles. */
  table.matrice thead { display: table-header-group; }
  table.matrice tr { page-break-inside: avoid; }
}
@page { size: A4 landscape; margin: 10mm; }
```

- [ ] **Step 4: Vérifier dans Chrome**

Ouvrir l'aperçu avant impression sur « Platform detail » puis sur « Matrix », et vérifier que le rail et le bandeau ont disparu, que les aplats sont conservés, et que les en-têtes de la matrice se répètent.

- [ ] **Step 5: Commit**

```bash
cd app && npx tsc --noEmit && npx vitest run
git add -A && git commit -m "feat(print): a print stylesheet, and a PNG scale that is chosen

print-color-adjust defaults to economy, which lets the browser drop the box
fills entirely. Both spellings are written: the property is only Baseline
since May 2025."
```

---

# Phase 5 — Le vocabulaire des deux lectures

### Task 24: P14a — Nommer les deux lectures, et dire ce qu'un lien fonctionnel affirme

Les deux lectures sont justes et n'empruntent pas le vocabulaire que leurs lecteurs possèdent déjà. Et rabattre une chaîne est la **PDR 10 d'ArchiMate**, que la norme classe comme dérivation *potentielle* pouvant être fausse — l'outil a la donnée pour le dire (décision `Transform`) et ne le dit pas.

**Files:**
- Modify: `app/src/ui/rail.ts:81-93` (sous-titres), `app/src/render/aide.ts` (deux paragraphes)
- Test: `app/src/ui/rail.test.ts`, `app/src/render/render.test.ts`

- [ ] **Step 1: Écrire les tests qui échouent**

```ts
it("sous-titre les deux lectures dans le vocabulaire des architectes", () => {
  const root = rendu(état());
  const options = [...root.querySelectorAll("select.rail-selecteur option")].map((o) => o.textContent);
  expect(options).toContain("Architecture — application interfaces (how it travels)");
  expect(options).toContain("Functional — application services (who feeds whom)");
});

// La page d'aide doit rattacher les deux lectures à un vocabulaire existant,
// et dire ce qu'un lien rabattu affirme -- et ce qu'il n'affirme pas.
it("rattache les deux lectures aux viewpoints ArchiMate et prévient sur la dérivation", () => {
  const texte = buildAide().textContent ?? "";
  expect(texte).toContain("Application Cooperation");
  expect(texte).toContain("Application Usage");
  expect(texte).toContain("it says the information travels, not that it arrives unchanged");
});
```

- [ ] **Step 2: Lancer, implémenter, vérifier**

Dans `aide.ts`, ajouter au chapitre des lectures :

> These two readings match the ArchiMate *Application Cooperation* and *Application Usage* viewpoints. Folding a chain of flows into a single link is ArchiMate's potential derivation rule 10 — the standard warns it may be wrong. Where the chain crosses a link whose decision is *Transform*, the line is drawn dashed: it says the information travels, not that it arrives unchanged.

- [ ] **Step 3: Commit**

```bash
cd app && npx tsc --noEmit && npx vitest run
git add -A && git commit -m "docs(ui): name the two readings in the vocabulary their readers already own

And say plainly what a folded link asserts: folding a chain is ArchiMate's
potential derivation rule 10, which the standard warns may be wrong. The
dashed line already carried the caveat; nothing said so."
```

---

### Task 25: P14b — Rouvrir ce que la précaution avait fermé

Deux fonctionnalités sont désactivées par un motif contestable : les exports C4 en lecture fonctionnelle, et « Group to group » en fonctionnel.

**Files:**
- Modify: `app/src/ui/banner.ts:51-52`, `app/src/ui/state.ts:184-198` (`VUES_SANS_OBJET_EN_FONCTIONNEL`), `app/src/export/c4-dsl.ts`, `app/src/export/likec4-dsl.ts`
- Test: `app/src/ui/banner.test.ts`, `app/src/ui/state.test.ts`, `app/src/export/c4-dsl.test.ts`

**Le raisonnement, à assumer :** « un schéma fonctionnel n'est pas une architecture C4 » ne tient pas — un système qui rend un service à un autre est le cas d'usage central d'un `systemLandscape`. Ce qu'on s'interdit, c'est de livrer un fichier qui raconte autre chose que l'écran ; il suffit donc que le fichier **dise ce qu'il est**.

- [ ] **Step 1: Écrire les tests qui échouent**

```ts
it("propose Structurizr et LikeC4 en lecture fonctionnelle", () => {
  const s = withMode(chargé(), "fonctionnel");
  expect(actif("Structurizr", s)).toBe(true);
  expect(actif("LikeC4", s)).toBe(true);
});

// Le fichier doit DIRE ce qu'il est : sans ça, il raconte autre chose que
// l'écran, ce qu'on s'interdit partout ailleurs.
it("annonce la lecture fonctionnelle dans le fichier produit", () => {
  const dsl = modeleEnStructurizr(parc(), null, "carto.xlsx", { mode: "fonctionnel" });
  expect(dsl).toContain("(functional reading)");
  expect(dsl).not.toMatch(/"HTTP"/);
});

it("propose « Group to group » en lecture fonctionnelle", () => {
  expect(vuesDisponibles(withMode(chargé(), "fonctionnel"))).toContain("groupe-a-groupe");
});
```

- [ ] **Step 2: Lancer, implémenter, vérifier**

Les deux exports prennent le mode : nom de workspace suffixé `(functional reading)`, relations **sans** `technology` (elle est vide en fonctionnel), et un `!const READING "functional"` en tête. Retirer `"groupe-a-groupe"` de `VUES_SANS_OBJET_EN_FONCTIONNEL` — « quelle direction alimente quelle direction » est précisément la question d'un comité de direction, et c'est la seule vue qui y réponde.

- [ ] **Step 3: Vérifier dans Chrome**

Basculer en lecture fonctionnelle et vérifier que les sept boutons d'export sont actifs, puis que « Group to group » figure au rail et produit un schéma non vide.

- [ ] **Step 4: Commit**

```bash
cd app && npx tsc --noEmit && npx vitest run
git add -A && git commit -m "feat(export): the functional reading may leave the tool, saying what it is

Two features were switched off by precaution. A system rendering a service
to another is the central use of a systemLandscape; what we forbid is a file
that tells a different story from the screen, so the file now says which
reading it carries."
```

---

# Phase 6 — Les ajouts de valeur

### Task 26: A1 — La vue « Chaîne » : suivre un échange de bout en bout

L'outil possède déjà l'information la plus difficile à obtenir — le chemin complet d'un échange à travers la plomberie — et **la jette** : `remonter()` (`fonctionnel.ts:97-118`) reconstruit le trajet segment par segment et `buildFunctionalFlows` n'en garde que les extrémités. Sur le classeur d'exemple, un échange traverse Kafka puis l'ESB : la chaîne fait trois maillons et personne ne peut la voir.

**Files:**
- Create: `app/src/aggregation/chaine.ts`, `app/src/aggregation/chaine.test.ts`
- Modify: `app/src/aggregation/fonctionnel.ts:97-161` (rendre le chemin), `app/src/ui/state.ts` (`Vue` gagne `"chaine"`), `app/src/ui/rail.ts`, `app/src/ui/app.ts`, `app/src/export/c4-dsl.ts` et `likec4-dsl.ts` (vues dynamiques)
- Test: `app/src/aggregation/chaine.test.ts`, `app/src/aggregation/fonctionnel.test.ts`

**Interfaces:**
- Produces: `interface Maillon { exposant: string; consommateur: string; interfaceNom: string; version: string; technologie: string; atténué: boolean }` ; `chaineDuFlux(model, rang, flux: FlowInstance): Maillon[]` ; `toutesLesChaines(model, rang): { flux: FlowInstance; maillons: Maillon[] }[]`.
- `remonter()` rend désormais `{ sources: InterfaceCatalogue[]; chemins: Map<InterfaceCatalogue, InterfaceCatalogue[]>; coupures: ChaineCoupee[] }`.

**Pourquoi c'est la proposition la plus précieuse du lot :** c'est la question qu'on pose en incident — « par où passe ce flux ? » — et à laquelle aucune vue ne répond. C'est **littéralement** une vue dynamique C4 (« A dynamic view allows you to override the relationship description, to better describe the interaction in the context of the behaviour you're diagramming » — <https://c4model.com/diagrams/dynamic>), donc elle s'exporte telle quelle en `dynamic <scope> { … }` (Structurizr) et `dynamic view { … }` (LikeC4), ce qui comble d'un coup le principal trou des deux exports.

- [ ] **Step 1: Écrire les tests qui échouent**

```ts
describe("chaineDuFlux", () => {
  // Le terrain du classeur d'exemple : Boreal publie sur Kafka, l'ESB relaie,
  // un consommateur métier reçoit. Trois maillons, deux technologies.
  it("rend un maillon par segment, dans l'ordre du parcours", () => {
    const m = parcTroisMaillons();
    const maillons = chaineDuFlux(m, null, fluxFonctionnel(m));
    expect(maillons.map((x) => [x.exposant, x.consommateur])).toEqual([
      ["Boreal", "Kafka"], ["Kafka", "ESB"], ["ESB", "Onderon"],
    ]);
  });

  // Le nom sous lequel l'échange circule change en route : c'est précisément
  // ce qu'on veut voir, et ce que la vue fonctionnelle efface.
  it("porte sur chaque maillon le nom et la technologie de CE segment", () => {
    const m = parcTroisMaillons();
    const maillons = chaineDuFlux(m, null, fluxFonctionnel(m));
    expect(maillons.map((x) => x.technologie)).toEqual(["Kafka", "Kafka", "HTTP"]);
    expect(maillons.map((x) => x.interfaceNom)).toEqual(["Policy events", "Policy stream", "Policy feed"]);
  });

  // Un lien direct est une chaîne d'un seul maillon : pas un cas particulier.
  it("rend un seul maillon pour un lien direct", () => {
    expect(chaineDuFlux(parcDirect(), null, fluxDirect())).toHaveLength(1);
  });

  // L'atténuation se propage : si un maillon transforme, la chaîne le dit à
  // cet endroit précis, pas globalement.
  it("marque le maillon qui transforme, et lui seul", () => {
    const m = parcAvecTransform();
    expect(chaineDuFlux(m, null, fluxFonctionnel(m)).map((x) => x.atténué)).toEqual([false, true, false]);
  });
});
```

- [ ] **Step 2: Lancer, faire rendre le chemin par `remonter()`, vérifier**

`remonter()` porte déjà `chemin` pour distinguer un losange d'une boucle ; il s'agit de le **rendre** au lieu de le jeter. Attention à ne pas casser la distinction losange/boucle en route : les tests de `fonctionnel.test.ts` la couvrent, ils doivent rester verts **sans modification**.

- [ ] **Step 3: Câbler la vue**

`Vue` gagne `"chaine"`, `LIBELLE_VUE` gagne `chaine: "Chain"`. Le rail propose un sélecteur d'échange (`Chandrila → Onderon : Policy events 1.0`). Le dessin passe par le pipeline existant : `elk.direction: RIGHT`, un rang par segment, **zéro croisement par construction** puisqu'il n'y a qu'un chemin.

- [ ] **Step 4: Exporter en vues dynamiques**

Structurizr : `dynamic <scope> { 1: a -> b "…" ; 2: b -> c "…" ; autoLayout lr }`. LikeC4 : `dynamic view chain_<id> { a -> b "…" … }`. Une vue par chaîne de plus d'un maillon.

- [ ] **Step 5: Vérifier, commiter**

```bash
cd app && npx tsc --noEmit && npx vitest run
git add -A && git commit -m "feat(view): Chain -- follow one exchange end to end

The tool already rebuilt the full path through the plumbing, segment by
segment, and threw it away to keep only the two ends. This is the question
asked during an incident, and it is literally a C4 dynamic view, so it
exports as one -- filling the main gap of both DSL exports."
```

- [ ] **Step 6: Vérifier dans Chrome**

Ouvrir « Chain », choisir l'échange qui traverse Kafka puis l'ESB, et vérifier trois boîtes, deux traits, et une technologie nommée sur chaque segment.

---

### Task 27: A2 — Le rayon d'impact

Le graphe de dépendances existe (`integrity/checks.ts:862-896`, `atteignables()` fait déjà le parcours) et ne sert qu'à détecter les cycles.

**Files:**
- Create: `app/src/aggregation/impact.ts`, `app/src/aggregation/impact.test.ts`
- Modify: `app/src/aggregation/views.ts:218-266` (`buildByActorView` : paramètre `voisinage`), `app/src/ui/rail.ts`, `app/src/integrity/checks.ts` (bloc informatif « Blast radius »)
- Test: `app/src/aggregation/impact.test.ts`, `app/src/aggregation/views.test.ts`

**Interfaces:**
- Produces: `export type Voisinage = "direct" | "amont" | "aval"` ; `rayon(flux: FlowInstance[], depart: string, sens: Voisinage): Map<string, number>` — l'acteur vers sa distance en sauts (0 pour le départ).
- `OptionsVueActeur` gagne `voisinage?: Voisinage` (défaut `"direct"`).

**Fondement :** c'est du *degree-of-interest* au sens de Furnas (« Generalized fisheye views », CHI '86, <https://doi.org/10.1145/22627.22342>), et van Ham & Perer (IEEE TVCG 15(6), 2009, <https://doi.org/10.1109/TVCG.2009.108>) montrent que c'est la stratégie qui tient sur les grands graphes, là où l'« overview first » de Shneiderman ne tient pas : on part d'un point d'intérêt et on étend.

- [ ] **Step 1: Écrire les tests qui échouent**

```ts
describe("rayon", () => {
  // A -> B -> C, et D -> A.
  const flux = [lien("A", "B"), lien("B", "C"), lien("D", "A")];

  it("compte le départ à zéro saut", () => {
    expect(rayon(flux, "A", "aval").get("A")).toBe(0);
  });

  it("suit l'aval transitivement, en comptant les sauts", () => {
    expect([...rayon(flux, "A", "aval").entries()].sort()).toEqual([["A", 0], ["B", 1], ["C", 2]]);
  });

  it("suit l'amont dans l'autre sens", () => {
    expect([...rayon(flux, "A", "amont").keys()].sort()).toEqual(["A", "D"]);
  });

  it("ne garde que les voisins immédiats en direct", () => {
    expect([...rayon(flux, "A", "direct").keys()].sort()).toEqual(["A", "B", "D"]);
  });

  // Un cycle ne doit pas boucler : le classeur d'exemple en contient un, à
  // quatre composants, signalé par les contrôles.
  it("termine sur un cycle", () => {
    expect(rayon([lien("A", "B"), lien("B", "A")], "A", "aval").get("B")).toBe(1);
  });
});
```

- [ ] **Step 2: Lancer, implémenter, vérifier**

- [ ] **Step 3: Colorer par distance et ajouter le bloc informatif**

Dans la vue par acteur, atténuer selon la distance (1 saut plein, 2 sauts à 70 %, 3+ à 45 %). Ajouter au rapport un bloc « Blast radius » : pour chaque acteur, le nombre d'acteurs en aval, trié décroissant. Sur l'exemple, `Chandrila` a un degré sortant de 6 et entrant de 4 — c'est le moyeu, et rien ne le nomme aujourd'hui.

- [ ] **Step 4: Vérifier, commiter**

```bash
cd app && npx tsc --noEmit && npx vitest run
git add -A && git commit -m "feat(view): blast radius -- if X goes down, who is hit

The dependency walk existed and only served cycle detection. Upstream and
downstream neighbourhoods, shaded by hop distance: degree-of-interest, the
strategy that holds on large graphs where overview-first does not."
```

---

### Task 28: A3 — Une lecture par la criticité

`Consommation.criticite` est saisie, contrôlée, exportée en propriété — et **jamais dessinée**. C'est la donnée la plus décisionnelle du classeur.

**Files:**
- Modify: `app/src/aggregation/core.ts` (porter la criticité sur `EdgeGroup`/`GraphEdge`), `app/src/render/svg-builder.ts` (graisse du trait), `app/src/ui/rail.ts`, `app/src/ui/state.ts`, `app/src/export/c4-dsl.ts`, `app/src/export/likec4-dsl.ts`
- Test: `app/src/aggregation/core.test.ts`, `app/src/render/svg-builder.test.ts`

**Interfaces:**
- Produces: `GraphEdge` gagne `criticite?: string` — **la plus forte** des consommations agrégées sur ce trait. `AppOptions` gagne `graisseParCriticite: boolean` (défaut `false`). `buildGraphSvg` gagne un quatrième paramètre optionnel `options?: { graisseParCriticite?: boolean }`.

**Le raisonnement, à assumer :** `ÉPAISSEUR_TRAIT` est volontairement uniforme (`svg-builder.ts:43-49` : « le volume se lit dans le ×N du libellé, pas dans la graisse du trait »). **Ce raisonnement était juste pour le VOLUME et ne vaut pas pour un ORDRE.** La graisse est la variable de Bertin faite pour l'ordre. D'où le réglage explicite, désactivé par défaut : les deux usages ne se mélangent pas.

- [ ] **Step 1: Écrire les tests qui échouent**

```ts
it("porte sur le trait la criticité la plus forte des consommations agrégées", () => {
  const g = groupFlows(fluxAvecCriticites(["3 - Standard", "1 - Critical", "2 - Important"]), identityNodeKey, true)[0];
  expect(g.criticite).toBe("1 - Critical");
});

it("épaissit le trait critique quand le réglage est actif", () => {
  const svg = buildGraphSvg(layoutAvecArête({ criticite: "1 - Critical" }), () => "#111", null, { graisseParCriticite: true });
  expect(Number(svg.querySelector(".fx-aretes path")!.getAttribute("stroke-width"))).toBeGreaterThan(2);
});

it("garde une graisse uniforme quand le réglage est inactif", () => {
  const svg = buildGraphSvg(layoutAvecArête({ criticite: "1 - Critical" }), () => "#111", null);
  expect(svg.querySelector(".fx-aretes path")!.getAttribute("stroke-width")).toBe("2");
});
```

- [ ] **Step 2: Lancer, implémenter, vérifier**

3 px pour `1 - Critical`, 2 px pour `2 - Important`, 1 px pour `3 - Standard`. Ajouter les trois entrées à la légende (tâche 1) — **une graisse non annoncée est une notation muette**.

- [ ] **Step 3: Exporter la criticité**

Structurizr : `perspectives { Criticality "…" }` sur la relation (<https://docs.structurizr.com/dsl/cookbook/perspectives-static/>). LikeC4 : `metadata { criticality "1 - Critical" }`.

- [ ] **Step 4: Vérifier, commiter**

```bash
cd app && npx tsc --noEmit && npx vitest run
git add -A && git commit -m "feat(view): draw the criticality the workbook has always carried

Criticality is entered, checked and exported as a property, and never drawn.
Stroke weight is Bertin's variable for order -- the uniform-weight rule was
right about volume and does not hold for an order. Off by default."
```

---

### Task 29: A4 — La frise des paliers

L'axe du temps est une liste déroulante : on ne voit jamais le temps.

**Files:**
- Create: `app/src/aggregation/frise.ts`, `app/src/render/frise.ts`, et leurs tests
- Modify: `app/src/ui/state.ts` (`Vue` gagne `"frise"`), `app/src/ui/rail.ts`, `app/src/ui/app.ts`
- Test: `app/src/aggregation/frise.test.ts`, `app/src/render/frise.test.ts`

**Interfaces:**
- Produces: `interface SegmentFrise { libellé: string; catégorie: "acteur" | "interface"; debut: number; fin: number; ouvertADroite: boolean }` ; `construireFrise(model: ParsedModel, quoi: "acteurs" | "interfaces"): { paliers: Palier[]; segments: SegmentFrise[] }`.

**Décision de conception :** **pas d'ELK.** C'est une grille — un axe, une ligne par sujet — pas un graphe. Passer par le moteur de placement coûterait cher et donnerait un moins bon résultat.

- [ ] **Step 1: Écrire les tests qui échouent**

```ts
describe("construireFrise", () => {
  it("rend un segment par ligne, borné par ses paliers", () => {
    const f = construireFrise(modeleTroisPaliers(), "interfaces");
    expect(f.segments.find((s) => s.libellé.startsWith("Member lookup 1.0"))).toMatchObject({ debut: 1, fin: 2 });
  });

  // Une ligne sans palier de retrait court jusqu'au bout : c'est la lecture
  // « toujours là », et il faut le DESSINER comme tel, pas l'arrêter au
  // dernier palier connu comme si elle y mourait.
  it("marque comme ouverte à droite une ligne sans palier de retrait", () => {
    const f = construireFrise(modeleTroisPaliers(), "interfaces");
    expect(f.segments.find((s) => s.libellé.startsWith("Member lookup 2.0"))?.ouvertADroite).toBe(true);
  });

  // Le recouvrement de deux versions est exactement ce qu'on vient voir.
  it("laisse voir deux versions qui coexistent", () => {
    const [a, b] = construireFrise(modeleMigrationRecouvrante(), "interfaces").segments;
    expect(Math.max(a.debut, b.debut)).toBeLessThan(Math.min(a.fin, b.fin));
  });
});
```

- [ ] **Step 2: Lancer, implémenter, vérifier**

- [ ] **Step 3: Dessiner**

Un axe horizontal gradué par palier (nom + date, lues dans l'onglet `Milestones`), une ligne par sujet, un rectangle par segment. Un segment ouvert à droite se termine par une pointe, pas par un bord franc. Le palier affiché est marqué d'une verticale.

- [ ] **Step 4: Vérifier, commiter**

```bash
cd app && npx tsc --noEmit && npx vitest run
git add -A && git commit -m "feat(view): Roadmap -- the milestone axis becomes a picture

The timeline was a dropdown, so the time was never visible. One bar per
interface between its introduction and retirement milestones: overlapping
versions and migrations under way become obvious. No ELK -- it is a grid."
```

---

### Task 30: A5 — La planche « Contexte » d'un acteur

C4 décrit exactement la vue à faire quand un diagramme unique devient trop grand : « 8 diagrams that each focus on a single service, showing the nearest **afferent (inbound)** and **efferent (outbound)** dependencies » (<https://c4model.com/faq>). C'est « By actor » ; il lui manque trois choses.

**Files:**
- Modify: `app/src/ui/rail.ts:226-239` (champ de recherche au lieu d'une liste déroulante), `app/src/render/cartouche.ts` (mention amont/aval)
- Test: `app/src/ui/rail.test.ts`, `app/src/render/cartouche.test.ts`

- [ ] **Step 1: Écrire les tests qui échouent**

```ts
// Une liste déroulante de N acteurs ne se parcourt pas au-delà de vingt.
it("propose un champ de recherche filtrant plutôt qu'une liste déroulante", () => {
  expect(rendu(étatParActeur()).querySelector("input.rail-recherche")).not.toBeNull();
});

it("ne propose que les acteurs dont le nom contient la saisie", () => {
  const root = rendu(étatParActeur());
  const champ = root.querySelector("input.rail-recherche") as HTMLInputElement;
  champ.value = "kaf";
  champ.dispatchEvent(new Event("input", { bubbles: true }));
  expect([...root.querySelectorAll(".rail-suggestion")].map((e) => e.textContent)).toEqual(["Kafka"]);
});

// Le cartouche doit dire ce que la planche montre : les entrants à gauche,
// les sortants à droite. elk.direction: RIGHT le fait déjà, rien ne le dit.
it("dit dans le cartouche que la planche est une vue de contexte", () => {
  expect(libelléCartouche(ctxParActeur()).titre).toContain("inbound left, outbound right");
});
```

- [ ] **Step 2: Lancer, implémenter, vérifier**

Le champ filtre sans casse ni accents (`normalizeText` est déjà écrit). La sélection reste dans `state.selectionActeur` — **ne pas dupliquer l'état**.

- [ ] **Step 3: Commit**

```bash
cd app && npx tsc --noEmit && npx vitest run
git add -A && git commit -m "feat(ui): the by-actor board becomes a proper C4 context view

A search field instead of a dropdown of N actors, and a title block that
says what the board shows: nearest inbound on the left, outbound on the
right -- which elk.direction RIGHT already did without telling anyone."
```

---

### Task 31: A6 — Comparer deux classeurs

`calculerEcarts` (`ecarts.ts:53-59`) compare deux rangs du même modèle. La même fonction, sur deux `ParsedModel`, comparerait deux fichiers : « ce qui a changé depuis la version de janvier ».

**Files:**
- Modify: `app/src/aggregation/ecarts.ts:53-121`, `app/src/ui/state.ts` (un second fichier), `app/src/ui/drop-zone.ts`, `app/src/ui/rail.ts`
- Test: `app/src/aggregation/ecarts.test.ts`, `app/src/ui/state.test.ts`

**Interfaces:**
- Produces: `calculerEcarts(avant: { model: ParsedModel; rang: number | null }, après: { model: ParsedModel; rang: number | null }, mode: Mode)` — le modèle devient un paramètre au lieu d'être implicite.
- `AppState` gagne `fichierCompare: FichierCharge | null`.

- [ ] **Step 1: Écrire les tests qui échouent**

```ts
it("compare deux modèles distincts, pas seulement deux rangs du même", () => {
  const é = calculerEcarts({ model: janvier(), rang: null }, { model: juin(), rang: null }, "architecture");
  expect(é.ajouts.map((a) => a.interfaceNom)).toContain("Claims 2.0");
  expect(é.retraits.map((r) => r.interfaceNom)).toContain("Legacy batch 1.0");
});

// Un acteur qui n'existe que dans l'un des deux ne doit pas faire échouer le
// calcul : c'est le cas NORMAL quand on compare deux versions d'un référentiel.
it("supporte un acteur absent de l'un des deux classeurs", () => {
  expect(() => calculerEcarts({ model: janvier(), rang: null }, { model: juin(), rang: null }, "architecture")).not.toThrow();
});
```

- [ ] **Step 2: Lancer, implémenter, vérifier**

Le dépôt d'un second fichier est déjà câblé (`ui/drop-zone.ts`) : il s'agit de le ranger dans `fichierCompare` plutôt que de remplacer le courant, et de proposer dans le rail « Compare with: <second file> » à côté du sélecteur de palier.

- [ ] **Step 3: Commit**

```bash
cd app && npx tsc --noEmit && npx vitest run
git add -A && git commit -m "feat(view): Changes can compare two workbooks, not only two milestones

Same function, one more parameter: the model stops being implicit."
```

---

### Task 32: A7 — Exporter la carte en PDF paginé

Le livrable qu'on joint à un dossier d'architecture. Faisable **sans dépendance** : `window.print()` sur un DOM assemblé pour l'occasion, avec la feuille de style de la tâche 23.

**Files:**
- Create: `app/src/export/pdf-export.ts`, `app/src/export/pdf-export.test.ts`
- Modify: `app/index.html` (règles `@media print` du document assemblé), `app/src/ui/banner.ts` (un huitième format)
- Test: `app/src/export/pdf-export.test.ts`

**Interfaces:**
- Produces: `construireDocumentImprimable(planches: PlanchePlacée[], rapport: IntegrityReport, contexte: ContexteSchema): HTMLElement`.
- Consumes: `toutesLesPlanches`, `buildGraphSvg` avec contexte (Task 3), `sectionsDuRapport` (`render/integrity-report.ts`).

- [ ] **Step 1: Écrire les tests qui échouent**

```ts
it("pose une planche par page, chacune avec son cartouche", () => {
  const doc = construireDocumentImprimable(troisPlanches(), rapportVide(), ctx());
  const pages = doc.querySelectorAll(".page-impression");
  expect(pages).toHaveLength(4); // trois planches + le rapport en annexe
  for (const p of [...pages].slice(0, 3)) expect(p.querySelector("svg > title")).not.toBeNull();
});

// Le rapport en annexe : un dossier d'architecture qui montre les schémas
// sans dire ce que le classeur a d'incohérent affirme plus qu'il ne sait.
it("met le rapport d'intégrité en annexe, dans le même ordre qu'à l'écran", () => {
  const rapport = rapportAvecDeuxSections();
  const titres = [...construireDocumentImprimable(troisPlanches(), rapport, ctx()).querySelectorAll(".annexe h2")].map((h) => h.textContent);
  expect(titres).toEqual(sectionsDuRapport(rapport).filter((s) => s.items.length).map((s) => `${s.titre} (${s.items.length})`));
});
```

- [ ] **Step 2: Lancer, implémenter, vérifier**

Chaque page porte `page-break-after: always` ; **la dernière ne l'a pas**, sans quoi le PDF sort avec une page blanche finale.

- [ ] **Step 3: Vérifier dans Chrome**

Déclencher l'export, ouvrir l'aperçu d'impression, et compter les pages. **Vérifier qu'aucune n'est vide** et qu'aucun schéma n'est coupé en deux.

- [ ] **Step 4: Commit**

```bash
cd app && npx tsc --noEmit && npx vitest run
git add -A && git commit -m "feat(export): a paginated PDF, one board per page, report in appendix

window.print() on a DOM assembled for the occasion -- no dependency in a
single-file deliverable."
```

---

## Auto-revue du plan

**1. Couverture de la spec.** Les quatorze propositions et les sept ajouts ont chacun leur tâche :

| Spec | Tâche(s) | Spec | Tâche(s) |
|---|---|---|---|
| P1 | T3 | P9 | T20 |
| P2 | T1, T2 | P10 | T21 |
| P3 | T7, T8 | P11 | T22 |
| P4 | T4, T5, T6 | P12 | T23 |
| P5 | T10, T11, T12 | P13 | T16 |
| P6 | T17, T18, T19 | P14 | T24, T25 |
| P7 | T13, T14, T15 | A1–A7 | T26–T32 |
| P8 | T9 | | |

**2. Ce que le plan écarte délibérément, et pourquoi.** Les neuf points du §5 du rapport (D1 à D9) ne reçoivent **aucune tâche** : edge bundling, épaisseur proportionnelle au volume, layout force-directed, navigation clavier complète dans le SVG, modèle de déploiement, niveau Container de C4, mode sombre des schémas, multiplication des vues, `elk.layered.mergeEdges`. Deux méritent d'être redits ici parce qu'ils ressembleront à des oublis : **la navigation clavier complète dans le SVG a été explicitement écartée par l'utilisateur** — elle ne doit pas revenir par la fenêtre, et les tâches 3 et 17 ne font que nommer et structurer, sans ajouter aucun parcours au clavier ; et **l'épaisseur variable de trait** revient en T28, mais pour un **ordre** (la criticité) et non pour un **volume**, ce qui est précisément la distinction que D2 pose.

**3. Cohérence des types entre tâches.** Vérifié : `EntreeLegende` (T1) est consommée telle quelle par T2, T9, T22 et T28 ; `ContexteSchema` (T3) par T22, T30 et T32 ; `ratioDeContraste` (T4) par T6 ; `LayoutResult` (T11) par T12 ; `MatrixResult` enrichi (T17) par T19 ; `OrdreMatrice` (T17) par T18 ; `Voisinage` (T27) reste local à `buildByActorView`. Trois signatures publiques changent, chacune **en ajoutant un paramètre optionnel** pour ne casser aucun appelant : `buildGraphSvg` (T3 puis T28), `computeLayout` (T11), `libelleCellule` (T8). `calculerEcarts` (T31) est la seule dont la forme change — c'est assumé, elle n'a que deux appelants.

**4. Points où l'implémenteur doit s'arrêter et demander** plutôt que trancher seul : si la mesure de T11 montre que le mode interactif dégrade les croisements de plus de 15 % — le choix entre vivre avec et basculer sur T12 engage la lisibilité de toutes les vues ; si T15 ne trouve aucune combinaison meilleure que le témoin — ne rien changer est alors la réponse, et il faut l'écrire ; si T18 fait apparaître la bande diagonale dont la revue avertit — RCM serait alors à retirer de la liste des ordres proposés plutôt qu'à garder par principe.
