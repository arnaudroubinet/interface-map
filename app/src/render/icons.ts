// Catalogue d'icônes, isolé du rendu : les contrôles d'intégrité doivent citer
// les noms valides sans dépendre du module qui dessine.
export interface IconeElem {
  tag: "path" | "rect" | "circle" | "line" | "polyline" | "ellipse";
  attrs: Record<string, string>;
}

// Catalogue Lucide embarqué (https://lucide.dev, licence ISC), tracés repris
// tels quels. Le livrable est un HTML autonome hors ligne : on ne peut pas
// aller chercher une icône par son nom sur un CDN, donc le catalogue est fini.
// Ce qui vient du classeur, c'est le CHOIX -- quel type d'acteur porte quelle
// icône -- et non le dessin.
export const ICONES: Record<string, IconeElem[]> = {
  "app-window": [
      { tag: "rect", attrs: { x: "2", y: "4", width: "20", height: "16", rx: "2" } },
      { tag: "path", attrs: { d: "M10 4v4" } },
      { tag: "path", attrs: { d: "M2 8h20" } },
      { tag: "path", attrs: { d: "M6 4v4" } },
  ],
  "cog": [
      { tag: "path", attrs: { d: "M11 10.27 7 3.34" } },
      { tag: "path", attrs: { d: "m11 13.73-4 6.93" } },
      { tag: "path", attrs: { d: "M12 22v-2" } },
      { tag: "path", attrs: { d: "M12 2v2" } },
      { tag: "path", attrs: { d: "M14 12h8" } },
      { tag: "path", attrs: { d: "m17 20.66-1-1.73" } },
      { tag: "path", attrs: { d: "m17 3.34-1 1.73" } },
      { tag: "path", attrs: { d: "M2 12h2" } },
      { tag: "path", attrs: { d: "m20.66 17-1.73-1" } },
      { tag: "path", attrs: { d: "m20.66 7-1.73 1" } },
      { tag: "path", attrs: { d: "m3.34 17 1.73-1" } },
      { tag: "path", attrs: { d: "m3.34 7 1.73 1" } },
      { tag: "circle", attrs: { cx: "12", cy: "12", r: "2" } },
      { tag: "circle", attrs: { cx: "12", cy: "12", r: "8" } },
  ],
  "server": [
      { tag: "rect", attrs: { width: "20", height: "8", x: "2", y: "2", rx: "2", ry: "2" } },
      { tag: "rect", attrs: { width: "20", height: "8", x: "2", y: "14", rx: "2", ry: "2" } },
      { tag: "line", attrs: {  } },
      { tag: "line", attrs: {  } },
  ],
  "handshake": [
      { tag: "path", attrs: { d: "m11 17 2 2a1 1 0 1 0 3-3" } },
      { tag: "path", attrs: { d: "m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4" } },
      { tag: "path", attrs: { d: "m21 3 1 11h-2" } },
      { tag: "path", attrs: { d: "M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3" } },
      { tag: "path", attrs: { d: "M3 4h8" } },
  ],
  "layers": [
      { tag: "path", attrs: { d: "M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z" } },
      { tag: "path", attrs: { d: "M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12" } },
      { tag: "path", attrs: { d: "M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17" } },
  ],
  "package": [
      { tag: "path", attrs: { d: "M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z" } },
      { tag: "path", attrs: { d: "M12 22V12" } },
      { tag: "polyline", attrs: { points: "3.29 7 12 12 20.71 7" } },
      { tag: "path", attrs: { d: "m7.5 4.27 9 5.15" } },
  ],
  "user": [
      { tag: "path", attrs: { d: "M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" } },
      { tag: "circle", attrs: { cx: "12", cy: "7", r: "4" } },
  ],
  "users": [
      { tag: "path", attrs: { d: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" } },
      { tag: "path", attrs: { d: "M16 3.128a4 4 0 0 1 0 7.744" } },
      { tag: "path", attrs: { d: "M22 21v-2a4 4 0 0 0-3-3.87" } },
      { tag: "circle", attrs: { cx: "9", cy: "7", r: "4" } },
  ],
  "database": [
      { tag: "ellipse", attrs: { cx: "12", cy: "5", rx: "9", ry: "3" } },
      { tag: "path", attrs: { d: "M3 5V19A9 3 0 0 0 21 19V5" } },
      { tag: "path", attrs: { d: "M3 12A9 3 0 0 0 21 12" } },
  ],
  "cloud": [
      { tag: "path", attrs: { d: "M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" } },
  ],
  "globe": [
      { tag: "circle", attrs: { cx: "12", cy: "12", r: "10" } },
      { tag: "path", attrs: { d: "M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" } },
      { tag: "path", attrs: { d: "M2 12h20" } },
  ],
  "monitor": [
      { tag: "rect", attrs: { width: "20", height: "14", x: "2", y: "3", rx: "2" } },
      { tag: "line", attrs: {  } },
      { tag: "line", attrs: {  } },
  ],
  "smartphone": [
      { tag: "rect", attrs: { width: "14", height: "20", x: "5", y: "2", rx: "2", ry: "2" } },
      { tag: "path", attrs: { d: "M12 18h.01" } },
  ],
  "file-text": [
      { tag: "path", attrs: { d: "M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" } },
      { tag: "path", attrs: { d: "M14 2v5a1 1 0 0 0 1 1h5" } },
      { tag: "path", attrs: { d: "M10 9H8" } },
      { tag: "path", attrs: { d: "M16 13H8" } },
      { tag: "path", attrs: { d: "M16 17H8" } },
  ],
  "shield": [
      { tag: "path", attrs: { d: "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" } },
  ],
  "workflow": [
      { tag: "rect", attrs: { width: "8", height: "8", x: "3", y: "3", rx: "2" } },
      { tag: "path", attrs: { d: "M7 11v4a2 2 0 0 0 2 2h4" } },
      { tag: "rect", attrs: { width: "8", height: "8", x: "13", y: "13", rx: "2" } },
  ],
  "box": [
      { tag: "path", attrs: { d: "M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" } },
      { tag: "path", attrs: { d: "m3.3 7 8.7 5 8.7-5" } },
      { tag: "path", attrs: { d: "M12 22V12" } },
  ],
  "terminal": [
      { tag: "path", attrs: { d: "M12 19h8" } },
      { tag: "path", attrs: { d: "m4 17 6-6-6-6" } },
  ],
  "mail": [
      { tag: "path", attrs: { d: "m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7" } },
      { tag: "rect", attrs: { x: "2", y: "4", width: "20", height: "16", rx: "2" } },
  ],
  "printer": [
      { tag: "path", attrs: { d: "M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" } },
      { tag: "path", attrs: { d: "M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6" } },
      { tag: "rect", attrs: { x: "6", y: "14", width: "12", height: "8", rx: "1" } },
  ],
  "building-2": [
      { tag: "path", attrs: { d: "M10 12h4" } },
      { tag: "path", attrs: { d: "M10 8h4" } },
      { tag: "path", attrs: { d: "M14 21v-3a2 2 0 0 0-4 0v3" } },
      { tag: "path", attrs: { d: "M6 10H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-2" } },
      { tag: "path", attrs: { d: "M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16" } },
  ],
  "key": [
      { tag: "path", attrs: { d: "m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4" } },
      { tag: "path", attrs: { d: "m21 2-9.6 9.6" } },
      { tag: "circle", attrs: { cx: "7.5", cy: "15.5", r: "5.5" } },
  ],
  "network": [
      { tag: "rect", attrs: { x: "16", y: "16", width: "6", height: "6", rx: "1" } },
      { tag: "rect", attrs: { x: "2", y: "16", width: "6", height: "6", rx: "1" } },
      { tag: "rect", attrs: { x: "9", y: "2", width: "6", height: "6", rx: "1" } },
      { tag: "path", attrs: { d: "M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3" } },
      { tag: "path", attrs: { d: "M12 12V8" } },
  ],
  "hard-drive": [
      { tag: "path", attrs: { d: "M10 16h.01" } },
      { tag: "path", attrs: { d: "M2.212 11.577a2 2 0 0 0-.212.896V18a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-5.527a2 2 0 0 0-.212-.896L18.55 5.11A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" } },
      { tag: "path", attrs: { d: "M21.946 12.013H2.054" } },
      { tag: "path", attrs: { d: "M6 16h.01" } },
  ],
  "bot": [
      { tag: "path", attrs: { d: "M12 8V4H8" } },
      { tag: "rect", attrs: { width: "16", height: "12", x: "4", y: "8", rx: "2" } },
      { tag: "path", attrs: { d: "M2 14h2" } },
      { tag: "path", attrs: { d: "M20 14h2" } },
      { tag: "path", attrs: { d: "M15 13v2" } },
      { tag: "path", attrs: { d: "M9 13v2" } },
  ],
};

// Les noms utilisables dans la colonne « Icône » de l'onglet TypesActeur.
// Exposé pour que les contrôles d'intégrité puissent citer la liste au lieu de
// se contenter de dire « inconnu ».
export const ICONES_DISPONIBLES: string[] = Object.keys(ICONES).sort();

// Approximation en emoji de chaque icône, pour que la colonne « Icône » du
// classeur se lise dans Excel. Ce n'est PAS l'icône dessinée -- celle-ci est
// vectorielle et vit dans le schéma ; c'est un repère visuel pour choisir un
// nom sans avoir à l'essayer. Excel ne sait pas afficher nos tracés SVG, et
// SheetJS n'écrit ni image ni forme.
export const APERCU_ICONES: Record<string, string> = {
  "app-window": "🪟",
  bot: "🤖",
  box: "🧰",
  "building-2": "🏢",
  cloud: "☁️",
  cog: "⚙️",
  database: "🗃️",
  "file-text": "📄",
  globe: "🌐",
  handshake: "🤝",
  "hard-drive": "💽",
  key: "🔑",
  layers: "🗂️",
  mail: "✉️",
  monitor: "🖥️",
  network: "🕸️",
  package: "📦",
  printer: "🖨️",
  server: "🗄️",
  shield: "🛡️",
  smartphone: "📱",
  terminal: "⌨️",
  user: "👤",
  users: "👥",
  workflow: "🔀",
};

// Repli quand le classeur ne dit rien : un jeton neutre, qui ne prétend pas
// connaître la nature de l'acteur.
export const ICONE_PAR_DEFAUT = "layers";
