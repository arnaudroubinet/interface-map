import type { WorkbookData } from "./template-export";
import { FLOW_TYPES } from "./template-data";

// A complete fictional referential, to show the tool filled rather than empty.
// The domain and ALL the names -- groups, components, flows -- are foreign to
// our sample workbooks: nothing here must be confused with a real referential,
// nor with the test fixtures.
//
// It is built to trigger no anomaly at all: every interface has a description
// and a contract, every consumption its usage, its criticality and its
// decision, every row its arrival milestone, every actor at least one flow,
// and every declared group and actor type is actually carried.

// Actor type | Icon | Nature
//
// This column is what makes the business reading exist: a technical actor does
// not appear on a functional diagram, and the flows crossing it are joined end
// to end. Without it, both modes return the same drawing and the sample would
// not show what it is meant to show.
const ACTOR_TYPES = [
  ["Application", "app-window", "Business"],
  ["Service", "cog", "Business"],
  ["Packaged product", "package", "Business"],
  ["Partner", "handshake", "Business"],
  ["Person", "user", "Business"],
  ["Infrastructure", "server", "Middleware"],
  // The other technical role, and the reason the two are told apart: a bucket
  // is not crossed. What is written to it stops there, and the report has
  // nothing to say about a flow that ends where it was meant to.
  ["Object storage", "database", "Storage"],
];

const GROUPS = [
  ["Core", "Platform"],
  ["Sales network", "External"],
  ["Health partners", "External"],
  ["Institutional", "External"],
  ["Support", "External"],
];

// Milestone | Rank | Label | Status | Date | Description
const MILESTONES = [
  ["v1", "1", "Initial platform", "Delivered", "2026-01-15", "Platform and policies go live"],
  ["v2", "2", "Opening to partners", "Delivered", "2026-06-01", "Care statements and outsourced payroll"],
  ["v3", "3", "Real time", "Planned", "2026-12-01", "Lookups move to version 2"],
];

// Name | Group | Actor type | Owner | Description | Comments | Introduced | Retired
const ACTORS = [
  ["Chandrila", "Core", "Application", "Policy team", "Policy management", "", "v1", ""],
  ["Sullust", "Core", "Service", "Actuarial team", "Pricing engine", "", "v1", ""],
  ["Takodana", "Core", "Service", "Data team", "Member repository", "", "v1", ""],
  ["Malastare", "Core", "Infrastructure", "Integration team", "Internal message bus", "", "v1", ""],
  ["Rodia", "Core", "Application", "Digital team", "Member portal", "", "v1", ""],
  ["Onderon", "Core", "Service", "Compliance team", "Regulatory archiving", "", "v1", ""],
  ["Bracca", "Sales network", "Partner", "Sales division", "Wholesale broker", "", "v1", ""],
  ["Zeffo", "Sales network", "Application", "Sales division", "Online subscription", "", "v1", ""],
  ["Ilum", "Health partners", "Partner", "Partnerships division", "Care facility", "", "v1", ""],
  ["Serenno", "Institutional", "Partner", "Legal division", "Sector regulator", "", "v1", ""],
  ["Vjun", "Support", "Packaged product", "IT department", "Outsourced payroll software", "", "v2", ""],
  ["Crait", "Support", "Person", "Member services", "Case handling", "", "v1", ""],
  // Three successive relays, all technical: they disappear in the business
  // reading and the chain joins up end to end. Two are on the platform, the
  // third is not -- so a functional chain also crosses the boundary, which is
  // the common case at an insurer.
  ["Kafka", "Core", "Infrastructure", "Integration team", "Event broker", "", "v1", ""],
  ["Dagobah", "Core", "Infrastructure", "Integration team", "Contract management gateway", "", "v1", ""],
  ["ESB", "Support", "Infrastructure", "IT department", "Shared enterprise service bus, operated outside the platform", "", "v1", ""],
  // A terminus, not a relay: the statements written here are archived, not
  // passed on. It stays visible in the business reading -- "Chandrila archives
  // its statements" is a fact -- where a middleware would have been folded away.
  ["Kamino", "Core", "Object storage", "Compliance team", "Regulatory document vault", "", "v1", ""],
];

