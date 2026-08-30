/**
 * THE CANONICAL DETERMINISTIC SEED — the single derivation for the program, every primitive and the
 * compiled clip.
 *
 * Card tsk_89fca85c7700ae13 (canonical deterministic seed refile). Brief §13 demands a seed
 * generated from STABLE inputs — never a caller-chosen integer, never a wall clock. M1's planner
 * derived its plan seed from scenario rows, which satisfies §13's letter but was a per-module
 * material, not the compile identity: the keystone's `compileIdentity` block names FIVE inputs
 * (motionProgramHash, skeletonProfileHash, compilerVersion, primitiveLibraryVersion, variationIndex)
 * beside the deterministicSeed it records, and the contact plant defers the general derivation to
 * this card. This module is the freeze: ONE canonical hashing of those five, consumed by the
 * program compiler (program/compile-scenario-motion.ts) and, through `deterministicCompileIdentity`
 * there, by the compile entry's identity block.
 *
 * ## WHY THE REFUSALS ARE PART OF THE CONTRACT, NOT POLISH
 *
 * A "deterministic" derivation that accepted whatever it was handed would let a caller smuggle
 * `Date.now()` or `Math.random()` through a slot nobody checked, and the determinism claim would
 * hold only for inputs nobody actually passes. So each slot is validated to a shape only a stable
 * value has:
 *
 *   - `motionProgramHash` / `skeletonProfileHash`: exactly a 64-char lowercase sha256 hex digest.
 *     A wall-clock timestamp (13 digits), a random fraction, or a prose string is refused.
 *   - `compilerVersion` / `primitiveLibraryVersion`: a non-empty version token over
 *     `[A-Za-z0-9._-]`. A timestamp with spaces or colons, or prose, is refused.
 *   - `variationIndex`: a non-negative integer. A `Math.random()` float, `NaN`, a negative index
 *     or `Infinity` is refused.
 *
 * ## THE PLAN-TIME CONVENTION (declared here, owned by the seed contract)
 *
 * The planner has no skeleton — the IR's header says "no SkeletonProfile ownership on this side of
 * the boundary" — so a plan compiled before any rig is bound cannot supply a real
 * `skeletonProfileHash`. `compileScenarioMotion` fills that slot with the program's OWN canonical
 * hash: the only canonical digest the plan possesses, and the plan's declaration that no rig is yet
 * bound. The moment a real rig hash is supplied the seed changes, which is the property clause (2)
 * of the seed plant measures.
 *
 * Determinism is a property of the function, not of caching: two calls with identical inputs return
 * byte-identical seeds because the material is a pure function of the five validated inputs and
 * `createHash` is deterministic.
 */

import { createHash } from "node:crypto";

export const DETERMINISTIC_SEED_SCHEME = "openclinxr.deterministic-seed.v1";

/** A canonical hash slot: exactly a 64-char lowercase sha256 hex digest. */
export const HASH_DIGEST = /^[0-9a-f]{64}$/;

/** A version token: non-empty, no whitespace, no punctuation beyond `. _ -`. */
export const VERSION_TOKEN = /^[A-Za-z0-9._-]+$/;

export type DeterministicSeedInput = {
  motionProgramHash: string;
  skeletonProfileHash: string;
  compilerVersion: string;
  primitiveLibraryVersion: string;
  /** Non-negative integer. Distinguishes reproducible variation streams of one compile. */
  variationIndex: number;
};

export function isValidDeterministicSeedInput(input: DeterministicSeedInput): boolean {
  return (
    HASH_DIGEST.test(input.motionProgramHash)
    && HASH_DIGEST.test(input.skeletonProfileHash)
    && VERSION_TOKEN.test(input.compilerVersion)
    && VERSION_TOKEN.test(input.primitiveLibraryVersion)
    && Number.isInteger(input.variationIndex)
    && input.variationIndex >= 0
  );
}

/**
 * The canonical five-input seed. sha256 over the scheme and the five inputs in the card's order, so
 * the material is stable across call sites and changing any one input changes the digest.
 *
 * Refuses non-canonical slots (see header) — a wall-clock or random value cannot occupy a hash,
 * version or index slot.
 */
export function deriveDeterministicVariationSeed(input: DeterministicSeedInput): string {
  const { motionProgramHash, skeletonProfileHash, compilerVersion, primitiveLibraryVersion, variationIndex } = input;

  if (!HASH_DIGEST.test(motionProgramHash)) {
    throw new Error(
      `deriveDeterministicVariationSeed: motionProgramHash must be a 64-char lowercase sha256 hex digest, got ${JSON.stringify(motionProgramHash)} — a wall-clock or random value cannot occupy a canonical hash slot`,
    );
  }
  if (!HASH_DIGEST.test(skeletonProfileHash)) {
    throw new Error(
      `deriveDeterministicVariationSeed: skeletonProfileHash must be a 64-char lowercase sha256 hex digest, got ${JSON.stringify(skeletonProfileHash)}`,
    );
  }
  if (!VERSION_TOKEN.test(compilerVersion)) {
    throw new Error(
      `deriveDeterministicVariationSeed: compilerVersion must be a non-empty version token [A-Za-z0-9._-], got ${JSON.stringify(compilerVersion)}`,
    );
  }
  if (!VERSION_TOKEN.test(primitiveLibraryVersion)) {
    throw new Error(
      `deriveDeterministicVariationSeed: primitiveLibraryVersion must be a non-empty version token [A-Za-z0-9._-], got ${JSON.stringify(primitiveLibraryVersion)}`,
    );
  }
  if (!Number.isInteger(variationIndex) || variationIndex < 0) {
    throw new Error(
      `deriveDeterministicVariationSeed: variationIndex must be a non-negative integer, got ${String(variationIndex)}`,
    );
  }

  const material = [
    DETERMINISTIC_SEED_SCHEME,
    motionProgramHash,
    skeletonProfileHash,
    compilerVersion,
    primitiveLibraryVersion,
    String(variationIndex),
  ].join("::");
  return createHash("sha256").update(material).digest("hex");
}
