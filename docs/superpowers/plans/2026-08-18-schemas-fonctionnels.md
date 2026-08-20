# Schémas fonctionnels — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter au lecteur de cartographie un mode « Fonctionnel » qui masque les acteurs techniques et fusionne les médias, en dérivant les liens métier par traversée des chaînes de relais.

**Architecture:** La dérivation vit dans un module neuf, `aggregation/fonctionnel.ts`, qui rend des `FlowInstance` de même forme que `buildFlowInstances` — technologie vidée. Les vues existantes tournent dessus sans savoir qu'elles ont changé de mode, exactement comme le filtrage par palier s'applique en amont d'elles. Le mode entre dans `AggregationOptions` et dans `AppState` ; deux colonnes entrent dans le classeur, ce qui fait monter le schéma en v3.

**Tech Stack:** TypeScript, Vitest, esbuild, SheetJS (`xlsx`), elkjs. Aucune dépendance nouvelle.

**Spec:** `docs/superpowers/specs/2026-08-18-schemas-fonctionnels-design.md`

## Global Constraints

- Livrable : un `.html` unique et autonome. `npm run build` produit `app/dist/carte-des-interfaces.html`.
- Tests : `npx vitest run` depuis `app/`. Typage : `npx tsc --noEmit`. Les deux doivent passer avant chaque commit.
- TDD strict : le test échoue d'abord, on vérifie qu'il échoue, puis on implémente.
- Le classeur et l'interface sont en **anglais** ; le code et les commentaires en **français**. Commits en anglais, style conventionnel.
- Vocabulaire fermé de `Nature` : exactement `Business` et `Technical`.
- Nature vide ⇒ métier. Aucune nature n'est devinée d'après le nom d'un type.
- `VERSION_MODELE` passe de `2` à `3`. L'étape `2 → 3` est l'identité sur le modèle.
- Les commentaires expliquent POURQUOI, jamais QUOI. Ne pas commenter du code non modifié.
- Chaque tâche se vérifie aussi dans Chrome quand elle touche l'interface (serveur local sur `http://127.0.0.1:8931/app/dist/carte-des-interfaces.html`, chargement par glisser-déposer synthétique).

---

## Structure des fichiers

| Fichier | Responsabilité |
|---|---|
| `app/src/parsing/model.ts` | Ajoute `nature` à `TypeActeur`, `relais` à `InterfaceCatalogue` |
| `app/src/parsing/build-model.ts` | Lit les deux colonnes ; `VERSION_MODELE = 3` |
| `app/src/aggregation/nature.ts` | **Créé** — qui est technique, qui est métier |
| `app/src/aggregation/fonctionnel.ts` | **Créé** — la traversée des chaînes de relais |
| `app/src/aggregation/core.ts` | La clé de fusion ignore la technologie en mode fonctionnel |
| `app/src/aggregation/views.ts` | Les vues choisissent leur source de flux selon le mode |
| `app/src/aggregation/planches.ts` | La liste des planches suit le mode |
| `app/src/integrity/checks.ts` | Les huit contrôles |
| `app/src/export/template-export.ts` | Les deux colonnes à l'écriture, vocabulaire et validation |
| `app/src/export/migration-modele.ts` | L'étape `2 → 3` |
| `app/src/export/filename.ts` | Le mode dans le nom de fichier |
| `app/src/ui/state.ts` | `mode` dans `AppState` |
| `app/src/ui/rail.ts` | Le sélecteur de mode, « Par technologie » retirée |
| `app/src/ui/banner.ts` | Les deux boutons DSL inertes en fonctionnel |
| `app/src/ui/app.ts` | Le mode traverse le rendu et les exports |

---

## Task 1 : le modèle porte la nature et le relais

**Files:**
- Modify: `app/src/parsing/model.ts`
- Modify: `app/src/parsing/build-model.ts`
- Test: `app/src/parsing/build-model.test.ts`

**Interfaces:**
- Consumes: rien.
- Produces: `TypeActeur.nature: string`, `InterfaceCatalogue.relais: string`, `COLONNES_TYPESACTEUR` incluant `"Nature"`, `COLONNES_INTERFACES` incluant `"Relays"`.

- [ ] **Step 1: écrire les tests qui échouent**

Dans `app/src/parsing/build-model.test.ts`, à la fin du fichier :

```ts
describe("nature du type d'acteur et relais d'interface", () => {
  it("lit la nature déclarée sur le type d'acteur", () => {
    const wb = workbook([
      sheet("Actors", ["Name", "Group", "Actor type"], [["Tatooine", "Socle", "Application"]]),
      sheet("ActorTypes", ["Actor type", "Icon", "Nature"], [["Application", "app-window", "Business"], ["Middleware", "server", "Technical"]]),
      sheet("FlowTypes", ["Flow type", "Direction"], [["HTTP", "consumer → provider"]]),
      sheet("Interfaces", ["Flow name", "Provider", "Flow type"], [["F", "Tatooine", "HTTP"]]),
    ]);
    const r = buildModel(wb);
    if (!r.ok) throw new Error("illisible");
    expect(r.model.typesActeur.map((t) => [t.type, t.nature])).toEqual([
      ["Application", "Business"],
      ["Middleware", "Technical"],
    ]);
  });

  it("lit le relais déclaré sur une interface", () => {
    const wb = workbook([
      sheet("Actors", ["Name", "Group", "Actor type"], [["Bus", "Socle", "Middleware"]]),
      sheet("ActorTypes", ["Actor type", "Icon", "Nature"], [["Middleware", "server", "Technical"]]),
      sheet("FlowTypes", ["Flow type", "Direction"], [["HTTP", "consumer → provider"]]),
      sheet("Interfaces", ["Flow name", "Provider", "Flow type", "Relays"], [["trx.norm", "Bus", "HTTP", "Transactions"]]),
    ]);
    const r = buildModel(wb);
    if (!r.ok) throw new Error("illisible");
    expect(r.model.interfaces[0].relais).toBe("Transactions");
  });

  // Un classeur d'avant la v3 n'a ni l'une ni l'autre colonne : il doit se
  // lire à l'identique, les deux champs vides.
  it("lit les deux champs vides quand les colonnes manquent", () => {
    const wb = workbook([
      sheet("Actors", ["Name", "Group", "Actor type"], [["Tatooine", "Socle", "Application"]]),
      sheet("ActorTypes", ["Actor type", "Icon"], [["Application", "app-window"]]),
      sheet("FlowTypes", ["Flow type", "Direction"], [["HTTP", "consumer → provider"]]),
      sheet("Interfaces", ["Flow name", "Provider", "Flow type"], [["F", "Tatooine", "HTTP"]]),
    ]);
    const r = buildModel(wb);
    if (!r.ok) throw new Error("illisible");
    expect(r.model.typesActeur[0].nature).toBe("");
    expect(r.model.interfaces[0].relais).toBe("");
  });
});
```

Les helpers `workbook()` et `sheet()` existent déjà en tête de ce fichier de test ; les relire avant d'écrire pour respecter leur signature exacte.

- [ ] **Step 2: vérifier que les tests échouent**

Run: `cd app && npx vitest run src/parsing/build-model.test.ts -t "nature du type"`
Expected: FAIL — `nature` et `relais` absents du type.

- [ ] **Step 3: ajouter les champs au modèle**

Dans `app/src/parsing/model.ts`, dans `TypeActeur` :

```ts
export interface TypeActeur extends Emplacement {
  type: string;
  icone: string;
  // Métier ou technique. C'est le TYPE qui tranche, jamais l'acteur : même
  // principe que le périmètre, déclaré sur le groupe et non sur ses membres.
  // Vide vaut métier -- un classeur qui n'a pas rempli la colonne montre tout,
  // plutôt que de masquer des acteurs en silence.
  nature: string;
}
```

Dans `InterfaceCatalogue`, après `feuilleValide` :

```ts
  // Le nom de flux de l'interface que celle-ci prolonge. Rempli sur les seules
  // interfaces exposées par un acteur technique : c'est lui qui permet de
  // suivre un échange à travers la plomberie, alors même que son nom change
  // d'un segment à l'autre.
  relais: string;
```

