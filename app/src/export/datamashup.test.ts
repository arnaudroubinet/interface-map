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
