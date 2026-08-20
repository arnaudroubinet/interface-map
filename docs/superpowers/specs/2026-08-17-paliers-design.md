# Paliers : la chronologie de la plateforme dans le classeur

> **Fusion du 17 août 2026.** Les paliers de schéma décrits ici (v1, v2, v3) n'ont jamais été livrés : ils ont été fusionnés en une seule étape `0 → 1` avant toute mise en circulation. Le schéma courant est **v2**, et un seul format existe en amont — celui d'avant le versionnement. Ce document garde la décision qui l'a produit ; il ne décrit plus un état du code.

> **Correctif du 18 août 2026 — schéma v2.** La traduction a renommé l'onglet `Listes` en `Lists` mais a laissé trois formules citer l'ancien nom. Excel n'y voyait pas une faute : il en déduisait un renvoi vers un AUTRE CLASSEUR, d'où l'avertissement « liaisons avec une ou plusieurs sources externes » à chaque ouverture, et des listes déroulantes dépendantes qui ne se remplissaient jamais. Le v1 était déjà en production : le schéma passe donc en **v2** pour que les classeurs distribués soient reconnus comme périmés et repassent par la reconstruction. L'étape `1 → 2` ne transforme rien dans le modèle — les formules naissent à l'écriture ; l'onglet `Milestones` y gagne au passage le tableau structuré qui lui manquait.

Spécification · 17 août 2026

Remplace l'axe de temps improvisé du classeur (`cible`, `État`, `Statut`, `Décision=À supprimer`) par un axe explicite. Fait passer le modèle en **schéma v2**.

---

## 1. Vocabulaire, avant tout

Trois choses porteraient sinon le même nom. Elles ne se confondent jamais :

| Notion | Où elle vit | Exemple |
|---|---|---|
| **Version** d'un contrat d'interface | colonne `Version` de `Interfaces` | `Paiement API 2.0` |
| **Numéro de schéma** du classeur | onglet masqué `Version` | `2` |
| **Palier** de la plateforme | onglet `Paliers` | `v2.0`, `T3-2026` |

Le mot « version » ne désigne jamais un palier, dans le code comme dans l'interface.

## 2. Objet

Répondre à trois questions que le classeur ne sait pas traiter aujourd'hui :

- à quoi ressemble la plateforme **à un palier donné** ;
- **qu'est-ce qui change** entre deux paliers ;
- **conserver** l'état des paliers passés sans dupliquer le fichier.

Le palier traverse tout le référentiel : il concerne l'apparition et la disparition des **acteurs** autant que des interfaces et des consommations.

### 2.1 Rapport avec les principes de la spécification de référence

§1 écarte « historisation, versions », au motif qu'elles sont assurées par le versionnement natif du fichier. Cela reste vrai et n'est pas contredit : SharePoint versionne le **document**, les paliers décrivent la chronologie de la **plateforme**, qui est une donnée du référentiel comme les acteurs le sont. « Sans état » concerne la mémoire de l'outil entre deux ouvertures et n'est pas touché ; « un classeur à la fois » non plus, tout tenant dans le même fichier.

## 3. L'onglet `Paliers`

| Colonne | Rôle |
|---|---|
| `Palier` | clé, texte libre (`v2.0`, `T3-2026`) |
| `Rang` | entier, porte l'ordre |
| `Libellé` | intitulé lisible |
| `Statut` | `Livré` · `Planifié` |
| `Date` | prévue ou réelle |
| `Description` | ce que le palier recouvre |

Le rang est une colonne et non l'ordre des lignes : un tri dans Excel détruirait un ordre implicite sans rien dire.

Le **palier courant** est celui de rang le plus élevé parmi les `Livré`. C'est lui que les vues montrent par défaut. Si aucun palier n'est `Livré`, les vues se placent sur le rang le plus bas et un contrôle le signale (§7) : mieux vaut montrer le premier état déclaré que rien du tout.

## 4. Les colonnes de validité

`Acteurs`, `Interfaces` et les onglets `FX_` gagnent chacun deux colonnes, en liste déroulante alimentée par l'onglet `Paliers` :

