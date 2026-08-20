# Versions d'interface, état de cycle de vie, et versionnement du modèle

> **Fusion du 17 août 2026.** Les paliers de schéma décrits ici (v1, v2, v3) n'ont jamais été livrés : ils ont été fusionnés en une seule étape `0 → 1` avant toute mise en circulation. Le schéma courant est **v2**, et un seul format existe en amont — celui d'avant le versionnement. Ce document garde la décision qui l'a produit ; il ne décrit plus un état du code.

> **Correctif du 18 août 2026 — schéma v2.** La traduction a renommé l'onglet `Listes` en `Lists` mais a laissé trois formules citer l'ancien nom. Excel n'y voyait pas une faute : il en déduisait un renvoi vers un AUTRE CLASSEUR, d'où l'avertissement « liaisons avec une ou plusieurs sources externes » à chaque ouverture, et des listes déroulantes dépendantes qui ne se remplissaient jamais. Le v1 était déjà en production : le schéma passe donc en **v2** pour que les classeurs distribués soient reconnus comme périmés et repassent par la reconstruction. L'étape `1 → 2` ne transforme rien dans le modèle — les formules naissent à l'écriture ; l'onglet `Milestones` y gagne au passage le tableau structuré qui lui manquait.

Spécification · 17 août 2026

Complète la spécification de référence du 14 août 2026, dont elle modifie §3.1, §3.2, §3.3 et §7.

---

## 1. Objet

Trois besoins liés :

1. Suivre la **version** d'une interface, plusieurs versions d'un même contrat pouvant coexister.
2. Suivre son **état de cycle de vie** : en service, en cours de retrait, retiré.
3. Répondre à la question « **les consommateurs ont-ils migré ?** » sans dépouiller le classeur à la main.

S'y ajoute un moyen technique qui les rend tenables dans la durée : un **numéro de schéma** inscrit dans le classeur, pour que l'outil sache à quel format il a affaire et puisse mettre à niveau les classeurs plus anciens.

---

## 2. Modèle de données

### 2.1 Colonnes ajoutées

**`Interfaces`** — deux colonnes, insérées après `Nom du flux` :

| Colonne | Nature | Valeurs |
|---|---|---|
| `Version` | texte libre | `1.0`, `2024-06`, `v3`… la convention appartient au classeur |
| `État` | vocabulaire fermé | `Actif` · `À décommissionner` · `Retiré` |

**`FX_*`** — une colonne, insérée après `Nom du flux` :

| Colonne | Nature | Valeurs |
|---|---|---|
| `Version` | texte libre | la version consommée, telle qu'écrite au catalogue |

`Version` est en saisie libre et non une liste fermée : les schémas de version varient d'une équipe à l'autre, et une liste imposée les ferait tous rentrer de force dans un seul.

### 2.2 Identité d'une interface

Le rattachement d'une consommation à son interface se fait désormais par le triplet **(feuille, `Nom du flux`, `Version`)** — la règle de §3.3 gagne un terme.

Sans ce troisième terme, deux versions d'un même contrat exposées par le même acteur avec la même technologie produisent la même clé, et aucune consommation ne peut dire laquelle elle consomme. C'est précisément ce que la fonctionnalité demande de distinguer.

### 2.3 Valeurs vides

Une `Version` vide est une version comme une autre, pas une absence : elle participe à la clé au même titre qu'une autre valeur. Les classeurs antérieurs, où toutes les cellules `Version` sont vides, se rattachent donc exactement comme avant.

Un `État` vide vaut `Actif`. La convention existante le veut ainsi : `horsVocabulaire()` ne signale jamais une cellule vide, et §7.4 traite séparément les manques de saisie.

### 2.4 Effet sur le modèle en mémoire

- `InterfaceCatalogue` gagne `version: string` et `etat: string`.
- `Consommation` gagne `version: string`.
- `ParsedModel` gagne `versionModele: number` (§4).

---

## 3. Contrôles et rapport

### 3.1 Vocabulaire (§7.2 existant)

`État` hors de la liste admise rejoint les autres contrôles de vocabulaire, avec le même message et le même niveau.

### 3.2 Cohérence (§7.3 existant) — deux anomalies

