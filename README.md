# Interface Map

Lit un classeur Excel décrivant une cartographie d'interfaces et le dessine :
schémas façon C4, matrice, rapport d'intégrité, neuf exports.

Le livrable est **un seul fichier HTML autonome**. Aucun réseau à l'exécution,
aucune ressource externe : le classeur est ouvert localement et ne quitte jamais
le navigateur. C'est la contrainte qui explique la plupart des choix de ce
dépôt, à commencer par l'absence de framework.

## Démarrer

```sh
cd app
npm ci
npm test          # 1139 tests
npm run typecheck
npm run build     # → app/dist/interface-map.html
npm run e2e       # quatre tests dans un vrai Chromium, sur le fichier construit
```

Les tests `e2e` (Playwright, `app/test/e2e/`) couvrent ce que jsdom ne sait
pas faire : un dépôt de deux fichiers à la fois, le sélecteur multi-fichiers,
un téléchargement qui ne part qu'au clic. Sans navigateur téléchargé par
Playwright, `CHROMIUM_PATH=/chemin/vers/chrome npm run e2e` utilise celui de la
machine.

Ouvrez le fichier produit dans un navigateur, puis déposez-y un classeur. Sans
classeur sous la main, le bouton « Open a sample workbook » en fabrique un,
rempli et sans anomalie.

Le fichier est aussi construit par GitHub à chaque release publiée, et attaché
au tag : voir `.github/workflows/release.yml`.

## Les deux lectures

Le même classeur se lit de deux façons, et ne se saisit qu'une fois.

**Architecture** répond à « par quoi ça passe » : tous les sauts sont dessinés,
bus et passerelles compris.

**Métier** répond à « qui alimente qui » : les middlewares disparaissent et les
flux qui les traversent sont raboutés bout à bout.

Deux colonnes portent la distinction. `Nature`, sur l'onglet `ActorTypes`, dit
ce qu'un type **est** — et il y a trois réponses, pas deux :

| Nature | Ce que c'est | En lecture métier | Doit republier ? |
|---|---|---|---|
| `Business` | un correspondant | affiché | non |
| `Middleware` | de la plomberie **traversée** — bus, passerelle, ESB | replié | **oui** |
| `Storage` | de la plomberie **terminale** — bucket, base, archive | affiché, comme destination | non |

Confondre les deux rôles techniques coûtait une alerte à chaque écriture dans
un S3 : « ce flux entre dans la plomberie et n'en ressort pour personne » —
alors qu'il arrivait là où il devait arriver. Un `Storage` n'est jamais replié
non plus : « Chandrila archive ses relevés » est un fait métier, pas un détail
de tuyauterie.

`Technical`, le mot d'avant, se lit toujours comme `Middleware` : le fichier
référentiel ne porte aucun numéro de version, donc rien ne pourrait dire à
celui qui circule qu'il est périmé.

`Republished as`, sur les onglets `FX_`, dit sous laquelle de ses propres
interfaces un middleware republie une entrée. La dérivation vit dans
`src/aggregation/reading.ts` ; `isRelayActor` décide de ce qui est traversé,
`isTechnicalActor` de ce qui est dessiné comme de la plomberie — les deux
questions ne sont pas la même, et les confondre était tout le défaut.

## Le sens des flèches

Deux informations, deux supports, et c'est volontaire. **Le trait suit la
donnée** : toujours du fournisseur vers le consommateur. **La pointe dit qui
prend l'initiative** : à l'arrivée quand le fournisseur pousse (Kafka, JMS,
dépôt de fichier), au départ quand le consommateur appelle (HTTP, SQL, LDAP).

Une pointe au bout inattendu n'est donc pas un défaut.

## Le schéma du classeur

Il n'est écrit qu'à un endroit : `src/parsing/build-model.ts`, en tête de
fichier. Les constantes `*_COLUMNS` définissent chaque onglet, `SCHEMA_VERSION`
porte le numéro de schéma courant.

Un classeur déclare sa version dans un onglet masqué. À l'ouverture, s'il ne
correspond pas, l'outil bloque et propose une mise à niveau — dans les deux
sens : un classeur plus ancien est reconstruit, un classeur plus récent est
refusé plutôt que rétrogradé en silence.

Faire évoluer le schéma se fait en trois gestes, et le troisième est le seul
qu'on oublie :

1. la colonne dans `*_COLUMNS` et le champ dans `src/parsing/model.ts` ;
2. `SCHEMA_VERSION` incrémenté ;
3. une étape dans `UPGRADE_STEPS` (`src/export/schema-upgrade.ts`),
   qui transforme le modèle d'une version à la suivante. Même quand il n'y a
   rien à transformer, l'étape doit exister : c'est elle qui fait reconnaître
   les classeurs en circulation comme périmés.

## Le référentiel externe

Les noms d'acteurs, de groupes, de types d'acteur et de technologies peuvent
venir d'un référentiel commun plutôt que d'être redéclarés dans chaque
classeur. **Un seul fichier, déposé à côté de la cartographie** : un classeur
portant quatre onglets — `Actors`, `Groups`, `ActorTypes`, `FlowTypes`.

