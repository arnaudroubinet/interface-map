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

import * as XLSX from "xlsx";
import { REF_ACTORS_SHEET, REF_TECHNOLOGIES_SHEET } from "../parsing/build-model";

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

// A query's name IS the name of the sheet it fills. template-export puts that
// sheet constant into the table's `query`, from where it becomes the
// connection's `Location=` and its `SELECT * FROM [...]`: were the two
// declarations to drift apart, Excel would carry a connection naming a query
// that does not exist, and nothing in the package would say so. Deriving them
// from the sheet names makes the drift impossible rather than detectable.
export const MASHUP_QUERIES = [REF_ACTORS_SHEET, REF_TECHNOLOGIES_SHEET] as const;

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
  } catch (err) {
    // A workbook with no mashup part returns above, without coming through
    // here: reaching this point means the part exists and we failed to make
    // sense of it. That is our bug far more often than the file's, so it is
    // said out loud -- silently returning "no referential" would hide an
    // offset regression behind an ordinary-looking result.
    console.warn("Referential URLs unreadable in this workbook.", err);
    return NO_REFERENTIAL;
  }
}
