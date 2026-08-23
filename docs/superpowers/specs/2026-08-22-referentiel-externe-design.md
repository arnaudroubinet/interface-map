# Référentiel externe chargé par Power Query

Spécification · 22 août 2026

Exécute la décision du 18 août 2026 restée sans spec, consignée dans
`docs/BACKLOG.md`. Périmètre arrêté par l'utilisateur le 22 août 2026 :
**acteurs et technologies, chacun son onglet.**

---

## 1. Objet

Une cartographie nomme des acteurs et des technologies. Aujourd'hui chaque
classeur les redéclare à la main, et deux cartographies du même système
d'information divergent sans que rien ne le signale : « Tatooine » ici,
« TATOOINE » là, et la vue par acteur en compte deux.

Le classeur va donc chercher ces deux listes dans un référentiel publié à une
URL, par une requête Power Query. Excel fait le chargement ; l'application
n'écrit que la définition de la requête.

## 2. Ce que le référentiel apporte — et ce qu'il ne remplace pas

**Il alimente, il ne se substitue pas.** Deux onglets masqués s'ajoutent,
`RefActors` et `RefTechnologies`, chacun portant un tableau rempli par sa
requête. Les onglets `Actors` et `FlowTypes` gardent leur structure et leur
rôle : c'est là qu'on déclare ce que cette cartographie-ci utilise.

Le partage est dicté par ce qu'un référentiel central peut savoir. Il connaît
le nom d'un acteur, son groupe, son type, son propriétaire. Il ne connaît pas
`Introduced at` / `Retired at` : ces colonnes citent un jalon de l'onglet
`Milestones`, qui est propre à cette cartographie. Une requête qui posséderait
l'onglet `Actors` écraserait ces colonnes à chaque actualisation.

L'alternative — le référentiel possède les lignes, les colonnes locales
déménagent ailleurs — a été écartée pour ce premier jet : elle impose un
schéma v5 et une migration des classeurs déjà distribués, pour un gain qui
n'apparaît qu'une fois le mécanisme éprouvé. Elle reste la suite naturelle.

Conséquence tenue pour acquise : **un classeur sans référentiel fonctionne
exactement comme aujourd'hui.** Les onglets `Ref*` sont vides, les listes
déroulantes sont vides, la saisie reste libre, les couleurs retombent sur la
palette. Le référentiel est un confort et un garde-fou, jamais un prérequis.

## 3. Les deux tableaux du référentiel

`RefActors` — tableau `TblRefActors` :

| Name | Group | Actor type | Owner | Description |
|---|---|---|---|---|

`RefTechnologies` — tableau `TblRefTechnologies` :

| Flow type | Direction | Description | Colour |
|---|---|---|---|

`Colour` est en hexadécimal (`#1f5fae`). C'est la colonne que le parseur lit
déjà à titre facultatif sur `FlowTypes` : la même valeur, à la même forme,
change simplement de source.

## 4. Ce que ces tableaux alimentent

- **Une liste déroulante sur `Actors`** : `Name` sur `TblRefActors[Name]`.
  `Group` et `Actor type` restent sur les onglets locaux (`L_Groupe`,
  `L_TypeActeur`) alors même que le référentiel porte ces deux colonnes. La
  raison est que la cartographie en est encore propriétaire : le contrôle
  d'intégrité tient `Groups` pour la référence et compte une anomalie pour tout
  groupe qui n'y figure pas, et `ActorTypes` porte l'icône du type, que le
  référentiel ne transporte pas. Une liste alimentée par le référentiel
  proposerait donc exactement ce que le rapport signale en rouge, et dessinerait
  un composant sans icône. Le jour où le référentiel possédera les lignes —
  la suite naturelle décrite au §2 — ces deux colonnes le suivront.
- **Une liste déroulante sur `FlowTypes`** : `Flow type` sur
  `TblRefTechnologies[Flow type]`.
- **Les couleurs des technologies.** Le parseur lit `RefTechnologies` en plus
  de la colonne `Colour` de `FlowTypes`. Ordre de priorité : la valeur saisie
  sur `FlowTypes` l'emporte — on ne retire pas à quelqu'un la possibilité de
  forcer une couleur —, à défaut celle du référentiel, à défaut la palette.
- **Deux contrôles d'intégrité**, de gravité « signalement » et non « erreur » :
  un acteur ou une technologie déclaré localement mais absent du référentiel.
  Le cas est légitime — on cartographie souvent avant que le référentiel ne
  soit à jour — mais il mérite d'être vu.

Ces listes aident la frappe, elles ne valident rien. Les listes alimentées par
le référentiel sont donc écrites **sans alerte de refus** : une liste qui refuse
serait bloquante là où le référentiel est en retard sur la cartographie, et sur
un classeur sans référentiel elle se réduit à une cellule vide — `Name` et
`Flow type`, les deux clés du classeur, deviendraient impossibles à saisir. Les
listes dont le classeur possède lui-même le vocabulaire gardent leur refus.

