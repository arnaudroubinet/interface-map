# Carte des interfaces — spécification

Version validée · 14 août 2026

---

## 1. Objet

L'outil est une page web qui lit le classeur de cartographie des interfaces et en produit des schémas d'architecture exportables, ainsi qu'un rapport de contrôle d'intégrité du classeur.

Il est **strictement en lecture**. Toute saisie et toute modification se font dans Excel, où la co-édition simultanée est assurée par M365. L'outil ne modifie jamais le classeur, ne conserve aucune donnée, et n'émet aucune requête réseau.

### Ce qui est hors périmètre

| Non couvert | Pourquoi |
|---|---|
| Écriture dans le classeur | La concurrence est déléguée à Excel ; écrire depuis le navigateur la casserait |
| Rafraîchissement automatique | Exclu par choix : on redépose le fichier |
| Habilitations propres | Héritées de SharePoint |
| Historisation, versions | Assurées par le versionnement natif du fichier |
| Multi-classeur, consolidation | Un classeur à la fois |
| Usage mobile | Poste de travail uniquement |

---

## 2. Contraintes techniques

1. **Fichier unique.** Un seul `.html`, bibliothèques comprises. Aucune ressource externe, aucun CDN, aucune police téléchargée. (Le développement peut utiliser un outillage normal — voir §10 — tant que le livrable final reste ce fichier unique.)
2. **Ouverture en local.** La page s'ouvre en `file://` par double-clic. Aucun serveur, aucune installation.
3. **Alimentation par glisser-déposer.** Le classeur est déposé n'importe où dans la fenêtre. Aucun sélecteur de fichiers, aucune boîte de dialogue système. Les extensions `.xlsx` et `.xlsm` sont acceptées toutes les deux (§12) — le contenu macro d'un `.xlsm` n'est ni lu ni exécuté par l'outil, qui reste strictement lecteur des feuilles et données.
4. **Compatibilité.** Chrome, Edge, Firefox et Safari sur poste de travail, versions courantes. Un seul chemin de code : aucune branche conditionnelle par navigateur. Le fallback PNG sur Safari (§8) est une détection de capacité au runtime (`try/catch` autour de la rasterisation canvas), pas un branchement sur l'agent utilisateur.
5. **Sans état.** Rien n'est mémorisé entre deux ouvertures : ni le fichier, ni les préférences d'affichage. Recharger la page revient à l'état initial.
6. **Confidentialité.** Le classeur ne quitte pas le poste. Aucun stockage local, aucune télémétrie.
7. **Rendu SVG natif.** Les schémas sont construits comme des éléments SVG, pas dessinés sur un canvas. Le moteur de mise en page (ELK) ne calcule que des positions. L'export SVG est alors l'objet exact affiché.

---

## 3. Données d'entrée

### 3.1 Feuilles attendues

| Feuille | Rôle |
|---|---|
| `Actors` | Référentiel des acteurs : applications, services, partenaires, humains, infrastructure |
| `FlowTypes` | Référentiel des technologies d'échange et de leur sens de représentation |
| `Interfaces` | Catalogue des interfaces exposées — une ligne par interface |
| `FX_<exposant>_<type>` | Consommations d'une famille — une ligne par consommateur |

Les feuilles `Instructions`, `Lists` et `Version` (numéro de schéma du classeur, voir la spécification du 17 août 2026) sont ignorées. `FX_Modèle`, gabarit de la macro retirée, l'est aussi pour les classeurs antérieurs qui la portent encore. Toute autre feuille dont le nom commence par `FX_` est traitée comme une feuille de consommations.

### 3.2 Colonnes

**`Actors`** — `Name` (clé) · `Group` · `Actor type` · `Owner` · `Description` · `Comments` · `Introduced at` · `Retired at`

**`Groups`** — `Group` (clé) · `Perimeter` (Platform / External). Le périmètre est une propriété du groupe, pas de l'acteur : un groupe est dedans ou dehors, et ses membres avec lui.

**`ActorTypes`** — `Actor type` (clé) · `Icon` · `Nature` (`Business` / `Technical`, vide valant `Business`). C'est le type qui porte la nature, pas l'acteur — même principe que le périmètre porté par le groupe, ci-dessus. La colonne `Preview` est calculée et ignorée à la lecture.

**`FlowTypes`** — `Flow type` (clé) · `Direction` · `Description`

