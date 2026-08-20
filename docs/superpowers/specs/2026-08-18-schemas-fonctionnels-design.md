# Schémas fonctionnels : lire le parc sans la plomberie

Spécification · 18 août 2026

Fait passer le modèle en **schéma v3**.

---

## 1. Objet

Un même parc se lit de deux façons, et l'outil n'en connaît qu'une.

**L'architecture** répond à « par quoi ça passe » : Kafka, l'ESB, le fichier déposé la nuit, l'appel HTTP. C'est ce que l'outil dessine aujourd'hui, et ça reste indispensable pour arbitrer une technologie ou mesurer ce que coûte l'arrêt d'un bus.

**Le fonctionnel** répond à « qui alimente qui » : quelles applications métier s'échangent quoi. Le medium n'y a pas sa place, ni les composants qui n'existent que pour le transporter. Un directeur métier, un architecte fonctionnel et un chef de projet lisent cette carte-là ; la première les noie.

Ces deux lectures portent sur **les mêmes données**. Rien n'est saisi deux fois : le fonctionnel se **dérive** de l'architecture, et c'est ce qui garantit qu'ils ne divergeront pas.

## 2. Vocabulaire

| Terme | Sens dans ce document |
|---|---|
| **Mode** | La lecture choisie : `Architecture` ou `Fonctionnel` |
| **Acteur technique** | Un acteur dont le type porte la nature `Technical` — bus, ETL, annuaire, horloge |
| **Acteur métier** | Tout le reste, nature `Business` comprise ou non renseignée |
| **Segment** | Une interface prise isolément, entre deux acteurs voisins |
| **Relais** | Une interface exposée par un acteur technique, qui en prolonge une autre |
| **Chaîne** | La suite de segments qu'un échange traverse, de sa source métier à son consommateur métier |
| **Lien fonctionnel** | Ce qu'une chaîne produit une fois la plomberie retirée : métier → métier |

Le mot « technique » ne qualifie jamais une technologie, toujours un acteur.

## 3. Ce que le classeur gagne

### 3.1 `Nature`, sur l'onglet `ActorTypes`

| Colonne | Rôle |
|---|---|
| `Actor type` | clé, existante |
| `Icon` | existante |
| **`Nature`** | **`Business` · `Technical`**, vocabulaire fermé, liste déroulante |

**C'est le type qui tranche, pas l'acteur.** Même principe que le périmètre, déclaré sur le groupe et non sur ses membres : « un groupe est dedans ou dehors, et ses membres avec lui ». Six lignes à remplir sur un classeur réel, contre cinquante si la colonne vivait sur `Actors` — et six occasions de se contredire au lieu de cinquante.

Une équipe qui aurait besoin de distinguer deux acteurs du même type — un `Service` d'authentification purement technique et un `Service` d'adaptation métier — leur donne deux types. L'onglet `ActorTypes` sert précisément à énumérer les types qui existent ; l'y forcer vaut mieux qu'une surcharge par acteur, qui laisserait deux endroits où chercher la vérité.

**Une nature vide vaut `Business`.** Un classeur qui n'a pas rempli la colonne montre tout. Masquer des acteurs en silence serait pire que de charger le schéma : on ne cache pas de la donnée sans le dire.

### 3.2 `Relays`, sur l'onglet `Interfaces`

| Colonne | Rôle |
|---|---|
| **`Relays`** | Le **nom du flux** de l'interface que celle-ci prolonge |

Remplie uniquement sur les interfaces exposées par un acteur technique. Vide partout ailleurs.

**Pourquoi une colonne plutôt qu'une convention de nommage.** L'autre solution envisagée consistait à corréler les segments par leur nom de flux : un échange relayé garderait le même nom d'un bout à l'autre. Elle a été écartée parce qu'elle ment sur le terrain — un topic Kafka `trx.raw`, un fichier `TRX_D.csv` et une table de staging portent des noms différents, et c'est légitime. Ce classeur existe pour enregistrer la réalité technique fidèlement ; c'est la lecture fonctionnelle qui doit s'y adapter, pas l'inverse. Elle imposait de surcroît une campagne de renommage sur les 162 interfaces des classeurs existants, dont aucune ne partage aujourd'hui son nom.