## 5. L'URL est une propriété du classeur

Elle vit dans la définition de la requête, à l'intérieur du fichier. Elle
voyage avec lui. Deux cartographies peuvent donc viser deux référentiels
différents — c'est précisément la fonctionnalité demandée, et la raison pour
laquelle un fichier pivot centralisateur a été écarté le 18 août.

Il y a **deux URL**, une par référentiel. Les acteurs et les technologies
n'ont pas les mêmes propriétaires ni le même rythme de publication ; les
forcer dans un seul fichier les enchaînerait.

Format attendu : **CSV, UTF-8, première ligne d'en-têtes**. Retenu contre le
classeur Excel parce qu'il n'impose aucune convention de nommage d'onglet ou
de tableau du côté du référentiel, et parce que n'importe quel outil sait en
produire. Le M correspondant tient en trois lignes.

Le geste dans l'application : on dépose le classeur, la page affiche les deux
URL qu'il porte déjà, on les garde ou on les remplace, on retélécharge.
**L'application ne va rien chercher sur le réseau** — elle ne sait pas si
l'URL répond, et ne le prétend pas.

## 6. Le flux DataMashup

C'est la partie coûteuse, et elle est désormais tranchée : **on écrit le flux
nous-mêmes.** Aucune dépendance n'est ajoutée. Le format est spécifié par
Microsoft sous MS-QDEFF ; les conventions ci-dessous ont été retrouvées le
22 août 2026 en comparant nos essais à un fichier produit par le vrai Excel.

Le flux est encodé en base64 dans `customXml/item1.xml`. Structure du flux
racine, entiers 32 bits **petit-boutiens** :

```
uint32  version = 0
uint32  longueur + Package Parts   (un zip OPC)
uint32  longueur + Permissions     (XML)
uint32  longueur + Metadata
uint32  0                          (Permission Bindings, vide)
```

`Metadata` a la même forme imbriquée :

```
uint32  version = 0
uint32  longueur + XML des métadonnées
uint32  longueur + contenu         (un zip VIDE, 22 octets)
```

Le zip `Package Parts` contient trois entrées : `Config/Package.xml`,
`Formulas/Section1.m`, `[Content_Types].xml`.

**Les quatre conventions qu'Excel exige**, chacune ayant coûté un essai rejeté :

| | Ce qu'Excel écrit | Ce qui échoue |
|---|---|---|
| `customXml/item1.xml` | UTF-16 avec BOM | UTF-8 → requêtes vides |
| XML internes | `xsi` + `xsd`, **pas** d'espace de noms `DataMashup` par défaut ; chacun préfixé d'un BOM UTF-8 | l'espace de noms par défaut → « fichier endommagé » |
| Contenu des métadonnées | un zip vide de 22 octets | une absence → « fichier endommagé » |
| Permission Bindings | vide (`uint32 0`) | — rien n'exige de les remplir |

Ce dernier point a été vérifié par une expérience dédiée : reprendre un
fichier réel, n'y remplacer que le M, une fois bindings conservés et une fois
bindings vidés. Les deux s'ouvrent et évaluent. Une conclusion inverse avait
été annoncée puis retirée.

Reste une question ouverte, tranchée par un essai remis à l'utilisateur le
22 août : le zip interne peut-il être **stocké** plutôt que compressé ? Si
oui, aucun déflateur n'est nécessaire. Sinon, `CompressionStream("deflate-raw")`
est disponible nativement dans le navigateur, sans dépendance non plus.

## 7. Les parties OOXML côté classeur

Notre couche `xlsx-tables.ts` sait déjà poser des tableaux structurés, des
plages nommées, des relations de feuille et des entrées dans
`[Content_Types].xml`. Ce qu'il faut y ajouter :

- `customXml/item1.xml`, `customXml/itemProps1.xml`,
  `customXml/_rels/item1.xml.rels`, plus la relation depuis
  `xl/_rels/workbook.xml.rels` et les deux `Override` de contenu.
- `xl/connections.xml` : une `<connection type="5">` par requête, dont le
  `dbPr` porte `Provider=Microsoft.Mashup.OleDb.1;Data Source=$Workbook$;
  Location=<nom de la requête>` et `command="SELECT * FROM [<nom>]"`.
- `xl/queryTables/queryTableN.xml` : un par requête, reliant chaque colonne du
  tableau à un champ par `queryTableFieldId`.
- Le tableau de destination porte `tableType="queryTable"` et une relation
  vers son `queryTable`.
- Côté métadonnées du flux, une requête chargée sur un onglet se distingue
  d'une requête « connexion seule » par `FillEnabled=l1`,
  `FillObjectType=sTable`, `FillTarget=sTable` et `FillColumnNames`.

