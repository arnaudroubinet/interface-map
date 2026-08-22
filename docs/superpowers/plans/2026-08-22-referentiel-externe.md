# Référentiel externe chargé par Power Query — plan d'implémentation

> **Pour les agents :** COMPÉTENCE REQUISE — `superpowers:subagent-driven-development`
> (recommandé) ou `superpowers:executing-plans`. Les étapes sont en cases à
> cocher (`- [ ]`).

**Objectif :** le classeur va chercher ses acteurs et ses technologies dans deux
référentiels publiés à une URL, par deux requêtes Power Query que l'outil écrit
lui-même dans le fichier.

**Architecture :** un module `export/datamashup.ts` fabrique et relit le flux
binaire MS-QDEFF, sans aucune dépendance : zip « stocké » écrit à la main,
`DecompressionStream` natif pour la relecture. La couche OOXML existante
(`export/xlsx-tables.ts`) apprend à poser trois familles de parties nouvelles —
`customXml`, `connections`, `queryTables`. Deux onglets masqués `RefActors` et
`RefTechnologies` reçoivent les données ; les onglets `Actors` et `FlowTypes`
gardent leur rôle et y puisent leurs listes déroulantes et leurs couleurs.

**Pile :** TypeScript, SheetJS (`xlsx`), Vitest, esbuild. Aucune dépendance npm
nouvelle.

**Spec :** `docs/superpowers/specs/2026-08-22-referentiel-externe-design.md`

## Contraintes globales

- **Aucune dépendance npm nouvelle.** Le livrable est un `.html` unique et
  autonome (`app/dist/interface-map.html`, ~2,23 Mo) ; tout est inliné.
- **Code, commentaires, tests et interface en anglais.** Seules les données
  citées restent en français. Les messages de commit sont en anglais, style
  *conventional commits*.
- **Ne pas commenter du code qu'on ne modifie pas**, ne pas ajouter
  d'annotations de type superflues, ne pas gérer d'erreurs impossibles.
- **Aucune interaction git sans accord explicite de l'utilisateur** en dehors des
  `git commit` prévus par ce plan. Jamais de `push`, jamais de `--force`, jamais
  de `Co-Authored-By`.
- **`SCHEMA_VERSION` passe de 4 à 5** (tâche 6). Tant que la tâche 6 n'est pas
  faite, il reste à 4.
- **Nom des onglets : `RefActors` et `RefTechnologies`.** Nom des requêtes M :
  `RefActors` et `RefTechnologies`, identiques aux onglets.
- **Un classeur sans URL doit se comporter exactement comme aujourd'hui.**
  URL vide ⇒ aucune requête, aucune partie `customXml`, aucune connexion — mais
  les deux onglets existent quand même, vides.
- Vérification finale dans Chrome (`npm run build`, servir la racine du dépôt,
  glisser-déposer un classeur), pas seulement `vitest` et `tsc`.
- **Ne jamais piloter Excel par automatisation d'interface.** Pour faire vérifier
  un classeur, le livrer à l'utilisateur.

## Structure des fichiers

| Fichier | Responsabilité |
|---|---|
| `app/src/export/datamashup.ts` | **nouveau** — le format MS-QDEFF : écriture (tâche 1) et relecture (tâche 2). Ne connaît ni SheetJS ni le modèle. |
| `app/src/export/datamashup.test.ts` | **nouveau** — aller-retour sur le flux. |
| `app/src/export/xlsx-tables.ts` | pose des parties binaires, `customXml`, `connections`, `queryTables`. |
| `app/src/export/template-export.ts` | les deux onglets `Ref*`, leurs tables, leurs validations, le passage des URL. |
| `app/src/parsing/model.ts` | les deux listes du référentiel dans `ParsedModel`. |
| `app/src/parsing/build-model.ts` | lecture des deux onglets, `SCHEMA_VERSION = 5`. |
| `app/src/export/schema-upgrade.ts` | étape 4 → 5. |
| `app/src/render/colors.ts` | ordre de priorité des couleurs. |
| `app/src/integrity/checks.ts` | deux signalements. |
| `app/src/ui/state.ts`, `rail.ts`, `app.ts` | saisie et affichage des deux URL. |

---

## Tâche 1 : le flux DataMashup, en écriture

**Fichiers :**
- Créer : `app/src/export/datamashup.ts`
- Créer : `app/src/export/datamashup.test.ts`

**Interfaces :**
- Consomme : rien.
- Produit :
  - `export interface ReferentialUrls { actors: string; technologies: string }`
  - `export const NO_REFERENTIAL: ReferentialUrls`
  - `export function hasReferential(urls: ReferentialUrls): boolean`
  - `export const MASHUP_QUERIES: readonly ["RefActors", "RefTechnologies"]`
  - `export function sectionM(urls: ReferentialUrls): string`
  - `export function customXmlItem(urls: ReferentialUrls): Uint8Array`
  - `export function storedZip(entries: readonly { path: string; bytes: Uint8Array }[]): Uint8Array`

- [ ] **Étape 1 : écrire le test qui échoue**

Créer `app/src/export/datamashup.test.ts` :

```ts
import { describe, it, expect } from "vitest";
import { sectionM, customXmlItem, storedZip, hasReferential, NO_REFERENTIAL } from "./datamashup";

describe("sectionM", () => {
  it("declares one shared query per referential, in a fixed order", () => {
    const m = sectionM({ actors: "https://ref/a.csv", technologies: "https://ref/t.csv" });
    expect(m.startsWith("section Section1;")).toBe(true);
    expect(m).toContain('shared RefActors =');
    expect(m).toContain('shared RefTechnologies =');
    expect(m.indexOf("RefActors")).toBeLessThan(m.indexOf("RefTechnologies"));
  });

  it("reads UTF-8 CSV and promotes the header row", () => {
    const m = sectionM({ actors: "https://ref/a.csv", technologies: "https://ref/t.csv" });
    expect(m).toContain("Csv.Document");
    expect(m).toContain("Encoding=65001");
    expect(m).toContain("Table.PromoteHeaders");
  });

  it("doubles a quote inside a URL, so the M literal stays closed", () => {
    const m = sectionM({ actors: 'https://ref/a".csv', technologies: "" });
    expect(m).toContain('Web.Contents("https://ref/a"".csv")');
  });

  it("omits a query whose URL is empty rather than writing an unreachable one", () => {
    const m = sectionM({ actors: "https://ref/a.csv", technologies: "" });
    expect(m).toContain("shared RefActors =");
    expect(m).not.toContain("shared RefTechnologies =");
  });
});

describe("hasReferential", () => {
  it("is false when neither URL is set", () => {
    expect(hasReferential(NO_REFERENTIAL)).toBe(false);
    expect(hasReferential({ actors: "   ", technologies: "" })).toBe(false);
  });

  it("is true as soon as one URL is set", () => {
    expect(hasReferential({ actors: "https://ref/a.csv", technologies: "" })).toBe(true);
  });
});

describe("storedZip", () => {
  it("writes an end-of-central-directory record and nothing else when empty", () => {
    const zip = storedZip([]);
    expect(zip.length).toBe(22);
    expect(new DataView(zip.buffer).getUint32(0, true)).toBe(0x06054b50);
  });

  it("stores each entry uncompressed, with its CRC", async () => {
    const bytes = new TextEncoder().encode("hello");
    const zip = storedZip([{ path: "a.txt", bytes }]);
    // Read it back with the platform's own reader: if it disagrees with us,
    // Excel will too.
    const found = await entryOfZip(zip, "a.txt");
    expect(new TextDecoder().decode(found!)).toBe("hello");
  });
});

// A minimal central-directory walk, written in the test so that the writer is
// checked against something other than itself.
async function entryOfZip(zip: Uint8Array, path: string): Promise<Uint8Array | null> {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let eocd = -1;
  for (let i = zip.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return null;
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  for (let i = 0; i < count; i++) {
    const nameLength = view.getUint16(p + 28, true);
    const name = new TextDecoder().decode(zip.subarray(p + 46, p + 46 + nameLength));
    const local = view.getUint32(p + 42, true);
    const size = view.getUint32(p + 20, true);
    if (name === path) {
      const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
      return zip.subarray(start, start + size);
    }
    p += 46 + nameLength + view.getUint16(p + 30, true) + view.getUint16(p + 32, true);
  }
  return null;
}

describe("customXmlItem", () => {
  it("is UTF-16 little-endian with a byte-order mark, as Excel writes it", () => {
    const bytes = customXmlItem({ actors: "https://ref/a.csv", technologies: "" });
    expect(bytes[0]).toBe(0xff);
    expect(bytes[1]).toBe(0xfe);
    expect(new TextDecoder("utf-16le").decode(bytes)).toContain("DataMashup");
  });

  it("carries the stream as base64 under the DataMashup namespace", () => {
    const text = new TextDecoder("utf-16le").decode(customXmlItem({ actors: "https://ref/a.csv", technologies: "" }));
    expect(text).toContain('xmlns="http://schemas.microsoft.com/DataMashup"');
    expect(/>[A-Za-z0-9+/=]{40,}</.test(text)).toBe(true);
  });
});
```

- [ ] **Étape 2 : lancer le test pour vérifier qu'il échoue**

```bash
cd app && npx vitest run src/export/datamashup.test.ts
```
Attendu : ÉCHEC, `Failed to resolve import "./datamashup"`.

- [ ] **Étape 3 : écrire `datamashup.ts`**

Créer `app/src/export/datamashup.ts` :

```ts
// The Power Query stream, written by hand.
//
// Excel keeps its queries in customXml/item1.xml, base64-encoded, in the format
// Microsoft specifies as MS-QDEFF. Two free implementations exist; neither is
// used here. The deliverable is one 2.2 MB HTML file, and the stream is four
// length-prefixed blocks around a zip -- less code than the wiring a dependency
// would need.
//
// What actually blocks Excel is none of the things one expects. Not the
// permission bindings, which may be left empty; not any signature. Three
// writing conventions, each found by diffing a workbook Excel itself produced:
//   - customXml/item1.xml is UTF-16 with a BOM, never UTF-8;
//   - the inner XML documents declare xsi and xsd and NOT the DataMashup
//     default namespace, each prefixed with a UTF-8 BOM;
//   - the metadata's content block is an EMPTY zip, not an absence.
// Depart from any of the three and Excel reports a damaged file, or opens it
// with no queries at all.

export interface ReferentialUrls {
  // Where the actors are published. Empty means "this workbook has none",
  // which is an ordinary state, not a fault.
  actors: string;
  technologies: string;
}

export const NO_REFERENTIAL: ReferentialUrls = { actors: "", technologies: "" };

export function hasReferential(urls: ReferentialUrls): boolean {
  return urls.actors.trim() !== "" || urls.technologies.trim() !== "";
}

export const MASHUP_QUERIES = ["RefActors", "RefTechnologies"] as const;

const BOM = "﻿";

// An M string literal doubles its quotes. A URL carrying one is unlikely and
// perfectly legal; unescaped, it would close the literal and break the query.
function mLiteral(text: string): string {
  return `"${text.replace(/"/g, '""')}"`;
}

