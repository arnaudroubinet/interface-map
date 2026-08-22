# Carte des interfaces — Implementation Plan
> **ARCHIVE — ce plan est exécuté, et il n'est plus tenu à jour.**
> Il décrit l'état d'un chantier terminé, avec les cases à cocher qui servaient
> à le suivre : elles n'attendent personne. Le code fait foi ; là où les deux
> divergent, c'est ce document qui a vieilli. Conservé pour ce qu'il explique
> des décisions prises, pas comme une consigne.

**Goal:** Build the single-file `.html` tool described in the spec — reads a `.xlsx`/`.xlsm` cartography workbook dropped into the page, renders 6 views (SVG diagrams + matrix + integrity report), exports SVG/PNG, never writes anything.

**Architecture:** Pure TypeScript pipeline (parsing → integrity checks → aggregation → dagre layout → SVG/HTML rendering) with a thin `ui/` layer doing full re-render on every state change. No framework. esbuild bundles everything (including SheetJS and dagre) into one self-contained `.html`.

**Tech Stack:** TypeScript, Vitest (+ jsdom environment), esbuild, `xlsx` (SheetJS), `dagre`.

**Spec:** `docs/superpowers/specs/2026-08-14-carto-interfaces-design.md` — this plan implements it section by section; read both together. Section numbers below (`§x`) refer to that document.

## Global Constraints

- Final deliverable is one `.html` file, no CDN, no external network calls, no local storage (§2.1, §2.5, §2.6).
- Accepts `.xlsx` and `.xlsm` (macro content ignored) (§2.3).
- Header/sheet-name matching is case/accent/whitespace-insensitive (§3.3); `FX_Modèle` is ignored as a consumption sheet (§3.1).
- Vue cible exclusion = `Décision=À supprimer` OR `Statut=Décommissionné` (consommation, exposant, or consommateur) (§4.4).
- Compteur and épaisseur are the same quantity: number of consommations merged onto an edge (§4.2).
- No accessibility requirements (removed from spec by explicit decision — see "Décisions issues de la revue").
- All French UI strings (labels, messages) stay in French, matching the spec's own wording; code identifiers stay in French where the spec uses French domain terms (e.g. `acteurExposant`), in English where they are generic technical concepts (e.g. `ParsedModel`, `LayoutResult`) — follow the exact names given in this plan for consistency across tasks.

All source lives under `app/` at the repo root:

```
app/
  package.json, tsconfig.json, vitest.config.ts, esbuild.build.mjs, index.html
  src/
    shared/text.ts
    parsing/model.ts, headers.ts, workbook.ts, build-model.ts
    integrity/checks.ts
    aggregation/core.ts, views.ts
    layout/dagre-layout.ts
    render/colors.ts, svg-builder.ts, matrix-table.ts, integrity-report.ts
    export/filename.ts, svg-export.ts, png-export.ts
    ui/state.ts, dom.ts, drop-zone.ts, banner.ts, rail.ts, app.ts
    main.ts
  test/integration.test.ts
```

---

### Task 1: Project scaffolding + shared/text.ts

**Files:**
- Create: `app/package.json`
- Create: `app/tsconfig.json`
- Create: `app/vitest.config.ts`
- Create: `app/src/shared/text.ts`
- Test: `app/src/shared/text.test.ts`

**Interfaces:**
- Produces: `normalizeText(s: string): string` — trims, collapses internal whitespace to a single space, strips diacritics, lowercases. Used by every later task that matches headers, sheet names, or controlled-vocabulary values (Statut, Décision, Sens de représentation...).

- [ ] **Step 1: Create the project files**

`app/package.json`:
```json
{
  "name": "carto-interfaces",
  "private": true,
  "type": "module",
  "version": "1.0.0",
  "scripts": {
    "build": "node esbuild.build.mjs",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@types/dagre": "^0.7.52",
    "@types/node": "^22.0.0",
    "esbuild": "^0.24.0",
    "jsdom": "^25.0.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  },
  "dependencies": {
    "dagre": "^0.8.5",
    "xlsx": "^0.18.5"
  }
}
```

`app/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src", "test"]
}
```

`app/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
  },
});
```

- [ ] **Step 2: Install dependencies**

Run: `cd app && npm install`
Expected: `node_modules/` populated, no errors.

- [ ] **Step 3: Write the failing test**

`app/src/shared/text.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { normalizeText } from "./text";

describe("normalizeText", () => {
  it("trims and lowercases", () => {
    expect(normalizeText("  Nom  ")).toBe("nom");
  });

  it("collapses multiple internal spaces", () => {
    expect(normalizeText("Type   de    flux")).toBe("type de flux");
  });

  it("strips accents", () => {
    expect(normalizeText("Périmètre")).toBe("perimetre");
    expect(normalizeText("Décommissionné")).toBe("decommissionne");
  });

  it("is case-insensitive", () => {
    expect(normalizeText("ACTEUR EXPOSANT")).toBe(normalizeText("acteur exposant"));
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd app && npx vitest run src/shared/text.test.ts`
Expected: FAIL — `text.ts` does not exist / `normalizeText` not defined.

- [ ] **Step 5: Write the implementation**

`app/src/shared/text.ts`:
```ts
export function normalizeText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd app && npx vitest run src/shared/text.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
git add app/package.json app/package-lock.json app/tsconfig.json app/vitest.config.ts app/src/shared/text.ts app/src/shared/text.test.ts
git commit -m "chore: scaffold app project and add text normalization helper"
```

---

### Task 2: parsing/model.ts + parsing/headers.ts

**Files:**
- Create: `app/src/parsing/model.ts`
- Create: `app/src/parsing/headers.ts`
- Test: `app/src/parsing/headers.test.ts`

**Interfaces:**
- Consumes: `normalizeText` from `../shared/text` (Task 1).
- Produces (model.ts, types only, consumed by every later parsing/integrity/aggregation task): `RawSheet`, `ParsedWorkbook`, `Acteur`, `TypeFlux`, `InterfaceCatalogue`, `Consommation`, `ParsedModel`, `BlockingError`, `BuildModelResult`.
- Produces (headers.ts): `findHeader(actualHeaders: string[], expected: string): string | undefined`, `matchesSheetName(actualName: string, expected: string): boolean`, `hasPrefix(actualName: string, prefix: string): boolean`.

- [ ] **Step 1: Write the types file (no test — no runtime behavior)**

`app/src/parsing/model.ts`:
```ts
export interface RawSheet {
  name: string;
  rows: Record<string, string>[];
}

export interface ParsedWorkbook {
  sheets: RawSheet[];
  fichierModifie: Date | null;
}

export interface Acteur {
  nom: string;
  groupe: string;
  perimetre: string;
  typeActeur: string;
  statut: string;
  responsable: string;
  description: string;
  commentaires: string;
}

export interface TypeFlux {
  type: string;
  sensRepresentation: "exposant-consommateur" | "consommateur-exposant";
  description: string;
}

export interface InterfaceCatalogue {
  nomDuFlux: string;
  acteurExposant: string;
  typeDeFlux: string;
  description: string;
  lienContrat: string;
  referenceContrat: string;
  commentaires: string;
  aConfirmer: boolean;
  feuilleAttendue: string;
  feuilleValide: boolean;
}

export interface Consommation {
  nomDuFlux: string;
  acteurConsommateur: string;
  usage: string;
  criticite: string;
  statut: string;
  decision: string;
  commentaires: string;
  feuille: string;
}

export interface ParsedModel {
  acteurs: Acteur[];
  typesFlux: TypeFlux[];
  interfaces: InterfaceCatalogue[];
  consommations: Consommation[];
  fxSheetNames: string[];
  colonnesOptionnellesAbsentes: { feuille: string; colonne: string }[];
  fichierModifie: Date | null;
}

export interface BlockingError {
  message: string;
}

export type BuildModelResult =
  | { ok: true; model: ParsedModel }
  | { ok: false; erreurs: BlockingError[] };
```

- [ ] **Step 2: Write the failing test for headers.ts**

`app/src/parsing/headers.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { findHeader, matchesSheetName, hasPrefix } from "./headers";

describe("findHeader", () => {
  it("matches ignoring case, accents and spacing", () => {
    expect(findHeader(["  type   de flux "], "Type de flux")).toBe("  type   de flux ");
    expect(findHeader(["Périmètre"], "perimetre")).toBe("Périmètre");
  });

  it("returns undefined when absent", () => {
    expect(findHeader(["Nom", "Groupe"], "Statut")).toBeUndefined();
  });

  it("ignores unexpected extra columns without matching them by accident", () => {
    expect(findHeader(["Commentaire libre"], "Commentaires")).toBeUndefined();
  });
});

describe("matchesSheetName", () => {
  it("matches ignoring case and accents", () => {
    expect(matchesSheetName("acteurs", "Acteurs")).toBe(true);
    expect(matchesSheetName("MODE D'EMPLOI", "Mode d'emploi")).toBe(true);
  });

  it("rejects different names", () => {
    expect(matchesSheetName("Listes", "Acteurs")).toBe(false);
  });
});

describe("hasPrefix", () => {
  it("matches the FX_ prefix case-insensitively", () => {
    expect(hasPrefix("fx_Tatooine_HTTP", "FX_")).toBe(true);
    expect(hasPrefix("Interfaces", "FX_")).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd app && npx vitest run src/parsing/headers.test.ts`
Expected: FAIL — `headers.ts` does not exist.

- [ ] **Step 4: Write the implementation**

`app/src/parsing/headers.ts`:
```ts
import { normalizeText } from "../shared/text";

export function findHeader(actualHeaders: string[], expected: string): string | undefined {
  const target = normalizeText(expected);
  return actualHeaders.find((h) => normalizeText(h) === target);
}

export function matchesSheetName(actualName: string, expected: string): boolean {
  return normalizeText(actualName) === normalizeText(expected);
}

export function hasPrefix(actualName: string, prefix: string): boolean {
  return normalizeText(actualName).startsWith(normalizeText(prefix));
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd app && npx vitest run src/parsing/headers.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add app/src/parsing/model.ts app/src/parsing/headers.ts app/src/parsing/headers.test.ts
git commit -m "feat: add parsed-model types and header/sheet-name matching"
```

---

### Task 3: parsing/workbook.ts

**Files:**
- Create: `app/src/parsing/workbook.ts`
- Test: `app/src/parsing/workbook.test.ts`

**Interfaces:**
- Consumes: `RawSheet`, `ParsedWorkbook` from `./model` (Task 2). `xlsx` package.
- Produces: `parseWorkbook(buffer: ArrayBuffer): ParsedWorkbook` — used by `ui/app.ts` (Task 13) to turn a dropped `File`'s bytes into raw sheets, and by the integration test (Task 15).

- [ ] **Step 1: Write the failing test**

`app/src/parsing/workbook.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { parseWorkbook } from "./workbook";

function buildFixtureBuffer(modifiedDate: Date): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    ["Nom", "Groupe"],
    ["Tatooine", "Socle"],
    ["", ""],
  ]);
  XLSX.utils.book_append_sheet(wb, sheet, "Acteurs");
  wb.Props = { ModifiedDate: modifiedDate };
  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  return out;
}

describe("parseWorkbook", () => {
  it("reads sheet names and rows keyed by header", () => {
    const buffer = buildFixtureBuffer(new Date("2026-08-01T10:00:00Z"));
    const result = parseWorkbook(buffer);
    expect(result.sheets).toHaveLength(1);
    expect(result.sheets[0].name).toBe("Acteurs");
    expect(result.sheets[0].rows[0]).toEqual({ Nom: "Tatooine", Groupe: "Socle" });
  });

  it("reads the core.xml modified date", () => {
    const buffer = buildFixtureBuffer(new Date("2026-08-01T10:00:00Z"));
    const result = parseWorkbook(buffer);
    expect(result.fichierModifie).toBeInstanceOf(Date);
    expect(result.fichierModifie?.toISOString()).toBe("2026-08-01T10:00:00.000Z");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/parsing/workbook.test.ts`
Expected: FAIL — `workbook.ts` does not exist.

- [ ] **Step 3: Write the implementation**

`app/src/parsing/workbook.ts`:
```ts
import * as XLSX from "xlsx";
import type { RawSheet, ParsedWorkbook } from "./model";

export function parseWorkbook(buffer: ArrayBuffer): ParsedWorkbook {
  const wb = XLSX.read(buffer, { type: "array", bookProps: true, cellDates: true });

  const sheets: RawSheet[] = wb.SheetNames.map((name) => {
    const sheet = wb.Sheets[name];
    const rows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, {
      defval: "",
      raw: false,
    });
    return { name, rows };
  });

  const modifiedDate = wb.Props?.ModifiedDate;
  const fichierModifie = modifiedDate instanceof Date ? modifiedDate : null;

  return { sheets, fichierModifie };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/parsing/workbook.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add app/src/parsing/workbook.ts app/src/parsing/workbook.test.ts
git commit -m "feat: parse xlsx buffers into raw sheets via SheetJS"
```

---

### Task 4: parsing/build-model.ts

**Files:**
- Create: `app/src/parsing/build-model.ts`
- Test: `app/src/parsing/build-model.test.ts`

**Interfaces:**
- Consumes: types from `./model`, `findHeader`/`matchesSheetName`/`hasPrefix` from `./headers` (Task 2).
- Produces: `buildModel(workbook: ParsedWorkbook): BuildModelResult` — consumed by `integrity/checks.ts` (Task 5), `aggregation/core.ts` (Task 6), `ui/app.ts` (Task 13), integration test (Task 15).

- [ ] **Step 1: Write the failing tests**

`app/src/parsing/build-model.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { buildModel } from "./build-model";
import type { ParsedWorkbook, RawSheet } from "./model";

function wb(sheets: RawSheet[]): ParsedWorkbook {
  return { sheets, fichierModifie: null };
}

const acteursOk: RawSheet = {
  name: "Acteurs",
  rows: [
    { Nom: "Tatooine", Groupe: "Socle", "Périmètre": "Plateforme", "Type d'acteur": "Application", Statut: "Actif", Responsable: "", Description: "", Commentaires: "" },
    { Nom: "Mygeeto", Groupe: "Ryloth", "Périmètre": "Externe", "Type d'acteur": "Application", Statut: "Actif", Responsable: "", Description: "", Commentaires: "" },
  ],
};

const typesFluxOk: RawSheet = {
  name: "TypesFlux",
  rows: [
    { "Type de flux": "HTTP", "Sens de représentation": "consommateur → exposant", Description: "" },
    { "Type de flux": "Kafka", "Sens de représentation": "exposant → consommateur", Description: "" },
  ],
};

const interfacesOk: RawSheet = {
  name: "Interfaces",
  rows: [
    { "Nom du flux": "Authent", "Acteur exposant": "Tatooine", "Type de flux": "HTTP", Description: "Ouverture de session", "Lien contrat": "", "Référence contrat": "MOD1", Commentaires: "", "À confirmer": "" },
  ],
};

const fxTatooineHttp: RawSheet = {
  name: "FX_Tatooine_HTTP",
  rows: [
    { "Nom du flux": "Authent", "Acteur consommateur": "Mygeeto", Usage: "Ouverture", "Criticité pour ce consommateur": "1 - Vitale", Statut: "Actif", "Décision": "À conserver", Commentaires: "" },
  ],
};

describe("buildModel — happy path", () => {
  it("builds the referential, catalog and consumptions", () => {
    const result = buildModel(wb([acteursOk, typesFluxOk, interfacesOk, fxTatooineHttp]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.acteurs).toHaveLength(2);
    expect(result.model.typesFlux).toHaveLength(2);
    expect(result.model.interfaces).toHaveLength(1);
    expect(result.model.interfaces[0].feuilleAttendue).toBe("FX_Tatooine_HTTP");
    expect(result.model.interfaces[0].feuilleValide).toBe(true);
    expect(result.model.consommations).toHaveLength(1);
    expect(result.model.consommations[0].feuille).toBe("FX_Tatooine_HTTP");
    expect(result.model.fxSheetNames).toEqual(["FX_Tatooine_HTTP"]);
  });

  it("matches sheet names case/accent-insensitively", () => {
    const result = buildModel(
      wb([
        { ...acteursOk, name: "acteurs" },
        { ...typesFluxOk, name: "TYPESFLUX" },
        interfacesOk,
      ])
    );
    expect(result.ok).toBe(true);
  });

  it("ignores FX_Modèle as a consumption sheet", () => {
    const modele: RawSheet = { name: "FX_Modèle", rows: [] };
    const result = buildModel(wb([acteursOk, typesFluxOk, interfacesOk, fxTatooineHttp, modele]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.fxSheetNames).toEqual(["FX_Tatooine_HTTP"]);
  });

  it("drops rows with no content in any expected column", () => {
    const withBlankRow: RawSheet = {
      ...acteursOk,
      rows: [...acteursOk.rows, { Nom: "", Groupe: "", "Périmètre": "", "Type d'acteur": "", Statut: "", Responsable: "", Description: "", Commentaires: "" }],
    };
    const result = buildModel(wb([withBlankRow, typesFluxOk, interfacesOk]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.acteurs).toHaveLength(2);
  });

  it("flags a reconstructed FX_ name that exceeds 31 characters as invalid", () => {
    const longType: RawSheet = {
      name: "TypesFlux",
      rows: [{ "Type de flux": "Un type de flux vraiment beaucoup trop long", "Sens de représentation": "consommateur → exposant", Description: "" }],
    };
    const longInterfaces: RawSheet = {
      name: "Interfaces",
      rows: [{ "Nom du flux": "X", "Acteur exposant": "Tatooine", "Type de flux": "Un type de flux vraiment beaucoup trop long", Description: "", "Lien contrat": "", "Référence contrat": "", Commentaires: "", "À confirmer": "" }],
    };
    const result = buildModel(wb([acteursOk, longType, longInterfaces]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.interfaces[0].feuilleValide).toBe(false);
  });

  it("tracks non-key columns missing from a sheet's header row", () => {
    const acteursNoGroupe: RawSheet = {
      name: "Acteurs",
      rows: [{ Nom: "Tatooine" }],
    };
    const result = buildModel(wb([acteursNoGroupe, typesFluxOk, interfacesOk]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.colonnesOptionnellesAbsentes).toContainEqual({ feuille: "Acteurs", colonne: "Groupe" });
  });
});

describe("buildModel — blocking errors", () => {
  it("blocks when a structuring sheet is missing", () => {
    const result = buildModel(wb([acteursOk, typesFluxOk]));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.erreurs.some((e) => e.message.includes("Interfaces"))).toBe(true);
  });

  it("blocks when a key column is missing", () => {
    const acteursSansNom: RawSheet = { name: "Acteurs", rows: [{ Groupe: "Socle" }] };
    const result = buildModel(wb([acteursSansNom, typesFluxOk, interfacesOk]));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.erreurs.some((e) => e.message.includes("Nom"))).toBe(true);
  });

  it("reports every blocking cause at once", () => {
    const result = buildModel(wb([]));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.erreurs).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/parsing/build-model.test.ts`