- [ ] **Step 4: lire les deux colonnes**

Dans `app/src/parsing/build-model.ts`, ajouter `"Nature"` à `COLONNES_TYPESACTEUR` et `"Relays"` à `COLONNES_INTERFACES` :

```ts
export const COLONNES_TYPESACTEUR = ["Actor type", "Icon", "Nature"];
export const COLONNES_INTERFACES = ["Flow name", "Version", "Provider", "Flow type", "Description", "Contract link", "Contract reference", "Comments", "To confirm", "Relays", ...COLONNES_VALIDITE];
```

Dans la construction de `typesActeur`, ajouter au littéral :

```ts
        nature: get(r, headerMapTypesActeur, "Nature"),
```

Dans la construction de `interfaces`, ajouter au littéral rendu :

```ts
        relais: get(r, headerMapInterfaces, "Relays"),
```

- [ ] **Step 5: vérifier que les tests passent**

Run: `cd app && npx vitest run && npx tsc --noEmit`
Expected: PASS. `tsc` signalera les fixtures de test d'autres fichiers auxquelles il manque `nature` ou `relais` — les compléter avec `nature: ""` et `relais: ""`.

- [ ] **Step 6: commit**

```bash
git add app/src/parsing app/src/export app/src/aggregation app/src/integrity app/src/ui app/test
git commit -m "feat(model): actor types carry a nature, interfaces carry a relay"
```

---

## Task 2 : qui est technique, qui est métier

**Files:**
- Create: `app/src/aggregation/nature.ts`
- Test: `app/src/aggregation/nature.test.ts`

**Interfaces:**
- Consumes: `TypeActeur.nature` (Task 1).
- Produces: `estActeurTechnique(model: ParsedModel, nomActeur: string): boolean`, `acteursMetier(model: ParsedModel): Acteur[]`, `NATURE_TECHNIQUE = "Technical"`, `NATURE_METIER = "Business"`.

- [ ] **Step 1: écrire les tests qui échouent**

Créer `app/src/aggregation/nature.test.ts` :

```ts
import { describe, it, expect } from "vitest";
import { estActeurTechnique, acteursMetier } from "./nature";
import type { ParsedModel, Acteur, TypeActeur } from "../parsing/model";
import { VERSION_MODELE } from "../parsing/build-model";

function acteur(nom: string, typeActeur: string): Acteur {
  return {
    nom, groupe: "G", typeActeur, responsable: "", description: "", commentaires: "",
    palierIntroduction: "", palierRetrait: "", feuille: "Actors", ligne: 0,
  };
}

function type(t: string, nature: string): TypeActeur {
  return { type: t, icone: "", nature, feuille: "ActorTypes", ligne: 0 };
}

function model(acteurs: Acteur[], typesActeur: TypeActeur[]): ParsedModel {
  return {
    acteurs, typesActeur,
    groupes: [], groupesAbsents: false, paliers: [], typesFlux: [],
    interfaces: [], consommations: [], fxSheetNames: [],
    colonnesOptionnellesAbsentes: [], versionModele: VERSION_MODELE, fichierModifie: null,
  };
}

describe("nature des acteurs", () => {
  it("reconnaît un acteur dont le type est déclaré technique", () => {
    const m = model([acteur("Bus", "Middleware")], [type("Middleware", "Technical")]);
    expect(estActeurTechnique(m, "Bus")).toBe(true);
  });

  it("tient pour métier un type déclaré Business", () => {
    const m = model([acteur("Tatooine", "Application")], [type("Application", "Business")]);
    expect(estActeurTechnique(m, "Tatooine")).toBe(false);
  });

  // Masquer sur une colonne vide reviendrait à cacher de la donnée sans le
  // dire : le défaut penche du côté qui montre tout.
  it("tient pour métier un type dont la nature n'est pas renseignée", () => {
    const m = model([acteur("Tatooine", "Application")], [type("Application", "")]);
    expect(estActeurTechnique(m, "Tatooine")).toBe(false);
  });

  it("tient pour métier un acteur dont le type n'est pas déclaré", () => {
    const m = model([acteur("Inconnu", "Fantôme")], [type("Application", "Technical")]);
    expect(estActeurTechnique(m, "Inconnu")).toBe(false);
  });

  it("reconnaît la nature aux accents et à la casse près", () => {
    const m = model([acteur("Bus", "middleware")], [type("Middleware", "TECHNICAL")]);
    expect(estActeurTechnique(m, "Bus")).toBe(true);
  });

  it("rend les seuls acteurs métier", () => {
    const m = model(
      [acteur("Tatooine", "Application"), acteur("Bus", "Middleware")],
      [type("Application", "Business"), type("Middleware", "Technical")]
    );
    expect(acteursMetier(m).map((a) => a.nom)).toEqual(["Tatooine"]);
  });
});
```

- [ ] **Step 2: vérifier que les tests échouent**

Run: `cd app && npx vitest run src/aggregation/nature.test.ts`
Expected: FAIL — module `./nature` introuvable.

- [ ] **Step 3: écrire le module**

Créer `app/src/aggregation/nature.ts` :

```ts
import type { ParsedModel, Acteur } from "../parsing/model";
import { normalizeText } from "../shared/text";

export const NATURE_METIER = "Business";
export const NATURE_TECHNIQUE = "Technical";

// Un acteur est technique quand SON TYPE le déclare. Le type tranche pour tous
// ses acteurs, comme le périmètre du groupe tranche pour tous ses membres :
// six lignes à tenir plutôt que cinquante, donc six occasions de se contredire
// plutôt que cinquante.
//
// Tout le reste est métier : nature vide, type inconnu, type absent. Le défaut
// penche du côté qui MONTRE -- masquer sur une colonne non remplie cacherait
// de la donnée sans que personne l'ait demandé.
export function estActeurTechnique(model: ParsedModel, nomActeur: string): boolean {
  const acteur = model.acteurs.find((a) => a.nom.trim() === nomActeur.trim());
  if (!acteur) return false;
  const type = model.typesActeur.find((t) => normalizeText(t.type) === normalizeText(acteur.typeActeur));
  return type !== undefined && normalizeText(type.nature) === normalizeText(NATURE_TECHNIQUE);
}

export function acteursMetier(model: ParsedModel): Acteur[] {
  return model.acteurs.filter((a) => !estActeurTechnique(model, a.nom));
}
```

- [ ] **Step 4: vérifier que les tests passent**

Run: `cd app && npx vitest run src/aggregation/nature.test.ts && npx tsc --noEmit`
Expected: PASS, 6 tests.

- [ ] **Step 5: commit**

```bash
git add app/src/aggregation/nature.ts app/src/aggregation/nature.test.ts
git commit -m "feat(model): tell a technical actor from a business one"
```

---

## Task 3 : la traversée des chaînes de relais

**Files:**
- Create: `app/src/aggregation/fonctionnel.ts`
- Test: `app/src/aggregation/fonctionnel.test.ts`

**Interfaces:**
- Consumes: `estActeurTechnique` (Task 2), `buildFlowInstances`, `FlowInstance` (`aggregation/core.ts`).
- Produces aussi : `type Mode = "architecture" | "fonctionnel"` dans `aggregation/core.ts` — défini ici parce que c'est le premier usage ; la Task 4 ne fait que l'ajouter à `AggregationOptions`.
- Produces: `buildFunctionalFlows(model: ParsedModel, rang: number | null): FlowInstance[]`, `fluxDuMode(model: ParsedModel, rang: number | null, mode: Mode): FlowInstance[]`, `type ChaineCoupee = { conso: Consommation; iface: InterfaceCatalogue; raison: "relais-vide" | "relais-inconnu" | "boucle" }`, `chainesCoupees(model: ParsedModel, rang: number | null): ChaineCoupee[]`.

Les `FlowInstance` rendus portent `typeDeFlux: ""` — c'est ce qui fait tomber la technologie de la clé de fusion et de la légende. `exposant` est la source métier, `consommateur` le consommateur métier, `interfaceNom` et `version` sont ceux de l'interface **à la source**. `sens` vaut toujours `"exposant-consommateur"` : en fonctionnel la flèche va du fournisseur au consommateur, faute de technologie sur quoi accrocher la convention de l'architecture.

