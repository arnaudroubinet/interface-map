import {
  VOCABULAIRE_CRITICITE,
  VOCABULAIRE_DECISION,
  VOCABULAIRE_DIRECTION,
  VOCABULAIRE_NATURE,
  VOCABULAIRE_PERIMETRE,
} from "../aggregation/vocabulaires";
import { ICONES_DISPONIBLES, APERCU_ICONES } from "../render/icones";

// Ce que le classeur produit contient AVANT toute saisie : ses vocabulaires,
// ses icônes, ses seize technologies, et le mode d'emploi que porte son premier
// onglet.
//
// Ce sont des données, pas de la machinerie. Elles vivaient au milieu du module
// qui assemble le classeur et ses formules Excel, si bien que corriger une
// faute dans le mode d'emploi obligeait à ouvrir le fichier le plus technique
// du projet. Les séparer ne change rien à ce qui est écrit dans le classeur :
// c'est le même contenu, rangé là où on le cherche.

// Valeurs de référence du domaine. Ce sont elles qu'on recopie dans les
// colonnes du classeur ; l'outil ne les impose pas, il les propose.
// Les types d'acteur ne figurent PAS ici : ils sont désormais énumérés par
// l'onglet TypesActeur, qui fait foi. Les avoir aux deux endroits aurait laissé
// deux vérités concurrentes sur la même question.
export const LISTES: Record<string, string[]> = {
  Perimeter: VOCABULAIRE_PERIMETRE,
  Direction: VOCABULAIRE_DIRECTION,
  Decision: VOCABULAIRE_DECISION,
  Criticality: VOCABULAIRE_CRITICITE,
  Confirmation: ["Yes", "No"],
  Nature: VOCABULAIRE_NATURE,
  // Les noms d'icône acceptés, pour que la colonne Icône de TypesActeur se
  // remplisse par recopie plutôt que de mémoire, avec un aperçu en regard.
  Icon: ICONES_DISPONIBLES,
  Preview: ICONES_DISPONIBLES.map((n) => APERCU_ICONES[n] ?? ""),
};

// Correspondance de départ entre type d'acteur et icône. Rien n'y est figé :
// c'est précisément ce que l'onglet TypesActeur sert à changer.
export const ICONES_PAR_DEFAUT: [string, string][] = [
  ["Application", "app-window"],
  ["Service", "cog"],
  ["Packaged product", "package"],
  ["Partner", "handshake"],
  ["Person", "user"],
  ["Infrastructure", "server"],
];

// Les technologies courantes, avec le sens dans lequel on les représente. Repris
// du référentiel réel, mais débarrassé de ce qui n'y avait pas sa place : les
// variantes dépôt/retrait (le sens se déduit de qui expose), les composites
// « + ESB » et « + ETL » (ce sont deux liens, pas un), et OIDC-SSO (un flux
// HTTP, pas une technologie).
export const TYPES_FLUX: [string, string, string][] = [
  ["HTTP", "consumer → provider", "Direct HTTP call, REST or SOAP"],
  ["gRPC", "consumer → provider", "Remote procedure call"],
  ["SQL", "consumer → provider", "Direct database access"],
  ["Kafka", "provider → consumer", "Event publication — drawn as a push from the producer"],
  ["JMS", "provider → consumer", "Message queue — drawn as a push from the sender"],
  ["File", "provider → consumer", "File exchange"],
  ["SFTP", "provider → consumer", "File transfer over SSH"],
  ["Object storage (S3)", "consumer → provider", "Read from or write to a bucket"],
  ["LDAP", "consumer → provider", "Directory lookup"],
  ["SMTP", "provider → consumer", "Sending email"],
  ["Syslog", "provider → consumer", "Log shipping to a collector"],
  ["NTP", "consumer → provider", "Time synchronisation"],
  ["Screen entry", "consumer → provider", "Human entry on a screen the provider exposes"],
  ["Screen lookup", "provider → consumer", "Human reading on a screen the provider exposes"],
  ["Manual", "provider → consumer", "Human hand-off, outside any system"],
  ["Proprietary", "consumer → provider", "Protocol specific to a packaged product"],
];