// Flow name | Version | Provider | Flow type | Description | Contract link | Reference | Comments | To confirm | Relays | Introduced | Retired
const INTERFACES = [
  // A migration under way, so that the sample file also shows the follow-up
  // report: 1.0 is on its way out, 2.0 replaces it, and two consumers have not
  // switched yet.
  ["Member lookup", "1.0", "Takodana", "HTTP", "Reading a member record", "https://contrats.interne/adherent", "CTR-ADH-01", "", "No", "v1", "v3"],
  ["Member lookup", "2.0", "Takodana", "HTTP", "Reading a member record, enriched format", "https://contrats.interne/adherent-v2", "CTR-ADH-01", "", "No", "v2", ""],
  ["Premium calculation", "1.0", "Sullust", "HTTP", "Premium computed from a profile", "https://contrats.interne/cotisation", "CTR-COT-02", "", "No", "v1", ""],
  ["Subscription", "1.0", "Chandrila", "HTTP", "Creating and amending a policy", "https://contrats.interne/souscription", "CTR-SOU-03", "", "No", "v1", ""],
  ["Policy events", "1.0", "Chandrila", "Kafka", "Publishing policy changes", "https://contrats.interne/vie-contrat", "CTR-VIE-04", "", "No", "v1", ""],
  // Two chains cross the bus, in opposite directions: this is what tells an
  // architecture diagram from a business one. In architecture one sees the four
  // segments and the bus in the middle; in business, "Ilum ─► Chandrila" and
  // "Chandrila ─► Ilum", with the medium removed.
  ["Raw statement", "1.0", "Ilum", "File", "Statement file dropped by the care facility", "https://contrats.interne/decompte-brut", "CTR-DEC-05", "", "No", "v1", ""],
  ["Care statement", "1.0", "Malastare", "File", "Statements normalised for the policy system", "https://contrats.interne/decompte", "CTR-DEC-06", "", "No", "v1", ""],
  ["Policy stream", "1.0", "Malastare", "Kafka", "Policy changes republished to partners", "https://contrats.interne/flux-contrat", "CTR-VIE-10", "", "No", "v1", ""],
  ["Supporting documents", "1.0", "Onderon", "SFTP", "Documents delivered for archiving", "https://contrats.interne/pieces", "CTR-PIE-06", "", "No", "v1", ""],
  ["Member mail", "1.0", "Rodia", "SMTP", "Emails sent to members", "https://contrats.interne/courrier", "CTR-COU-07", "", "No", "v1", ""],
  // Consumed by the vault, and by nothing else. Read as plumbing, this flow
  // went in and came out for nobody; read as a terminus, it arrives.
  ["Daily statements", "1.0", "Chandrila", "File", "Daily statement file dropped for archiving", "https://contrats.interne/releves", "CTR-REL-16", "", "No", "v1", ""],
  ["Regulatory return", "1.0", "Onderon", "File", "Periodic extract for the regulator", "https://contrats.interne/etat", "CTR-ETA-08", "Scope to confirm", "Yes", "v1", ""],
  ["Payslips", "1.0", "Vjun", "SFTP", "Monthly payslip delivery", "https://contrats.interne/paie", "CTR-PAI-09", "", "No", "v2", ""],
  // Chandrila ─► Kafka ─► Dagobah ─► ESB ─► Bracca: four segments, three relays.
  // In architecture one sees all four; in business, "Chandrila ─► North Broker",
  // with all the plumbing removed.
  ["Policy notice", "1.0", "Chandrila", "Kafka", "Policy change notice for the sales network", "https://contrats.interne/avis", "CTR-AVI-11", "", "No", "v1", ""],
  ["notice.stream", "1.0", "Kafka", "Kafka", "Notices republished on the broker topic", "https://contrats.interne/avis-topic", "CTR-AVI-12", "", "No", "v1", ""],
  ["notice.norm", "1.0", "Dagobah", "HTTP", "Notices normalised to the partner contract", "https://contrats.interne/avis-norme", "CTR-AVI-13", "", "No", "v1", ""],
  ["notice.out", "1.0", "ESB", "SFTP", "Notices delivered to the broker network", "https://contrats.interne/avis-sortie", "CTR-AVI-14", "", "No", "v1", ""],
  // A second chain through the same relay, but one that does not leave the
  // platform: Chandrila ─► Kafka ─► Takodana. A single hop, and both ends are
  // internal -- the other chain has three and leaves the perimeter. The same bus
  // serves both without conflating them, which is exactly what per-row
  // republication makes it possible to say.
  ["events.core", "1.0", "Kafka", "Kafka", "Policy events republished for the platform", "https://contrats.interne/vie-socle", "CTR-VIE-15", "", "No", "v1", ""],
];

// Flow name | Version | Consumer | Usage | Criticality | Decision | Comments | Introduced | Retired
const consumption = (
  flows: string,
  consumer: string,
  usage: string,
  criticality: string,
  decision = "Keep",
  version = "1.0",
  arrival = "v1",
  // Filled only on the bus's inputs: under which of ITS interfaces this input
  // comes back out. This is what joins the chain up in the business reading.
  republishedAs = ""
) => [flows, version, consumer, usage, criticality, decision, "", republishedAs, arrival, ""];