- [ ] **Step 1: écrire les tests qui échouent**

Créer `app/src/aggregation/fonctionnel.test.ts` :

```ts
import { describe, it, expect } from "vitest";
import { buildFunctionalFlows, chainesCoupees } from "./fonctionnel";
import type { ParsedModel, Acteur, TypeActeur, InterfaceCatalogue, Consommation } from "../parsing/model";
import { VERSION_MODELE } from "../parsing/build-model";

function acteur(nom: string, typeActeur: string): Acteur {
  return { nom, groupe: "G", typeActeur, responsable: "", description: "", commentaires: "", palierIntroduction: "", palierRetrait: "", feuille: "Actors", ligne: 0 };
}

function iface(nomDuFlux: string, acteurExposant: string, relais = ""): InterfaceCatalogue {
  return {
    nomDuFlux, version: "", etat: "", acteurExposant, typeDeFlux: "HTTP", description: "",
    lienContrat: "", referenceContrat: "", commentaires: "", aConfirmer: false, relais,
    feuilleAttendue: `FX_${acteurExposant}_HTTP`, feuilleValide: true,
    palierIntroduction: "", palierRetrait: "", feuille: "Interfaces", ligne: 0,
  };
}

function conso(nomDuFlux: string, acteurConsommateur: string, exposant: string): Consommation {
  return {
    nomDuFlux, version: "", acteurConsommateur, usage: "", criticite: "", statut: "", decision: "",
    commentaires: "", feuille: `FX_${exposant}_HTTP`, palierIntroduction: "", palierRetrait: "", ligne: 0,
  };
}

const TYPES: TypeActeur[] = [
  { type: "Application", icone: "", nature: "Business", feuille: "ActorTypes", ligne: 0 },
  { type: "Middleware", icone: "", nature: "Technical", feuille: "ActorTypes", ligne: 0 },
];

function model(o: Partial<ParsedModel>): ParsedModel {
  return {
    acteurs: [], typesActeur: TYPES, groupes: [], groupesAbsents: false, paliers: [],
    typesFlux: [{ type: "HTTP", sensRepresentation: "consommateur-exposant", sensRepresentationBrut: "consumer → provider", description: "", feuille: "FlowTypes", ligne: 0 }],
    interfaces: [], consommations: [], fxSheetNames: [],
    colonnesOptionnellesAbsentes: [], versionModele: VERSION_MODELE, fichierModifie: null,
    ...o,
  };
}

// Tatooine ─► Bus ─► Naboo, le bus étant technique.
function unRelais(): ParsedModel {
  return model({
    acteurs: [acteur("Tatooine", "Application"), acteur("Bus", "Middleware"), acteur("Naboo", "Application")],
    interfaces: [iface("Transactions", "Tatooine"), iface("trx.norm", "Bus", "Transactions")],
    consommations: [conso("Transactions", "Bus", "Tatooine"), conso("trx.norm", "Naboo", "Bus")],
  });
}

describe("buildFunctionalFlows", () => {
  it("relie la source métier au consommateur métier à travers un relais", () => {
    const flux = buildFunctionalFlows(unRelais(), null);
    expect(flux).toHaveLength(1);
    expect([flux[0].exposant, flux[0].consommateur]).toEqual(["Tatooine", "Naboo"]);
  });

  // Le nom métier est celui que le producteur donne à sa donnée, pas celui du
  // segment technique qui la transporte.
  it("nomme le lien d'après l'interface à la source", () => {
    expect(buildFunctionalFlows(unRelais(), null)[0].interfaceNom).toBe("Transactions");
  });

  // Sans technologie, la clé de fusion des traits n'en tient plus compte.
  it("vide la technologie", () => {
    expect(buildFunctionalFlows(unRelais(), null)[0].typeDeFlux).toBe("");
  });

  it("oriente la flèche du fournisseur vers le consommateur", () => {
    expect(buildFunctionalFlows(unRelais(), null)[0].sens).toBe("exposant-consommateur");
  });

  it("suit une chaîne de longueur quelconque", () => {
    const m = model({
      acteurs: [acteur("Alderaan", "Application"), acteur("Bus", "Middleware"), acteur("ETL", "Middleware"), acteur("Coruscant", "Application")],
      interfaces: [iface("Commandes", "Alderaan"), iface("cmd.raw", "Bus", "Commandes"), iface("CMD_D", "ETL", "cmd.raw")],
      consommations: [conso("Commandes", "Bus", "Alderaan"), conso("cmd.raw", "ETL", "Bus"), conso("CMD_D", "Coruscant", "ETL")],
    });
    const flux = buildFunctionalFlows(m, null);
    expect(flux).toHaveLength(1);
    expect([flux[0].exposant, flux[0].consommateur]).toEqual(["Alderaan", "Coruscant"]);
  });

  // Le cas qui justifie toute la mécanique : deux flux dans un même bus ne
  // doivent pas se croiser.
  it("ne croise pas deux flux passant par le même bus", () => {
    const m = model({
      acteurs: [acteur("Tatooine", "Application"), acteur("Alderaan", "Application"), acteur("Bus", "Middleware"), acteur("Naboo", "Application"), acteur("Coruscant", "Application")],
      interfaces: [
        iface("Transactions", "Tatooine"), iface("Référentiel", "Alderaan"),
        iface("trx.norm", "Bus", "Transactions"), iface("ref.norm", "Bus", "Référentiel"),
      ],
      consommations: [
        conso("Transactions", "Bus", "Tatooine"), conso("Référentiel", "Bus", "Alderaan"),
        conso("trx.norm", "Naboo", "Bus"), conso("ref.norm", "Coruscant", "Bus"),
      ],
    });
    const liens = buildFunctionalFlows(m, null).map((f) => `${f.exposant}→${f.consommateur}`).sort();
    expect(liens).toEqual(["Tatooine→Naboo", "Alderaan→Coruscant"]);
  });

  it("produit un lien par consommateur métier en diffusion", () => {
    const m = model({
      acteurs: [acteur("Tatooine", "Application"), acteur("Bus", "Middleware"), acteur("Coruscant", "Application"), acteur("Hoth", "Application")],
      interfaces: [iface("Transactions", "Tatooine"), iface("trx.norm", "Bus", "Transactions")],
      consommations: [conso("Transactions", "Bus", "Tatooine"), conso("trx.norm", "Coruscant", "Bus"), conso("trx.norm", "Hoth", "Bus")],
    });
    expect(buildFunctionalFlows(m, null).map((f) => f.consommateur).sort()).toEqual(["Hoth", "Coruscant"]);
  });

  it("garde tel quel un échange entre deux acteurs métier", () => {
    const m = model({
      acteurs: [acteur("Tatooine", "Application"), acteur("Mygeeto", "Application")],
      interfaces: [iface("Authent", "Tatooine")],
      consommations: [conso("Authent", "Mygeeto", "Tatooine")],
    });
    const flux = buildFunctionalFlows(m, null);
    expect([flux[0].exposant, flux[0].consommateur]).toEqual(["Tatooine", "Mygeeto"]);
  });

  it("ne produit rien quand le relais est vide", () => {
    const m = unRelais();
    m.interfaces[1].relais = "";
    expect(buildFunctionalFlows(m, null)).toHaveLength(0);
  });

  it("ne produit rien quand le relais désigne un flux inconnu", () => {
    const m = unRelais();
    m.interfaces[1].relais = "Fantôme";
    expect(buildFunctionalFlows(m, null)).toHaveLength(0);
  });

  // Sans garde, le parcours tournerait indéfiniment.
  it("s'arrête sur une chaîne qui boucle", () => {
    const m = model({
      acteurs: [acteur("Bus", "Middleware"), acteur("ETL", "Middleware"), acteur("Coruscant", "Application")],
      interfaces: [iface("a", "Bus", "b"), iface("b", "ETL", "a")],
      consommations: [conso("a", "Coruscant", "Bus")],
    });
    expect(buildFunctionalFlows(m, null)).toHaveLength(0);
  });

  it("ne trace pas un lien dont la source est le consommateur", () => {
    const m = model({
      acteurs: [acteur("Tatooine", "Application"), acteur("Bus", "Middleware")],
      interfaces: [iface("Transactions", "Tatooine"), iface("trx.norm", "Bus", "Transactions")],
      consommations: [conso("Transactions", "Bus", "Tatooine"), conso("trx.norm", "Tatooine", "Bus")],
    });
    expect(buildFunctionalFlows(m, null)).toHaveLength(0);
  });
});

describe("chainesCoupees", () => {
  it("nomme la consommation dont le relais est vide", () => {
    const m = unRelais();
    m.interfaces[1].relais = "";
    const coupées = chainesCoupees(m, null);
    expect(coupées).toHaveLength(1);
    expect(coupées[0].raison).toBe("relais-vide");
    expect(coupées[0].iface.nomDuFlux).toBe("trx.norm");
  });

  it("nomme la consommation dont le relais pointe dans le vide", () => {
    const m = unRelais();
    m.interfaces[1].relais = "Fantôme";
    expect(chainesCoupees(m, null)[0].raison).toBe("relais-inconnu");
  });

  it("ne signale rien sur une chaîne entière", () => {
    expect(chainesCoupees(unRelais(), null)).toEqual([]);
  });
});
```