**Pourquoi pas un onglet de liens métier saisis à la main.** Ce serait une seconde cartographie, que rien ne confronte à la première : le jour où la chaîne technique change, le lien métier resterait juste en apparence. La spec des paliers pose la règle inverse à propos des groupes — « dérivé plutôt que saisi : une saisie de plus serait une occasion de plus de se contredire ».

### 3.3 La granularité du relais

**Un acteur technique expose une interface par flux relayé**, jamais une interface unique pour tout le bus. C'est cette granularité qui empêche de relier tout ce qui entre à tout ce qui sort.

Une équipe ayant modélisé « l'ESB » en un point unique devra le découper. C'est un coût réel, et c'est le prix à payer : sans lui, un bus portant 200 flux produirait 200 × 200 liens fonctionnels, tous faux.

Ce découpage ne crée pas de travail supplémentaire, il le répartit autrement : décrire un bus portant quinze flux demande quinze lignes quelle que soit la méthode — quinze interfaces exposées par le bus, ou quinze consommations sur une interface fourre-tout. La contrainte exige seulement la première forme, seule capable de dire quoi prolonge quoi. Elle a un bénéfice au passage : le nom du segment devient parlant. « trx.norm » dit ce qui transite ; « Bus ESB » consommée par vingt applications ne dit rien.

**Le modèle raccourci se signale.** Une interface fourre-tout ne peut porter qu'un `Relays` ; tous les autres flux entrant dans le bus n'en ressortent alors pour personne, et leur lien fonctionnel manquerait **en silence** — le pire des cas. Un contrôle de cohérence (§6) rattrape exactement cette situation.

### 3.4 Conséquence sur les types de flux composites

Modéliser un intermédiaire comme un acteur dissout les types de flux qui le portaient implicitement. `REST + ESB` et `Fichier + ETL (dépôt)` décrivent deux liens en un seul : le référentiel embarqué dans l'outil les avait déjà écartés pour cette raison. Ils deviennent deux segments — `Tatooine --REST--> ESB --REST--> Hoth` — et c'est ce découpage qui rend la dérivation fonctionnelle possible.

C'est une reprise de données sur les classeurs existants, à mener par l'équipe et à son rythme : rien ne l'exige tant que l'intermédiaire n'est pas déclaré comme acteur.

## 4. La dérivation du lien fonctionnel

### 4.1 Le parcours

Pour chaque consommation par un acteur **métier**, de l'interface `I` :

1. Tant que l'exposant de `I` est technique : `I` devient l'interface dont le nom de flux est celui que `Relays` désigne.
2. Si on atteint une interface exposée par un acteur métier, c'est la source. On produit le lien **source → consommateur**.
3. Si la chaîne se coupe — `Relays` vide, ou désignant un nom absent du catalogue — **aucun lien n'est produit**, et le rapport dit où elle s'arrête.

Une consommation **par** un acteur technique ne produit rien par elle-même : c'est un segment, pas une extrémité. Il sera traversé depuis l'aval.

### 4.2 Le libellé

Le nom du flux **à la source** — « Transactions pdv », jamais `TRX_D.csv`. C'est le nom que le producteur donne à sa donnée, le seul qui ait un sens métier.

### 4.3 Les cas

**Chaîne longue.** Le parcours ne connaît pas de limite de longueur.

```
Flow name       Provider   Relays
─────────────────────────────────────
Commandes       Alderaan     (vide)
cmd.raw         Bus        Commandes
CMD_D.csv       ETL        cmd.raw
cmd_staging     Datalake   CMD_D.csv

ARCHITECTURE   Alderaan ─► Bus ─► ETL ─► Datalake ─► Coruscant
FONCTIONNEL    Alderaan ─────────────────────────► Coruscant
```

**Plusieurs flux dans le même bus.** Chaque segment sortant déclare celui qu'il prolonge : aucun croisement.

```
Transactions   Tatooine    (vide)         consommée par Bus
Référentiel    Alderaan   (vide)         consommée par Bus
trx.norm       Bus      Transactions   consommée par Naboo
ref.norm       Bus      Référentiel    consommée par Coruscant

FONCTIONNEL    Tatooine ──► Naboo        Alderaan ──► Coruscant
```

