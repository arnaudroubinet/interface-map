import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import {
  buildTemplateWorkbook,
  writeTemplate,
  tableauxDuModele,
  listesDuModele,
  validationsDuModele,
  INVITES,
  columnOf,
  COLONNE_APPOINT,
  CELLULE_ONGLET,
  LISTES,
  type DonneesClasseur,
} from "./template-export";
import { parseWorkbook } from "../parsing/workbook";
import {
  buildModel,
  VERSION_MODELE,
  COLONNES_INTERFACES,
  COLONNES_FX,
  COLONNES_PALIERS,
  COLONNES_ACTEURS,
  COLONNES_GROUPES,
  COLONNES_TYPESACTEUR,
  COLONNES_TYPESFLUX,
} from "../parsing/build-model";
import { runIntegrityChecks } from "../integrity/checks";
import { ICONES_DISPONIBLES, APERCU_ICONES } from "../render/icons";
import { DONNEES_EXEMPLE } from "./sample-data";

// On relit le fichier écrit, pas l'objet en mémoire : c'est celui-là que
// l'utilisateur ouvrira, et c'est lui qui doit repasser dans notre parseur.
// écrireModele inclut le complément OOXML (tableaux structurés).
function modeleRelu(): ArrayBuffer {
  return writeTemplate();
}

// Le contenu brut d'une partie du paquet, pour vérifier ce que SheetJS ne sait
// ni écrire ni relire.
function partie(path: string, paquet: ArrayBuffer = modeleRelu()): string {
  const cfb = XLSX.CFB.read(new Uint8Array(paquet), { type: "array" });
  const input = XLSX.CFB.find(cfb, path);
  if (!input || !input.content) throw new Error(`partie absente : ${path}`);
  return new TextDecoder().decode(new Uint8Array(input.content as unknown as ArrayBufferLike));
}

// Les parties de feuille sont numérotées dans l'ordre du classeur : les
// désigner par ce numéro casse dès qu'un onglet s'insère avant. On résout donc
// par nom, comme partout ailleurs dans ce projet.
// Même raison pour les parties « table » : leur numéro suit l'ordre du
// classeur, donc il bouge dès qu'un tableau s'insère avant. On les retrouve
// par le nom qu'elles portent.
function tableXml(nomTable: string, paquet: ArrayBuffer = modeleRelu()): string {
  const cfb = XLSX.CFB.read(new Uint8Array(paquet), { type: "array" });
  for (const path of cfb.FullPaths) {
    if (!/\/xl\/tables\/table\d+\.xml$/.test(path)) continue;
    const xml = partie(path.replace(/^[^/]*/, ""), paquet);
    if (xml.includes(`name="${nomTable}"`)) return xml;
  }
  throw new Error(`table absente : ${nomTable}`);
}

function feuilleXml(name: string, paquet: ArrayBuffer = modeleRelu()): string {
  const wb = XLSX.read(new Uint8Array(paquet), { type: "array" });
  const index = wb.SheetNames.indexOf(name);
  if (index < 0) throw new Error(`tab absent : ${name}`);
  return partie(`/xl/worksheets/sheet${index + 1}.xml`, paquet);
}

