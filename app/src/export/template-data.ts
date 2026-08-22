import {
  VOCABULAIRE_CRITICITE,
  VOCABULAIRE_DECISION,
  VOCABULAIRE_DIRECTION,
  VOCABULAIRE_NATURE,
  VOCABULAIRE_PERIMETRE,
} from "../aggregation/vocabularies";
import { ICONES_DISPONIBLES, APERCU_ICONES } from "../render/icons";

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


// L'onglet d'explication. Chaque ligne porte SON RÔLE, et le rôle décide de la
// mise en forme : c'est ce qui permet de ne plus couper les phrases à la main.
// L'ancienne version le faisait -- des lignes de 80 caractères découpées dans
// le code -- et la coupure se défaisait dès qu'on élargissait la colonne.
export type RowRole = "title" | "section" | "body" | "aside";

export interface LigneModeEmploi {
  role: RowRole;
  gauche: string;
  droite: string;
}

const t = (droite: string): LigneModeEmploi => ({ role: "title", gauche: "INTERFACE MAP", droite });
const s_ = (gauche: string): LigneModeEmploi => ({ role: "section", gauche, droite: "" });
const l = (gauche: string, droite: string): LigneModeEmploi => ({ role: "body", gauche, droite });
const p = (droite: string): LigneModeEmploi => ({ role: "body", gauche: "", droite });
const d = (droite: string): LigneModeEmploi => ({ role: "aside", gauche: "", droite });
const vide = (): LigneModeEmploi => ({ role: "body", gauche: "", droite: "" });

export const MODE_EMPLOI: LigneModeEmploi[] = [
  t("How to fill this workbook in — and what the tool makes of it."),
  d("You never fill the same thing twice: every sheet answers one question, and the drop-down lists are built from the sheets before it."),
  vide(),

  s_("START HERE"),
  l("1. Groups", "Name your groups and say, for each, whether it is Platform (what your team owns) or External."),
  l("2. Actors", "List the components. Each belongs to a group and carries a type."),
  l("3. ActorTypes", "Give each type its icon, and say whether it is Business or Technical."),
  l("4. FlowTypes", "Keep the technologies you use, delete the rest."),
  l("5. Interfaces", "Declare each interface: its name, its version, WHO PROVIDES it, over which technology."),
  l("6. FX_ sheets", "One sheet per (provider, technology) pair: who consumes what, and how critical it is to them."),
  d("Select any cell: a note tells you what is expected there."),
  vide(),

  s_("THE PRINCIPLE"),
  p("An interface is PROVIDED once, by one actor, and CONSUMED by one or more others."),
  p("It is described once on Interfaces, and its consumptions are detailed on an FX_<provider>_<flow type> sheet."),
  p("Two actors may publish interfaces of the same name: those are two interfaces, told apart by their provider."),
  vide(),

  s_("THE TWO READINGS"),
  p("The same workbook is read two ways, and you fill it in only once."),
  l("Architecture", "answers « what does it go through »: every hop is drawn, buses and gateways included."),
  l("Functional", "answers « who feeds whom »: technical actors disappear, and the flows crossing them are joined end to end."),
  p("Two columns carry the distinction, and both are optional. Nature, on ActorTypes, says which types are technical. Republished as, on the FX_ sheets, is filled on a technical actor's own consumption lines: under which of ITS interfaces that input comes back out."),
  p("A bus that aggregates writes nothing special — it simply has several lines pointing at the same interface."),
  d("Fill neither column and the tool never mentions the distinction."),
  vide(),

  s_("THE SHEETS"),
  l("Groups", "The perimeter is declared HERE, not on each actor: a group is Platform or External, and everything it holds follows."),
  l("Actors", "Who exists, in which group, of which type."),
  l("ActorTypes", "Which icon each actor type wears — and thereby the list of types that exist. Nature tells Business from Technical."),
  l("FlowTypes", "The technologies and the direction they are drawn in."),
  d("Add a Colour column to FlowTypes to pin a technology's shade, as a hex code such as #2a78d6. Without it the tool picks one from its palette; a colour too light to see is darkened on screen, and the report says so."),
  l("Milestones", "The platform's timeline. Every row elsewhere says at which milestone it arrived and at which one it left."),
  l("Interfaces", "The catalogue: a flow, its provider, its technology, its contract."),
  l("FX_…", "One sheet per (provider, flow type) pair: who consumes what."),
  d("Lists and Version are hidden and filled by the tool. Right-click a tab > Unhide to see them; do not edit them."),
  vide(),

  s_("ENTRY RULES"),
  l("Drop-down lists", "Reference columns carry them and they grow by themselves: add an actor and it appears at once on Interfaces and on the FX_ sheets. Never type a name by hand — a spelling variant creates a phantom actor."),
  l("Flow name", "Unique for one provider, together with its version: that pair links the catalogue to the detail."),
  l("Version", "On an FX_ sheet, fill Flow name in first: the versions offered are the ones declared for that interface."),
  l("Republished as", "Only on a technical actor's own consumption lines: which of its interfaces republishes this input. The drop-down offers that actor's interfaces and no others."),
  l("Decision", "What has been decided for one consumption. Remove is a DEPRECATION warning, not a retirement."),
  l("Retired at", "The only column that takes a row off the diagrams. A row retired AT v3 is already gone at v3."),
  l("Obsolete row", "Do not delete it: give it a retirement milestone. Deleting it erases the history."),
  l("Renaming an actor", "Breaks every reference to it. Find and replace across the whole workbook, or not at all."),
  vide(),

  s_("READING AN ARROW"),
  p("Nothing to type in: two things are drawn, and both follow from the flow type."),
  l("The line", "follows the data, always from provider to consumer, so a chain of relays reads like a pipe."),
  l("The arrowhead", "says who takes the initiative. A SOLID head means the provider pushes — Kafka, JMS, a file drop. An OPEN V means the consumer pulls — HTTP, SQL, LDAP — and it sits at the provider's end, pointing back at what is being queried."),
  d("The functional reading keeps the line and drops the nuance: a chain crosses technologies of opposite conventions, and only the data direction survives that."),
  vide(),

  s_("MISSING FX_ SHEETS"),
  p("Fill Interfaces in first: each row calls for an FX_<provider>_<type> sheet. Create it by hand, or drop this workbook on the tool and use « Repair or upgrade a workbook » — it returns the file with every expected sheet."),
  d("Excel caps a tab name at 31 characters and refuses \\ / ? * [ ] : a long provider therefore gets a shortened tab. The tool cuts it the same way, so the two always agree, and it warns if two pairs land on the same tab."),
  vide(),

  d("The visualisation tool only READS this workbook: it never modifies it."),
];
