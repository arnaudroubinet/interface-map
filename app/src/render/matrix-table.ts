import type { MatrixResult } from "../aggregation/views";
import { libelleCellule } from "../aggregation/core";

// Le tableau reçu est définitif : buildMatrixView a déjà retiré les lignes et
// colonnes sans lien. On dessine ce qu'on nous donne, rien de plus.
export function buildMatrixTable(
  matrix: MatrixResult,
  colorFor: (tech: string) => string,
  // Le même titre que le cartouche des schémas : un tableau collé dans un
  // document ne disait ni son classeur, ni son palier, ni sa lecture.
  titre?: string
): HTMLTableElement {
  const table = document.createElement("table");
  table.className = "matrice";

  if (titre) {
    const légende = document.createElement("caption");
    légende.textContent = titre;
    table.appendChild(légende);
  }

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  const coin = document.createElement("th");
  coin.className = "matrice-coin";
  coin.textContent = "From ↓ / To →";
  headRow.appendChild(coin);
  for (const acteur of matrix.colonnes) {
    const th = document.createElement("th");
    // `scope` dit à un lecteur d'écran de quelle case cet en-tête est le titre.
    // Sans lui, une matrice de 143 cases se lit comme 143 nombres sans adresse.
    th.setAttribute("scope", "col");
    // Le libellé vit dans un span : c'est LUI qui bascule à la verticale, pas
    // la cellule. La cellule reste en écriture horizontale, donc elle se
    // dimensionne toute seule sur le plus long nom et centre son contenu --
    // avec une hauteur fixe, les noms longs débordaient et étaient rognés.
    const libellé = document.createElement("span");
    libellé.className = "matrice-entete";
    libellé.textContent = acteur;
    th.appendChild(libellé);
    headRow.appendChild(th);
  }
  const totalCol = document.createElement("th");
  totalCol.setAttribute("scope", "col");
  totalCol.className = "matrice-total";
  totalCol.appendChild(Object.assign(document.createElement("span"), { className: "matrice-entete", textContent: "Total out" }));
  headRow.appendChild(totalCol);
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  for (const ligne of matrix.lignes) {
    const tr = document.createElement("tr");
    const th = document.createElement("th");
    th.className = "matrice-acteur";
    th.setAttribute("scope", "row");
    th.textContent = ligne.acteur;
    tr.appendChild(th);

    for (const arrivee of matrix.colonnes) {
      const td = document.createElement("td");
      for (const cell of ligne.cellules.get(arrivee) ?? []) {
        const span = document.createElement("span");
        span.className = "matrice-techno";
        // La couleur va sur une pastille, jamais sur le texte. Elle vient du
        // référentiel, en hexadécimal libre : une charte d'entreprise est
        // réglée pour l'impression et les fonds clairs, et quatre couleurs sur
        // cinq y passent sous le seuil de contraste dès qu'on lit en thème
        // sombre. Portée par le texte, une couleur illisible rendait la donnée
        // illisible ; portée par une pastille, elle reste le rappel qu'elle a
        // toujours été et le libellé garde l'encre du thème.
        //
        // Pas de pastille sans technologie : la lecture fonctionnelle la vide,
        // et une pastille vide ne rappellerait rien.
        if (cell.technologie.trim()) {
          const pastille = document.createElement("span");
          pastille.className = "matrice-pastille";
          pastille.style.backgroundColor = colorFor(cell.technologie);
          span.appendChild(pastille);
        }
        span.appendChild(document.createTextNode(libelleCellule(cell.technologie, cell.count, cell.noms)));
        // La liste entière au survol : l'étiquette n'en nomme que les premiers.
        if (cell.noms.length > 0) span.title = cell.noms.join("\n");
        if (cell.atténué) {
          span.dataset.attenue = "true";
          span.style.opacity = "0.5";
        }
        td.appendChild(span);
      }
      tr.appendChild(td);
    }
    // La marge de la ligne : combien de flux en partent. Sans elle, désigner
    // le moyeu demandait de compter les cases à l'œil.
    const total = document.createElement("td");
    total.className = "matrice-total";
    total.textContent = String(matrix.totauxLigne.get(ligne.acteur) ?? 0);
    tr.appendChild(total);
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);

  const pied = document.createElement("tfoot");
  const trPied = document.createElement("tr");
  const coinPied = document.createElement("th");
  coinPied.setAttribute("scope", "row");
  coinPied.className = "matrice-total";
  coinPied.textContent = "Total in";
  trPied.appendChild(coinPied);
  for (const colonne of matrix.colonnes) {
    const td = document.createElement("td");
    td.className = "matrice-total";
    td.textContent = String(matrix.totauxColonne.get(colonne) ?? 0);
    trPied.appendChild(td);
  }
  trPied.appendChild(document.createElement("td"));
  pied.appendChild(trPied);
  table.appendChild(pied);

  return table;
}
