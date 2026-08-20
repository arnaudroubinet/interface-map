# Listes déroulantes dépendantes dans les onglets `FX_`

> **Correctif du 18 août 2026 — schéma v2.** La traduction a renommé l'onglet `Listes` en `Lists` mais a laissé trois formules citer l'ancien nom. Excel n'y voyait pas une faute : il en déduisait un renvoi vers un AUTRE CLASSEUR, d'où l'avertissement « liaisons avec une ou plusieurs sources externes » à chaque ouverture, et des listes déroulantes dépendantes qui ne se remplissaient jamais. Le v1 était déjà en production : le schéma passe donc en **v2** pour que les classeurs distribués soient reconnus comme périmés et repassent par la reconstruction. L'étape `1 → 2` ne transforme rien dans le modèle — les formules naissent à l'écriture ; l'onglet `Milestones` y gagne au passage le tableau structuré qui lui manquait.
Spécification · 17 août 2026

Suite de la spécification du 17 août 2026 sur les versions d'interface. Modifie §12 et les listes de validation décrites en §3.

---

## 1. Objet

Dans un onglet `FX_<exposant>_<type>`, la saisie doit proposer :

- en `Nom du flux`, **uniquement les interfaces de ce composant** — celles dont l'onglet attendu est précisément cet onglet ;
- en `Version`, **uniquement les versions du flux saisi sur la ligne**.

Aujourd'hui la première liste est globale (`L_Flux` énumère tous les noms du catalogue) et la seconde n'existe pas.

## 2. Prérequis assumé : Microsoft 365

Les tables intermédiaires reposent sur les fonctions à résultat étalé (`FILTER`, `SORTBY`, `UNIQUE`, `HSTACK`, `SEQUENCE`). C'est cohérent avec la spécification de référence, qui fonde déjà la co-édition sur M365.

Le prérequis est **structurel, pas cosmétique** : sans ces fonctions, les tables intermédiaires ne peuvent pas rester vivantes, et une table figée à la génération cesse d'être juste dès la première interface ajoutée dans Excel. Un classeur ouvert dans un Excel plus ancien affichera des listes vides, jamais des listes fausses.

## 3. Deux tables vivantes dans l'onglet `Listes`

L'onglet `Listes` — déjà masqué et déjà ignoré par le parseur — gagne deux blocs, placés après les colonnes de vocabulaire existantes et calculés depuis `Interfaces`.

**Table des versions** — deux colonnes :

| clé | version |
|---|---|
| `FX_Tatooine_HTTP\|Authent` | `1.0` |
| `FX_Tatooine_HTTP\|Authent` | `2.0` |

Triée par clé. Le tri n'est pas cosmétique : c'est lui qui rend les versions d'un même flux **contiguës**, condition nécessaire pour que `MATCH` + `COUNTIF` en découpent un bloc.

**Table des flux** — les couples (onglet attendu, nom du flux) **dédoublonnés**, triés par onglet. Le dédoublonnage évite qu'un flux à trois versions apparaisse trois fois dans la liste déroulante.

L'onglet attendu est reconstruit comme partout ailleurs : `"FX_"` + acteur exposant + `"_"` + type de flux.

## 4. La cellule d'appoint

La formule de validation posée sur `FX_Modèle` est **recopiée telle quelle** par la macro dans chaque onglet créé (§12, `wsModele.Copy`). Elle doit donc découvrir seule sur quel onglet elle se trouve.

Chaque onglet `FX_` porte, hors du tableau et dans une **colonne masquée**, une cellule donnant le nom de l'onglet, dérivée de `CELL("filename")`. La macro duplique la feuille entière : la cellule voyage avec elle, et le renommage de la copie la met à jour sans qu'on touche au binaire VBA.

Une cellule par onglet plutôt que l'expression répétée dans chaque validation : `CELL` est volatile, on ne la recalcule ainsi qu'une fois par feuille au lieu d'une fois par ligne validée.