function query(name: string, url: string): string {
  return (
    `shared ${name} = let\n` +
    `    Source = Csv.Document(Web.Contents(${mLiteral(url)}),[Delimiter=",", Encoding=65001, QuoteStyle=QuoteStyle.Csv]),\n` +
    `    Headers = Table.PromoteHeaders(Source, [PromoteAllScalars=true])\n` +
    `in\n` +
    `    Headers;\n`
  );
}

// The queries whose URL is set, in the fixed order of MASHUP_QUERIES. A query
// pointing nowhere is not written: Excel would show it in permanent error, and
// the workbook is meant to work without a referential.
export function queriesOf(urls: ReferentialUrls): { name: string; url: string }[] {
  return [
    { name: MASHUP_QUERIES[0], url: urls.actors.trim() },
    { name: MASHUP_QUERIES[1], url: urls.technologies.trim() },
  ].filter((q) => q.url !== "");
}

export function sectionM(urls: ReferentialUrls): string {
  return `section Section1;\n\n${queriesOf(urls).map((q) => query(q.name, q.url)).join("\n")}`;
}

function crc32(bytes: Uint8Array): number {
  let c = ~0;
  for (let i = 0; i < bytes.length; i++) {
    c ^= bytes[i];
    for (let bit = 0; bit < 8; bit++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function concat(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

// A zip whose entries are STORED rather than deflated. Excel reads both, and
// storing spares a compressor: the three parts together weigh under two
// kilobytes, so there is nothing to gain by squeezing them.
export function storedZip(entries: readonly { path: string; bytes: Uint8Array }[]): Uint8Array {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.path);
    const crc = crc32(entry.bytes);

    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, entry.bytes.length, true);
    lv.setUint32(22, entry.bytes.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    locals.push(local, entry.bytes);

    const header = new Uint8Array(46 + name.length);
    const cv = new DataView(header.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, entry.bytes.length, true);
    cv.setUint32(24, entry.bytes.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    header.set(name, 46);
    central.push(header);

    offset += 30 + name.length + entry.bytes.length;
  }

  const directory = concat(central);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, directory.length, true);
  ev.setUint32(16, offset, true);

  return concat([...locals, directory, end]);
}

const NS = 'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"';

const PACKAGE_XML =
  `${BOM}<?xml version="1.0" encoding="utf-8"?><Package ${NS}>` +
  `<Version>2.157.151.0</Version><MinVersion>2.21.0.0</MinVersion><Culture>fr-FR</Culture></Package>`;

const PARTS_CONTENT_TYPES =
  `${BOM}<?xml version="1.0" encoding="utf-8"?>` +
  `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  `<Default Extension="xml" ContentType="text/xml" />` +
  `<Default Extension="m" ContentType="text/plain" /></Types>`;

const PERMISSIONS =
  `${BOM}<?xml version="1.0" encoding="utf-8"?><PermissionList ${NS}>` +
  `<CanEvaluateFuturePackages>false</CanEvaluateFuturePackages>` +
  `<FirewallEnabled>true</FirewallEnabled></PermissionList>`;

// A query loaded onto a sheet, as opposed to a connection-only one: FillEnabled
// and FillTarget are what tell Excel to pour the result into the table waiting
// for it.
function metadataItem(name: string): string {
  return (
    `<Item><ItemLocation><ItemType>Formula</ItemType>` +
    `<ItemPath>Section1/${name}</ItemPath></ItemLocation><StableEntries>` +
    `<Entry Type="IsPrivate" Value="l0" />` +
    `<Entry Type="FillEnabled" Value="l1" />` +
    `<Entry Type="FillObjectType" Value="sTable" />` +
    `<Entry Type="FillToDataModelEnabled" Value="l0" />` +
    `<Entry Type="FillTarget" Value="sTable" />` +
    `<Entry Type="ResultType" Value="sTable" />` +
    `</StableEntries></Item>`
  );
}

function metadataXml(urls: ReferentialUrls): string {
  const items = queriesOf(urls).map((q) => metadataItem(q.name)).join("");
  return (
    `${BOM}<?xml version="1.0" encoding="utf-8"?><LocalPackageMetadataFile ${NS}><Items>` +
    `<Item><ItemLocation><ItemType>AllFormulas</ItemType><ItemPath /></ItemLocation>` +
    `<StableEntries><Entry Type="IsTypeDetectionEnabled" Value="sTrue" /></StableEntries></Item>` +
    `${items}</Items></LocalPackageMetadataFile>`
  );
}

function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

// Length-prefixed, 32-bit little-endian. Every block of the stream has this
// shape, at both levels.
function block(payload: Uint8Array): Uint8Array {
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, payload.length, true);
  return concat([length, payload]);
}

function uint32(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return bytes;
}

export function mashupStream(urls: ReferentialUrls): Uint8Array {
  const parts = storedZip([
    { path: "Config/Package.xml", bytes: utf8(PACKAGE_XML) },
    { path: "Formulas/Section1.m", bytes: utf8(sectionM(urls)) },
    { path: "[Content_Types].xml", bytes: utf8(PARTS_CONTENT_TYPES) },
  ]);
  // The content block must be an empty zip. Left out entirely, Excel calls the
  // whole workbook damaged.
  const metadata = concat([uint32(0), block(utf8(metadataXml(urls))), block(storedZip([]))]);
  // The trailing zero is the permission bindings: Excel makes nothing of them.
  return concat([uint32(0), block(parts), block(utf8(PERMISSIONS)), block(metadata), uint32(0)]);
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

// UTF-16 little-endian with a byte-order mark. charCodeAt walks code units, so
// surrogate pairs survive as they are.
function utf16le(text: string): Uint8Array {
  const bytes = new Uint8Array(2 + text.length * 2);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, 0xfeff, true);
  for (let i = 0; i < text.length; i++) view.setUint16(2 + i * 2, text.charCodeAt(i), true);
  return bytes;
}

export function customXmlItem(urls: ReferentialUrls): Uint8Array {
  return utf16le(
    `<?xml version="1.0" encoding="utf-16"?>` +
      `<DataMashup xmlns="http://schemas.microsoft.com/DataMashup">` +
      `${base64(mashupStream(urls))}</DataMashup>`
  );
}

export const CUSTOM_XML_PROPS =
  `<?xml version="1.0" encoding="UTF-8" standalone="no"?>\r\n` +
  `<ds:datastoreItem ds:itemID="{0F4F4F4F-1111-4222-8333-444455556666}" ` +
  `xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml">` +
  `<ds:schemaRefs><ds:schemaRef ds:uri="http://schemas.microsoft.com/DataMashup"/>` +
  `</ds:schemaRefs></ds:datastoreItem>`;
```

- [ ] **Étape 4 : lancer les tests pour vérifier qu'ils passent**

```bash
cd app && npx vitest run src/export/datamashup.test.ts && npx tsc --noEmit
```
Attendu : SUCCÈS, 9 tests, `tsc` muet.

- [ ] **Étape 5 : commit**

```bash
git add app/src/export/datamashup.ts app/src/export/datamashup.test.ts
git commit -m "feat(export): write the Power Query DataMashup stream by hand"
```

---

## Tâche 2 : relire les URL d'un classeur déposé

**Fichiers :**
- Modifier : `app/src/export/datamashup.ts`
- Modifier : `app/src/export/datamashup.test.ts`

**Interfaces :**
- Consomme : `mashupStream`, `customXmlItem`, `storedZip`, `ReferentialUrls`,
  `NO_REFERENTIAL`, `MASHUP_QUERIES` (tâche 1).
- Produit : `export async function readReferentialUrls(bytes: ArrayBuffer): Promise<ReferentialUrls>`

Un classeur enregistré par Excel voit son flux réécrit, et Excel **compresse**.
La relecture doit donc savoir défaire un `deflate` : `DecompressionStream`, natif
au navigateur comme à Node 18, sans dépendance.

- [ ] **Étape 1 : écrire le test qui échoue**

Ajouter à la fin de `app/src/export/datamashup.test.ts` :

```ts
import * as XLSX from "xlsx";
import { readReferentialUrls, mashupStream, CUSTOM_XML_PROPS } from "./datamashup";

// The smallest workbook carrying a mashup: SheetJS writes the package, and the
// custom part is dropped in beside it. Enough to exercise the reader without
// depending on the template writer.
function workbookCarrying(item: Uint8Array): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["a"]]), "S");
  const raw = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  const cfb = XLSX.CFB.read(new Uint8Array(raw), { type: "array" });
  XLSX.CFB.utils.cfb_add(cfb, "/customXml/item1.xml", item as unknown as number[]);
  const out = XLSX.CFB.write(cfb, { fileType: "zip", type: "array" }) as unknown as number[];
  return new Uint8Array(out).buffer;
}

describe("readReferentialUrls", () => {
  it("finds both URLs back in a workbook this module wrote", async () => {
    const urls = { actors: "https://ref/actors.csv", technologies: "https://ref/tech.csv" };
    const read = await readReferentialUrls(workbookCarrying(customXmlItem(urls)));
    expect(read).toEqual(urls);
  });

  it("reads a query whose URL carries a quote", async () => {
    const urls = { actors: 'https://ref/a".csv', technologies: "" };
    const read = await readReferentialUrls(workbookCarrying(customXmlItem(urls)));
    expect(read.actors).toBe('https://ref/a".csv');
  });

  it("leaves an absent query empty rather than guessing", async () => {
    const read = await readReferentialUrls(workbookCarrying(customXmlItem({ actors: "https://ref/a.csv", technologies: "" })));
    expect(read.technologies).toBe("");
  });

  it("reads a stream whose inner zip Excel has deflated", async () => {
    // What a round trip through Excel produces: same stream, compressed parts.
    const urls = { actors: "https://ref/actors.csv", technologies: "" };
    const deflated = await deflateTheParts(mashupStream(urls));
    const item = wrapAsCustomXml(deflated);
    const read = await readReferentialUrls(workbookCarrying(item));
    expect(read.actors).toBe("https://ref/actors.csv");
  });

  it("returns no referential for a workbook that carries none", async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["a"]]), "S");
    const raw = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
    expect(await readReferentialUrls(raw)).toEqual(NO_REFERENTIAL);
  });

  it("returns no referential rather than throwing on a truncated stream", async () => {
    const item = wrapAsCustomXml(mashupStream({ actors: "https://ref/a.csv", technologies: "" }).subarray(0, 12));
    expect(await readReferentialUrls(workbookCarrying(item))).toEqual(NO_REFERENTIAL);
  });
});