**Un consommateur sur deux versions du même contrat.** Un acteur qui apparaît sur deux versions du même `Nom du flux` dans le même onglet est une incohérence, pas une étape de migration : on ne consomme pas deux versions d'un contrat à la fois. Message nommant l'acteur, l'interface et les deux versions.

**Une interface `Retiré` encore consommée.** Le classeur se contredit : il décrit une consommation de ce qui n'existe plus. Anomalie, donc compteur rouge et ouverture forcée sur les Contrôles — un schéma tracé sur cette base montrerait un flux qui n'existe pas.

### 3.3 Bloc action « migrations en cours »

Niveau `action` (compteur bleu), donc sans blocage de la lecture des schémas.

Pour chaque interface dont l'`État` vaut `À décommissionner` et qui porte encore au moins une consommation, un item nommant l'interface, sa version, la version active visée, et les consommateurs restants :

```
Paiement API 1.0 → 2.0 : Alderaan, Mygeeto
```

La version visée est celle de l'interface de même `Nom du flux`, dans le même onglet, dont l'`État` vaut `Actif`. S'il n'en existe aucune, l'item le dit :

```
Paiement API 1.0 → aucune version active : Alderaan
```

Ce cas mérite son libellé propre : sans lui, le rapport laisserait croire que la migration ne demande qu'un déplacement de cellule, alors que la version d'arrivée reste à créer.

S'il existe plusieurs versions actives du même nom, l'item les nomme toutes ; choisir à la place du classeur reviendrait à inventer une cible.

### 3.4 Ce qui ne change pas

Le contrôle « colonne non clé absente » de §7.1 reste tel quel pour les autres colonnes. Il ne verra jamais `Version` ni `État` manquantes : un classeur qui ne les a pas est arrêté en amont par la mise à niveau (§4.3).

---

## 4. Versionnement du modèle

### 4.1 L'onglet `Version`

Un onglet masqué nommé `Version`, aux côtés de `Listes` et `FX_Modèle`, contenant une seule valeur : un **entier monotone**. Pas un semver, pas une date — c'est un numéro de schéma, il ne sert qu'à savoir quelles transformations appliquer et dans quel ordre.

`VERSION_MODELE` est une constante du code. Tout classeur produit par l'outil la porte : modèle vierge, fichier d'exemple, sortie de migration. Les deux colonnes de §2 font passer le modèle en **version 1**.

Un classeur sans onglet `Version` est en **version 0** : c'est le cas de tous ceux produits avant cette évolution.

Ce numéro ne fait pas double emploi avec l'historisation écartée en §1 de la spécification de référence : celle-ci concerne les révisions d'un document, assurées par SharePoint ; celui-là décrit la forme du classeur.

### 4.2 Classeur plus récent que l'outil

Un classeur dont le numéro dépasse `VERSION_MODELE` est refusé sans être lu, avec un message qui le dit. Deviner la forme d'un format qu'on ne connaît pas produirait des schémas faux, ce qui est pire que de ne rien afficher.

### 4.3 Classeur plus ancien : mise à niveau imposée

Si `versionModele < VERSION_MODELE`, aucune vue n'est accessible. À la place, un écran nommant les deux versions et proposant un unique bouton, qui produit le classeur mis à niveau en téléchargement. Les boutons de vue du rail restent visibles mais inertes : les rendre cliquables pour les voir refuser serait pire que de les griser.

Le choix d'imposer plutôt que de proposer découle de ce que le classeur est *incompris*, pas seulement incomplet : sans la colonne `Version`, deux versions d'un contrat se confondent, et les schémas comme le rapport de migration seraient faux sans le dire.

### 4.4 La chaîne de mise à niveau

Un module dédié porte une liste **ordonnée** d'étapes `{ de, vers, appliquer }`. La mise à niveau applique les étapes dont le rang part de la version du classeur jusqu'à `VERSION_MODELE`, puis réécrit le classeur par le chemin d'écriture existant.

La v0 → v1 se contente d'ajouter les colonnes vides. La liste ne compte donc qu'une étape aujourd'hui : c'est la charpente qui compte, pour que la deuxième s'ajoute sans rien réécrire.

### 4.5 Ce que la mise à niveau conserve, et ce qu'elle perd

