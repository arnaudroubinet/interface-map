// @vitest-environment node
//
// jsdom's Blob has no stream() method, which both the reader and this file's
// deflate helper rely on. Node's own Blob does.
import { describe, it, expect, vi } from "vitest";
import { sectionM, customXmlItem, storedZip, hasReferential, urlOfQuery, NO_REFERENTIAL } from "./datamashup";
import * as XLSX from "xlsx";
import { readReferentialUrls, mashupStream } from "./datamashup";

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

describe("urlOfQuery", () => {
  it("reads the URL of the query it names", () => {
    expect(urlOfQuery(sectionM({ actors: "https://ref/a.csv", technologies: "https://ref/t.csv" }), "RefTechnologies")).toBe(
      "https://ref/t.csv"
    );
  });

  // A query with no Web.Contents -- hand-edited, or rewritten by Excel -- used
  // to let the search run on into the FOLLOWING query and hand back ITS URL
  // under this query's name.
  it("does not walk into the next query when its own has no source", () => {
    const section =
      "section Section1;\n\n" +
      "shared RefActors = let\n    Source = Table.FromRows({})\nin\n    Source;\n\n" +
      'shared RefTechnologies = let\n    Source = Csv.Document(Web.Contents("https://ref/t.csv"))\nin\n    Source;\n';
    expect(urlOfQuery(section, "RefActors")).toBe("");
    expect(urlOfQuery(section, "RefTechnologies")).toBe("https://ref/t.csv");
  });

  it("returns nothing for a query the section does not declare", () => {
    expect(urlOfQuery(sectionM({ actors: "https://ref/a.csv", technologies: "" }), "RefTechnologies")).toBe("");
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

  it("warns rather than staying silent when the mashup content cannot be parsed", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // Past the element regex -- a <DataMashup> element is genuinely there --
    // but its body is not valid base64, so decoding it throws instead of
    // returning bytes we could go on to misread.
    const read = await readReferentialUrls(workbookCarrying(garbageCustomXmlItem()));
    expect(read).toEqual(NO_REFERENTIAL);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

function garbageCustomXmlItem(): Uint8Array {
  const text =
    `<?xml version="1.0" encoding="utf-16"?>` +
    `<DataMashup xmlns="http://schemas.microsoft.com/DataMashup">A</DataMashup>`;
  const bytes = new Uint8Array(2 + text.length * 2);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, 0xfeff, true);
  for (let i = 0; i < text.length; i++) view.setUint16(2 + i * 2, text.charCodeAt(i), true);
  return bytes;
}

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
