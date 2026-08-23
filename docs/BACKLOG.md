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

**Décidé le 18 août 2026. Spec écrite le 22 août 2026 :**
`docs/superpowers/specs/2026-08-22-referentiel-externe-design.md`.

Périmètre arrêté le 22 août : **acteurs et technologies, chacun son onglet.**

La question qui bloquait — fabriquer le flux **DataMashup** (MS-QDEFF) hors
d'Excel — est tranchée **par l'expérience, pas par le raisonnement** : un fichier
fabriqué de zéro s'ouvre, liste ses deux requêtes et les évalue. Aucune
dépendance n'est nécessaire ; `excel-datamashup` et les Data Mashup Cmdlets sont
écartés. Les blocages réels n'étaient ni les Permission Bindings ni la
cryptographie, mais trois conventions d'écriture : `customXml/item1.xml` en
UTF-16 avec BOM, les XML internes sans l'espace de noms `DataMashup` par défaut,
et un contenu de métadonnées qui doit être un zip **vide** plutôt qu'absent.
Détail complet en §6 de la spec.

Deux conclusions annoncées ce jour-là et retirées ensuite, à ne pas ressortir :
« une dépendance coûte moins cher que l'écrire » (avancé sans mesure) et « le
test répond non » (avancé sans avoir éliminé les autres causes).

Ce qui reste ouvert, listé en §11 de la spec : zip interne stocké ou compressé,
et CSV plutôt que classeur comme format du référentiel.

---

### Traduction anglaise : reste-t-il des identifiants français ailleurs ?

**Constaté le 23 août 2026.** En finissant la traduction de
`app/src/export/xlsx-tables.ts`, aucun balayage du reste de `app/src` n'a été
fait pour savoir si d'autres fichiers gardent des identifiants français hérités
de la traduction. Cosmétique, ne bloque rien.

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