- [ ] **Step 2: vérifier que les tests échouent**

Run: `cd app && npx vitest run src/aggregation/fonctionnel.test.ts`
Expected: FAIL — module `./fonctionnel` introuvable.

- [ ] **Step 3: déclarer le mode**

Dans `app/src/aggregation/core.ts`, avant `AggregationOptions` :

```ts
// Les deux lectures du parc. L'architecture répond à « par quoi ça passe », le
// fonctionnel à « qui alimente qui » : mêmes données, deux questions.
export type Mode = "architecture" | "fonctionnel";
```

- [ ] **Step 4: écrire le module**

Créer `app/src/aggregation/fonctionnel.ts` :

```ts
import type { ParsedModel, InterfaceCatalogue, Consommation } from "../parsing/model";
import { buildFlowInstances, type FlowInstance, type Mode } from "./core";
import { estActeurTechnique } from "./nature";

// La lecture fonctionnelle du parc : qui alimente qui, la plomberie retirée.
//
// Elle se DÉRIVE de l'architecture plutôt que de se saisir à part -- c'est ce
// qui garantit que les deux lectures ne divergeront jamais. Le résultat a la
// forme des flux techniques, la technologie en moins, de sorte que les vues
// existantes tournent dessus sans savoir qu'elles ont changé de mode.

export interface ChaineCoupee {
  conso: Consommation;
  iface: InterfaceCatalogue;
  raison: "relais-vide" | "relais-inconnu" | "boucle";
}

// Remonte les segments tant que l'exposant est technique. Rend l'interface
// source quand elle est exposée par un acteur métier, sinon la raison de
// l'échec -- le rapport d'intégrité en a besoin pour dire OÙ la chaîne casse.
function remonter(
  model: ParsedModel,
  départ: InterfaceCatalogue
): { source: InterfaceCatalogue } | { raison: ChaineCoupee["raison"]; iface: InterfaceCatalogue } {
  let courante = départ;
  const vues = new Set<InterfaceCatalogue>();
  while (estActeurTechnique(model, courante.acteurExposant)) {
    if (vues.has(courante)) return { raison: "boucle", iface: courante };
    vues.add(courante);
    const cible = courante.relais.trim();
    if (cible === "") return { raison: "relais-vide", iface: courante };
    const amont = model.interfaces.find((i) => i.nomDuFlux.trim() === cible);
    if (!amont) return { raison: "relais-inconnu", iface: courante };
    courante = amont;
  }
  return { source: courante };
}

// Les consommations qui comptent : celles d'un acteur MÉTIER. Une consommation
// par un acteur technique n'est pas une extrémité mais un segment, traversé
// depuis l'aval.
function consommationsMetier(model: ParsedModel, rang: number | null): FlowInstance[] {
  return buildFlowInstances(model, rang).filter((f) => !estActeurTechnique(model, f.consommateur));
}

export function buildFunctionalFlows(model: ParsedModel, rang: number | null): FlowInstance[] {
  const flux: FlowInstance[] = [];
  for (const f of consommationsMetier(model, rang)) {
    const remontée = remonter(model, f.iface);
    if (!("source" in remontée)) continue;
    const source = remontée.source;
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
  return flux;
}

// Le point d'entrée unique des consommateurs de flux. Il vit ici et non dans
// les vues parce que la vue Écarts en a besoin aussi, sans passer par elles.
export function fluxDuMode(model: ParsedModel, rang: number | null, mode: Mode): FlowInstance[] {
  return mode === "fonctionnel" ? buildFunctionalFlows(model, rang) : buildFlowInstances(model, rang);
}

export function chainesCoupees(model: ParsedModel, rang: number | null): ChaineCoupee[] {
  const coupées: ChaineCoupee[] = [];
  for (const f of consommationsMetier(model, rang)) {
    const remontée = remonter(model, f.iface);
    if ("source" in remontée) continue;
    coupées.push({ conso: f.conso, iface: remontée.iface, raison: remontée.raison });
  }
  return coupées;
}
```

- [ ] **Step 5: vérifier que les tests passent**

Run: `cd app && npx vitest run src/aggregation/fonctionnel.test.ts && npx tsc --noEmit`
Expected: PASS, 15 tests.

- [ ] **Step 6: commit**

```bash
git add app/src/aggregation/fonctionnel.ts app/src/aggregation/fonctionnel.test.ts
git commit -m "feat(aggregation): follow an exchange through the plumbing"
```

---

## Task 4 : le mode traverse l'agrégation et les vues

**Files:**
- Modify: `app/src/aggregation/core.ts`
- Modify: `app/src/aggregation/views.ts`
- Test: `app/src/aggregation/views.test.ts`

**Interfaces:**
- Consumes: `buildFunctionalFlows` (Task 3).
- Produces: `AggregationOptions.mode: Mode`.

- [ ] **Step 1: écrire les tests qui échouent**

À la fin de `app/src/aggregation/views.test.ts` :

```ts
describe("mode fonctionnel", () => {
  const TYPES_NATURE = [
    { type: "Application", icone: "", nature: "Business", feuille: "ActorTypes", ligne: 0 },
    { type: "Middleware", icone: "", nature: "Technical", feuille: "ActorTypes", ligne: 0 },
  ];

  // Tatooine ─Kafka─► Bus ─Fichier─► Naboo, plus Mygeeto ─HTTP─► Tatooine.
  function parc(): ParsedModel {
    return model({
      typesActeur: TYPES_NATURE,
      acteurs: [
        acteur({ nom: "Tatooine", typeActeur: "Application", groupe: "Socle" }),
        acteur({ nom: "Bus", typeActeur: "Middleware", groupe: "Socle" }),
        acteur({ nom: "Naboo", typeActeur: "Application", groupe: "Finance" }),
      ],
      groupes: [
        { nom: "Socle", perimetre: "Platform", feuille: "Groups", ligne: 0 },
        { nom: "Finance", perimetre: "External", feuille: "Groups", ligne: 0 },
      ],
      interfaces: [
        iface({ nomDuFlux: "Transactions", acteurExposant: "Tatooine" }),
        iface({ nomDuFlux: "trx.norm", acteurExposant: "Bus", relais: "Transactions", feuilleAttendue: "FX_Bus_HTTP" }),
      ],
      consommations: [
        conso({ nomDuFlux: "Transactions", acteurConsommateur: "Bus" }),
        conso({ nomDuFlux: "trx.norm", acteurConsommateur: "Naboo", feuille: "FX_Bus_HTTP" }),
      ],
      fxSheetNames: ["FX_Tatooine_HTTP", "FX_Bus_HTTP"],
    });
  }

  const options = (mode: "architecture" | "fonctionnel") => ({ rang: null, compteurs: true, mode });

  it("laisse le mode architecture inchangé", () => {
    const vue = buildPlatformDetailView(parc(), options("architecture"));
    expect(vue.nodes.map((n) => n.id)).toContain("Bus");
  });

  it("retire l'acteur technique en mode fonctionnel", () => {
    const vue = buildPlatformDetailView(parc(), options("fonctionnel"));
    expect(vue.nodes.map((n) => n.id)).not.toContain("Bus");
  });

  it("relie la source au consommateur en mode fonctionnel", () => {
    const vue = buildPlatformDetailView(parc(), options("fonctionnel"));
    expect(vue.edges).toHaveLength(1);
    expect([vue.edges[0].from, vue.edges[0].to]).toEqual(["Tatooine", "Finance"]);
  });

  // Sans technologie, deux échanges entre les mêmes applications fusionnent en
  // un seul trait, quel que soit le médium qui les portait.
  it("fusionne les traits sans distinguer les technologies", () => {
    const m = parc();
    m.interfaces.push(iface({ nomDuFlux: "Autre", acteurExposant: "Tatooine", typeDeFlux: "Kafka", feuilleAttendue: "FX_Tatooine_Kafka" }));
    m.consommations.push(conso({ nomDuFlux: "Autre", acteurConsommateur: "Naboo", feuille: "FX_Tatooine_Kafka" }));
    m.typesFlux.push({ type: "Kafka", sensRepresentation: "exposant-consommateur", sensRepresentationBrut: "provider → consumer", description: "", feuille: "FlowTypes", ligne: 0 });
    m.fxSheetNames.push("FX_Tatooine_Kafka");
    const vue = buildPlatformDetailView(m, options("fonctionnel"));
    expect(vue.edges).toHaveLength(1);
    expect(vue.edges[0].count).toBe(2);
  });
});
```