// Rebuild the stream with a deflated parts zip, the way Excel saves it.
async function deflateTheParts(stream: Uint8Array): Promise<Uint8Array> {
  const view = new DataView(stream.buffer, stream.byteOffset, stream.byteLength);
  const partsLength = view.getUint32(4, true);
  const parts = stream.subarray(8, 8 + partsLength);
  const rest = stream.subarray(8 + partsLength);

  const entries: { path: string; bytes: Uint8Array }[] = [];
  for (const path of ["Config/Package.xml", "Formulas/Section1.m", "[Content_Types].xml"]) {
    const found = await entryOfZip(parts, path);
    entries.push({ path, bytes: found! });
  }
  const zip = await deflatedZip(entries);

  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, zip.length, true);
  const out = new Uint8Array(4 + 4 + zip.length + rest.length);
  out.set(stream.subarray(0, 4), 0);
  out.set(length, 4);
  out.set(zip, 8);
  out.set(rest, 8 + zip.length);
  return out;
}

async function deflatedZip(entries: readonly { path: string; bytes: Uint8Array }[]): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.path);
    const stream = new Blob([entry.bytes as BlobPart]).stream().pipeThrough(new CompressionStream("deflate-raw"));
    const packed = new Uint8Array(await new Response(stream).arrayBuffer());
    const crc = crc32OfTest(entry.bytes);

    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(8, 8, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, packed.length, true);
    lv.setUint32(22, entry.bytes.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    locals.push(local, packed);

    const header = new Uint8Array(46 + name.length);
    const cv = new DataView(header.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(10, 8, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, packed.length, true);
    cv.setUint32(24, entry.bytes.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    header.set(name, 46);
    central.push(header);
    offset += 30 + name.length + packed.length;
  }
  const directory = new Uint8Array(central.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const chunk of central) { directory.set(chunk, at); at += chunk.length; }
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, directory.length, true);
  ev.setUint32(16, offset, true);

  const total = [...locals, directory, end];
  const size = total.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(size);
  let cursor = 0;
  for (const chunk of total) { out.set(chunk, cursor); cursor += chunk.length; }
  return out;
}