**La cinquième convention, et elle a coûté un aller-retour dans le vrai Excel.**
Un tableau marqué `tableType="queryTable"` ne suffit pas. Le classeur doit aussi
porter, dans `xl/workbook.xml`, un **nom défini caché** par requête :

```xml
<definedName name="ExternalData_1" localSheetId="22" hidden="1">RefActors!$A$1:$E$2</definedName>
```

C'est *la plage de données externes* — l'objet qui relie la requête à sa
destination. `localSheetId` est l'indice de l'onglet dans l'ordre du classeur, et
la valeur nomme l'ONGLET, pas le tableau. Chaque colonne du tableau porte en plus
un attribut `uniqueName`.

Sans ce nom, Excel ouvre le fichier, annonce l'avoir réparé et **supprime les
tableaux du référentiel**. La démonstration a été faite dans les deux sens : notre
classeur sans le nom est réparé ; un classeur produit par Excel lui-même, privé de
cette seule ligne, est réparé de la même façon, avec le message « Partie
supprimée : /xl/queryTables/queryTable1.xml (Plage de données externes) ».

Un relecteur avait relevé cette différence et l'avait jugée bénigne au motif
qu'Excel recrée le nom à l'actualisation. C'était faux, et la leçon vaut plus que
le fait : sur ce format, **une différence inexpliquée avec un fichier produit par
Excel se traite comme un défaut** jusqu'à ce qu'une expérience dise le contraire.

Une contrainte technique : `writePart` encode en UTF-8. `customXml/item1.xml`
étant en UTF-16, il faut un `writeBinaryPart` prenant un `Uint8Array`.

Corollaire à connaître : les deux onglets `Ref*` appartiennent à leurs requêtes,
et l'outil n'en écrit que l'en-tête. **Un classeur que l'outil réécrit revient
donc avec ses onglets `Ref*` vides jusqu'à ce qu'Excel actualise** — les listes
déroulantes ne proposent rien d'ici là, ce qui est sans conséquence puisque
aucune ne refuse (§4).

`saveData="1"` sur la connexion n'est pas un détail : les dernières valeurs
chargées sont **enregistrées dans le fichier**. Un classeur ouvert sans réseau,
ou dont le référentiel a disparu, affiche ce qu'il avait à la dernière
actualisation au lieu de se vider.

## 8. La migration

La migration doit **reposer les deux requêtes quand elles sont absentes** du
fichier qu'elle convertit, faute de quoi chaque changement de schéma les
effacerait. Elle relit les URL du fichier d'entrée et les reconduit ; elle ne
les invente pas.

Point de fait : le `.xlsm` d'origine portait déjà deux requêtes, `TblActeur`
et `TblTypesActeur`. Le mécanisme avait été monté une fois, puis perdu avec le
format à macro. La migration depuis un `.xlsm` peut donc parfois retrouver une
URL ; c'est un bonus, pas une exigence.

Le schéma passe à **v5** : les deux onglets `Ref*` s'ajoutent, et un classeur
v4 doit repasser par la reconstruction pour les obtenir.

## 9. Ce que ça ne fait pas

- L'application ne contacte jamais le référentiel. Elle ne peut donc pas dire
  qu'une URL est fausse ; le symptôme sera une requête en erreur dans Excel.
- Rien n'est bloqué. Un acteur hors référentiel se saisit, se dessine et
  s'exporte ; il est seulement signalé dans le rapport d'intégrité.
- Le référentiel ne pilote pas les jalons, ni aucune donnée propre à une
  cartographie.
- Aucune écriture vers le référentiel : le flux est à sens unique.

## 10. Effet sur le code

| Fichier | Ce qui change |
|---|---|
| `export/datamashup.ts` | **nouveau** — fabrique le flux à partir de deux URL et des noms de requêtes |
| `export/xlsx-tables.ts` | `writeBinaryPart` ; pose de `customXml`, `connections`, `queryTables` ; `tableType="queryTable"` |
| `export/template-export.ts` | les deux onglets `Ref*`, masqués ; les quatre nouvelles validations |
| `parsing/build-model.ts` | lecture de `RefActors` / `RefTechnologies` ; `SCHEMA_VERSION` à 5 |
| `parsing/model.ts` | les deux listes du référentiel et les deux URL portées par le modèle |
| `export/schema-upgrade.ts` | étape 4 → 5 |
| `render/colors.ts` | l'ordre de priorité des couleurs |
| `integrity/checks.ts` | les deux signalements |
| `ui/` | l'affichage et la saisie des deux URL au dépôt du classeur |

## 11. Ce qui reste à confirmer

1. **Zip interne stocké ou compressé** — un fichier d'essai a été remis ;
   la réponse choisit entre « rien à faire » et « un appel à
   `CompressionStream` ».
2. **CSV plutôt que classeur Excel** comme format du référentiel. Retenu par
   défaut ci-dessus ; à contredire si les référentiels existants sont des
   `.xlsx`.
