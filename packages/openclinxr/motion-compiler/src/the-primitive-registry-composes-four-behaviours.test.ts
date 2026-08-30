import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { planted } from "./planted.js";

import {
  violationsInTracks,
  type CompiledMotionFragment,
  type PrimitiveRequest,
} from "./canonical-motion-contract.js";

/**
 * ============================ DIAGNOSIS (IMMUTABLE) ============================
 *
 * OBSERVABLE: `packages/openclinxr/motion-compiler` does not exist. MEASURED
 * 2026-08-29: `ls packages/openclinxr/` returns 27 entries and none is
 * `motion-compiler`; a tree-wide grep for `clutch_body_region`, `cough_recoil`,
 * `reach_target`, `minimumJerk` and `min_jerk` across *.ts / *.py / *.json / *.md
 * (node_modules excluded) returns ZERO hits. There is no motion primitive layer
 * and no trajectory layer. This is greenfield, not a regression.
 *
 * BothyBoard tsk_eed004e50d19be54 (M4) asks for four primitives —
 * clutch_body_region, reach_target, look_at, cough_recoil — on a shared IK
 * foundation, with minimum-jerk approach/hold/release trajectories and SEEDED
 * deterministic variation.
 *
 * ---------------------------------------------------------------------------
 * CLAUSE 2'S SECOND HALF IS THE LOAD-BEARING ASSERTION IN THIS FILE.
 * ---------------------------------------------------------------------------
 * A variation system that accepts a seed and then ignores it passes every
 * cheap proof anyone would reach for. It passes "compile returns a clip". It
 * passes "the same seed produces the same output" TRIVIALLY AND VACUOUSLY —
 * a constant function is the most deterministic function there is. The only
 * clause that can tell a seeded generator apart from a hardcoded one is
 * `differentSeed => differentOutput`. If a future edit ever weakens clause 2,
 * it is that half that must survive; deleting it converts the determinism
 * contract into a tautology and the seed parameter into decoration.
 *
 * The same asymmetry governs clause 1. "Each primitive returns a clip" is
 * satisfied by one parameterised blob that stamps a different `primitiveId`
 * onto identical channel data, so clause 1 compares CHANNEL CONTENT with the
 * id field excluded, pairwise across all six pairs.
 *
 * THRESHOLD PROVENANCE (derived, not fitted — no number here was chosen after
 * seeing an implementation, because no implementation exists):
 *   1.875 = 15/8. Analytic peak-to-mean velocity ratio of the minimum-jerk
 *   quintic x(t) = 10t^3 - 15t^4 + 6t^5, whose derivative 30t^2(1-t)^2 has its
 *   maximum 1.875 at t = 0.5 against a mean of 1.0 over [0,1]. External
 *   mathematical floor, independent of anything the implementer writes.
 *   It DISCRIMINATES: a raised-cosine ease gives pi/2 ~= 1.5708 and a linear
 *   ramp gives 1.0. Both of those also have zero endpoint velocity and a
 *   mid-motion peak, so endpoint-and-peak assertions ALONE do not identify a
 *   minimum-jerk profile. The ratio is what makes clause 3 bound the SHAPE
 *   rather than two endpoints.
 *
 * KNOWN-GOOD COLUMN: none. Nothing in this repository currently produces a
 * motion clip, a joint channel, or a velocity profile, so there is no in-tree
 * reference to calibrate against. Recorded per contract-design: that absence
 * is a finding, and it is why every threshold below is analytic rather than
 * observed.
 *
 * FIXTURE VALUES ARE ILLUSTRATIVE, NOT SPECIFICATION. The seeds (20260829 /
 * 20260830), the 900 ms duration and the 201-sample count are test inputs
 * chosen to be legible. They are not required constants of the API and must
 * not be copied into the implementation as defaults.
 *
 * WHY THE IMPORTS ARE DYNAMIC AND BUILT FROM A VARIABLE: a static
 * `import ... from "./primitive-registry.js"` of an absent module fails at
 * COLLECTION time, which errors the whole file and would take clause 4 down
 * with clauses 1-3. Clause 4 must pass on arrival and must fail independently,
 * so the module specifiers are runtime strings resolved inside each clause
 * body. PROBED 2026-08-29 against vitest 4.1.5 in this repo: an absent
 * runtime-specifier import yields `1 passed | 1 expected fail` — the it.fails
 * clauses record as expected failures for the right reason (module absent)
 * while an independent clause in the same file still passes.
 *
 * Diagnosis header IMMUTABLE. Do not rewrite these paths or numbers. Flip each
 * `it.fails` to `it` and append a `## FIXED (tsk_eed004e50d19be54)` block below
 * this header.
 * ==============================================================================
 */