**`Interfaces`** — `Flow name` · `Version` · `Provider` · `Flow type` · `Description` · `Contract link` · `Contract reference` · `Comments` · `To confirm` · `Relays` (nom du flux que cette interface prolonge, renseigné seulement quand l'exposant est technique) · `Introduced at` · `Retired at`. `Nature` et `Relays` portent le schéma en v3 (voir la spécification du 18 août 2026, qui détaille la dérivation fonctionnelle qu'elles rendent possible).

**`FX_*`** — `Flow name` · `Version` · `Consumer` · `Usage` · `Criticality for this consumer` · `Decision` · `Comments` · `Introduced at` · `Retired at`

**`Milestones`** — `Milestone` (clé) · `Rank` · `Label` · `Status` (Delivered / Planned) · `Date` · `Description`

### 3.3 Règles de lecture

- Les en-têtes de colonnes **et** les noms de feuilles structurantes (`Actors`, `FlowTypes`, `Interfaces`, `Instructions`, `Lists`, préfixe `FX_`) sont reconnus **sans tenir compte de la casse, des accents et des espaces multiples**. Une colonne supplémentaire non prévue est ignorée sans erreur ; une colonne attendue absente est signalée (voir §7.1 — colonne clé absente sur une feuille structurante interrompt la lecture).
- Une ligne est retenue si au moins une de ses colonnes utiles est renseignée.
- Le rattachement d'une consommation à son interface se fait par **(feuille, nom du flux, version)**. Une version vide est une version, pas une absence. La feuille attendue d'une interface est reconstruite par `FX_` + acteur exposant + `_` + type de flux ; le nom d'onglet n'est jamais analysé pour en déduire l'exposant.
- Aucune normalisation n'est tentée quand le nom reconstruit dépasse les limites d'Excel (31 caractères) ou contient un caractère interdit (`: \ / ? * [ ]`) : l'absence d'onglet correspondant est alors signalée normalement (§7.1, « onglet `FX_` attendu mais absent »). C'est au classeur de garder des noms de types de flux compatibles avec les contraintes Excel.

### 3.4 Métadonnées du fichier

La date affichée dans le bandeau (§6.3) est lue dans les métadonnées internes du classeur (`core.xml`, `dcterms:modified`), pas dans la date de modification du fichier au niveau du système d'exploitation/navigateur. C'est la date de dernière sauvegarde réelle par Excel/M365, fiable même quand le fichier a été resynchronisé ou retéléchargé depuis SharePoint/OneDrive avant d'être déposé sur le poste.

---

## 4. Règles de calcul

### 4.1 Sens de la flèche

Un flux relie un acteur exposant à un acteur consommateur. Le sens dessiné **est déterminé par le type de flux uniquement**, via `Sens de représentation` :

- `exposant → consommateur` : la flèche part de l'exposant
- `consommateur → exposant` : la flèche part du consommateur

Ce sens est une **convention de représentation**, pas une description technique. Un consommateur Kafka tire du broker, mais un flux Kafka se dessine comme une poussée du producteur, parce que c'est la lecture qui a du sens sur un schéma.

### 4.2 Agrégation