**C'est l'outil qui produit ce fichier**, vierge ou rempli d'un exemple
(écran `Repair or upgrade a workbook`). Sa forme n'est donc pas à deviner :
`src/parsing/referential-shape.ts` la décrit, et c'est la même table qui sert
à écrire le fichier, à le reconnaître quand il revient, et à créer les onglets
qui en reçoivent la copie. Les noms des quatre onglets et de leur première
colonne ne doivent pas changer — c'est la seule contrainte dure, et le fichier
le dit lui-même sur son onglet `Instructions`.

**L'outil ne va jamais sur le réseau.** Le référentiel se dépose comme la
cartographie, dans le même geste : la zone de dépôt accepte plusieurs
fichiers, et c'est l'outil qui dit lequel est quoi, à sa forme, jamais à son
nom ni à l'ordre du dépôt (`src/parsing/referential-workbook.ts`). Un
référentiel et une cartographie partagent trois noms d'onglets ; ce qui les
distingue est dit une fois : le référentiel nomme ses groupes sous `Name` là
où la cartographie dit `Group`, et il n'a pas de catalogue d'interfaces.

La cartographie porte **une copie** du référentiel, dans quatre onglets
masqués `RefActors`, `RefGroups`, `RefActorTypes` et `RefTechnologies`. C'est
cette copie que lisent les listes déroulantes et les colonnes calculées, et
c'est elle que le rapport d'intégrité confronte aux noms déclarés. Elle est
écrite par l'outil, et par lui seul ; le classeur reste donc autonome, sans
requête ni connexion.

Quand le référentiel est déposé — avec la cartographie, ou après elle,
celle-ci étant à l'écran — l'outil compare la copie à ce que le référentiel
publie, cellule à cellule et dans l'ordre. À jour, la bannière le dit et rien
ne bouge. Dérivée, la cartographie est **reconstruite** avec les lignes du
référentiel, par le même chemin qu'une mise à niveau — un classeur en retard
d'un schéma en sort donc au schéma courant —, relue comme n'importe quel
fichier déposé, et affichée ; la bannière offre alors de **télécharger le
classeur mis à jour**, sous son nom d'origine. Rien n'est téléchargé sans
qu'on le demande : un téléchargement qui part seul surprend, et le navigateur
peut l'avaler. La reconstruction a le coût d'une mise à niveau : colonnes
ajoutées à la main, mises en forme et onglets personnels ne suivent pas.

Un référentiel déposé seul, sans cartographie à l'écran, est refusé et nommé
pour ce qu'il est. Deux cartographies, ou deux référentiels, dans un même
dépôt sont refusés aussi : l'outil dessine un classeur, et deux référentiels
seraient deux vérités. Un refus arrête tout le dépôt plutôt que d'en lire la
moitié.

L'écran `Repair or upgrade a workbook` prend le référentiel de la même façon,
à côté du classeur à réparer : le classeur réparé emporte ses lignes. Sans
référentiel dans le dépôt, la copie est conservée telle que le classeur la
portait — réparer ne vide pas les listes.

Un nom se **déclare** une fois, sur l'onglet qui le possède, et c'est là qu'il
se choisit dans le référentiel : `Actors`, `Groups`, `ActorTypes` et
`FlowTypes` piochent chacun dans sa liste `L_Ref…`. Toutes les autres colonnes
qui citent un acteur, un groupe ou un type **renvoient** à cette déclaration
locale et tirent donc des listes locales — les faire pointer vers le
référentiel laisserait une ligne nommer ce que cette cartographie n'a jamais
déclaré, c'est-à-dire exactement ce que le rapport marque en rouge.

Ces listes **suggèrent sans refuser** — Excel n'oppose pas un refus sec — mais
ce qu'elles ne portent pas est une **anomalie** du rapport d'intégrité, dans la
famille des références : un nom absent de la liste cachée n'a pas pu être
choisi, il a été tapé ou vient d'un classeur rempli avant que le référentiel ne
le porte, et ce que le référentiel dit de lui — une icône, un sens — ne résout
rien. Une orthographe proche est proposée quand il y en a une.

Un vocabulaire pour lequel le référentiel ne publie **rien** ne dit rien : ce
n'est pas que tous les noms sont inconnus, c'est que personne n'a été
interrogé.

**On choisit un nom, on ne recopie pas ce qui va avec.** Ce que le référentiel
dit d'un nom est lu, jamais saisi : l'icône et la nature d'un type, le sens,
la description et la couleur d'une technologie sont des **colonnes calculées**
qui vont chercher l'onglet caché. Excel les remplit sur chaque ligne ajoutée et
rétablit la formule si on tape par-dessus. Deux vérités pour la même chose,
sans rien pour dire laquelle gagne, c'est précisément ce que ça supprime.

Deux règles s'appliquent à ces formules, chacune payée une fois :

