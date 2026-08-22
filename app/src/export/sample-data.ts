import type { DonneesClasseur } from "./template-export";

// Un référentiel fictif complet, pour montrer l'outil rempli plutôt que vide.
// Le domaine et TOUS les noms -- groupes, composants, flux -- sont étrangers à
// nos classeurs d'exemple : rien ici ne doit se confondre avec un vrai
// référentiel, ni avec le jeu de test.
//
// Il est construit pour ne déclencher aucune anomalie : chaque interface a une
// description et un contrat, chaque consommation son usage, sa criticité et sa
// décision, chaque ligne son palier d'arrivée, chaque acteur au moins un flux,
// chaque groupe et chaque type d'acteur déclaré est effectivement porté.

// Type d'acteur | Icône | Nature
//
// C'est cette colonne qui fait exister la lecture métier : un acteur technique
// n'apparaît pas sur un schéma fonctionnel, les flux qui le traversent sont
// raboutés bout à bout. Sans elle, les deux modes rendent le même dessin et
// l'exemple ne montrerait pas ce qu'il est censé montrer.
const TYPES_ACTEUR = [
  ["Application", "app-window", "Business"],
  ["Service", "cog", "Business"],
  ["Packaged product", "package", "Business"],
  ["Partner", "handshake", "Business"],
  ["Person", "user", "Business"],
  ["Infrastructure", "server", "Technical"],
];

const GROUPES = [
  ["Core", "Platform"],
  ["Sales network", "External"],
  ["Health partners", "External"],
  ["Institutional", "External"],
  ["Support", "External"],
];

// Palier | Rang | Libellé | Statut | Date | Description
const PALIERS = [
  ["v1", "1", "Initial platform", "Delivered", "2026-01-15", "Platform and policies go live"],
  ["v2", "2", "Opening to partners", "Delivered", "2026-06-01", "Care statements and outsourced payroll"],
  ["v3", "3", "Real time", "Planned", "2026-12-01", "Lookups move to version 2"],
];

// Nom | Groupe | Type d'acteur | Responsable | Description | Commentaires | Intro | Retrait
const ACTEURS = [
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
  // Trois relais successifs, tous techniques : ils disparaissent en lecture
  // métier et la chaîne se raboute d'un bout à l'autre. Deux sont sur la
  // plateforme, le troisième ne l'est pas -- une chaîne fonctionnelle traverse
  // donc aussi la frontière, ce qui est le cas courant chez un assureur.
  ["Kafka", "Core", "Infrastructure", "Integration team", "Event broker", "", "v1", ""],
  ["Dagobah", "Core", "Infrastructure", "Integration team", "Contract management gateway", "", "v1", ""],
  ["ESB", "Support", "Infrastructure", "IT department", "Shared enterprise service bus, operated outside the platform", "", "v1", ""],
];