Le classeur produit est reconstruit à partir de ce que le modèle a compris. Sont **conservés** : acteurs, groupes, types d'acteur et de flux, interfaces, consommations, et la macro, réinstallée à jour. Sont **perdus** : les colonnes libres ajoutées par l'utilisateur, les mises en forme, les feuilles personnelles.

C'est déjà le fonctionnement de la conversion legacy, donc le principe n'est pas nouveau ; mais une mise à niveau imposée l'applique à des classeurs de travail et non plus seulement à des imports. L'écran de §4.3 l'énonce avant le clic.

**Décision (17 août 2026)** : cette perte est acceptée. La mise à niveau ne conserve que ce que le projet définit ; les ajouts propres à un classeur ne sont pas repris.

La règle qui en découle mérite d'être dite dans l'autre sens, parce qu'elle engage la suite : **un classeur n'est pas un endroit où ranger ses propres colonnes**. Ce qui doit survivre à une mise à niveau doit être défini par le projet, donc figurer dans `COLONNES_*`. Une équipe qui a besoin d'une information de plus demande une colonne, elle ne l'ajoute pas dans son coin.

### 4.6 Rapport avec la conversion legacy

La conversion legacy traduit un format **étranger** (feuilles `Flux` / `Composants`), pas une version antérieure du nôtre. Elle garde son bouton et sa boîte de dialogue, et émet désormais du `VERSION_MODELE` courant. La chaîne de mise à niveau ne couvre que notre propre famille, de la v0 vers le haut.

---

## 5. Effet sur les vues

Une consommation dont l'interface est `À décommissionner` ou `Retiré` est **exclue de la vue « cible »**, au même titre qu'une décision `À supprimer` ou un statut `Décommissionné`. La cible, c'est l'après.

Les vues courantes continuent de tout montrer : sans cela, l'anomalie « interface retirée mais encore consommée » (§3.2) serait invisible sur les schémas, alors que c'est exactement ce qu'il faut voir.

---

## 6. Classeur généré

- Le vocabulaire d'`État` rejoint les listes de validation du modèle, avec sa plage nommée, attachée à la colonne `État` de `Interfaces`. `Version` reste en saisie libre, sans liste.
- Les largeurs de colonnes de `Interfaces` et des onglets `FX_` sont calculées depuis les intitulés : rien à ajuster.
- Les lignes du fichier d'exemple s'allongent, et le jeu de données gagne **un cas de migration en cours** — le fichier d'exemple sert à montrer l'outil à l'œuvre, le rapport de migration en fait partie.
- La macro VBA lit le tableau `TblInterfaces` par nom de colonne : elle n'est pas à retoucher.
- La conversion legacy allonge ses lignes de cellules vides. Le format d'origine ne connaît ni version ni état, et la doctrine du convertisseur est de ne pas inventer ce qu'il ne sait pas ; §7.4 signalera les manques.

---

## 7. Mise à jour de la spécification de référence

- **§3.1** — la feuille `Version` rejoint la liste des feuilles ignorées à la lecture des données.
- **§3.2** — colonnes de `Interfaces` et `FX_*` mises à jour. Au passage, la dérive connue de cette section est corrigée : `Périmètre` et `Statut` ne sont plus sur `Acteurs` (le périmètre est porté par `Groupes`), et la colonne `Détail` n'existe plus.
- **§3.3** — la règle de rattachement gagne son troisième terme.
- **§7.2**, **§7.3** — les contrôles de §3.1 et §3.2 du présent document.
- **§7** — un bloc informatif de niveau action s'ajoute aux existants.

---

## 8. Tests

Chaque unité est développée en TDD. Couverture attendue :

- lecture des trois colonnes, y compris vides ;
- rattachement par clé à trois termes, et non-rattachement quand la version diffère ;
- vocabulaire `État` hors liste ;
- les deux anomalies de cohérence de §3.2 ;
- le bloc action, y compris le cas « aucune version active » et celui de plusieurs versions actives ;
- exclusion en vue cible ;
- lecture du numéro de schéma, absence d'onglet valant 0, refus d'un numéro supérieur ;
- mise à niveau v0 → v1 : colonnes présentes, données conservées, numéro écrit ;
- présence des colonnes, de la validation et de l'onglet `Version` dans le classeur généré ;
- conversion legacy émettant le numéro courant.