Sur les vues à traits agrégés (5.1, 5.2, 5.4), chaque acteur est remplacé par une clé de nœud (son groupe, ou lui-même selon la vue). Les flux partageant **(nœud de départ, nœud d'arrivée, type de flux)** fusionnent en un seul trait porteur d'un compteur.

Le compteur porté par un trait agrégé et l'épaisseur du trait mesurent la **même grandeur** : le nombre de consommations (couples interface × consommateur) fusionnées sur ce trait. Il n'y a pas de grandeur distincte pour l'épaisseur.

### 4.3 Boucles internes

Un trait dont le nœud de départ et le nœud d'arrivée sont identiques **n'est pas affiché**. Cette règle s'applique à toutes les vues à traits agrégés (5.1, 5.2, 5.4). Ces flux restent visibles dans la vue par acteur (5.3) et dans la matrice (5.5).

### 4.4 Vue cible

Option globale applicable à toutes les vues :

- les flux dont la `Décision` vaut **À supprimer**, ou dont le `Statut` vaut **Décommissionné** — que ce soit celui de la consommation, celui de l'acteur exposant, ou celui de l'acteur consommateur — sont exclus du calcul ;
- les flux **À transformer** sont dessinés en trait pointillé atténué (vues graphiques) ou en couleur atténuée distincte (cellule de la matrice, §5.5) ;
- un trait agrégé n'est atténué que si **tous** les flux qu'il porte le sont.

Un acteur décommissionné disparaît donc lui aussi de la vue cible, avec tous ses flux — mais reste visible en vue normale, exactement comme une décision À supprimer.

### 4.5 Sens opposés

Deux nœuds qui s'appellent dans les deux sens sur la même technologie produisent **deux flèches opposées distinctes**, jamais une flèche bidirectionnelle.

---

## 5. Les vues

Six vues, présentées dans cet ordre dans le rail de gauche. Chacune se lit dans l'un des deux modes du classeur, `Architecture` ou `Fonctionnel`, choisis en tête de rail — le fonctionnel dérive de l'architecture, il ne se saisit pas à part. « Par technologie » (5.4) n'existe qu'en architecture : le fonctionnel a retiré la technologie, la vue n'a donc plus d'objet. Le détail de la dérivation, du sélecteur et des vues affectées est dans la spécification du 18 août 2026 ; sauf mention contraire ci-dessous, les vues décrites ici sont celles du mode architecture.

### 5.1 Groupe à groupe

- **Nœuds** : les groupes d'acteurs. Rendu rectangulaire à double filet.
- **Traits** : un par couple de groupes et par technologie, dédupliqués.
- **Libellé** : le nom de la technologie, suivi du compteur (`HTTP ×9`) quand il dépasse 1 et que l'option est active.
- **Épaisseur** : croissante avec le nombre de consommations portées (même grandeur que le compteur, §4.2).
- Aucun nom de flux n'apparaît.

### 5.2 Plateforme détaillée

Identique à la précédente, à ceci près que **chaque acteur dont le `Périmètre` vaut Plateforme devient son propre nœud**, tandis que les acteurs externes restent agrégés au niveau de leur groupe. Les nœuds de plateforme se distinguent par un fond teinté et un filet plus épais.

Mêmes règles de déduplication, de compteur et de boucles internes.

### 5.3 Par acteur

- **Sélection** : un acteur, via une liste déroulante dans le rail.
- **Nœuds** : l'acteur sélectionné et ses voisins directs à un saut. L'acteur sélectionné est en inversion vidéo.
- **Traits** : **tous les flux entrants et sortants, sans déduplication**.
- **Libellé** : le nom du flux, suivi de sa version quand elle est renseignée — c'est ce qui rend une migration lisible d'un coup d'œil, chaque consommateur portant la version qu'il consomme. L'orthographe affichée est celle du catalogue, pas celle recopiée côté consommation.

### 5.4 Par technologie

- **Sélection** : une technologie, via la liste déroulante du rail.
- **Nœuds** : les acteurs concernés par cette technologie.
- **Traits** : dédupliqués par couple d'acteurs, avec compteur.

Cette vue suit les mêmes règles que 5.1/5.2 : le toggle « compteurs » et le masquage des boucles internes (§4.3) s'y appliquent identiquement.

Cette vue répond aux questions du type « on arrête l'ESB, qu'est-ce qui tombe ».

### 5.5 Matrice

Tableau croisé acteur × acteur. Les lignes sont les acteurs de départ, les colonnes les acteurs d'arrivée — départ/arrivée au sens du sens dessiné (§4.1), pas nécessairement exposant/consommateur brut. Chaque cellule non vide liste les technologies en jeu avec leur compteur, chacune dans sa couleur ; une technologie **À transformer** (vue cible active, §4.4) y est affichée dans une teinte atténuée distincte.

Ce n'est pas un schéma : la matrice est exhaustive, triable visuellement, imprimable, et lisible ligne à ligne en réunion — ce qu'un graphe ne permet pas sur une topologie en étoile.

### 5.6 Contrôles d'intégrité

Voir section 7. Le libellé de cette vue dans le rail porte un compteur d'anomalies.

---

## 6. Interface

### 6.1 Structure de l'écran

```
┌──────────────────────────────────────────────────────────────┐
│ Carte des interfaces   <état du fichier>   [SVG]  [PNG]      │
├──────────────┬───────────────────────────────────────────────┤
│ VUES         │                                               │
│  ...         │                                               │
│              │                                               │
│ ACTEUR       │              zone de rendu                    │
│  [liste]     │                                               │
│              │                                               │
│ OPTIONS      │                                               │
│  ☐ cible     │                                               │
│  ☑ compteurs │                                               │
│              │                                               │
│ TECHNOLOGIES │                                               │
│  ─ HTTP      │                                               │
│  ─ Kafka     │                                               │
└──────────────┴───────────────────────────────────────────────┘
```

- Le **bandeau** porte le titre, l'état du fichier chargé et les deux boutons d'export. Les boutons sont désactivés sur les vues Matrice et Contrôles (§8), qui ne produisent pas de SVG.
- Le **rail** porte les vues, le sélecteur contextuel (masqué quand la vue n'en a pas), les options d'affichage (masquées sur la vue Contrôles) et la légende des technologies (limitée aux technologies effectivement présentes dans la vue courante).
- La **zone de rendu** contient le schéma, le tableau ou le rapport, et défile dans les deux axes.

### 6.2 État initial

Tant qu'aucun classeur n'est chargé, la zone de rendu affiche une cible de dépôt en pointillés, avec le nom du fichier attendu et une phrase indiquant que le classeur n'est ni envoyé ni conservé. La cible se met en évidence pendant le survol d'un fichier.

Les boutons d'export sont désactivés.

### 6.3 État chargé

Le bandeau affiche le nom du fichier en gras, puis le décompte des acteurs, interfaces et consommations, puis la date d'enregistrement du fichier déposé (§3.4) — cette dernière étant la seule indication de fraîcheur dont dispose l'utilisateur, puisqu'il n'y a pas de rafraîchissement.

La vue « Groupe à groupe » est sélectionnée par défaut.

### 6.4 Rédaction des messages

Un message d'erreur dit ce qui s'est passé et ce qu'il faut faire, sans s'excuser et sans jargon technique. Exemples attendus :

- « Ce n'est pas un classeur Excel. Déposez un fichier .xlsx ou .xlsm. »
- « Feuille *Interfaces* absente du classeur. »
- « Ce navigateur refuse la conversion en PNG — utilisez l'export SVG. »

---

## 7. Contrôles d'intégrité

Cinq familles d'anomalies, plus des blocs informatifs de trois niveaux (information, action, avertissement). Le compteur du rail **ne compte que les anomalies**, pour que la liste reste crédible.

### 7.1 Structure — le fichier ne se lit pas comme prévu

- Feuille `Acteurs`, `TypesFlux` ou `Interfaces` absente (**bloquant**, la lecture s'arrête)
- Colonne clé absente sur une de ces feuilles (`Nom` sur `Acteurs`, `Type de flux` sur `TypesFlux`, `Nom du flux` sur `Interfaces`) (**bloquant**, la lecture s'arrête — sans elle, le référentiel ou le rattachement des lignes est impossible à construire)
- Colonne (non clé) attendue absente d'une feuille (signalé, la lecture continue)
- Acteur déclaré deux fois dans le référentiel
- Deux interfaces de même nom **et de même version** dans le même onglet
- Onglet `FX_` attendu par une interface mais absent du classeur (y compris quand le nom reconstruit dépasse les limites Excel, §3.3)
- Onglet `FX_` présent mais auquel aucune interface ne se rattache

### 7.2 Références — une valeur pointe vers rien

- Acteur exposant inconnu du référentiel
- Type de flux inconnu du référentiel
- Acteur consommateur inconnu du référentiel
- Consommation dont le nom de flux ne figure pas au catalogue
- Consommation dont la version ne figure pas au catalogue pour ce flux — on ne rattache pas à une autre version
- Consommation rangée dans le mauvais onglet — le message nomme l'onglet correct
- `Relays` désigne un nom de flux absent du catalogue
- `Relays` désigne un nom porté par plusieurs interfaces — l'outil ne choisit pas au hasard entre elles

### 7.3 Cohérence — le fichier se lit, mais quelque chose ne tient pas

- Consommateur identique à l'exposant
- Interface sans aucune consommation déclarée
- Acteur sans aucun flux entrant ni sortant
- Consommateur inscrit sur deux versions du même flux — on ne consomme qu'une version d'un contrat
- Interface à l'état `Retiré` mais encore consommée
- Interface exposée par un acteur **métier** portant un `Relays` — on ne relaie que si on est soi-même un relais
- Chaîne de relais qui boucle sur elle-même
- Interface consommée uniquement par des acteurs techniques dont aucune chaîne n'atteint un consommateur métier — elle entre dans la plomberie et n'en ressort pour personne, un cas qui resterait sinon **silencieux** (détail de la dérivation en §4 de la spécification du 18 août 2026)

### 7.3 bis Vocabulaires — une valeur saisie change le dessin sans le dire

Listes fermées, chacune validée indépendamment des autres : `Décision`, `Criticité`, `Sens de représentation` d'un type de flux, et `Nature` d'un type d'acteur (`Business` / `Technical`). Une faute de frappe y produit un schéma faux sans le signaler autrement — un sens de représentation inconnu, par exemple, inverse la flèche en silence.

### 7.4 Complétude — il manque de la saisie

- Description d'interface vide
- Aucun contrat d'interface, ni lien ni référence
- Usage non décrit sur une consommation
- Statut ou décision vide sur une consommation
- Groupe vide sur un acteur — signalé explicitement comme entraînant son absence des vues agrégées
- Périmètre non renseigné sur un acteur
- Type d'acteur sans `Nature`
- Interface exposée par un acteur **technique** sans `Relays` — la chaîne est coupée là

Ces deux derniers contrôles ne se déclenchent **que si au moins un type déclare une nature** : tant que l'équipe n'a pas adopté la distinction, l'outil n'en parle pas — même règle que pour les paliers.

### 7.5 Candidats au décommissionnement — information, pas anomalie

Interfaces dont **toutes** les consommations portent un `Palier de retrait` : plus personne ne les consommera passé ce palier. Une décision `Remove` ne compte pas ici — elle dit qu'on voudrait s'en passer, pas qu'un départ est daté. Ce n'est pas un défaut du classeur : c'est une piste de travail, présentée dans un bloc neutre et exclue du compteur d'anomalies.

### 7.6 Interfaces à confirmer — information, pas anomalie

Interfaces dont la colonne `À confirmer` vaut Oui. Signale les incertitudes de reprise (exposant déduit, nom de flux retrouvé a posteriori...) qui restent à valider avec les équipes concernées — sans bloquer la lecture ni compter comme anomalie.

### 7.6 bis Migrations en cours — action, pas anomalie

Interfaces à l'état `À décommissionner` qui portent encore des consommateurs, avec la ou les versions actives du même flux vers lesquelles les emmener, ou la mention « aucune version active » quand la version d'arrivée reste à créer. Le fichier est juste ; c'est un travail qui attend quelqu'un.

### 7.7 Groupes utilisés — information, pas anomalie

Liste des groupes distincts trouvés dans `Acteurs`, avec le nombre d'acteurs par groupe. `Groupe` est un champ libre (§3.2), sans liste fermée imposée à la saisie ; ce bloc rend une faute de frappe créant un groupe fantôme dans les vues agrégées visible à la relecture, sans contraindre la saisie dans Excel.

### 7.7 bis Cycles de dépendance — information, pas anomalie

Consommer une interface, c'est dépendre de celui qui l'expose. Quand ces dépendances se referment — A a besoin de B, qui a besoin de A, directement ou de proche en proche — aucun des composants concernés ne peut arriver, partir ou changer de contrat sans les autres. Ce n'est pas une faute du classeur : c'est une contrainte d'architecture que le classeur laissait jusqu'ici invisible.

Le bloc nomme les **groupes**, pas les chemins : énumérer tous les chemins d'un enchevêtrement en produit un nombre qui explose, là où le groupe dit la même chose en une ligne. Un acteur qui consomme sa propre interface n'y figure pas — c'est une boucle interne, déjà masquée par les vues agrégées.

### 7.8 Présentation

Un bloc par famille (y compris les familles informatives 7.5 à 7.7 bis), portant son intitulé, son compteur et une phrase expliquant ce que la famille recouvre. Une famille sans anomalie affiche « Rien à signaler » plutôt que de disparaître : l'absence de résultat est une information.

**L'emplacement.** Un rapport sert à corriger, donc chaque élément qui vise une ligne du classeur dit où elle est : `Interface "Member lookup 2.0" (Interfaces, row 3): description empty.` La feuille et le numéro de ligne sont ceux qu'Excel affiche, lignes vides comprises — le parseur les retient à la lecture, l'indice du tableau ne conviendrait pas.

**L'ordre.** À l'intérieur de chaque famille et de chaque bloc, les éléments suivent le classeur : feuille, puis ligne croissante. Ce qui n'a pas d'adresse — un onglet manquant, un classeur sans palier livré — passe en tête : ça vise le fichier, pas une saisie.

---

## 8. Exports

Sept formats, tous produits depuis le classeur déjà chargé, sans requête réseau.

| | SVG | PNG | Excel | Markdown | draw.io | Structurizr | LikeC4 |
|---|---|---|---|---|---|---|---|
| Contenu | L'élément affiché, sérialisé tel quel | Rasterisation du SVG, facteur 2 | La matrice (§5.5), triable dans Excel | Le rapport d'intégrité (§7) | Tout le classeur, une planche par onglet | Tout le classeur, une vue par planche — un modèle C4 | idem, syntaxe LikeC4 |
| Disponibilité | Vues graphiques | idem, sauf refus du navigateur | Vue Matrice seule | Vue Contrôles seule | Indépendant de la vue ouverte : classeur et palier affiché | idem | idem |
| Rapport au mode | Suit le mode : sérialise ce qui est à l'écran | idem | Suit le mode, avec la matrice | Indifférent — le rapport juge le classeur, pas une lecture du classeur | Suit le mode — c'est un dessin, pas un modèle | **Architecture seulement**, inerte en fonctionnel | idem |

Nom de fichier construit automatiquement : `carto-<vue>[-<sélection>][-cible].<ext>`, en minuscules sans accent. En mode fonctionnel, `functional` s'y ajoute (`carto-functional-group-to-group.svg`) — les noms existants ne bougent pas, et deux exports du même schéma ne peuvent plus se recouvrir.

Si la conversion PNG échoue — cas connu sur Safari, qui restreint la rasterisation d'un SVG dans un canvas — l'échec est explicite dans le bandeau et renvoie vers l'export SVG. L'application ne doit jamais échouer silencieusement sur cette opération.

Les boutons SVG et PNG sont désactivés sur les vues Matrice et Contrôles ; Excel n'est actif que sur la matrice, Markdown que sur les contrôles. **Structurizr et LikeC4 décrivent un modèle C4, c'est-à-dire une architecture** ; ils s'éteignent en mode fonctionnel, où livrer un fichier qui raconte autre chose que l'écran est précisément ce que l'outil s'interdit — draw.io, lui, continue de suivre le mode puisque c'est un dessin. Détail de la dérivation fonctionnelle et des deux DSL dans la spécification du 18 août 2026 (§5.3).

---

## 9. Comportements d'erreur

| Situation | Comportement attendu |
|---|---|
| Fichier déposé qui n'est ni `.xlsx` ni `.xlsm` | Extension vérifiée puis parsing tenté ; un échec de parsing (signature invalide, `.xls` binaire, corrompu) produit le même type de message que « classeur illisible » ci-dessous. Message dans le bandeau, état précédent conservé |
| Classeur illisible ou corrompu | Message reprenant la cause, état précédent conservé |
| Feuille structurante ou colonne clé absente | Lecture interrompue, causes listées dans le bandeau (§7.1) |
| Sélection sans aucun flux | « Aucun flux à afficher pour cette sélection », pas de zone vide muette |
| Nouveau dépôt | Remplace intégralement l'état, revient sur la vue par défaut |

Principe général : **un dépôt raté ne détruit jamais ce qui est affiché.** Le remplacement de l'état n'a lieu qu'après un chargement complet et réussi (parsing + construction du référentiel + contrôles d'intégrité).

---

## 10. Architecture technique

### 10.1 Stack de développement

Le livrable est un `.html` unique et autonome (§2), mais le développement utilise un outillage normal :

- **TypeScript**, modules séparés par responsabilité
- **esbuild** pour bundler code applicatif + bibliothèques (SheetJS, ELK) en un seul fichier HTML avec tout le JS inliné
- **Vitest** pour les tests unitaires sur les modules purs (aucun navigateur nécessaire)

Bibliothèques embarquées : **SheetJS (`xlsx`)** pour le parsing du classeur (lecture des feuilles et des métadonnées `core.xml`) et **ELK** (`elkjs`) pour le calcul de layout des vues graphiques, toutes deux inlinées dans le bundle final — aucun chargement CDN au runtime.

### 10.2 Modules

- **`parsing/`**
  - `workbook.ts` — wrapper SheetJS : `File` → feuilles brutes (lignes en objets) + date `core.xml`
  - `headers.ts` — appariement de noms de colonnes/feuilles insensible à la casse, aux accents, aux espaces multiples (§3.3)
  - `build-model.ts` — feuilles brutes → `ParsedModel` typé (Acteurs, TypesFlux, Interfaces, Consommations), résolution des références, détection des cas bloquants (§7.1)
- **`integrity/checks.ts`** — implémente les familles 7.1 à 7.4 (anomalies) et 7.5 à 7.7 (blocs informatifs) sur un `ParsedModel`, produit les anomalies typées par famille et les blocs candidats au décommissionnement / à confirmer / groupes utilisés
- **`aggregation/`** — fonctions pures `(ParsedModel, vue, options, sélection) → { nœuds, traits }` (vues graphiques) ou lignes de tableau (5.5) ; centralise déduplication, compteur, boucles internes, atténuation cible (§4)
- **`layout/graph-layout.ts`** — wrapper ELK : nœuds/traits → positions
- **`render/`** — `svg-builder.ts` (graphe positionné → SVG DOM), `matrix-table.ts`, `integrity-report.ts`
- **`export/`** — sérialisation SVG, rasterisation PNG (canvas ×2, `try/catch` Safari, §8)
- **`ui/`** — état applicatif (fichier chargé, vue courante, options, sélection), boucle de rendu, bandeau, rail, cible de dépôt

### 10.3 Flux de données et gestion d'erreurs

1. Dépôt fichier → extension `.xlsx` vérifiée, puis parsing SheetJS tenté
2. Échec (étape 1) → message bandeau adapté (§9), **état précédent conservé intégralement**
3. Parsing OK → `build-model.ts` normalise en-têtes/référentiel ; feuille structurante ou colonne clé absente → erreur bloquante, causes listées dans le bandeau, **état précédent conservé**
4. Modèle construit → `checks.ts` produit anomalies + candidats au décommissionnement
5. Nouvel état appliqué d'un bloc (remplacement intégral, jamais partiel) : fichier, décomptes, date, vue par défaut = Groupe à groupe
6. Rendu : agrégation → layout ELK → SVG/tableau ; sélection sans flux → message dédié (§9)
7. Export : SVG sérialisé directement ; PNG rasterisé en `try/catch` — échec → message bandeau explicite renvoyant vers l'export SVG, jamais d'échec silencieux

Le remplacement d'état (étape 5) n'a lieu qu'en cas de succès complet des étapes 1 à 4 — un dépôt raté n'affecte jamais ce qui est affiché.

### 10.4 Rendu

Approche retenue : **re-render complet, fonctions pures**, sans framework ni réactivité fine. Un seul état mutable (modèle chargé, vue courante, options, sélection) ; tout changement d'état rejoue intégralement le pipeline agrégation → layout → rendu pour la zone concernée. Les volumes visés (dizaines à quelques centaines d'acteurs et de flux) rendent ce re-calcul négligeable en coût, y compris le layout ELK à chaque toggle. Ce choix reste cohérent avec la contrainte « sans état » (§2.5) et avec l'exigence que l'export SVG soit exactement l'objet affiché (§2.7).

---

## 11. Stratégie de tests

- **Vitest sur modules purs**, sans navigateur :
  - `headers.ts` : appariement insensible casse/accents/espaces, colonne surnuméraire ignorée
  - `build-model.ts` : construction du référentiel, résolution `FX_<exposant>_<type>`, cas bloquants
  - `checks.ts` : un test par règle 7.1–7.4 (un cas positif + un cas « rien à signaler »), plus un test par bloc informatif 7.5–7.7 (candidats décommissionnement y compris via Statut, interfaces à confirmer, groupes utilisés)
  - `aggregation/` : déduplication (nœud départ/arrivée/type), compteur = épaisseur = nb de consommations, boucles internes masquées sur vues agrégées (5.1/5.2/5.4), atténuation cible (agrégé atténué ssi tous les flux portés le sont), exclusion en vue cible sur Décision=À supprimer **et** sur Statut=Décommissionné (consommation ou acteur), sens opposés jamais fusionnés en flèche bidirectionnelle
- **Fixture d'intégration** : `Exemples/cartographie-interfaces_3.xlsx` rejoué de bout en bout (parsing → modèle → contrôles) pour vérifier l'absence d'exception sur un vrai classeur et la plausibilité des décomptes
- **Hors périmètre pour cette première spec** : pas de tests e2e navigateur automatisés sur le rendu SVG — vérification manuelle du fichier buildé à l'ouverture

---

## 12. Génération des onglets manquants (macro Excel)

Cette fonctionnalité vit **dans le classeur**, pas dans l'outil web. L'outil web reste strictement lecteur (§1) ; il ne crée, ne renomme et n'exécute aucun onglet ni macro.

### 12.1 Périmètre

- Le classeur maître passe en `.xlsm` pour porter la macro de façon pérenne. L'outil web accepte `.xlsx` et `.xlsm` en entrée sans distinction (§2.3, §9) — il ignore le contenu macro.
- Un onglet `FX_Modèle`, masqué, sert de gabarit : même structure que les onglets `FX_*` (en-têtes, validations sur `Nom du flux`/`Acteur consommateur`/`Criticité`/`Statut`/`Décision`, ligne d'en-tête figée). Toute évolution de structure des onglets `FX_*` se fait sur ce gabarit, pas dans le code de la macro.
- Un bouton sur la feuille `Interfaces` déclenche la macro `GenererOngletsManquants`.

### 12.2 Comportement

Pour chaque ligne du catalogue `Interfaces` :

1. Reconstruit `FX_<exposant>_<type>` (même convention que §3.3).
2. Si le nom dépasse 31 caractères ou contient un caractère interdit (`: \ / ? * [ ]`), la ligne est ignorée et listée en fin d'exécution — aucune tentative de troncature ou de normalisation, cohérent avec §3.3.
3. Si un onglet de ce nom existe déjà, rien ne se passe (la macro est **idempotente** : la relancer sur un classeur déjà à jour ne crée rien).
4. Sinon, l'onglet `FX_Modèle` est dupliqué, renommé, rendu visible.

Un message récapitule en fin d'exécution les onglets créés et ceux ignorés (avec la raison).

### 12.3 Limite connue

Les macros VBA ne s'exécutent que dans Excel de bureau, jamais dans Excel Online (l'éditeur web utilisé pour la co-édition SharePoint/M365, §"Travailler à plusieurs" du `Mode d'emploi`). Un contributeur qui n'a besoin que de saisir des données peut continuer à travailler exclusivement dans le navigateur ; générer un onglet manquant nécessite d'ouvrir le classeur dans Excel de bureau. Le classeur étant macro-activé, Excel affiche par ailleurs un bandeau « Activer le contenu » à chaque ouverture, qu'il faut accepter pour que le bouton fonctionne.

## Décisions issues de la revue

- Aucune exigence d'accessibilité (ex-§6.5 du brouillon) : retirée à la demande explicite de l'utilisateur — chargement uniquement par glisser-déposer (§2.3) sans alternative clavier possible, et pas de besoin exprimé au-delà.
- Analyse du classeur d'exemple (`Exemples/cartographie-interfaces_3.xlsx`) : le `Mode d'emploi` du classeur documente un cycle de vie via `Statut=Décommissionné` (consommation et acteur), distinct de `Décision=À supprimer` mais non traité par la version initiale de la spec. §4.4 et §7.5 étendus pour que les deux signaux soient équivalents en vue cible.
- Ajout de la colonne `À confirmer` sur `Interfaces` (§3.2) et du bloc informatif §7.6, pour formaliser les mentions « à confirmer » jusque-là en texte libre dans `Commentaires`.
- Ajout du bloc informatif §7.7 « Groupes utilisés », pour rendre visibles à la relecture les fautes de frappe sur le champ libre `Groupe` sans imposer de liste fermée à la saisie.
- Ajout de la génération automatique des onglets manquants (§12), via une macro VBA embarquée dans le classeur (devenu `.xlsm`) plutôt que via l'outil web ou un Office Script partagé au niveau du tenant — ce dernier a été écarté faute de possibilité d'activer le partage tenant M365. Conséquence acceptée : générer un onglet nécessite Excel de bureau, pas Excel Online.
