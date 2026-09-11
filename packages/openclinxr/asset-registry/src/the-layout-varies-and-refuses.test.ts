import { createHash } from "node:crypto";
import { resolveBedsideLayoutFromSeed } from "@openclinxr/asset-registry/layout-solve";
import { describe, expect, it } from "vitest";

const LAYOUT_SEED_SCHEME = "openclinxr.layout-variation-seed.v1";
const VERSION_TOKEN = /^[A-Za-z0-9._-]+$/u;

function deriveLayoutVariationSeed(input: {
  scenarioId: string;
  assetRevision: string;
  solverVersion: string;
  variationIndex: number;
}): string {
  if (
    typeof input.scenarioId !== "string" ||
    input.scenarioId.trim() === "" ||
    !VERSION_TOKEN.test(input.assetRevision) ||
    !VERSION_TOKEN.test(input.solverVersion) ||
    !Number.isInteger(input.variationIndex) ||
    input.variationIndex < 0
  ) {
    throw new Error(
      `${LAYOUT_SEED_SCHEME}: refused an unstable seed input. A layout seed is a pure function of case, asset revision, solver version and a non-negative integer index; a wall clock or random value in any slot makes "deterministic" a claim about inputs nobody passes.`,
    );
  }
  return createHash("sha256")
    .update(
      [LAYOUT_SEED_SCHEME, input.scenarioId, input.assetRevision, input.solverVersion, String(input.variationIndex)].join(" "),
    )
    .digest("hex");
}

function resolveBedsideLayout(input: {
  seedInput: Parameters<typeof deriveLayoutVariationSeed>[0];
  patientPosition: Parameters<typeof resolveBedsideLayoutFromSeed>[0]["patientPosition"];
  obstacles: Parameters<typeof resolveBedsideLayoutFromSeed>[0]["obstacles"];
  supportBounds?: Parameters<typeof resolveBedsideLayoutFromSeed>[0]["supportBounds"];
  intent?: Parameters<typeof resolveBedsideLayoutFromSeed>[0]["intent"];
}) {
  return resolveBedsideLayoutFromSeed({
    seed: deriveLayoutVariationSeed(input.seedInput),
    patientPosition: input.patientPosition,
    obstacles: input.obstacles,
    ...(input.supportBounds === undefined ? {} : { supportBounds: input.supportBounds }),
    ...(input.intent === undefined ? {} : { intent: input.intent }),
  });
}

/**
 * Brief §7 step 5: "Exercise multiple variation indices and an impossible layout. Same versioned
 * inputs reproduce the result."
 *
 * Both halves are here. Reproducibility without an impossible case would pass on a resolver that
 * always returns the same answer; an impossible case without reproducibility would pass on one
 * that guesses.
 */
const PATIENT = { x: -0.9, y: 0, z: -0.1 };

const SEED_INPUT = {
  scenarioId: "ed_chest_pain_priority_v2",
  assetRevision: "2026-09-09",
  solverVersion: "bedside-layout.v1",
  variationIndex: 0,
};

