import {
  VOCABULARY_CRITICALITY,
  VOCABULARY_DECISION,
  VOCABULARY_DIRECTION,
  VOCABULARY_NATURE,
  VOCABULARY_PERIMETER,
} from "../aggregation/vocabularies";
import { NATURE_BUSINESS, NATURE_MIDDLEWARE, NATURE_STORAGE } from "../aggregation/nature";
import { AVAILABLE_ICONS, ICON_PREVIEWS } from "../render/icons";

// What the produced workbook holds BEFORE anything is typed: its vocabularies,
// its icons, its sixteen technologies, and the instructions its first sheet
// carries.
//
// These are data, not machinery. They used to live in the middle of the module
// that assembles the workbook and its Excel formulas, so that fixing a typo in
// the instructions meant opening the project's most technical file. Separating
// them changes nothing of what is written in the workbook: it is the same
// content, filed where one looks for it.

// The domain's reference values. They are what gets copied into the workbook's
// columns; the tool does not impose them, it offers them.
// The actor types are NOT here: they are now enumerated by the ActorTypes
// sheet, which is authoritative. Having them in both places would have left
// two competing truths on the same question.
export const LISTES: Record<string, string[]> = {
  Perimeter: VOCABULARY_PERIMETER,
  Direction: VOCABULARY_DIRECTION,
  Decision: VOCABULARY_DECISION,
  Criticality: VOCABULARY_CRITICALITY,
  Confirmation: ["Yes", "No"],
  Nature: VOCABULARY_NATURE,
  // The accepted icon names, so that ActorTypes' Icon column is filled by
  // copying rather than from memory, with a preview alongside.
  Icon: AVAILABLE_ICONS,
  Preview: AVAILABLE_ICONS.map((n) => ICON_PREVIEWS[n] ?? ""),
};

// The starting actor types: a name, its icon, its nature. They seed the blank
// REFERENTIAL, not a cartography -- a cartography picks its types from the
// referential now, so seeding it would have it declare six types before anyone
// said it used any.
//
// Nothing in it is fixed: it is a starting point in a file made to be edited.
export const DEFAULT_ICONS: [string, string, string][] = [
  ["Application", "app-window", NATURE_BUSINESS],
  ["Service", "cog", NATURE_BUSINESS],
  ["Packaged product", "package", NATURE_BUSINESS],
  ["Partner", "handshake", NATURE_BUSINESS],
  ["Person", "user", NATURE_BUSINESS],
  // The two technical types, and they are not interchangeable. A middleware is
  // CROSSED: a bus or a gateway is not a correspondent, the flows through it
  // are joined end to end -- that is the whole of the functional reading. A
  // storage is where the data STOPS: a bucket, a database, an archive. Neither
  // is folded into the other, and only the first is expected to republish.
  ["Middleware", "network", NATURE_MIDDLEWARE],
  ["Storage", "database", NATURE_STORAGE],
];