// Deux colonnes : un intitulé court à gauche, le texte à droite. En une seule
// colonne, chaque phrase devenait une ligne de 90 caractères qu'il fallait lire
// en travers de la feuille.
export const MODE_EMPLOI: [string, string][] = [
  ["INTERFACE MAP", "How to fill this workbook in."],
  ["", ""],
  ["THE PRINCIPLE", ""],
  ["", "An interface is PROVIDED once by one actor, and CONSUMED by one or more others."],
  ["", "It is described once in Interfaces, and its consumptions are detailed in a"],
  ["", "FX_<provider>_<flow type> sheet. Two actors may publish interfaces of the same"],
  ["", "name: they are two interfaces, told apart by their provider."],
  ["", ""],
  ["THE TWO READINGS", "The same workbook is read in two ways, and you fill it in only once."],
  ["", "ARCHITECTURE answers « what does it go through »: every hop is drawn, buses"],
  ["", "and gateways included."],
  ["", "BUSINESS answers « who feeds whom »: technical actors disappear and the flows"],
  ["", "crossing them are joined end to end."],
  ["", "Two columns carry it. Nature, in ActorTypes, says which types are technical."],
  ["", "Republished as, on the FX_ sheets, is filled on the technical actor's own"],
  ["", "consumption lines: under which of ITS interfaces that input comes back out."],
  ["", "A bus that aggregates writes nothing special — it simply has several lines"],
  ["", "pointing at the same interface. Fill neither column, and the tool never"],
  ["", "mentions the distinction."],
  ["", ""],
  ["THE SHEETS", ""],
  ["Actors", "Who exists, in which group, of which type."],
  ["Groups", "The perimeter is declared HERE, not on each actor: a group is Platform or"],
  ["", "External, and everything it holds follows."],
  ["Milestones", "The platform's timeline. Every row elsewhere says at which milestone it"],
  ["", "arrived, and at which one it left. A row retired AT v3 is already gone at v3."],
  ["ActorTypes", "Which icon each actor type wears — and thereby the list of types that exist."],
  ["", "Nature tells Business from Technical; the Preview column is not typed in."],
  ["FlowTypes", "The technologies, and the direction they are drawn in. Pre-filled with the"],
  ["", "common ones: remove what does not concern you. An optional Colour column,"],
  ["", "a hex code such as #2a78d6, pins a technology's shade; without it the tool"],
  ["", "picks one from its palette."],
  ["Interfaces", "The catalogue: a flow, its provider, its technology, its contract."],
  ["FX_…", "One sheet per (provider, flow type) pair: who consumes what."],
  ["", ""],
  ["HIDDEN SHEETS", "They are not filled in by hand. Right-click a tab > Unhide."],
  ["Lists", "The dictionary feeding the drop-down lists."],
  ["Version", "The model version this workbook follows. Do not edit."],
  ["", ""],
  ["ENTRY RULES", ""],
  ["Drop-down lists", "Reference columns carry them, and they grow by themselves: add an actor and"],
  ["", "it appears at once in Interfaces and in the FX_ sheets. Never type a name by"],
  ["", "hand — a spelling variant creates a phantom actor. Select a cell and its"],
  ["", "prompt says what is expected."],
  ["Flow name", "Unique for one provider, together with its version: that pair links the"],
  ["", "catalogue to the detail."],
  ["Version", "On an FX_ sheet, fill Flow name in first: the versions offered are the ones"],
  ["", "declared for that interface."],
  ["Republished as", "Only on a technical actor's own consumption lines: which of its interfaces"],
  ["", "republishes this input. A drop-down offers that actor's interfaces and no"],
  ["", "others — the line already says which provider and which version came in."],
  ["Decision", "What has been decided for one consumption. Remove is a DEPRECATION warning,"],
  ["", "not a retirement: retirement is the Retired at column, and only that column"],
  ["", "takes the row off the diagrams."],
  ["Obsolete row", "Do not delete it: give it a retirement milestone."],
  ["Renaming an actor", "Breaks every reference to it. Find and replace across the whole workbook,"],
  ["", "or not at all."],
  ["", ""],
  ["MISSING FX_ SHEETS", ""],
  ["", "Fill Interfaces in first: each row calls for an FX_<provider>_<type> sheet."],
  ["", "Create it by hand, or drop this workbook on the tool and use « Repair or"],
  ["", "upgrade a workbook » — it returns the file with every expected sheet."],
  ["", "Excel caps a tab name at 31 characters and refuses \\ / ? * [ ] : a long"],
  ["", "provider therefore gets a shortened tab. The tool cuts it the same way, so"],
  ["", "the two always agree; it warns if two pairs land on the same tab."],
  ["", ""],
  ["", "The visualisation tool only READS: it never modifies this workbook."],
  ["", ""],
  ["ARROW DIRECTION", ""],
  ["", "Nothing to type in: two things are drawn, and both follow from the flow type."],
  ["", "The LINE follows the data, always provider towards consumer: it leaves the"],
  ["", "provider and reaches the consumer, so a chain of relays reads like a pipe."],
  ["", "The ARROWHEAD says who takes the initiative. On a push — Kafka, JMS, a file"],
  ["", "drop — it sits at the far end. On a pull — HTTP, SQL, LDAP — it sits at the"],
  ["", "near end, pointing back at the provider being queried."],
  ["", "The business reading keeps the line and drops the arrowhead's nuance: a"],
  ["", "chain crosses technologies of opposite conventions, and only the data"],
  ["", "direction survives that."],
];