describe("the layout varies deterministically and refuses when nothing fits", () => {
  it("(1) the same versioned inputs reproduce the same seed and the same layout", () => {
    const first = resolveBedsideLayout({ seedInput: SEED_INPUT, patientPosition: PATIENT, obstacles: [] });
    const second = resolveBedsideLayout({ seedInput: SEED_INPUT, patientPosition: PATIENT, obstacles: [] });
    expect(first).toEqual(second);
    expect(deriveLayoutVariationSeed(SEED_INPUT)).toBe(deriveLayoutVariationSeed(SEED_INPUT));
  });

  it("(2) a different variation index moves the seed, and a different solver version moves it too", () => {
    const base = deriveLayoutVariationSeed(SEED_INPUT);
    expect(deriveLayoutVariationSeed({ ...SEED_INPUT, variationIndex: 1 })).not.toBe(base);
    expect(deriveLayoutVariationSeed({ ...SEED_INPUT, solverVersion: "bedside-layout.v2" })).not.toBe(base);
    expect(deriveLayoutVariationSeed({ ...SEED_INPUT, assetRevision: "2026-09-10" })).not.toBe(base);
  });

  it("(3) MULTIPLE INDICES actually explore: across 8 indices both approach sides are chosen", () => {
    // A seeded resolver that always picks the same side is deterministic and useless. This is the
    // counterweight to clause (1): reproducibility alone is satisfied by a constant.
    const sides = new Set<string>();
    for (let variationIndex = 0; variationIndex < 8; variationIndex += 1) {
      const layout = resolveBedsideLayout({
        seedInput: { ...SEED_INPUT, variationIndex },
        patientPosition: PATIENT,
        obstacles: [],
      });
      if (layout.resolved) sides.add(layout.approachSide);
    }
    expect([...sides].sort()).toEqual(["patient_left", "patient_right"]);
  });

  it("(4) AN IMPOSSIBLE LAYOUT is refused with every candidate named, not silently downgraded", () => {
    // Walls of obstacle on both sides of the bed, tall enough to be in the body band and wide
    // enough to cover every standoff the resolver will try.
    const blockBothSides = [
      {
        id: "wall_of_carts_right",
        bounds: { min: { x: -3, y: 0, z: 0.3 }, max: { x: 3, y: 1.6, z: 3 } },
      },
      {
        id: "wall_of_carts_left",
        bounds: { min: { x: -3, y: 0, z: -3 }, max: { x: 3, y: 1.6, z: -0.5 } },
      },
    ];
    const layout = resolveBedsideLayout({
      seedInput: SEED_INPUT,
      patientPosition: PATIENT,
      obstacles: blockBothSides,
    });
    expect(layout.resolved).toBe(false);
    if (layout.resolved) throw new Error("unreachable");
    // Every candidate tried is reported: 2 sides x 3 standoffs.
    expect(layout.unsatisfied).toHaveLength(6);
    for (const candidate of layout.unsatisfied) {
      expect(candidate.reason.length).toBeGreaterThan(0);
    }
    // The seed is still recorded on a refusal — a run that produced nothing is still identifiable.
    expect(layout.seed).toHaveLength(64);
  });

  it("(5) the seed REFUSES an unstable input rather than hashing it", () => {
    // A wall clock and a random fraction are the two values that would make "deterministic" a
    // claim about inputs nobody passes.
    expect(() =>
      deriveLayoutVariationSeed({ ...SEED_INPUT, variationIndex: Math.random() }),
    ).toThrow(/refused an unstable seed input/);
    expect(() =>
      deriveLayoutVariationSeed({ ...SEED_INPUT, solverVersion: new Date().toISOString() }),
    ).toThrow(/refused an unstable seed input/);
    expect(() => deriveLayoutVariationSeed({ ...SEED_INPUT, variationIndex: -1 })).toThrow();
    expect(() => deriveLayoutVariationSeed({ ...SEED_INPUT, scenarioId: "" })).toThrow();
  });

  it("(6) hard constraints are applied BEFORE ranking: a blocked nearest standoff yields a farther one, never the blocked one", () => {
    // A ring around the bed at the 0.75 m standoff only. The resolver must step out to 0.9 m
    // rather than returning the nearest candidate with a violation on it.
    const layout = resolveBedsideLayout({
      seedInput: SEED_INPUT,
      patientPosition: PATIENT,
      obstacles: [{
        id: "trolley_at_the_near_standoff",
        bounds: { min: { x: -1.4, y: 0, z: 1.0 }, max: { x: -0.4, y: 1.2, z: 1.25 } },
      }],
    });
    expect(layout.resolved).toBe(true);
    if (!layout.resolved) throw new Error("unreachable");
    if (layout.approachSide === "patient_right") {
      expect(layout.standoffMeters).toBeGreaterThan(0.75);
    }
  });
});
