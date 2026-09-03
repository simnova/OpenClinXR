import { describe, expect, it } from "vitest";

import {
  MOTION_REGION_GUARD_RLQ,
} from "./plant-motion-regions.js";

/**
 * ============================ DIAGNOSIS (IMMUTABLE) ============================
 *
 * OBSERVABLE: the seed is DERIVED everywhere and CANONICAL nowhere. Card tsk_89fca85c7700ae13
 * (canonical deterministic seed refile, "A-grade final"). Brief §13 demands a seed generated from
 * STABLE inputs — `SHA256(scenarioId + actorId + primitiveId + motionProgramVersion +
 * variationIndex)` — never a caller-chosen integer, never a wall clock. What the tree actually has:
 *
 *   - M1's planner derives a PLAN seed over scenario rows — `deriveDeterministicSeed` in
 *     program/compile-scenario-motion.ts:100-116 hashes
 *     `[schemaVersion, scenarioId, actorId, posture, supportSurface ?? "none", rows].join("::")`.
 *     That satisfies §13's letter but is a DIFFERENT material on every call site, and it is not the
 *     compile identity the keystone names.
 *   - The keystone freezes the clip's identity block
 *     (the-canonical-compile-entry-orchestrates-primitives.test.ts:73-78) as FIVE inputs plus the
 *     recorded seed: `compileIdentity: { compilerVersion, primitiveLibraryVersion, variationIndex,
 *     deterministicSeed }` beside `source.motionProgramHash` and `targetRig.skeletonProfileHash`.
 *     The five are named; nothing derives the recorded seed from them.
 *   - `PrimitiveRequest.seed` is already a string (canonical-motion-contract.ts:220) and the four
 *     M4 primitives consume it through `seededScale`, so the forwarding seam exists and is unowned:
 *     nothing FREEZES which string travels it.
 *   - The contact plant defers the general derivation to this card, verbatim:
 *     the-contact-constraint-holds-across-its-window.test.ts:438-441 — "A multi-action program will
 *     need per-action seed derivation before this comparison generalises, and that belongs to the
 *     stable-identity card, not here."
 *
 * MEASURED 2026-08-30 on this tree: `deriveDeterministicSeed` is referenced by exactly one module
 * (its own); no source outside program/compile-scenario-motion.ts imports it. The keystone's
 * `compileIdentity` fields exist in exactly one place — the keystone's own structural type. Nothing
 * produces the five-input identity string.
 *
 * THIS CARD'S FREEZE. `trajectory/deterministic-variation.ts` is the single canonical derivation of
 * the five-input seed: sha256 over the scheme and the five inputs in fixed order. The plan compiler
 * routes its `MotionProgram.deterministicSeed` through it, `deterministicCompileIdentity` returns
 * the exact `compileIdentity` block the keystone clip carries, and the M4 primitives are driven by
 * the very string the derivation produces — the counterweight for "forwarded" is that a one-input
 * change in the derivation MOVES the primitives.
 *
 * THE PLAN-TIME CONVENTION, DECLARED HERE BECAUSE THE IR FORBIDS THE ALTERNATIVE. The planner has
 * no skeleton (motion-program.ts header: "no SkeletonProfile ownership on this side of the
 * boundary"), so a plan compiled before any rig is bound cannot supply a real `skeletonProfileHash`.
 * The seed is still the canonical five-input derivation, with the skeleton slot filled by the
 * program's OWN canonical hash — the only canonical digest the plan possesses, and the plan's
 * declaration that no rig is yet bound. The moment a rig hash IS supplied, the seed changes; the
 * planner plant (the-planner-emits-a-validated-motion-program.test.ts:372-375) requires only that a
 * seed exists and is stable across two calls, which this preserves.
 *
 * ## WHAT THESE CLAUSES CANNOT SEE
 *
 * - The compile entry itself: `compile-motion-program.js` is a SIBLING RED (the keystone), not this
 *   card's module. Clause (4) pins the identity block the entry consumes and the seed the
 *   primitives receive; it does not compile a clip through the absent entry.
 * - `guard_body_region`: M2's slot is a placeholder that emits no tracks, so it has no motion to
 *   vary. The seed-sensitivity half of clause (4) runs on the four M4 primitives that actually
 *   consume `request.seed`.
 * - Whether the seed variation is well-DISTRIBUTED: sensitivity across one input change is proof of
 *   forwarding, not of range or uniformity.
 * - notEvidenceFor: clinical_validity, scoring_validity, production_asset_readiness,
 *   quest_readiness, animation quality.
 *
 * Diagnosis header IMMUTABLE. Flip `planted` to `it` and append a `## FIXED (tsk_89fca85c7700ae13)`
 * block BELOW this; do not rewrite the paths or the numbers above it.
 * ==============================================================================
 */

