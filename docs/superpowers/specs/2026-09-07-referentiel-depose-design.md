# Référentiel déposé à côté de la cartographie

Spécification · 7 septembre 2026

Remplace le mécanisme de la spec du 22 août 2026 (`2026-08-22-referentiel-externe-design.md`),
qui reste la trace de ce qui a été tenté et de ce que le format MS-QDEFF a coûté.

---

## 1. Ce qui ne marchait pas

Le classeur portait une requête Power Query vers une URL SharePoint, et c'est
Excel qui rafraîchissait les quatre onglets masqués `Ref*`. Trois frottements,
constatés à l'usage :

- l'URL devait être **nettoyée** — un « Copier le lien » SharePoint donne
  l'adresse d'une page, pas du fichier — et le champ l'expliquait sur deux
  paragraphes ;
- Excel demandait un **compte** au premier rafraîchissement, et refusait la
  connexion quand l'adresse était celle de la visionneuse ;
- personne n'**actualisait**. La copie dérivait du référentiel publié, et
  l'outil, qui ne lit que la copie, ne pouvait pas le voir.

## 2. La décision

**Le référentiel devient un fichier qu'on dépose, comme la cartographie.**
Plus d'URL, plus de requête, plus de flux binaire dans le classeur. La zone de
dépôt accepte plusieurs fichiers ; l'outil reconnaît chacun à sa forme.

La cartographie garde sa **copie** du référentiel dans les quatre onglets
masqués — c'est elle que lisent les listes déroulantes, les colonnes calculées
et le rapport d'intégrité — mais c'est **l'outil qui l'écrit**, et lui seul.

Quand les deux fichiers sont déposés ensemble, ou le référentiel après la
cartographie déjà à l'écran, l'outil **compare** la copie au référentiel. À
jour : la bannière le dit, en trois mots. Dérivée : la cartographie est
**reconstruite** avec les lignes du référentiel, affichée, et un **panneau au
centre de l'écran** l'annonce, avec le bouton **« Download the updated
workbook »** et un « Not now ». Périmètre arrêté par l'utilisateur le
7 septembre 2026, bouton plutôt que téléchargement automatique ; panneau
centré plutôt que phrase dans la bannière, le 8 septembre : une phrase et un
bouton sur la ligne de la bannière repoussaient les exports hors de vue.

## 3. Reconnaître un référentiel

Un référentiel et une cartographie partagent trois noms d'onglets (`Actors`,
`ActorTypes`, `FlowTypes`), et leurs onglets `Actors` ont les mêmes colonnes.
Deux signes les distinguent, et les deux sont exigés :

- le référentiel nomme ses groupes sous **`Name`** ; la cartographie dit
  `Group` et `Perimeter` ;
- le référentiel n'a **pas d'onglet `Interfaces`**.

Le second signe seul ne suffirait pas : une cartographie sans `Interfaces` est
précisément ce que l'écran de réparation existe pour recevoir, et elle doit
rester lue comme une cartographie incomplète.

On reconnaît les onglets par leurs noms **courants** seulement, pas par les
orthographes françaises que `headers.ts` accepte encore pour la cartographie :
une cartographie tenue à la main en français et privée de son onglet `Flux`
passait pour un référentiel, alors que c'est le fichier cassé que l'écran de
réparation existe pour recevoir.

On reconnaît les **onglets**, pas les tableaux Excel : les tableaux étaient ce
que la requête cherchait, et une copie enregistrée par un autre outil les perd
en gardant les onglets. Le fichier écrit par l'outil garde ses tableaux, pour
qui les lirait encore par une requête à lui.

## 4. Comparer

La copie de la cartographie et le référentiel déposé sont mis dans la même
forme — `ReferentialRows`, un tableau de lignes par onglet masqué, dans l'ordre
des colonnes que cet onglet déclare — puis comparés **cellule à cellule, dans
l'ordre**, après rognage des blancs.

Une ligne déplacée compte comme une dérive. C'est voulu : le coût d'un faux
positif est une réécriture qui produit une copie identique, alors que « les
mêmes lignes dans un autre ordre » obligerait à décider ce qu'est l'identité
d'une ligne — et un acteur renommé est exactement le cas où les deux côtés ne
sont pas d'accord là-dessus.

Une copie vide face à un référentiel rempli est une dérive : tout ce que le
référentiel publie lui est nouveau. L'inverse ne l'est pas : un onglet que le
référentiel laisse **vide** ne remplace pas la copie. Il dit « je n'ai pas de
groupes », pas « oubliez les vôtres » — vider la copie viderait les listes et
les colonnes calculées, la seule chose qu'une réécriture ne doit jamais faire.
La règle (`mergeReferential`) est la même au dépôt et à la réparation.

