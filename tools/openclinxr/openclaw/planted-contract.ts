/**
 * Planted-contract honesty checker.
 *
 * Resolution for the RED-first vs green-health conflict (#35): plant expected
 * failures with vitest `it.fails` so main stays green while the feature is
 * absent, and goes red the moment a worker implements it without flipping the
 * marker. This module keeps that practice honest:
 *
 *   1. Vacuous assertions (literals only — e.g. expect(true).toBe(false)) are
 *      rejected: they keep main green forever and encode nothing about product.
 *   2. A test still marked planted after its feature lands (currentlyPasses)
 *      is flagged so the marker is flipped/removed in the same slice.
 *
 * Pure function over entry descriptors — no filesystem, no vitest runtime.
 * Callers (tests, future gates) supply the shape; we only judge honesty.
 */

export type PlantedContractEntry = {
  name: string;
  /** True while the contract is planted as an expected fail (`it.fails`). */
  planted: boolean;
  /** Source-ish assertion snippets for vacuity checks. */
  assertions: string[];
  /**
   * When true, the underlying assertions currently pass under a plain `it`.
   * A planted + currentlyPasses combination means the feature landed and the
   * marker is stale.
   */
  currentlyPasses?: boolean;
};

/**
 * Heuristic: does this assertion text reference something under test (a
 * non-literal identifier), or is it pure literals / tautology junk?
 *
 * Vacuous examples:
 *   expect(true).toBe(false)
 *   expect(1).toBe(0)
 *   expect("x").toBe("y")
 *
 * Product examples:
 *   expect(shutdownApiApp(app)).resolves
 *   expect(x).toBe(1)
 */
const LITERAL_OR_PUNCT =
  /^(?:true|false|null|undefined|NaN|Infinity|-?\d+(?:\.\d+)?(?:e[+-]?\d+)?|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)$/i;

/** Tokens that are test-framework / matcher chrome, not product under test. */
const FRAMEWORK_TOKENS = new Set([
  "expect",
  "tobe",
  "toequal",
  "tostrictEqual",
  "tomatch",
  "tocontain",
  "tohavelength",
  "tobetruthy",
  "tobefalsy",
  "tobedefined",
  "tobeundefined",
  "tobenull",
  "tobeinstanceof",
  "tothrow",
  "resolves",
  "rejects",
  "not",
  "and",
  "or",
  "typeof",
  "instanceof",
  "new",
  "await",
  "async",
  "return",
  "const",
  "let",
  "var",
  "function",
  "it",
  "describe",
  "test",
  "vi",
  "assert",
]);

function assertionMentionsProduct(assertion: string): boolean {
  // Pull identifier-like tokens; ignore pure punctuation / operators.
  const tokens = assertion.match(/[A-Za-z_$][\w$]*/g) ?? [];
  for (const raw of tokens) {
    const lower = raw.toLowerCase();
    if (FRAMEWORK_TOKENS.has(lower)) continue;
    if (LITERAL_OR_PUNCT.test(raw)) continue;
    // Any remaining identifier is treated as product / subject under test.
    return true;
  }
  // Also accept dotted matcher chains only if a non-framework call arg exists.
  // No product identifiers → vacuous.
  return false;
}

function isVacuousPlanted(entry: PlantedContractEntry): boolean {
  if (!entry.planted) return false;
  if (!Array.isArray(entry.assertions) || entry.assertions.length === 0) {
    // Empty assertion list encodes nothing about the product.
    return true;
  }
  // Vacuous when EVERY assertion is literal-only junk.
  return entry.assertions.every((a) => !assertionMentionsProduct(String(a)));
}

function isStalePlanted(entry: PlantedContractEntry): boolean {
  return entry.planted === true && entry.currentlyPasses === true;
}

function normalizeEntry(raw: unknown): PlantedContractEntry | null {
  if (raw === null || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.name !== "string") return null;
  if (typeof o.planted !== "boolean") return null;
  const assertions = Array.isArray(o.assertions)
    ? o.assertions.map((a) => String(a))
    : [];
  const entry: PlantedContractEntry = {
    name: o.name,
    planted: o.planted,
    assertions,
  };
  if (typeof o.currentlyPasses === "boolean") {
    entry.currentlyPasses = o.currentlyPasses;
  }
  return entry;
}

/**
 * Returns human-readable violation messages for planted contracts that are
 * not honest. Empty array = all entries pass honesty checks (or are not planted).
 */
export function plantedContractsAreHonest(entries: unknown[]): string[] {
  if (!Array.isArray(entries)) return [];

  const violations: string[] = [];

  for (const raw of entries) {
    const entry = normalizeEntry(raw);
    if (!entry) continue;
    if (!entry.planted) continue;

    if (isVacuousPlanted(entry)) {
      violations.push(
        `planted contract "${entry.name}" is vacuous: assertions mention no product under test ` +
          `(literal-only junk like expect(true).toBe(false) keeps main green forever)`,
      );
      continue;
    }

    if (isStalePlanted(entry)) {
      violations.push(
        `planted contract "${entry.name}" is stale: feature has landed and currently passes — ` +
          `flip it.fails back to it (or remove the planted marker) in the same slice`,
      );
    }
  }

  return violations;
}