- `Palier d'introduction` — vide vaut « depuis toujours » ;
- `Palier de retrait` — vide vaut « toujours là ».

Une ligne est vivante à un palier P si son introduction est atteinte au rang de P et son retrait pas encore. Le retrait est exclu : « retiré en v3 » veut dire qu'en v3 la ligne n'est déjà plus là.

**Ce sont des paliers, jamais des dates.** La date est portée par le palier lui-même, dans l'onglet `Paliers`. Une ligne ne sait pas *quand* elle est arrivée, elle sait *à quel jalon* — et c'est le jalon qui porte la date. La distinction n'est pas cosmétique : elle évite qu'un objet et un palier se contredisent sur la même chronologie.

**L'arrivée est obligatoire, le retrait non** (décidé à l'implémentation, 17 août 2026). Sans palier d'introduction, on ne sait pas à partir de quand la ligne compte, et aucune vue ne peut la placer dans le temps : c'est un manque de saisie, signalé en §7.4 comme une description vide l'est déjà. Au pire celui qui tient le fichier posera un palier arbitraire, mais le choix lui revient — **rien n'est hérité ni deviné d'un objet à l'autre**.

Un retrait vide n'est en revanche pas un manque : c'est un fait, la ligne est encore là.

Ces contrôles ne se déclenchent que si l'onglet `Paliers` déclare au moins un palier. Tant que l'équipe n'a pas adopté l'axe, l'outil n'en parle pas.

`Groupes` ne porte aucune de ces colonnes : un groupe existe à un palier s'il lui reste au moins un acteur vivant. **Dérivé plutôt que saisi** — une saisie de plus serait une occasion de plus de se contredire.

## 5. Ce que l'axe remplace

L'outil exprime aujourd'hui le temps par trois mécanismes qui se recouvrent partiellement. Ils sont remplacés, pas doublés — trois façons de dire « ça disparaît » finissent toujours par diverger.

| Aujourd'hui | Devient |
|---|---|
| `État` d'interface (`Actif` · `À décommissionner` · `Retiré`) | **dérivé** : retrait au futur → à décommissionner ; retrait atteint → retiré |
| `Statut` de consommation (`Actif` · `En projet` · `Décommissionné`) | **dérivé** de la même façon |
| case `cible` du rail | sélecteur de palier |

`Décision` ne bouge pas : elle porte un jugement sur la consommation — `Keep`, `Investigate`, `Transform`, `Remove` — et n'a jamais porté de temps. `Remove` dit qu'on voudrait se passer de cette consommation, pas quand elle part ; c'est une alerte de dépréciation, et le `Palier de retrait` reste le seul endroit où un départ se date. Les deux peuvent coexister : décider qu'une consommation doit partir et savoir à quel palier sont deux informations distinctes.

### 5.1 Conversion v1 → v2

L'étape de la chaîne de mise à niveau ne se contente pas d'ajouter des colonnes vides : elle **convertit**.

- `État` = `Retiré`, ou `Statut` = `Décommissionné` → `Palier de retrait` = palier courant.
- `État` = `À décommissionner` → `Palier de retrait` = premier palier planifié.
- `Statut` = `En projet` → `Palier d'introduction` = premier palier planifié.

#### Le palier `Origin`

La conversion crée l'onglet `Paliers` et y inscrit un unique palier nommé **`Origin`**, de rang 1, marqué `Livré`, dont la colonne `Date` porte **la date à laquelle la migration est exécutée**.

**Chaque ligne existante reçoit `Origin` comme palier d'introduction.** C'est ce qui rend la conversion viable : l'arrivée étant obligatoire (§4), un classeur converti sans ce point d'ancrage s'ouvrirait sur une anomalie de complétude par ligne — des centaines sur un vrai référentiel, et l'axe serait rejeté avant d'avoir servi.

`Origin` ne prétend pas dire quand chaque objet est réellement apparu : cette information n'existe nulle part dans un classeur v1, et l'inventer serait pire que de l'avouer. Il dit exactement ce qu'il sait — « tout ceci existait déjà au moment où l'on a basculé » — et son libellé le dit en toutes lettres dans l'onglet. Ceux qui voudront rétablir une chronologie plus fine ajouteront leurs paliers et redistribueront les arrivées ; le classeur reste juste entre-temps.

