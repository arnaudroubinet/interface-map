export function normalizeText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export interface NearDuplicate {
  // The Damerau-Levenshtein distance behind the match, or null when the two
  // names are equal outright (folded case/accents, or once punctuation is
  // ignored) -- an exact match carries no ambiguity to weigh.
  distance: number | null;
  reason: string;
}

// Two names likely to be the same thing, spelled two ways. Tried in order,
// first hit wins: an exact match (case, accents, punctuation) beats a typo,
// because it needs no threshold to be certain. Meant to flag a name split by
// a spelling variant -- later also to suggest "did you mean X?" against a
// reference list.
export function nearDuplicate(a: string, b: string): NearDuplicate | null {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (na === nb) {
    const caseOnly = a.trim().toLowerCase() === b.trim().toLowerCase();
    return { distance: null, reason: caseOnly ? "same name but for case" : "same name once accents and spacing are folded" };
  }

  const stripPunctuation = (s: string) => s.replace(/[^\p{L}\p{N}]/gu, "");
  if (stripPunctuation(na) === stripPunctuation(nb)) {
    return { distance: null, reason: "same name once punctuation is ignored" };
  }

  // Below this, one edit is a quarter of the string or more and means
  // nothing: "Core" and "Care" must not pair.
  const longer = Math.max(na.length, nb.length);
  if (longer < 5 || na[0] !== nb[0]) return null;

  const distance = damerauLevenshteinDistance(na, nb);
  const threshold = longer <= 8 ? 1 : 2;
  if (distance > threshold) return null;

  return { distance, reason: `${distance} letter${distance === 1 ? "" : "s"} apart` };
}

// Levenshtein distance, plus: swapping two adjacent characters counts as one
// edit rather than two substitutions -- the commonest typo.
function damerauLevenshteinDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) d[i][0] = i;
  for (let j = 0; j <= b.length; j++) d[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + cost);
      }
    }
  }
  return d[a.length][b.length];
}