Expected: FAIL — `build-model.ts` does not exist.

- [ ] **Step 3: Write the implementation**

`app/src/parsing/build-model.ts`:
```ts
import type {
  RawSheet,
  ParsedWorkbook,
  Acteur,
  TypeFlux,
  InterfaceCatalogue,
  Consommation,
  BuildModelResult,
  BlockingError,
} from "./model";
import { matchesSheetName, hasPrefix, findHeader } from "./headers";

const CARACTERES_INTERDITS = /[:\\/?*[\]]/;

const COLONNES_ACTEURS = ["Nom", "Groupe", "Périmètre", "Type d'acteur", "Statut", "Responsable", "Description", "Commentaires"];
const COLONNES_TYPESFLUX = ["Type de flux", "Sens de représentation", "Description"];
const COLONNES_INTERFACES = ["Nom du flux", "Acteur exposant", "Type de flux", "Description", "Lien contrat", "Référence contrat", "Commentaires", "À confirmer"];
const COLONNES_FX = ["Nom du flux", "Acteur consommateur", "Usage", "Criticité pour ce consommateur", "Statut", "Décision", "Commentaires"];

function findSheet(sheets: RawSheet[], name: string): RawSheet | undefined {
  return sheets.find((s) => matchesSheetName(s.name, name));
}

function actualHeadersOf(rows: Record<string, string>[]): string[] {
  return rows.length > 0 ? Object.keys(rows[0]) : [];
}

function buildHeaderMap(actualHeaders: string[], attendus: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const attendu of attendus) {
    const found = findHeader(actualHeaders, attendu);
    if (found) map.set(attendu, found);
  }
  return map;
}

function get(row: Record<string, string>, headerMap: Map<string, string>, canonique: string): string {
  const actual = headerMap.get(canonique);
  return actual ? (row[actual] ?? "").toString().trim() : "";
}

function rowHasContent(row: Record<string, string>, headerMap: Map<string, string>, colonnes: string[]): boolean {
  return colonnes.some((c) => get(row, headerMap, c) !== "");
}

function normSens(raw: string): "exposant-consommateur" | "consommateur-exposant" {
  return raw.trim().toLowerCase().startsWith("exposant") ? "exposant-consommateur" : "consommateur-exposant";
}

function normOui(raw: string): boolean {
  return raw.trim().toLowerCase() === "oui";
}

function nomOngletValide(nom: string): boolean {
  return nom.length <= 31 && !CARACTERES_INTERDITS.test(nom);
}

export function buildModel(workbook: ParsedWorkbook): BuildModelResult {
  const erreurs: BlockingError[] = [];

  const feuilleActeurs = findSheet(workbook.sheets, "Acteurs");
  const feuilleTypesFlux = findSheet(workbook.sheets, "TypesFlux");
  const feuilleInterfaces = findSheet(workbook.sheets, "Interfaces");

  if (!feuilleActeurs) erreurs.push({ message: 'Feuille "Acteurs" absente du classeur.' });
  if (!feuilleTypesFlux) erreurs.push({ message: 'Feuille "TypesFlux" absente du classeur.' });
  if (!feuilleInterfaces) erreurs.push({ message: 'Feuille "Interfaces" absente du classeur.' });

  if (!feuilleActeurs || !feuilleTypesFlux || !feuilleInterfaces) {
    return { ok: false, erreurs };
  }

  const headersActeurs = actualHeadersOf(feuilleActeurs.rows);
  const headersTypesFlux = actualHeadersOf(feuilleTypesFlux.rows);
  const headersInterfaces = actualHeadersOf(feuilleInterfaces.rows);

  if (!findHeader(headersActeurs, "Nom")) {
    erreurs.push({ message: 'Colonne clé "Nom" absente de la feuille "Acteurs".' });
  }
  if (!findHeader(headersTypesFlux, "Type de flux")) {
    erreurs.push({ message: 'Colonne clé "Type de flux" absente de la feuille "TypesFlux".' });
  }
  if (!findHeader(headersInterfaces, "Nom du flux")) {
    erreurs.push({ message: 'Colonne clé "Nom du flux" absente de la feuille "Interfaces".' });
  }

  if (erreurs.length > 0) {
    return { ok: false, erreurs };
  }

  const colonnesOptionnellesAbsentes: { feuille: string; colonne: string }[] = [];
  function noterColonnesAbsentes(feuille: string, actualHeaders: string[], attendues: string[]) {
    for (const attendue of attendues) {
      if (!findHeader(actualHeaders, attendue)) {
        colonnesOptionnellesAbsentes.push({ feuille, colonne: attendue });
      }
    }
  }

  noterColonnesAbsentes("Acteurs", headersActeurs, COLONNES_ACTEURS.filter((c) => c !== "Nom"));
  noterColonnesAbsentes("TypesFlux", headersTypesFlux, COLONNES_TYPESFLUX.filter((c) => c !== "Type de flux"));
  noterColonnesAbsentes("Interfaces", headersInterfaces, COLONNES_INTERFACES.filter((c) => c !== "Nom du flux"));

  const headerMapActeurs = buildHeaderMap(headersActeurs, COLONNES_ACTEURS);
  const acteurs: Acteur[] = feuilleActeurs.rows
    .filter((r) => rowHasContent(r, headerMapActeurs, COLONNES_ACTEURS))
    .map((r) => ({
      nom: get(r, headerMapActeurs, "Nom"),
      groupe: get(r, headerMapActeurs, "Groupe"),
      perimetre: get(r, headerMapActeurs, "Périmètre"),
      typeActeur: get(r, headerMapActeurs, "Type d'acteur"),
      statut: get(r, headerMapActeurs, "Statut"),
      responsable: get(r, headerMapActeurs, "Responsable"),
      description: get(r, headerMapActeurs, "Description"),
      commentaires: get(r, headerMapActeurs, "Commentaires"),
    }))
    .filter((a) => a.nom !== "");

  const headerMapTypesFlux = buildHeaderMap(headersTypesFlux, COLONNES_TYPESFLUX);
  const typesFlux: TypeFlux[] = feuilleTypesFlux.rows
    .filter((r) => rowHasContent(r, headerMapTypesFlux, COLONNES_TYPESFLUX))
    .map((r) => ({
      type: get(r, headerMapTypesFlux, "Type de flux"),
      sensRepresentation: normSens(get(r, headerMapTypesFlux, "Sens de représentation")),
      description: get(r, headerMapTypesFlux, "Description"),
    }))
    .filter((t) => t.type !== "");

  const headerMapInterfaces = buildHeaderMap(headersInterfaces, COLONNES_INTERFACES);
  const interfaces: InterfaceCatalogue[] = feuilleInterfaces.rows
    .filter((r) => rowHasContent(r, headerMapInterfaces, COLONNES_INTERFACES))
    .map((r) => {
      const nomDuFlux = get(r, headerMapInterfaces, "Nom du flux");
      const acteurExposant = get(r, headerMapInterfaces, "Acteur exposant");
      const typeDeFlux = get(r, headerMapInterfaces, "Type de flux");
      const feuilleAttendue = `FX_${acteurExposant}_${typeDeFlux}`;
      return {
        nomDuFlux,
        acteurExposant,
        typeDeFlux,
        description: get(r, headerMapInterfaces, "Description"),
        lienContrat: get(r, headerMapInterfaces, "Lien contrat"),
        referenceContrat: get(r, headerMapInterfaces, "Référence contrat"),
        commentaires: get(r, headerMapInterfaces, "Commentaires"),
        aConfirmer: normOui(get(r, headerMapInterfaces, "À confirmer")),
        feuilleAttendue,
        feuilleValide: nomOngletValide(feuilleAttendue),
      };
    })
    .filter((i) => i.nomDuFlux !== "");

  const fxSheets = workbook.sheets.filter(
    (s) => hasPrefix(s.name, "FX_") && !matchesSheetName(s.name, "FX_Modèle")
  );
  const fxSheetNames = fxSheets.map((s) => s.name);

  const consommations: Consommation[] = [];
  for (const feuille of fxSheets) {
    const headersFx = actualHeadersOf(feuille.rows);
    noterColonnesAbsentes(feuille.name, headersFx, COLONNES_FX);
    const headerMapFx = buildHeaderMap(headersFx, COLONNES_FX);
    for (const r of feuille.rows) {
      if (!rowHasContent(r, headerMapFx, COLONNES_FX)) continue;
      const nomDuFlux = get(r, headerMapFx, "Nom du flux");
      if (nomDuFlux === "") continue;
      consommations.push({
        nomDuFlux,
        acteurConsommateur: get(r, headerMapFx, "Acteur consommateur"),
        usage: get(r, headerMapFx, "Usage"),
        criticite: get(r, headerMapFx, "Criticité pour ce consommateur"),
        statut: get(r, headerMapFx, "Statut"),
        decision: get(r, headerMapFx, "Décision"),
        commentaires: get(r, headerMapFx, "Commentaires"),
        feuille: feuille.name,
      });
    }
  }

  return {
    ok: true,
    model: {
      acteurs,
      typesFlux,
      interfaces,
      consommations,
      fxSheetNames,
      colonnesOptionnellesAbsentes,
      fichierModifie: workbook.fichierModifie,
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/parsing/build-model.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add app/src/parsing/build-model.ts app/src/parsing/build-model.test.ts
git commit -m "feat: build the parsed model from raw sheets"
```

---

### Task 5: integrity/checks.ts

**Files:**
- Create: `app/src/integrity/checks.ts`
- Test: `app/src/integrity/checks.test.ts`

**Interfaces:**
- Consumes: `ParsedModel`, `Acteur`, `InterfaceCatalogue` from `../parsing/model` (Task 2).
- Produces: `Anomaly`, `AnomalyFamily`, `InfoBlock`, `IntegrityReport`, `runIntegrityChecks(model: ParsedModel): IntegrityReport` — consumed by `render/integrity-report.ts` (Task 10) and `ui/app.ts` (Task 13).

- [ ] **Step 1: Write the failing tests**