// The common technologies, with the direction they are represented in. Taken
// from the real referential, but stripped of what had no place in it: the
// deposit/withdrawal variants (the direction follows from who publishes), the
// "+ ESB" and "+ ETL" composites (those are two links, not one), and OIDC-SSO
// (an HTTP flow, not a technology).
export const FLOW_TYPES: [string, string, string][] = [
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


// The explanation sheet. Each row carries ITS ROLE, and the role decides the
// formatting: that is what allows sentences to no longer be broken by hand.
// The old version did -- 80-character lines cut up in the code -- and the
// break came undone as soon as the column was widened.
export type RowRole = "title" | "section" | "body" | "aside";

export interface InstructionsRow {
  role: RowRole;
  left: string;
  right: string;
}

const t = (right: string): InstructionsRow => ({ role: "title", left: "INTERFACE MAP", right });
const s_ = (left: string): InstructionsRow => ({ role: "section", left, right: "" });
const l = (left: string, right: string): InstructionsRow => ({ role: "body", left, right });
const p = (right: string): InstructionsRow => ({ role: "body", left: "", right });
const d = (right: string): InstructionsRow => ({ role: "aside", left: "", right });
const empty = (): InstructionsRow => ({ role: "body", left: "", right: "" });

export const INSTRUCTIONS: InstructionsRow[] = [
  t("How to fill this workbook in — and what the tool makes of it."),
  d("You never fill the same thing twice: every sheet answers one question, and the drop-down lists are built from the sheets before it."),
  empty(),

  s_("START HERE"),
  l("1. Groups", "Name your groups and say, for each, whether it is Platform (what your team owns) or External."),
  l("2. Actors", "List the components. Each belongs to a group and carries a type."),
  l("3. ActorTypes", "Give each type its icon, and say whether it is Business or Technical."),
  l("4. FlowTypes", "Keep the technologies you use, delete the rest."),
  l("5. Interfaces", "Declare each interface: its name, its version, WHO PROVIDES it, over which technology."),
  l("6. FX_ sheets", "One sheet per (provider, technology) pair: who consumes what, and how critical it is to them."),
  d("Select any cell: a note tells you what is expected there."),
  empty(),

  s_("THE PRINCIPLE"),
  p("An interface is PROVIDED once, by one actor, and CONSUMED by one or more others."),
  p("It is described once on Interfaces, and its consumptions are detailed on an FX_<provider>_<flow type> sheet."),
  p("Two actors may publish interfaces of the same name: those are two interfaces, told apart by their provider."),
  empty(),

  s_("THE TWO READINGS"),
  p("The same workbook is read two ways, and you fill it in only once."),
  l("Architecture", "answers « what does it go through »: every hop is drawn, buses and gateways included."),
  l("Functional", "answers « who feeds whom »: technical actors disappear, and the flows crossing them are joined end to end."),
  p("Two columns carry the distinction, and both are optional. Nature, on ActorTypes, says which types are technical. Republished as, on the FX_ sheets, is filled on a technical actor's own consumption lines: under which of ITS interfaces that input comes back out."),
  p("A bus that aggregates writes nothing special — it simply has several lines pointing at the same interface."),
  d("Fill neither column and the tool never mentions the distinction."),
  empty(),

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
  empty(),

  s_("ENTRY RULES"),
  l("Drop-down lists", "Reference columns carry them and they grow by themselves: add an actor and it appears at once on Interfaces and on the FX_ sheets. Never type a name by hand — a spelling variant creates a phantom actor."),
  l("Flow name", "Unique for one provider, together with its version: that pair links the catalogue to the detail."),
  l("Version", "On an FX_ sheet, fill Flow name in first: the versions offered are the ones declared for that interface."),
  l("Republished as", "Only on a technical actor's own consumption lines: which of its interfaces republishes this input. The drop-down offers that actor's interfaces and no others."),
  l("Decision", "What has been decided for one consumption. Remove is a DEPRECATION warning, not a retirement."),
  l("Retired at", "The only column that takes a row off the diagrams. A row retired AT v3 is already gone at v3."),
  l("Obsolete row", "Do not delete it: give it a retirement milestone. Deleting it erases the history."),
  l("Renaming an actor", "Breaks every reference to it. Find and replace across the whole workbook, or not at all."),
  empty(),

  s_("READING AN ARROW"),
  p("Nothing to type in: two things are drawn, and both follow from the flow type."),
  l("The line", "follows the data, always from provider to consumer, so a chain of relays reads like a pipe."),
  l("The arrowhead", "says who takes the initiative. A SOLID head means the provider pushes — Kafka, JMS, a file drop. An OPEN V means the consumer pulls — HTTP, SQL, LDAP — and it sits at the provider's end, pointing back at what is being queried."),
  d("The functional reading keeps the line and drops the nuance: a chain crosses technologies of opposite conventions, and only the data direction survives that."),
  empty(),

  s_("MISSING FX_ SHEETS"),
  p("Fill Interfaces in first: each row calls for an FX_<provider>_<type> sheet. Create it by hand, or drop this workbook on the tool and use « Repair or upgrade a workbook » — it returns the file with every expected sheet."),
  d("Excel caps a tab name at 31 characters and refuses \\ / ? * [ ] : a long provider therefore gets a shortened tab. The tool cuts it the same way, so the two always agree, and it warns if two pairs land on the same tab."),
  empty(),

  d("The visualisation tool only READS this workbook: it never modifies it."),
];