Relire les helpers `model()`, `acteur()`, `iface()`, `conso()` en tête de `views.test.ts` : les compléter avec `nature: ""` / `relais: ""` si Task 1 ne l'a pas déjà fait, et adapter les appels ci-dessus à leur signature exacte.

- [ ] **Step 2: vérifier que les tests échouent**

Run: `cd app && npx vitest run src/aggregation/views.test.ts -t "mode fonctionnel"`
Expected: FAIL — `mode` n'existe pas dans `AggregationOptions`.

- [ ] **Step 3: porter le mode dans les options et la clé de fusion**

Dans `app/src/aggregation/core.ts`, le type `Mode` existe déjà (Task 3) ; il ne reste qu'à porter le champ :

```ts
export interface AggregationOptions {
  rang: number | null;
  compteurs: boolean;
  mode: Mode;
}
```

`groupFlows` n'a **rien** à changer : sa clé est `JSON.stringify([from, to, flow.typeDeFlux])`, et une technologie vide y est une valeur comme une autre. Deux échanges entre les mêmes applications fusionnent donc d'eux-mêmes dès que la technologie est vidée. Le relire avant de conclure.

- [ ] **Step 4: brancher la source de flux dans les vues**

Dans `app/src/aggregation/views.ts`, importer `fluxDuMode` depuis `./fonctionnel` et `acteursMetier` depuis `./nature`, puis remplacer chaque appel `buildFlowInstances(model, options.rang)` par `fluxDuMode(model, options.rang, options.mode)`. Les vues par acteur et par technologie prennent leurs propres options : y ajouter `mode` et faire de même.

Le mode ne décide que de la provenance des flux : les vues qui suivent ignorent tout de la distinction, exactement comme elles ignorent le filtrage par palier appliqué en amont d'elles.

Dans `buildPlatformDetailView`, `buildPlatformOnlyView` et `buildGroupToGroupView`, la liste des acteurs pris en compte doit se restreindre aux acteurs métier en mode fonctionnel — lire le code existant pour trouver où les acteurs sont énumérés et y appliquer `acteursMetier(model)`.

- [ ] **Step 5: brancher la vue Écarts**

`app/src/aggregation/ecarts.ts` prend ses flux directement, sans passer par `views.ts` (ligne 46) — la spec la déclarant disponible dans les deux modes, elle doit suivre. `calculerEcarts` et `buildEcartsView` gagnent un paramètre `mode: Mode` et remplacent leur `buildFlowInstances(model, rang)` par `fluxDuMode(model, rang, mode)`.

Test à ajouter dans `app/src/aggregation/ecarts.test.ts` :

```ts
it("compare les liens fonctionnels quand le mode le demande", () => {
  // Un lien qui n'existe qu'au second palier apparaît comme un ajout, la
  // plomberie retirée.
  const ecarts = calculerEcarts(parcFonctionnel(), 1, 2, "fonctionnel");
  expect(ecarts.ajouts.some((e) => e.from === "Tatooine" && e.to === "Naboo")).toBe(true);
});
```

Écrire `parcFonctionnel()` sur le modèle des helpers déjà présents dans ce fichier : `Tatooine ─► Bus ─► Naboo`, `Bus` de type `Middleware` déclaré `Technical`, le segment sortant introduit au palier `v2`. Relire la forme exacte que rend `calculerEcarts` avant d'écrire l'assertion.

- [ ] **Step 6: rendre la matrice lisible sans technologie**

`app/src/render/matrix-table.ts:44` écrit `` `${cell.technologie} ×${cell.count}` `` — sans technologie, la cellule afficherait « ×3 » précédé d'un vide. Le compteur seul suffit :

```ts
        span.textContent = cell.technologie
          ? cell.count > 1
            ? `${cell.technologie} ×${cell.count}`
            : cell.technologie
          : String(cell.count);
```

Test à ajouter dans `app/src/render/render.test.ts`, en calquant les fixtures de matrice déjà présentes dans ce fichier :

```ts
it("montre le seul compteur quand la cellule n'a pas de technologie", () => {
  const table = buildMatrixTable(matriceSansTechnologie(), () => "#000");
  expect(table.textContent).toContain("2");
  expect(table.textContent).not.toContain("×");
});
```

- [ ] **Step 7: vérifier que les tests passent**

Run: `cd app && npx vitest run && npx tsc --noEmit`
Expected: PASS. `tsc` signalera tous les appelants de `AggregationOptions` auxquels il manque `mode` — leur donner `mode: "architecture"`.

- [ ] **Step 8: commit**

```bash
git add app/src/aggregation app/src/render app/src/ui app/test
git commit -m "feat(aggregation): the mode decides where the flows come from"
```

---

## Task 5 : les huit contrôles d'intégrité

**Files:**
- Modify: `app/src/integrity/checks.ts`
- Test: `app/src/integrity/checks.test.ts`

**Interfaces:**
- Consumes: `estActeurTechnique` (Task 2), `chainesCoupees` (Task 3).
- Produces: aucune signature nouvelle — les anomalies rejoignent les familles existantes `references`, `coherence`, `vocabulaires`, `completude`.

- [ ] **Step 1: écrire les tests qui échouent**

À la fin de `app/src/integrity/checks.test.ts`. Les helpers `model()`, `acteur()`, `iface()`, `conso()` existent en tête du fichier ; ajouter au besoin `nature` et `relais`.

