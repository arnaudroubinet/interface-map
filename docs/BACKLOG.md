# Ce qui reste à faire

Ce fichier existe parce qu'une décision a été prise le 18 août 2026 — sourcer le
référentiel externe par Power Query — et n'est jamais entrée dans une file de
travail. Elle a été retrouvée quatre jours plus tard, par hasard.

**Règle : toute décision prise et non exécutée dans la foulée s'écrit ici,
le jour où elle est prise.** Un accord en conversation n'est pas une trace.

Chaque entrée dit ce qui a été décidé, quand, et ce qui manque pour l'exécuter.
On raye en supprimant la ligne, jamais en la cochant : une liste qui garde ses
cases cochées cesse d'être lue.

---

## Décidé, pas encore construit

### Référentiel externe chargé par Power Query

**Décidé le 18 août 2026.** Le classeur source ses acteurs — et plus tard ses
technologies, avec leur couleur — depuis un référentiel externe, chargé par une
requête Power Query.

Ce qui a été arrêté :

- **L'URL est une propriété du CLASSEUR, pas de l'outil.** Elle vit dans la
  définition de la requête, voyage avec le fichier, et chaque cartographie peut
  donc viser un référentiel différent. Un fichier pivot centralisateur a été
  écarté pour cette raison précise : il rendrait impossible de changer de
  référentiel pour un seul classeur, ce qui est justement la fonctionnalité
  demandée.
- **Le geste** : on dépose le classeur, la page affiche l'URL qu'il porte déjà,
  on la garde ou on la remplace.
- **L'outil ne va rien chercher sur le réseau.** Il écrit la définition de la
  requête ; Excel fait le chargement.
- **La migration doit reposer la requête** quand elle est absente du fichier
  qu'elle convertit, sans quoi chaque changement de schéma l'effacerait.

Ce qui manque :

- Une spec. Elle n'a jamais été écrite, et c'est par là que le sujet s'est perdu.
- Le périmètre exact : les acteurs seuls d'abord, ou acteurs + technologies.
- Une décision sur la fabrication de la partie `customXml/item*.xml` : le flux
  binaire **DataMashup**, spécifié par Microsoft sous **MS-QDEFF**. Deux
  implémentations libres existent — [excel-datamashup](https://github.com/Vladinator/excel-datamashup)
  (TypeScript) et les [Data Mashup Cmdlets](https://bengribaudo.com/tools/datamashupcmdlets),
  le format étant [documenté ici](https://bengribaudo.com/blog/2020/04/22/5198/data-mashup-binary-stream).
  Une dépendance pèse sur un livrable mono-fichier de 2,2 Mo ; l'écrire nous-mêmes
  est faisable mais demande une vérification dans le vrai Excel.
- Il faudra aussi `xl/connections.xml` et un tableau de destination sur un onglet
  masqué — notre couche OOXML sait déjà poser des tableaux et des plages nommées.

Point de fait relevé à l'époque : le classeur `.xlsm` d'origine contenait **déjà**
deux requêtes, `TblActeur` et `TblTypesActeur`. Le mécanisme avait donc été monté
une fois, dans le format à macro, avant d'être perdu avec lui.

### Nom du fichier produit par le build

`npm run build` écrit toujours `app/dist/carte-des-interfaces.html`. Tout le
reste du dépôt — code, commentaires, tests, interface — est passé en anglais ;
ce nom est le dernier mot français que l'utilisateur voit, et c'est celui du
livrable qu'on s'échange. Le renommer (`interface-map.html`) change le nom du
fichier que les gens ont déjà en pièce jointe et en favori : la décision revient
à celui qui le diffuse, elle n'est pas technique.

---

## Non reproduit, à éclaircir

### Téléchargement du classeur d'exemple et du modèle

**Signalé le 22 août 2026.** Rien trouvé côté application ni côté fichier :
les deux blobs se créent (196 Ko et 82 Ko), l'ancre porte le bon nom, elle est
attachée au DOM avant le clic, aucune erreur n'est levée, et le `.xlsx` produit
est un zip valide dont toutes les parties sont déclarées.

Deux pistes non tranchées, faute d'avoir pu observer le symptôme :

- Chrome bloque les téléchargements automatiques répétés depuis une même origine.
  Le premier passe, les suivants sont bloqués en silence — ce qui collerait avec
  « je n'arrive **plus** à télécharger ».
- L'extension de pilotage du navigateur bloque les téléchargements qu'une page
  déclenche elle-même. Si le symptôme n'apparaît que dans l'onglet piloté, le
  blocage vient de l'outillage de vérification, pas du produit.

---

## Écarté, et pourquoi

On garde trace des refus : sans ça, la même idée revient tous les deux mois.

- **Vue isométrique façon isoflow.** Analysée le 22 août 2026, écartée : la
  projection n'aide pas à LIRE une cartographie, seulement à la montrer. Nos
  boîtes portent du texte, ce que les leurs ne font pas, et `elk.direction`
  est un axe de lecture qu'une rotation détruit. Voir
  `.superpowers/notes/rapport-isoflow-3d.md`.
- **Navigation clavier complète dans le SVG.** Écartée explicitement par
  l'utilisateur.
- **Réglages ELK pour le rapport de forme.** Quatre leviers mesurés le 22 août
  2026, aucun retenu : `aspectRatio` est déjà à 1.6 et sans effet sur un graphe
  connexe, `wrapping` échange 2 croisements contre 5 pour 36 % de surface en
  plus, `nodePromotion` ne change rien, et `postCompaction` fait lever ELK sur un
  multigraphe. Le levier qui reste est le zoom.
- **Mode interactif d'ELK pour la stabilité entre paliers.** Implémenté puis
  retiré le 22 août 2026 : sur une planche à frontière il ne reproduit même pas
  son propre résultat (277 px de médiane sur une entrée identique). Remplacé par
  le placement sur l'union des paliers, qui donne 0 px.
