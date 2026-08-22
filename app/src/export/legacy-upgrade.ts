import * as XLSX from "xlsx";
import { normalizeText } from "../shared/text";
import { FLOW_TYPES, LISTES, type WorkbookData } from "./template-export";
import { MILESTONE_ORIGIN } from "./schema-upgrade";
import { expectedFxSheet } from "../parsing/build-model";

// Converts a workbook in the original format to the current one.
//
// The two models do not say the same thing. The original describes A LINK
// between two components; the current format describes an interface PUBLISHED
// once and CONSUMED by several. The conversion transposes what can be deduced,
// and leaves empty what cannot be invented -- the integrity checks then point
// at exactly what is left to fill in, rather than a workbook that looks
// complete and is wrong.

const FLOWS_SHEET = "Flux";
const COMPONENTS_SHEET = "Composants";

// The original format's "Statut" column actually carries the DECISION, and
// without accents. No mapping table taken from one file is transcribed: the
// value is found again in the current vocabulary by comparing up to
// normalisation. What is not found stays empty, and completeness reports it --
// rather than an equivalence being invented.
// The original format speaks French; our vocabulary has been English since
// schema v3. The mapping is therefore explicit -- a string comparison could no
// longer find anything.
const DECISION_LEGACY: [string, string][] = [
  ["À conserver", "Keep"],
  ["À creuser", "Investigate"],
  ["À transformer", "Transform"],
  ["À supprimer", "Remove"],
];

function currentDecision(value: string): string {
  const sought = normalizeText(value);
  if (!sought) return "";
  const found = DECISION_LEGACY.find(([fr]) => normalizeText(fr) === sought)?.[1];
  // A value already written in the current vocabulary passes too.
  return found ?? LISTES.Decision.find((d) => normalizeText(d) === sought) ?? "";
}

export interface MigrationReport {
  data: WorkbookData;
  actorsCreated: string[];
  unknownTypes: string[];
}

function sheet(wb: XLSX.WorkBook, name: string): Record<string, string>[] {
  const found = wb.SheetNames.find((n) => normalizeText(n) === normalizeText(name));
  if (!found) return [];
  return XLSX.utils.sheet_to_json<Record<string, string>>(wb.Sheets[found], { defval: "", raw: false });
}

const text = (v: unknown) => (v ?? "").toString().trim();

function knownDirection(type: string): string {
  return FLOW_TYPES.find((t) => normalizeText(t[0]) === normalizeText(type))?.[1] ?? "";
}

export function migrateLegacyWorkbook(paquet: ArrayBuffer, dateMigration: Date = new Date()): MigrationReport {
  const wb = XLSX.read(new Uint8Array(paquet), { type: "array", cellDates: true });
  const links = sheet(wb, FLOWS_SHEET);
  if (links.length === 0) throw new Error(`aucune sheet "${FLOWS_SHEET}" exploitable`);

  // The types actually used, not the original list: that one piles technologies
  // and decisions into the same column.
  const usedTypes = [...new Set(links.map((l) => text(l["Type de flux"])).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "fr")
  );
  const unknownTypes = usedTypes.filter((t) => !knownDirection(t));

  // The declared components, then those only the flows name. In real files, the
  // Composants sheet is not kept up to date: the actors are not lost for all
  // that, they are created with no group -- which an integrity check reports at
  // once.
  const actors: string[][] = [];
  const known = new Set<string>();
  for (const c of sheet(wb, COMPONENTS_SHEET)) {
    const name = text(c["Nom"]);
    if (!name || known.has(normalizeText(name))) continue;
    known.add(normalizeText(name));
    actors.push([name, text(c["Groupe"]), "", "", text(c["Description"]), text(c["Commentaires"]), MILESTONE_ORIGIN, ""]);
  }

  const actorsCreated: string[] = [];
  for (const link of links) {
    for (const name of [text(link["Composant source"]), text(link["Composant cible"])]) {
      if (!name || known.has(normalizeText(name))) continue;
      known.add(normalizeText(name));
      actors.push([name, "", "", "", "", "", MILESTONE_ORIGIN, ""]);
      actorsCreated.push(name);
    }
  }

  const groups = [...new Set(actors.map((a) => a[1]).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "fr"))
    // The perimeter does not exist in the original format: to be filled in.
    .map((name) => [name, ""]);

  const interfaces: string[][] = [];
  const fx = new Map<string, string[][]>();

  for (const link of links) {
    const source = text(link["Composant source"]);
    const target = text(link["Composant cible"]);
    const type = text(link["Type de flux"]);
    const flowName = text(link["Nom du flux"]);
    if (!source || !target || !flowName) continue;

    // The type's direction decides who publishes: for Kafka or JMS the
    // producer's push is represented, so the source publishes; everywhere else
    // it is the caller that consumes, and the target publishes.
    const toConsumer = knownDirection(type) === "provider → consumer";
    const provider = toConsumer ? source : target;
    const consumer = toConsumer ? target : source;

    const contract = text(link["Emplacement du contrat"]);
    interfaces.push([
      flowName,
      // The original format knows nothing of contract versions: it is left empty
      // rather than invented. An empty version is still a version, so matching
      // consumptions works identically.
      "",
      provider,
      type,
      text(link["Description"]),
      // The original format does not tell the link from the reference: this field
      // holds a URL as readily as a heading, so it is filed as a reference.
      "",
      contract,
      text(link["Commentaires"]),
      "No",
      MILESTONE_ORIGIN,
      "",
    ]);

    // feuilleFxAttendue sanitises the name: no flow type can produce a sheet
    // Excel would refuse any more, so no consumption is abandoned along the
    // way.
    const tab = expectedFxSheet(provider, type);
    const rows = fx.get(tab) ?? [];
    rows.push([
      flowName,
      "",
      consumer,
      // Usage and criticality do not exist in the original format.
      "",
      "",
      currentDecision(text(link["Statut"])),
      "",
      // The original format knows neither technical actor nor republication: the
      // column exists, it stays empty, and completeness will ask for it if the
      // team adopts the distinction.
      "",
      MILESTONE_ORIGIN,
      // The original format dates no departure: even "À supprimer" states only
      // the intent, and that is a decision, not a retirement milestone.
      "",
    ]);
    fx.set(tab, rows);
  }

  // A non-empty Flux sheet says no more than a table that was read: if no
  // recognised column matches it, no interface comes out of it. Actors without a
  // single interface are not a cartography -- just a list of applications that
  // looks like a result. Returning that in silence would be the worst silence of
  // all.
  if (interfaces.length === 0) {
    throw new Error("nothing recognisable in the original format: no flow could be recovered");
  }

  return {
    data: {
      // The original format declares neither flow types nor actor types: the seed
      // is authoritative, and the checks will say what is missing.
      flowTypes: [],
      actorTypes: [],
      // The original format has no chronology: everything it holds existed at the
      // switch, and it announces no sequel -- so a single milestone is enough to
      // carry it.
      milestones: [
        [MILESTONE_ORIGIN, "1", "Initial state", "Delivered", dateMigration.toISOString().slice(0, 10), "Taken from the original workbook."],
      ],
      groups,
      actors,
      interfaces,
      fx: [...fx.entries()]
        .sort(([a], [b]) => a.localeCompare(b, "fr"))
        .map(([name, rows]) => ({ name, rows })),
    },
    actorsCreated,
    unknownTypes,
  };
}