function crc32OfTest(bytes: Uint8Array): number {
  let c = ~0;
  for (let i = 0; i < bytes.length; i++) {
    c ^= bytes[i];
    for (let bit = 0; bit < 8; bit++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function wrapAsCustomXml(stream: Uint8Array): Uint8Array {
  let binary = "";
  for (let i = 0; i < stream.length; i += 0x8000) binary += String.fromCharCode(...stream.subarray(i, i + 0x8000));
  const text =
    `<?xml version="1.0" encoding="utf-16"?>` +
    `<DataMashup xmlns="http://schemas.microsoft.com/DataMashup">${btoa(binary)}</DataMashup>`;
  const bytes = new Uint8Array(2 + text.length * 2);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, 0xfeff, true);
  for (let i = 0; i < text.length; i++) view.setUint16(2 + i * 2, text.charCodeAt(i), true);
  return bytes;
}
```

- [ ] **Étape 2 : lancer le test pour vérifier qu'il échoue**

```bash
cd app && npx vitest run src/export/datamashup.test.ts
```
Attendu : ÉCHEC, `readReferentialUrls is not a function`.

- [ ] **Étape 3 : écrire la relecture**

Ajouter en haut de `app/src/export/datamashup.ts` :

```ts
import * as XLSX from "xlsx";
```

et à la fin du fichier :

```ts
async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// One entry out of a zip, walking the central directory rather than the local
// headers: Excel writes data descriptors, which make the local header's sizes
// unusable.
async function entryOfZip(zip: Uint8Array, path: string): Promise<Uint8Array | null> {
  if (zip.length < 22) return null;
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let end = -1;
  for (let i = zip.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) return null;

  const count = view.getUint16(end + 10, true);
  let cursor = view.getUint32(end + 16, true);
  const decoder = new TextDecoder();
  for (let i = 0; i < count && cursor + 46 <= zip.length; i++) {
    const method = view.getUint16(cursor + 10, true);
    const packedSize = view.getUint32(cursor + 20, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const local = view.getUint32(cursor + 42, true);
    const name = decoder.decode(zip.subarray(cursor + 46, cursor + 46 + nameLength));
    if (name === path) {
      const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
      const packed = zip.subarray(start, start + packedSize);
      return method === 0 ? packed : await inflateRaw(packed);
    }
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return null;
}

// The URL a given query fetches. The literal doubles its quotes, so the
// expression stops at the first quote NOT followed by another.
function urlOfQuery(section: string, name: string): string {
  const match = new RegExp(`shared\\s+${name}\\s*=[\\s\\S]*?Web\\.Contents\\(\\s*"((?:[^"]|"")*)"`).exec(section);
  return match ? match[1].replace(/""/g, '"') : "";
}

// The two URLs a deposited workbook already carries, so the page can show them
// instead of asking for them again. A workbook without a referential, or whose
// stream this module cannot make sense of, simply carries none: the URL is a
// convenience, and refusing to open the file over it would be out of
// proportion.
export async function readReferentialUrls(bytes: ArrayBuffer): Promise<ReferentialUrls> {
  try {
    const cfb = XLSX.CFB.read(new Uint8Array(bytes), { type: "array" });
    const part = XLSX.CFB.find(cfb, "/customXml/item1.xml");
    if (!part || !part.content) return NO_REFERENTIAL;

    const text = new TextDecoder("utf-16le").decode(new Uint8Array(part.content as unknown as ArrayBufferLike));
    const encoded = /<DataMashup[^>]*>([A-Za-z0-9+/=\s]+)<\/DataMashup>/.exec(text);
    if (!encoded) return NO_REFERENTIAL;

    const binary = atob(encoded[1].replace(/\s+/g, ""));
    const stream = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) stream[i] = binary.charCodeAt(i);
    if (stream.length < 8) return NO_REFERENTIAL;

    const view = new DataView(stream.buffer);
    const partsLength = view.getUint32(4, true);
    if (8 + partsLength > stream.length) return NO_REFERENTIAL;

    const section = await entryOfZip(stream.subarray(8, 8 + partsLength), "Formulas/Section1.m");
    if (!section) return NO_REFERENTIAL;

    const source = new TextDecoder().decode(section);
    return {
      actors: urlOfQuery(source, MASHUP_QUERIES[0]),
      technologies: urlOfQuery(source, MASHUP_QUERIES[1]),
    };
  } catch {
    return NO_REFERENTIAL;
  }
}
```

- [ ] **Étape 4 : lancer les tests pour vérifier qu'ils passent**

```bash
cd app && npx vitest run src/export/datamashup.test.ts && npx tsc --noEmit
```
Attendu : SUCCÈS, 15 tests.

- [ ] **Étape 5 : commit**

```bash
git add app/src/export/datamashup.ts app/src/export/datamashup.test.ts
git commit -m "feat(export): read the referential URLs back out of a workbook"
```

---

## Tâche 3 : poser les parties `customXml` dans le paquet

**Fichiers :**
- Modifier : `app/src/export/xlsx-tables.ts`
- Modifier : `app/src/export/xlsx-tables.test.ts`

**Interfaces :**
- Consomme : `customXmlItem`, `CUSTOM_XML_PROPS`, `ReferentialUrls`,
  `hasReferential` (tâches 1-2).
- Produit :
  - `export function writeBinaryPart(cfb: Conteneur, path: string, bytes: Uint8Array): void`
  - `OoxmlExtras` gagne `referentials?: ReferentialUrls`.

`customXml/item1.xml` ne reçoit **pas** d'`Override` : l'extension `.xml` est
déjà couverte par un `Default`, et c'est ainsi qu'Excel écrit. Seul
`itemProps1.xml` en reçoit un.

- [ ] **Étape 1 : écrire le test qui échoue**

Ajouter à `app/src/export/xlsx-tables.test.ts` :

```ts
import { applyOoxmlExtras } from "./xlsx-tables";
import { readReferentialUrls } from "./datamashup";

describe("referentials in the package", () => {
  // A one-sheet workbook is enough: what is being checked is the package, not
  // the sheet.
  function minimal(): ArrayBuffer {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Name"], ["Tatooine"]]), "Actors");
    return XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  }

  const tables = [{ sheet: "Actors", columns: ["Name"], rows: 1 }];

  it("writes the three custom parts when a URL is set", () => {
    const out = applyOoxmlExtras(minimal(), {
      tables,
      referentials: { actors: "https://ref/a.csv", technologies: "" },
    });
    const cfb = XLSX.CFB.read(new Uint8Array(out), { type: "array" });
    expect(XLSX.CFB.find(cfb, "/customXml/item1.xml")).toBeTruthy();
    expect(XLSX.CFB.find(cfb, "/customXml/itemProps1.xml")).toBeTruthy();
    expect(XLSX.CFB.find(cfb, "/customXml/_rels/item1.xml.rels")).toBeTruthy();
  });

  it("declares only itemProps, the item falling under the xml default", () => {
    const out = applyOoxmlExtras(minimal(), {
      tables,
      referentials: { actors: "https://ref/a.csv", technologies: "" },
    });
    const cfb = XLSX.CFB.read(new Uint8Array(out), { type: "array" });
    const types = readPart(cfb, "/[Content_Types].xml")!;
    expect(types).toContain('PartName="/customXml/itemProps1.xml"');
    expect(types).not.toContain('PartName="/customXml/item1.xml"');
  });

  it("relates the item to the workbook under an unused id", () => {
    const out = applyOoxmlExtras(minimal(), {
      tables,
      referentials: { actors: "https://ref/a.csv", technologies: "" },
    });
    const cfb = XLSX.CFB.read(new Uint8Array(out), { type: "array" });
    const rels = readPart(cfb, "/xl/_rels/workbook.xml.rels")!;
    const match = /Id="(rId\d+)"[^>]*customXml[^>]*Target="\.\.\/customXml\/item1\.xml"/.exec(rels);
    expect(match).toBeTruthy();
    // The id must not already be taken by a sheet, a style or the theme.
    const others = [...rels.matchAll(/Id="(rId\d+)"/g)].map((m) => m[1]);
    expect(others.filter((id) => id === match![1])).toHaveLength(1);
  });

  it("writes nothing at all when both URLs are empty", () => {
    const out = applyOoxmlExtras(minimal(), { tables, referentials: { actors: "", technologies: "" } });
    const cfb = XLSX.CFB.read(new Uint8Array(out), { type: "array" });
    expect(XLSX.CFB.find(cfb, "/customXml/item1.xml")).toBeFalsy();
  });

  it("produces a package the reader can take the URLs back out of", async () => {
    const urls = { actors: "https://ref/a.csv", technologies: "https://ref/t.csv" };
    const out = applyOoxmlExtras(minimal(), { tables, referentials: urls });
    expect(await readReferentialUrls(out)).toEqual(urls);
  });
});
```

`readPart` est déjà exporté par `xlsx-tables.ts` ; l'ajouter à l'import existant
du fichier de test s'il n'y est pas.

- [ ] **Étape 2 : lancer le test pour vérifier qu'il échoue**

```bash
cd app && npx vitest run src/export/xlsx-tables.test.ts
```
Attendu : ÉCHEC — `/customXml/item1.xml` introuvable.

- [ ] **Étape 3 : implémenter**

Dans `app/src/export/xlsx-tables.ts`, ajouter l'import :

```ts
import { customXmlItem, CUSTOM_XML_PROPS, hasReferential, NO_REFERENTIAL } from "./datamashup";
import type { ReferentialUrls } from "./datamashup";
```

Remplacer `writePart` par le couple :

```ts
export function writeBinaryPart(cfb: Conteneur, path: string, bytes: Uint8Array): void {
  XLSX.CFB.utils.cfb_add(cfb, path, bytes as unknown as number[]);
}

export function writePart(cfb: Conteneur, path: string, content: string): void {
  writeBinaryPart(cfb, path, new TextEncoder().encode(content));
}
```

Ajouter le champ à `OoxmlExtras` :

```ts
export interface OoxmlExtras {
  tables: readonly TableToApply[];
  lists?: readonly NamedList[];
  validations?: readonly ValidationToApply[];
  styles?: readonly StyleToApply[];
  panes?: readonly string[];
  // The two referential URLs the workbook carries. Empty ones write no query at
  // all: a workbook without a referential must stay an ordinary workbook.
  referentials?: ReferentialUrls;
}
```

Ajouter `referentials = NO_REFERENTIAL` à la déstructuration en tête de
`applyOoxmlExtras`, dans les deux branches :

```ts
  const {
    tables,
    lists = [],
    validations = [],
    styles = [],
    panes = [],
    referentials = NO_REFERENTIAL,
  } = Array.isArray(extras)
    ? {
        tables: extras as readonly TableToApply[],
        lists: [],
        validations: [],
        styles: [],
        panes: [],
        referentials: NO_REFERENTIAL,
      }
    : (extras as OoxmlExtras);
```

Ajouter cette fonction avant `applyOoxmlExtras` :

```ts
const TYPE_CUSTOM_XML_PROPS =
  "application/vnd.openxmlformats-officedocument.customXmlProperties+xml";

// The next free relationship id in a .rels part. SheetJS numbers its own from
// rId1 without a gap; reusing one would make Excel drop a sheet.
function freeRelationshipId(rels: string): string {
  const used = [...rels.matchAll(/Id="rId(\d+)"/g)].map((m) => Number(m[1]));
  return `rId${(used.length > 0 ? Math.max(...used) : 0) + 1}`;
}
```

Puis, dans `applyOoxmlExtras`, **juste avant** la ligne
`writePart(cfb, "/[Content_Types].xml", contentTypes);` :

```ts
  // The Power Query stream. Excel keeps it in a custom XML part, related to the
  // workbook; itemProps says which schema it follows. The item itself takes no
  // Override -- the .xml Default already covers it, and that is how Excel
  // writes it.
  if (hasReferential(referentials)) {
    writeBinaryPart(cfb, "/customXml/item1.xml", customXmlItem(referentials));
    writePart(cfb, "/customXml/itemProps1.xml", CUSTOM_XML_PROPS);
    writePart(
      cfb,
      "/customXml/_rels/item1.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="${NS_REL}/customXmlProps" Target="itemProps1.xml"/>` +
        `</Relationships>`
    );
    contentTypes = contentTypes.replace(
      "</Types>",
      `<Override PartName="/customXml/itemProps1.xml" ContentType="${TYPE_CUSTOM_XML_PROPS}"/></Types>`
    );
    const rels = readPart(cfb, "/xl/_rels/workbook.xml.rels");
    if (rels) {
      writePart(
        cfb,
        "/xl/_rels/workbook.xml.rels",
        rels.replace(
          "</Relationships>",
          `<Relationship Id="${freeRelationshipId(rels)}" Type="${NS_REL}/customXml" ` +
            `Target="../customXml/item1.xml"/></Relationships>`
        )
      );
    }
  }
```

**Attention à l'ordre** : ce bloc doit venir **après** la suppression de
`sheetMetadata` dans `workbook.xml.rels` (déjà présente plus haut dans la
fonction), sinon l'id calculé porterait sur une version périmée du fichier.

- [ ] **Étape 4 : lancer les tests pour vérifier qu'ils passent**

```bash
cd app && npx vitest run && npx tsc --noEmit
```
Attendu : SUCCÈS, toute la suite verte.

- [ ] **Étape 5 : commit**

```bash
git add app/src/export/xlsx-tables.ts app/src/export/xlsx-tables.test.ts
git commit -m "feat(workbook): carry the Power Query stream as a custom XML part"
```

---

## Tâche 4 : connexions et tableaux de requête

**Fichiers :**
- Modifier : `app/src/export/xlsx-tables.ts`
- Modifier : `app/src/export/xlsx-tables.test.ts`

**Interfaces :**
- Consomme : tout ce que produit la tâche 3.
- Produit : `TableToApply` gagne `query?: string` — le nom de la requête qui
  remplit ce tableau.

Une requête chargée sur un onglet exige trois choses de plus qu'un tableau
ordinaire : une `<connection>` dans `xl/connections.xml`, une partie
`xl/queryTables/queryTableN.xml`, et un tableau marqué `tableType="queryTable"`
dont chaque colonne nomme le champ qui l'alimente.

- [ ] **Étape 1 : écrire le test qui échoue**

Ajouter à `app/src/export/xlsx-tables.test.ts` :

```ts
describe("query tables", () => {
  function minimal(): ArrayBuffer {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Name", "Group"], ["", ""]]), "RefActors");
    return XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  }

  const extras = {
    tables: [{ sheet: "RefActors", columns: ["Name", "Group"], rows: 0, query: "RefActors" }],
    referentials: { actors: "https://ref/a.csv", technologies: "" },
  };

  it("declares one connection per query, pointing at the workbook's own mashup", () => {
    const cfb = XLSX.CFB.read(new Uint8Array(applyOoxmlExtras(minimal(), extras)), { type: "array" });
    const connections = readPart(cfb, "/xl/connections.xml")!;
    expect(connections).toContain('type="5"');
    expect(connections).toContain("Provider=Microsoft.Mashup.OleDb.1");
    expect(connections).toContain("Location=RefActors");
    expect(connections).toContain("SELECT * FROM [RefActors]");
    // Saved data is what makes the workbook readable with no network.
    expect(connections).toContain('saveData="1"');
  });

  it("writes a query table naming every column of its table", () => {
    const cfb = XLSX.CFB.read(new Uint8Array(applyOoxmlExtras(minimal(), extras)), { type: "array" });
    const queryTable = readPart(cfb, "/xl/queryTables/queryTable1.xml")!;
    expect(queryTable).toContain('connectionId="1"');
    expect(queryTable).toContain('<queryTableField id="1" name="Name" tableColumnId="1"/>');
    expect(queryTable).toContain('<queryTableField id="2" name="Group" tableColumnId="2"/>');
  });

  it("marks the table as fed by a query and links each column to its field", () => {
    const cfb = XLSX.CFB.read(new Uint8Array(applyOoxmlExtras(minimal(), extras)), { type: "array" });
    const table = readPart(cfb, "/xl/tables/table1.xml")!;
    expect(table).toContain('tableType="queryTable"');
    expect(table).toContain('queryTableFieldId="1"');
    expect(table).toContain('queryTableFieldId="2"');
    const rels = readPart(cfb, "/xl/tables/_rels/table1.xml.rels")!;
    expect(rels).toContain("../queryTables/queryTable1.xml");
  });

  it("declares both new parts in the content types", () => {
    const cfb = XLSX.CFB.read(new Uint8Array(applyOoxmlExtras(minimal(), extras)), { type: "array" });
    const types = readPart(cfb, "/[Content_Types].xml")!;
    expect(types).toContain('PartName="/xl/connections.xml"');
    expect(types).toContain('PartName="/xl/queryTables/queryTable1.xml"');
  });

  it("leaves an ordinary table alone", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Name"], ["Tatooine"]]), "Actors");
    const raw = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
    const cfb = XLSX.CFB.read(
      new Uint8Array(applyOoxmlExtras(raw, { tables: [{ sheet: "Actors", columns: ["Name"], rows: 1 }] })),
      { type: "array" }
    );
    expect(readPart(cfb, "/xl/tables/table1.xml")!).not.toContain("queryTable");
    expect(XLSX.CFB.find(cfb, "/xl/connections.xml")).toBeFalsy();
  });
});
```

- [ ] **Étape 2 : lancer le test pour vérifier qu'il échoue**

```bash
cd app && npx vitest run src/export/xlsx-tables.test.ts
```
Attendu : ÉCHEC — `/xl/connections.xml` introuvable.

- [ ] **Étape 3 : implémenter**

Dans `TableToApply`, ajouter :

```ts
  // The Power Query query that fills this table. Excel then wants a queryTable
  // part beside it, and every column must name the field feeding it -- without
  // which the refresh empties the table instead of filling it.
  query?: string;
```

Ajouter les constantes à côté de `TYPE_TABLE` :

```ts
const TYPE_CONNECTIONS =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.connections+xml";
const TYPE_QUERY_TABLE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.queryTable+xml";
```

Modifier `xmlDuTableau` pour prendre le numéro du queryTable :

```ts
function xmlDuTableau(
  id: number,
  name: string,
  ref: string,
  columns: readonly string[],
  formules: Readonly<Record<string, string>> = {},
  queryTableId?: number
): string {
  const cols = columns
    .map((c, i) => {
      const formule = formules[c];
      const field = queryTableId === undefined ? "" : ` queryTableFieldId="${i + 1}"`;
      const start = `<tableColumn id="${i + 1}" name="${escapeXml(c)}"${field}`;
      return formule
        ? `${start}><calculatedColumnFormula>${escapeXml(formule)}</calculatedColumnFormula></tableColumn>`
        : `${start}/>`;
    })
    .join("");
  const kind = queryTableId === undefined ? "" : ` tableType="queryTable"`;
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<table xmlns="${NS_TABLE}" id="${id}" name="${name}" displayName="${name}" ref="${ref}"${kind} totalsRowShown="0">` +
    `<autoFilter ref="${ref}"/>` +
    `<tableColumns count="${columns.length}">${cols}</tableColumns>` +
    `<tableStyleInfo name="TableStyleMedium2" showFirstColumn="0" showLastColumn="0" showRowStripes="1" showColumnStripes="0"/>` +
    `</table>`
  );
}
```

Modifier `xmlDesRelations` pour joindre le queryTable quand il existe :

```ts
function xmlDesRelations(idTable: number, queryTableId?: number): string {
  const query =
    queryTableId === undefined
      ? ""
      : `<Relationship Id="rId2" Type="${NS_REL}/queryTable" Target="../queryTables/queryTable${queryTableId}.xml"/>`;
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="${NS_REL}/table" Target="../tables/table${idTable}.xml"/>` +
    `${query}</Relationships>`
  );
}
```

Ajouter les deux générateurs :

```ts
function xmlDeLaConnexion(id: number, query: string): string {
  return (
    `<connection id="${id}" keepAlive="1" name="Query - ${escapeXml(query)}" ` +
    `description="Connection to the ${escapeXml(query)} query in the workbook." ` +
    `type="5" refreshedVersion="8" background="1" saveData="1">` +
    `<dbPr connection="Provider=Microsoft.Mashup.OleDb.1;Data Source=$Workbook$;` +
    `Location=${escapeXml(query)};Extended Properties=&quot;&quot;" ` +
    `command="SELECT * FROM [${escapeXml(query)}]"/></connection>`
  );
}

function xmlDuQueryTable(id: number, connectionId: number, columns: readonly string[]): string {
  const fields = columns
    .map((c, i) => `<queryTableField id="${i + 1}" name="${escapeXml(c)}" tableColumnId="${i + 1}"/>`)
    .join("");
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<queryTable xmlns="${NS_TABLE}" name="ExternalData_${id}" connectionId="${connectionId}" ` +
    `autoFormatId="16" applyNumberFormats="0" applyBorderFormats="0" applyFontFormats="0" ` +
    `applyPatternFormats="0" applyAlignmentFormats="0" applyWidthHeightFormats="0">` +
    `<queryTableRefresh nextId="${columns.length + 1}">` +
    `<queryTableFields count="${columns.length}">${fields}</queryTableFields>` +
    `</queryTableRefresh></queryTable>`
  );
}
```

Dans `applyOoxmlExtras`, déclarer avant la boucle sur les onglets :

```ts
  // Connection ids are allocated in the order the tables are met, so the same
  // input always produces the same package.
  const connections: string[] = [];
  let idQueryTable = 0;
```

Dans la boucle interne sur `tablesOfSheet`, remplacer les deux `writePart` du
tableau et de ses relations par :

```ts
      let queryTableId: number | undefined;
      if (table.query) {
        idQueryTable += 1;
        queryTableId = idQueryTable;
        connections.push(xmlDeLaConnexion(idQueryTable, table.query));
        writePart(
          cfb,
          `/xl/queryTables/queryTable${queryTableId}.xml`,
          xmlDuQueryTable(queryTableId, queryTableId, table.columns)
        );
        contentTypes = contentTypes.replace(
          "</Types>",
          `<Override PartName="/xl/queryTables/queryTable${queryTableId}.xml" ContentType="${TYPE_QUERY_TABLE}"/></Types>`
        );
      }

      writePart(
        cfb,
        `/xl/tables/table${idTable}.xml`,
        xmlDuTableau(idTable, name, ref, table.columns, table.formulaByColumn, queryTableId)
      );
      writePart(cfb, `/xl/tables/_rels/table${idTable}.xml.rels`, xmlDesRelations(idTable, queryTableId));
```

> Le code existant écrit ces deux parties ; il faut remplacer **ces lignes-là**,
> en conservant l'`Override` du tableau (`TYPE_TABLE`) et la poussée dans
> `relations` qui les suit.

Enfin, à côté du bloc `customXml` de la tâche 3, avant l'écriture de
`[Content_Types].xml` :

```ts
  if (connections.length > 0) {
    writePart(
      cfb,
      "/xl/connections.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<connections xmlns="${NS_TABLE}">${connections.join("")}</connections>`
    );
    contentTypes = contentTypes.replace(
      "</Types>",
      `<Override PartName="/xl/connections.xml" ContentType="${TYPE_CONNECTIONS}"/></Types>`
    );
    const rels = readPart(cfb, "/xl/_rels/workbook.xml.rels");
    if (rels) {
      writePart(
        cfb,
        "/xl/_rels/workbook.xml.rels",
        rels.replace(
          "</Relationships>",
          `<Relationship Id="${freeRelationshipId(rels)}" Type="${NS_REL}/connections" ` +
            `Target="connections.xml"/></Relationships>`
        )
      );
    }
  }
