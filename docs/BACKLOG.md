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

*Rien en attente.* Le référentiel externe Power Query, dernière entrée de cette
section, a été livré le 23 août 2026 — spec, implémentation, vérification dans le
vrai Excel et chargement de bout en bout depuis un référentiel servi en HTTP.

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

  **Revu le 28 août 2026, et partiellement repris — comme rendu, jamais comme
  lecture.** Le démontage de fossflow (fork MIT d'isoflow) a montré que son
  moteur tient en trois formules et des icônes déjà dessinées ; le peintre est
  donc à nous (`render/iso-view.ts`, SVG pur, zéro React), ce qui fait tomber
  l'objection du texte : nos boîtes le gardent, pointes d'initiative comprises.
  L'objection de l'axe de lecture tient toujours : c'est une option de rendu
  décochée par défaut, pas une vue, et la translation qui l'alimente est celle
  de l'export FossFLOW (`export/fossflow-json.ts`), validée contre le schéma
  zod de fossflow lui-même.

  **Lisibilité, 28 août 2026** — trois leviers tirés de la littérature
  (Purchase sur les croisements, dessins confluents, cartes APM) : troncs par
  (cible, technologie) à voie et pointe uniques, ordre des voies + passe
  d'échanges anti-croisements, surbrillance au survol (CSS `:has` embarqué
  dans le SVG). Gardés en réserve si une planche résiste un jour : recuit
  simulé seedé pour les étiquettes (Christensen/Marks/Shieber), étiquetage en
  marge à amorces (*boundary labeling*), MIP octilinéaire façon cartes de
  métro (Nöllenburg & Wolff) — optimal mais minutes de calcul.

  **Croisements, 2 septembre 2026** — l'objectif est devenu le nombre
  **exact** d'intersections des polylignes telles que dessinées (bouts cachés
  sous les icônes exclus), et trois recherches le minimisent jusqu'à point
  fixe : arrachage et re-routage de chaque route contre toutes les autres
  (*rip-up and reroute*, la méthode des routeurs VLSI), ordre des voies par
  couloir par énumération des permutations (≤ 6 troncs), et permutation des
  sièges des acteurs les plus impliqués, chaque candidat jugé par un routage
  rapide puis confirmé par le routage complet. Mesuré sur la planche dense de
  l'exemple (25 flux) : 19 → 8 croisements, rendu en 1,3 s. Le problème est
  NP-difficile : « aussi peu que la recherche en trouve », pas une preuve.
  **Recuit, 2 septembre 2026** — le levier suivant est construit
  (`render/iso-anneal.ts`) : recuit simulé seedé sur le placement complet
  (permutation de sièges, déplacement vers une tuile libre, espacement et
  murs respectés), objectif = croisements routés + fil, budget en itérations
  (pas en secondes : même planche, même résultat sur toute machine), exécuté
  par tranches sur le fil principal après l'affichage — la planche se
  redessine si mieux est trouvé, et le résultat est mémorisé par planche.
  Le routage rapide est passé sous A* (3 ms sur la planche dense) pour payer
  le millier d'évaluations. Mesuré : Platform detail 8 → 5, Platform only
  2 → 0, en 2 à 4 s de fond.
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
