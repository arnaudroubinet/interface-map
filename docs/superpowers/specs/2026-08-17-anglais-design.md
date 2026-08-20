# Le produit passe en anglais, interface et classeur

> **Fusion du 17 août 2026.** Les paliers de schéma décrits ici (v1, v2, v3) n'ont jamais été livrés : ils ont été fusionnés en une seule étape `0 → 1` avant toute mise en circulation. Le schéma courant est **v2**, et un seul format existe en amont — celui d'avant le versionnement. Ce document garde la décision qui l'a produit ; il ne décrit plus un état du code.

> **Correctif du 18 août 2026 — schéma v2.** La traduction a renommé l'onglet `Listes` en `Lists` mais a laissé trois formules citer l'ancien nom. Excel n'y voyait pas une faute : il en déduisait un renvoi vers un AUTRE CLASSEUR, d'où l'avertissement « liaisons avec une ou plusieurs sources externes » à chaque ouverture, et des listes déroulantes dépendantes qui ne se remplissaient jamais. Le v1 était déjà en production : le schéma passe donc en **v2** pour que les classeurs distribués soient reconnus comme périmés et repassent par la reconstruction. L'étape `1 → 2` ne transforme rien dans le modèle — les formules naissent à l'écriture ; l'onglet `Milestones` y gagne au passage le tableau structuré qui lui manquait.

Spécification · 17 août 2026

Fait passer le modèle en **schéma v3**.

---

## 1. Portée

Tout ce qui se lit est en anglais : l'interface, et le classeur lui-même — noms de feuilles, en-têtes de colonnes, vocabulaires fermés, prose du mode d'emploi et jeu de données d'exemple.

Ne sont **pas** traduites les données saisies par les équipes : noms d'acteurs, de groupes, de flux, descriptions, commentaires. Ce sont leurs mots, dans leur langue.

## 2. Le classeur

| Avant | Après |
|---|---|
| `Mode d'emploi` · `Acteurs` · `Groupes` · `Paliers` · `TypesActeur` · `TypesFlux` · `Listes` | `Instructions` · `Actors` · `Groups` · `Milestones` · `ActorTypes` · `FlowTypes` · `Lists` |
| `Nom du flux` · `Acteur exposant` · `Palier d'introduction` | `Flow name` · `Provider` · `Introduced at` |
| `Plateforme` / `Externe` | `Platform` / `External` |
| `À conserver` / `À creuser` / `À transformer` | `Keep` / `Investigate` / `Transform` |
| `1 - Vitale` / `2 - Importante` | `1 - Critical` / `2 - Important` |
| `Oui` / `Non` · `Livré` / `Planifié` | `Yes` / `No` · `Delivered` / `Planned` |
| `exposant → consommateur` | `provider → consumer` |

Le préfixe `FX_` ne change pas : le reste du nom d'onglet vient des données.

## 3. Lire encore un classeur v2

Le parseur reconnaît **les deux écritures** des noms de feuilles et de colonnes, et les deux écritures des deux valeurs qu'il interprète dès la lecture (`Oui`/`Yes`, le sens de représentation). C'est ce qui permet de lire un classeur v2 pour le convertir, et rien d'autre n'en dépend : aucun classeur produit ne porte plus les noms français.

La table des équivalences vit à un seul endroit, dans le module qui compare les en-têtes.

## 4. La conversion v2 → v3

Les noms de feuilles et de colonnes sont portés par l'écriture, qui les produit déjà en anglais. Ce que l'étape traduit, ce sont les **valeurs déjà saisies** : périmètres, décisions, criticités, statuts de palier, sens de représentation.

**Une valeur inconnue est laissée telle quelle.** C'est peut-être un terme propre à l'équipe ; le contrôle de vocabulaire la signalera plutôt qu'on l'écrase.

Les **noms** de paliers ne sont pas traduits : ce sont des données, et des lignes s'y réfèrent. Un classeur passé par la v1 → v2 avant ce changement garde donc le palier `À venir` que cette conversion lui avait donné.

## 5. Un défaut corrigé au passage

La mise à niveau **remplaçait** `TypesFlux` et `TypesActeur` par les valeurs d'amorce au lieu de conserver celles du classeur. Inoffensif tant que tout était français et que l'amorce coïncidait ; destructeur dès lors que l'amorce passe en anglais — chaque interface se serait retrouvée à référencer un type de flux disparu.

`DonneesClasseur` porte désormais ces deux référentiels, et l'amorce ne sert que lorsqu'ils sont vides, c'est-à-dire pour le modèle vierge.

## 6. Le convertisseur du format d'origine

Le format d'origine parle français et ne change pas : c'est un format étranger qu'on lit. Sa table de correspondance vers notre vocabulaire devient donc **explicite** — une comparaison de chaînes ne pouvait plus rien retrouver entre « À transformer » et « Transform ».