// Nom du flux | Version | Exposant | Type de flux | Description | Lien contrat | Référence | Commentaires | À confirmer | Relais | Intro | Retrait
const INTERFACES = [
  // Une migration en cours, pour que le fichier d'exemple montre aussi le
  // rapport de suivi : la 1.0 est en retrait, la 2.0 la remplace, et deux
  // consommateurs n'ont pas encore basculé.
  ["Member lookup", "1.0", "Takodana", "HTTP", "Reading a member record", "https://contrats.interne/adherent", "CTR-ADH-01", "", "No", "v1", "v3"],
  ["Member lookup", "2.0", "Takodana", "HTTP", "Reading a member record, enriched format", "https://contrats.interne/adherent-v2", "CTR-ADH-01", "", "No", "v2", ""],
  ["Premium calculation", "1.0", "Sullust", "HTTP", "Premium computed from a profile", "https://contrats.interne/cotisation", "CTR-COT-02", "", "No", "v1", ""],
  ["Subscription", "1.0", "Chandrila", "HTTP", "Creating and amending a policy", "https://contrats.interne/souscription", "CTR-SOU-03", "", "No", "v1", ""],
  ["Policy events", "1.0", "Chandrila", "Kafka", "Publishing policy changes", "https://contrats.interne/vie-contrat", "CTR-VIE-04", "", "No", "v1", ""],
  // Deux chaînes traversent le bus, en sens opposés : c'est ce qui distingue un
  // schéma d'architecture d'un schéma métier. En architecture on voit les
  // quatre segments et le bus au milieu ; en métier, « Ilum ─► Chandrila »
  // et « Chandrila ─► Ilum », le medium retiré.
  ["Raw statement", "1.0", "Ilum", "File", "Statement file dropped by the care facility", "https://contrats.interne/decompte-brut", "CTR-DEC-05", "", "No", "v1", ""],
  ["Care statement", "1.0", "Malastare", "File", "Statements normalised for the policy system", "https://contrats.interne/decompte", "CTR-DEC-06", "", "No", "v1", ""],
  ["Policy stream", "1.0", "Malastare", "Kafka", "Policy changes republished to partners", "https://contrats.interne/flux-contrat", "CTR-VIE-10", "", "No", "v1", ""],
  ["Supporting documents", "1.0", "Onderon", "SFTP", "Documents delivered for archiving", "https://contrats.interne/pieces", "CTR-PIE-06", "", "No", "v1", ""],
  ["Member mail", "1.0", "Rodia", "SMTP", "Emails sent to members", "https://contrats.interne/courrier", "CTR-COU-07", "", "No", "v1", ""],
  ["Regulatory return", "1.0", "Onderon", "File", "Periodic extract for the regulator", "https://contrats.interne/etat", "CTR-ETA-08", "Scope to confirm", "Yes", "v1", ""],
  ["Payslips", "1.0", "Vjun", "SFTP", "Monthly payslip delivery", "https://contrats.interne/paie", "CTR-PAI-09", "", "No", "v2", ""],
  // Chandrila ─► Kafka ─► Dagobah ─► ESB ─► Bracca : quatre segments, trois
  // relais. En architecture on voit les quatre ; en métier, « Chandrila ─► North
  // Broker », toute la plomberie retirée.
  ["Policy notice", "1.0", "Chandrila", "Kafka", "Policy change notice for the sales network", "https://contrats.interne/avis", "CTR-AVI-11", "", "No", "v1", ""],
  ["notice.stream", "1.0", "Kafka", "Kafka", "Notices republished on the broker topic", "https://contrats.interne/avis-topic", "CTR-AVI-12", "", "No", "v1", ""],
  ["notice.norm", "1.0", "Dagobah", "HTTP", "Notices normalised to the partner contract", "https://contrats.interne/avis-norme", "CTR-AVI-13", "", "No", "v1", ""],
  ["notice.out", "1.0", "ESB", "SFTP", "Notices delivered to the broker network", "https://contrats.interne/avis-sortie", "CTR-AVI-14", "", "No", "v1", ""],
  // Une seconde chaîne par le même relais, mais qui ne quitte pas la
  // plateforme : Chandrila ─► Kafka ─► Takodana. Un seul saut, et les deux extrémités
  // sont internes -- l'autre chaîne en compte trois et sort du périmètre. Le
  // même bus sert les deux sans les confondre, ce qui est exactement ce que la
  // republication par ligne permet de dire.
  ["events.core", "1.0", "Kafka", "Kafka", "Policy events republished for the platform", "https://contrats.interne/vie-socle", "CTR-VIE-15", "", "No", "v1", ""],
];

// Nom du flux | Version | Consommateur | Usage | Criticité | Décision | Commentaires | Intro | Retrait
const conso = (
  flows: string,
  consumer: string,
  usage: string,
  criticality: string,
  decision = "Keep",
  version = "1.0",
  arrivee = "v1",
  // Renseigné sur les seules entrées du bus : sous laquelle de SES interfaces
  // cette entrée ressort. C'est ce qui raboute la chaîne en lecture métier.
  republishedAs = ""
) => [flows, version, consumer, usage, criticality, decision, "", republishedAs, arrivee, ""];