```ts
describe("nature et relais", () => {
  const TYPES = [
    { type: "Application", icone: "app-window", nature: "Business", feuille: "ActorTypes", ligne: 2 },
    { type: "Middleware", icone: "server", nature: "Technical", feuille: "ActorTypes", ligne: 3 },
  ];
  const messages = (m: ParsedModel, famille: string) =>
    runIntegrityChecks(m).familles.find((f) => f.id === famille)!.anomalies.map((a) => a.message).join(" | ");

  function parcRelais(overrides: Partial<InterfaceCatalogue> = {}): ParsedModel {
    return model({
      typesActeur: TYPES,
      acteurs: [acteur({ nom: "Tatooine" }), acteur({ nom: "Bus", typeActeur: "Middleware" }), acteur({ nom: "B" })],
      interfaces: [
        iface({ nomDuFlux: "Transactions", acteurExposant: "Tatooine" }),
        iface({ nomDuFlux: "trx.norm", acteurExposant: "Bus", relais: "Transactions", feuilleAttendue: "FX_Bus_HTTP", ...overrides }),
      ],
      consommations: [
        conso({ nomDuFlux: "Transactions", acteurConsommateur: "Bus" }),
        conso({ nomDuFlux: "trx.norm", acteurConsommateur: "B", feuille: "FX_Bus_HTTP" }),
      ],
      fxSheetNames: ["FX_A_HTTP", "FX_Bus_HTTP"],
    });
  }

  it("ne signale rien sur une chaîne entière", () => {
    expect(messages(parcRelais(), "references")).not.toContain("Relays");
    expect(messages(parcRelais(), "coherence")).not.toContain("relay");
  });

  it("signale un relais qui désigne un flux absent du catalogue", () => {
    expect(messages(parcRelais({ relais: "Fantôme" }), "references")).toContain("Fantôme");
  });

  it("signale un relais porté par une interface exposée par un acteur métier", () => {
    const m = parcRelais();
    m.interfaces[0].relais = "Autre chose";
    expect(messages(m, "coherence")).toContain("only a relay");
  });

  it("signale une interface technique sans relais", () => {
    expect(messages(parcRelais({ relais: "" }), "completude")).toContain("relay empty");
  });

  // Le bus fourre-tout : le flux entre dans la plomberie et n'en ressort pour
  // personne, sans quoi le lien fonctionnel manquerait en silence.
  it("signale un flux qui entre chez un technique et n'en ressort pour personne", () => {
    const m = parcRelais();
    m.interfaces.push(iface({ nomDuFlux: "Référentiel", acteurExposant: "Tatooine", feuilleAttendue: "FX_Tatooine_REF" }));
    m.consommations.push(conso({ nomDuFlux: "Référentiel", acteurConsommateur: "Bus", feuille: "FX_Tatooine_REF" }));
    m.fxSheetNames.push("FX_Tatooine_REF");
    expect(messages(m, "coherence")).toContain("Référentiel");
  });

  it("signale une nature hors vocabulaire", () => {
    const m = parcRelais();
    m.typesActeur = [{ ...TYPES[0], nature: "Métier" }, TYPES[1]];
    expect(messages(m, "vocabulaires")).toContain("Métier");
  });

  it("réclame la nature manquante dès qu'un type en déclare une", () => {
    const m = parcRelais();
    m.typesActeur = [{ ...TYPES[0], nature: "" }, TYPES[1]];
    expect(messages(m, "completude")).toContain("nature");
  });

  // Tant que l'équipe n'a pas adopté la distinction, l'outil n'en parle pas.
  it("se tait sur un classeur où aucun type ne déclare de nature", () => {
    const m = parcRelais();
    m.typesActeur = TYPES.map((t) => ({ ...t, nature: "" }));
    expect(messages(m, "completude")).not.toContain("nature");
  });
});
```

- [ ] **Step 2: vérifier que les tests échouent**

Run: `cd app && npx vitest run src/integrity/checks.test.ts -t "nature et relais"`
Expected: FAIL — aucun de ces messages n'existe.

- [ ] **Step 3: écrire les contrôles**

Dans `app/src/integrity/checks.ts`, importer :

```ts
import { estActeurTechnique, NATURE_METIER, NATURE_TECHNIQUE } from "../aggregation/nature";
import { chainesCoupees } from "../aggregation/fonctionnel";
```

Ajouter au vocabulaire fermé :

```ts
  nature: [NATURE_METIER, NATURE_TECHNIQUE],
```

et dans `checkVocabulaires`, boucler sur `model.typesActeur` :

```ts
  for (const t of model.typesActeur) {
    if (horsVocabulaire(t.nature, VOCABULAIRES.nature)) {
      anomalies.push(
        anomalie(`${nommeTypeActeur(t)}: nature "${t.nature}" unknown. Accepted values: ${VOCABULAIRES.nature.join(", ")}.`, t)
      );
    }
  }
```

Dans `checkReferences`, pour chaque interface dont `relais` est renseigné :

```ts
  for (const i of model.interfaces) {
    const cible = i.relais.trim();
    if (cible === "") continue;
    const amont = model.interfaces.filter((autre) => autre.nomDuFlux.trim() === cible);
    if (amont.length === 0) {
      anomalies.push(anomalie(`${nommeInterface(i)}: relays "${cible}", which is in no catalogue.`, i));
    } else if (amont.length > 1) {
      // On ne choisit pas au hasard : deux interfaces du même nom rendent le
      // relais ambigu, et la chaîne dériverait vers l'une ou l'autre.
      anomalies.push(anomalie(`${nommeInterface(i)}: relays "${cible}", carried by ${amont.length} interfaces.`, i));
    }
  }
```

Dans `checkCoherence` :

```ts
  for (const i of model.interfaces) {
    if (i.relais.trim() !== "" && !estActeurTechnique(model, i.acteurExposant)) {
      anomalies.push(
        anomalie(`${nommeInterface(i)}: carries a relay, yet its provider is a business actor — only a relay relays.`, i)
      );
    }
  }

  // Une chaîne qui boucle ne produit aucun lien et tournerait indéfiniment
  // sans la garde du parcours : la signaler vaut mieux que de la subir.
  for (const coupée of chainesCoupees(model, null)) {
    if (coupée.raison !== "boucle") continue;
    anomalies.push(anomalie(`${nommeInterface(coupée.iface)}: its relay chain loops back on itself.`, coupée.iface));
  }

  // Le bus fourre-tout : un flux entre dans la plomberie et n'en ressort pour
  // personne. Sans ce contrôle, le lien fonctionnel manquerait EN SILENCE, ce
  // qui est le pire des cas.
  const lookupCoherence = buildInterfaceLookup(model);
  for (const i of model.interfaces) {
    const consommateurs = consommationsForInterface(lookupCoherence, model, i).map((c) => c.acteurConsommateur);
    if (consommateurs.length === 0) continue;
    if (!consommateurs.every((c) => estActeurTechnique(model, c))) continue;
    const ressort = model.interfaces.some((autre) => autre.relais.trim() === i.nomDuFlux.trim());
    if (!ressort) {
      anomalies.push(
        anomalie(`${nommeInterface(i)}: goes into technical actors and comes back out for nobody.`, i)
      );
    }
  }
```

Dans `checkCompletude`, les deux contrôles conditionnés à l'adoption :

```ts
  // Tant qu'aucun type ne déclare de nature, l'équipe n'a pas adopté la
  // distinction et l'outil n'en parle pas -- même règle que pour les paliers.
  const natureAdoptee = model.typesActeur.some((t) => t.nature.trim() !== "");
  if (natureAdoptee) {
    for (const t of model.typesActeur) {
      if (!t.nature.trim()) anomalies.push(anomalie(`${nommeTypeActeur(t)}: nature not filled in.`, t));
    }
    for (const i of model.interfaces) {
      if (estActeurTechnique(model, i.acteurExposant) && !i.relais.trim()) {
        anomalies.push(anomalie(`${nommeInterface(i)}: relay empty, so the chain stops here.`, i));
      }
    }
  }
```

- [ ] **Step 4: vérifier que les tests passent**

Run: `cd app && npx vitest run && npx tsc --noEmit`
Expected: PASS. Le test d'intégration `app/test/integration.test.ts` compte les blocs informatifs — il n'en gagne aucun ici, mais vérifier qu'il passe toujours.

- [ ] **Step 5: commit**

```bash
git add app/src/integrity
git commit -m "feat(report): eight checks on nature and relays"
```

---

## Task 6 : le classeur écrit les deux colonnes, schéma v3

**Files:**
- Modify: `app/src/export/template-export.ts`
- Modify: `app/src/parsing/build-model.ts:52`
- Modify: `app/src/export/migration-modele.ts`
- Test: `app/src/export/template-export.test.ts`, `app/src/export/migration-modele.test.ts`

**Interfaces:**
- Consumes: `COLONNES_TYPESACTEUR`, `COLONNES_INTERFACES` (Task 1).
- Produces: `VERSION_MODELE = 3`, `LISTES.Nature`.

- [ ] **Step 1: écrire les tests qui échouent**

Dans `app/src/export/template-export.test.ts` :