`app/src/integrity/checks.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { runIntegrityChecks } from "./checks";
import type { ParsedModel, Acteur, InterfaceCatalogue, Consommation } from "../parsing/model";

function acteur(overrides: Partial<Acteur>): Acteur {
  return {
    nom: "A", groupe: "G", perimetre: "Externe", typeActeur: "Application",
    statut: "Actif", responsable: "", description: "d", commentaires: "",
    ...overrides,
  };
}

function iface(overrides: Partial<InterfaceCatalogue>): InterfaceCatalogue {
  return {
    nomDuFlux: "F", acteurExposant: "A", typeDeFlux: "HTTP", description: "d",
    lienContrat: "lien", referenceContrat: "", commentaires: "", aConfirmer: false,
    feuilleAttendue: "FX_A_HTTP", feuilleValide: true,
    ...overrides,
  };
}

function conso(overrides: Partial<Consommation>): Consommation {
  return {
    nomDuFlux: "F", acteurConsommateur: "B", usage: "u", criticite: "1 - Vitale",
    statut: "Actif", decision: "À conserver", commentaires: "", feuille: "FX_A_HTTP",
    ...overrides,
  };
}

function model(overrides: Partial<ParsedModel>): ParsedModel {
  return {
    acteurs: [acteur({ nom: "A" }), acteur({ nom: "B" })],
    typesFlux: [{ type: "HTTP", sensRepresentation: "consommateur-exposant", description: "" }],
    interfaces: [iface({})],
    consommations: [conso({})],
    fxSheetNames: ["FX_A_HTTP"],
    colonnesOptionnellesAbsentes: [],
    fichierModifie: null,
    ...overrides,
  };
}

describe("7.1 structure", () => {
  it("reports nothing on a clean model", () => {
    const report = runIntegrityChecks(model({}));
    expect(report.familles.find((f) => f.id === "structure")!.anomalies).toHaveLength(0);
  });

  it("flags a missing optional column", () => {
    const report = runIntegrityChecks(model({ colonnesOptionnellesAbsentes: [{ feuille: "Acteurs", colonne: "Groupe" }] }));
    expect(report.familles.find((f) => f.id === "structure")!.anomalies).toHaveLength(1);
  });

  it("flags a duplicate actor name", () => {
    const report = runIntegrityChecks(model({ acteurs: [acteur({ nom: "A" }), acteur({ nom: "A" })] }));
    expect(report.familles.find((f) => f.id === "structure")!.anomalies.some((a) => a.message.includes('"A"'))).toBe(true);
  });

  it("flags a duplicate interface name", () => {
    const report = runIntegrityChecks(model({ interfaces: [iface({ nomDuFlux: "F" }), iface({ nomDuFlux: "F" })] }));
    expect(report.familles.find((f) => f.id === "structure")!.anomalies.length).toBeGreaterThan(0);
  });

  it("flags a missing FX_ tab expected by an interface", () => {
    const report = runIntegrityChecks(model({ fxSheetNames: [] }));
    expect(report.familles.find((f) => f.id === "structure")!.anomalies.some((a) => a.message.includes("absent"))).toBe(true);
  });

  it("flags an FX_ tab with no matching interface", () => {
    const report = runIntegrityChecks(model({ fxSheetNames: ["FX_A_HTTP", "FX_Orphelin_HTTP"] }));
    expect(report.familles.find((f) => f.id === "structure")!.anomalies.some((a) => a.message.includes("FX_Orphelin_HTTP"))).toBe(true);
  });
});

describe("7.2 références", () => {
  it("reports nothing when all references resolve", () => {
    const report = runIntegrityChecks(model({}));
    expect(report.familles.find((f) => f.id === "references")!.anomalies).toHaveLength(0);
  });

  it("flags an unknown exposant", () => {
    const report = runIntegrityChecks(model({ interfaces: [iface({ acteurExposant: "Inconnu" })] }));
    expect(report.familles.find((f) => f.id === "references")!.anomalies.some((a) => a.message.includes("Inconnu"))).toBe(true);
  });

  it("flags an unknown type de flux", () => {
    const report = runIntegrityChecks(model({ interfaces: [iface({ typeDeFlux: "SFTP" })] }));
    expect(report.familles.find((f) => f.id === "references")!.anomalies.some((a) => a.message.includes("SFTP"))).toBe(true);
  });

  it("flags an unknown acteur consommateur", () => {
    const report = runIntegrityChecks(model({ consommations: [conso({ acteurConsommateur: "Inconnu" })] }));
    expect(report.familles.find((f) => f.id === "references")!.anomalies.some((a) => a.message.includes("Inconnu"))).toBe(true);
  });

  it("flags a consumption whose flow name is not in the catalog", () => {
    const report = runIntegrityChecks(model({ consommations: [conso({ nomDuFlux: "Fantome" })] }));
    expect(report.familles.find((f) => f.id === "references")!.anomalies.some((a) => a.message.includes("Fantome"))).toBe(true);
  });

  it("flags a consumption filed under the wrong tab", () => {
    const report = runIntegrityChecks(model({ consommations: [conso({ feuille: "FX_Mauvais_Onglet" })] }));
    expect(report.familles.find((f) => f.id === "references")!.anomalies.some((a) => a.message.includes("FX_A_HTTP"))).toBe(true);
  });
});

describe("7.3 cohérence", () => {
  it("reports nothing on a clean model", () => {
    const report = runIntegrityChecks(model({}));
    expect(report.familles.find((f) => f.id === "coherence")!.anomalies).toHaveLength(0);
  });

  it("flags a consumer identical to the exposant", () => {
    const report = runIntegrityChecks(model({ consommations: [conso({ acteurConsommateur: "A" })] }));
    expect(report.familles.find((f) => f.id === "coherence")!.anomalies.length).toBeGreaterThan(0);
  });

  it("flags an interface with no consumption", () => {
    const report = runIntegrityChecks(model({ consommations: [] }));
    expect(report.familles.find((f) => f.id === "coherence")!.anomalies.some((a) => a.message.includes("aucune consommation"))).toBe(true);
  });

  it("flags an actor with no flow at all", () => {
    const report = runIntegrityChecks(model({ acteurs: [acteur({ nom: "A" }), acteur({ nom: "B" }), acteur({ nom: "Isole" })] }));
    expect(report.familles.find((f) => f.id === "coherence")!.anomalies.some((a) => a.message.includes("Isole"))).toBe(true);
  });
});

describe("7.4 complétude", () => {
  it("reports nothing on a clean model", () => {
    const report = runIntegrityChecks(model({}));
    expect(report.familles.find((f) => f.id === "completude")!.anomalies).toHaveLength(0);
  });

  it("flags an empty interface description", () => {
    const report = runIntegrityChecks(model({ interfaces: [iface({ description: "" })] }));
    expect(report.familles.find((f) => f.id === "completude")!.anomalies.some((a) => a.message.includes("description"))).toBe(true);
  });

  it("flags an interface with no contract at all", () => {
    const report = runIntegrityChecks(model({ interfaces: [iface({ lienContrat: "", referenceContrat: "" })] }));
    expect(report.familles.find((f) => f.id === "completude")!.anomalies.some((a) => a.message.includes("contrat"))).toBe(true);
  });

  it("flags a consumption with empty usage, statut or décision", () => {
    const report = runIntegrityChecks(model({ consommations: [conso({ usage: "", statut: "", decision: "" })] }));
    expect(report.familles.find((f) => f.id === "completude")!.anomalies.length).toBe(3);
  });

  it("flags an actor with empty groupe or périmètre", () => {
    const report = runIntegrityChecks(model({ acteurs: [acteur({ nom: "A", groupe: "", perimetre: "" }), acteur({ nom: "B" })] }));
    expect(report.familles.find((f) => f.id === "completude")!.anomalies.length).toBe(2);
  });
});

describe("7.5 candidats au décommissionnement", () => {
  it("is empty when nothing qualifies", () => {
    const report = runIntegrityChecks(model({}));
    expect(report.blocsInformatifs.find((b) => b.id === "decommissionnement")!.items).toHaveLength(0);
  });

  it("lists an interface whose only consumption is À supprimer", () => {
    const report = runIntegrityChecks(model({ consommations: [conso({ decision: "À supprimer" })] }));
    expect(report.blocsInformatifs.find((b) => b.id === "decommissionnement")!.items).toEqual(["F"]);
  });

  it("lists an interface whose only consumption is Statut=Décommissionné", () => {
    const report = runIntegrityChecks(model({ consommations: [conso({ decision: "À conserver", statut: "Décommissionné" })] }));
    expect(report.blocsInformatifs.find((b) => b.id === "decommissionnement")!.items).toEqual(["F"]);
  });

  it("lists an interface whose exposant is décommissionné", () => {
    const report = runIntegrityChecks(model({ acteurs: [acteur({ nom: "A", statut: "Décommissionné" }), acteur({ nom: "B" })] }));
    expect(report.blocsInformatifs.find((b) => b.id === "decommissionnement")!.items).toEqual(["F"]);
  });
});

describe("7.6 interfaces à confirmer", () => {
  it("lists interfaces flagged Oui", () => {
    const report = runIntegrityChecks(model({ interfaces: [iface({ nomDuFlux: "F", aConfirmer: true })] }));
    expect(report.blocsInformatifs.find((b) => b.id === "a-confirmer")!.items).toEqual(["F"]);
  });
});

describe("7.7 groupes utilisés", () => {
  it("counts actors per non-empty groupe", () => {
    const report = runIntegrityChecks(
      model({ acteurs: [acteur({ nom: "A", groupe: "Socle" }), acteur({ nom: "B", groupe: "Socle" })] })
    );
    expect(report.blocsInformatifs.find((b) => b.id === "groupes")!.items).toEqual(["Socle (2)"]);
  });
});

describe("totalAnomalies", () => {
  it("counts only the anomaly families, not the informational blocks", () => {
    const report = runIntegrityChecks(model({ interfaces: [iface({ description: "" })] }));
    expect(report.totalAnomalies).toBeGreaterThan(0);
    expect(report.totalAnomalies).toBe(
      report.familles.reduce((sum, f) => sum + f.anomalies.length, 0)
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/integrity/checks.test.ts`
Expected: FAIL — `checks.ts` does not exist.

- [ ] **Step 3: Write the implementation**

`app/src/integrity/checks.ts`:
```ts
import type { Acteur, InterfaceCatalogue, ParsedModel } from "../parsing/model";

export interface Anomaly {
  message: string;
}

export interface AnomalyFamily {
  id: string;
  titre: string;
  description: string;
  anomalies: Anomaly[];
}

export interface InfoBlock {
  id: string;
  titre: string;
  description: string;
  items: string[];
}

export interface IntegrityReport {
  familles: AnomalyFamily[];
  blocsInformatifs: InfoBlock[];
  totalAnomalies: number;
}

function norm(s: string): string {
  return s.trim().toLowerCase();
}

function isDecommissionne(statut: string): boolean {
  return norm(statut) === "décommissionné";
}

function isASupprimer(decision: string): boolean {
  return norm(decision) === "à supprimer";
}

function acteurByNom(model: ParsedModel): Map<string, Acteur> {
  const map = new Map<string, Acteur>();
  for (const a of model.acteurs) map.set(a.nom.trim(), a);
  return map;
}

function duplicates(values: string[]): string[] {
  const counts = new Map<string, number>();
  for (const v of values) {
    const key = v.trim();
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].filter(([, n]) => n > 1).map(([k]) => k);
}

function checkStructure(model: ParsedModel): AnomalyFamily {
  const anomalies: Anomaly[] = [];

  for (const { feuille, colonne } of model.colonnesOptionnellesAbsentes) {
    anomalies.push({ message: `Colonne "${colonne}" absente de la feuille "${feuille}".` });
  }

  for (const nom of duplicates(model.acteurs.map((a) => a.nom))) {
    anomalies.push({ message: `Acteur "${nom}" déclaré plusieurs fois dans le référentiel.` });
  }

  for (const nom of duplicates(model.interfaces.map((i) => i.nomDuFlux))) {
    anomalies.push({ message: `Interface "${nom}" apparaît plusieurs fois dans le catalogue.` });
  }

  const fxNormalises = new Set(model.fxSheetNames.map((n) => norm(n)));
  for (const iface of model.interfaces) {
    if (!fxNormalises.has(norm(iface.feuilleAttendue))) {
      const raison = iface.feuilleValide
        ? `onglet "${iface.feuilleAttendue}" absent du classeur`
        : `nom d'onglet "${iface.feuilleAttendue}" invalide (plus de 31 caractères ou caractère interdit)`;
      anomalies.push({ message: `Interface "${iface.nomDuFlux}" : ${raison}.` });
    }
  }

  const attendus = new Set(model.interfaces.map((i) => norm(i.feuilleAttendue)));
  for (const feuille of model.fxSheetNames) {
    if (!attendus.has(norm(feuille))) {
      anomalies.push({ message: `Onglet "${feuille}" présent mais aucune interface ne s'y rattache.` });
    }
  }

  return { id: "structure", titre: "Structure", description: "Le fichier ne se lit pas comme prévu.", anomalies };
}

function checkReferences(model: ParsedModel): AnomalyFamily {
  const anomalies: Anomaly[] = [];
  const acteurs = acteurByNom(model);
  const typesFlux = new Set(model.typesFlux.map((t) => t.type.trim()));
  const interfacesParNom = new Map<string, InterfaceCatalogue>();
  for (const i of model.interfaces) interfacesParNom.set(i.nomDuFlux.trim(), i);

  for (const iface of model.interfaces) {
    if (!acteurs.has(iface.acteurExposant.trim())) {
      anomalies.push({ message: `Interface "${iface.nomDuFlux}" : acteur exposant "${iface.acteurExposant}" inconnu du référentiel.` });
    }
    if (!typesFlux.has(iface.typeDeFlux.trim())) {
      anomalies.push({ message: `Interface "${iface.nomDuFlux}" : type de flux "${iface.typeDeFlux}" inconnu du référentiel.` });
    }
  }

  for (const c of model.consommations) {
    if (!acteurs.has(c.acteurConsommateur.trim())) {
      anomalies.push({ message: `Consommation "${c.nomDuFlux}" (${c.feuille}) : acteur consommateur "${c.acteurConsommateur}" inconnu du référentiel.` });
    }
    const iface = interfacesParNom.get(c.nomDuFlux.trim());
    if (!iface) {
      anomalies.push({ message: `Consommation "${c.nomDuFlux}" (${c.feuille}) : nom de flux absent du catalogue Interfaces.` });
      continue;
    }
    if (norm(c.feuille) !== norm(iface.feuilleAttendue)) {
      anomalies.push({ message: `Consommation "${c.nomDuFlux}" rangée dans "${c.feuille}" au lieu de "${iface.feuilleAttendue}".` });
    }
  }

  return { id: "references", titre: "Références", description: "Une valeur pointe vers rien.", anomalies };
}

function checkCoherence(model: ParsedModel): AnomalyFamily {
  const anomalies: Anomaly[] = [];
  const interfacesParNom = new Map<string, InterfaceCatalogue>();
  for (const i of model.interfaces) interfacesParNom.set(i.nomDuFlux.trim(), i);

  for (const c of model.consommations) {
    const iface = interfacesParNom.get(c.nomDuFlux.trim());
    if (iface && iface.acteurExposant.trim() === c.acteurConsommateur.trim()) {
      anomalies.push({ message: `"${c.nomDuFlux}" (${c.feuille}) : le consommateur est aussi l'exposant.` });
    }
  }

  const consommationsParFlux = new Set(model.consommations.map((c) => c.nomDuFlux.trim()));
  for (const iface of model.interfaces) {
    if (!consommationsParFlux.has(iface.nomDuFlux.trim())) {
      anomalies.push({ message: `Interface "${iface.nomDuFlux}" sans aucune consommation déclarée.` });
    }
  }

  const acteursActifs = new Set<string>();
  for (const iface of model.interfaces) acteursActifs.add(iface.acteurExposant.trim());
  for (const c of model.consommations) acteursActifs.add(c.acteurConsommateur.trim());
  for (const a of model.acteurs) {
    if (!acteursActifs.has(a.nom.trim())) {
      anomalies.push({ message: `Acteur "${a.nom}" sans aucun flux entrant ni sortant.` });
    }
  }

  return { id: "coherence", titre: "Cohérence", description: "Le fichier se lit, mais quelque chose ne tient pas.", anomalies };
}

function checkCompletude(model: ParsedModel): AnomalyFamily {
  const anomalies: Anomaly[] = [];

  for (const iface of model.interfaces) {
    if (!iface.description.trim()) {
      anomalies.push({ message: `Interface "${iface.nomDuFlux}" : description vide.` });
    }
    if (!iface.lienContrat.trim() && !iface.referenceContrat.trim()) {
      anomalies.push({ message: `Interface "${iface.nomDuFlux}" : aucun contrat (ni lien, ni référence).` });
    }
  }

  for (const c of model.consommations) {
    if (!c.usage.trim()) anomalies.push({ message: `Consommation "${c.nomDuFlux}" (${c.feuille}) : usage non décrit.` });
    if (!c.statut.trim()) anomalies.push({ message: `Consommation "${c.nomDuFlux}" (${c.feuille}) : statut vide.` });
    if (!c.decision.trim()) anomalies.push({ message: `Consommation "${c.nomDuFlux}" (${c.feuille}) : décision vide.` });
  }

  for (const a of model.acteurs) {
    if (!a.groupe.trim()) {
      anomalies.push({ message: `Acteur "${a.nom}" : groupe vide (absent des vues agrégées tant que non renseigné).` });
    }
    if (!a.perimetre.trim()) {
      anomalies.push({ message: `Acteur "${a.nom}" : périmètre non renseigné.` });
    }
  }

  return { id: "completude", titre: "Complétude", description: "Il manque de la saisie.", anomalies };
}

function decommissionCandidates(model: ParsedModel): InfoBlock {
  const acteurs = acteurByNom(model);
  const items: string[] = [];

  for (const iface of model.interfaces) {
    const consommations = model.consommations.filter((c) => c.nomDuFlux.trim() === iface.nomDuFlux.trim());
    if (consommations.length === 0) continue;

    const exposantActeur = acteurs.get(iface.acteurExposant.trim());
    const exposantDecommissionne = exposantActeur ? isDecommissionne(exposantActeur.statut) : false;

    const toutesEligibles = consommations.every((c) => {
      const consommateurActeur = acteurs.get(c.acteurConsommateur.trim());
      return (
        isASupprimer(c.decision) ||
        isDecommissionne(c.statut) ||
        exposantDecommissionne ||
        (consommateurActeur ? isDecommissionne(consommateurActeur.statut) : false)
      );
    });

    if (toutesEligibles) items.push(iface.nomDuFlux);
  }

  return {
    id: "decommissionnement",
    titre: "Candidats au décommissionnement",
    description: "Interfaces dont toutes les consommations sont à supprimer ou décommissionnées.",
    items,
  };
}

function interfacesAConfirmer(model: ParsedModel): InfoBlock {
  return {
    id: "a-confirmer",
    titre: "Interfaces à confirmer",
    description: "Interfaces dont la colonne À confirmer vaut Oui.",
    items: model.interfaces.filter((i) => i.aConfirmer).map((i) => i.nomDuFlux),
  };
}

function groupesUtilises(model: ParsedModel): InfoBlock {
  const counts = new Map<string, number>();
  for (const a of model.acteurs) {
    const groupe = a.groupe.trim();
    if (!groupe) continue;
    counts.set(groupe, (counts.get(groupe) ?? 0) + 1);
  }
  const items = [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b, "fr"))
    .map(([groupe, n]) => `${groupe} (${n})`);

  return {
    id: "groupes",
    titre: "Groupes utilisés",
    description: "Groupes distincts trouvés dans Acteurs, avec le nombre d'acteurs par groupe.",
    items,
  };
}

