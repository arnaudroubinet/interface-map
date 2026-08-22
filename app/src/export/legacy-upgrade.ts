import * as XLSX from "xlsx";
import { normalizeText } from "../shared/text";
import { TYPES_FLUX, LISTES, type WorkbookData } from "./template-export";
import { MILESTONE_ORIGIN } from "./schema-upgrade";
import { expectedFxSheet } from "../parsing/build-model";

// Convertit un classeur au format d'origine vers le format actuel.
//
// Les deux modèles ne disent pas la même chose. L'origine décrit UN LIEN entre
// deux composants ; le format actuel décrit une interface EXPOSÉE une fois et
// CONSOMMÉE par plusieurs. La conversion transpose ce qui se déduit, et laisse
// vide ce qui ne s'invente pas -- les contrôles d'intégrité pointent alors
// exactement ce qu'il reste à saisir, plutôt qu'un classeur d'apparence
// complète et faux.

const FEUILLE_FLUX = "Flux";
const FEUILLE_COMPOSANTS = "Composants";

// La colonne « Statut » du format d'origine porte en réalité la DÉCISION, et
// sans accents. On ne transcrit pas une table de correspondance relevée sur un
// fichier : on retrouve la valeur dans le vocabulaire actuel en comparant à la
// normalisation près. Ce qui ne s'y retrouve pas reste vide, et la complétude
// le signale -- plutôt que d'inventer une équivalence.
// Le format d'origine parle français ; notre vocabulaire est en anglais depuis
// le schéma v3. La correspondance est donc explicite -- une comparaison de
// chaînes ne pouvait plus rien retrouver.
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
  // Une valeur déjà écrite dans le vocabulaire courant passe aussi.
  return found ?? LISTES.Decision.find((d) => normalizeText(d) === sought) ?? "";
}

export interface RapportMigration {
  data: WorkbookData;
  actorsCreated: string[];
  typesInconnus: string[];
}

function sheet(wb: XLSX.WorkBook, name: string): Record<string, string>[] {
  const found = wb.SheetNames.find((n) => normalizeText(n) === normalizeText(name));
  if (!found) return [];
  return XLSX.utils.sheet_to_json<Record<string, string>>(wb.Sheets[found], { defval: "", raw: false });
}

const text = (v: unknown) => (v ?? "").toString().trim();

function sensConnu(type: string): string {
  return TYPES_FLUX.find((t) => normalizeText(t[0]) === normalizeText(type))?.[1] ?? "";
}

export function migrateLegacyWorkbook(paquet: ArrayBuffer, dateMigration: Date = new Date()): RapportMigration {
  const wb = XLSX.read(new Uint8Array(paquet), { type: "array", cellDates: true });
  const liens = sheet(wb, FEUILLE_FLUX);
  if (liens.length === 0) throw new Error(`aucune sheet "${FEUILLE_FLUX}" exploitable`);

  // Les types réellement employés, et non la liste d'origine : celle-ci empile
  // technologies et décisions dans la même colonne.
  const usedTypes = [...new Set(liens.map((l) => text(l["Type de flux"])).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "fr")
  );
  const typesInconnus = usedTypes.filter((t) => !sensConnu(t));

  // Les composants déclarés, puis ceux que seuls les flux citent. Dans les
  // fichiers réels, l'onglet Composants n'est pas tenu à jour : on ne perd pas
  // les acteurs pour autant, on les crée sans groupe -- ce qu'un contrôle
  // d'intégrité signale aussitôt.
  const actors: string[][] = [];
  const connus = new Set<string>();
  for (const c of sheet(wb, FEUILLE_COMPOSANTS)) {
    const name = text(c["Nom"]);
    if (!name || connus.has(normalizeText(name))) continue;
    connus.add(normalizeText(name));
    actors.push([name, text(c["Groupe"]), "", "", text(c["Description"]), text(c["Commentaires"]), MILESTONE_ORIGIN, ""]);
  }

  const actorsCreated: string[] = [];
  for (const lien of liens) {
    for (const name of [text(lien["Composant source"]), text(lien["Composant cible"])]) {
      if (!name || connus.has(normalizeText(name))) continue;
      connus.add(normalizeText(name));
      actors.push([name, "", "", "", "", "", MILESTONE_ORIGIN, ""]);
      actorsCreated.push(name);
    }
  }

  const groups = [...new Set(actors.map((a) => a[1]).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "fr"))
    // Le périmètre n'existe pas dans le format d'origine : à saisir.
    .map((name) => [name, ""]);

  const interfaces: string[][] = [];
  const fx = new Map<string, string[][]>();

  for (const lien of liens) {
    const source = text(lien["Composant source"]);
    const target = text(lien["Composant cible"]);
    const type = text(lien["Type de flux"]);
    const flowName = text(lien["Nom du flux"]);
    if (!source || !target || !flowName) continue;

    // Le sens du type décide qui expose : pour Kafka ou JMS on représente la
    // poussée du producteur, donc la source expose ; partout ailleurs c'est
    // l'appelant qui consomme, et la cible expose.
    const versConsommateur = sensConnu(type) === "provider → consumer";
    const provider = versConsommateur ? source : target;
    const consumer = versConsommateur ? target : source;

    const contrat = text(lien["Emplacement du contrat"]);
    interfaces.push([
      flowName,
      // Le format d'origine ne connaît pas les versions de contrat : on laisse
      // vide plutôt que d'inventer. Une version vide reste une version, le
      // rattachement des consommations fonctionne donc à l'identique.
      "",
      provider,
      type,
      text(lien["Description"]),
      // Le format d'origine ne distingue pas le lien de la référence : ce champ
      // contient aussi bien une URL qu'un intitulé, on le range en référence.
      "",
      contrat,
      text(lien["Commentaires"]),
      "No",
      MILESTONE_ORIGIN,
      "",
    ]);

    // feuilleFxAttendue assainit le nom : plus aucun type de flux ne peut
    // produire un onglet qu'Excel refuserait, donc plus aucune consommation
    // n'est abandonnée en route.
    const tab = expectedFxSheet(provider, type);
    const rows = fx.get(tab) ?? [];
    rows.push([
      flowName,
      "",
      consumer,
      // L'usage et la criticité n'existent pas dans le format d'origine.
      "",
      "",
      currentDecision(text(lien["Statut"])),
      "",
      // Le format d'origine ne connaît ni acteur technique ni republication :
      // la colonne existe, elle reste vide, et la complétude la réclamera si
      // l'équipe adopte la distinction.
      "",
      MILESTONE_ORIGIN,
      // Le format d'origine ne date aucun départ : même « À supprimer » ne dit
      // que l'intention, et c'est une décision, pas un palier de retrait.
      "",
    ]);
    fx.set(tab, rows);
  }

  // Une feuille Flux non vide ne dit rien de plus qu'un tableau lu : si aucune
  // colonne reconnue n'y correspond, aucune interface n'en sort. Des acteurs
  // sans la moindre interface ne sont pas une cartographie -- juste une liste
  // d'applications qui a l'air d'un résultat. Rendre ça en silence serait le
  // pire des silences.
  if (interfaces.length === 0) {
    throw new Error("nothing recognisable in the original format: no flow could be recovered");
  }

  return {
    data: {
      // Le format d'origine ne déclare ni types de flux ni types d'acteur :
      // l'amorce fait foi, et les contrôles diront ce qui manque.
      flowTypes: [],
      actorTypes: [],
      // Le format d'origine n'a aucune chronologie : tout ce qu'il contient
      // existait à la bascule, et il n'annonce aucune suite -- un seul palier
      // suffit donc à le porter.
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
    typesInconnus,
  };
}
