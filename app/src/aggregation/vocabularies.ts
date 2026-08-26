import { NATURE_BUSINESS, NATURE_MIDDLEWARE, NATURE_STORAGE } from "./nature";

// The domain's closed vocabularies. The same values feed the workbook's
// drop-down lists (export/template-export.ts) and the integrity checks that
// validate them (integrity/checks.ts): neither of the two owns them, so they
// live here rather than being declared twice and left free to diverge.

export const VOCABULARY_DIRECTION = ["provider → consumer", "consumer → provider"];

// "Remove" is a judgement like the others -- this consumption has no reason to
// exist any more -- and not a leaving date: that one is declared by a
// retirement milestone, and the two can coexist.
export const VOCABULARY_DECISION = ["Keep", "Investigate", "Transform", "Remove"];

export const VOCABULARY_CRITICALITY = ["1 - Critical", "2 - Important", "3 - Standard"];

// Three roles, not two: a middleware is CROSSED by the functional reading, a
// storage is where the data STOPS. Reporting an S3 bucket for swallowing a flow
// was the price of confusing them.
export const VOCABULARY_NATURE = [NATURE_BUSINESS, NATURE_MIDDLEWARE, NATURE_STORAGE];

// The perimeter decides the whole drawing: what goes inside the boundary and
// what stays out. It used to be hard-coded in three places -- the workbook's
// drop-down, the two diagram predicates, the C4 exports -- and the last two
// did not compare it the same way.
export const PERIMETER_PLATFORM = "Platform";
export const PERIMETER_EXTERNAL = "External";
export const VOCABULARY_PERIMETER = [PERIMETER_PLATFORM, PERIMETER_EXTERNAL];