La comparaison porte sur la copie **telle qu'elle sera écrite**, des deux
côtés : le fichier qu'est le classeur, contre le fichier qu'il deviendrait.
Comparer les lignes du modèle à celles du référentiel manquait le repli de
l'écrivain, et un référentiel à onglet vide dérivait à chaque dépôt.

## 5. Reconstruire

La cartographie dérivée passe par `upgrade()` — le même chemin qu'une mise à
niveau de schéma — avec les lignes du référentiel à la place de la copie, puis
par `writeTemplate()`. Le fichier produit est **relu** par le même chemin qu'un
fichier déposé : ce que l'écran montre est le fichier qui sera téléchargé, pas
un modèle rafistolé en mémoire que le disque contredirait.

Conséquences assumées :

- un classeur en retard d'un schéma en sort au schéma courant ;
- la reconstruction a le coût d'une mise à niveau : colonnes ajoutées à la
  main, mises en forme et onglets personnels ne suivent pas. Le bouton le dit
  dans son infobulle ;
- le fichier est offert sous son **nom d'origine** (`.xlsm` → `.xlsx`), pour
  que remplacer celui du disque soit un « oui ».

Le verdict survit à la navigation : le panneau fermé, la bannière garde le
bouton, et lui seul, pendant qu'on regarde le classeur reconstruit. Le panneau
ne revient pas ; télécharger le ferme aussi. Le tout part avec le fichier — un
autre classeur chargé, un autre verdict dû.

Un référentiel déposé **après** la cartographie, celle-ci à l'écran, la
reconstruit sans déplacer le lecteur : la vue, le palier, les filtres et la
comparaison en cours restent ; seuls les placements sont recalculés, puisque
natures et icônes ont pu bouger. Le référentiel a changé la copie, pas le
sujet.

## 6. Refus

- Un référentiel déposé seul, sans cartographie à l'écran : refusé, nommé pour
  ce qu'il est.
- Deux cartographies, ou deux référentiels, dans un même dépôt : refusés.
  L'outil dessine un classeur, deux référentiels seraient deux vérités.
- Un refus arrête **tout** le dépôt, plutôt que d'en lire la moitié et de
  laisser deviner laquelle.
- Un référentiel donné au champ « Compare with a workbook » : refusé, il n'y a
  rien à comparer.

## 7. L'écran de réparation

Le champ URL disparaît. Le référentiel s'y dépose à côté du classeur à
réparer, dans le même geste ; le classeur réparé emporte ses lignes. Sans
référentiel dans le dépôt, la copie est **conservée** telle que le classeur la
portait — réparer ne vide pas les listes — et l'écran le dit.

Les deux boutons « Blank referential » et « Sample referential » restent : c'est
là qu'on obtient le fichier.

## 8. Le schéma

**Reste en v9.** Un palier a été envisagé, puis écarté le 7 septembre 2026 :
aucun onglet ni aucune colonne ne change, un classeur v9 se lit exactement
comme avant, sa requête est inerte tant que personne n'actualise dans Excel, et
toute réécriture par l'outil la laisse de côté. Un palier aurait envoyé chaque
classeur en circulation sur l'écran de mise à niveau pour un changement qu'il
ne peut pas voir.

## 9. Ce qui part

- `export/datamashup.ts` et son test : le flux MS-QDEFF, le M, les conventions
  UTF-16, le nettoyage d'URL.
- Dans `xlsx-tables.ts` : `connections.xml`, les parties `queryTable`, les
  noms définis `ExternalData_*`, les parties `customXml`, `tableType="queryTable"`,
  `uniqueName`, `queryTableFieldId`.
- `WorkbookData.referential`, `LoadedFile.referential`, `OoxmlExtras.referential`,
  `TableToApply.query`.

## 10. Effet sur le code

| Fichier | Ce qui change |
|---|---|
| `parsing/referential-shape.ts` | **déplacé** depuis `export/` — la forme est du schéma, et le lecteur en a besoin ; porte le type `ReferentialRows` |
| `parsing/referential-workbook.ts` | **nouveau** — reconnaître, lire, comparer |
| `ui/drop-zone.ts` | plusieurs fichiers par dépôt et par sélecteur |
| `ui/app.ts` | trier le dépôt, comparer, reconstruire, relire, afficher |
| `ui/state.ts` | `referentialCheck`, le verdict et les octets à rendre |
| `ui/banner.ts` | la ligne du verdict et le bouton |
| `ui/upgrade-dialog.ts` | plus de champ URL ; le référentiel se dépose à côté |
| `export/repair.ts` | prend des `ReferentialRows` plutôt qu'une URL |
| `export/schema-upgrade.ts` | aucun pas ; le commentaire dit pourquoi |