```ts
describe("modèle de classeur — nature et relais", () => {
  it("propose la nature en liste fermée sur ActorTypes", () => {
    const listes = listesDuModele();
    expect(listes.find((l) => l.nom === "L_Nature")).toBeDefined();
  });

  it("écrit les deux colonnes nouvelles", () => {
    const wb = XLSX.read(new Uint8Array(écrireModele()), { type: "array" });
    const types = XLSX.utils.sheet_to_json<string[]>(wb.Sheets["ActorTypes"], { header: 1 })[0];
    const interfaces = XLSX.utils.sheet_to_json<string[]>(wb.Sheets["Interfaces"], { header: 1 })[0];
    expect(types).toContain("Nature");
    expect(interfaces).toContain("Relays");
  });
});
```

Dans `app/src/export/migration-modele.test.ts` :

```ts
describe("mise à niveau — le v2 déjà distribué", () => {
  function modeleV2(): ParsedModel {
    return { ...modeleOrigine(), versionModele: 2 };
  }

  it("est reconnu comme périmé", () => {
    expect(modeleV2().versionModele).toBeLessThan(VERSION_MODELE);
  });

  it("ressort au format courant, son contenu intact", () => {
    const r = buildModel(parseWorkbook(écrireModele(mettreANiveau(modeleV2(), LE_JOUR))));
    if (!r.ok) throw new Error("illisible");
    expect(r.model.versionModele).toBe(VERSION_MODELE);
    expect(r.model.acteurs.map((a) => a.nom)).toEqual(modeleV2().acteurs.map((a) => a.nom));
  });

  it("ne transforme rien dans le modèle lui-même", () => {
    const avant = modeleV2();
    const étape = ETAPES_MISE_A_NIVEAU.find((e) => e.de === 2)!;
    expect(étape.appliquer(avant, { dateMigration: LE_JOUR })).toBe(avant);
  });
});
```

- [ ] **Step 2: vérifier que les tests échouent**

Run: `cd app && npx vitest run src/export -t "nature et relais"` puis `-t "le v2 déjà distribué"`
Expected: FAIL sur les deux.

- [ ] **Step 3: écrire les colonnes et le vocabulaire**

Dans `app/src/export/template-export.ts`, ajouter à `LISTES` :

```ts
  // Métier ou technique. Fermé à deux valeurs : la distinction ne souffre pas
  // de nuance, et un troisième terme rendrait le masquage imprévisible.
  Nature: ["Business", "Technical"],
```

Poser la validation sur la colonne `Nature` de `ActorTypes` en suivant exactement le patron des autres validations de ce fichier (lire `validationsDuModele`). `Relays` est un texte libre : aucune validation.

Vérifier que `ICONES_PAR_DEFAUT` et `CLASSEUR_VIDE` alimentent bien la colonne `Nature` de l'amorce — laisser la nature **vide** dans l'amorce plutôt que de la deviner.

- [ ] **Step 4: monter la version et ajouter l'étape**

Dans `app/src/parsing/build-model.ts` : `export const VERSION_MODELE = 3;`

Dans `app/src/export/migration-modele.ts`, à la fin de `ETAPES_MISE_A_NIVEAU` :

```ts
  // Les deux colonnes de la lecture fonctionnelle -- nature du type d'acteur,
  // relais d'interface -- changent la forme du classeur. Le modèle, lui, n'a
  // rien à convertir : elles arrivent vides, et la reconstruction les produit
  // ainsi. L'étape existe pour que les classeurs en circulation soient
  // reconnus comme périmés et repassent par l'écriture.
  { de: 2, vers: 3, appliquer: (model) => model },
```

- [ ] **Step 5: vérifier que les tests passent**

Run: `cd app && npx vitest run && npx tsc --noEmit && npm run build`
Expected: PASS, build ok.

- [ ] **Step 6: vérifier sur un vrai classeur**

Écrire un harnais jetable, le bundler, l'exécuter, puis le supprimer :

```bash
cd app && cat > h.ts <<'EOF'
import * as fs from "fs";
import * as XLSX from "xlsx";
import { reparerClasseur } from "./src/export/reparation";
import { écrireModele } from "./src/export/template-export";
const buf = fs.readFileSync(process.argv[2]);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
const wb = XLSX.read(new Uint8Array(écrireModele(reparerClasseur(ab, new Date("2026-08-18")).donnees)), { type: "array" });
for (const n of ["ActorTypes", "Interfaces"]) {
  console.log(n, XLSX.utils.sheet_to_json<string[]>(wb.Sheets[n], { header: 1 })[0].join(" | "));
}
EOF
npx esbuild h.ts --bundle --platform=node --format=cjs --outfile=/tmp/h.js >/dev/null && rm h.ts
node /tmp/h.js ../Exemples/cartographie-interfaces_3.xlsx
```

Attendu : `ActorTypes` porte `Actor type | Icon | Nature`, et `Interfaces` porte `Relays` entre `To confirm` et `Introduced at`. Les valeurs sont vides — aucune nature n'est devinée.

- [ ] **Step 7: commit**

```bash
git add app/src/export app/src/parsing
git commit -m "feat(workbook): schema v3 carries nature and relays"
```

---

## Task 7 : le mode dans l'interface

**Files:**
- Modify: `app/src/ui/state.ts`
- Modify: `app/src/ui/rail.ts`
- Modify: `app/src/ui/banner.ts`
- Modify: `app/src/ui/app.ts`
- Test: `app/src/ui/state.test.ts`

**Interfaces:**
- Consumes: `Mode` (Task 4).
- Produces: `AppState.mode: Mode`, `withMode(state: AppState, mode: Mode): AppState`, `RailCallbacks.onMode: (mode: Mode) => void`.

- [ ] **Step 1: écrire les tests qui échouent**

Dans `app/src/ui/state.test.ts` :

```ts
describe("mode de lecture", () => {
  it("ouvre en architecture", () => {
    expect(initialState().mode).toBe("architecture");
  });

  it("retient le mode choisi", () => {
    expect(withMode(initialState(), "fonctionnel").mode).toBe("fonctionnel");
  });

  // « Par technologie » n'a pas d'objet sans technologie : y rester
  // afficherait une vue vide sans rien expliquer.
  it("quitte la vue par technologie en passant en fonctionnel", () => {
    const s = withVue(initialState(), "par-technologie");
    expect(withMode(s, "fonctionnel").vue).toBe("groupe-a-groupe");
  });

  it("laisse la vue en place quand elle garde un sens", () => {
    const s = withVue(initialState(), "matrice");
    expect(withMode(s, "fonctionnel").vue).toBe("matrice");
  });
});
```

- [ ] **Step 2: vérifier que les tests échouent**

Run: `cd app && npx vitest run src/ui/state.test.ts -t "mode de lecture"`
Expected: FAIL — `withMode` n'existe pas.

- [ ] **Step 3: porter le mode dans l'état**

Dans `app/src/ui/state.ts`, ajouter `mode: Mode` à `AppState`, `mode: "architecture"` dans `initialState()` et dans `withFichierCharge`, puis :

```ts
// « Par technologie » n'a pas d'objet en fonctionnel : y laisser l'utilisateur
// lui montrerait une vue vide sans rien lui expliquer.
export function withMode(state: AppState, mode: Mode): AppState {
  const vue = mode === "fonctionnel" && state.vue === "par-technologie" ? "groupe-a-groupe" : state.vue;
  return { ...state, mode, vue };
}
```

- [ ] **Step 4: poser le sélecteur dans le rail**

Dans `app/src/ui/rail.ts`, ajouter `onMode: (mode: Mode) => void` à `RailCallbacks`, et rendre le sélecteur **au-dessus de la liste des vues**, en réemployant la classe `rail-palier` déjà stylée dans `index.html` :

