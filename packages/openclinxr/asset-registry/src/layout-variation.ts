import { createHash } from "node:crypto";
import type { MeasuredObstacle } from "./bedside-clearance.js";
import type { SupportBounds, Vector3 } from "./bedside-target.js";
import {
  type BedsideLayoutIntent,
  type ResolvedLayout,
  resolveBedsideLayoutFromSeed,
} from "./layout-solve.js";

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

const LAYOUT_SEED_SCHEME = "openclinxr.layout-variation-seed.v1";
const VERSION_TOKEN = /^[A-Za-z0-9._-]+$/u;

type LayoutSeedInput = {
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
function isValidLayoutSeedInput(input: LayoutSeedInput): boolean {
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

/**
 * Re-exported from the browser-safe half so node callers keep one import site.
 *
 * The TYPES and the candidate search live in `layout-solve.ts`, which imports no `node:` builtin.
 * Only the SEED DERIVATION stays here, because it hashes. See that module's header for why the
 * split is the replay contract rather than a packaging convenience.
 */
/**
 * Derive this variation's seed, then resolve the layout against measured geometry.
 *
 * This is the NODE entry point: it hashes. A browser reopening a frozen encounter calls
 * `resolveBedsideLayoutFromSeed` with the seed this function recorded, which is the same search
 * over the same candidates with no `node:crypto` in its graph.
 */
export function resolveBedsideLayout(input: {
  seedInput: LayoutSeedInput;
  patientPosition: Vector3;
  supportBounds?: SupportBounds | undefined;
  obstacles: readonly MeasuredObstacle[];
  /** Authored intent. Absent means the seed explores; present means it does not. */
  intent?: BedsideLayoutIntent | undefined;
}): ResolvedLayout {
  return resolveBedsideLayoutFromSeed({
    seed: deriveLayoutVariationSeed(input.seedInput),
    patientPosition: input.patientPosition,
    ...(input.supportBounds === undefined ? {} : { supportBounds: input.supportBounds }),
    obstacles: input.obstacles,
    ...(input.intent === undefined ? {} : { intent: input.intent }),
  });
}