/**
 * ## FIXED (tsk_89fca85c7700ae13) — clauses (1) through (4) are now live `it` tests.
 *
 * The canonical seed derivation landed:
 *
 *   - src/trajectory/deterministic-variation.ts     `deriveDeterministicVariationSeed`: sha256 over
 *     the scheme and the five inputs in the card's order, refusing wall-clock/random shapes (a
 *     hash slot that is not a 64-hex digest, a version slot that is not a version token, an index
 *     that is not a non-negative integer).
 *   - src/program/compile-scenario-motion.ts        `canonicalMotionProgramHash` (canonical
 *     key-sorted JSON, seed excluded so the derivation is not self-referential),
 *     `deterministicCompileIdentity` (the keystone's compileIdentity block, field for field),
 *     and `compileScenarioMotion` now derives `deterministicSeed` through the canonical helper —
 *     with the documented plan-time convention: no rig bound yet, the skeleton slot is the
 *     program's own hash; the moment a real `skeletonProfileHash` is supplied the seed changes.
 *     The old `deriveDeterministicSeed` export (scenario-row material) was removed; nothing in
 *     the tree imported it (measured 2026-08-30).
 *
 * Clause (4) proves the forwarding seam: the program's seed, the compile identity's seed and the
 * seed handed to each of the four seed-consuming M4 primitives are ONE derived string, and a
 * one-input change to the derivation MOVES the primitives. The compile entry module itself
 * (`compile-motion-program.js`) remains a sibling RED; this card pins the block it consumes.
 */

/**
 * ## FIXED (tsk_af3b9374e8b97632) — one package, two policies: clause (5) contracts the chosen one.
 *
 * region-anchors.ts REFUSES a missing landmark ("refused, not defaulted", region-anchors.ts:148)
 * and deterministic-variation.ts validates every seed slot strictly, but the seed path substituted
 * the program's own hash when `skeletonProfileHash` was undefined through an anonymous `??` inside
 * a private helper — a silent default under no contract at the compile surface.
 *
 * The chosen policy, DECLARED in the module that enacts it: the plan-time absence is a real state —
 * the shipped baseline planner is structurally rig-less (motion-program.ts: "no SkeletonProfile
 * ownership on this side of the boundary") and its callers pass no hash, measured on this tree:
 * deterministic-scenario-motion-planner.ts:32 forwards caller input without a hash and the live
 * planner clauses call `planMotionProgram({scenarioId, actorId, touchResponses})` with none. So a
 * compile with `skeletonProfileHash` omitted is the plan saying no rig is bound yet, and the seed's
 * skeleton slot is filled by the program's OWN canonical hash — the only canonical digest the plan
 * possesses. What is no longer silent: the decision is an exported, named, single-homed function
 * (`resolveSeedSkeletonSlotHash` in program/compile-scenario-motion.ts), and a slot value that IS
 * present but is not a canonical digest is REFUSED at the compile surface with the package's
 * refusing vocabulary — never defaulted. The rig-bound surface (`deterministicCompileIdentity`)
 * already requires a real hash, so an absent hash there is refused by construction.
 *
 * Clause (5) proves the declared-absence compile still succeeds (the counterweight: a fix that
 * throws on every absent hash breaks the plan-time path this convention exists to serve).
 */