const REGISTRY_SPEC = "./primitive-registry.js";
const TRAJECTORY_SPEC = "./trajectory.js";

const PRIMITIVE_IDS = [
  "clutch_body_region",
  "reach_target",
  "look_at",
  "cough_recoil",
] as const;

type PrimitiveId = (typeof PRIMITIVE_IDS)[number];

/**
 * WHAT A PRIMITIVE RETURNS — IMPORTED, not redeclared. Amended 2026-08-30, the OUTPUT half of the
 * seam that was closed on the input half one round earlier.
 *
 * This file declared `{ primitiveId, durationMs, channels: [{ jointPath, times, values: number[] }] }`
 * while the canonical entry expected `{ actionId, tracks }`. Incompatible on four counts at once —
 * channels against tracks, scalar values against canonical tuples, a duration on the fragment against
 * one derived at composition, and primitive attribution against action attribution. A worker here
 * would have produced something `compileMotionProgram` cannot consume without an adapter, which is
 * the original three-signature defect surviving on the return side.
 *
 * Centralising the request and leaving the response is a half-closed seam, and it read as closed.
 */
type MotionClip = CompiledMotionFragment;

/**
 * THE PRIMITIVE REQUEST IS IMPORTED, not redeclared. Amended 2026-08-30 after two reviewers found
 * the same generator: this file declared `CompileRequest` with `skeletonProfile: { rigFingerprint }`
 * while the keystone declared `PrimitiveRequest` with `skeletonProfile: unknown`. Property names
 * agreed and the shapes did not, so a worker here would have built a primitive blind to the joints
 * and bind transforms M2's IK needs — the adapter defect the canonical entry exists to prevent, one
 * layer down, exactly where the last two instances were found.
 *
 * `durationMs` is gone from the request because it lives on `action.timing.durationMs`. Two sources
 * for one number is how they diverge.
 */
type CompileRequest = PrimitiveRequest;

interface MotionPrimitive {
  id: PrimitiveId;
  compile: (request: CompileRequest) => MotionClip;
}


/**
 * Resolve to an ABSOLUTE url before the deferred import. A bare `./x.js` held in a variable is
 * resolved natively, and when the module is absent the native resolver reports a MANGLED path —
 * `/src/primitive-registry.js` — which reads as a broken test rather than the missing module this
 * RED is demanding. See the same note in the sibling plants; one instance of this had M1 red for the
 * wrong reason since d1ad5063.
 */
function plantModule(specifier: string): string {
  return new URL(specifier, import.meta.url).href;
}

/**
 * Builds a canonical CompileRequest. Added 2026-08-30 with the interface amendment so every call
 * site routes through one shape — the thing whose absence let three plants contract three different
 * compile signatures.
 */