```

- [ ] **Étape 4 : lancer les tests pour vérifier qu'ils passent**

```bash
cd app && npx vitest run && npx tsc --noEmit
```
Attendu : SUCCÈS.

- [ ] **Étape 5 : commit**

```bash
git add app/src/export/xlsx-tables.ts app/src/export/xlsx-tables.test.ts
git commit -m "feat(workbook): wire query tables and connections for loaded queries"
```

---

## Tâche 5 : les deux onglets du référentiel dans le modèle de classeur

**Fichiers :**
- Modifier : `app/src/export/template-export.ts`
- Modifier : `app/src/export/template-export.test.ts`

**Interfaces :**
- Consomme : `TableToApply.query` (tâche 4), `OoxmlExtras.referentials`
  (tâche 3), `ReferentialUrls` / `NO_REFERENTIAL` (tâche 1).
- Produit :
  - Dans **`app/src/parsing/build-model.ts`**, à côté de `ACTOR_COLUMNS` :
    `export const REF_ACTORS_SHEET = "RefActors"`,
    `export const REF_TECHNOLOGIES_SHEET = "RefTechnologies"`,
    `export const REF_ACTOR_COLUMNS = ["Name", "Group", "Actor type", "Owner", "Description"]`,
    `export const REF_TECHNOLOGY_COLUMNS = ["Flow type", "Direction", "Description", "Colour"]`.
    `template-export.ts` les importe de là, comme il importe déjà `ACTOR_COLUMNS`.
  - `WorkbookData` gagne `referentials?: ReferentialUrls`.

- [ ] **Étape 1 : écrire le test qui échoue**

Ajouter à `app/src/export/template-export.test.ts` :

```ts
import { writeTemplate, REF_ACTORS_SHEET, REF_TECHNOLOGIES_SHEET } from "./template-export";
import { readReferentialUrls } from "./datamashup";

describe("referential sheets", () => {
  it("adds both sheets, hidden, even with no referential", () => {
    const cfb = XLSX.CFB.read(new Uint8Array(writeTemplate()), { type: "array" });
    const workbook = readPart(cfb, "/xl/workbook.xml")!;
    expect(workbook).toContain(`name="${REF_ACTORS_SHEET}"`);
    expect(workbook).toContain(`name="${REF_TECHNOLOGIES_SHEET}"`);
    for (const name of [REF_ACTORS_SHEET, REF_TECHNOLOGIES_SHEET]) {
      const sheet = new RegExp(`<sheet name="${name}"[^>]*state="hidden"`).test(workbook);
      expect(sheet).toBe(true);
    }
  });

  it("writes no query when the workbook declares no referential", () => {
    const cfb = XLSX.CFB.read(new Uint8Array(writeTemplate()), { type: "array" });
    expect(XLSX.CFB.find(cfb, "/customXml/item1.xml")).toBeFalsy();
    expect(XLSX.CFB.find(cfb, "/xl/connections.xml")).toBeFalsy();
  });

  it("carries both URLs through to the written workbook", async () => {
    const urls = { actors: "https://ref/actors.csv", technologies: "https://ref/tech.csv" };
    const bytes = writeTemplate({
      flowTypes: [], actorTypes: [], milestones: [], groups: [], actors: [], interfaces: [], fx: [],
      referentials: urls,
    });
    expect(await readReferentialUrls(bytes)).toEqual(urls);
  });

  it("feeds the actor and flow-type drop-downs from the referential", () => {
    const cfb = XLSX.CFB.read(new Uint8Array(writeTemplate()), { type: "array" });
    const workbook = readPart(cfb, "/xl/workbook.xml")!;
    expect(workbook).toContain("L_RefActeur");
    expect(workbook).toContain("L_RefTypeFlux");
  });
});
```

- [ ] **Étape 2 : lancer le test pour vérifier qu'il échoue**

```bash
cd app && npx vitest run src/export/template-export.test.ts
```
Attendu : ÉCHEC — `REF_ACTORS_SHEET` n'existe pas.

- [ ] **Étape 3 : implémenter**

Dans `app/src/export/template-export.ts`, ajouter les imports :

```ts
import { NO_REFERENTIAL } from "./datamashup";
import type { ReferentialUrls } from "./datamashup";
```

Ajouter les constantes dans **`app/src/parsing/build-model.ts`**, à côté de
`ACTOR_COLUMNS` :

```ts
// The two sheets the external referential fills. They exist whether or not a
// referential is declared: the schema must not depend on a URL being set, or a
// workbook would change shape the day someone types one in.
export const REF_ACTORS_SHEET = "RefActors";
export const REF_TECHNOLOGIES_SHEET = "RefTechnologies";
export const REF_ACTOR_COLUMNS = ["Name", "Group", "Actor type", "Owner", "Description"];
export const REF_TECHNOLOGY_COLUMNS = ["Flow type", "Direction", "Description", "Colour"];
```

et les importer dans `template-export.ts`, en les ajoutant à l'import qui prend
déjà `ACTOR_COLUMNS` et consorts depuis `../parsing/build-model`.

> **Elles ne peuvent pas vivre dans `template-export.ts`** : ce fichier importe
> déjà `ACTOR_COLUMNS`, `FLOW_TYPE_COLUMNS` et `VERSION_SHEET` depuis
> `build-model.ts`. Les y définir et les faire importer en retour créerait un
> cycle.

Dans `WorkbookData`, ajouter :

```ts
  // Where the two referentials are published. Absent means the workbook has
  // none, which is an ordinary state.
  referentials?: ReferentialUrls;
```

Dans `buildTemplateWorkbook`, juste avant `book_append_sheet(... VERSION_SHEET)` :

```ts
  // Query-owned, and therefore empty here: Excel pours the rows in on the first
  // refresh. The header row alone is written, so the structured table has
  // something to declare.
  XLSX.utils.book_append_sheet(wb, sheet([[...REF_ACTOR_COLUMNS]], REF_ACTOR_COLUMNS.map(() => 20)), REF_ACTORS_SHEET);
  XLSX.utils.book_append_sheet(
    wb,
    sheet([[...REF_TECHNOLOGY_COLUMNS]], REF_TECHNOLOGY_COLUMNS.map(() => 20)),
    REF_TECHNOLOGIES_SHEET
  );
