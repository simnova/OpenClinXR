import { bedsideClearanceViolations, type MeasuredObstacle } from "./bedside-clearance.js";
import {
  type BedsideTarget,
  bedsideTargetForClinician,
  ED_STRETCHER_DECK_BOUNDS,
  type SupportBounds,
  type Vector3,
} from "./bedside-target.js";

/**
 * The BROWSER-SAFE half of deterministic layout variation: the candidate search, given a seed.
 *
 * WHY THE SPLIT EXISTS. `layout-variation.ts` derives the seed with `node:crypto`, which a browser
 * cannot resolve — `asset-registry/src/index.ts:2821` records that a root-reachable `node:` builtin
 * broke the ui-xr bundle twice, most recently on 2026-09-09 when this very module's parent was
 * value-exported from the "." entry. SC-06's required_behavior 4 asks to "keep server-only
 * hashing/generation outside browser entry or provide explicit browser-safe interface", and this is
 * that interface: the SEED arrives as a string, already derived, and nothing here hashes anything.
 *
 * That division is not a workaround, it is the replay contract. A frozen encounter persists its
 * seed; reopening it must reproduce the same layout from that persisted seed WITHOUT re-deriving
 * it, because re-deriving would mean the replay could disagree with the freeze about what the
 * inputs were and still look self-consistent.
 *
 * claimScope: deterministic selection of one bedside side and standoff against measured obstacles.
 * notEvidenceFor: clinical appropriateness of the side, the standoff or the working position.
 */

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
export const STANDOFF_CANDIDATES_METERS = [0.75, 0.9, 1.05] as const;

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

/** A seed is a lowercase hex digest. Rejected here so a caller cannot pass a wall clock. */
export const LAYOUT_SEED_PATTERN = /^[0-9a-f]{64}$/u;

/**
 * Resolve a bedside layout for one already-derived seed, or REFUSE with the constraints that failed.
 *
 * Candidate order comes from the seed, so two variation indices explore the sides in different
 * orders while each stays reproducible. Hard constraints are applied BEFORE ranking: a candidate
 * with any clearance violation is never returned, whatever its rank.
 *
 * On failure it returns every candidate it tried with its reason, rather than falling back to a
 * position that violates something.
 */
export function resolveBedsideLayoutFromSeed(input: {
  seed: string;
  patientPosition: Vector3;
  supportBounds?: SupportBounds | undefined;
  obstacles: readonly MeasuredObstacle[];
  /** Authored intent. Absent means the seed explores; present means it does not. */
  intent?: BedsideLayoutIntent | undefined;
}): ResolvedLayout {
  if (!LAYOUT_SEED_PATTERN.test(input.seed)) {
    throw new Error(
      `resolveBedsideLayoutFromSeed: refused seed ${JSON.stringify(input.seed)}. A seed is the 64-hex `
        + "digest deriveLayoutVariationSeed produces; accepting anything else would let a wall clock or a "
        + "random string choose the layout while the record still called it deterministic.",
    );
  }
  const seed = input.seed;
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