/** Resolve to an ABSOLUTE url before the deferred import — see the sibling plants. */
function plantModule(specifier: string): string {
  return new URL(specifier, import.meta.url).href;
}

const VARIATION_SPEC = "./trajectory/deterministic-variation.js";
const COMPILER_SPEC = "./program/compile-scenario-motion.js";
const REGISTRY_SPEC = "./primitive-registry.js";

type DeterministicSeedInput = {
  motionProgramHash: string;
  skeletonProfileHash: string;
  compilerVersion: string;
  primitiveLibraryVersion: string;
  variationIndex: number;
};

type VariationModule = {
  deriveDeterministicVariationSeed: (input: DeterministicSeedInput) => string;
  DETERMINISTIC_SEED_SCHEME: string;
};

type DeterministicCompileIdentity = {
  compilerVersion: string;
  primitiveLibraryVersion: string;
  variationIndex: number;
  deterministicSeed: string;
};

type MotionProgramLike = {
  deterministicSeed: string | number;
  schemaVersion: string;
  scenarioId: string;
  actorId: string;
};

type CompilerModule = {
  compileScenarioMotion: (input: {
    scenarioId: string;
    actorId: string;
    touchResponses: readonly unknown[];
    placement?: { supportSurface?: string };
    skeletonProfileHash?: string;
    variationIndex?: number;
  }) => MotionProgramLike;
  canonicalMotionProgramHash: (program: MotionProgramLike) => string;
  resolveSeedSkeletonSlotHash: (programHash: string, skeletonProfileHash: string | undefined) => string;
  deterministicCompileIdentity: (args: {
    program: MotionProgramLike;
    skeletonProfileHash: string;
    variationIndex?: number;
  }) => DeterministicCompileIdentity;
  MOTION_COMPILER_VERSION: string;
  PRIMITIVE_LIBRARY_VERSION: string;
};

type PrimitiveRequest = {
  action: unknown;
  skeletonProfile: unknown;
  seed: string;
};

type CompiledMotionFragment = { actionId: string; tracks: readonly unknown[] };

type RegistryModule = {
  resolvePrimitive: (id: string) => { compile: (r: PrimitiveRequest) => CompiledMotionFragment } | undefined;
  PRIMITIVE_IDS: readonly string[];
};

const loadVariation = async (): Promise<VariationModule> =>
  (await import(/* @vite-ignore */ plantModule(VARIATION_SPEC))) as VariationModule;

const loadCompiler = async (): Promise<CompilerModule> =>
  (await import(/* @vite-ignore */ plantModule(COMPILER_SPEC))) as CompilerModule;

const loadRegistry = async (): Promise<RegistryModule> =>
  (await import(/* @vite-ignore */ plantModule(REGISTRY_SPEC))) as RegistryModule;

/** The four M4 primitives that consume `request.seed` through the trajectory layer. */
const SEED_CONSUMING_PRIMITIVES = [
  "clutch_body_region",
  "reach_target",
  "look_at",
  "cough_recoil",
] as const;

/** A canonical fixed five. Any change to one field is clause (2)'s material. */
const FIVE: DeterministicSeedInput = {
  motionProgramHash: "a".repeat(64),
  skeletonProfileHash: "b".repeat(64),
  compilerVersion: "openclinxr.motion-compiler.v1",
  primitiveLibraryVersion: "openclinxr.primitive-library.v1",
  variationIndex: 0,
};

const HEX64 = /^[0-9a-f]{64}$/;