**Limite connue** : `CELL("filename")` renvoie une chaîne vide tant que le classeur n'a jamais été enregistré. Le classeur étant téléchargé puis ouvert depuis le disque ou SharePoint, le cas ne se présente pas en usage normal ; le symptôme serait des listes vides, pas des listes fausses.

## 5. Les deux validations

Sur `Nom du flux` : `OFFSET` sur la colonne des flux de la table des flux, positionné par `MATCH` du nom de l'onglet, hauteur donnée par `COUNTIF`.

Sur `Version` : même mécanique sur la table des versions, la clé étant `<nom de l'onglet>` + `|` + `<nom du flux de la ligne>`. La référence au nom du flux est **relative en ligne** : Excel décale la formule ligne à ligne, chaque ligne obtient donc la liste de son propre flux.

Ces deux validations remplacent l'actuelle sur `Nom du flux`. La plage nommée `L_Flux` n'a plus d'emploi et disparaît. Les autres validations des onglets `FX_` (acteur consommateur, criticité, statut, décision) ne changent pas.

Sur `Interfaces`, la colonne `Version` **reste en saisie libre** : c'est là qu'une version est créée, une liste fermée empêcherait d'en créer une nouvelle.

## 6. Ce que ces listes ne font pas

Elles aident la frappe, elles ne valident rien. Excel n'empêche pas de coller une valeur hors liste, et renommer un flux ne corrige pas les lignes déjà saisies. Le contrôle « version absente du catalogue pour ce flux » reste le filet réel et n'est pas retiré.

## 7. Effet sur le code

- `feuilleListes()` produit les deux blocs en plus des colonnes de vocabulaire.
- `ValidationÀPoser` porte aujourd'hui un nom de plage ; elle portera une formule quelconque — un nom de plage en étant une. Le champ est renommé pour dire ce qu'il est.
- `FX_Modèle` et chaque onglet `FX_` garni reçoivent la cellule d'appoint et la colonne masquée.
- Ni la macro ni le parseur ne changent.

## 8. Risque technique ouvert

Une formule à résultat étalé se déclare dans le `.xlsx` par des métadonnées que SheetJS n'écrit pas nativement. Deux issues, à trancher aux premiers essais :

1. écrire ces métadonnées dans l'OOXML composé à la main (`xlsx-tables.ts` en compose déjà pour les tableaux et les validations) ;
2. ou retomber sur une **formule matricielle classique sur une plage fixe**, dimensionnée d'avance, les cellules excédentaires étant vidées par `IFERROR`.

La seconde issue est la plus sûre et sera tentée d'abord : la plage est connue à la génération, et une matricielle classique est comprise par tous les Excel qui comprennent déjà `FILTER`.

## 9. Vérification

Le classeur produit est relu par le parseur du projet et contrôlé dans le navigateur, comme tout le reste. Mais **ni l'un ni l'autre n'exécute de formule Excel** : le comportement réel des listes dépendantes ne peut être constaté qu'en ouvrant le fichier dans Excel.

La vérification finale appartient donc à l'utilisateur, sur un classeur d'essai fourni, avec une liste explicite de ce qu'il faut regarder : la liste des flux dans un onglet `FX_` donné, la liste des versions après saisie d'un flux, et le comportement d'un onglet fraîchement créé par la macro.

## 10. Tests automatisés

- les deux tables figurent dans l'onglet `Listes` du classeur produit ;
- la cellule d'appoint est présente sur `FX_Modèle` et sur chaque onglet garni, dans une colonne masquée hors du tableau ;
- les deux validations sont posées sur les bonnes colonnes, avec la formule attendue ;
- `L_Flux` a disparu des plages nommées, et plus aucune validation ne s'y réfère ;
- le classeur produit se relit sans erreur bloquante ni colonne manquante, et son onglet `Listes` reste ignoré du parseur.