export function runIntegrityChecks(model: ParsedModel): IntegrityReport {
  const familles = [checkStructure(model), checkReferences(model), checkCoherence(model), checkCompletude(model)];
  const blocsInformatifs = [decommissionCandidates(model), interfacesAConfirmer(model), groupesUtilises(model)];
  const totalAnomalies = familles.reduce((sum, f) => sum + f.anomalies.length, 0);

  return { familles, blocsInformatifs, totalAnomalies };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/integrity/checks.test.ts`
Expected: PASS (24 tests).

- [ ] **Step 5: Commit**

```bash
git add app/src/integrity/checks.ts app/src/integrity/checks.test.ts
git commit -m "feat: implement integrity checks (families 7.1-7.7)"
```

---

### Task 6: aggregation/core.ts

**Files:**
- Create: `app/src/aggregation/core.ts`
- Test: `app/src/aggregation/core.test.ts`

**Interfaces:**
- Consumes: `ParsedModel`, `Acteur` from `../parsing/model` (Task 2).
- Produces: `NodeId`, `NodeKind`, `GraphNode`, `GraphEdge`, `FlowInstance`, `EdgeGroup`, `AggregationOptions`, `NodeKeyFn`, `buildFlowInstances(model): FlowInstance[]`, `identityNodeKey`, `groupNodeKey(model)`, `platformDetailNodeKey(model)`, `groupFlows(flows, nodeKey, cible, maskLoops): EdgeGroup[]`, `aggregateEdges(flows, nodeKey, options, maskLoops): GraphEdge[]`, `nodesFromEdges(edges, labelFor, kindFor): GraphNode[]` — all consumed by `aggregation/views.ts` (Task 7).

- [ ] **Step 1: Write the failing tests**

`app/src/aggregation/core.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import {
  buildFlowInstances,
  groupFlows,
  aggregateEdges,
  nodesFromEdges,
  identityNodeKey,
  groupNodeKey,
} from "./core";
import type { ParsedModel, Acteur, InterfaceCatalogue, Consommation } from "../parsing/model";

function acteur(overrides: Partial<Acteur>): Acteur {
  return { nom: "A", groupe: "G1", perimetre: "Externe", typeActeur: "Application", statut: "Actif", responsable: "", description: "", commentaires: "", ...overrides };
}
function iface(overrides: Partial<InterfaceCatalogue>): InterfaceCatalogue {
  return { nomDuFlux: "F", acteurExposant: "A", typeDeFlux: "HTTP", description: "", lienContrat: "", referenceContrat: "", commentaires: "", aConfirmer: false, feuilleAttendue: "FX_A_HTTP", feuilleValide: true, ...overrides };
}
function conso(overrides: Partial<Consommation>): Consommation {
  return { nomDuFlux: "F", acteurConsommateur: "B", usage: "", criticite: "", statut: "Actif", decision: "À conserver", commentaires: "", feuille: "FX_A_HTTP", ...overrides };
}
function model(overrides: Partial<ParsedModel>): ParsedModel {
  return {
    acteurs: [acteur({ nom: "A", groupe: "G1" }), acteur({ nom: "B", groupe: "G2" })],
    typesFlux: [{ type: "HTTP", sensRepresentation: "consommateur-exposant", description: "" }],
    interfaces: [iface({})],
    consommations: [conso({})],
    fxSheetNames: ["FX_A_HTTP"],
    colonnesOptionnellesAbsentes: [],
    fichierModifie: null,
    ...overrides,
  };
}

describe("buildFlowInstances", () => {
  it("joins interfaces and consumptions and resolves direction", () => {
    const flows = buildFlowInstances(model({}));
    expect(flows).toHaveLength(1);
    expect(flows[0]).toMatchObject({ exposant: "A", consommateur: "B", sens: "consommateur-exposant" });
  });

  it("skips a consumption whose flow name has no matching interface", () => {
    const flows = buildFlowInstances(model({ consommations: [conso({ nomDuFlux: "Fantome" })] }));
    expect(flows).toHaveLength(0);
  });

  it("marks a flow excluded when Décision=À supprimer", () => {
    const flows = buildFlowInstances(model({ consommations: [conso({ decision: "À supprimer" })] }));
    expect(flows[0].exclu).toBe(true);
  });

  it("marks a flow excluded when the consumption Statut=Décommissionné", () => {
    const flows = buildFlowInstances(model({ consommations: [conso({ statut: "Décommissionné" })] }));
    expect(flows[0].exclu).toBe(true);
  });

  it("marks a flow excluded when the exposant actor is Décommissionné", () => {
    const flows = buildFlowInstances(
      model({ acteurs: [acteur({ nom: "A", statut: "Décommissionné" }), acteur({ nom: "B" })] })
    );
    expect(flows[0].exclu).toBe(true);
  });

  it("marks a flow attenuated when Décision=À transformer", () => {
    const flows = buildFlowInstances(model({ consommations: [conso({ decision: "À transformer" })] }));
    expect(flows[0].atténué).toBe(true);
  });
});

describe("groupFlows", () => {
  it("deduplicates by (from, to, technologie) and counts consumptions", () => {
    const flows = buildFlowInstances(
      model({
        interfaces: [iface({ nomDuFlux: "F1" }), iface({ nomDuFlux: "F2" })],
        consommations: [conso({ nomDuFlux: "F1" }), conso({ nomDuFlux: "F2" })],
      })
    );
    const groups = groupFlows(flows, identityNodeKey, false, true);
    expect(groups).toHaveLength(1);
    expect(groups[0].count).toBe(2);
  });

  it("masks self-loops when maskLoops is true", () => {
    const flows = buildFlowInstances(model({ consommations: [conso({ acteurConsommateur: "A" })] }));
    expect(groupFlows(flows, identityNodeKey, false, true)).toHaveLength(0);
  });

  it("keeps self-loops when maskLoops is false", () => {
    const flows = buildFlowInstances(model({ consommations: [conso({ acteurConsommateur: "A" })] }));
    expect(groupFlows(flows, identityNodeKey, false, false)).toHaveLength(1);
  });

  it("excludes flows when cible is true and the flow is exclu", () => {
    const flows = buildFlowInstances(model({ consommations: [conso({ decision: "À supprimer" })] }));
    expect(groupFlows(flows, identityNodeKey, true, true)).toHaveLength(0);
    expect(groupFlows(flows, identityNodeKey, false, true)).toHaveLength(1);
  });

  it("marks a group attenuated only when every merged flow is attenuated", () => {
    const flows = buildFlowInstances(
      model({
        interfaces: [iface({ nomDuFlux: "F1" }), iface({ nomDuFlux: "F2" })],
        consommations: [conso({ nomDuFlux: "F1", decision: "À transformer" }), conso({ nomDuFlux: "F2", decision: "À conserver" })],
      })
    );
    expect(groupFlows(flows, identityNodeKey, false, true)[0].atténué).toBe(false);
  });

  it("never merges opposite-direction flows into one bidirectional edge", () => {
    const flows = buildFlowInstances(
      model({
        interfaces: [iface({ nomDuFlux: "F1", acteurExposant: "A" }), iface({ nomDuFlux: "F2", acteurExposant: "B" })],
        consommations: [conso({ nomDuFlux: "F1", acteurConsommateur: "B" }), conso({ nomDuFlux: "F2", acteurConsommateur: "A" })],
      })
    );
    const groups = groupFlows(flows, identityNodeKey, false, true);
    expect(groups).toHaveLength(2);
    expect(groups.some((g) => g.from === "B" && g.to === "A")).toBe(true);
    expect(groups.some((g) => g.from === "A" && g.to === "B")).toBe(true);
  });
});

describe("aggregateEdges", () => {
  it("shows the counter in the label only when compteurs is on and count > 1", () => {
    const flows = buildFlowInstances(
      model({
        interfaces: [iface({ nomDuFlux: "F1" }), iface({ nomDuFlux: "F2" })],
        consommations: [conso({ nomDuFlux: "F1" }), conso({ nomDuFlux: "F2" })],
      })
    );
    const withCounter = aggregateEdges(flows, identityNodeKey, { cible: false, compteurs: true }, true);
    const withoutCounter = aggregateEdges(flows, identityNodeKey, { cible: false, compteurs: false }, true);
    expect(withCounter[0].label).toBe("HTTP ×2");
    expect(withoutCounter[0].label).toBe("HTTP");
  });
});

describe("groupNodeKey", () => {
  it("resolves an actor to its groupe", () => {
    const key = groupNodeKey(model({}));
    expect(key("A")).toBe("G1");
    expect(key("B")).toBe("G2");
  });
});

describe("nodesFromEdges", () => {
  it("builds one node per distinct endpoint", () => {
    const nodes = nodesFromEdges(
      [{ from: "G1", to: "G2", technologie: "HTTP", count: 1, atténué: false }],
      (id) => id,
      () => "groupe"
    );
    expect(nodes.map((n) => n.id).sort()).toEqual(["G1", "G2"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/aggregation/core.test.ts`
Expected: FAIL — `core.ts` does not exist.

- [ ] **Step 3: Write the implementation**

`app/src/aggregation/core.ts`:
```ts
import type { Acteur, ParsedModel } from "../parsing/model";
import { normalizeText } from "../shared/text";

export type NodeId = string;
export type NodeKind = "groupe" | "plateforme" | "acteur" | "acteur-selectionne";

export interface GraphNode {
  id: NodeId;
  label: string;
  kind: NodeKind;
}

export interface GraphEdge {
  from: NodeId;
  to: NodeId;
  technologie: string;
  count: number;
  label: string;
  atténué: boolean;
}

export interface FlowInstance {
  interfaceNom: string;
  typeDeFlux: string;
  exposant: string;
  consommateur: string;
  sens: "exposant-consommateur" | "consommateur-exposant";
  atténué: boolean;
  exclu: boolean;
}

function isDecommissionne(statut: string): boolean {
  return normalizeText(statut) === normalizeText("Décommissionné");
}
function isASupprimer(decision: string): boolean {
  return normalizeText(decision) === normalizeText("À supprimer");
}
function isATransformer(decision: string): boolean {
  return normalizeText(decision) === normalizeText("À transformer");
}

function acteurByNom(model: ParsedModel): Map<string, Acteur> {
  const map = new Map<string, Acteur>();
  for (const a of model.acteurs) map.set(a.nom.trim(), a);
  return map;
}

// Un flux orphelin (nom absent du catalogue) ou de type inconnu (sens
// indéterminable) ne peut pas être dessiné — ces cas sont déjà signalés par
// integrity/checks.ts (7.2), on les ignore simplement ici.
export function buildFlowInstances(model: ParsedModel): FlowInstance[] {
  const acteurs = acteurByNom(model);
  const sensParType = new Map(model.typesFlux.map((t) => [t.type.trim(), t.sensRepresentation]));
  const interfacesParNom = new Map(model.interfaces.map((i) => [i.nomDuFlux.trim(), i]));
  const flows: FlowInstance[] = [];

  for (const consommation of model.consommations) {
    const iface = interfacesParNom.get(consommation.nomDuFlux.trim());
    if (!iface) continue;

    const sens = sensParType.get(iface.typeDeFlux.trim());
    if (!sens) continue;

    const exposantActeur = acteurs.get(iface.acteurExposant.trim());
    const consommateurActeur = acteurs.get(consommation.acteurConsommateur.trim());

    const exclu =
      isASupprimer(consommation.decision) ||
      isDecommissionne(consommation.statut) ||
      (exposantActeur ? isDecommissionne(exposantActeur.statut) : false) ||
      (consommateurActeur ? isDecommissionne(consommateurActeur.statut) : false);

    flows.push({
      interfaceNom: iface.nomDuFlux,
      typeDeFlux: iface.typeDeFlux,
      exposant: iface.acteurExposant,
      consommateur: consommation.acteurConsommateur,
      sens,
      atténué: isATransformer(consommation.decision),
      exclu,
    });
  }

  return flows;
}

export type NodeKeyFn = (acteurNom: string) => NodeId;

export function identityNodeKey(acteurNom: string): NodeId {
  return acteurNom;
}

export function groupNodeKey(model: ParsedModel): NodeKeyFn {
  const acteurs = acteurByNom(model);
  return (nom: string) => {
    const acteur = acteurs.get(nom.trim());
    return acteur?.groupe.trim() || nom;
  };
}

export function platformDetailNodeKey(model: ParsedModel): NodeKeyFn {
  const acteurs = acteurByNom(model);
  return (nom: string) => {
    const acteur = acteurs.get(nom.trim());
    if (!acteur) return nom;
    return acteur.perimetre.trim() === "Plateforme" ? acteur.nom : acteur.groupe.trim() || acteur.nom;
  };
}

function directedEndpoints(flow: FlowInstance, nodeKey: NodeKeyFn): { from: NodeId; to: NodeId } {
  return flow.sens === "exposant-consommateur"
    ? { from: nodeKey(flow.exposant), to: nodeKey(flow.consommateur) }
    : { from: nodeKey(flow.consommateur), to: nodeKey(flow.exposant) };
}

export interface EdgeGroup {
  from: NodeId;
  to: NodeId;
  technologie: string;
  count: number;
  atténué: boolean;
}

export function groupFlows(flows: FlowInstance[], nodeKey: NodeKeyFn, cible: boolean, maskLoops: boolean): EdgeGroup[] {
  const groups = new Map<string, EdgeGroup>();

  for (const flow of flows) {
    if (cible && flow.exclu) continue;

    const { from, to } = directedEndpoints(flow, nodeKey);
    if (maskLoops && from === to) continue;

    // Clé directionnelle : (from, to) n'est jamais normalisée en paire non
    // ordonnée, pour que deux sens opposés restent deux traits distincts (§4.5).
    // JSON.stringify plutôt qu'une concaténation avec séparateur : un nœud ou
    // une techno peut contenir un espace ("Ryloth") ou même un saut de
    // ligne (Excel autorise Alt+Entrée dans une cellule) ; JSON.stringify évite
    // toute ambiguïté sans introduire de caractère de contrôle dans le code source.
    const key = JSON.stringify([from, to, flow.typeDeFlux]);
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
      existing.atténué = existing.atténué && flow.atténué;
    } else {
      groups.set(key, { from, to, technologie: flow.typeDeFlux, count: 1, atténué: flow.atténué });
    }
  }

  return [...groups.values()];
}

export interface AggregationOptions {
  cible: boolean;
  compteurs: boolean;
}

export function aggregateEdges(
  flows: FlowInstance[],
  nodeKey: NodeKeyFn,
  options: AggregationOptions,
  maskLoops: boolean
): GraphEdge[] {
  return groupFlows(flows, nodeKey, options.cible, maskLoops).map((g) => ({
    from: g.from,
    to: g.to,
    technologie: g.technologie,
    count: g.count,
    label: options.compteurs && g.count > 1 ? `${g.technologie} ×${g.count}` : g.technologie,
    atténué: g.atténué,
  }));
}

export function nodesFromEdges(
  edges: (GraphEdge | EdgeGroup)[],
  labelFor: (id: NodeId) => string,
  kindFor: (id: NodeId) => NodeKind
): GraphNode[] {
  const ids = new Set<NodeId>();
  for (const e of edges) {
    ids.add(e.from);
    ids.add(e.to);
  }
  return [...ids].map((id) => ({ id, label: labelFor(id), kind: kindFor(id) }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/aggregation/core.test.ts`
Expected: PASS (14 tests).

- [ ] **Step 5: Commit**

```bash
git add app/src/aggregation/core.ts app/src/aggregation/core.test.ts
git commit -m "feat: implement flow instances and edge aggregation engine"
```

---

### Task 7: aggregation/views.ts

**Files:**
- Create: `app/src/aggregation/views.ts`
- Test: `app/src/aggregation/views.test.ts`

**Interfaces:**
- Consumes: everything from `./core` (Task 6), `ParsedModel` from `../parsing/model`.
- Produces: `ViewResult`, `MatrixCell`, `MatrixRow`, `MatrixResult`, `buildGroupToGroupView`, `buildPlatformDetailView`, `buildByTechnologyView`, `buildByActorView`, `buildMatrixView` — consumed by `ui/app.ts` (Task 13).

- [ ] **Step 1: Write the failing tests**

`app/src/aggregation/views.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import {
  buildGroupToGroupView,
  buildPlatformDetailView,
  buildByTechnologyView,
  buildByActorView,
  buildMatrixView,
} from "./views";
import type { ParsedModel, Acteur, InterfaceCatalogue, Consommation } from "../parsing/model";

function acteur(overrides: Partial<Acteur>): Acteur {
  return { nom: "A", groupe: "G1", perimetre: "Externe", typeActeur: "Application", statut: "Actif", responsable: "", description: "", commentaires: "", ...overrides };
}
function iface(overrides: Partial<InterfaceCatalogue>): InterfaceCatalogue {
  return { nomDuFlux: "F", acteurExposant: "A", typeDeFlux: "HTTP", description: "", lienContrat: "", referenceContrat: "", commentaires: "", aConfirmer: false, feuilleAttendue: "FX_A_HTTP", feuilleValide: true, ...overrides };
}
function conso(overrides: Partial<Consommation>): Consommation {
  return { nomDuFlux: "F", acteurConsommateur: "B", usage: "", criticite: "", statut: "Actif", decision: "À conserver", commentaires: "", feuille: "FX_A_HTTP", ...overrides };
}

const baseModel: ParsedModel = {
  acteurs: [
    acteur({ nom: "A", groupe: "G1", perimetre: "Plateforme" }),
    acteur({ nom: "B", groupe: "G2", perimetre: "Externe" }),
  ],
  typesFlux: [{ type: "HTTP", sensRepresentation: "consommateur-exposant", description: "" }],
  interfaces: [iface({})],
  consommations: [conso({})],
  fxSheetNames: ["FX_A_HTTP"],
  colonnesOptionnellesAbsentes: [],
  fichierModifie: null,
};

describe("buildGroupToGroupView", () => {
  it("keys nodes by groupe", () => {
    const view = buildGroupToGroupView(baseModel, { cible: false, compteurs: true });
    expect(view.nodes.map((n) => n.id).sort()).toEqual(["G1", "G2"]);
    expect(view.edges).toHaveLength(1);
  });
});

describe("buildPlatformDetailView", () => {
  it("gives a plateforme actor its own node, keeps external actors grouped", () => {
    const view = buildPlatformDetailView(baseModel, { cible: false, compteurs: true });
    expect(view.nodes.find((n) => n.id === "A")?.kind).toBe("plateforme");
    expect(view.nodes.find((n) => n.id === "G2")).toBeDefined();
  });
});

describe("buildByTechnologyView", () => {
  it("keeps only flows of the selected technology, keyed by actor", () => {
    const view = buildByTechnologyView(baseModel, "HTTP", { cible: false, compteurs: true });
    expect(view.nodes.map((n) => n.id).sort()).toEqual(["A", "B"]);
  });

  it("returns no edges for an unused technology", () => {
    const view = buildByTechnologyView(baseModel, "Kafka", { cible: false, compteurs: true });
    expect(view.edges).toHaveLength(0);
  });
});

describe("buildByActorView", () => {
  it("includes the selected actor and its one-hop neighbours, without dedup", () => {
    const view = buildByActorView(baseModel, "A", { cible: false });
    expect(view.nodes.find((n) => n.id === "A")?.kind).toBe("acteur-selectionne");
    expect(view.nodes.find((n) => n.id === "B")?.kind).toBe("acteur");
    expect(view.edges[0].label).toBe("F");
  });

  it("keeps self-loops visible", () => {
    const view = buildByActorView(
      { ...baseModel, consommations: [conso({ acteurConsommateur: "A" })] },
      "A",
      { cible: false }
    );
    expect(view.edges).toHaveLength(1);
  });
});

describe("buildMatrixView", () => {
  it("lists actors involved in at least one flow, with technology cells", () => {
    const matrix = buildMatrixView(baseModel, { cible: false });
    expect(matrix.acteurs.sort()).toEqual(["A", "B"]);
    const ligneB = matrix.lignes.find((l) => l.acteur === "B")!;
    expect(ligneB.cellules.get("A")).toEqual([{ technologie: "HTTP", count: 1, atténué: false }]);
  });

  it("keeps self-loop cells (unlike graphical views)", () => {
    const matrix = buildMatrixView({ ...baseModel, consommations: [conso({ acteurConsommateur: "A" })] }, { cible: false });
    const ligneA = matrix.lignes.find((l) => l.acteur === "A")!;
    expect(ligneA.cellules.get("A")).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/aggregation/views.test.ts`
Expected: FAIL — `views.ts` does not exist.

- [ ] **Step 3: Write the implementation**

`app/src/aggregation/views.ts`:
```ts
import type { ParsedModel } from "../parsing/model";
import {
  buildFlowInstances,
  groupFlows,
  aggregateEdges,
  nodesFromEdges,
  groupNodeKey,
  platformDetailNodeKey,
  identityNodeKey,
  type GraphNode,
  type GraphEdge,
  type AggregationOptions,
} from "./core";

export interface ViewResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export function buildGroupToGroupView(model: ParsedModel, options: AggregationOptions): ViewResult {
  const flows = buildFlowInstances(model);
  const edges = aggregateEdges(flows, groupNodeKey(model), options, true);
  const nodes = nodesFromEdges(edges, (id) => id, () => "groupe");
  return { nodes, edges };
}

export function buildPlatformDetailView(model: ParsedModel, options: AggregationOptions): ViewResult {
  const flows = buildFlowInstances(model);
  const edges = aggregateEdges(flows, platformDetailNodeKey(model), options, true);
  const plateformeIds = new Set(model.acteurs.filter((a) => a.perimetre.trim() === "Plateforme").map((a) => a.nom));
  const nodes = nodesFromEdges(edges, (id) => id, (id) => (plateformeIds.has(id) ? "plateforme" : "groupe"));
  return { nodes, edges };
}

export function buildByTechnologyView(model: ParsedModel, typeDeFlux: string, options: AggregationOptions): ViewResult {
  const flows = buildFlowInstances(model).filter((f) => f.typeDeFlux.trim() === typeDeFlux.trim());
  const edges = aggregateEdges(flows, identityNodeKey, options, true);
  const nodes = nodesFromEdges(edges, (id) => id, () => "acteur");
  return { nodes, edges };
}

export function buildByActorView(model: ParsedModel, acteurNom: string, options: { cible: boolean }): ViewResult {
  const flows = buildFlowInstances(model).filter(
    (f) => f.exposant.trim() === acteurNom.trim() || f.consommateur.trim() === acteurNom.trim()
  );

  const edges: GraphEdge[] = [];
  const nodeIds = new Set<string>([acteurNom]);

  for (const flow of flows) {
    if (options.cible && flow.exclu) continue;
    const { from, to } =
      flow.sens === "exposant-consommateur"
        ? { from: flow.exposant, to: flow.consommateur }
        : { from: flow.consommateur, to: flow.exposant };
    nodeIds.add(from);
    nodeIds.add(to);
    edges.push({ from, to, technologie: flow.typeDeFlux, count: 1, label: flow.interfaceNom, atténué: flow.atténué });
  }

  const nodes: GraphNode[] = [...nodeIds].map((id) => ({
    id,
    label: id,
    kind: id === acteurNom ? "acteur-selectionne" : "acteur",
  }));

  return { nodes, edges };
}

export interface MatrixCell {
  technologie: string;
  count: number;
  atténué: boolean;
}

export interface MatrixRow {
  acteur: string;
  cellules: Map<string, MatrixCell[]>;
}

export interface MatrixResult {
  acteurs: string[];
  lignes: MatrixRow[];
}

export function buildMatrixView(model: ParsedModel, options: { cible: boolean }): MatrixResult {
  const flows = buildFlowInstances(model);
  const groups = groupFlows(flows, identityNodeKey, options.cible, false);

  const acteursSet = new Set<string>();
  for (const g of groups) {
    acteursSet.add(g.from);
    acteursSet.add(g.to);
  }
  const acteurs = [...acteursSet].sort((a, b) => a.localeCompare(b, "fr"));

  const lignesMap = new Map<string, MatrixRow>();
  for (const acteur of acteurs) lignesMap.set(acteur, { acteur, cellules: new Map() });

  for (const g of groups) {
    const ligne = lignesMap.get(g.from)!;
    const cell: MatrixCell = { technologie: g.technologie, count: g.count, atténué: g.atténué };
    const existing = ligne.cellules.get(g.to);
    if (existing) existing.push(cell);
    else ligne.cellules.set(g.to, [cell]);
  }

  return { acteurs, lignes: [...lignesMap.values()] };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/aggregation/views.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add app/src/aggregation/views.ts app/src/aggregation/views.test.ts
git commit -m "feat: build the 5 graphical/table views on top of the aggregation core"
```

---

### Task 8: layout/dagre-layout.ts

**Files:**
- Create: `app/src/layout/dagre-layout.ts`
- Test: `app/src/layout/dagre-layout.test.ts`

**Interfaces:**
- Consumes: `GraphNode`, `GraphEdge` from `../aggregation/core` (Task 6), `dagre` package.
- Produces: `LayoutNode`, `LayoutEdge`, `LayoutResult`, `computeLayout(nodes: GraphNode[], edges: GraphEdge[]): LayoutResult` — consumed by `render/svg-builder.ts` (Task 9) and `ui/app.ts` (Task 13).

- [ ] **Step 1: Write the failing tests**

`app/src/layout/dagre-layout.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { computeLayout } from "./dagre-layout";
import type { GraphNode, GraphEdge } from "../aggregation/core";

describe("computeLayout", () => {
  it("positions two connected nodes with finite coordinates", () => {
    const nodes: GraphNode[] = [
      { id: "A", label: "A", kind: "groupe" },
      { id: "B", label: "B", kind: "groupe" },
    ];
    const edges: GraphEdge[] = [{ from: "A", to: "B", technologie: "HTTP", count: 1, label: "HTTP", atténué: false }];

    const layout = computeLayout(nodes, edges);

    expect(layout.nodes).toHaveLength(2);
    for (const n of layout.nodes) {
      expect(Number.isFinite(n.x)).toBe(true);
      expect(Number.isFinite(n.y)).toBe(true);
      expect(n.width).toBeGreaterThan(0);
      expect(n.height).toBeGreaterThan(0);
    }
    expect(layout.edges).toHaveLength(1);
    expect(layout.edges[0].points.length).toBeGreaterThan(0);
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.height).toBeGreaterThan(0);
  });

  it("supports two distinct edges between the same pair of nodes (multigraph)", () => {
    const nodes: GraphNode[] = [
      { id: "A", label: "A", kind: "groupe" },
      { id: "B", label: "B", kind: "groupe" },
    ];
    const edges: GraphEdge[] = [
      { from: "A", to: "B", technologie: "HTTP", count: 1, label: "HTTP", atténué: false },
      { from: "A", to: "B", technologie: "Kafka", count: 1, label: "Kafka", atténué: false },
    ];

    const layout = computeLayout(nodes, edges);

    expect(layout.edges).toHaveLength(2);
  });

  it("handles an empty graph", () => {
    const layout = computeLayout([], []);
    expect(layout.nodes).toHaveLength(0);
    expect(layout.edges).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/layout/dagre-layout.test.ts`
Expected: FAIL — `dagre-layout.ts` does not exist.

- [ ] **Step 3: Write the implementation**

`app/src/layout/dagre-layout.ts`:
```ts
import dagre from "dagre";
import type { GraphNode, GraphEdge } from "../aggregation/core";

export interface LayoutNode extends GraphNode {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutEdge extends GraphEdge {
  points: { x: number; y: number }[];
}

export interface LayoutResult {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  width: number;
  height: number;
}

function estimateWidth(label: string): number {
  return Math.max(90, label.length * 7 + 28);
}

export function computeLayout(nodes: GraphNode[], edges: GraphEdge[]): LayoutResult {
  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({ rankdir: "LR", nodesep: 40, ranksep: 70, marginx: 20, marginy: 20 });
  g.setDefaultEdgeLabel(() => ({}));

  for (const node of nodes) {
    g.setNode(node.id, { width: estimateWidth(node.label), height: 40 });
  }
  edges.forEach((edge, i) => {
    g.setEdge(edge.from, edge.to, { width: estimateWidth(edge.label), height: 14 }, `e${i}`);
  });

  dagre.layout(g);

  const layoutNodes: LayoutNode[] = nodes.map((node) => {
    const n = g.node(node.id);
    return { ...node, x: n.x, y: n.y, width: n.width, height: n.height };
  });

  const layoutEdges: LayoutEdge[] = edges.map((edge, i) => {
    const e = g.edge(edge.from, edge.to, `e${i}`);
    return { ...edge, points: e.points };
  });

  const graphInfo = g.graph();
  return {
    nodes: layoutNodes,
    edges: layoutEdges,
    width: graphInfo.width ?? 400,
    height: graphInfo.height ?? 300,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/layout/dagre-layout.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add app/src/layout/dagre-layout.ts app/src/layout/dagre-layout.test.ts
git commit -m "feat: wrap dagre for graph layout"
```

---

### Task 9: render/colors.ts + render/svg-builder.ts

**Files:**
- Create: `app/src/render/colors.ts`
- Create: `app/src/render/svg-builder.ts`
- Test: `app/src/render/svg-builder.test.ts`

**Interfaces:**
- Consumes: `LayoutResult` from `../layout/dagre-layout` (Task 8).
- Produces: `colorForTechnologies(technologies: string[]): Map<string, string>` — computed **once** from the full `model.typesFlux` list so a technology keeps the same color across every view (not recomputed per-view from whatever subset is on screen). `buildGraphSvg(layout: LayoutResult, colorFor: (tech: string) => string): SVGSVGElement` — consumed by `ui/app.ts` (Task 13) and `export/svg-export.ts` / `export/png-export.ts` (Task 11).

- [ ] **Step 1: Write colors.ts (no test — a deterministic lookup table, exercised indirectly through svg-builder tests)**

`app/src/render/colors.ts`:
```ts
// Palette catégorielle validée (huit teintes, ordre fixe) — voir la skill
// dataviz du projet. La couleur est un rappel visuel : le nom de la
// technologie est toujours écrit sur le trait, donc au-delà de 8
// technologies distinctes on boucle sur la palette plutôt que d'inventer
// des teintes non validées.
const PALETTE = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"];

export function colorForTechnologies(technologies: string[]): Map<string, string> {
  const distinct = [...new Set(technologies.map((t) => t.trim()))].sort((a, b) => a.localeCompare(b, "fr"));
  const map = new Map<string, string>();
  distinct.forEach((tech, i) => map.set(tech, PALETTE[i % PALETTE.length]));
  return map;
}
```

- [ ] **Step 2: Write the failing tests for svg-builder.ts**

`app/src/render/svg-builder.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { buildGraphSvg } from "./svg-builder";
import { computeLayout } from "../layout/dagre-layout";
import { colorForTechnologies } from "./colors";
import type { GraphNode, GraphEdge } from "../aggregation/core";

describe("buildGraphSvg", () => {
  it("draws one <g> per node and one per edge, with the technology label always present", () => {
    const nodes: GraphNode[] = [
      { id: "A", label: "Socle", kind: "groupe" },
      { id: "B", label: "Ryloth", kind: "groupe" },
    ];
    const edges: GraphEdge[] = [{ from: "A", to: "B", technologie: "HTTP", count: 3, label: "HTTP ×3", atténué: false }];
    const layout = computeLayout(nodes, edges);
    const colorFor = (tech: string) => colorForTechnologies(["HTTP"]).get(tech) ?? "#000";

    const svg = buildGraphSvg(layout, colorFor);

    expect(svg.tagName.toLowerCase()).toBe("svg");
    expect(svg.querySelectorAll("text").length).toBeGreaterThanOrEqual(3); // 2 node labels + 1 edge label
    expect(svg.textContent).toContain("HTTP ×3");
  });

  it("renders an attenuated edge as dashed with reduced opacity", () => {
    const nodes: GraphNode[] = [
      { id: "A", label: "A", kind: "groupe" },
      { id: "B", label: "B", kind: "groupe" },
    ];
    const edges: GraphEdge[] = [{ from: "A", to: "B", technologie: "HTTP", count: 1, label: "HTTP", atténué: true }];
    const layout = computeLayout(nodes, edges);

    const svg = buildGraphSvg(layout, () => "#2a78d6");

    const path = svg.querySelector("path[stroke-dasharray]");
    expect(path).not.toBeNull();
  });

  it("renders a plateforme node with a tinted fill and thicker stroke", () => {
    const nodes: GraphNode[] = [{ id: "A", label: "Tatooine", kind: "plateforme" }];
    const layout = computeLayout(nodes, []);

    const svg = buildGraphSvg(layout, () => "#2a78d6");

    const rect = svg.querySelector("rect[stroke-width='2.5']");
    expect(rect).not.toBeNull();
  });

  it("renders the selected actor in inverted colors", () => {
    const nodes: GraphNode[] = [{ id: "A", label: "Tatooine", kind: "acteur-selectionne" }];
    const layout = computeLayout(nodes, []);

    const svg = buildGraphSvg(layout, () => "#2a78d6");

    const text = svg.querySelector("text")!;
    expect(text.getAttribute("fill")).toBe("#ffffff");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd app && npx vitest run src/render/svg-builder.test.ts`
Expected: FAIL — `svg-builder.ts` does not exist.

- [ ] **Step 4: Write the implementation**

`app/src/render/svg-builder.ts`:
```ts
import type { LayoutResult, LayoutEdge, LayoutNode } from "../layout/dagre-layout";

const SVG_NS = "http://www.w3.org/2000/svg";
// Fixe, indépendant du thème de l'appli : un export doit rester lisible
// ouvert seul, hors de toute page qui l'habillerait en clair/sombre (§8).
const PAPIER = "#ffffff";
const ENCRE = "#14181f";

function el<K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, tag);
}

function rect(x: number, y: number, w: number, h: number, fill: string, stroke: string, strokeWidth: number): SVGRectElement {
  const r = el("rect");
  r.setAttribute("x", String(x));
  r.setAttribute("y", String(y));
  r.setAttribute("width", String(w));
  r.setAttribute("height", String(h));
  r.setAttribute("rx", "4");
  r.setAttribute("fill", fill);
  r.setAttribute("stroke", stroke);
  r.setAttribute("stroke-width", String(strokeWidth));
  return r;
}

function edgeWidth(count: number): number {
  return Math.min(1 + Math.log2(count + 1), 6);
}

function buildEdgeElement(edge: LayoutEdge, colorFor: (tech: string) => string): SVGGElement {
  const g = el("g");
  const d = "M " + edge.points.map((p) => `${p.x},${p.y}`).join(" L ");

  const path = el("path");
  path.setAttribute("d", d);
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", colorFor(edge.technologie));
  path.setAttribute("stroke-width", String(edgeWidth(edge.count)));
  path.setAttribute("marker-end", "url(#fleche)");
  if (edge.atténué) {
    path.setAttribute("stroke-dasharray", "6 4");
    path.setAttribute("opacity", "0.5");
  }
  g.appendChild(path);

  const mid = edge.points[Math.floor(edge.points.length / 2)];
  const text = el("text");
  text.setAttribute("x", String(mid.x));
  text.setAttribute("y", String(mid.y - 4));
  text.setAttribute("text-anchor", "middle");
  text.setAttribute("font-size", "11");
  text.setAttribute("fill", ENCRE);
  if (edge.atténué) text.setAttribute("opacity", "0.6");
  text.textContent = edge.label;
  g.appendChild(text);

  return g;
}

function buildNodeElement(node: LayoutNode): SVGGElement {
  const g = el("g");
  const x = node.x - node.width / 2;
  const y = node.y - node.height / 2;

  if (node.kind === "groupe") {
    g.appendChild(rect(x, y, node.width, node.height, PAPIER, ENCRE, 1));
    g.appendChild(rect(x + 4, y + 4, node.width - 8, node.height - 8, "none", ENCRE, 1));
  } else if (node.kind === "plateforme") {
    g.appendChild(rect(x, y, node.width, node.height, "#dce8fb", ENCRE, 2.5));
  } else if (node.kind === "acteur-selectionne") {
    g.appendChild(rect(x, y, node.width, node.height, ENCRE, ENCRE, 1));
  } else {
    g.appendChild(rect(x, y, node.width, node.height, PAPIER, ENCRE, 1));
  }

  const text = el("text");
  text.setAttribute("x", String(node.x));
  text.setAttribute("y", String(node.y + 4));
  text.setAttribute("text-anchor", "middle");
  text.setAttribute("font-size", "12");
  text.setAttribute("fill", node.kind === "acteur-selectionne" ? "#ffffff" : ENCRE);
  text.textContent = node.label;
  g.appendChild(text);

  return g;
}

export function buildGraphSvg(layout: LayoutResult, colorFor: (tech: string) => string): SVGSVGElement {
  const width = Math.max(layout.width, 100);
  const height = Math.max(layout.height, 100);

  const svg = el("svg");
  svg.setAttribute("xmlns", SVG_NS);
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));

  const defs = el("defs");
  const marker = el("marker");
  marker.setAttribute("id", "fleche");
  marker.setAttribute("viewBox", "0 0 10 10");
  marker.setAttribute("refX", "9");
  marker.setAttribute("refY", "5");
  marker.setAttribute("markerWidth", "7");
  marker.setAttribute("markerHeight", "7");
  marker.setAttribute("orient", "auto-start-reverse");
  const arrowPath = el("path");
  arrowPath.setAttribute("d", "M0,0 L10,5 L0,10 Z");
  arrowPath.setAttribute("fill", ENCRE);
  marker.appendChild(arrowPath);
  defs.appendChild(marker);
  svg.appendChild(defs);

  const background = rect(0, 0, width, height, PAPIER, "none", 0);
  svg.appendChild(background);

  for (const edge of layout.edges) svg.appendChild(buildEdgeElement(edge, colorFor));
  for (const node of layout.nodes) svg.appendChild(buildNodeElement(node));

  return svg;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd app && npx vitest run src/render/svg-builder.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add app/src/render/colors.ts app/src/render/svg-builder.ts app/src/render/svg-builder.test.ts
git commit -m "feat: build the SVG graph renderer and technology color assignment"
```

---

### Task 10: render/matrix-table.ts + render/integrity-report.ts

**Files:**
- Create: `app/src/render/matrix-table.ts`
- Create: `app/src/render/integrity-report.ts`
- Test: `app/src/render/render.test.ts`

**Interfaces:**
- Consumes: `MatrixResult` from `../aggregation/views` (Task 7), `IntegrityReport` from `../integrity/checks` (Task 5).
- Produces: `buildMatrixTable(matrix: MatrixResult, colorFor: (tech: string) => string): HTMLTableElement`, `buildIntegrityReport(report: IntegrityReport): HTMLElement` — both consumed by `ui/app.ts` (Task 13).

- [ ] **Step 1: Write the failing tests**

`app/src/render/render.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { buildMatrixTable } from "./matrix-table";
import { buildIntegrityReport } from "./integrity-report";
import type { MatrixResult } from "../aggregation/views";
import type { IntegrityReport } from "../integrity/checks";

describe("buildMatrixTable", () => {
  it("builds one row per acteur and lists technologies per cell", () => {
    const matrix: MatrixResult = {
      acteurs: ["A", "B"],
      lignes: [
        { acteur: "A", cellules: new Map() },
        { acteur: "B", cellules: new Map([["A", [{ technologie: "HTTP", count: 2, atténué: false }]]]) },
      ],
    };

    const table = buildMatrixTable(matrix, () => "#2a78d6");

    expect(table.tagName.toLowerCase()).toBe("table");
    expect(table.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(table.textContent).toContain("HTTP ×2");
  });

  it("marks an attenuated technology distinctly", () => {
    const matrix: MatrixResult = {
      acteurs: ["A", "B"],
      lignes: [
        { acteur: "A", cellules: new Map([["B", [{ technologie: "HTTP", count: 1, atténué: true }]]]) },
        { acteur: "B", cellules: new Map() },
      ],
    };

    const table = buildMatrixTable(matrix, () => "#2a78d6");

    expect(table.querySelector("[data-attenue='true']")).not.toBeNull();
  });
});

describe("buildIntegrityReport", () => {
  it("renders one block per family with its title and anomaly count", () => {
    const report: IntegrityReport = {
      familles: [
        { id: "structure", titre: "Structure", description: "d", anomalies: [{ message: "Problème A" }] },
        { id: "references", titre: "Références", description: "d", anomalies: [] },
      ],
      blocsInformatifs: [{ id: "groupes", titre: "Groupes utilisés", description: "d", items: ["Socle (2)"] }],
      totalAnomalies: 1,
    };

    const el = buildIntegrityReport(report);

    expect(el.textContent).toContain("Structure");
    expect(el.textContent).toContain("Problème A");
    expect(el.textContent).toContain("Rien à signaler");
    expect(el.textContent).toContain("Groupes utilisés");
    expect(el.textContent).toContain("Socle (2)");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/render/render.test.ts`
Expected: FAIL — `matrix-table.ts` and `integrity-report.ts` do not exist.

- [ ] **Step 3: Write the implementation**

`app/src/render/matrix-table.ts`:
```ts
import type { MatrixResult } from "../aggregation/views";

export function buildMatrixTable(matrix: MatrixResult, colorFor: (tech: string) => string): HTMLTableElement {
  const table = document.createElement("table");
  table.className = "matrice";

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  headRow.appendChild(document.createElement("th"));
  for (const acteur of matrix.acteurs) {
    const th = document.createElement("th");
    th.textContent = acteur;
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  for (const ligne of matrix.lignes) {
    const tr = document.createElement("tr");
    const th = document.createElement("th");
    th.textContent = ligne.acteur;
    tr.appendChild(th);

    for (const arrivee of matrix.acteurs) {
      const td = document.createElement("td");
      const cellules = ligne.cellules.get(arrivee) ?? [];
      for (const cell of cellules) {
        const span = document.createElement("span");
        span.className = "matrice-techno";
        span.style.color = colorFor(cell.technologie);
        span.textContent = cell.count > 1 ? `${cell.technologie} ×${cell.count}` : cell.technologie;
        if (cell.atténué) {
          span.dataset.attenue = "true";
          span.style.opacity = "0.5";
        }
        td.appendChild(span);
      }
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);

  return table;
}
```

`app/src/render/integrity-report.ts`:
```ts
import type { IntegrityReport } from "../integrity/checks";

export function buildIntegrityReport(report: IntegrityReport): HTMLElement {
  const container = document.createElement("div");
  container.className = "rapport-integrite";

  for (const famille of report.familles) {
    const bloc = document.createElement("section");
    bloc.className = "bloc-anomalies";

    const titre = document.createElement("h3");
    titre.textContent = `${famille.titre} (${famille.anomalies.length})`;
    bloc.appendChild(titre);

    const desc = document.createElement("p");
    desc.textContent = famille.description;
    bloc.appendChild(desc);

    if (famille.anomalies.length === 0) {
      const rien = document.createElement("p");
      rien.className = "rien-a-signaler";
      rien.textContent = "Rien à signaler.";
      bloc.appendChild(rien);
    } else {
      const liste = document.createElement("ul");
      for (const anomalie of famille.anomalies) {
        const li = document.createElement("li");
        li.textContent = anomalie.message;
        liste.appendChild(li);
      }
      bloc.appendChild(liste);
    }

    container.appendChild(bloc);
  }

  for (const bloc of report.blocsInformatifs) {
    const section = document.createElement("section");
    section.className = "bloc-informatif";

    const titre = document.createElement("h3");
    titre.textContent = `${bloc.titre} (${bloc.items.length})`;
    section.appendChild(titre);

    const desc = document.createElement("p");
    desc.textContent = bloc.description;
    section.appendChild(desc);

    if (bloc.items.length === 0) {
      const rien = document.createElement("p");
      rien.className = "rien-a-signaler";
      rien.textContent = "Rien à signaler.";
      section.appendChild(rien);
    } else {
      const liste = document.createElement("ul");
      for (const item of bloc.items) {
        const li = document.createElement("li");
        li.textContent = item;
        liste.appendChild(li);
      }
      section.appendChild(liste);
    }

    container.appendChild(section);
  }

  return container;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/render/render.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add app/src/render/matrix-table.ts app/src/render/integrity-report.ts app/src/render/render.test.ts
git commit -m "feat: render the matrix table and integrity report as HTML"
```

---

### Task 11: export/filename.ts + export/svg-export.ts + export/png-export.ts

**Files:**
- Create: `app/src/export/filename.ts`
- Create: `app/src/export/svg-export.ts`
- Create: `app/src/export/png-export.ts`
- Test: `app/src/export/export.test.ts`

**Interfaces:**
- Produces: `buildExportFilename(vue: string, selection: string | null, cible: boolean, ext: "svg" | "png"): string`, `serializeSvg(svg: SVGSVGElement, backgroundColor: string): string`, `exportPng(svg: SVGSVGElement, backgroundColor: string, scale: number): Promise<{ ok: true; blob: Blob } | { ok: false; error: string }>` — all consumed by `ui/app.ts` (Task 13).

- [ ] **Step 1: Write the failing tests**

`app/src/export/export.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { buildExportFilename } from "./filename";
import { serializeSvg } from "./svg-export";
import { exportPng } from "./png-export";

describe("buildExportFilename", () => {
  it("builds a lowercase, accent-free filename with view and extension", () => {
    expect(buildExportFilename("Groupe à groupe", null, false, "svg")).toBe("carto-groupe-a-groupe.svg");
  });

  it("appends the selection when present", () => {
    expect(buildExportFilename("Par acteur", "Tatooine Système", false, "png")).toBe("carto-par-acteur-tatooine-systeme.png");
  });

  it("appends -cible when the target view is active", () => {
    expect(buildExportFilename("Groupe à groupe", null, true, "svg")).toBe("carto-groupe-a-groupe-cible.svg");
  });
});

describe("serializeSvg", () => {
  it("produces a standalone SVG string with an opaque background", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 100 50");

    const out = serializeSvg(svg, "#ffffff");

    expect(out).toContain("<svg");
    expect(out).toContain("#ffffff");
  });
});

describe("exportPng", () => {
  it("reports a failure explicitly instead of throwing when canvas conversion is unavailable", async () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 100 50");
    svg.setAttribute("width", "100");
    svg.setAttribute("height", "50");

    // jsdom's canvas has no real rasterizer: toBlob never resolves with a
    // real image, and drawImage on an SVG data URL throws — this mirrors
    // the real-world Safari failure mode this function must handle.
    const result = await exportPng(svg, "#ffffff", 2);

    expect(result.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/export/export.test.ts`
Expected: FAIL — none of the three files exist.

- [ ] **Step 3: Write the implementation**

`app/src/export/filename.ts`:
```ts
function slug(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function buildExportFilename(vue: string, selection: string | null, cible: boolean, ext: "svg" | "png"): string {
  const parts = ["carto", slug(vue)];
  if (selection) parts.push(slug(selection));
  if (cible) parts.push("cible");
  return `${parts.join("-")}.${ext}`;
}
```

`app/src/export/svg-export.ts`:
```ts
export function serializeSvg(svg: SVGSVGElement, backgroundColor: string): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");

  const background = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  const viewBox = clone.getAttribute("viewBox");
  const [, , width, height] = viewBox ? viewBox.split(/\s+/) : ["0", "0", clone.getAttribute("width") ?? "0", clone.getAttribute("height") ?? "0"];
  background.setAttribute("x", "0");
  background.setAttribute("y", "0");
  background.setAttribute("width", width);
  background.setAttribute("height", height);
  background.setAttribute("fill", backgroundColor);
  clone.insertBefore(background, clone.firstChild);

  return new XMLSerializer().serializeToString(clone);
}

export function downloadSvg(svg: SVGSVGElement, filename: string, backgroundColor: string): void {
  const source = serializeSvg(svg, backgroundColor);
  const blob = new Blob([source], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
```

`app/src/export/png-export.ts`:
```ts
import { serializeSvg } from "./svg-export";

export type PngResult = { ok: true; blob: Blob } | { ok: false; error: string };

export async function exportPng(svg: SVGSVGElement, backgroundColor: string, scale: number): Promise<PngResult> {
  try {
    const width = Number(svg.getAttribute("width")) || svg.viewBox.baseVal.width;
    const height = Number(svg.getAttribute("height")) || svg.viewBox.baseVal.height;
    if (!width || !height) {
      return { ok: false, error: "Dimensions du schéma indisponibles." };
    }

    const source = serializeSvg(svg, backgroundColor);
    const svgBlob = new Blob([source], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);

    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Échec du chargement du SVG dans une image."));
      img.src = url;
    });

    const canvas = document.createElement("canvas");
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      URL.revokeObjectURL(url);
      return { ok: false, error: "Contexte de rendu 2D indisponible." };
    }

    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) {
      return { ok: false, error: "Ce navigateur refuse la conversion en PNG — utilisez l'export SVG." };
    }

    return { ok: true, blob };
  } catch {
    return { ok: false, error: "Ce navigateur refuse la conversion en PNG — utilisez l'export SVG." };
  }
}

export function downloadPngBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/export/export.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add app/src/export/filename.ts app/src/export/svg-export.ts app/src/export/png-export.ts app/src/export/export.test.ts
git commit -m "feat: implement SVG/PNG export with explicit failure reporting"
```

---

### Task 12: ui/state.ts

**Files:**
- Create: `app/src/ui/state.ts`
- Test: `app/src/ui/state.test.ts`

**Interfaces:**
- Consumes: `ParsedModel` from `../parsing/model`, `IntegrityReport` from `../integrity/checks`.
- Produces: `Vue` (union of the 6 view ids), `AppState`, `initialState(): AppState`, `withFichierCharge(state, fields): AppState`, `withVue(state, vue): AppState`, `withOptions(state, patch): AppState`, `withSelectionActeur/withSelectionTechnologie` — consumed by `ui/app.ts` (Task 13).

- [ ] **Step 1: Write the failing test**

`app/src/ui/state.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { initialState, withFichierCharge, withVue, withOptions, withSelectionActeur } from "./state";
import type { ParsedModel } from "../parsing/model";
import type { IntegrityReport } from "../integrity/checks";

const model: ParsedModel = {
  acteurs: [], typesFlux: [], interfaces: [], consommations: [], fxSheetNames: [],
  colonnesOptionnellesAbsentes: [], fichierModifie: null,
};
const report: IntegrityReport = { familles: [], blocsInformatifs: [], totalAnomalies: 0 };

describe("initialState", () => {
  it("starts with no file loaded and no options set", () => {
    const state = initialState();
    expect(state.fichier).toBeNull();
    expect(state.vue).toBe("groupe-a-groupe");
    expect(state.options).toEqual({ cible: false, compteurs: true });
  });
});

describe("withFichierCharge", () => {
  it("replaces the whole state at once and resets to the default view", () => {
    const loaded = withFichierCharge(initialState(), {
      nom: "classeur.xlsx", model, report, dateModification: null,
    });
    expect(loaded.fichier?.nom).toBe("classeur.xlsx");
    expect(loaded.vue).toBe("groupe-a-groupe");
  });
});

describe("withVue / withOptions / withSelectionActeur", () => {
  it("updates only the targeted slice of state", () => {
    const state = withSelectionActeur(withOptions(withVue(initialState(), "par-acteur"), { cible: true }), "Tatooine");
    expect(state.vue).toBe("par-acteur");
    expect(state.options.cible).toBe(true);
    expect(state.options.compteurs).toBe(true);
    expect(state.selectionActeur).toBe("Tatooine");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/ui/state.test.ts`
Expected: FAIL — `state.ts` does not exist.

- [ ] **Step 3: Write the implementation**

`app/src/ui/state.ts`:
```ts
import type { ParsedModel } from "../parsing/model";
import type { IntegrityReport } from "../integrity/checks";

export type Vue =
  | "groupe-a-groupe"
  | "plateforme-detaillee"
  | "par-acteur"
  | "par-technologie"
  | "matrice"
  | "controles";

export interface FichierCharge {
  nom: string;
  model: ParsedModel;
  report: IntegrityReport;
  dateModification: Date | null;
}

export interface AppOptions {
  cible: boolean;
  compteurs: boolean;
}

export interface AppState {
  fichier: FichierCharge | null;
  vue: Vue;
  options: AppOptions;
  selectionActeur: string | null;
  selectionTechnologie: string | null;
  messageBandeau: string | null;
}

export function initialState(): AppState {
  return {
    fichier: null,
    vue: "groupe-a-groupe",
    options: { cible: false, compteurs: true },
    selectionActeur: null,
    selectionTechnologie: null,
    messageBandeau: null,
  };
}

export function withFichierCharge(state: AppState, fichier: FichierCharge): AppState {
  return {
    ...state,
    fichier,
    vue: "groupe-a-groupe",
    selectionActeur: null,
    selectionTechnologie: null,
    messageBandeau: null,
  };
}

export function withVue(state: AppState, vue: Vue): AppState {
  return { ...state, vue };
}

export function withOptions(state: AppState, patch: Partial<AppOptions>): AppState {
  return { ...state, options: { ...state.options, ...patch } };
}

export function withSelectionActeur(state: AppState, acteur: string | null): AppState {
  return { ...state, selectionActeur: acteur };
}

export function withSelectionTechnologie(state: AppState, technologie: string | null): AppState {
  return { ...state, selectionTechnologie: technologie };
}

export function withMessageBandeau(state: AppState, message: string | null): AppState {
  return { ...state, messageBandeau: message };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/ui/state.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add app/src/ui/state.ts app/src/ui/state.test.ts
git commit -m "feat: add application state and its pure transition functions"
```

---

### Task 13: ui/ DOM wiring (dom.ts, drop-zone.ts, banner.ts, rail.ts, app.ts) + main.ts

**Files:**
- Create: `app/src/ui/dom.ts`
- Create: `app/src/ui/drop-zone.ts`
- Create: `app/src/ui/banner.ts`
- Create: `app/src/ui/rail.ts`
- Create: `app/src/ui/app.ts`
- Create: `app/src/main.ts`

**Interfaces:**
- Consumes: everything built in Tasks 1–12.
- Produces: `mountApp(root: HTMLElement): void`, called by `main.ts` on `DOMContentLoaded`.

This task wires the DOM together per §6 of the spec. It is exercised by manual verification (Task 16), not unit tests — per §11 of the spec, browser-level e2e is explicitly out of scope for this first pass; the pure logic it calls into is already covered by Tasks 1–12.

- [ ] **Step 1: Write dom.ts (small DOM helpers)**

`app/src/ui/dom.ts`:
```ts
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  children: (Node | string)[] = []
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else node.setAttribute(k, v);
  }
  for (const child of children) {
    node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

export function clear(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}
```

- [ ] **Step 2: Write drop-zone.ts**

`app/src/ui/drop-zone.ts`:
```ts
import { el } from "./dom";

export function buildDropTarget(): HTMLElement {
  return el("div", { class: "cible-depot" }, [
    el("p", { class: "cible-depot-titre" }, ["Déposez un classeur .xlsx ou .xlsm"]),
    el("p", { class: "cible-depot-texte" }, [
      "Le classeur n'est ni envoyé ni conservé : tout se passe dans ce navigateur.",
    ]),
  ]);
}

export function wireDropZone(
  root: HTMLElement,
  onFile: (file: File) => void
): void {
  root.addEventListener("dragover", (e) => {
    e.preventDefault();
    root.classList.add("survol");
  });
  root.addEventListener("dragleave", () => {
    root.classList.remove("survol");
  });
  root.addEventListener("drop", (e) => {
    e.preventDefault();
    root.classList.remove("survol");
    const file = e.dataTransfer?.files?.[0];
    if (file) onFile(file);
  });
}
```

- [ ] **Step 3: Write banner.ts**

`app/src/ui/banner.ts`:
```ts
import { el, clear } from "./dom";
import type { AppState } from "./state";

export interface BannerCallbacks {
  onExportSvg: () => void;
  onExportPng: () => void;
}

export function renderBanner(root: HTMLElement, state: AppState, callbacks: BannerCallbacks): void {
  clear(root);

  const titre = el("span", { class: "bandeau-titre" }, ["Carte des interfaces"]);
  root.appendChild(titre);

  const etat = el("span", { class: "bandeau-etat" });
  if (state.messageBandeau) {
    etat.classList.add("bandeau-erreur");
    etat.textContent = state.messageBandeau;
  } else if (state.fichier) {
    const date = state.fichier.dateModification
      ? state.fichier.dateModification.toLocaleString("fr-FR")
      : "date inconnue";
    etat.appendChild(el("strong", {}, [state.fichier.nom]));
    etat.appendChild(
      document.createTextNode(
        ` — ${state.fichier.model.acteurs.length} acteurs, ${state.fichier.model.interfaces.length} interfaces, ${state.fichier.model.consommations.length} consommations — enregistré le ${date}`
      )
    );
  } else {
    etat.textContent = "Aucun classeur chargé.";
  }
  root.appendChild(etat);

  const exportable = state.fichier !== null && state.vue !== "matrice" && state.vue !== "controles";

  const boutonSvg = el("button", { class: "bouton-export" }, ["SVG"]);
  boutonSvg.disabled = !exportable;
  boutonSvg.addEventListener("click", callbacks.onExportSvg);
  root.appendChild(boutonSvg);

  const boutonPng = el("button", { class: "bouton-export" }, ["PNG"]);
  boutonPng.disabled = !exportable;
  boutonPng.addEventListener("click", callbacks.onExportPng);
  root.appendChild(boutonPng);
}
```

- [ ] **Step 4: Write rail.ts**

`app/src/ui/rail.ts`:
```ts
import { el, clear } from "./dom";
import type { AppState, Vue } from "./state";
import { colorForTechnologies } from "../render/colors";

const VUES: { id: Vue; label: string }[] = [
  { id: "groupe-a-groupe", label: "Groupe à groupe" },
  { id: "plateforme-detaillee", label: "Plateforme détaillée" },
  { id: "par-acteur", label: "Par acteur" },
  { id: "par-technologie", label: "Par technologie" },
  { id: "matrice", label: "Matrice" },
  { id: "controles", label: "Contrôles d'intégrité" },
];

export interface RailCallbacks {
  onVue: (vue: Vue) => void;
  onSelectionActeur: (nom: string) => void;
  onSelectionTechnologie: (type: string) => void;
  onOptionCible: (value: boolean) => void;
  onOptionCompteurs: (value: boolean) => void;
}

export function renderRail(root: HTMLElement, state: AppState, technologiesCourantes: string[], callbacks: RailCallbacks): void {
  clear(root);
  if (!state.fichier) return;

  const nav = el("nav", { class: "rail-vues" });
  for (const v of VUES) {
    const bouton = el("button", { class: "rail-vue-item" }, [v.label]);
    if (v.id === state.vue) bouton.setAttribute("aria-current", "true");
    if (v.id === "controles" && state.fichier.report.totalAnomalies > 0) {
      bouton.appendChild(el("span", { class: "compteur-anomalies" }, [String(state.fichier.report.totalAnomalies)]));
    }
    bouton.addEventListener("click", () => callbacks.onVue(v.id));
    nav.appendChild(bouton);
  }
  root.appendChild(nav);

  if (state.vue === "par-acteur") {
    const select = el("select", { class: "rail-selecteur" }) as HTMLSelectElement;
    for (const acteur of [...state.fichier.model.acteurs].sort((a, b) => a.nom.localeCompare(b.nom, "fr"))) {
      const option = el("option", { value: acteur.nom }, [acteur.nom]) as HTMLOptionElement;
      if (acteur.nom === state.selectionActeur) option.selected = true;
      select.appendChild(option);
    }
    select.addEventListener("change", () => callbacks.onSelectionActeur(select.value));
    root.appendChild(select);
  }

  if (state.vue === "par-technologie") {
    const select = el("select", { class: "rail-selecteur" }) as HTMLSelectElement;
    for (const type of [...state.fichier.model.typesFlux].sort((a, b) => a.type.localeCompare(b.type, "fr"))) {
      const option = el("option", { value: type.type }, [type.type]) as HTMLOptionElement;
      if (type.type === state.selectionTechnologie) option.selected = true;
      select.appendChild(option);
    }
    select.addEventListener("change", () => callbacks.onSelectionTechnologie(select.value));
    root.appendChild(select);
  }

  if (state.vue !== "controles") {
    const options = el("fieldset", { class: "rail-options" });

    const cibleLabel = el("label", {});
    const cibleInput = el("input", { type: "checkbox" }) as HTMLInputElement;
    cibleInput.checked = state.options.cible;
    cibleInput.addEventListener("change", () => callbacks.onOptionCible(cibleInput.checked));
    cibleLabel.appendChild(cibleInput);
    cibleLabel.appendChild(document.createTextNode(" cible"));
    options.appendChild(cibleLabel);

    const compteursLabel = el("label", {});
    const compteursInput = el("input", { type: "checkbox" }) as HTMLInputElement;
    compteursInput.checked = state.options.compteurs;
    compteursInput.addEventListener("change", () => callbacks.onOptionCompteurs(compteursInput.checked));
    compteursLabel.appendChild(compteursInput);
    compteursLabel.appendChild(document.createTextNode(" compteurs"));
    options.appendChild(compteursLabel);

    root.appendChild(options);
  }

  if (technologiesCourantes.length > 0) {
    const legende = el("ul", { class: "rail-legende" });
    const couleurs = colorForTechnologies(state.fichier.model.typesFlux.map((t) => t.type));
    for (const tech of technologiesCourantes) {
      const item = el("li", {});
      const puce = el("span", { class: "legende-puce" });
      puce.style.backgroundColor = couleurs.get(tech) ?? "#000";
      item.appendChild(puce);
      item.appendChild(document.createTextNode(tech));
      legende.appendChild(item);
    }
    root.appendChild(legende);
  }
}
```

- [ ] **Step 5: Write app.ts**

`app/src/ui/app.ts`:
```ts
import { el, clear } from "./dom";
import { parseWorkbook } from "../parsing/workbook";
import { buildModel } from "../parsing/build-model";
import { runIntegrityChecks } from "../integrity/checks";
import {
  buildGroupToGroupView,
  buildPlatformDetailView,
  buildByTechnologyView,
  buildByActorView,
  buildMatrixView,
} from "../aggregation/views";
import { computeLayout } from "../layout/dagre-layout";
import { buildGraphSvg } from "../render/svg-builder";
import { buildMatrixTable } from "../render/matrix-table";
import { buildIntegrityReport } from "../render/integrity-report";
import { colorForTechnologies } from "../render/colors";
import { buildExportFilename } from "../export/filename";
import { downloadSvg } from "../export/svg-export";
import { exportPng, downloadPngBlob } from "../export/png-export";
import { buildDropTarget, wireDropZone } from "./drop-zone";
import { renderBanner } from "./banner";
import { renderRail } from "./rail";
import {
  initialState,
  withFichierCharge,
  withVue,
  withOptions,
  withSelectionActeur,
  withSelectionTechnologie,
  withMessageBandeau,
  type AppState,
  type Vue,
} from "./state";

const VUE_LABELS: Record<Vue, string> = {
  "groupe-a-groupe": "Groupe à groupe",
  "plateforme-detaillee": "Plateforme détaillée",
  "par-acteur": "Par acteur",
  "par-technologie": "Par technologie",
  matrice: "Matrice",
  controles: "Contrôles d'intégrité",
};

export function mountApp(root: HTMLElement): void {
  let state: AppState = initialState();

  root.innerHTML = "";
  const bandeau = el("header", { class: "bandeau" });
  const rail = el("aside", { class: "rail" });
  const zoneRendu = el("main", { class: "zone-rendu" });
  const layout = el("div", { class: "mise-en-page" }, [rail, zoneRendu]);
  root.appendChild(bandeau);
  root.appendChild(layout);

  wireDropZone(root, handleFile);

  function setState(next: AppState): void {
    state = next;
    render();
  }

  async function handleFile(file: File): Promise<void> {
    const nomOk = /\.(xlsx|xlsm)$/i.test(file.name);
    if (!nomOk) {
      setState(withMessageBandeau(state, "Ce n'est pas un classeur Excel. Déposez un fichier .xlsx ou .xlsm."));
      return;
    }

    let buffer: ArrayBuffer;
    let parsed;
    try {
      buffer = await file.arrayBuffer();
      parsed = parseWorkbook(buffer);
    } catch {
      setState(withMessageBandeau(state, "Classeur illisible ou corrompu."));
      return;
    }

    const built = buildModel(parsed);
    if (!built.ok) {
      setState(withMessageBandeau(state, built.erreurs.map((e) => e.message).join(" ")));
      return;
    }

    const report = runIntegrityChecks(built.model);
    setState(
      withFichierCharge(state, {
        nom: file.name,
        model: built.model,
        report,
        dateModification: parsed.fichierModifie,
      })
    );
  }

  function currentSvg(): SVGSVGElement | null {
    return zoneRendu.querySelector("svg");
  }

  function exportSvgHandler(): void {
    const svg = currentSvg();
    if (!svg || !state.fichier) return;
    const filename = buildExportFilename(VUE_LABELS[state.vue], state.selectionActeur ?? state.selectionTechnologie, state.options.cible, "svg");
    downloadSvg(svg, filename, "#ffffff");
  }

  async function exportPngHandler(): Promise<void> {
    const svg = currentSvg();
    if (!svg || !state.fichier) return;
    const result = await exportPng(svg, "#ffffff", 2);
    if (!result.ok) {
      setState(withMessageBandeau(state, "Ce navigateur refuse la conversion en PNG — utilisez l'export SVG."));
      return;
    }
    const filename = buildExportFilename(VUE_LABELS[state.vue], state.selectionActeur ?? state.selectionTechnologie, state.options.cible, "png");
    downloadPngBlob(result.blob, filename);
  }

  function render(): void {
    renderBanner(bandeau, state, { onExportSvg: exportSvgHandler, onExportPng: exportPngHandler });

    if (!state.fichier) {
      clear(rail);
      clear(zoneRendu);
      zoneRendu.appendChild(buildDropTarget());
      return;
    }

    const model = state.fichier.model;

    clear(zoneRendu);
    let technologiesCourantes: string[] = [];

    if (state.vue === "controles") {
      zoneRendu.appendChild(buildIntegrityReport(state.fichier.report));
    } else if (state.vue === "matrice") {
      const matrix = buildMatrixView(model, { cible: state.options.cible });
      const couleurs = colorForTechnologies(model.typesFlux.map((t) => t.type));
      zoneRendu.appendChild(buildMatrixTable(matrix, (t) => couleurs.get(t) ?? "#000"));
      technologiesCourantes = [...new Set(matrix.lignes.flatMap((l) => [...l.cellules.values()].flat().map((c) => c.technologie)))];
    } else {
      let view;
      if (state.vue === "groupe-a-groupe") {
        view = buildGroupToGroupView(model, state.options);
      } else if (state.vue === "plateforme-detaillee") {
        view = buildPlatformDetailView(model, state.options);
      } else if (state.vue === "par-acteur") {
        if (!state.selectionActeur && model.acteurs.length > 0) {
          setState(withSelectionActeur(state, [...model.acteurs].sort((a, b) => a.nom.localeCompare(b.nom, "fr"))[0].nom));
          return;
        }
        view = state.selectionActeur
          ? buildByActorView(model, state.selectionActeur, { cible: state.options.cible })
          : { nodes: [], edges: [] };
      } else {
        if (!state.selectionTechnologie && model.typesFlux.length > 0) {
          setState(withSelectionTechnologie(state, [...model.typesFlux].sort((a, b) => a.type.localeCompare(b.type, "fr"))[0].type));
          return;
        }
        view = state.selectionTechnologie
          ? buildByTechnologyView(model, state.selectionTechnologie, state.options)
          : { nodes: [], edges: [] };
      }

      if (view.edges.length === 0 && view.nodes.length <= 1) {
        zoneRendu.appendChild(el("p", { class: "aucun-flux" }, ["Aucun flux à afficher pour cette sélection."]));
      } else {
        const positioned = computeLayout(view.nodes, view.edges);
        const couleurs = colorForTechnologies(model.typesFlux.map((t) => t.type));
        zoneRendu.appendChild(buildGraphSvg(positioned, (t) => couleurs.get(t) ?? "#000"));
        technologiesCourantes = [...new Set(view.edges.map((e) => e.technologie))];
      }
    }

    renderRail(rail, state, technologiesCourantes.sort((a, b) => a.localeCompare(b, "fr")), {
      onVue: (vue) => setState(withVue(state, vue)),
      onSelectionActeur: (nom) => setState(withSelectionActeur(state, nom)),
      onSelectionTechnologie: (type) => setState(withSelectionTechnologie(state, type)),
      onOptionCible: (value) => setState(withOptions(state, { cible: value })),
      onOptionCompteurs: (value) => setState(withOptions(state, { compteurs: value })),
    });
  }

  render();
}
```

- [ ] **Step 6: Write main.ts**

`app/src/main.ts`:
```ts
import { mountApp } from "./ui/app";

window.addEventListener("DOMContentLoaded", () => {
  const root = document.getElementById("app");
  if (root) mountApp(root);
});
```

- [ ] **Step 7: Type-check**

Run: `cd app && npm run typecheck`
Expected: no errors. Fix any type mismatch between this task's code and the signatures produced by Tasks 1–12 before continuing (this task is the integration point where a naming drift between tasks would surface).

- [ ] **Step 8: Commit**

```bash
git add app/src/ui/dom.ts app/src/ui/drop-zone.ts app/src/ui/banner.ts app/src/ui/rail.ts app/src/ui/app.ts app/src/main.ts
git commit -m "feat: wire the UI shell (drop zone, banner, rail, render loop)"
```

---

### Task 14: Build pipeline (index.html + esbuild + CSS)

**Files:**
- Create: `app/index.html`
- Create: `app/esbuild.build.mjs`

**Interfaces:**
- Consumes: `app/src/main.ts` (Task 13) as the esbuild entry point.
- Produces: `app/dist/interface-map.html` — the final single-file deliverable.

**Design plan.** This is an internal technical tool — read and operated, not browsed — for architects reviewing system-integration flows. The treatment stays utilitarian-polished (no hero, no decoration for its own sake), grounded in the one vernacular that actually fits the subject: architecture diagrams are drawn on grid paper, so the render zone carries a faint blueprint dot-grid instead of a plain flat panel. Everything else stays quiet around it.

- **Color** — cool-tinted neutrals (never pure gray) plus one accent, reused from the technology legend's own first categorical slot so the chrome and the diagrams it frames read as one system: `--ground:#f5f7fa` `--surface:#ffffff` `--ink:#14181f` `--ink-muted:#5b6472` `--accent:#2a78d6` `--line:#dde1e7` `--critical:#d03b3b` (reserved for the anomaly counter only). `--paper:#ffffff` is fixed and theme-independent — exports must read correctly opened alone (§8), so diagrams never pick up the dark palette.
- **Type** — system sans throughout (no downloaded fonts — §2.1); technology names in the matrix (`.matrice-techno`, Task 10) go in the system monospace stack, marking them as literal data read from the workbook rather than UI copy; counts (décomptes, compteurs ×N) get `font-variant-numeric: tabular-nums`.
- **Layout** — bandeau as a slim toolbar, rail as a control panel with hairline dividers between grouped sections (no boxed cards), zone-rendu on the dot-grid ground.

Both themes are real (`prefers-color-scheme`), since this is a normal web page a user may open in either OS mode — not an Artifact host, so no `data-theme` stamp to honor, just the system query.

- [ ] **Step 1: Write the HTML shell with inline CSS**

`app/index.html`:
```html
<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<title>Carte des interfaces</title>
<style>
  :root {
    --ground: #f5f7fa;
    --surface: #ffffff;
    --ink: #14181f;
    --ink-muted: #5b6472;
    --accent: #2a78d6;
    --accent-ink: #ffffff;
    --line: #dde1e7;
    --critical: #d03b3b;
    --paper: #ffffff;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --ground: #10131a;
      --surface: #171b23;
      --ink: #eef1f6;
      --ink-muted: #9099a8;
      --accent: #5b9ce8;
      --accent-ink: #0b0e14;
      --line: #2a3040;
      --critical: #e6716f;
    }
  }

  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--ground); color: var(--ink);
    font-family: system-ui, -apple-system, "Segoe UI", "Helvetica Neue", Arial, sans-serif;
  }
  #app { display: flex; flex-direction: column; height: 100vh; }

  .bandeau {
    display: flex; align-items: center; gap: 16px;
    padding: 10px 16px; border-bottom: 1px solid var(--line); background: var(--surface);
  }
  .bandeau-titre { font-weight: 700; font-size: 16px; }
  .bandeau-etat { flex: 1; color: var(--ink-muted); font-size: 13px; font-variant-numeric: tabular-nums; }
  .bandeau-erreur { color: var(--critical); font-weight: 600; }
  .bouton-export {
    border: 1px solid var(--line); background: var(--surface); color: var(--ink);
    border-radius: 4px; padding: 6px 12px; cursor: pointer; font-size: 13px;
  }
  .bouton-export:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
  .bouton-export:disabled { opacity: 0.4; cursor: not-allowed; }
  .bouton-export:focus-visible, .rail-vue-item:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  .mise-en-page { flex: 1; display: flex; min-height: 0; }
  .rail {
    width: 220px; flex-shrink: 0; border-right: 1px solid var(--line);
    padding: 12px; overflow-y: auto; background: var(--surface);
    display: flex; flex-direction: column; gap: 16px;
  }
  .rail-vues { display: flex; flex-direction: column; gap: 4px; padding-bottom: 16px; border-bottom: 1px solid var(--line); }
  .rail-vue-item {
    text-align: left; border: none; background: none; color: var(--ink);
    padding: 8px 10px; border-radius: 4px; cursor: pointer; font-size: 13px;
    display: flex; justify-content: space-between; align-items: center;
  }
  .rail-vue-item:hover { background: var(--ground); }
  .rail-vue-item[aria-current="true"] { background: var(--accent); color: var(--accent-ink); }
  .compteur-anomalies {
    background: var(--critical); color: #ffffff; border-radius: 999px;
    font-size: 11px; padding: 1px 6px; font-variant-numeric: tabular-nums;
  }
  .rail-selecteur {
    width: 100%; padding: 6px; border: 1px solid var(--line); border-radius: 4px;
    background: var(--surface); color: var(--ink);
  }
  .rail-options {
    border: none; padding: 0 0 16px 0; margin: 0; border-bottom: 1px solid var(--line);
    display: flex; flex-direction: column; gap: 6px; font-size: 13px;
  }
  .rail-legende { list-style: none; padding: 0; margin: 0; font-size: 12px; display: flex; flex-direction: column; gap: 4px; }
  .rail-legende li { display: flex; align-items: center; gap: 6px; }
  .legende-puce { width: 10px; height: 10px; border-radius: 2px; display: inline-block; flex-shrink: 0; }

  .zone-rendu {
    flex: 1; overflow: auto; padding: 16px;
    background-color: var(--ground);
    background-image: radial-gradient(circle, var(--line) 1px, transparent 1px);
    background-size: 20px 20px;
  }
  .cible-depot {
    border: 2px dashed var(--line); border-radius: 8px; height: 100%;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    text-align: center; color: var(--ink-muted); gap: 8px;
  }
  #app.survol .cible-depot { border-color: var(--accent); background: var(--surface); }
  .cible-depot-titre { font-size: 16px; font-weight: 600; color: var(--ink); }

  .aucun-flux { color: var(--ink-muted); font-style: italic; }

  table.matrice { border-collapse: collapse; font-size: 13px; background: var(--surface); }
  table.matrice th, table.matrice td { border: 1px solid var(--line); padding: 6px 8px; vertical-align: top; }
  table.matrice thead th { background: var(--surface); position: sticky; top: 0; }
  .matrice-techno {
    display: block; font-weight: 600; font-variant-numeric: tabular-nums;
    font-family: ui-monospace, "SF Mono", "Cascadia Code", Consolas, monospace;
  }

  .rapport-integrite { display: flex; flex-direction: column; gap: 20px; max-width: 800px; }
  .bloc-anomalies, .bloc-informatif { background: var(--surface); border: 1px solid var(--line); border-radius: 6px; padding: 12px 16px; }
  .bloc-anomalies h3, .bloc-informatif h3 { margin: 0 0 4px 0; font-variant-numeric: tabular-nums; }
  .bloc-anomalies p, .bloc-informatif p { margin: 0 0 8px 0; color: var(--ink-muted); font-size: 13px; }
  .rien-a-signaler { font-style: italic; color: var(--ink-muted); }

  @media (prefers-reduced-motion: no-preference) {
    .bouton-export, .rail-vue-item { transition: background-color 120ms ease, color 120ms ease, border-color 120ms ease; }
  }
</style>
</head>
<body>
  <div id="app"></div>
  <script>/*__SCRIPT__*/</script>
</body>
</html>
```

- [ ] **Step 2: Write the build script**

`app/esbuild.build.mjs`:
```js
import * as esbuild from "esbuild";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

mkdirSync("dist", { recursive: true });

const result = await esbuild.build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  format: "iife",
  target: "es2020",
  write: false,
  logLevel: "info",
});

const js = result.outputFiles[0].text;
const template = readFileSync("index.html", "utf8");
const html = template.replace("/*__SCRIPT__*/", () => js);
writeFileSync("dist/interface-map.html", html);
console.log("Built dist/interface-map.html");
```

(`() => js` as the replacement avoids `String.prototype.replace` interpreting `$`-sequences inside the bundled JS as special patterns.)

- [ ] **Step 3: Run the build**

Run: `cd app && npm run build`
Expected: `Built dist/interface-map.html` printed, file exists, size in the low hundreds of KB (SheetJS + dagre + app code).

- [ ] **Step 4: Sanity-check the output is self-contained**

Run: `grep -c "http://" app/dist/interface-map.html; grep -c "cdn" app/dist/interface-map.html`
Expected: both `0` (aside from the SVG namespace URIs, which are not network resources — if the first grep is non-zero, verify every match is `http://www.w3.org/...` XML namespace strings, not an actual fetch/URL).

- [ ] **Step 5: Commit**

```bash
git add app/index.html app/esbuild.build.mjs
git commit -m "build: bundle the app into a single self-contained html file"
```

(`app/dist/` stays untracked — it is a build artifact, not source; add `app/dist/` and `app/node_modules/` to `app/.gitignore` in this same commit.)

`app/.gitignore`:
```
node_modules/
dist/
```

---

### Task 15: Integration test against the real fixture

**Files:**
- Create: `app/test/integration.test.ts`

**Interfaces:**
- Consumes: `parseWorkbook` (Task 3), `buildModel` (Task 4), `runIntegrityChecks` (Task 5), the real file `Exemples/cartographie-interfaces_3.xlsx` (repo root, two levels up from `app/test/`).

- [ ] **Step 1: Write the test**

`app/test/integration.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseWorkbook } from "../src/parsing/workbook";
import { buildModel } from "../src/parsing/build-model";
import { runIntegrityChecks } from "../src/integrity/checks";
import { buildGroupToGroupView } from "../src/aggregation/views";

const here = path.dirname(fileURLToPath(import.meta.url));

describe("real fixture: Exemples/cartographie-interfaces_3.xlsx", () => {
  it("parses end to end without throwing and yields plausible counts", () => {
    const filePath = path.resolve(here, "../../Exemples/cartographie-interfaces_3.xlsx");
    const buffer = readFileSync(filePath);
    const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

    const workbook = parseWorkbook(arrayBuffer as ArrayBuffer);
    const built = buildModel(workbook);

    expect(built.ok).toBe(true);
    if (!built.ok) return;

    expect(built.model.acteurs.length).toBeGreaterThanOrEqual(11);
    expect(built.model.interfaces.length).toBeGreaterThanOrEqual(21);
    expect(built.model.consommations.length).toBeGreaterThanOrEqual(21);
    // FX_Modèle must not be picked up as a real consumption tab.
    expect(built.model.fxSheetNames).not.toContain("FX_Modèle");

    const report = runIntegrityChecks(built.model);
    expect(report.familles).toHaveLength(4);
    expect(report.blocsInformatifs).toHaveLength(3);

    const view = buildGroupToGroupView(built.model, { cible: false, compteurs: true });
    expect(view.nodes.length).toBeGreaterThan(0);
    expect(view.edges.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails or passes honestly**

Run: `cd app && npx vitest run test/integration.test.ts`
Expected: PASS. If it fails, read the failure carefully — this is the first time every module runs together against real, messy data (the actual actor/interface counts from `Exemples/cartographie-interfaces_3.xlsx`: 11 acteurs, 21 interfaces, 21 consommations across 10 real `FX_*` tabs plus the ignored `FX_Modèle`). Do not adjust the fixture; fix the pipeline code in the task that owns the broken behavior.

- [ ] **Step 3: Commit**

```bash
git add app/test/integration.test.ts
git commit -m "test: verify the pipeline against the real example workbook"
```

---

### Task 16: Manual verification

**Files:** none (verification only).

- [ ] **Step 1: Build the final artifact**

Run: `cd app && npm run build`

- [ ] **Step 2: Open it and exercise the golden path**

Use the `run` skill (or open `app/dist/interface-map.html` directly in a browser) to:
1. Open the file via `file://` (double-click or drag into a browser tab) — confirm the drop target appears with no console errors.
2. Drag `Exemples/cartographie-interfaces_3.xlsx` onto the page — confirm the banner shows the filename, counts, and a save date; confirm "Groupe à groupe" is selected by default.
3. Click through all 6 views in the rail; for "Par acteur" and "Par technologie", change the selector and confirm the diagram updates.
4. Toggle "cible" and "compteurs"; confirm edges/labels change accordingly.
5. Open "Contrôles d'intégrité"; confirm the anomaly counter in the rail matches the sum shown in the report, and that `FX_Modèle` produces no "onglet sans interface" anomaly.
6. Click "SVG" export on a graphical view; confirm a `.svg` file downloads and opens correctly.
7. Click "PNG" export; confirm a `.png` file downloads.
8. Drop a non-`.xlsx` file; confirm the banner shows the expected error message and the previously loaded state is untouched.

- [ ] **Step 3: Report results**

If every check in Step 2 passes, the implementation is complete. If any check fails, use the `superpowers:systematic-debugging` skill to diagnose — do not patch symptoms in `ui/app.ts` without first identifying which task's module actually produced the wrong data.
