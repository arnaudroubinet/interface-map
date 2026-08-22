import { parseWorkbook } from "../parsing/workbook";
import { buildModel } from "../parsing/build-model";
import { upgrade } from "./schema-upgrade";
import { migrateLegacyWorkbook, type MigrationReport } from "./legacy-upgrade";
import type { WorkbookData } from "./template-export";

export interface Reparation {
  data: WorkbookData;
  // Renseigné seulement quand le classeur venait du format d'origine : c'est là
  // que des choix ont été faits faute d'information, et qu'il faut le dire.
  legacyReport: MigrationReport | null;
}

// La porte unique : on donne un classeur, on récupère un classeur complet et au
// format courant. Trois cas, un seul geste pour l'utilisateur.
//
// L'aiguillage se fait sur ce que le parseur sait lire, et non sur le nom des
// feuilles : un classeur de notre famille se lit, un classeur d'origine non.
// C'est le test le plus sûr, puisque c'est exactement la question qui compte.
export function repairWorkbook(paquet: ArrayBuffer, dateMigration: Date = new Date()): Reparation {
  const lu = buildModel(parseWorkbook(paquet));
  if (lu.ok) {
    // Notre famille : mise à niveau du schéma s'il y a lieu, et création des
    // onglets attendus, que le classeur soit à jour ou non.
    return { data: upgrade(lu.model, dateMigration), legacyReport: null };
  }
  const legacy = migrateLegacyWorkbook(paquet, dateMigration);
  return { data: legacy.data, legacyReport: legacy };
}