```

Et étendre l'ensemble des onglets masqués :

```ts
  const hidden = new Set([LISTS_SHEET, VERSION_SHEET, REF_ACTORS_SHEET, REF_TECHNOLOGIES_SHEET]);
```

Dans `tablesOfTemplate`, ajouter aux entrées retournées :

```ts
    { sheet: REF_ACTORS_SHEET, columns: REF_ACTOR_COLUMNS, rows: 0, query: REF_ACTORS_SHEET },
    { sheet: REF_TECHNOLOGIES_SHEET, columns: REF_TECHNOLOGY_COLUMNS, rows: 0, query: REF_TECHNOLOGIES_SHEET },
```

Dans `listsOfTemplate`, ajouter :

```ts
    // The referential's vocabulary. It grows on refresh, so a named range over
    // the table follows it without anything to recompute.
    { name: "L_RefActeur", sheet: REF_ACTORS_SHEET, heading: "Name" },
    { name: "L_RefGroupe", sheet: REF_ACTORS_SHEET, heading: "Group" },
    { name: "L_RefTypeActeur", sheet: REF_ACTORS_SHEET, heading: "Actor type" },
    { name: "L_RefTypeFlux", sheet: REF_TECHNOLOGIES_SHEET, heading: "Flow type" },
```

Dans `validationsOfTemplate`, **remplacer** les deux lignes existantes sur
`Actors` et ajouter celle sur `FlowTypes` :

```ts
    v("Actors", ACTOR_COLUMNS, "Name", "L_RefActeur"),
    v("Actors", ACTOR_COLUMNS, "Group", "L_RefGroupe"),
    v("Actors", ACTOR_COLUMNS, "Actor type", "L_RefTypeActeur"),
    v("FlowTypes", FLOW_TYPE_COLUMNS, "Flow type", "L_RefTypeFlux"),
```

et retirer `"Name"` et `"Flow type"` des colonnes laissées libres :

```ts
    ...free("Actors", ACTOR_COLUMNS, ["Name", "Group", "Actor type", ...VALIDITY_COLUMNS]),
    ...free("FlowTypes", FLOW_TYPE_COLUMNS, ["Flow type", "Direction"]),