Les paliers de retrait produits par les autres règles de conversion se placent après `Origin`, sur un palier planifié `À venir` créé au besoin — un seul, parce que « plus tard » est tout ce qu'un classeur v1 sait dire.

**Le palier `Avant`** (constaté à l'implémentation). Ce qu'un classeur v1 déclarait **déjà** retiré était parti avant la bascule : lui donner `Origin` comme arrivée *et* comme retrait produit un intervalle vide, que les contrôles signalent à juste titre. Il lui faut donc un avant, créé seulement s'il sert. Les trois paliers sont numérotés après coup, pour qu'aucun rang ne manque quand `Avant` n'existe pas.

Les classeurs restés en v0 traversent v0 → v1 → v2 d'un seul geste : c'est exactement ce pour quoi la chaîne a été construite.

## 6. Les vues

Le sélecteur de palier prend la place de la case `cible`, et **tout** l'outil se rend au palier choisi. « Tout » veut dire, sans exception :

- les six vues de schéma et la matrice ;
- les exports SVG, PNG et XLSX, dont le nom de fichier porte le palier là où il portait `cible` ;
- les filtres du rail, dont les listes ne proposent que ce qui est vivant au palier ;
- le rapport de contrôle, pour sa part dépendante du palier (§7.1).

Il propose les paliers **livrés comme planifiés** : c'est ce qui remplace la case `cible`, qui n'offrait qu'un seul futur. Choisir un palier planifié montre la plateforme telle qu'elle sera si le plan se réalise.

S'y ajoute une vue **« Écarts »**, entre deux paliers :

- acteurs ajoutés et retirés ;
- interfaces ajoutées et retirées ;
- consommations ajoutées et retirées.

Le tout **calculé**, jamais saisi. Et sous le relevé, le schéma groupe à groupe de l'écart : le paysage du palier d'arrivée augmenté de ce qui vient d'en disparaître, les traits ajoutés en vert et les retirés en rouge.

**Chaque trait porte un solde, pas un volume** (décidé à l'implémentation). Un premier essai marquait seulement les liens apparus et disparus ; il laissait passer le cas le plus courant, celui d'un lien qui subsiste avec moins de flux — `×6` devenu `×4` restait un trait ordinaire, et c'était précisément ce que le schéma devait rendre visible.

Chaque lien porte donc, par technologie, la différence de volume entre les deux paliers : `+3` en vert, `−1` en rouge, la technologie s'affichant d'elle-même en sous-libellé.

**Et rien d'autre n'est dessiné.** Un lien inchangé n'apparaît pas, non plus que les groupes qu'aucun trait n'accoste. Mêler le décor aux quelques traits qui portent l'information les noyait : le schéma d'écart n'est pas un paysage annoté, c'est une carte des changements. Le relevé au-dessus donne le détail nominatif, le schéma dit où ça se passe.

Le schéma s'exporte en SVG et en PNG comme les autres, sous un nom qui porte **les deux paliers** de la comparaison — sans quoi deux écarts différents se téléchargeraient sous le même nom.

Le schéma est dessiné sur la base **plateforme détaillée** : on veut savoir quel composant a gagné ou perdu un flux, pas seulement quel groupe, tout en gardant l'extérieur replié. La frontière de la plateforme étant un nœud parent qu'aucun trait n'accoste, l'élagage la rétablit quand elle contient encore de quoi cadrer, et coupe le lien de parenté sinon — sous deux composants, un cadre n'apporte rien, comme partout ailleurs.

Le schéma porte un **titre** qui nomme les deux paliers comparés et l'échelle du dessin — les soldes signés se lisent seuls, mais rien n'indiquerait sans lui *quels* paliers sont comparés.

Sa **légende dessinée** n'énumère plus les technologies : sur un schéma d'écart aucun trait n'en porte la couleur, tous étant verts ou rouges, et les annoncer promettait un code couleur introuvable sur le dessin. Elle liste à la place le sens du vert et du rouge, et garde les périmètres, qui eux valent toujours. La règle est déduite des traits présents plutôt que d'un drapeau : **une légende n'annonce que les couleurs réellement employées**. Étant dans le SVG, elle voyage avec l'export.

## 7. Les contrôles

C'est ce qui sépare cet axe d'un journal déclaratif : le classeur ne peut pas se contredire en silence.

### 7.1 Deux familles, dont une seule suit le palier

**Indépendants du palier** — structure du fichier, références inconnues, vocabulaires, et les contrôles temporels ci-dessous. Ils portent sur le classeur, pas sur un instant de son histoire.

**Dépendants du palier** — cohérence et complétude : « interface sans consommation », « acteur sans aucun flux », « criticité manquante », « description vide ». Ils s'évaluent **au palier affiché**.

Cette distinction n'est pas un raffinement : sans elle, l'axe se saborde. Un acteur retiré au palier 2 n'a évidemment plus de flux au palier 3, et le rapport se remplirait d'anomalies fausses dès la première ligne retirée — plus les paliers seraient utilisés, moins le rapport serait crédible.

Le compteur du rail suit donc le palier affiché, et le rapport dit sur quel palier il porte.

### 7.2 Les contrôles temporels

- Interface exposée à un palier où son acteur exposant n'existe pas encore, ou plus.
- Consommation à un palier où le consommateur, ou l'interface, n'est pas vivant.
- `Palier de retrait` de rang inférieur ou égal au `Palier d'introduction`.

Les emboîtements sont jugés **borne par borne, et seulement sur ce qui a été saisi** : une arrivée absente est déjà réclamée par §7.4, la signaler ici en plus dirait deux fois la même case vide sous deux formes. Le contrôle « acteur retiré qui porte encore des flux » n'a pas d'existence propre : vu de l'autre bout, c'est « interface vivant hors de la période de son exposant », donc une seule implémentation.
- Palier cité par une ligne mais absent de l'onglet `Paliers`.
- Rangs en double dans `Paliers`.
- Aucun palier `Livré` : le palier courant est alors indéterminé.

## 8. Ce qui n'est pas couvert

L'axe trace **l'existence**, pas les **attributs**. Qu'une interface apparaisse au palier 2 et disparaisse au palier 4 se voit ; qu'on ait changé sa description, son contrat ou sa criticité entre les deux ne se voit pas.

**Décision (17 août 2026)** : hors périmètre pour l'instant. Le jour où le besoin se précise, un onglet `Changements` s'ajoutera **à côté** de cet axe et non à sa place — les deux se composent, puisque l'un se calcule et l'autre se saisit. Rien de ce qui est décrit ici n'aura à être réécrit.

## 9. Risques

**Une deuxième mise à niveau forcée**, pour des utilisateurs qui viennent d'en subir une, et celle-ci change leur façon de saisir : elle leur retire des colonnes qu'ils remplissaient. Ça ne se livre pas comme un correctif — il faut prévenir, et sans doute accompagner.

**L'adoption fait ou défait le mécanisme.** Deux colonnes par ligne ne coûtent rien si quelqu'un les tient, et ne valent rien si personne ne les remplit. Le risque n'est pas de mal construire l'axe, c'est de remplacer trois mécanismes réellement tenus par un mécanisme vide. Ce point relève d'une décision d'équipe, pas d'un choix technique — il conditionne l'intérêt de tout le reste.

**Le classeur devient append-only.** Rien n'est jamais supprimé, seulement daté d'un retrait. Les onglets grossissent avec le temps ; c'est le prix de l'historique dans un fichier unique, et il faudra un jour se demander à partir de quel volume ça gêne.

## 10. Tests

- lecture de l'onglet `Paliers`, du rang, du statut ; détermination du palier courant ;
- vivacité d'une ligne à un palier donné, y compris colonnes vides aux deux bouts ;
- dérivation d'un groupe depuis ses acteurs vivants ;
- chacun des sept contrôles de §7 ;
- la vue « Changements » : ajouts et retraits sur les trois natures d'objet ;
- rendu de chaque vue existante à un palier choisi ;
- conversion v1 → v2 : chaque règle de §5.1, et le trajet complet v0 → v2 ;
- vérification dans Excel du classeur produit, listes déroulantes de paliers comprises.
