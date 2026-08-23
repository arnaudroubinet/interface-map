// Architecture DSLs name their elements with a single word; the workbook, for
// its part, lets anything be written -- "Jakku", "Network probe", "IF - PRS".
// The mapping happens here, once, so that both exports name the same actor the
// same way.
//
// Uniqueness matters as much as the shape: two distinct names reducing to the
// same word would leave a single element in the produced file, and half the
// flows would point elsewhere with nothing to say so.
export function identifiers(names: string[]): Map<string, string> {
  const taken = new Set<string>();
  const table = new Map<string, string>();

  for (const name of names) {
    const base = name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
    const word = /^[a-z]/.test(base) ? base : `e${base}`;

    let candidate = word;
    let suffix = 2;
    while (taken.has(candidate)) candidate = `${word}_${suffix++}`;
    taken.add(candidate);
    table.set(name, candidate);
  }

  return table;
}
