// The order of a matrix's rows and columns. It is the strongest reading lever
// the matrix has: at 18% density, an alphabetical order scatters blocks that
// grouping makes appear at once.
//
// The order of implementation follows the one the reference survey recommends
// -- Behrisch, Bach, Henry Riche, Schreck & Fekete, "Matrix Reordering Methods
// for Table and Network Visualization", Computer Graphics Forum 35(3), 2016,
// https://doi.org/10.1111/cgf.12935, §11.1: "fast algorithms first", and its
// stopping rule, "if a fast algorithm reveals desired patterns, a more
// sophisticated one is unlikely to improve on its quality significantly".
export type MatrixOrder = "alphabetical" | "group" | "degree" | "blocks";

export interface OrderContext {
  groupOf: (id: string) => string;
  degree: (id: string) => number;
  neighbours: (id: string) => string[];
}

const byName = (a: string, b: string) => a.localeCompare(b, "fr");

// Reverse Cuthill-McKee: a breadth-first walk from the vertex of lowest
// degree, neighbours visited by increasing degree, then reversed. Linear, and
// "almost independently of the matrix density".
//
// Its weakness is known and accepted: the survey warns it "tends to produce
// strong bandwidth anti-patterns" -- a diagonal band that teaches nothing.
// Hence two rules: alphabetical stays the default, and stays one click away.
function rcm(ids: string[], ctx: OrderContext): string[] {
  const remaining = new Set(ids);
  const order: string[] = [];
  const byDegree = (a: string, b: string) => ctx.degree(a) - ctx.degree(b) || byName(a, b);
  while (remaining.size > 0) {
    const start = [...remaining].sort(byDegree)[0];
    const queue = [start];
    remaining.delete(start);
    while (queue.length > 0) {
      const current = queue.shift()!;
      order.push(current);
      for (const v of ctx.neighbours(current).filter((x) => remaining.has(x)).sort(byDegree)) {
        remaining.delete(v);
        queue.push(v);
      }
    }
  }
  return order.reverse();
}

export function orderBy(ids: string[], order: MatrixOrder, ctx: OrderContext): string[] {
  const alphabetical = [...ids].sort(byName);
  if (order === "alphabetical") return alphabetical;
  if (order === "group") {
    return alphabetical.sort((a, b) => byName(ctx.groupOf(a), ctx.groupOf(b)) || byName(a, b));
  }
  if (order === "degree") {
    return alphabetical.sort((a, b) => ctx.degree(b) - ctx.degree(a) || byName(a, b));
  }
  return rcm(alphabetical, ctx);
}