function canonicalRequest(id: PrimitiveId, seed: string): CompileRequest {
  return {
    // A COMPLETE action, matching the M1 IR field for field. Anything less here teaches the
    // registry that a projection is acceptable input.
    action: {
      actionId: `action_${id}`,
      primitiveId: id,
      trigger: { kind: "clinical_touch", ref: "clinical_touch_guard_abdomen_rlq" },
      timing: { durationMs: DURATION_MS },
      intensity: 0.6,
      target: { kind: "body_region", id: "guard_abdomen_rlq" },
      effector: "handR",
      // A REAL constraint, for the same reason as the keystone: with [] everywhere, a compiler that
      // replaces constraints with [] preserves the action by accident.
      constraints: [
        {
          kind: "contact",
          effector: "handR",
          target: { kind: "body_region", id: "guard_abdomen_rlq" },
          positionToleranceMeters: 0.03,
          startFraction: 0.4,
          endFraction: 0.72,
          preserveWhileActive: true,
        },
      ],
    },
    // A COMPLETE profile, for the same reason as the action above. When this fixture was
    // `{ rigFingerprint }` alone it taught the registry that a fingerprint is a profile, which is
    // precisely the projection the narrowed `CompileRequest` used to permit at the type level.
    // A primitive that needs joints and bind transforms must find them here.
    skeletonProfile: {
      rigFingerprint: "rig-fp-registry-fixture",
      effectorBone: "handR",
      joints: [
        { boneName: "upper_armR", bindLocalPosition: { x: 0.18, y: 1.38, z: 0 }, bindLocalQuaternion: { x: 0, y: 0, z: 0, w: 1 } },
        { boneName: "forearmR", parentBoneName: "upper_armR", bindLocalPosition: { x: 0, y: -0.28, z: 0 }, bindLocalQuaternion: { x: 0, y: 0, z: 0, w: 1 } },
        { boneName: "handR", parentBoneName: "forearmR", bindLocalPosition: { x: 0, y: -0.26, z: 0 }, bindLocalQuaternion: { x: 0, y: 0, z: 0, w: 1 } },
      ],
    },
    seed,
  };
}

interface PrimitiveRegistryModule {
  resolvePrimitive: (id: string) => MotionPrimitive | undefined;
  PRIMITIVE_IDS: readonly string[];
}

interface TrajectoryModule {
  minimumJerkProfile: (options: { samples: number }) => number[];
}

const loadRegistry = async (): Promise<PrimitiveRegistryModule> =>
  (await import(/* @vite-ignore */ plantModule(REGISTRY_SPEC))) as PrimitiveRegistryModule;

const loadTrajectory = async (): Promise<TrajectoryModule> =>
  (await import(/* @vite-ignore */ plantModule(TRAJECTORY_SPEC))) as TrajectoryModule;

/**
 * Channel-only signature. `primitiveId` is DELIBERATELY EXCLUDED so that a
 * single parameterised implementation which varies nothing but the label
 * cannot satisfy the distinctness clause.
 */
/**
 * Track content only. `actionId` is DELIBERATELY EXCLUDED so a single parameterised implementation
 * that varies nothing but the label cannot satisfy the distinctness clause — the same reason
 * `primitiveId` was excluded from its predecessor.
 */
const channelSignature = (fragment: MotionClip): string =>
  JSON.stringify(
    [...fragment.tracks]
      .sort((a, b) => `${a.boneName}::${a.property}`.localeCompare(`${b.boneName}::${b.property}`))
      .map((track) => [track.boneName, track.property, track.times, track.values]),
  );

/** Full canonical form, used only where byte-identity is the assertion. */
const canonical = (fragment: MotionClip): string =>
  JSON.stringify([fragment.actionId, channelSignature(fragment)]);

const jointSetKey = (fragment: MotionClip): string =>
  [...new Set(fragment.tracks.map((track) => track.boneName))].sort().join("|");

const SEED_A = 20260829;
const SEED_B = 20260830;
const DURATION_MS = 900;

