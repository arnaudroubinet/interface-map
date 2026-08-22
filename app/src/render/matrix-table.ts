import type { MatrixResult } from "../aggregation/views";
import { cellLabel } from "../aggregation/core";

// Le tableau reçu est définitif : buildMatrixView a déjà retiré les lignes et
// colonnes sans lien. On dessine ce qu'on nous donne, rien de plus.
export function buildMatrixTable(
  matrix: MatrixResult,
  colorFor: (tech: string) => string,
  // Le même titre que le cartouche des schémas : un tableau collé dans un
  // document ne disait ni son classeur, ni son palier, ni sa lecture.
  title?: string
): HTMLTableElement {
  const table = document.createElement("table");
  table.className = "matrix";

  if (title) {
    const legend = document.createElement("caption");
    legend.textContent = title;
    table.appendChild(legend);
  }

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  const coin = document.createElement("th");
  coin.className = "matrix-corner";
  coin.textContent = "From ↓ / To →";
  headRow.appendChild(coin);
  for (const actor of matrix.columns) {
    const th = document.createElement("th");
    // `scope` dit à un lecteur d'écran de quelle case cet en-tête est le titre.
    // Sans lui, une matrix de 143 cases se lit comme 143 nombres sans adresse.
    th.setAttribute("scope", "col");
    // Le libellé vit dans un span : c'est LUI qui bascule à la verticale, pas
    // la cellule. La cellule reste en écriture horizontale, donc elle se
    // dimensionne toute seule sur le plus long nom et centre son contenu --
    // avec une hauteur fixe, les noms longs débordaient et étaient rognés.
    const label = document.createElement("span");
    label.className = "matrix-header";
    label.textContent = actor;
    th.appendChild(label);
    headRow.appendChild(th);
  }
  const totalCol = document.createElement("th");
  totalCol.setAttribute("scope", "col");
  totalCol.className = "matrix-total";
  totalCol.appendChild(Object.assign(document.createElement("span"), { className: "matrix-header", textContent: "Total out" }));
  headRow.appendChild(totalCol);
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  for (const row of matrix.rows) {
    const tr = document.createElement("tr");
    const th = document.createElement("th");
    th.className = "matrix-actor";
    th.setAttribute("scope", "row");
    th.textContent = row.actor;
    tr.appendChild(th);

    for (const arrivee of matrix.columns) {
      const td = document.createElement("td");
      for (const cell of row.cellules.get(arrivee) ?? []) {
        const span = document.createElement("span");
        span.className = "matrix-tech";
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
        if (cell.technology.trim()) {
          const pastille = document.createElement("span");
          pastille.className = "matrix-dot";
          pastille.style.backgroundColor = colorFor(cell.technology);
          span.appendChild(pastille);
        }
        span.appendChild(document.createTextNode(cellLabel(cell.technology, cell.count, cell.names)));
        // La liste entière au hover : l'étiquette n'en nomme que les premiers.
        if (cell.names.length > 0) span.title = cell.names.join("\n");
        if (cell.attenuated) {
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
    total.className = "matrix-total";
    total.textContent = String(matrix.totauxLigne.get(row.actor) ?? 0);
    tr.appendChild(total);
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);

  const pied = document.createElement("tfoot");
  const trPied = document.createElement("tr");
  const coinPied = document.createElement("th");
  coinPied.setAttribute("scope", "row");
  coinPied.className = "matrix-total";
  coinPied.textContent = "Total in";
  trPied.appendChild(coinPied);
  for (const column of matrix.columns) {
    const td = document.createElement("td");
    td.className = "matrix-total";
    td.textContent = String(matrix.totauxColonne.get(column) ?? 0);
    trPied.appendChild(td);
  }
  trPied.appendChild(document.createElement("td"));
  pied.appendChild(trPied);
  table.appendChild(pied);

  return table;
}
