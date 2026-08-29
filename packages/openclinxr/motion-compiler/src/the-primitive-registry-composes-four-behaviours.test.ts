import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

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

interface MotionChannel {
  jointPath: string;
  times: number[];
  values: number[];
}

interface MotionClip {
  primitiveId: PrimitiveId;
  durationMs: number;
  channels: MotionChannel[];
}

interface CompileRequest {
  seed: number;
  durationMs: number;
}

interface MotionPrimitive {
  id: PrimitiveId;
  compile: (request: CompileRequest) => MotionClip;
}

interface PrimitiveRegistryModule {
  resolvePrimitive: (id: string) => MotionPrimitive | undefined;
  PRIMITIVE_IDS: readonly string[];
}

interface TrajectoryModule {
  minimumJerkProfile: (options: { samples: number }) => number[];
}

const loadRegistry = async (): Promise<PrimitiveRegistryModule> =>
  (await import(REGISTRY_SPEC)) as PrimitiveRegistryModule;

const loadTrajectory = async (): Promise<TrajectoryModule> =>
  (await import(TRAJECTORY_SPEC)) as TrajectoryModule;

/**
 * Channel-only signature. `primitiveId` is DELIBERATELY EXCLUDED so that a
 * single parameterised implementation which varies nothing but the label
 * cannot satisfy the distinctness clause.
 */
const channelSignature = (clip: MotionClip): string =>
  JSON.stringify(
    [...clip.channels]
      .sort((a, b) => a.jointPath.localeCompare(b.jointPath))
      .map((channel) => [channel.jointPath, channel.times, channel.values]),
  );

/** Full canonical form, used only where byte-identity is the assertion. */
const canonical = (clip: MotionClip): string =>
  JSON.stringify([clip.primitiveId, clip.durationMs, channelSignature(clip)]);

const jointSetKey = (clip: MotionClip): string =>
  [...new Set(clip.channels.map((channel) => channel.jointPath))]
    .sort()
    .join("|");

const SEED_A = 20260829;
const SEED_B = 20260830;
const DURATION_MS = 900;

describe("the primitive registry composes four behaviours", () => {
  it.fails(
    "(1) the registry resolves all four primitives and each produces a motion distinct from the other three",
    async () => {
      const { resolvePrimitive } = await loadRegistry();

      const clips = new Map<PrimitiveId, MotionClip>();
      for (const id of PRIMITIVE_IDS) {
        const primitive = resolvePrimitive(id);
        expect(primitive, `registry did not resolve "${id}"`).toBeDefined();
        const clip = (primitive as MotionPrimitive).compile({
          seed: SEED_A,
          durationMs: DURATION_MS,
        });
        expect(
          clip.channels.length,
          `"${id}" compiled a clip with no channels`,
        ).toBeGreaterThan(0);
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
            channelSignature(clips.get(left) as MotionClip),
            `"${left}" and "${right}" produced identical channel data; only the primitiveId differs`,
          ).not.toBe(channelSignature(clips.get(right) as MotionClip));
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

  it.fails(
    "(2) DETERMINISM: one seed reproduces byte-identically AND a different seed produces different motion",
    async () => {
      const { resolvePrimitive } = await loadRegistry();

      for (const id of PRIMITIVE_IDS) {
        const primitive = resolvePrimitive(id);
        expect(primitive, `registry did not resolve "${id}"`).toBeDefined();
        const compile = (seed: number) =>
          (primitive as MotionPrimitive).compile({
            seed,
            durationMs: DURATION_MS,
          });

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

  it.fails(
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
        velocity.push(position[i + 1] - position[i]);
      }

      const peak = Math.max(...velocity);
      const mean =
        velocity.reduce((sum, v) => sum + v, 0) / velocity.length;
      expect(peak, "profile is flat; no motion").toBeGreaterThan(0);

      // Endpoints: velocity vanishes at both ends. Expressed relative to the
      // peak so the assertion is scale-free.
      expect(
        velocity[0] / peak,
        "velocity does not start at rest",
      ).toBeLessThan(0.02);
      expect(
        velocity[velocity.length - 1] / peak,
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
        ).toBeGreaterThanOrEqual(velocity[i - 1]);
      }
      for (let i = peakIndex + 1; i < velocity.length; i += 1) {
        expect(
          velocity[i],
          `velocity is not monotonically falling after the peak (index ${i})`,
        ).toBeLessThanOrEqual(velocity[i - 1]);
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

  it("(4) COUNTERWEIGHT: no source file collapses the primitives into one dispatching blob or bypasses the trajectory layer", () => {
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
