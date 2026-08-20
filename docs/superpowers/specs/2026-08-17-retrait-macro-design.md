# Retrait de la macro VBA, et la réparation d'un classeur

> **Correctif du 18 août 2026 — schéma v2.** La traduction a renommé l'onglet `Listes` en `Lists` mais a laissé trois formules citer l'ancien nom. Excel n'y voyait pas une faute : il en déduisait un renvoi vers un AUTRE CLASSEUR, d'où l'avertissement « liaisons avec une ou plusieurs sources externes » à chaque ouverture, et des listes déroulantes dépendantes qui ne se remplissaient jamais. Le v1 était déjà en production : le schéma passe donc en **v2** pour que les classeurs distribués soient reconnus comme périmés et repassent par la reconstruction. L'étape `1 → 2` ne transforme rien dans le modèle — les formules naissent à l'écriture ; l'onglet `Milestones` y gagne au passage le tableau structuré qui lui manquait.
Spécification · 17 août 2026

Retire §12 de la spécification de référence.

---

## 1. Pourquoi

La macro `GenererOngletsManquants` créait les onglets `FX_` absents en dupliquant un gabarit. **Elle n'est pas compatible avec la synchronisation SharePoint**, ce qui la rend inutilisable là où le classeur vit réellement.

Rien ne la remplace. Les pistes examinées et écartées :

- **Office Scripts.** Fonctionne en `.xlsx` sur Excel web, Windows et Mac, et supporte les boutons dans la feuille. Mais un script vit dans le OneDrive de son auteur et n'entre jamais dans le classeur : il faudrait l'attacher à la main à chaque classeur produit, y compris après chaque mise à niveau, et tout dépendrait ensuite du OneDrive d'une personne nommée. Aucun moyen documenté ne permet à l'outil de créer cette association.
- **Fusionner les onglets `FX_` en une feuille unique.** Supprimait le besoin, mais la répartition par onglet est voulue.

## 2. Ce qui remplace la macro

**Rien à générer depuis Excel.** L'outil crée lui-même tout onglet attendu par une interface, y compris pour une interface qui n'a encore aucune consommation — l'onglet est alors créé vide, avec ses en-têtes et ses listes déroulantes.

Deux cas, deux réponses :

- **En masse** — après une conversion, une mise à niveau, ou quand plusieurs onglets manquent : on passe le classeur par la réparation (§3), qui rend un fichier complet.
- **À l'unité** — une interface déclarée avec un couple (exposant, technologie) inédit : le contrôle d'intégrité nomme l'onglet attendu au caractère près, et il se crée à la main en quelques secondes. C'est un événement rare : il faut qu'un composant se mette à exposer une technologie qu'il n'exposait pas.

## 3. La réparation : une porte unique

La boîte de dialogue du rail, « Repair or upgrade a workbook », devient l'entrée unique pour remettre un classeur en état. On lui donne un fichier, elle en rend un.

L'aiguillage se fait sur **ce que le parseur sait lire**, et non sur le nom des feuilles — c'est exactement la question qui compte :

| Ce qu'on dépose | Ce qui se passe |
|---|---|
| Classeur au format d'origine (`Flux` / `Composants`) | conversion, avec le rapport de ce qui a été inféré faute d'information |
| Classeur de notre famille, schéma antérieur | mise à niveau par la chaîne d'étapes |
| Classeur à jour, mais des onglets manquants | onglets créés, rien d'autre |

Dans les trois cas, le fichier rendu porte le schéma courant et tous ses onglets. Le classeur d'origine n'est jamais modifié : c'est un fichier neuf, à remplacer sur SharePoint — le geste habituel de toute migration.

## 4. Conséquences

- Les classeurs produits deviennent des **`.xlsx`** : plus de code, donc plus de format macro ni de bandeau de sécurité à l'ouverture.
- L'onglet gabarit `FX_Modèle` disparaît. Il reste ignoré à la lecture, pour les classeurs qui le portent encore.
- Le binaire VBA embarqué (105 Ko de base64) et son module d'injection disparaissent du livrable.
- Le préfixe `Tbl` des tableaux structurés n'a plus de contrat à honorer ; il reste par cohérence de nommage.
