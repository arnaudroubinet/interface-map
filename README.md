# Interface Map

Lit un classeur Excel décrivant une cartographie d'interfaces et le dessine :
schémas façon C4, matrice, rapport d'intégrité, sept exports.

Le livrable est **un seul fichier HTML autonome**. Aucun réseau à l'exécution,
aucune ressource externe : le classeur est ouvert localement et ne quitte jamais
le navigateur. C'est la contrainte qui explique la plupart des choix de ce
dépôt, à commencer par l'absence de framework.

## Démarrer

```sh
cd app
npm ci
npm test          # 628 tests
npm run typecheck
npm run build     # → app/dist/interface-map.html
```

Ouvrez le fichier produit dans un navigateur, puis déposez-y un classeur. Sans
classeur sous la main, le bouton « Open a sample workbook » en fabrique un,
rempli et sans anomalie.

Le fichier est aussi construit par GitHub à chaque release publiée, et attaché
au tag : voir `.github/workflows/release.yml`.

## Les deux lectures

Le même classeur se lit de deux façons, et ne se saisit qu'une fois.

**Architecture** répond à « par quoi ça passe » : tous les sauts sont dessinés,
bus et passerelles compris.

**Métier** répond à « qui alimente qui » : les acteurs techniques disparaissent
et les flux qui les traversent sont raboutés bout à bout.

Deux colonnes portent la distinction. `Nature`, sur l'onglet `ActorTypes`, dit
quels types sont techniques. `Republished as`, sur les onglets `FX_`, dit sous
laquelle de ses propres interfaces un acteur technique republie une entrée.
La dérivation vit dans `src/aggregation/fonctionnel.ts`, et `lecture(model,
rang, mode)` en est le point de passage unique : flux **et** acteurs résolus
au même palier, au même mode.

## Le sens des flèches

Deux informations, deux supports, et c'est volontaire. **Le trait suit la
donnée** : toujours du fournisseur vers le consommateur. **La pointe dit qui
prend l'initiative** : à l'arrivée quand le fournisseur pousse (Kafka, JMS,
dépôt de fichier), au départ quand le consommateur appelle (HTTP, SQL, LDAP).

Une pointe au bout inattendu n'est donc pas un défaut.

## Le schéma du classeur

Il n'est écrit qu'à un endroit : `src/parsing/build-model.ts`, en tête de
fichier. Les constantes `COLONNES_*` définissent chaque onglet, `VERSION_MODELE`
porte le numéro de schéma courant.

Un classeur déclare sa version dans un onglet masqué. À l'ouverture, s'il ne
correspond pas, l'outil bloque et propose une mise à niveau — dans les deux
sens : un classeur plus ancien est reconstruit, un classeur plus récent est
refusé plutôt que rétrogradé en silence.

Faire évoluer le schéma se fait en trois gestes, et le troisième est le seul
qu'on oublie :

1. la colonne dans `COLONNES_*` et le champ dans `src/parsing/model.ts` ;
2. `VERSION_MODELE` incrémenté ;
3. une étape dans `ETAPES_MISE_A_NIVEAU` (`src/export/migration-modele.ts`),
   qui transforme le modèle d'une version à la suivante. Même quand il n'y a
   rien à transformer, l'étape doit exister : c'est elle qui fait reconnaître
   les classeurs en circulation comme périmés.

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
`ui/banner.ts` (un `onExport…` de plus) et branchez-le dans `ui/app.ts`. Les
exports d'image et draw.io suivent le mode de lecture ; les deux DSL C4 non,
ils décrivent une architecture.

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
