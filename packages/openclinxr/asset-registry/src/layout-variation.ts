import { createHash } from "node:crypto";
import { type MeasuredObstacle, bedsideClearanceViolations } from "./bedside-clearance.js";
import {
  type BedsideTarget,
  ED_STRETCHER_DECK_BOUNDS,
  type SupportBounds,
  type Vector3,
  bedsideTargetForClinician,
} from "./bedside-target.js";

/**
 * Deterministic LAYOUT variation, and an explicit refusal when no variation fits.
 *
 * Brief §7 step 5: "Exercise multiple variation indices and an impossible layout. Same versioned
 * inputs reproduce the result." And under Deterministic solving: "Derive variation from stable
 * case/asset/solver identities and a variation index; record the resulting seed and output.
 * Existing motion seeding already follows a versioned, content-based scheme, but does NOT supply
 * seeded room-layout optimization. Reuse the principle, with a layout-specific identity."
 *
 * So this reuses the PRINCIPLE of motion-compiler/src/trajectory/deterministic-variation.ts — a
 * content-based hash of validated stable inputs, refusing anything a wall clock or RNG could
 * produce — with a layout identity rather than a motion one. It does not import that module:
 * asset-registry does not depend on motion-compiler, and one seed spanning two different identity
 * sets would make one of them wrong.
 *
 * WHAT VARIES: which side of the bed the clinician approaches from, and the standoff within a
 * band. Nothing else. The brief is explicit that "a general optimizer is not a prerequisite" and
 * asks to "apply hard constraints before ranking valid alternatives ... and fail unsatisfied
 * explicit intent rather than substituting a different target".
 */

export const LAYOUT_SEED_SCHEME = "openclinxr.layout-variation-seed.v1";
export const VERSION_TOKEN = /^[A-Za-z0-9._-]+$/u;

export type LayoutSeedInput = {
  /** The case. Stable across runs by construction. */
  scenarioId: string;
  /** A version token for the geometry the layout is solved against. */
  assetRevision: string;
  /** A version token for this resolver, so a resolver change moves the seed. */
  solverVersion: string;
  /** Non-negative integer. A float, NaN, Infinity or a negative index is refused. */
  variationIndex: number;
};

/**
 * Validate that every slot holds something STABLE.
 *
 * A derivation that accepted whatever it was handed would let `Date.now()` or `Math.random()`
 * through a slot nobody checks, and the determinism claim would then hold only for inputs nobody
 * passes. That reasoning is the motion seed contract's, which states it first and is worth
 * repeating here rather than cross-referencing, because the refusal is the contract.
 */
export function isValidLayoutSeedInput(input: LayoutSeedInput): boolean {
  if (typeof input.scenarioId !== "string" || input.scenarioId.trim() === "") return false;
  if (!VERSION_TOKEN.test(input.assetRevision)) return false;
  if (!VERSION_TOKEN.test(input.solverVersion)) return false;
  if (!Number.isInteger(input.variationIndex) || input.variationIndex < 0) return false;
  return true;
}

export function deriveLayoutVariationSeed(input: LayoutSeedInput): string {
  if (!isValidLayoutSeedInput(input)) {
    throw new Error(
      `${LAYOUT_SEED_SCHEME}: refused an unstable seed input. A layout seed is a pure function of case, asset revision, solver version and a non-negative integer index; a wall clock or random value in any slot makes "deterministic" a claim about inputs nobody passes.`,
    );
  }
  return createHash("sha256")
    .update(
      [
        LAYOUT_SEED_SCHEME,
        input.scenarioId,
        input.assetRevision,
        input.solverVersion,
        String(input.variationIndex),
      ].join(" "),
    )
    .digest("hex");
}

export type ResolvedLayout =
  | {
      resolved: true;
      seed: string;
      target: BedsideTarget;
      approachSide: "patient_left" | "patient_right";
      standoffMeters: number;
    }
  | {
      resolved: false;
      seed: string;
      /** Every candidate tried, and why each failed. Never empty on a refusal. */
      unsatisfied: Array<{ approachSide: string; standoffMeters: number; reason: string }>;
    };

/** Standoffs the resolver will try, nearest first. */
const STANDOFF_CANDIDATES_METERS = [0.75, 0.9, 1.05] as const;

/**
 * Resolve a bedside layout for one variation index, or REFUSE with the constraints that failed.
 *
 * Candidate order comes from the seed, so two variation indices explore the sides in different
 * orders while each stays reproducible. Hard constraints are applied BEFORE ranking: a candidate
 * with any clearance violation is never returned, whatever its rank.
 *
 * On failure it returns every candidate it tried with its reason, rather than falling back to a
 * position that violates something. The brief: "Return a resolved layout or explicit unsatisfied
 * constraints."
 */
/**
 * Explicit authored intent for the bedside target.
 *
 * Brief §3, deterministic solving: *"fail unsatisfied explicit intent rather than substituting a
 * different target."* Without this the resolver tried BOTH sides and every standoff, so a case that
 * authored "approach from the patient's left" would silently be given the right side whenever the
 * left was blocked — a substitution the author never sees and the seed makes look deliberate.
 *
 * Intent NARROWS the candidate set; it never widens it. An authored side with no authored standoff
 * still tries every standoff on THAT side, which is search within the intent rather than around it.
 */
export type BedsideLayoutIntent = {
  approachSide?: "patient_left" | "patient_right" | undefined;
  standoffMeters?: number | undefined;
};

export function resolveBedsideLayout(input: {
  seedInput: LayoutSeedInput;
  patientPosition: Vector3;
  supportBounds?: SupportBounds | undefined;
  obstacles: readonly MeasuredObstacle[];
  /** Authored intent. Absent means the seed explores; present means it does not. */
  intent?: BedsideLayoutIntent | undefined;
}): ResolvedLayout {
  const seed = deriveLayoutVariationSeed(input.seedInput);
  const bounds = input.supportBounds ?? ED_STRETCHER_DECK_BOUNDS;
  // One byte of the digest picks which side is tried first. Stable for a given seed, different
  // across indices, and never a random choice at call time.
  const sideFirst =
    Number.parseInt(seed.slice(0, 2), 16) % 2 === 0 ? "patient_right" : "patient_left";
  const seedOrderedSides =
    sideFirst === "patient_right"
      ? (["patient_right", "patient_left"] as const)
      : (["patient_left", "patient_right"] as const);
  // Explicit intent replaces the seed's exploration. A failure below then reports the authored
  // target as unsatisfied instead of handing back the other side.
  const sides = input.intent?.approachSide ? [input.intent.approachSide] : seedOrderedSides;
  const standoffs =
    input.intent?.standoffMeters === undefined
      ? STANDOFF_CANDIDATES_METERS
      : [input.intent.standoffMeters];

  const unsatisfied: Array<{ approachSide: string; standoffMeters: number; reason: string }> = [];
  for (const approachSide of sides) {
    for (const standoffMeters of standoffs) {
      const target = bedsideTargetForClinician({
        patientPosition: input.patientPosition,
        supportBounds: bounds,
        approachSide,
        standoffMeters,
      });
      const violations = bedsideClearanceViolations({
        standingPosition: target.position,
        obstacles: input.obstacles,
      });
      if (violations.length === 0) {
        return { resolved: true, seed, target, approachSide, standoffMeters };
      }
      unsatisfied.push({
        approachSide,
        standoffMeters,
        reason: violations.map((violation) => violation.reason).join("; "),
      });
    }
  }
  return { resolved: false, seed, unsatisfied };
}