describe("the seed is derived from five case inputs", () => {
  it("(1) RED: the same five inputs yield the same seed — a pure function, not a call to a clock", async () => {
    // A seed minted from Date.now() or Math.random() fails here on the SECOND call even if the
    // first call works, which is the entire point of the clause.
    const { deriveDeterministicVariationSeed } = await loadVariation();

    const first = deriveDeterministicVariationSeed(FIVE);
    const second = deriveDeterministicVariationSeed({ ...FIVE });

    expect(typeof first, "the derivation must return a string").toBe("string");
    expect(first.length, "the derived seed is empty — a seed that cannot seed is not a seed").toBeGreaterThan(0);
    expect(HEX64.test(first), `the derived seed is not a canonical hex digest: ${first}`).toBe(true);
    expect(second, "the same five inputs produced a different seed — the derivation is reading something besides its input").toBe(first);
  });

  it("(2) RED: independently changing EACH input changes the seed — including only skeletonProfileHash", async () => {
    // Five independent mutations. The middle row is the one the card exists for: the M1b deriver
    // landed `rigFingerprint`, and the compile identity distinguishes `skeletonProfileHash` from it
    // — a derivation that ignores the profile hash would make every rig compile one motion.
    const { deriveDeterministicVariationSeed } = await loadVariation();

    const base = deriveDeterministicVariationSeed(FIVE);
    const mutations: { label: string; input: DeterministicSeedInput }[] = [
      { label: "motionProgramHash", input: { ...FIVE, motionProgramHash: "c".repeat(64) } },
      { label: "skeletonProfileHash", input: { ...FIVE, skeletonProfileHash: "d".repeat(64) } },
      { label: "compilerVersion", input: { ...FIVE, compilerVersion: "openclinxr.motion-compiler.v2" } },
      { label: "primitiveLibraryVersion", input: { ...FIVE, primitiveLibraryVersion: "openclinxr.primitive-library.v2" } },
      { label: "variationIndex", input: { ...FIVE, variationIndex: 1 } },
    ];

    for (const { label, input } of mutations) {
      const moved = deriveDeterministicVariationSeed(input);
      expect(
        moved,
        `changing only ${label} left the seed unchanged — that input is not part of the canonical material`,
      ).not.toBe(base);
      expect(HEX64.test(moved), `the mutated derivation produced a non-canonical seed: ${moved}`).toBe(true);
    }
  });

  it("(3) RED: wall-clock and random values are REFUSED, never coerced", async () => {
    // The counterweight to (1): a derivation that is "deterministic" by ignoring bad inputs would
    // pass (1) and (2) while letting a caller smuggle Date.now() in through a slot nobody checks.
    // Every refusal here is a concrete wall-clock or random shape the factory must not accept.
    const { deriveDeterministicVariationSeed } = await loadVariation();

    const badHashes = [
      String(Date.now()),                 // a wall-clock timestamp: 13 digits, not a 64-hex digest
      `${Math.random().toString(16)}`,    // a random fraction, never a full digest
      "not-a-hash",
      "",
      "A".repeat(64),                     // not lowercase — a digest is lowercase hex by convention
    ];
    for (const motionProgramHash of badHashes) {
      expect(
        () => deriveDeterministicVariationSeed({ ...FIVE, motionProgramHash }),
        `motionProgramHash ${JSON.stringify(motionProgramHash)} was accepted — a wall-clock or random value cannot be a canonical hash slot`,
      ).toThrow(/motionProgramHash/);
      expect(
        () => deriveDeterministicVariationSeed({ ...FIVE, skeletonProfileHash: motionProgramHash }),
        `skeletonProfileHash ${JSON.stringify(motionProgramHash)} was accepted — the rig slot must be a canonical digest`,
      ).toThrow(/skeletonProfileHash/);
    }

    const badVersions = ["", "2026-08-30 22:18:41", "v1.2.3 ", "build#17", "release candidate"];
    for (const bad of badVersions) {
      expect(
        () => deriveDeterministicVariationSeed({ ...FIVE, compilerVersion: bad }),
        `compilerVersion ${JSON.stringify(bad)} was accepted — a timestamp or prose is not a version token`,
      ).toThrow(/compilerVersion/);
      expect(
        () => deriveDeterministicVariationSeed({ ...FIVE, primitiveLibraryVersion: bad }),
        `primitiveLibraryVersion ${JSON.stringify(bad)} was accepted`,
      ).toThrow(/primitiveLibraryVersion/);
    }

    const badIndices = [Math.random() * 10, NaN, -1, 1.5, Infinity];
    for (const variationIndex of badIndices) {
      expect(
        () => deriveDeterministicVariationSeed({ ...FIVE, variationIndex }),
        `variationIndex ${String(variationIndex)} was accepted — a random fraction, NaN or negative index is not a stable variation`,
      ).toThrow(/variationIndex/);
    }
  });

  it("(4) RED: the SAME derived string reaches the program, every primitive and the compiled clip", async () => {
    // The forwarding half. The compile entry (`compile-motion-program.js`) is a sibling RED, so the
    // recorded identity is pinned through `deterministicCompileIdentity` — the block the keystone
    // clip carries — and the primitives' motion is driven by the very string that block records.
    const variation = await loadVariation();
    const compiler = await loadCompiler();

    const mod = (await import("../../scenario-fixtures/src/adult-abdominal-pain.js")) as Record<string, unknown>;
    const scenario = mod["adultAbdominalPainScenario"] as {
      scenarioId: string;
      actors: { actorId: string; bodyMechanics?: { touchResponses?: { region: string; responseKind: string; forceThreshold: number; emotionEventId: string; emotion: string; responseClip: string; dialogueLine: string; traceTag: string }[] } }[];
    };
    const actor = scenario.actors.find((a) => (a.bodyMechanics?.touchResponses ?? []).length > 0);
    if (!actor) throw new Error("fixture no longer authors any bodyMechanics.touchResponses row");
    const row = (actor.bodyMechanics?.touchResponses ?? []).find(
      (r) => r.region === "abdomen_rlq" && r.responseKind === "guarding",
    );
    if (!row) throw new Error("fixture no longer authors the abdomen_rlq guarding row this clause reads");

    const rigHash = "e".repeat(64);

    // A program compiled WITH a rig hash carries the canonical five-input derivation as its seed.
    const program = compiler.compileScenarioMotion({
      scenarioId: scenario.scenarioId,
      actorId: actor.actorId,
      touchResponses: [row],
      skeletonProfileHash: rigHash,
    });
    const programHash = compiler.canonicalMotionProgramHash(program);
    const derived = variation.deriveDeterministicVariationSeed({
      motionProgramHash: programHash,
      skeletonProfileHash: rigHash,
      compilerVersion: compiler.MOTION_COMPILER_VERSION,
      primitiveLibraryVersion: compiler.PRIMITIVE_LIBRARY_VERSION,
      variationIndex: 0,
    });
    expect(
      program.deterministicSeed,
      "the MotionProgram's deterministicSeed is not the canonical five-input derivation",
    ).toBe(derived);

    // The clip's identity block records that SAME string, byte for byte.
    const identity = compiler.deterministicCompileIdentity({ program, skeletonProfileHash: rigHash });
    expect(identity.compilerVersion, "the compile identity does not record the compiler version").toBe(compiler.MOTION_COMPILER_VERSION);
    expect(identity.primitiveLibraryVersion, "the compile identity does not record the primitive library version").toBe(
      compiler.PRIMITIVE_LIBRARY_VERSION,
    );
    expect(identity.variationIndex, "the compile identity does not record the variation index").toBe(0);
    expect(
      identity.deterministicSeed,
      "the compile identity does not record the seed the derivation produced",
    ).toBe(derived);

    // A plan compiled BEFORE any rig is bound is the shipped-case path. Its seed is still the
    // canonical derivation, with the skeleton slot filled by the program's OWN hash — the plan's
    // declaration that no rig is bound (see the diagnosis header).
    const plan = compiler.compileScenarioMotion({ scenarioId: scenario.scenarioId, actorId: actor.actorId, touchResponses: [row] });
    const planHash = compiler.canonicalMotionProgramHash(plan);
    expect(
      plan.deterministicSeed,
      "the no-rig plan seed is not the canonical derivation over the program's own hash in the skeleton slot",
    ).toBe(
      variation.deriveDeterministicVariationSeed({
        motionProgramHash: planHash,
        skeletonProfileHash: planHash,
        compilerVersion: compiler.MOTION_COMPILER_VERSION,
        primitiveLibraryVersion: compiler.PRIMITIVE_LIBRARY_VERSION,
        variationIndex: 0,
      }),
    );

    // FORWARDED: each seed-consuming primitive is driven by the derived string. Reproducible under
    // it, and MOVED by a one-input change to it — the "forwarded, not decoy" half.
    const registry = await loadRegistry();
    const request = (id: string, seed: string): PrimitiveRequest => ({
      action: {
        actionId: `action_${id}`,
        primitiveId: id,
        trigger: { kind: "clinical_touch", ref: "clinical_touch_guard_abdomen_rlq" },
        timing: { durationMs: 900 },
        intensity: 0.6,
        target: { kind: "body_region", id: MOTION_REGION_GUARD_RLQ },
        effector: "handR",
        constraints: [
          {
            kind: "contact",
            effector: "handR",
            target: { kind: "body_region", id: MOTION_REGION_GUARD_RLQ },
            positionToleranceMeters: 0.03,
            startFraction: 0.4,
            endFraction: 0.72,
            preserveWhileActive: true,
          },
        ],
      },
      skeletonProfile: {
        rigFingerprint: "rig-fp-seed-fixture",
        effectorBone: "handR",
        joints: [
          { boneName: "upper_armR", bindLocalPosition: { x: 0.18, y: 1.38, z: 0 }, bindLocalQuaternion: { x: 0, y: 0, z: 0, w: 1 } },
          { boneName: "forearmR", parentBoneName: "upper_armR", bindLocalPosition: { x: 0, y: -0.28, z: 0 }, bindLocalQuaternion: { x: 0, y: 0, z: 0, w: 1 } },
          { boneName: "handR", parentBoneName: "forearmR", bindLocalPosition: { x: 0, y: -0.26, z: 0 }, bindLocalQuaternion: { x: 0, y: 0, z: 0, w: 1 } },
        ],
      },
      seed,
    });
    const canonical = (fragment: CompiledMotionFragment): string =>
      JSON.stringify(
        [...fragment.tracks]
          .sort((a, b) => `${(a as { boneName: string }).boneName}::${(a as { property: string }).property}`.localeCompare(`${(b as { boneName: string }).boneName}::${(b as { property: string }).property}`))
          .map((t) => [t as { boneName: string; property: string; times: unknown[]; values: unknown[] }]),
      );

    for (const id of SEED_CONSUMING_PRIMITIVES) {
      const primitive = registry.resolvePrimitive(id);
      expect(primitive, `registry did not resolve "${id}"`).toBeDefined();

      const underSeed = primitive!.compile(request(id, derived));
      expect(
        canonical(underSeed),
        `"${id}" is not reproducible under the derived seed — the derived string does not name its motion`,
      ).toBe(canonical(primitive!.compile(request(id, derived))));

      const oneInputMoved = variation.deriveDeterministicVariationSeed({
        motionProgramHash: programHash,
        skeletonProfileHash: "f".repeat(64), // only the rig slot changes
        compilerVersion: compiler.MOTION_COMPILER_VERSION,
        primitiveLibraryVersion: compiler.PRIMITIVE_LIBRARY_VERSION,
        variationIndex: 0,
      });
      expect(
        canonical(underSeed),
        `"${id}" produced the same motion under a one-input-different derived seed — the recorded string is a decoy, not the driver`,
      ).not.toBe(canonical(primitive!.compile(request(id, oneInputMoved))));
    }
  });

  it("(5) RED: a missing rig hash is the DECLARED plan-time state — never a silent default, and a non-canonical slot is refused", async () => {
    // One package, two policies (card tsk_af3b9374e8b97632): region-anchors REFUSES a missing
    // input ("refused, not defaulted"), while the seed path used to substitute the program's own
    // hash through an anonymous `??` in a private helper — a silent default under no contract.
    // The chosen policy keeps the plan-time substitution (the shipped baseline planner is
    // structurally rig-less and relies on omitting the hash) but makes it a NAMED, single-homed
    // decision at the compile surface, and refuses a slot that is present but not canonical.
    const { deriveDeterministicVariationSeed } = await loadVariation();
    const compiler = await loadCompiler();

    const row = {
      region: "abdomen_rlq",
      responseKind: "guarding",
      forceThreshold: 0.28,
      emotionEventId: "guard_rlq_v1",
      emotion: "pain",
      responseClip: "openclinxr_role_patient_guard_withdraw_rlq",
      dialogueLine: "test line",
      traceTag: "clinical_touch_guard_rlq",
    };
    const scenarioId = "adult_abdominal_pain_v1";
    const actorId = "patient_elena_vasquez_v1";

    // The declared-absence compile still succeeds — the counterweight. Omission is the plan-time
    // declaration, and the named slot decision maps it to the program's own canonical hash.
    const plan = compiler.compileScenarioMotion({ scenarioId, actorId, touchResponses: [row] });
    const planHash = compiler.canonicalMotionProgramHash(plan);
    expect(compiler.resolveSeedSkeletonSlotHash(planHash, undefined), "an omitted rig hash must resolve to the program's own hash — the plan-time declaration").toBe(planHash);
    expect(plan.deterministicSeed, "the plan-time compile no longer derives through the declared slot policy").toBe(
      deriveDeterministicVariationSeed({
        motionProgramHash: planHash,
        skeletonProfileHash: planHash,
        compilerVersion: compiler.MOTION_COMPILER_VERSION,
        primitiveLibraryVersion: compiler.PRIMITIVE_LIBRARY_VERSION,
        variationIndex: 0,
      }),
    );

    // A REAL rig hash is used as-is — the substitution is ONLY the plan-time declaration, never a
    // default for a bound compile. The moment a rig hash is supplied, the seed changes.
    const rigHash = "e".repeat(64);
    const bound = compiler.compileScenarioMotion({ scenarioId, actorId, touchResponses: [row], skeletonProfileHash: rigHash });
    expect(compiler.resolveSeedSkeletonSlotHash(planHash, rigHash), "a canonical rig hash must fill the skeleton slot unchanged").toBe(rigHash);
    expect(
      bound.deterministicSeed,
      "a rig-bound compile must NOT carry the plan-time seed — the absent-hash substitution is not a default",
    ).toBe(
      deriveDeterministicVariationSeed({
        motionProgramHash: compiler.canonicalMotionProgramHash(bound),
        skeletonProfileHash: rigHash,
        compilerVersion: compiler.MOTION_COMPILER_VERSION,
        primitiveLibraryVersion: compiler.PRIMITIVE_LIBRARY_VERSION,
        variationIndex: 0,
      }),
    );
    expect(bound.deterministicSeed, "a bound compile and the plan-time compile collided on one seed").not.toBe(plan.deterministicSeed);

    // Present but not canonical is REFUSED at the compile surface — "refused, not defaulted",
    // the package's refusing vocabulary (region-anchors.ts:148). A wall-clock or prose value is
    // not a canonical hash slot and must not be defaulted into the seed material.
    for (const bad of ["not-a-digest", String(Date.now()), "A".repeat(64)]) {
      expect(
        () => compiler.resolveSeedSkeletonSlotHash(planHash, bad),
        `skeletonProfileHash ${JSON.stringify(bad)} was defaulted — a non-canonical rig slot must be refused, not defaulted`,
      ).toThrow(/refused, not defaulted/);
      expect(
        () => compiler.compileScenarioMotion({ scenarioId, actorId, touchResponses: [row], skeletonProfileHash: bad }),
        `compileScenarioMotion accepted a non-canonical skeletonProfileHash ${JSON.stringify(bad)} — the compile surface must refuse it`,
      ).toThrow(/refused, not defaulted/);
    }
  });
});