const FX = [
  {
    name: "FX_Takodana_HTTP",
    rows: [
      consumption("Member lookup", "Chandrila", "Checking entitlement before subscribing", "1 - Critical", "Keep", "2.0", "v2"),
      consumption("Member lookup", "Rodia", "Displaying the member account", "1 - Critical", "Keep", "2.0", "v2"),
      consumption("Member lookup", "Zeffo", "Pre-filling the journey", "2 - Important"),
      consumption("Member lookup", "Crait", "Lookup during a call", "2 - Important"),
    ],
  },
  {
    name: "FX_Sullust_HTTP",
    rows: [
      consumption("Premium calculation", "Chandrila", "Premium carried onto the policy", "1 - Critical"),
      consumption("Premium calculation", "Zeffo", "Online quote", "2 - Important"),
      consumption("Premium calculation", "Bracca", "Quote shown to the client", "2 - Important"),
    ],
  },
  {
    name: "FX_Chandrila_HTTP",
    rows: [
      consumption("Subscription", "Zeffo", "Subscribing from the website", "1 - Critical"),
      consumption("Subscription", "Bracca", "Subscribing through the network", "1 - Critical"),
    ],
  },
  {
    name: "FX_Chandrila_Kafka",
    rows: [
      consumption("Policy events", "Malastare", "Broadcast to internal applications", "1 - Critical", "Keep", "1.0", "v1", "Policy stream 1.0"),
      consumption("Policy events", "Onderon", "Archiving amendments", "3 - Standard"),
      consumption("Policy notice", "Kafka", "Publishing on the broker", "2 - Important", "Keep", "1.0", "v1", "notice.stream 1.0"),
      consumption("Policy events", "Kafka", "Republishing for the platform", "2 - Important", "Keep", "1.0", "v1", "events.core 1.0"),
      consumption("Policy events", "Rodia", "Refreshing the portal", "2 - Important"),
    ],
  },
  {
    name: "FX_Malastare_File",
    rows: [consumption("Care statement", "Chandrila", "Reimbursing members", "1 - Critical")],
  },
  {
    name: "FX_Ilum_File",
    rows: [consumption("Raw statement", "Malastare", "Picking up the partner drop", "2 - Important", "Keep", "1.0", "v1", "Care statement 1.0")],
  },
  {
    name: "FX_Malastare_Kafka",
    rows: [consumption("Policy stream", "Ilum", "Following the policies it handles", "2 - Important")],
  },
  {
    name: "FX_Onderon_SFTP",
    rows: [
      consumption("Supporting documents", "Chandrila", "Dropping subscription documents", "2 - Important"),
      consumption("Supporting documents", "Rodia", "Dropping documents filed online", "2 - Important"),
      // A flow in the middle of switching over: dimmed on the diagrams.
      consumption("Supporting documents", "Crait", "Manual drop, replaced by the portal", "3 - Standard", "Transform"),
    ],
  },
  {
    name: "FX_Chandrila_File",
    rows: [consumption("Daily statements", "Kamino", "Long-term archiving", "3 - Standard")],
  },
  {
    name: "FX_Rodia_SMTP",
    rows: [consumption("Member mail", "Crait", "Copy of the mail sent", "3 - Standard")],
  },
  {
    name: "FX_Onderon_File",
    rows: [consumption("Regulatory return", "Serenno", "Quarterly regulatory filing", "1 - Critical")],
  },
  {
    // The first hop shares Chandrila's sheet: same publisher, same technology
    // as "Policy events".
    name: "FX_Kafka_Kafka",
    rows: [
      consumption("notice.stream", "Dagobah", "Routing to the contract gateway", "2 - Important", "Keep", "1.0", "v1", "notice.norm 1.0"),
      consumption("events.core", "Takodana", "Refreshing the member record on a policy change", "2 - Important"),
    ],
  },
  {
    name: "FX_Dagobah_HTTP",
    rows: [consumption("notice.norm", "ESB", "Handing over to the shared bus", "2 - Important", "Keep", "1.0", "v1", "notice.out 1.0")],
  },
  {
    name: "FX_ESB_SFTP",
    rows: [consumption("notice.out", "Bracca", "Receiving policy notices", "2 - Important")],
  },
  {
    name: "FX_Vjun_SFTP",
    rows: [consumption("Payslips", "Onderon", "Archiving payslips", "3 - Standard", "Keep", "1.0", "v2")],
  },
];

export const SAMPLE_DATA: WorkbookData = {
  // The technologies are declared now rather than left to a seed: a cartography
  // takes the ones it uses from the referential, and a sheet nobody filled
  // would leave every interface pointing at a technology this workbook does not
  // declare.
  flowTypes: FLOW_TYPES.map((t) => [...t]),
  actorTypes: ACTOR_TYPES,
  milestones: MILESTONES,
  groups: GROUPS,
  actors: ACTORS,
  interfaces: INTERFACES,
  fx: FX,
};