describe("modèle de classeur", () => {
  it("porte tous les onglets que le parseur attend", () => {
    const wb = XLSX.read(new Uint8Array(modeleRelu()), { type: "array" });
    expect(wb.SheetNames).toEqual([
      "Instructions",
      "Actors",
      "Groups",
      "Milestones",
      "ActorTypes",
      "FlowTypes",
      "Interfaces",
      "Lists",
      "Version",
    ]);
  });

  // Le contrat central : un modèle qui ne se relit pas serait pire qu'aucun
  // modèle, l'utilisateur ne saurait pas si le tort vient de lui ou de l'outil.
  it("se relit sans erreur bloquante ni colonne manquante", () => {
    const parsed = parseWorkbook(modeleRelu());
    const result = buildModel(parsed);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.missingOptionalColumns).toEqual([]);
  });

  it("déclare le périmètre au niveau du groupe, pas déduit des acteurs", () => {
    const parsed = parseWorkbook(modeleRelu());
    const result = buildModel(parsed);
    if (!result.ok) throw new Error("modèle illisible");
    // L'onglet existe et fait foi, même vide de lignes.
    expect(result.model.groupsSheetMissing).toBe(false);
  });

  it("pré-remplit TypesActeur avec des icônes qui existent dans le catalogue", () => {
    const parsed = parseWorkbook(modeleRelu());
    const result = buildModel(parsed);
    if (!result.ok) throw new Error("modèle illisible");

    expect(result.model.actorTypes.length).toBeGreaterThan(0);
    for (const t of result.model.actorTypes) {
      expect(ICONES_DISPONIBLES).toContain(t.icon);
    }
  });

  // Un modèle qui s'ouvre sur des erreurs ferait douter de l'outil avant même
  // la première saisie : un classeur vierge est vide, pas incohérent.
  it("ne déclenche aucune anomalie bloquante à l'ouverture", () => {
    const result = buildModel(parseWorkbook(modeleRelu()));
    if (!result.ok) throw new Error("modèle illisible");
    const report = runIntegrityChecks(result.model);
    const messages = report.families.flatMap((f) => f.anomalies.map((a) => a.message));
    expect(messages).toEqual([]);
  });

  // Excel refusait d'ouvrir le modèle : l'autofiltre pose un nom défini qui cite
  // le nom de la feuille entre apostrophes, et SheetJS ne double pas
  // l'apostrophe interne de « Mode d'emploi ». Le fichier restait relisible par
  // SheetJS lui-même, d'où des tests verts sur un classeur qu'Excel proposait de
  // réparer. La règle est donc vérifiée ici, à la source.
  it("ne pose pas d'autofiltre sur une feuille dont le nom contient une apostrophe", () => {
    const wb = buildTemplateWorkbook();
    for (const name of wb.SheetNames) {
      if (name.includes("'")) {
        expect(wb.Sheets[name]["!autofilter"]).toBeUndefined();
      }
    }
    // Plus aucune feuille ne porte d'apostrophe depuis que « Mode d'emploi »
    // est devenu « Instructions ». La règle reste vraie et le test la garde,
    // mais il ne protège plus rien tant qu'aucun nom n'en porte.
    expect(wb.SheetNames.some((n) => n.includes("'"))).toBe(false);
  });

  it("liste les noms d'icône acceptés dans l'onglet Listes, chacun avec son aperçu", () => {
    const wb = XLSX.read(new Uint8Array(modeleRelu()), { type: "array" });
    const lists = XLSX.utils.sheet_to_json<Record<string, string>>(wb.Sheets.Lists, { defval: "" });
    const offered = lists.map((l) => l.Icon).filter(Boolean);
    expect(offered).toEqual(ICONES_DISPONIBLES);
    // Chaque nom a son repère visuel en regard, sur la même ligne.
    for (const row of lists.filter((l) => l.Icon)) {
      expect(row["Preview"]).toBe(APERCU_ICONES[row.Icon]);
      expect(row["Preview"]).not.toBe("");
    }
  });

  // Les types d'acteur sont énumérés par l'onglet TypesActeur : les répéter
  // dans Listes aurait créé deux vérités concurrentes.
  it("n'énumère pas les types d'acteur dans Listes", () => {
    const wb = XLSX.read(new Uint8Array(modeleRelu()), { type: "array" });
    const entetes = XLSX.utils.sheet_to_json<string[]>(wb.Sheets.Lists, { header: 1 })[0];
    expect(entetes).not.toContain("ActorType");
  });

  // SheetJS n'écrit pas les tableaux structurés : on complète le paquet OOXML
  // après coup. Ces vérifications portent donc sur le XML, pas sur l'objet.
  // Le préfixe « Tbl » est le contrat de la macro : elle cherche
  // « TblInterfaces » et s'arrête si elle ne le trouve pas.
  it("pose un vrai tableau Excel sur chaque feuille de saisie", () => {
    for (let i = 1; i <= tableauxDuModele().length; i++) {
      const table = partie(`/xl/tables/table${i}.xml`);
      expect(table).toContain('displayName="Tbl');
      expect(table).toContain('showRowStripes="1"');
    }
    // Et la déclaration côté feuille, sans quoi Excel ignorerait la partie.
    expect(feuilleXml("Actors")).toContain("<tableParts count=\"1\">");
  });

  it("nomme les colonnes du tableau comme la ligne d'en-tête", () => {
    const actors = tableauxDuModele().find((t) => t.sheet === "Actors")!;
    const table = partie("/xl/tables/table1.xml");
    for (const column of actors.columns) {
      // Excel refuse un tableau dont une colonne déclarée ne correspond pas.
      expect(table).toContain(column.replace(/'/g, "'"));
    }
  });

  // SheetJS n'écrit pas non plus les validations de données : elles sont
  // injectées, donc vérifiées sur le XML.
  // Le périmètre se déclare sur le groupe : la colonne du même nom a disparu de
  // l'onglet Acteurs, et avec elle sa liste déroulante.
  it("ne demande plus de périmètre sur les acteurs", () => {
    const result = buildModel(parseWorkbook(modeleRelu()));
    if (!result.ok) throw new Error("modèle illisible");
    expect(result.model.missingOptionalColumns).toEqual([]);
    const wb = XLSX.read(new Uint8Array(modeleRelu()), { type: "array" });
    const headers = XLSX.utils.sheet_to_json<string[]>(wb.Sheets.Actors, { header: 1 })[0];
    expect(headers).not.toContain("Perimeter");
    expect(XLSX.utils.sheet_to_json<string[]>(wb.Sheets.Groups, { header: 1 })[0]).toContain("Perimeter");
  });

  it("contraint les colonnes de référence par une liste déroulante", () => {
    const actors = feuilleXml("Actors");
    // Le compte se lit sur ce qui est déclaré, pas sur un littéral : une
    // colonne contrainte de plus ne doit pas casser ce test pour rien.
    const attendues = validationsDuModele().filter((v) => v.sheet === "Actors").length;
    expect(attendues).toBeGreaterThan(1);
    expect(actors).toContain(`<dataValidations count="${attendues}">`);
    expect(actors).toContain('type="list"');
    expect(actors).toContain("<formula1>L_TypeActeur</formula1>");
    // Placée entre les données et les erreurs ignorées : l'ordre des éléments
    // d'une feuille est imposé par le schéma OOXML.
    expect(actors.indexOf("</sheetData>")).toBeLessThan(actors.indexOf("<dataValidations"));
    expect(actors.indexOf("<dataValidations")).toBeLessThan(actors.indexOf("<tableParts"));
  });

  it("pointe chaque liste vers la colonne du tableau qui la porte", () => {
    const workbook = partie("/xl/workbook.xml");
    // Une référence structurée : le tableau s'étend de lui-même, ni OFFSET ni
    // COUNTA n'ont plus lieu d'être derrière ces noms. Chaque vocabulaire de
    // Listes porte désormais SON tableau, dimensionné à son seul contenu — pas
    // le tableau unique TblLists, qui rembourrait les listes courtes de lignes
    // vides jusqu'à la hauteur de la plus longue (Icon).
    const attendues: [string, string][] = [
      ["L_Perimetre", "TblLists_Perimeter[Perimeter]"],
      ["L_Sens", "TblLists_Direction[Direction]"],
      ["L_Decision", "TblLists_Decision[Decision]"],
      ["L_Criticite", "TblLists_Criticality[Criticality]"],
      ["L_Confirmation", "TblLists_Confirmation[Confirmation]"],
      ["L_Icone", "TblLists_Icon[Icon]"],
      ["L_Nature", "TblLists_Nature[Nature]"],
      ["L_TypeActeur", "TblActorTypes[Actor type]"],
      ["L_Acteur", "TblActors[Name]"],
      ["L_Groupe", "TblGroups[Group]"],
      ["L_TypeFlux", "TblFlowTypes[Flow type]"],
      ["L_Palier", "TblMilestones[Milestone]"],
    ];
    expect(listesDuModele().map((l) => l.name).sort()).toEqual(attendues.map(([name]) => name).sort());
    for (const [name, reference] of attendues) {
      expect(workbook).toContain(`<definedName name="${name}">${reference}</definedName>`);
    }
    expect(workbook).not.toContain("OFFSET(");
    expect(workbook).not.toContain("COUNTA(");
  });

  // La régression que ce test attrape : un seul tableau TblLists, dimensionné
  // sur la plus longue liste (Icon, 25 entrées), faisait de chaque liste plus
  // courte 2 à 4 valeurs réelles suivies de lignes blanches -- visibles dans
  // le menu déroulant, et comptées par COUNTA puisque SheetJS y écrit des
  // cellules chaîne vides plutôt que de ne rien écrire.
  it("dimensionne le tableau de chaque vocabulaire de Listes à son propre contenu, sans ligne vide", () => {
    const headers = Object.keys(LISTES);
    headers.forEach((key, index) => {
      const column = XLSX.utils.encode_col(index);
      const table = tableXml(`TblLists_${key}`);
      const lastRow = LISTES[key].length + 1;
      expect(table).toContain(`ref="${column}1:${column}${lastRow}"`);
    });
  });

  // Chaque liste vise une feuille et un intitulé qui existent vraiment sur son
  // tableau : une référence structurée ne se rattrape pas comme un OFFSET, qui
  // aurait au moins pointé quelque part. Une table ou une colonne absente rend
  // le nom défini invalide, et Excel le signale en proposant de réparer le
  // classeur.
  it("chaque liste vise une feuille et un intitulé réellement présents dans son tableau", () => {
    const tables = tableauxDuModele();
    for (const list of listesDuModele()) {
      // Listes porte un tableau PAR vocabulaire : chercher par feuille seule
      // retomberait sur le premier d'entre eux, pas forcément celui qui porte
      // l'intitulé visé.
      const table = tables.find((t) => t.sheet === list.sheet && t.columns.includes(list.heading));
      expect(table, `pas de table portant "${list.heading}" sur ${list.sheet}`).toBeDefined();
    }
  });

  it("ne référence que des listes réellement définies", () => {
    // Les listes dépendantes des onglets FX_ calculent leur plage : ce sont des
    // formules, pas des noms. La règle ne vaut donc que pour les secondes.
    const defined = new Set(listesDuModele().map((l) => l.name));
    const parNom = validationsDuModele().filter((v) => v.formule !== undefined && /^L_[A-Za-zÀ-ÿ]+$/.test(v.formule));
    expect(parNom.length).toBeGreaterThan(0);
    for (const validation of parNom) {
      expect(defined).toContain(validation.formule!);
    }
  });

  // Les tableaux portent leur propre filtre : les autofiltres de feuille, et
  // les noms définis qu'ils traînaient, n'ont plus lieu d'être.
  it("ne laisse que les noms définis des listes, aucun résidu d'autofiltre", () => {
    const workbook = partie("/xl/workbook.xml");
    expect(workbook).not.toContain("_FilterDatabase");
    const names = [...workbook.matchAll(/<definedName name="([^"]*)"/g)].map((m) => m[1]);
    expect(names.sort()).toEqual(listesDuModele().map((l) => l.name).sort());
  });

  // Ni le patron ni le dictionnaire ne se remplissent à la main.
  it("masque Listes et Version, visibles sur les feuilles de saisie", () => {
    const wb = XLSX.read(new Uint8Array(modeleRelu()), { type: "array" });
    const etats = wb.Workbook!.Sheets!;
    const hidden = wb.SheetNames.filter((_, i) => etats[i].Hidden);
    expect(hidden).toEqual(["Lists", "Version"]);
  });

  it("livre les types de flux courants, prêts à l'emploi", () => {
    const result = buildModel(parseWorkbook(modeleRelu()));
    if (!result.ok) throw new Error("modèle illisible");
    const types = result.model.flowTypes;
    expect(types.map((t) => t.type)).toContain("HTTP");
    expect(types.map((t) => t.type)).toContain("Kafka");
    // Le sens est déjà tranché pour chacun : il ne se saisit pas.
    expect(types.every((t) => t.direction.length > 0)).toBe(true);
    // Les variantes dépôt/retrait et les composites ont disparu du référentiel.
    expect(types.some((t) => /dépôt|removed|ESB|ETL/i.test(t.type))).toBe(false);
  });

  it("montre l'icône choisie par une colonne calculée, jamais saisie", () => {
    const table = tableXml("TblActorTypes");
    expect(table).toContain("<calculatedColumnFormula>");
    expect(table).toContain("Lists!$");
  });

  // Excel charge les tables dans l'ordre : une formule qui désigne une table
  // définie plus loin est invalide au moment où il la lit, et il SUPPRIME la
  // table fautive en proposant de réparer le classeur. Son journal nous l'a
  // appris ; ce test empêche d'y revenir.
  it("n'utilise aucune référence structurée vers une autre table", () => {
    for (let i = 1; i <= tableauxDuModele().length; i++) {
      const table = partie(`/xl/tables/table${i}.xml`);
      const formules = [...table.matchAll(/<calculatedColumnFormula>(.*?)<\/calculatedColumnFormula>/g)];
      for (const [, formule] of formules) {
        expect(formule).not.toMatch(/Tbl[A-Za-z]+\[/);
      }
    }
  });
});

// matérialiserLesLignes déclarait la dimension de la feuille d'après la seule
// étendue du tableau qu'elle venait de poser, en écrasant ce que SheetJS avait
// écrit. Sur Listes, la zone d'appoint (colonnes J à N, jusqu'à la ligne 1000)
// tombait hors de « A1:H26 » ; sur chaque onglet FX_, la cellule K1 -- dont
// dépendent les deux listes en cascade -- tombait hors de « A1:I{n} ». Excel
// reconstruit la plage sans broncher, mais un autre lecteur (ce projet compris)
// s'y fie telle quelle.
describe("modèle de classeur — dimension déclarée", () => {
  it("couvre la zone d'appoint de Listes, pas seulement les tableaux de vocabulaire", () => {
    const lists = feuilleXml("Lists");
    const m = lists.match(/<dimension ref="A1:([A-Z]+)(\d+)"\/>/);
    expect(m).not.toBeNull();
    const [, dernièreColonne, lastRow] = m!;
    // La colonne FluxDeLOnglet, la plus à droite de la zone d'appoint.
    const flows = XLSX.utils.encode_col(Object.keys(LISTES).length + 5);
    expect(XLSX.utils.decode_col(dernièreColonne)).toBeGreaterThanOrEqual(XLSX.utils.decode_col(flows));
    expect(Number(lastRow)).toBe(1000);
  });

  it("couvre la cellule d'appoint qui nomme l'onglet, sur chaque feuille FX_", () => {
    const paquet = writeTemplate(DONNEES_EXEMPLE);
    for (const tab of DONNEES_EXEMPLE.fx) {
      const sheet = feuilleXml(tab.name, paquet);
      const m = sheet.match(/<dimension ref="A1:([A-Z]+)(\d+)"\/>/);
      expect(m, `pas de dimension sur ${tab.name}`).not.toBeNull();
      expect(XLSX.utils.decode_col(m![1])).toBeGreaterThanOrEqual(XLSX.utils.decode_col(COLONNE_APPOINT));
    }
  });
});

// La macro GenererOngletsManquants est livrée DANS les classeurs générés : son
// contrat n'est plus une convention, c'est une dépendance. Elle cherche la
// feuille Interfaces, son tableau « TblInterfaces », deux colonnes nommées, et
// le patron FX_Modèle. Un renommage silencieux la casserait chez l'utilisateur,
// sans que rien ici ne bronche.

// La macro et son bouton voyagent DANS les classeurs générés : c'est Excel qui
// crée les onglets FX_, l'outil ne fait que lire.

describe("modèle de classeur — numéro de schéma", () => {
  it("écrit le numéro courant dans l'onglet Version", () => {
    const wb = XLSX.read(new Uint8Array(modeleRelu()), { type: "array" });
    const rows = XLSX.utils.sheet_to_json<Record<string, string>>(wb.Sheets.Version, { defval: "" });
    expect(String(rows[0]["Model version"])).toBe(String(VERSION_MODELE));
  });

  // Le classeur qu'on vient de produire ne doit jamais réclamer sa propre mise
  // à niveau : c'est le test qui attrape un oubli d'incrément des deux côtés.
  it("se relit à la version que l'outil attend", () => {
    const result = buildModel(parseWorkbook(modeleRelu()));
    if (!result.ok) throw new Error("modèle illisible");
    expect(result.model.schemaVersion).toBe(VERSION_MODELE);
  });
});

describe("modèle de classeur — version d'interface", () => {

  // La version est en saisie libre : les conventions de numérotation varient
  // d'une équipe à l'autre, une liste fermée les ferait toutes rentrer de force
  // dans une seule. Elle porte quand même son infobulle -- expliquer n'est pas
  // contraindre.
  it("laisse la colonne Version en saisie libre, mais expliquée", () => {
    const surVersion = validationsDuModele().filter(
      (v) => v.sheet === "Interfaces" && v.column === columnOf(COLONNES_INTERFACES, "Version")
    );
    expect(surVersion).toHaveLength(1);
    expect(surVersion[0].formule).toBeUndefined();
    expect(surVersion[0].prompt?.text).toContain("Free text");
  });

  // Le même intitulé sur un onglet FX_ désigne une liste dépendante : la même
  // infobulle y serait fausse.
  it("n'y met pas l'invite des onglets FX_", () => {
    const surVersion = validationsDuModele().find(
      (v) => v.sheet === "Interfaces" && v.column === columnOf(COLONNES_INTERFACES, "Version")
    );
    expect(surVersion?.prompt?.text).not.toContain("Fill in Flow name first");
  });

});

// Les lignes d'exemple sont positionnelles : une colonne insérée en amont les
// décale sans rien casser de visible, et le classeur livré raconte alors n'im-
// porte quoi. Ces deux tests sont là pour que ça ne puisse plus passer.
describe("fichier d'exemple — alignement sur les colonnes", () => {
  it("donne à chaque ligne autant de cellules que la feuille a de colonnes", () => {
    for (const row of DONNEES_EXEMPLE.interfaces) {
      expect(row).toHaveLength(COLONNES_INTERFACES.length);
    }
    for (const tab of DONNEES_EXEMPLE.fx) {
      for (const row of tab.rows) {
        expect(row).toHaveLength(COLONNES_FX.length);
      }
    }
  });

  it("se relit avec chaque valeur dans sa colonne", () => {
    const result = buildModel(parseWorkbook(writeTemplate(DONNEES_EXEMPLE)));
    if (!result.ok) throw new Error("exemple illisible");
    const iface = result.model.interfaces.find((i) => i.flowName === "Member lookup")!;
    expect(iface.providerName).toBe("Takodana");
    expect(iface.flowType).toBe("HTTP");
    const conso = result.model.consumptions.find((c) => c.consumerName === "Chandrila")!;
    expect(conso.decision).toBe("Keep");
  });

  // Le fichier d'exemple sert à montrer l'outil à l'œuvre : le rapport de
  // migration en fait partie, il lui faut donc un cas à montrer.
  it("porte un décommissionnement en cours, pour que le rapport ait quelque chose à dire", () => {
    const result = buildModel(parseWorkbook(writeTemplate(DONNEES_EXEMPLE)));
    if (!result.ok) throw new Error("exemple illisible");
    const report = runIntegrityChecks(result.model);
    const block = report.infoBlocks.find((b) => b.id === "migrations")!;
    expect(block.items.length).toBeGreaterThan(0);
  });
});

describe("listes dépendantes des onglets FX_", () => {
  // Les tables d'appoint doivent être VIVANTES : figées à la génération, elles
  // cesseraient d'être justes dès la première interface ajoutée dans Excel.
  it("alimente les deux tables d'appoint par formule depuis Interfaces", () => {
    const lists = feuilleXml("Lists");
    expect(lists).toContain('t="array"');
    expect(lists).toContain("FILTER(");
    expect(lists).toContain("UNIQUE(");
    expect(lists).toContain("Interfaces!");
  });

  // Reconstruit le nom d'onglet FX_ par la même convention que le parseur
  // (build-model.ts) et que la migration legacy (migration-legacy.ts) :
  // « FX_ » + exposant + « _ » + type de flux.
  it("reconstruit le nom d'onglet FX_ par « FX_ » + exposant + « _ » + type", () => {
    const lists = feuilleXml("Lists");
    expect(lists).toContain("&quot;FX_&quot;&amp;");
    expect(lists).toContain("&amp;&quot;_&quot;&amp;");
  });

  it("donne à chaque onglet FX_ une cellule qui nomme son propre onglet", () => {
    const wb = XLSX.read(new Uint8Array(writeTemplate(DONNEES_EXEMPLE)), { type: "array" });
    const cellule = wb.Sheets["FX_Takodana_HTTP"][CELLULE_ONGLET];
    expect(cellule?.f).toContain('CELL("filename"');
  });

  it("masque la colonne qui porte cette cellule, hors du tableau de saisie", () => {
    const gabarit = feuilleXml("FX_Takodana_HTTP", writeTemplate(DONNEES_EXEMPLE));
    expect(gabarit).toMatch(/<col[^>]*hidden="(1|true)"/);
    // Le tableau de saisie s'arrête avant : la cellule ne doit pas y entrer.
    expect(COLONNE_APPOINT > columnOf(COLONNES_FX, COLONNES_FX[COLONNES_FX.length - 1])).toBe(true);
  });

  it("filtre les flux sur l'onglet et les versions sur le flux de la ligne", () => {
    const validations = validationsDuModele(DONNEES_EXEMPLE);
    const surFlux = validations.find(
      (v) => v.sheet === "FX_Takodana_HTTP" && v.column === columnOf(COLONNES_FX, "Flow name")
    )!;
    const surVersion = validations.find(
      (v) => v.sheet === "FX_Takodana_HTTP" && v.column === columnOf(COLONNES_FX, "Version")
    )!;
    // La liste des flux se cale sur le nom de l'onglet, porté par la cellule.
    expect(surFlux.formule).toContain(`$${COLONNE_APPOINT}$1`);
    expect(surFlux.formule).toContain("MATCH(");
    // Celle des versions y ajoute le flux de la LIGNE : référence relative en
    // ligne, pour qu'Excel décale la formule d'une ligne à l'autre.
    expect(surVersion.formule).toContain(`$${columnOf(COLONNES_FX, "Flow name")}2`);
    expect(surVersion.formule).toContain("MATCH(");
  });

  it("pose ces deux validations sur chaque onglet FX_", () => {
    const validations = validationsDuModele(DONNEES_EXEMPLE);
    for (const tab of DONNEES_EXEMPLE.fx) {
      const columns = validations.filter((v) => v.sheet === tab.name).map((v) => v.column);
      expect(columns).toContain(columnOf(COLONNES_FX, "Flow name"));
      expect(columns).toContain(columnOf(COLONNES_FX, "Version"));
    }
  });

  // La liste globale des flux n'a plus d'emploi : la garder laisserait deux
  // façons de proposer un flux, dont une fausse.
  it("n'expose plus de liste globale des flux", () => {
    expect(listesDuModele().map((l) => l.name)).not.toContain("L_Flux");
    expect(validationsDuModele(DONNEES_EXEMPLE).map((v) => v.formule)).not.toContain("L_Flux");
  });
});

// Excel a refusé une première version de ces formules et supprimé
// l'enregistrement : les fonctions postérieures à 2007 doivent être STOCKÉES
// sous un nom préfixé (_xlfn., et _xlfn._xlws. pour FILTER et SORT). Sans lui,
// Excel ne les reconnaît pas et propose de réparer le fichier.
describe("formules d'appoint — noms stockés", () => {
  const attendus: [string, string][] = [
    ["FILTER", "_xlfn._xlws.FILTER("],
    ["SORT", "_xlfn._xlws.SORT("],
    ["UNIQUE", "_xlfn.UNIQUE("],
    ["SEQUENCE", "_xlfn.SEQUENCE("],
    ["HSTACK", "_xlfn.HSTACK("],
  ];

  it("préfixe chaque fonction récente", () => {
    const lists = feuilleXml("Lists");
    for (const [, préfixé] of attendus) {
      expect(lists).toContain(préfixé);
    }
  });

  it("n'en laisse aucune sous son nom nu", () => {
    const lists = feuilleXml("Lists");
    for (const [nu] of attendus) {
      expect(lists).not.toMatch(new RegExp(`(?<![.A-Za-z_])${nu}\\(`));
    }
  });
});

describe("modèle de classeur — paliers", () => {
  it("porte un onglet Paliers, visible, avec ses colonnes", () => {
    const wb = XLSX.read(new Uint8Array(modeleRelu()), { type: "array" });
    expect(wb.SheetNames).toContain("Milestones");
    const entetes = XLSX.utils.sheet_to_json<string[]>(wb.Sheets.Milestones, { header: 1 })[0];
    expect(entetes).toEqual([...COLONNES_PALIERS]);
    const etats = wb.Workbook!.Sheets!;
    expect(etats[wb.SheetNames.indexOf("Milestones")].Hidden).toBeFalsy();
  });

  // Les bornes de validité se choisissent, elles ne se tapent pas : une faute
  // de frappe créerait un palier fantôme, invisible de l'onglet Paliers.
  it("contraint les deux bornes de validité par la liste des paliers", () => {
    const surPalier = validationsDuModele(DONNEES_EXEMPLE).filter((v) => v.formule === "L_Palier");
    const sheets = new Set(surPalier.map((v) => v.sheet));
    expect(sheets).toContain("Actors");
    expect(sheets).toContain("Interfaces");
    for (const tab of DONNEES_EXEMPLE.fx) expect(sheets).toContain(tab.name);
    for (const sheet of sheets) {
      const columns = surPalier.filter((v) => v.sheet === sheet).map((v) => v.column);
      expect(columns).toHaveLength(2);
    }
  });

  it("alimente cette liste depuis l'onglet Paliers lui-même", () => {
    const plage = listesDuModele().find((l) => l.name === "L_Palier")!;
    expect(plage.sheet).toBe("Milestones");
    expect(plage.heading).toBe("Milestone");
  });

  it("se relit sans colonne manquante, paliers compris", () => {
    const result = buildModel(parseWorkbook(writeTemplate(DONNEES_EXEMPLE)));
    if (!result.ok) throw new Error("modèle illisible");
    expect(result.model.missingOptionalColumns).toEqual([]);
  });
});

// Le fichier d'exemple sert à montrer l'outil à l'œuvre : il doit donc être
// exemplaire, et notamment ne se signaler aucune anomalie à lui-même.
describe("fichier d'exemple — axe des paliers", () => {
  it("renseigne un palier d'arrivée sur chaque ligne, sans anomalie", () => {
    const result = buildModel(parseWorkbook(writeTemplate(DONNEES_EXEMPLE)));
    if (!result.ok) throw new Error("exemple illisible");
    const messages = runIntegrityChecks(result.model).families.flatMap((f) => f.anomalies.map((a) => a.message));
    expect(messages).toEqual([]);
  });
});

// Une formule qui cite un onglet inexistant n'est pas une formule cassée aux
// yeux d'Excel : c'est une référence à un AUTRE CLASSEUR. Le fichier s'ouvre
// alors sur « Ce classeur comporte des liaisons avec une ou plusieurs sources
// externes », et les listes qui en dépendent ne se remplissent jamais.
describe("formules — aucun onglet fantôme", () => {
  it("ne cite que des onglets qui existent dans le classeur", () => {
    const paquet = writeTemplate();
    const wb = XLSX.read(new Uint8Array(paquet), { type: "array" });
    const connus = new Set(wb.SheetNames);

    const cited = new Set<string>();
    const relever = (xml: string) => {
      // Un nom d'onglet dans une formule précède un « ! » : soit nu, soit
      // entre apostrophes quand il porte un espace.
      for (const m of xml.matchAll(/(?:'([^']+)'|([A-Za-z_][A-Za-z0-9_.]*))!/g)) {
        cited.add(m[1] ?? m[2]);
      }
    };
    for (const name of wb.SheetNames) relever(feuilleXml(name, paquet));
    relever(partie("/xl/workbook.xml", paquet));
    // Les colonnes calculées ne vivent pas dans la feuille mais dans la partie
    // « table » : c'est là qu'était la formule d'aperçu, et l'oublier laissait
    // le contrôle aveugle sur celle-là même qui a déclenché l'avertissement.
    const cfb = XLSX.CFB.read(new Uint8Array(paquet), { type: "array" });
    for (const input of cfb.FullPaths) {
      if (/\/xl\/tables\/table\d+\.xml$/.test(input)) relever(partie(input.replace(/^[^/]*/, ""), paquet));
    }

    expect([...cited].filter((n) => !connus.has(n))).toEqual([]);
  });
});

// Chaque onglet où l'on saisit porte un tableau structuré : c'est ce qui lui
// donne ses bandes, son filtre et l'extension automatique des formules à la
// ligne suivante. Un onglet qui n'en a pas se saisit moins bien que ses
// voisins, sans que rien n'explique la différence.
describe("modèle de classeur — tous les onglets de saisie sont des tableaux", () => {
  it("n'oublie aucun onglet de données", () => {
    const paquet = writeTemplate();
    const wb = XLSX.read(new Uint8Array(paquet), { type: "array" });
    // Ni la prose, ni les deux onglets masqués qui ne se saisissent pas.
    const saisie = wb.SheetNames.filter((n) => !["Instructions", "Lists", "Version"].includes(n));
    const avecTableau = new Set(tableauxDuModele(DONNEES_EXEMPLE).map((t) => t.sheet));

    expect(saisie.filter((n) => !avecTableau.has(n))).toEqual([]);
  });
});

// SheetJS lève « Sheet names cannot exceed 31 chars » dès que FX_<exposant>_
// <type> dépasse la limite qu'Excel impose aux noms d'onglet -- ce que
// COLONNES_FX ne prévient pas à l'écriture. Un référentiel réel a des noms
// d'acteur et de technologie longs ; l'export ne doit pas mourir dessus.
// Comme donneesDepuisModele() (migration-modele.ts) et migrerClasseurLegacy()
// (migration-legacy.ts) le font déjà pour le même cas : on écarte l'onglet
// impossible, l'interface reste au catalogue, et le contrôle d'intégrité --
// qui sait déjà lire « son onglet FX_ attendu n'existe pas » -- le signale à
// la relecture. Refuser tout l'export aurait puni les interfaces valides pour
// une seule qui ne l'est pas.
// L'intention est la même qu'avant -- ne jamais produire un classeur qu'Excel
// refuserait -- mais le moyen a changé : on assainit le nom au lieu d'écarter
// l'onglet, ce qui emportait ses consommations sans un mot.
describe("modèle de classeur — onglet FX_ au nom impossible", () => {
  const nomTropLong = `FX_${"A".repeat(30)}_HTTP`; // 38 caractères

  const donnees: DonneesClasseur = {
    flowTypes: [],
    actorTypes: [],
    milestones: [],
    groups: [],
    actors: [],
    interfaces: [],
    fx: [
      { name: nomTropLong, rows: [] },
      { name: "FX_Takodana_HTTP", rows: [] },
    ],
  };

  const sanitised = nomTropLong.slice(0, 31);

  it("n'échoue pas quand un onglet FX_ dépasse 31 caractères", () => {
    expect(() => writeTemplate(donnees)).not.toThrow();
  });

  it("crée l'onglet sous un nom qu'Excel accepte, sans toucher aux autres", () => {
    const wb = XLSX.read(new Uint8Array(writeTemplate(donnees)), { type: "array" });
    expect(wb.SheetNames).toContain(sanitised);
    expect(wb.SheetNames).toContain("FX_Takodana_HTTP");
    expect(wb.SheetNames.every((n) => n.length <= 31)).toBe(true);
  });

  it("lui pose son tableau et ses validations, comme aux autres", () => {
    expect(tableauxDuModele(donnees).map((t) => t.sheet)).toContain(sanitised);
    expect(validationsDuModele(donnees).map((v) => v.sheet)).toContain(sanitised);
  });
});

describe("modèle de classeur — nature et relais", () => {
  it("propose la nature en liste fermée sur ActorTypes", () => {
    const lists = listesDuModele();
    expect(lists.find((l) => l.name === "L_Nature")).toBeDefined();
  });

  // La lecture fonctionnelle tient sur deux colonnes. « Relays », en v3, vivait
  // sur la ligne d'interface ; elle a laissé place à « Republished as » sur la
  // ligne de consommation, qui seule sait de quel fournisseur et de quelle
  // version vient l'entrée -- et qu'une liste déroulante peut guider.
  it("écrit les deux colonnes qui portent la lecture fonctionnelle", () => {
    const paquet = writeTemplate(DONNEES_EXEMPLE);
    const wb = XLSX.read(new Uint8Array(paquet), { type: "array" });
    const types = XLSX.utils.sheet_to_json<string[]>(wb.Sheets["ActorTypes"], { header: 1 })[0];
    const interfaces = XLSX.utils.sheet_to_json<string[]>(wb.Sheets["Interfaces"], { header: 1 })[0];
    const nomFx = wb.SheetNames.find((n) => n.startsWith("FX_"))!;
    const fx = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[nomFx], { header: 1 })[0];
    expect(types).toContain("Nature");
    expect(fx).toContain("Republished as");
    expect(interfaces).not.toContain("Relays");
  });
});

// --- QA : les deux référentiels du classeur, quand ils ne font pas exactement
// la taille de l'amorce. Le tableau structuré est dimensionné sur l'amorce
// (ICONES_PAR_DEFAUT, TYPES_FLUX) et non sur les données réellement écrites :
// la liste déroulante qui le vise se remplit donc de lignes vides quand
// l'équipe en a retiré, et perd des valeurs quand elle en a ajouté.
describe("modèle de classeur — tableaux des référentiels dimensionnés sur les données", () => {
  const donnees: DonneesClasseur = {
    flowTypes: [
      ["HTTP", "consumer → provider", "REST"],
      ["Kafka", "provider → consumer", "événements"],
      ["SFTP", "provider → consumer", "fichiers"],
    ],
    actorTypes: [
      ["Application", "app-window", ""],
      ["Service", "cog", ""],
      ["Packaged product", "package", ""],
      ["Partner", "handshake", ""],
      ["Person", "user", ""],
      ["Infrastructure", "server", ""],
      ["Database", "database", ""],
      ["Queue", "server", ""],
      ["Gateway", "server", ""],
    ],
    milestones: [],
    groups: [],
    actors: [],
    interfaces: [],
    fx: [],
  };

  const table = (sheet: string) => tableauxDuModele(donnees).find((t) => t.sheet === sheet)!;

  it("borne le tableau FlowTypes aux types réellement écrits", () => {
    expect(table("FlowTypes").rows).toBe(donnees.flowTypes.length);
  });

  it("étend le tableau ActorTypes à tous les types réellement écrits", () => {
    expect(table("ActorTypes").rows).toBe(donnees.actorTypes.length);
  });

  it("ne laisse aucun type d'acteur hors du tableau qui alimente L_TypeActeur", () => {
    const wb = XLSX.read(new Uint8Array(writeTemplate(donnees)), { type: "array" });
    const rows = XLSX.utils.sheet_to_json<string[]>(wb.Sheets["ActorTypes"], { header: 1, defval: "" });
    expect(rows.length - 1).toBe(table("ActorTypes").rows);
  });
});

// --- QA : le classeur pose ses validations et ses tables d'appoint sur une
// plage figée à 1000 lignes. Au-delà, une saisie n'est plus contrôlée et les
// listes dépendantes cessent de voir les flux -- sans que rien ne le dise.
describe("modèle de classeur — grands classeurs", () => {
  const NB = 1200;
  const grand: DonneesClasseur = {
    flowTypes: [], actorTypes: [], milestones: [], groups: [], actors: [], fx: [],
    interfaces: Array.from({ length: NB }, (_, i) => [
      `Flux ${i}`, "1.0", "Tatooine", "HTTP", "", "", "", "No", "", "", "",
    ]),
  };

  it("étend les validations au-delà de la millième ligne", () => {
    const xml = feuilleXml("Interfaces", writeTemplate(grand));
    const sqrefs = [...xml.matchAll(/sqref="[A-Z]+2:[A-Z]+(\d+)"/g)].map((m) => Number(m[1]));
    expect(sqrefs.length).toBeGreaterThan(0);
    expect(Math.min(...sqrefs)).toBeGreaterThan(NB);
  });

  it("étend les tables d'appoint au-delà de la millième ligne", () => {
    const xml = feuilleXml("Lists", writeTemplate(grand));
    const dimension = xml.match(/<dimension ref="A1:[A-Z]+(\d+)"/);
    expect(Number(dimension![1])).toBeGreaterThan(NB);
  });
});

// --- QA : la liste « Version » d'un onglet FX_ ne s'ouvre pas tant que la
// colonne « Flow name » est vide -- la source s'évalue en #N/A, contrepartie
// assumée du MATCH exact. Rien ne le disait à celui qui saisit : il voyait une
// liste morte. Excel sait afficher une bulle à la sélection de la cellule ; le
// drapeau était posé, le texte manquait.
describe("modèle de classeur — invites de saisie", () => {
  const validations = () => validationsDuModele(DONNEES_EXEMPLE);

  it("explique l'ordre de saisie sur la colonne Version d'un onglet FX_", () => {
    const version = validations().find((v) => v.sheet.startsWith("FX_") && v.prompt?.text.includes("Flow name"));
    expect(version).toBeDefined();
  });

  it("écrit l'invite dans le XML de la feuille", () => {
    const paquet = writeTemplate(DONNEES_EXEMPLE);
    const wb = XLSX.read(new Uint8Array(paquet), { type: "array" });
    const nomFx = wb.SheetNames.find((n) => n.startsWith("FX_") && n !== "FX_Modèle")!;
    const xml = feuilleXml(nomFx, paquet);
    expect(xml).toContain("promptTitle=");
    expect(xml).toContain("prompt=");
  });

  // Toute colonne de saisie porte désormais son infobulle, liste ou pas :
  // c'était la moitié du classeur qui ne disait rien, et justement celle où
  // l'on hésite.
  it("explique chaque colonne de saisie", () => {
    const sansInvite = validations().filter((v) => !v.prompt);
    expect(sansInvite).toEqual([]);
  });

  // Une invite vide n'a rien à écrire : le classeur ne doit pas se couvrir
  // d'attributs vides.
  it("n'écrit jamais une invite vide", () => {
    for (const v of validations()) {
      expect(v.prompt?.title.trim()).toBeTruthy();
      expect(v.prompt?.text.trim()).toBeTruthy();
    }
  });
});

// --- QA : le nom d'onglet est assaini côté outil (assainirNomOnglet). La
// formule Excel des tables d'appoint reconstruit ce même nom pour retrouver
// les flux d'un onglet : si elle ne refait pas l'assainissement à l'identique,
// les listes dépendantes d'un onglet au nom raccourci cherchent un onglet qui
// n'existe pas, et restent vides.
describe("modèle de classeur — la formule Excel assainit comme l'outil", () => {
  // On n'extrait que la formule : comparer le XML entier noierait l'échec.
  const formuleAppoint = () => {
    const xml = feuilleXml("Lists", writeTemplate(DONNEES_EXEMPLE));
    const m = xml.match(/<f t="array"[^>]*>([^<]*)<\/f>/);
    if (!m) throw new Error("aucune formule à résultat étalé dans l'onglet Lists");
    return m[1];
  };

  it("coupe le nom reconstruit à 31 caractères", () => {
    expect(formuleAppoint()).toContain("LEFT(");
    expect(formuleAppoint()).toContain(",31)");
  });

  it("remplace chacun des caractères qu'Excel interdit", () => {
    const substitutions = (formuleAppoint().match(/SUBSTITUTE\(/g) ?? []).length;
    expect(substitutions).toBe(7);
  });
});

// --- Le plancher des validations : sur un petit classeur, la liste déroulante
// doit descendre bien plus bas que les lignes déjà écrites, sans quoi la
// première saisie sous la dernière ligne ne serait plus contrôlée. Mesuré par
// mutation : abaisser ce plancher de 1000 à 2 ne faisait tomber aucun test.
describe("modèle de classeur — le plancher des validations", () => {
  it("valide loin sous les lignes déjà écrites, même sur un classeur minuscule", () => {
    const xml = feuilleXml("Actors", writeTemplate());
    const upTo = [...xml.matchAll(/sqref="[A-Z]+2:[A-Z]+(\d+)"/g)].map((m) => Number(m[1]));
    expect(upTo.length).toBeGreaterThan(0);
    expect(Math.min(...upTo)).toBeGreaterThanOrEqual(1000);
  });
});

// --- QA : l'outil ne posait aucune propriété de document. Un classeur qu'il
// venait de produire se relisait donc SANS date de sauvegarde, et le cartouche
// de chaque schéma annonçait « save date unknown » sur des données fraîches --
// ce qui donne à l'outil l'air de mal lire les fichiers Excel.
describe("écrireModele — les propriétés du document", () => {
  const LE_JOUR = new Date("2026-08-22T09:00:00Z");

  it("écrit la date de sauvegarde, et la relecture la retrouve", () => {
    expect(parseWorkbook(writeTemplate(DONNEES_EXEMPLE, LE_JOUR)).savedAt?.toISOString()).toBe(
      "2026-08-22T09:00:00.000Z"
    );
  });

  // La date est injectée, pas lue de l'horloge : c'est ce qui rend l'écriture
  // reproductible, comme la mise à niveau le fait déjà.
  it("prend la date qu'on lui donne plutôt que l'heure courante", () => {
    const autre = new Date("2020-01-02T03:04:05Z");
    expect(parseWorkbook(writeTemplate(DONNEES_EXEMPLE, autre)).savedAt?.toISOString()).toBe(autre.toISOString());
  });

  // Les tableaux structurés, les listes et les validations sont posés APRÈS
  // l'écriture SheetJS, en réécrivant le zip : ils ne doivent pas emporter
  // docProps/core.xml au passage.
  it("garde la date malgré la réécriture du classeur", () => {
    const relu = parseWorkbook(writeTemplate(DONNEES_EXEMPLE, LE_JOUR));
    expect(relu.savedAt).not.toBeNull();
    expect(relu.sheets.some((f) => f.name === "Interfaces")).toBe(true);
  });
});

// --- L'onglet d'explication et les aides à la saisie. La moitié du classeur
// ne disait rien : les colonnes de saisie libre n'avaient aucune infobulle,
// alors que ce sont celles où l'on hésite.
describe("modèle de classeur — les aides à la saisie", () => {
  const feuillesDeSaisie = ["Actors", "Groups", "Milestones", "ActorTypes", "FlowTypes", "Interfaces"];

  it("pose une infobulle sur chaque colonne de chaque feuille de saisie", () => {
    const validations = validationsDuModele();
    const colonnesDe: Record<string, readonly string[]> = {
      Actors: COLONNES_ACTEURS,
      Groups: COLONNES_GROUPES,
      Milestones: COLONNES_PALIERS,
      ActorTypes: COLONNES_TYPESACTEUR,
      FlowTypes: COLONNES_TYPESFLUX,
      Interfaces: COLONNES_INTERFACES,
    };
    for (const sheet of feuillesDeSaisie) {
      const applied = new Set(validations.filter((v) => v.sheet === sheet).map((v) => v.column));
      for (const [i] of colonnesDe[sheet].entries()) {
        expect(applied, `${sheet} : column ${i + 1} sans infobulle`).toContain(XLSX.utils.encode_col(i));
      }
    }
  });

  // Une infobulle déclarée pour une colonne qui n'existe pas ne sert personne
  // et donne l'illusion d'une couverture.
  it("ne déclare aucune infobulle pour une colonne inexistante", () => {
    const toutes = [
      ...COLONNES_ACTEURS, ...COLONNES_GROUPES, ...COLONNES_PALIERS,
      ...COLONNES_TYPESACTEUR, ...COLONNES_TYPESFLUX, ...COLONNES_INTERFACES, ...COLONNES_FX,
    ];
    for (const key of Object.keys(INVITES)) {
      const heading = key.includes(".") ? key.split(".")[1] : key;
      expect(toutes, `prompt orpheline : ${key}`).toContain(heading);
    }
  });
});