```

> `L_Groupe` et `L_TypeActeur` perdent ici leur DERNIER usage — c'était
> celui-là. **Les laisser définies quand même** : une plage nommée inutilisée ne
> coûte rien, et les retirer sort du périmètre de ce plan.

Enfin, dans `writeTemplate`, passer les URL :

```ts
  const completed = applyOoxmlExtras(raw, {
    tables: tablesOfTemplate(data),
    lists: listsOfTemplate(),
    validations: validationsOfTemplate(data),
    referentials: data.referentials ?? NO_REFERENTIAL,
    styles: [
```

- [ ] **Étape 4 : lancer les tests pour vérifier qu'ils passent**

```bash
cd app && npx vitest run && npx tsc --noEmit
```
Attendu : SUCCÈS. Des tests existants comptant les onglets ou les tableaux
peuvent échouer : mettre à jour les nombres attendus, pas la production.

- [ ] **Étape 5 : commit**

```bash
git add app/src/export/template-export.ts app/src/export/template-export.test.ts
git commit -m "feat(workbook): two hidden referential sheets fed by Power Query"
```

---

## Tâche 6 : lire le référentiel, et passer le schéma en v5

**Fichiers :**
- Modifier : `app/src/parsing/model.ts`
- Modifier : `app/src/parsing/build-model.ts`
- Modifier : `app/src/export/schema-upgrade.ts`
- Modifier : `app/src/parsing/build-model.test.ts`
- Modifier : `app/src/export/schema-upgrade.test.ts`

**Interfaces :**
- Consomme : les quatre constantes `REF_*`, définies par la tâche 5 dans ce
  même fichier.
- Produit :
  - `export interface ReferentialActor { name: string; group: string; actorType: string; owner: string; description: string }`
  - `export interface ReferentialTechnology { type: string; direction: string; description: string; colour: string }`
  - `ParsedModel` gagne `referentialActors: ReferentialActor[]` et
    `referentialTechnologies: ReferentialTechnology[]`.
  - `SCHEMA_VERSION = 5`.

- [ ] **Étape 1 : écrire le test qui échoue**

Ajouter à `app/src/parsing/build-model.test.ts` :

```ts
describe("external referential", () => {
  it("reads both referential sheets when they carry rows", () => {
    const built = buildModel({
      sheets: [
        sheetOf("Actors", ["Name"], [["Tatooine"]]),
        sheetOf("FlowTypes", ["Flow type", "Direction"], [["HTTP", "provider to consumer"]]),
        sheetOf("Interfaces", ["Flow name"], [["Authent"]]),
        sheetOf("RefActors", ["Name", "Group", "Actor type", "Owner", "Description"],
          [["Tatooine", "Core", "Application", "Ada", "The mothership"]]),
        sheetOf("RefTechnologies", ["Flow type", "Direction", "Description", "Colour"],
          [["HTTP", "provider to consumer", "Synchronous", "#1f5fae"]]),
      ],
      savedAt: null,
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.model.referentialActors).toEqual([
      { name: "Tatooine", group: "Core", actorType: "Application", owner: "Ada", description: "The mothership" },
    ]);
    expect(built.model.referentialTechnologies).toEqual([
      { type: "HTTP", direction: "provider to consumer", description: "Synchronous", colour: "#1f5fae" },
    ]);
  });

  it("leaves both lists empty when the sheets are absent, without complaining", () => {
    const built = buildModel({
      sheets: [
        sheetOf("Actors", ["Name"], [["Tatooine"]]),
        sheetOf("FlowTypes", ["Flow type"], [["HTTP"]]),
        sheetOf("Interfaces", ["Flow name"], [["Authent"]]),
      ],
      savedAt: null,
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.model.referentialActors).toEqual([]);
    expect(built.model.referentialTechnologies).toEqual([]);
  });

  it("drops a nameless referential row rather than carrying a blank entry", () => {
    const built = buildModel({
      sheets: [
        sheetOf("Actors", ["Name"], [["Tatooine"]]),
        sheetOf("FlowTypes", ["Flow type"], [["HTTP"]]),
        sheetOf("Interfaces", ["Flow name"], [["Authent"]]),
        sheetOf("RefActors", ["Name", "Group"], [["", "Core"], ["Alderaan", "Core"]]),
      ],
      savedAt: null,
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.model.referentialActors.map((a) => a.name)).toEqual(["Alderaan"]);
  });
});
```

> `sheetOf` est le constructeur de feuille déjà utilisé par ce fichier de test.
> S'il porte un autre nom, reprendre celui du fichier.

Ajouter à `app/src/export/schema-upgrade.test.ts` :

```ts
it("takes a v4 workbook to v5 without transforming the model", () => {
  expect(SCHEMA_VERSION).toBe(5);
  const step = UPGRADE_STEPS.find((s) => s.de === 4);
  expect(step?.vers).toBe(5);
});
```

- [ ] **Étape 2 : lancer les tests pour vérifier qu'ils échouent**

```bash
cd app && npx vitest run src/parsing/build-model.test.ts src/export/schema-upgrade.test.ts
```
Attendu : ÉCHEC — `referentialActors` indéfini, `SCHEMA_VERSION` vaut 4.

- [ ] **Étape 3 : implémenter**

Dans `app/src/parsing/model.ts`, ajouter avant `ParsedModel` :

```ts
// A row of the external referential. It carries no Location: nothing points at
// it in the report -- an anomaly is reported where the value is USED, on the
// Actors or FlowTypes sheet, which is where it can be corrected.
export interface ReferentialActor {
  name: string;
  group: string;
  actorType: string;
  owner: string;
  description: string;
}

export interface ReferentialTechnology {
  type: string;
  direction: string;
  description: string;
  // Hexadecimal, as the workbook's own Colour column carries it. Empty when the
  // referential declares none.
  colour: string;
}
```

et dans `ParsedModel` :

```ts
  // What the external referential publishes, when the workbook carries one.
  // Empty otherwise -- and an empty referential is not a fault: the workbook
  // must work without one.
  referentialActors: ReferentialActor[];
  referentialTechnologies: ReferentialTechnology[];
```

Dans `app/src/parsing/build-model.ts` :

```ts
export const SCHEMA_VERSION = 5;
```

Dans `buildModel`, après la lecture de `flowTypes` :

```ts
  // The two referential sheets. Absent, they yield nothing: a workbook that
  // declares no referential is not incomplete, it simply has none.
  const refActorsSheet = findSheet(workbook.sheets, REF_ACTORS_SHEET);
  const headerMapRefActors = buildHeaderMap(refActorsSheet?.headers ?? [], REF_ACTOR_COLUMNS);
  const referentialActors: ReferentialActor[] = (refActorsSheet?.rows ?? [])
    .map(({ values: r }) => ({
      name: get(r, headerMapRefActors, "Name"),
      group: get(r, headerMapRefActors, "Group"),
      actorType: get(r, headerMapRefActors, "Actor type"),
      owner: get(r, headerMapRefActors, "Owner"),
      description: get(r, headerMapRefActors, "Description"),
    }))
    .filter((a) => a.name !== "");

  const refTechnologiesSheet = findSheet(workbook.sheets, REF_TECHNOLOGIES_SHEET);
  const headerMapRefTechnologies = buildHeaderMap(refTechnologiesSheet?.headers ?? [], REF_TECHNOLOGY_COLUMNS);
  const referentialTechnologies: ReferentialTechnology[] = (refTechnologiesSheet?.rows ?? [])
    .map(({ values: r }) => ({
      type: get(r, headerMapRefTechnologies, "Flow type"),
      direction: get(r, headerMapRefTechnologies, "Direction"),
      description: get(r, headerMapRefTechnologies, "Description"),
      colour: get(r, headerMapRefTechnologies, "Colour"),
    }))
    .filter((t) => t.type !== "");
```

et ajouter les deux champs à l'objet `model` retourné, ainsi que les types
importés depuis `./model`.

Dans `app/src/export/schema-upgrade.ts`, ajouter en fin de `UPGRADE_STEPS` :

```ts
  // The workbook gains its two referential sheets and the queries that fill
  // them. The model itself has nothing to convert -- they are born at writing
  // time, like the formulas of v2. The step exists so that the workbooks
  // already distributed are recognised as stale and go back through the
  // rebuild, which is what writes the queries.
  { de: 4, vers: 5, appliquer: (model) => model },
```

Dans `dataFromModel`, ajouter le champ avec la constante vide :

```ts
    referentials: NO_REFERENTIAL,
```

et importer `NO_REFERENTIAL` depuis `./datamashup`.

> `ParsedModel` ne porte PAS les URL : elles vivent dans le flux binaire, pas
> dans une feuille, et `dataFromModel` ne travaille que sur le modèle. C'est la
> couche interface (tâche 9) qui les réinjecte au téléchargement, en écrasant
> ce champ. Y mettre autre chose ici serait mentir sur ce que la fonction sait.

- [ ] **Étape 4 : lancer les tests pour vérifier qu'ils passent**

```bash
cd app && npx vitest run && npx tsc --noEmit
```
Attendu : SUCCÈS. Les fabriques de `ParsedModel` dans les tests devront gagner
les deux champs vides ; si elles sont nombreuses, ajouter les valeurs par défaut
dans la fabrique partagée plutôt qu'une par une.

- [ ] **Étape 5 : commit**

```bash
git add app/src/parsing app/src/export/schema-upgrade.ts app/src/export/schema-upgrade.test.ts
git commit -m "feat(model): read the referential sheets, schema v5"
```

---

## Tâche 7 : l'ordre de priorité des couleurs

**Fichiers :**
- Modifier : `app/src/render/colors.ts`
- Modifier : `app/src/render/colors.test.ts`

**Interfaces :**
- Consomme : `ParsedModel.referentialTechnologies` (tâche 6).
- Produit : `coloursOfModel` accepte un troisième champ optionnel
  `referentialTechnologies?: readonly { type: string; colour: string }[]`.
  Les appelants passent déjà le modèle entier : aucun n'a besoin d'être modifié.

- [ ] **Étape 1 : écrire le test qui échoue**

Ajouter à `app/src/render/colors.test.ts` :

```ts
describe("colour priority", () => {
  const base = {
    interfaces: [{ flowType: "HTTP" }],
    flowTypes: [{ type: "HTTP", colour: "" }],
  };

  it("takes the referential's colour when the workbook declares none", () => {
    const colours = coloursOfModel({
      ...base,
      referentialTechnologies: [{ type: "HTTP", colour: "#b8481f" }],
    });
    expect(colours.get("HTTP")).toBe("#b8481f");
  });

  it("lets a colour typed in the workbook win over the referential", () => {
    const colours = coloursOfModel({
      interfaces: [{ flowType: "HTTP" }],
      flowTypes: [{ type: "HTTP", colour: "#0e7f56" }],
      referentialTechnologies: [{ type: "HTTP", colour: "#b8481f" }],
    });
    expect(colours.get("HTTP")).toBe("#0e7f56");
  });

  it("falls back on the palette when neither declares one", () => {
    expect(coloursOfModel(base).get("HTTP")).toBe(PALETTE[0]);
  });

  it("ignores a referential colour that is not hexadecimal", () => {
    const colours = coloursOfModel({
      ...base,
      referentialTechnologies: [{ type: "HTTP", colour: "blue" }],
    });
    expect(colours.get("HTTP")).toBe(PALETTE[0]);
  });
});
```

- [ ] **Étape 2 : lancer le test pour vérifier qu'il échoue**

```bash
cd app && npx vitest run src/render/colors.test.ts
```
Attendu : ÉCHEC — la couleur du référentiel n'est pas prise.

- [ ] **Étape 3 : implémenter**

Dans `app/src/render/colors.ts`, changer la signature et le calcul de
`declaredColour` :

```ts
export function coloursOfModel(model: {
  interfaces: readonly { flowType: string }[];
  flowTypes: readonly { type: string; colour: string }[];
  // The external referential's colours. They are the ordinary source; the
  // workbook's own Colour column stays available above them, because forcing a
  // hue locally is legitimate and the referential is not always right.
  referentialTechnologies?: readonly { type: string; colour: string }[];
}): Map<string, string> {
```

et, en remplacement de la boucle qui remplit `declaredColour` :

```ts
  const declaredColour = new Map<string, string>();
  for (const t of model.referentialTechnologies ?? []) {
    const colour = declaredColourOf(t.colour);
    if (colour) declaredColour.set(t.type.trim(), colour);
  }
  // Second, so that a colour typed into the workbook overwrites the
  // referential's.
  for (const t of model.flowTypes) {
    const colour = declaredColourOf(t.colour);
    if (colour) declaredColour.set(t.type.trim(), colour);
  }
```

- [ ] **Étape 4 : lancer les tests pour vérifier qu'ils passent**

```bash
cd app && npx vitest run && npx tsc --noEmit
```
Attendu : SUCCÈS.

- [ ] **Étape 5 : commit**

```bash
git add app/src/render/colors.ts app/src/render/colors.test.ts
git commit -m "feat(render): take a technology's colour from the referential"
```

---

## Tâche 8 : les deux signalements d'intégrité

**Fichiers :**
- Modifier : `app/src/integrity/checks.ts`
- Modifier : `app/src/integrity/checks.test.ts`

**Interfaces :**
- Consomme : `ParsedModel.referentialActors`, `.referentialTechnologies` (tâche 6),
  `locatedItems`, `InfoBlock` (déjà dans le fichier).
- Produit : un `InfoBlock` `outOfReferential`, ajouté à la liste des blocs
  d'information du rapport.

Un `InfoBlock`, pas une anomalie : cartographier avant que le référentiel ne
soit à jour est le cas normal, pas une faute.

- [ ] **Étape 1 : écrire le test qui échoue**

Ajouter à `app/src/integrity/checks.test.ts` :

```ts
describe("out of referential", () => {
  it("says nothing when the workbook carries no referential", () => {
    const report = runIntegrityChecks(modelWith({ referentialActors: [], referentialTechnologies: [] }));
    expect(report.infoBlocks.find((b) => b.id === "out-of-referential")).toBeUndefined();
  });

  it("names an actor the referential does not know", () => {
    const report = runIntegrityChecks(
      modelWith({
        actors: [actor("Tatooine"), actor("Alderaan")],
        referentialActors: [{ name: "Tatooine", group: "", actorType: "", owner: "", description: "" }],
      })
    );
    const block = report.infoBlocks.find((b) => b.id === "out-of-referential")!;
    expect(block.items.join(" ")).toContain("Alderaan");
    expect(block.items.join(" ")).not.toContain("Tatooine");
  });

  it("names a technology the referential does not know", () => {
    const report = runIntegrityChecks(
      modelWith({
        flowTypes: [flowType("HTTP"), flowType("MQ")],
        referentialTechnologies: [{ type: "HTTP", direction: "", description: "", colour: "" }],
      })
    );
    const block = report.infoBlocks.find((b) => b.id === "out-of-referential")!;
    expect(block.items.join(" ")).toContain("MQ");
  });

  it("compares regardless of case and accents, as every other check does", () => {
    const report = runIntegrityChecks(
      modelWith({
        actors: [actor("TATOOINE")],
        referentialActors: [{ name: "Tatooine", group: "", actorType: "", owner: "", description: "" }],
      })
    );
    expect(report.infoBlocks.find((b) => b.id === "out-of-referential")).toBeUndefined();
  });
});
```

> `modelWith`, `actor` et `flowType` sont les fabriques déjà utilisées par ce
> fichier de test ; reprendre leurs noms exacts.

- [ ] **Étape 2 : lancer le test pour vérifier qu'il échoue**

```bash
cd app && npx vitest run src/integrity/checks.test.ts
```
Attendu : ÉCHEC — bloc introuvable.

- [ ] **Étape 3 : implémenter**

Ajouter dans `app/src/integrity/checks.ts`, à côté des autres `InfoBlock` :

```ts
// What the workbook declares and the referential does not know. Not an anomaly:
// a cartography is often drawn before the central referential catches up, and
// refusing the name would stop the work for a bookkeeping lag. But an unknown
// name is also what a typo looks like, so it is worth seeing.
function outOfReferential(model: ParsedModel): InfoBlock {
  const knownActors = new Set(model.referentialActors.map((a) => normalizeText(a.name)));
  const knownTechnologies = new Set(model.referentialTechnologies.map((t) => normalizeText(t.type)));

  const items = [
    ...(knownActors.size === 0
      ? []
      : locatedItems(
          model.actors.filter((a) => a.name.trim() !== "" && !knownActors.has(normalizeText(a.name))),
          (a) => `actor "${a.name}"`
        )),
    ...(knownTechnologies.size === 0
      ? []
      : locatedItems(
          model.flowTypes.filter((t) => t.type.trim() !== "" && !knownTechnologies.has(normalizeText(t.type))),
          (t) => `technology "${t.type}"`
        )),
  ];

  return {
    id: "out-of-referential",
    title: "Declared here, unknown to the referential",
    description:
      "These names are used by this workbook but do not appear in the external referential. " +
      "That is legitimate while the referential catches up; it is also what a typo looks like.",
    items,
    level: "info",
  };
}
```

> `InfoBlock` porte exactement `id`, `title`, `description`, `items` et `level`
> (`integrity/checks.ts:101`). `level: "info"` et non `"warning"` : un
> référentiel en retard n'est pas une faute du classeur.

Puis, dans `runIntegrityChecks`, ajouter `outOfReferential(model)` à la liste des
blocs, à côté de `unusedFlowTypes(model)`. Les blocs vides sont déjà écartés à
l'affichage : vérifier que c'est bien le cas, sans quoi filtrer sur
`items.length > 0` comme le font les voisins.

- [ ] **Étape 4 : lancer les tests pour vérifier qu'ils passent**

```bash
cd app && npx vitest run && npx tsc --noEmit
```
Attendu : SUCCÈS.

- [ ] **Étape 5 : commit**

```bash
git add app/src/integrity/checks.ts app/src/integrity/checks.test.ts
git commit -m "feat(integrity): report names the external referential does not know"
```

---

## Tâche 9 : saisir et reconduire les deux URL

**Fichiers :**
- Modifier : `app/src/ui/state.ts`
- Modifier : `app/src/ui/rail.ts`
- Modifier : `app/src/ui/app.ts`
- Modifier : `app/index.html` (CSS)
- Modifier : `app/src/ui/state.test.ts`

**Interfaces :**
- Consomme : `readReferentialUrls`, `ReferentialUrls`, `NO_REFERENTIAL` (tâches 1-2),
  `dataFromModel` (`export/schema-upgrade.ts`), `downloadTemplateXlsx`
  (`export/template-export.ts`).
- Produit :
  - `LoadedFile` gagne `referentials: ReferentialUrls`.
  - `export function withReferentials(state: AppState, urls: ReferentialUrls): AppState`
  - `RailCallbacks` gagne `onReferentials: (urls: ReferentialUrls) => void`
    et `onDownloadWithReferentials: () => void`.

Le geste : on dépose le classeur, le rail affiche les deux URL qu'il porte déjà,
on les garde ou on les remplace, on retélécharge.

- [ ] **Étape 1 : écrire le test qui échoue**

Ajouter à `app/src/ui/state.test.ts` :

```ts
import { withReferentials, initialState } from "./state";

describe("withReferentials", () => {
  it("replaces the loaded workbook's URLs without touching the rest", () => {
    const state = { ...initialState(), file: { name: "a.xlsx", model: {} as never, report: {} as never, dateModification: null, referentials: { actors: "", technologies: "" } } };
    const next = withReferentials(state, { actors: "https://ref/a.csv", technologies: "" });
    expect(next.file!.referentials).toEqual({ actors: "https://ref/a.csv", technologies: "" });
    expect(next.file!.name).toBe("a.xlsx");
    expect(next.view).toBe(state.view);
  });

  it("does nothing when no workbook is loaded", () => {
    const state = initialState();
    expect(withReferentials(state, { actors: "https://ref/a.csv", technologies: "" })).toBe(state);
  });
});
```

- [ ] **Étape 2 : lancer le test pour vérifier qu'il échoue**

```bash
cd app && npx vitest run src/ui/state.test.ts
```
Attendu : ÉCHEC — `withReferentials` n'existe pas.

- [ ] **Étape 3 : implémenter**

Dans `app/src/ui/state.ts` :

```ts
import type { ReferentialUrls } from "../export/datamashup";
```

Ajouter à `LoadedFile` :

```ts
  // The two referential URLs the file already carries. They live in the Power
  // Query definition, inside the workbook, so they travel with it: two
  // cartographies can point at two different referentials.
  referentials: ReferentialUrls;
```

et la transition :

```ts
export function withReferentials(state: AppState, referentials: ReferentialUrls): AppState {
  if (!state.file) return state;
  return { ...state, file: { ...state.file, referentials } };
}
```

Dans `app/src/ui/app.ts`, `readWorkbook` : garder les octets et lire les URL.

```ts
    const bytes = await file.arrayBuffer();
    let parsed;
    try {
      parsed = parseWorkbook(bytes);
    } catch {
      return { ok: false, message: "Workbook unreadable or corrupted." };
    }
```

puis, dans l'objet `loaded` retourné :

```ts
      referentials: await readReferentialUrls(bytes),
```

Ajouter le gestionnaire, à côté de `downloadTemplateHandler` :

```ts
  // The workbook, rewritten with the URLs now on screen. The tool never goes
  // to the network: it writes the query, Excel does the loading.
  function downloadWithReferentials(): void {
    const state = legacyState();
    if (!state.file) return;
    downloadTemplateXlsx(state.file.name, {
      ...dataFromModel(state.file.model),
      referentials: state.file.referentials,
    });
  }
```

et le brancher dans les deux objets de callbacks du rail :

```ts
        onReferentials: (urls) => setState(withReferentials(legacyState(), urls)),
        onDownloadWithReferentials: downloadWithReferentials,
```

Dans `app/src/ui/rail.ts`, ajouter les deux callbacks à `RailCallbacks` :

```ts
  onReferentials: (urls: ReferentialUrls) => void;
  onDownloadWithReferentials: () => void;
```

et le bloc, rendu seulement quand un classeur est chargé :

```ts
// Where this workbook's two referentials are published. The URL is a property
// of the FILE, not of the tool: it travels with it, so two cartographies can
// point at two different referentials -- which a central pivot file would have
// made impossible.
function referentialBlock(
  current: ReferentialUrls,
  onChange: (urls: ReferentialUrls) => void,
  onDownload: () => void
): HTMLElement {
  const block = el("div", { class: "rail-referential" });
  block.appendChild(el("h3", {}, ["External referential"]));

  const field = (label: string, value: string, key: keyof ReferentialUrls): HTMLElement => {
    const wrapper = el("label", { class: "rail-referential-field" }, [label]);
    const input = el("input", {
      type: "url",
      class: "rail-referential-url",
      value,
      placeholder: "https://…/referential.csv",
    });
    input.addEventListener("change", () => onChange({ ...current, [key]: input.value.trim() }));
    wrapper.appendChild(input);
    return wrapper;
  };

  block.appendChild(field("Actors", current.actors, "actors"));
  block.appendChild(field("Technologies", current.technologies, "technologies"));

  const button = el("button", { class: "rail-referential-download", type: "button" }, [
    "Download the workbook with these URLs",
  ]);
  button.addEventListener("click", onDownload);
  block.appendChild(button);

  // The tool writes the query; it never fetches. Saying so here spares the
  // question "why does nothing happen when I type a URL".
  block.appendChild(
    el("p", { class: "rail-note" }, ["The tool writes the query. Excel does the loading, on refresh."])
  );
  return block;
}
```

L'appeler depuis le rendu du rail, après le bloc de comparaison, quand
`state.file` existe :

```ts
  if (state.file) {
    rail.appendChild(referentialBlock(state.file.referentials, callbacks.onReferentials, callbacks.onDownloadWithReferentials));
  }
```

Dans `app/index.html`, ajouter aux styles du rail :

```css
    .rail-referential { display: flex; flex-direction: column; gap: 6px; flex-shrink: 0; }
    .rail-referential-field { display: flex; flex-direction: column; gap: 2px; font-size: 12px; }
    .rail-referential-url { width: 100%; box-sizing: border-box; padding: 4px 6px; font-size: 12px; }
    .rail-referential-download { padding: 6px 8px; font-size: 12px; cursor: pointer; }
    .rail-note { margin: 0; font-size: 11px; opacity: 0.75; }
```

- [ ] **Étape 4 : lancer les tests, le typage et le build**

```bash
cd app && npx vitest run && npx tsc --noEmit && npm run build
```
Attendu : SUCCÈS. Les fabriques de `LoadedFile` dans les tests gagnent
`referentials: { actors: "", technologies: "" }`.

- [ ] **Étape 5 : vérifier dans Chrome**

```bash
cd app && npm run build
npx http-server -p 8899 -c-1 /Users/arnaud/IdeaProjects/Flux
```

Ouvrir `http://127.0.0.1:8899/app/dist/interface-map.html`, déposer
`Exemples/exemple.xlsx` par glisser-déposer synthétique (le chargement ne passe
que par là : `fetch` du fichier puis `DragEvent("drop")` avec un `DataTransfer`
sur `.drop-target`). Vérifier :
- le bloc « External referential » apparaît, les deux champs sont vides ;
- saisir deux URL, cliquer sur le bouton : un `.xlsx` est téléchargé ;
- aucune erreur dans la console.

- [ ] **Étape 6 : commit**

```bash
git add app/src/ui app/index.html
git commit -m "feat(ui): show and edit the workbook's referential URLs"
```

---

## Tâche 10 : faire vérifier le classeur produit dans le vrai Excel

**Fichiers :** aucun.

Le seul juge de ce format est Excel, et **on ne pilote pas Excel**. La
vérification se fait en livrant le fichier.

- [ ] **Étape 1 : produire un classeur portant deux URL**

Ajouter un test temporaire `app/src/export/tmp-dump.test.ts` :

```ts
import { it } from "vitest";
import { writeFileSync } from "node:fs";
import { writeTemplate } from "./template-export";
import { SAMPLE_DATA } from "./sample-data";

it("dump", () => {
  const bytes = writeTemplate({
    ...SAMPLE_DATA,
    referentials: {
      actors: "https://example.invalid/actors.csv",
      technologies: "https://example.invalid/technologies.csv",
    },
  });
  writeFileSync("/tmp/referentiel.xlsx", Buffer.from(bytes));
});
```

```bash
cd app && npx vitest run src/export/tmp-dump.test.ts && rm src/export/tmp-dump.test.ts
```

- [ ] **Étape 2 : livrer le fichier à l'utilisateur**

Envoyer `/tmp/referentiel.xlsx` avec `SendUserFile`, en demandant :
- le classeur s'ouvre-t-il sans avertissement ?
- **Données ▸ Requêtes et connexions** liste-t-il `RefActors` et
  `RefTechnologies` ?
- les onglets `RefActors` / `RefTechnologies` existent-ils, masqués ?

Les deux URL pointent volontairement vers `example.invalid` : la requête sera en
erreur au chargement, ce qui est attendu et n'empêche pas de vérifier que la
définition est là.

- [ ] **Étape 3 : consigner le résultat**

Selon la réponse, mettre à jour `docs/BACKLOG.md` : soit l'entrée « Référentiel
externe » disparaît, soit elle ne garde que ce qui reste à corriger.

```bash
git add docs/BACKLOG.md
git commit -m "docs: record the Excel verification of the referential queries"
```

---

## Relecture du plan contre la spec

| §  de la spec | Traitée par |
|---|---|
| §1 Objet | tâches 1-9 |
| §2 Alimente sans remplacer ; deux onglets masqués ; marche sans référentiel | tâche 5 (onglets, masquage), tâches 1/3 (URL vide ⇒ rien d'écrit) |
| §3 Les deux tableaux et leurs colonnes | tâche 5 (`REF_ACTOR_COLUMNS`, `REF_TECHNOLOGY_COLUMNS`) |
| §4 Listes déroulantes | tâche 5 (`L_RefActeur`, `L_RefGroupe`, `L_RefTypeActeur`, `L_RefTypeFlux`) |
| §4 Couleurs et leur priorité | tâche 7 |
| §4 Deux contrôles d'intégrité | tâche 8 |
| §5 URL propriété du classeur, deux URL, CSV UTF-8, geste | tâches 1 (M, CSV, `Encoding=65001`), 2 (relecture), 9 (geste) |
| §6 Flux DataMashup et ses quatre conventions | tâche 1 |
| §7 Parties OOXML, `writeBinaryPart`, `saveData="1"` | tâches 3 et 4 |
| §8 Migration : reposer les requêtes, schéma v5 | tâche 6 (étape 4→5), tâche 9 (les URL relues sont reconduites au téléchargement) |
| §9 Ce que ça ne fait pas | tâche 9 (aucun appel réseau), tâche 8 (signalement, pas blocage) |
| §10 Effet sur le code | table « Structure des fichiers » |
| §11 Zip stocké ou compressé | tâche 1 écrit en stocké ; tâche 10 le fait vérifier |

**Trou assumé.** La spec §8 dit que la migration doit « reposer les requêtes
quand elles sont absentes ». Ici les URL sont relues au dépôt (tâche 2), portées
par `LoadedFile` (tâche 9) et réécrites à chaque téléchargement — y compris par
le chemin de mise à niveau, qui passe par `downloadTemplateXlsx`. **Vérifier en
tâche 9** que le bouton de mise à niveau (`app.ts`, appel
`downloadTemplateXlsx(...)` avec `upgrade(model)`)
reçoit lui aussi `referentials: state.file.referentials`, sans quoi une mise à
niveau effacerait les requêtes — précisément ce que la spec interdit.