**Diffusion.** Un segment relayé, plusieurs consommateurs métier, autant de liens — le parcours se faisant par consommation, la diffusion tombe naturellement.

**Plusieurs échanges entre les deux mêmes applications.** Ils fusionnent sur le couple (départ, arrivée), et le compteur porte leur nombre.

### 4.4 Les gardes

- Une chaîne qui **boucle** arrête le parcours et se signale, plutôt que de tourner indéfiniment.
- Un lien dont la source est le consommateur lui-même n'est pas tracé : c'est la règle des boucles internes des vues agrégées (§4.3 de la spec de référence).
- Le **palier s'applique d'abord** : la dérivation travaille sur le modèle déjà réduit au palier affiché. Une chaîne dont un segment est retiré ne produit plus de lien à ce palier — ce qui est exactement l'information voulue.

### 4.5 Le sens de la flèche

En architecture, le sens est une **convention de représentation attachée à la technologie** : l'appelant pointe vers l'exposant en HTTP, le producteur vers le consommateur en Kafka.

Une chaîne traverse plusieurs technologies, parfois de sens opposés. Cette convention n'a donc plus de support. La règle du mode fonctionnel est unique et vaut pour toute la chaîne : **la flèche va du fournisseur au consommateur**, et se lit « transmet à ».

Conséquence assumée : un échange HTTP sans relais change de sens entre les deux modes.

```
ARCHITECTURE                  FONCTIONNEL
 Mygeeto ──HTTP──► Tatooine      Tatooine ──────► Mygeeto
 « interroge »                 « fournit à »
```

Ce ne sont pas deux réponses contradictoires, ce sont deux questions différentes — « qui appelle qui » contre « qui alimente qui ».

## 5. Le mode dans l'outil

### 5.1 Le sélecteur

En tête du rail, au-dessus des vues, comme celui des paliers. Deux positions, `Architecture` par défaut. Non mémorisé entre deux ouvertures (§2.5 de la spec de référence).

**Toujours offert**, même sur un classeur sans aucune `Nature` renseignée : le mode fonctionnel y garde son sens — il fusionne les médias — sans encore masquer personne. C'est aussi ce qui le rend découvrable ; caché jusqu'à ce que la colonne soit remplie, personne ne saurait qu'il faut la remplir.

### 5.2 Les vues

| Vue | En mode fonctionnel |
|---|---|
| Groupe à groupe | Un groupe vidé de ses acteurs métier disparaît |
| Plateforme détaillée · Plateforme seule | Acteurs métier uniquement |
| Par acteur | Le sélecteur ne liste que les acteurs métier ; les traits portent les noms d'échange |
| **Par technologie** | **Retirée** — elle n'a plus d'objet |
| Matrice | Les cellules portent un compteur, non la liste des technologies |
| Écarts | Disponible : un lien métier qui apparaît entre deux paliers est une information de premier ordre |
| Contrôles d'intégrité | Inchangés — ils jugent le classeur, pas une lecture du classeur |

La légende des technologies disparaît avec elles ; le trait devient neutre.

Un acteur métier devenu **isolé** — dont les échanges passaient tous par des chaînes coupées — reste affiché, seul. Le faire disparaître retirerait de l'information sans le dire.

### 5.3 Les exports

| Export | Rapport au mode |
|---|---|
| SVG · PNG | Suivent le mode : ils sérialisent ce qui est à l'écran |
| draw.io | Suit le mode — c'est un dessin, pas un modèle |
| Excel | Suit le mode, avec la matrice |
| **Structurizr · LikeC4** | **Architecture seulement** : inertes en mode fonctionnel |
| Markdown | Indifférent — c'est le rapport d'intégrité |

Les deux DSL décrivent un modèle **C4**, c'est-à-dire une architecture. Un schéma fonctionnel n'en est pas un, et livrer un fichier qui raconte autre chose que l'écran est précisément ce que l'outil s'interdit. Leurs boutons s'éteignent donc en fonctionnel, comme Excel s'éteint hors de la matrice.

Un fichier draw.io ne porte qu'un mode : mêler les deux familles donnerait cent vingt onglets dont personne ne saurait lesquels lire.

**Nom de fichier.** Le mode s'y inscrit en fonctionnel seulement — `carto-functional-group-to-group-v2.drawio`. Les noms actuels ne bougent pas, et deux exports du même schéma ne peuvent plus se recouvrir.