- **jamais de référence structurée vers une autre table** dans une colonne
  calculée — Excel charge les tables dans l'ordre, une formule nommant une
  table définie plus loin est invalide à la lecture, et Excel **supprime** la
  table fautive en proposant de réparer. Les recherches passent donc par des
  références A1 vers l'onglet caché ;
- **jamais de référence structurée dans une validation** — Excel refuse la
  liste tout court. Chaque liste passe par un nom défini.

Le classeur vierge ne déclare donc plus ni type d'acteur ni technologie : c'est
le **référentiel vierge** qui porte ces deux vocabulaires, et la cartographie y
prend ce qu'elle utilise. Sans liste, il n'y a rien à saisir — le fichier ne
fait que synchroniser, ce sont les onglets cachés qui portent la donnée. C'est
pourquoi toute réécriture les emporte avec elle, et pourquoi une valeur locale
vide est reprise de la liste cachée à la lecture : une formule écrite par
l'outil n'a pas encore de valeur calculée tant qu'Excel ne l'a pas ouverte.

La copie était d'abord rafraîchie par une requête Power Query écrite dans le
classeur, vers une URL SharePoint. Le mécanisme est parti : l'URL exigeait une
adresse nettoyée à la main, un compte au premier rafraîchissement, et une
actualisation que personne ne faisait — la copie dérivait sans que l'outil le
voie. La spec du 22 août 2026 en garde la trace, et le format MS-QDEFF n'est
plus écrit nulle part ici. Le schéma reste en v9 : aucun onglet n'a bougé, un
classeur qui porte encore sa requête se lit exactement comme avant, et la
requête part à la première réécriture par l'outil.

## Où se trouve quoi

| dossier | responsabilité |
|---|---|
| `parsing/` | du fichier au modèle. Le schéma vit ici. |
| `aggregation/` | du modèle aux vues : flux, paliers, lecture métier, matrice. |
| `integrity/` | ce que le classeur dit de faux ou tait. |
| `layout/` | placement des boîtes et des traits (elkjs, dans un worker). |
| `render/` | du placement au SVG, aux tableaux, aux couleurs. |
| `export/` | tout ce qui sort : classeur, images, DSL, Markdown. |
| `ui/` | état de l'application, rail, bandeau, écrans. |
| `shared/` | le peu qui est vraiment transverse. |

## Ajouter quelque chose

**Un export.** Écrivez le générateur dans `export/`, exposez-le dans
`ui/banner.ts` (un `onExport…` de plus, et sa ligne dans `EXPORTS` : bouton
ou menu « Export ») et branchez-le dans `ui/app.ts`. Les exports d'image,
draw.io et FossFLOW suivent le mode de lecture ; les deux DSL C4 non, ils
décrivent une architecture.

**Un contrôle d'intégrité.** Ajoutez-le à l'une des cinq familles de
`integrity/checks.ts` (`checkStructure`, `checkReferences`, `checkVocabulaires`,
`checkCoherence`, `checkCompletude`). La portée n'est pas la même pour toutes :
les quatre premières jugent le classeur **entier**, la complétude et les blocs
informatifs se lisent **au palier affiché**. Un contrôle placé dans la mauvaise
famille dira des choses fausses dès la première ligne retirée.

**Une technologie.** Elle doit être déclarée dans l'onglet `FlowTypes` : une
technologie employée sans y figurer n'est pas dessinée, et le rapport le dit.
Sa couleur peut être fixée par une colonne `Colour` optionnelle, en
hexadécimal ; sinon la palette en attribue une.

## Conventions

- **Les fabriques de tests vivent dans `src/testing/fixtures.ts`**, et nulle
  part ailleurs. Ce sont les seuls littéraux exhaustifs des types du modèle :
  ajouter un champ y coûte une ligne, contre quarante-cinq erreurs de
  compilation quand chaque fichier portait sa copie. Un fichier qui a besoin
  d'autres défauts enveloppe la fabrique, il ne la modifie pas — la modifier
  changerait le sens de tests écrits ailleurs.
- **TDD.** Un test qui échoue d'abord, pour la raison qu'on annonce. Un test
  qui passe encore après qu'on a retiré le comportement qu'il prétend couvrir
  ne vaut rien : la vérification par mutation est le seul juge.
- **Les commentaires expliquent le pourquoi**, pas le quoi. Beaucoup de ceux
  d'ici racontent un défaut déjà payé ; les effacer, c'est le rouvrir.
- **Langues.** Commentaires et noms de tests en français, textes d'interface,
  identifiants et messages de commit en anglais. Le mélange est délibéré.
- **Noms.** Les acteurs des tests et de l'exemple portent des noms de planètes
  de Star Wars. Aucun nom de système réel ne doit entrer dans ce dépôt.

## Documents de conception

`docs/superpowers/` conserve les specs et les plans écrits pendant le
développement. Ils expliquent des décisions, ils ne décrivent pas l'état
courant : plusieurs annoncent un numéro de schéma dépassé. **Le code fait
foi.**