```ts
// Le mode se choisit avant la vue, parce qu'il décide lesquelles ont un sens.
// Toujours offert, même sur un classeur sans aucune nature renseignée : le mode
// fonctionnel y fusionne déjà les médias, et c'est ce qui le rend découvrable
// -- caché, personne ne saurait qu'il faut remplir la colonne.
function renderMode(root: HTMLElement, state: AppState, onMode: (mode: Mode) => void): void {
  const bloc = el("label", { class: "rail-palier" });
  bloc.appendChild(el("span", { class: "rail-palier-titre" }, ["Reading"]));
  const select = el("select") as HTMLSelectElement;
  for (const [valeur, libellé] of [["architecture", "Architecture"], ["fonctionnel", "Functional"]] as const) {
    const option = el("option", { value: valeur }, [libellé]) as HTMLOptionElement;
    option.selected = state.mode === valeur;
    select.appendChild(option);
  }
  select.addEventListener("change", () => onMode(select.value as Mode));
  bloc.appendChild(select);
  root.appendChild(bloc);
}
```

Relire `renderPalier` dans ce même fichier avant d'écrire, et calquer la structure DOM exacte qu'il produit.

Retirer l'entrée « By technology » de la liste des vues quand `state.mode === "fonctionnel"`, et masquer la légende des technologies dans ce mode.

- [ ] **Step 5: éteindre les deux DSL en fonctionnel**

Dans `app/src/ui/banner.ts`, la boucle qui pose `draw.io`, `Structurizr` et `LikeC4` doit distinguer les trois :

```ts
  // draw.io est un dessin : il suit le mode. Structurizr et LikeC4 décrivent un
  // modèle C4, c'est-à-dire une ARCHITECTURE ; un schéma fonctionnel n'en est
  // pas un, et livrer un fichier qui raconte autre chose que l'écran est
  // précisément ce qu'on s'interdit ailleurs.
  const architectureSeule = state.mode === "fonctionnel";
```

`draw.io` reste actif dans les deux modes ; les deux autres portent `disabled = state.fichier === null || state.vue === "mise-a-niveau" || architectureSeule`.

- [ ] **Step 6: faire circuler le mode dans app.ts**

Dans `app/src/ui/app.ts`, `options` reçoit `mode: state.mode`, et le rail reçoit `onMode: (mode) => setState(withMode(state, mode))`.

- [ ] **Step 7: vérifier que les tests passent**

Run: `cd app && npx vitest run && npx tsc --noEmit && npm run build`
Expected: PASS, build ok.

- [ ] **Step 8: vérifier dans Chrome**

Charger un classeur, basculer en Fonctionnel : les acteurs techniques disparaissent, « By technology » quitte le rail, la légende disparaît, `Structurizr` et `LikeC4` s'éteignent, `draw.io` reste actif.

- [ ] **Step 9: commit**

```bash
git add app/src/ui
git commit -m "feat(ui): read the parc as architecture or as function"
```

---

## Task 8 : les exports suivent le mode

**Files:**
- Modify: `app/src/aggregation/planches.ts`
- Modify: `app/src/export/filename.ts`
- Modify: `app/src/ui/app.ts`
- Test: `app/src/aggregation/planches.test.ts`, `app/src/export/export.test.ts`

**Interfaces:**
- Consumes: `Mode` (Task 4), `acteursMetier` (Task 2).
- Produces: `toutesLesPlanches(model: ParsedModel, rang: number | null, mode: Mode): Planche[]`, `buildExportFilename(vue, selection, palier, ext, mode?)`.

- [ ] **Step 1: écrire les tests qui échouent**

Dans `app/src/aggregation/planches.test.ts` :

```ts
describe("planches selon le mode", () => {
  it("n'inclut aucune planche par technologie en fonctionnel", () => {
    const titres = toutesLesPlanches(modeleAvecTechnique(), null, "fonctionnel").map((p) => p.titre);
    expect(titres).not.toContain("HTTP");
  });

  it("n'inclut aucune planche pour un acteur technique", () => {
    const titres = toutesLesPlanches(modeleAvecTechnique(), null, "fonctionnel").map((p) => p.titre);
    expect(titres).not.toContain("Bus");
  });

  it("garde les trois vues fixes", () => {
    const titres = toutesLesPlanches(modeleAvecTechnique(), null, "fonctionnel").map((p) => p.titre);
    expect(titres.slice(0, 3)).toEqual(["Group to group", "Platform detail", "Platform only"]);
  });
});
```

Écrire `modeleAvecTechnique()` dans ce fichier sur le modèle des helpers déjà présents : un acteur `Bus` de type `Middleware` déclaré `Technical`, relayant un flux d'`Tatooine` vers `Naboo`.

Dans `app/src/export/export.test.ts` :

```ts
describe("buildExportFilename — mode", () => {
  it("nomme le mode fonctionnel", () => {
    expect(buildExportFilename("Group to group", null, "v2", "drawio", "fonctionnel")).toBe(
      "carto-functional-group-to-group-v2.drawio"
    );
  });

  // Les noms d'aujourd'hui ne bougent pas : l'architecture reste muette.
  it("laisse l'architecture muette", () => {
    expect(buildExportFilename("Group to group", null, "v2", "drawio", "architecture")).toBe(
      "carto-group-to-group-v2.drawio"
    );
  });
});
```

- [ ] **Step 2: vérifier que les tests échouent**

Run: `cd app && npx vitest run src/aggregation/planches.test.ts src/export/export.test.ts`
Expected: FAIL — arité de `toutesLesPlanches` et de `buildExportFilename`.

- [ ] **Step 3: implémenter**

Dans `app/src/aggregation/planches.ts`, `toutesLesPlanches` prend `mode` en troisième paramètre, le passe aux vues via les options, et :

```ts
  // Pas de planche par technologie en fonctionnel : il n'y a plus de
  // technologie. Et pas de planche pour un acteur qui n'est pas sur la carte.
  const technologies = mode === "fonctionnel" ? [] : [...new Set(flux.map((f) => f.typeDeFlux.trim()))].sort(parNom);
```

les acteurs venant de `flux`, déjà réduits aux métiers puisque `fluxDuMode` les a produits.

Dans `app/src/export/filename.ts` :

```ts
export function buildExportFilename(
  vue: string,
  selection: string | null,
  palier: string | null,
  ext: "svg" | "png" | "xlsx" | "md" | "drawio" | "dsl" | "c4",
  mode: Mode = "architecture"
): string {
  // Le mode ne se dit qu'en fonctionnel : les noms produits jusqu'ici ne
  // bougent pas, et deux exports du même schéma ne peuvent plus se recouvrir.
  const parts = ["carto", ...(mode === "fonctionnel" ? ["functional"] : []), slug(vue)];
```

Dans `app/src/ui/app.ts`, passer `state.mode` à `toutesLesPlanches` et à chaque `buildExportFilename`.

- [ ] **Step 4: vérifier que les tests passent**

Run: `cd app && npx vitest run && npx tsc --noEmit && npm run build`
Expected: PASS, build ok.

- [ ] **Step 5: vérifier dans Chrome**

En mode fonctionnel, exporter draw.io : le fichier s'appelle `carto-functional-boards-<palier>.drawio`, ne contient aucun onglet de technologie ni d'acteur technique, et son XML se relit sans erreur.

- [ ] **Step 6: commit**

```bash
git add app/src/aggregation app/src/export app/src/ui
git commit -m "feat(export): the boards follow the mode on show"
```

---

## Task 9 : la spec de référence enregistre le mode

**Files:**
- Modify: `docs/superpowers/specs/2026-08-14-carto-interfaces-design.md`

**Interfaces:**
- Consumes: rien.
- Produces: rien.

- [ ] **Step 1: mettre la spec de référence à jour**

Elle décrit l'outil tel qu'il est, et ne connaît ni le mode ni les deux colonnes. Ajouter :

- §3.2 : les colonnes `Nature` (sur `ActorTypes`) et `Relays` (sur `Interfaces`).
- §5 : une phrase d'introduction disant que les vues se lisent dans l'un ou l'autre mode, et que « Par technologie » n'existe qu'en architecture.
- §7 : les huit contrôles, dans leurs familles.
- §8 : le tableau des exports et leur rapport au mode.

Renvoyer vers `docs/superpowers/specs/2026-08-18-schemas-fonctionnels-design.md` pour le détail plutôt que de le recopier.

- [ ] **Step 2: commit**

```bash
git add docs/superpowers/specs
git commit -m "docs(spec): the reference spec knows about the two readings"
```