describe("the primitive registry composes four behaviours", () => {
  planted(
    "(1) the registry resolves all four primitives and each produces a motion distinct from the other three",
    async () => {
      const { resolvePrimitive } = await loadRegistry();

      const clips = new Map<PrimitiveId, MotionClip>();
      for (const id of PRIMITIVE_IDS) {
        const primitive = resolvePrimitive(id);
        expect(primitive, `registry did not resolve "${id}"`).toBeDefined();
        const clip = (primitive as MotionPrimitive).compile(canonicalRequest(id, String(SEED_A)));
        expect(
          clip.tracks.length,
          `"${id}" compiled a fragment with no tracks`,
        ).toBeGreaterThan(0);
        // THE SEAM, checked rather than assumed: a fragment the canonical entry cannot consume is
        // not a result, however distinct its content. Same validator the entry applies to its own
        // output.
        expect(
          violationsInTracks(clip.tracks),
          `"${id}" returned tracks the canonical clip contract refuses`,
        ).toEqual([]);
        // Attribution is by ACTION, because one program may carry several actions naming the same
        // primitive and the entry composes fragments back onto the actions that asked for them.
        expect(
          clip.actionId,
          `"${id}" did not attribute its fragment to the action it was given`,
        ).toBe((canonicalRequest(id, String(SEED_A)).action as { actionId: string }).actionId);
        clips.set(id, clip);
      }

      // Pairwise distinctness across all six pairs, on channel content only.
      // A blob that stamps a different primitiveId onto identical channels
      // fails here, which is the point.
      for (let i = 0; i < PRIMITIVE_IDS.length; i += 1) {
        for (let j = i + 1; j < PRIMITIVE_IDS.length; j += 1) {
          const left = PRIMITIVE_IDS[i];
          const right = PRIMITIVE_IDS[j];
          expect(
            channelSignature(clips.get(left!) as MotionClip),
            `"${left}" and "${right}" produced identical channel data; only the primitiveId differs`,
          ).not.toBe(channelSignature(clips.get(right!) as MotionClip));
        }
      }

      // Anti-blob strengthener. Four behaviours this different cannot all drive
      // one identical joint set: look_at is a head/neck orientation, cough_recoil
      // is a torso convulsion, clutch_body_region is an arm-to-torso contact.
      // >= 3 rather than 4 because clutch_body_region and reach_target may
      // LEGITIMATELY share one arm chain — that is the one coincidence this
      // threshold deliberately tolerates.
      const distinctJointSets = new Set(
        [...clips.values()].map((clip) => jointSetKey(clip)),
      );
      expect(
        distinctJointSets.size,
        "all four primitives animate the same joint set; expected at least 3 distinct sets",
      ).toBeGreaterThanOrEqual(3);
    },
  );

  planted(
    "(2) DETERMINISM: one seed reproduces byte-identically AND a different seed produces different motion",
    async () => {
      const { resolvePrimitive } = await loadRegistry();

      for (const id of PRIMITIVE_IDS) {
        const primitive = resolvePrimitive(id);
        expect(primitive, `registry did not resolve "${id}"`).toBeDefined();
        const compile = (seed: number) =>
          (primitive as MotionPrimitive).compile(canonicalRequest(id, String(seed)));

        // HALF ONE — reproducibility. Satisfied trivially by a constant
        // function; necessary but never sufficient.
        expect(
          canonical(compile(SEED_A)),
          `"${id}" is not reproducible under seed ${SEED_A}`,
        ).toBe(canonical(compile(SEED_A)));

        // HALF TWO — THE LOAD-BEARING HALF. This is the only assertion in the
        // file that can distinguish a seeded generator from one that accepts a
        // seed and discards it. Do not delete or weaken it; see the header.
        expect(
          canonical(compile(SEED_A)),
          `"${id}" ignores its seed: ${SEED_A} and ${SEED_B} produced identical motion`,
        ).not.toBe(canonical(compile(SEED_B)));
      }
    },
  );

  planted(
    "(3) the minimum-jerk profile has zero endpoint velocity and a 1.875x mid-motion peak",
    async () => {
      const { minimumJerkProfile } = await loadTrajectory();

      const samples = 201;
      const position = minimumJerkProfile({ samples });
      expect(position.length, "profile returned the wrong sample count").toBe(
        samples,
      );
      expect(position[0]).toBeCloseTo(0, 6);
      expect(position[samples - 1]).toBeCloseTo(1, 6);

      // Velocity by finite difference on the values a consumer actually gets,
      // rather than trusting a separately-exported velocity function.
      const velocity: number[] = [];
      for (let i = 0; i < position.length - 1; i += 1) {
        velocity.push(position[i + 1]! - position[i]!);
      }

      const peak = Math.max(...velocity);
      const mean =
        velocity.reduce((sum, v) => sum + v, 0) / velocity.length;
      expect(peak, "profile is flat; no motion").toBeGreaterThan(0);

      // Endpoints: velocity vanishes at both ends. Expressed relative to the
      // peak so the assertion is scale-free.
      expect(
        velocity[0]! / peak,
        "velocity does not start at rest",
      ).toBeLessThan(0.02);
      expect(
        velocity[velocity.length - 1]! / peak,
        "velocity does not come to rest",
      ).toBeLessThan(0.02);

      // The peak is mid-motion, not front- or back-loaded.
      const peakIndex = velocity.indexOf(peak);
      const midpoint = (velocity.length - 1) / 2;
      expect(
        Math.abs(peakIndex - midpoint) / velocity.length,
        "velocity peak is not at the midpoint",
      ).toBeLessThan(0.02);

      // Unimodal: strictly rising to the peak, strictly falling after. Bars a
      // multi-bump profile whose extremes happen to land in band.
      for (let i = 1; i <= peakIndex; i += 1) {
        expect(
          velocity[i],
          `velocity is not monotonically rising before the peak (index ${i})`,
        ).toBeGreaterThanOrEqual(velocity[i - 1]!);
      }
      for (let i = peakIndex + 1; i < velocity.length; i += 1) {
        expect(
          velocity[i],
          `velocity is not monotonically falling after the peak (index ${i})`,
        ).toBeLessThanOrEqual(velocity[i - 1]!);
      }

      // SHAPE, not endpoints. 1.875 = 15/8, analytic for the minimum-jerk
      // quintic; a raised-cosine ease gives 1.5708 and a linear ramp 1.0, and
      // both would clear every assertion above. See header provenance.
      expect(
        peak / mean,
        "peak-to-mean velocity ratio is not the minimum-jerk 1.875 (cosine ease is 1.571, linear is 1.0)",
      ).toBeCloseTo(1.875, 2);
    },
  );

  planted(
    "(4b) RED: registry resolution binds behaviour, not the primitiveId the request claims",
    async () => {
      // CLAIM NARROWED 2026-08-30, on review, and the narrowing matters.
      //
      // This was titled "each primitive is its OWN implementation". It cannot prove that, and the
      // evasion is four lines long:
      //
      //     const compileFor = (holderId) => (request) => sharedBlob(holderId, request);
      //
      // Four distinct function identities, output determined by the holder rather than the request,
      // four distinct outputs — every assertion below passes over one shared implementation.
      //
      // The reviewer's point, and I agree with it: separate implementation is not a useful
      // architectural invariant anyway. Shared solver and trajectory machinery is DESIRABLE, and
      // contacts plus trajectory integration constrain that machinery behaviourally. What this
      // clause actually buys is worth having on its own — resolution binds behaviour, so a caller
      // cannot make one primitive act as another by relabelling its request.
      //
      // NOT EVIDENCE FOR: source-level implementation separation. Clause (4) is a lint for the
      // common collapsed form and nothing here upgrades it.
      const { resolvePrimitive } = await loadRegistry();
      expect(typeof resolvePrimitive, "primitive-registry must export resolvePrimitive").toBe("function");

      // Resolve every primitive up front, so an unresolvable id fails here by name rather than
      // producing a bare "possibly undefined" somewhere in the cross product below.
      const resolved = new Map<PrimitiveId, MotionPrimitive>();
      for (const id of PRIMITIVE_IDS) {
        const primitive = resolvePrimitive(id);
        expect(primitive, `the registry does not resolve "${id}"`).toBeDefined();
        resolved.set(id, primitive as MotionPrimitive);
      }

      const own = new Map<PrimitiveId, string>();
      for (const id of PRIMITIVE_IDS) {
        own.set(id, channelSignature(resolved.get(id)!.compile(canonicalRequest(id, String(SEED_A)))));
      }

      // (a) DISTINCT IDENTITIES. Four ids resolving to one function object is the blob, wearing a
      // registry. Object identity, not a name — a name is source again.
      const identities = new Set(PRIMITIVE_IDS.map((id) => resolved.get(id)!.compile));
      expect(
        identities.size,
        `${PRIMITIVE_IDS.length} primitives resolved to ${identities.size} distinct compile functions`,
      ).toBe(PRIMITIVE_IDS.length);

      // (b) THE DISCRIMINATOR. Cross the id in the request against the primitive resolved.
      for (const holder of PRIMITIVE_IDS) {
        for (const requested of PRIMITIVE_IDS) {
          if (holder === requested) continue;
          const crossed = channelSignature(
            resolved.get(holder)!.compile(canonicalRequest(requested, String(SEED_A))),
          );
          expect(
            crossed,
            `resolvePrimitive("${holder}") produced "${requested}" output when the request said so — behaviour is following the id in the request, which is one dispatching implementation`,
          ).toBe(own.get(holder));
        }
      }

      // COUNTERWEIGHT: (b) is satisfiable by four primitives that all return the SAME thing, which
      // would make every comparison trivially equal. Clause (1) asserts distinctness too; stating it
      // here keeps this clause honest standing alone.
      expect(
        new Set(own.values()).size,
        "the four primitives produced identical channel data, so the cross-request check compared nothing",
      ).toBe(PRIMITIVE_IDS.length);
    },
  );

  it("(4) HEURISTIC, NOT PROOF: no source file collapses the primitives into a switch-dispatching blob", () => {
    // CLAIM NARROWED 2026-08-30 after external review. This clause reads SOURCE, and source scanning
    // cannot establish architectural separation: `if (id === ...)`, a lookup table, a ternary and any
    // computed dispatch all evade it, and widening the regex only starts an endless syntax blacklist.
    //
    // What it still buys, honestly stated: it catches the most common collapsed form, it costs
    // nothing, and its synthetic controls prove it discriminates. That is a lint, not a guarantee.
    //
    // NOT EVIDENCE FOR: that the primitives are separately implemented. Clause (4b) below carries
    // that claim, structurally and without reading a character of source.
    const SRC = dirname(fileURLToPath(import.meta.url));

    /**
     * Two structural detectors. Both are expressions, stated here in full so
     * the guard cannot drift into a marker check.
     *
     * A file is a COLLAPSED BLOB when it names two or more primitive ids as
     * string literals AND dispatches on them AND builds channel data itself.
     * A registry that merely LISTS the four ids and delegates does not trip
     * this, because it constructs no channels.
     */
    const isCollapsedBlob = (source: string): boolean => {
      const declared = PRIMITIVE_IDS.filter((id) =>
        new RegExp(`["'\`]${id}["'\`]`).test(source),
      ).length;
      const dispatches = /\bswitch\s*\(|\bcase\s+["'`]/.test(source);
      const buildsChannels = /channels\s*[:=]/.test(source);
      return declared >= 2 && dispatches && buildsChannels;
    };

    /**
     * A file BYPASSES THE TRAJECTORY LAYER when it is a PRIMITIVE
     * IMPLEMENTATION — it names at least one primitive id as a literal AND
     * builds channel data — yet references no minimum-jerk trajectory module.
     *
     * SCOPED DELIBERATELY. This package is being built by several concurrent
     * cards (a MotionProgram planner and a motion evidence-gate suite landed
     * their own plants into this same src/ at 13:40 on 2026-08-29). An
     * unscoped "any file that mentions channels" rule would red this
     * counterweight on THEIR modules, which do not own the trajectory layer
     * and are not this card's business. The primitive-id requirement keeps the
     * guard on the four primitives and off a sibling card's surface.
     */
    const isPrimitiveImplementation = (source: string): boolean =>
      PRIMITIVE_IDS.some((id) =>
        new RegExp(`["'\`]${id}["'\`]`).test(source),
      ) && /channels\s*[:=]/.test(source);

    const bypassesTrajectory = (source: string): boolean =>
      isPrimitiveImplementation(source) &&
      !/minimumJerkProfile|trajectory/i.test(source);

    // (4a) TEETH. The real source tree is empty today, so the guard below would
    // pass over zero files and prove nothing. These synthetic controls prove
    // the detectors discriminate BEFORE any implementation exists. This clause
    // shares no evidence with clauses 1-3: it imports neither module, and reads
    // no seed, clip or velocity.
    const COLLAPSED_BLOB_CONTROL = [
      'export function compile(id, req) {',
      '  switch (id) {',
      '    case "clutch_body_region": return { channels: [] };',
      '    case "cough_recoil": return { channels: [] };',
      '  }',
      '}',
    ].join("\n");

    const SPLIT_PRIMITIVE_CONTROL = [
      'import { minimumJerkProfile } from "./trajectory.js";',
      'export const id = "cough_recoil";',
      'export const compile = (req) => ({ channels: buildFrom(minimumJerkProfile({ samples: 64 })) });',
    ].join("\n");

    const REGISTRY_CONTROL = [
      'export const PRIMITIVE_IDS = ["clutch_body_region", "reach_target", "look_at", "cough_recoil"];',
      "export const resolvePrimitive = (id) => TABLE[id];",
    ].join("\n");

    expect(
      isCollapsedBlob(COLLAPSED_BLOB_CONTROL),
      "detector failed to flag a collapsed dispatching blob; it has no teeth",
    ).toBe(true);
    expect(
      isCollapsedBlob(SPLIT_PRIMITIVE_CONTROL),
      "detector wrongly flagged a correctly split single-primitive module",
    ).toBe(false);
    expect(
      isCollapsedBlob(REGISTRY_CONTROL),
      "detector wrongly flagged a delegating registry that only lists the ids",
    ).toBe(false);
    // A sibling card's module: builds channels, names no primitive id, owns no
    // trajectory. Must stay clear of both detectors or this guard leaks across
    // card boundaries.
    const SIBLING_MODULE_CONTROL = [
      'export const validateProgram = (program) => {',
      "  const channels = program.tracks.map((t) => t.bone);",
      "  return channels.length > 0;",
      "};",
    ].join("\n");

    expect(
      isCollapsedBlob(SIBLING_MODULE_CONTROL),
      "detector leaked onto a sibling card's module",
    ).toBe(false);
    expect(
      bypassesTrajectory(SIBLING_MODULE_CONTROL),
      "trajectory detector leaked onto a sibling card's module that owns no primitive",
    ).toBe(false);
    expect(
      bypassesTrajectory(COLLAPSED_BLOB_CONTROL),
      "detector failed to flag channel construction with no trajectory layer",
    ).toBe(true);
    expect(
      bypassesTrajectory(SPLIT_PRIMITIVE_CONTROL),
      "detector wrongly flagged a module that does route through the trajectory layer",
    ).toBe(false);

    // (4b) THE GUARD. Vacuous while the package is empty; live from the moment
    // the first source file lands. Named failure mode on the far side of it:
    // one parameterised blob switching on primitiveId, which is exactly the
    // shape clause 1 cannot see once channel data is varied enough to differ.
    const sources = existsSync(SRC)
      ? readdirSync(SRC).filter(
          (name) => name.endsWith(".ts") && !name.endsWith(".test.ts"),
        )
      : [];

    const offenders: string[] = [];
    for (const name of sources) {
      const source = readFileSync(join(SRC, name), "utf8");
      if (isCollapsedBlob(source)) offenders.push(`${name}: collapsed blob`);
      if (bypassesTrajectory(source))
        offenders.push(`${name}: bypasses the trajectory layer`);
    }
    expect(offenders, offenders.join("; ")).toEqual([]);
  });
});

// NOT TESTED: that the four primitives are anatomically or clinically plausible — clause 1 proves they DIFFER, never that any one is correct, and no pixel or clinician grade is attached; the shared IK foundation itself (no solver convergence, reach-limit or joint-constraint assertion — a primitive could satisfy every clause here while driving a joint past its anatomical limit); the approach/hold/release SEGMENTATION (clause 3 measures one minimum-jerk profile end to end and never asserts a three-phase structure or a hold plateau); retargeting onto a real skeleton, glTF export, and whether any clip reaches a learner in ui-xr; that the seed variation is well-DISTRIBUTED rather than merely non-constant (two seeds are proof of sensitivity, not of range or uniformity); performance and clip size against the Quest budget; and the package scaffold is incomplete — a sibling card added package.json at 13:41 on 2026-08-29 but there is still no vitest.config.ts, tsconfig.json or turbo.json here, so `typecheck` has no config and this file's participation in `pnpm packages:test` is unverified.