const FX = [
  {
    name: "FX_Takodana_HTTP",
    rows: [
      conso("Member lookup", "Chandrila", "Checking entitlement before subscribing", "1 - Critical", "Keep", "2.0", "v2"),
      conso("Member lookup", "Rodia", "Displaying the member account", "1 - Critical", "Keep", "2.0", "v2"),
      conso("Member lookup", "Zeffo", "Pre-filling the journey", "2 - Important"),
      conso("Member lookup", "Crait", "Lookup during a call", "2 - Important"),
    ],
  },
  {
    name: "FX_Sullust_HTTP",
    rows: [
      conso("Premium calculation", "Chandrila", "Premium carried onto the policy", "1 - Critical"),
      conso("Premium calculation", "Zeffo", "Online quote", "2 - Important"),
      conso("Premium calculation", "Bracca", "Quote shown to the client", "2 - Important"),
    ],
  },
  {
    name: "FX_Chandrila_HTTP",
    rows: [
      conso("Subscription", "Zeffo", "Subscribing from the website", "1 - Critical"),
      conso("Subscription", "Bracca", "Subscribing through the network", "1 - Critical"),
    ],
  },
  {
    name: "FX_Chandrila_Kafka",
    rows: [
      conso("Policy events", "Malastare", "Broadcast to internal applications", "1 - Critical", "Keep", "1.0", "v1", "Policy stream 1.0"),
      conso("Policy events", "Onderon", "Archiving amendments", "3 - Standard"),
      conso("Policy notice", "Kafka", "Publishing on the broker", "2 - Important", "Keep", "1.0", "v1", "notice.stream 1.0"),
      conso("Policy events", "Kafka", "Republishing for the platform", "2 - Important", "Keep", "1.0", "v1", "events.core 1.0"),
      conso("Policy events", "Rodia", "Refreshing the portal", "2 - Important"),
    ],
  },
  {
    name: "FX_Malastare_File",
    rows: [conso("Care statement", "Chandrila", "Reimbursing members", "1 - Critical")],
  },
  {
    name: "FX_Ilum_File",
    rows: [conso("Raw statement", "Malastare", "Picking up the partner drop", "2 - Important", "Keep", "1.0", "v1", "Care statement 1.0")],
  },
  {
    name: "FX_Malastare_Kafka",
    rows: [conso("Policy stream", "Ilum", "Following the policies it handles", "2 - Important")],
  },
  {
    name: "FX_Onderon_SFTP",
    rows: [
      conso("Supporting documents", "Chandrila", "Dropping subscription documents", "2 - Important"),
      conso("Supporting documents", "Rodia", "Dropping documents filed online", "2 - Important"),
      // Un flux en cours de bascule : atténué sur les schémas.
      conso("Supporting documents", "Crait", "Manual drop, replaced by the portal", "3 - Standard", "Transform"),
    ],
  },
  {
    name: "FX_Rodia_SMTP",
    rows: [conso("Member mail", "Crait", "Copy of the mail sent", "3 - Standard")],
  },
  {
    name: "FX_Onderon_File",
    rows: [conso("Regulatory return", "Serenno", "Quarterly regulatory filing", "1 - Critical")],
  },
  {
    // Le premier maillon partage l'onglet de Chandrila : même exposant, même
    // technologie que « Policy events ».
    name: "FX_Kafka_Kafka",
    rows: [
      conso("notice.stream", "Dagobah", "Routing to the contract gateway", "2 - Important", "Keep", "1.0", "v1", "notice.norm 1.0"),
      conso("events.core", "Takodana", "Refreshing the member record on a policy change", "2 - Important"),
    ],
  },
  {
    name: "FX_Dagobah_HTTP",
    rows: [conso("notice.norm", "ESB", "Handing over to the shared bus", "2 - Important", "Keep", "1.0", "v1", "notice.out 1.0")],
  },
  {
    name: "FX_ESB_SFTP",
    rows: [conso("notice.out", "Bracca", "Receiving policy notices", "2 - Important")],
  },
  {
    name: "FX_Vjun_SFTP",
    rows: [conso("Payslips", "Onderon", "Archiving payslips", "3 - Standard", "Keep", "1.0", "v2")],
  },
];

export const DONNEES_EXEMPLE: DonneesClasseur = {
  // Le référentiel des technologies se contente de l'amorce ; celui des types
  // d'acteur, non : il doit porter la nature.
  flowTypes: [],
  actorTypes: TYPES_ACTEUR,
  milestones: PALIERS,
  groups: GROUPES,
  actors: ACTEURS,
  interfaces: INTERFACES,
  fx: FX,
};