## 6. Contrôles d'intégrité

Répartis dans les familles existantes ; aucune famille nouvelle.

| Famille | Anomalie |
|---|---|
| Références | `Relays` désigne un nom de flux absent du catalogue |
| Références | `Relays` désigne un nom porté par plusieurs interfaces — l'outil ne choisit pas au hasard |
| Cohérence | Interface exposée par un acteur **métier** portant un `Relays` : on ne relaie que si on est un relais |
| Cohérence | Chaîne de relais qui boucle |
| Cohérence | Interface consommée uniquement par des acteurs techniques, dont aucune chaîne n'atteint un consommateur métier — elle entre dans la plomberie et n'en ressort pour personne |
| Vocabulaires | `Nature` hors de `Business` · `Technical` |
| Complétude | Type d'acteur sans `Nature` |
| Complétude | Interface exposée par un acteur **technique** sans `Relays` : la chaîne est coupée là |

Les deux contrôles de complétude ne se déclenchent **que si au moins un type déclare une nature**. Tant que l'équipe n'a pas adopté la distinction, l'outil n'en parle pas — règle posée par les paliers et reprise ici.

## 7. Migration

**Schéma v2 → v3.** Les deux colonnes changent la forme du classeur, la version monte donc.

L'étape `2 → 3` ne transforme **rien** dans le modèle : les colonnes arrivent vides, et la reconstruction les produit ainsi. Elle existe pour que les classeurs en circulation soient reconnus comme périmés et repassent par l'écriture — même mécanique que l'étape `1 → 2`.

Aucune nature n'est devinée. Déduire que `Infrastructure` est technique reviendrait à écrire dans le code une règle sur des types que l'équipe déclare librement, et à masquer des acteurs sans que personne l'ait demandé.

## 8. Limites connues

**La fusion.** Un bus qui agrège deux flux entrants en un seul sortant ne peut pas le dire : `Relays` ne porte qu'un nom. Une liste serait possible ; elle attendra qu'un classeur en ait besoin.

**La version.** `Relays` désigne une interface par son nom de flux, sans sa version. Un relais portant spécifiquement la `1.0` d'un contrat ne peut pas le préciser. Le contrôle signale l'ambiguïté plutôt que de choisir.

**Le découpage du bus.** Voir §3.3 : la granularité exigée peut forcer un remodelage.

## 9. Découpage technique

- **`aggregation/fonctionnel.ts`** — la dérivation. Rend des flux de même forme que les flux techniques, la technologie en moins, de sorte que les vues existantes tournent dessus sans savoir qu'elles ont changé de mode. C'est le patron des paliers, dont le filtrage se fait aussi en amont des vues.
- **`aggregation/core.ts`** — la clé de fusion des traits ignore la technologie en mode fonctionnel.
- **`parsing/`** — les deux colonnes, et la nature portée jusqu'au modèle.
- **`export/template-export.ts`** — les deux colonnes à l'écriture, le vocabulaire fermé, la validation.
- **`export/migration-modele.ts`** — l'étape `2 → 3`.
- **`integrity/checks.ts`** — les huit contrôles.
- **`ui/`** — le mode dans l'état, le sélecteur en tête de rail, les boutons d'export qui s'éteignent.
- **`aggregation/planches.ts`** — la liste des planches suit le mode.

## 10. Tests

- **Dérivation** : chaîne à un relais, chaîne longue, deux flux dans un même bus sans croisement, diffusion, chaîne coupée, chaîne bouclée, source égale au consommateur.
- **Nature** : type technique masqué, nature vide traitée comme métier, groupe vidé disparaissant.
- **Sens** : la flèche fonctionnelle part du fournisseur, y compris quand l'architecture la dessine dans l'autre sens.
- **Palier** : une chaîne coupée par un retrait ne produit plus de lien au palier suivant.
- **Contrôles** : un cas positif et un cas muet par règle, dont le bus fourre-tout qui avale un flux sans le rendre.
- **Migration** : un classeur v2 ressort en v3, son contenu intact, l'étape n'ayant rien transformé.
- **Exports** : les deux DSL inertes en fonctionnel, le nom de fichier portant le mode, la liste des planches amputée des vues par technologie.
