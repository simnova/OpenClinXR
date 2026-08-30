import { describe, expect, it } from "vitest";
import {
  trackOrderKeys,
  violationsInTracks,
  type CompiledMotionFragment,
  type CompiledMotionTrack,
  type PrimitiveRequest,
  type QuatTuple as Quat,
  type Vec3Tuple as Vec3,
} from "./canonical-motion-contract.js";

/**
 * THE KEYSTONE. One canonical compile entry, one clip representation, proven WITHOUT a solver.
 *
 * ## Why this exists — two independent reviews, same verdict
 *
 * A Grok orchestrator read the five committed REDs at d1ad5063 and found three compile signatures:
 *
 *   M1  planMotionProgram   scenario + touch row                    -> MotionProgram
 *   M2  compileGuardClip    constructed SkeletonProfile + {id, bodyPoint} -> tracks + reachedPoint
 *   M4  primitive.compile   {seed, durationMs}                      -> joint channels
 *
 * M2 never takes a MotionAction. M4 never takes a target, a rig, or a contact window. Its verdict:
 * "Do not dispatch this set until the five plants share one IR and one compile entry. The dependency
 * graph is usable; the plants are not." A Codex reviewer independently confirmed it against the tree
 * and withdrew its own GO, noting its pass had revalidated the card graph without a cross-plant
 * interface check.
 *
 * The decisive line, which reframes three rounds of card reordering:
 *   **A WORKER IMPLEMENTS THE RED, NOT THE CARD PROSE.**
 * Cards that agree while their plants disagree describe an architecture nobody is building.
 *
 * ## What this plant is careful NOT to do
 *
 * It does not require IK, a real rig, or a finished solver. It injects a FAKE primitive and proves
 * the canonical program reaches the primitive seam and returns through one canonical clip. That is
 * the adapter escape closed before any production code exists — which is the whole point of doing it
 * tonight rather than after three worktrees have each picked a shape.
 *
 * Deliberately UNFROZEN, so this contract does not encode a guess as architecture: the IK algorithm
 * (CCD, FABRIK or other), sampling rate, and key count.
 *
 * Deliberately EXCLUDED from the clip, because a clip carrying its own verdict is self-attestation:
 * reachedPoint, target/contact error, collision and joint-limit verdicts, quality scores, runtime
 * loaded-clip name, GLB path or bytes, visual findings, provider information. Those are derived
 * evidence, bake manifests or runtime observations — not the interchange representation.
 */

const CLIP_SCHEMA = "openclinxr.compiled-motion-clip.v1";
const PROGRAM_SCHEMA = "openclinxr.motion-program.v1";

/**
 * THE TRACK TYPE AND ITS VALIDATOR ARE IMPORTED, not declared here. See
 * `canonical-motion-contract.ts` for why: five review rounds each found me closing a shape in one
 * file while a sibling plant independently restated the same concept with its own structure. The
 * last instance had this file freezing quaternion tuples `[x, y, z, w]` while M2 froze objects
 * `{x, y, z, w}` — the adapter defect this keystone exists to prevent, reintroduced one layer down
 * by the amendment that closed it.
 *
 * A plant that redeclares `CompiledMotionTrack` structurally is reintroducing that defect.
 */
type CompiledMotionClipV1 = {
  schemaVersion: typeof CLIP_SCHEMA;
  clipId: string;
  source: { scenarioId: string; actorId: string; motionProgramHash: string; actionIds: string[] };
  targetRig: { rigFingerprint: string; skeletonProfileHash: string };
  compileIdentity: {
    compilerVersion: string;
    primitiveLibraryVersion: string;
    variationIndex: number;
    deterministicSeed: string;
  };
  durationSeconds: number;
  tracks: CompiledMotionTrack[];
  claimBoundary: string;
  notEvidenceFor: readonly string[];
};


const MODULE = "./compile-motion-program.js";

/**
 * Resolve a plant's module specifier to an ABSOLUTE url before the deferred import.
 *
 * Added 2026-08-30. A bare `./x.js` in a path VARIABLE under `@vite-ignore` is resolved natively, and
 * when the module is absent the native resolver reports the MANGLED path — `/src/motion-program.js`,
 * `/scenario-fixtures/src/...` — which reads as a broken test rather than as the missing module the
 * RED is demanding. One instance of this had M1's clauses (1) and (2) failing on a fixture path bug
 * instead of on the absent planner, since d1ad5063, invisibly, because `it.fails` hides the reason.
 */
function plantModule(specifier: string): string {
  return new URL(specifier, import.meta.url).href;
}

async function loadEntry(): Promise<{
  compileMotionProgram: (input: {
    program: unknown;
    skeletonProfile: unknown;
    primitives?: Record<string, (r: PrimitiveRequest) => CompiledMotionFragment>;
  }) => CompiledMotionClipV1;
}> {
  const mod = (await import(/* @vite-ignore */ plantModule(MODULE))) as Record<string, unknown>;
  return { compileMotionProgram: mod["compileMotionProgram"] as never };
}

function action(actionId: string, region: string) {
  return {
    actionId,
    primitiveId: "guard_body_region",
    trigger: { kind: "clinical_touch", ref: `clinical_touch_${region}` },
    timing: { durationMs: 900 },
    intensity: 0.6,
    target: { kind: "body_region", id: region },
    effector: "handR",
    // A REAL ContactConstraint. With `constraints: []` everywhere, a compiler that REPLACES
    // constraints with [] preserved the action by accident and the contacts guarantee proved nothing.
    constraints: [
      {
        kind: "contact",
        effector: "handR",
        target: { kind: "body_region", id: region },
        positionToleranceMeters: 0.03,
        startFraction: 0.4,
        endFraction: 0.72,
        penetrationToleranceMeters: 0.01,
        preserveWhileActive: true,
      },
    ],
  };
}

function program(actions: unknown[] = [action("a1", "guard_abdomen_rlq"), action("a2", "guard_chest_l")]) {
  return {
    schemaVersion: PROGRAM_SCHEMA,
    scenarioId: "ed_chest_pain_priority_v1",
    actorId: "patient_v1",
    baseline: { posture: "seated" },
    actions,
    provenance: { sourceKind: "deterministic_plan", sourceRefs: ["touch:guard_abdomen_rlq"] },
  };
}

/**
 * Carries what a primitive genuinely needs. An almost-empty profile would make the deep-equality
 * assertion above true and meaningless — the projection it exists to catch would be the whole object.
 */
const PROFILE = {
  rigFingerprint: "rig-fp-test-a",
  effectorBone: "handR",
  joints: [
    { boneName: "upper_armR", bindLocalPosition: { x: 0.18, y: 1.38, z: 0 }, bindLocalQuaternion: { x: 0, y: 0, z: 0, w: 1 } },
    { boneName: "forearmR", parentBoneName: "upper_armR", bindLocalPosition: { x: 0, y: -0.28, z: 0 }, bindLocalQuaternion: { x: 0, y: 0, z: 0, w: 1 } },
    { boneName: "handR", parentBoneName: "forearmR", bindLocalPosition: { x: 0, y: -0.26, z: 0 }, bindLocalQuaternion: { x: 0, y: 0, z: 0, w: 1 } },
  ],
};

/** A primitive that records what it was handed. Supplies tracks so no solver is needed. */
function recordingPrimitives(seen: PrimitiveRequest[]) {
  return {
    guard_body_region: (r: PrimitiveRequest) => {
      seen.push(r);
      const a = r.action as { actionId: string; target: unknown };
      return {
        actionId: a.actionId,
        tracks: [
          {
            property: "rotationAbsoluteNodeLocal" as const,
            boneName: `upper_arm.R@${JSON.stringify(a.target)}`,
            canonicalLandmark: "upper_arm_r",
            interpolation: "LINEAR" as const,
            times: [0, 0.45, 0.9],
            values: [[0, 0, 0, 1], [Math.sin(0.1), 0, 0, Math.cos(0.1)], [0, 0, 0, 1]] as Quat[],
          },
        ],
      };
    },
  };
}

describe("the canonical compile entry orchestrates primitives", () => {
  it.fails("(1) RED: one entry compiles a whole program through injected primitives", async () => {
    const { compileMotionProgram } = await loadEntry();
    const seen: PrimitiveRequest[] = [];
    // Frozen snapshot taken BEFORE the call: the immutability assertion below compares against it.
    const input = program();
    const profileInput = structuredClone(PROFILE);
    // BOTH inputs snapshotted. A compiler that mutates either makes every determinism claim after it
    // unreliable, and an oracle deriving from a mutated profile agrees with an arbitrary compiler.
    const before = JSON.stringify(input);
    const profileBefore = JSON.stringify(profileInput);
    const clip = compileMotionProgram({ program: input, skeletonProfile: profileInput, primitives: recordingPrimitives(seen) });

    // A {} stub dies here. A compiler that ignores one action dies on the composition count.
    expect(clip.schemaVersion, "one clip dialect, or we are back to two").toBe(CLIP_SCHEMA);
    expect(seen.length, "both actions must reach the primitive seam").toBe(2);

    // THE KEYSTONE ASSERTION: the primitive receives the canonical MotionAction and the profile —
    // not {seed, durationMs}, which is what M4's plant currently contracts and what would force a
    // fourth adapter at bake time.
    // FULL-ACTION PRESERVATION. Deep equality against the program's own action, so a compiler that
    // forwards a projection — dropping constraints, timing, intensity or provenance refs — fails
    // here. Asserting only "target is defined" was the narrowing this clause exists to prevent.
    const submitted = (input.actions as unknown[]);
    for (const r of seen) {
      const match = submitted.find((a) => (a as { actionId: string }).actionId === (r.action as { actionId: string }).actionId);
      expect(match, "a primitive received an action the program never contained").toBeDefined();
      expect(
        r.action,
        "the primitive received a PROJECTION of the action — constraints, timing or intensity were dropped",
      ).toEqual(match);
      expect(
        r.skeletonProfile,
        "the primitive received a PROJECTION of the profile — joints, bind transforms or effectorBone were dropped",
      ).toEqual(profileInput);
      expect(typeof r.seed, "a primitive must receive a derived seed, not a duration").toBe("string");
    }

    // INPUT IMMUTABILITY. A compiler that mutates the program it was handed makes every later
    // determinism claim unreliable, because the second call sees different input than the first.
    expect(JSON.stringify(input), "compileMotionProgram mutated the program it was given").toBe(before);
    expect(JSON.stringify(profileInput), "compileMotionProgram mutated the skeletonProfile it was given").toBe(profileBefore);

    expect(clip.source.actionIds.sort(), "semantic attribution survives compilation").toEqual(["a1", "a2"]);
    expect(clip.tracks.length, "both fragments' tracks must be present").toBe(2);
    expect(clip.targetRig.rigFingerprint).toBe("rig-fp-test-a");
    expect(clip.source.motionProgramHash, "the clip identifies the exact accepted program").toBeTruthy();
    expect(clip.compileIdentity.deterministicSeed, "reproducibility identity is not optional").toBeTruthy();
  });

  it.fails("(2) RED: the same input compiles to the same clip, and a moved target changes it", async () => {
    const { compileMotionProgram } = await loadEntry();
    const prims = () => recordingPrimitives([]);
    const a = compileMotionProgram({ program: program(), skeletonProfile: PROFILE, primitives: prims() });
    const b = compileMotionProgram({ program: program(), skeletonProfile: PROFILE, primitives: prims() });
    expect(JSON.stringify(a), "same input, same clip").toBe(JSON.stringify(b));

    // COUNTERWEIGHT to (1): a hardcoded known clip passes composition and dies here.
    const moved = compileMotionProgram({
      program: program([action("a1", "guard_left_thigh"), action("a2", "guard_chest_l")]),
      skeletonProfile: PROFILE,
      primitives: prims(),
    });
    expect(JSON.stringify(moved), "moving a target changed nothing — output does not depend on input").not.toBe(JSON.stringify(a));
  });

  it.fails("(3) RED: an unknown primitive is REFUSED, never silently skipped", async () => {
    const { compileMotionProgram } = await loadEntry();
    // Silent skipping is the failure that produces a green compile over missing motion.
    expect(() =>
      compileMotionProgram({
        program: program([action("a1", "guard_abdomen_rlq"), { ...action("a2", "guard_chest_l"), primitiveId: "not_a_primitive" }]),
        skeletonProfile: PROFILE,
        primitives: recordingPrimitives([]),
      }),
    ).toThrow(/not_a_primitive/);

    // And a primitive that answers for the WRONG action must be refused — otherwise fragments can be
    // reattributed and the actionIds in the clip stop meaning anything.
    expect(() =>
      compileMotionProgram({
        program: program(),
        skeletonProfile: PROFILE,
        primitives: {
          guard_body_region: () => ({ actionId: "some_other_action", tracks: [] }),
        },
      }),
    ).toThrow(/some_other_action|actionId/);
  });

  it.fails("(4) RED: the clip carries NO self-attested verdict — checked on the RETURNED object", async () => {
    // REWRITTEN 2026-08-30 after an external reviewer showed the first version was CIRCULAR: it
    // asserted a hardcoded `frozen` array contained none of a hardcoded `forbidden` list. That tests
    // my own literal, not the compiler. A stub returning
    //   { ...validClip, reachedPoint: [0,0,0], collisionVerdict: "pass" }
    // satisfied every other clause and clause 4 never saw it.
    //
    // Now it inspects the RETURNED clip, recursively, so a self-attested field cannot enter under a
    // nested key either. That moves it from live-and-passing to a RED, which is honest: the property
    // cannot be checked until something returns a clip.
    const { compileMotionProgram } = await loadEntry();
    const clip = compileMotionProgram({
      program: program(),
      skeletonProfile: PROFILE,
      primitives: recordingPrimitives([]),
    });

    // ALLOWLIST, not a blacklist. The first version listed forbidden names, which a field called
    // `achievedPoint`, `verdict` or `confidence` evades — a blacklist only refuses what someone
    // already thought of. This closes the top-level shape instead: anything not in the frozen set is
    // refused, whatever it is called.
    const ALLOWED_TOP_LEVEL = new Set([
      "schemaVersion", "clipId", "source", "targetRig", "compileIdentity",
      "durationSeconds", "tracks", "claimBoundary", "notEvidenceFor",
    ]);
    const unexpected = Object.keys(clip).filter((k) => !ALLOWED_TOP_LEVEL.has(k));
    expect(
      unexpected,
      "the clip carries a field outside the frozen interchange shape — derived evidence, bake manifests and runtime observations do not belong on the clip",
    ).toEqual([]);

    // The blacklist survives as a NESTED check, because the allowlist above only closes the top
    // level and a verdict smuggled under source or compileIdentity would still be self-attestation.
    const forbidden = [
      "reachedPoint", "achievedPoint", "targetError", "contactError", "collisionVerdict",
      "jointLimitVerdict", "qualityScore", "confidence", "verdict", "runtimeLoadedClipName",
      "glbPath", "glbBytes", "visualFinding", "provider",
    ];
    const seen: string[] = [];
    const walk = (node: unknown, path: string): void => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) return node.forEach((v, i) => walk(v, `${path}[${i}]`));
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        if (forbidden.includes(k)) seen.push(`${path}.${k}`);
        walk(v, `${path}.${k}`);
      }
    };
    walk(clip, "clip");
    expect(
      seen,
      "a clip carrying its own verdict is self-attestation — those are derived evidence, bake manifests or runtime observations",
    ).toEqual([]);

    // COUNTERWEIGHT to this clause: it must not pass by finding nothing because the clip is empty.
    expect(Object.keys(clip).length, "an empty clip trivially carries no verdict").toBeGreaterThan(5);
    expect(clip.claimBoundary, "the claim boundary is the positive half of this contract").toBeTruthy();
  });

  it.fails("(5) RED: tracks have one closed value space — semantics, sign continuity, ordering", async () => {
    // THE LARGEST REMAINING ARCHITECTURAL ITEM per external review, and plantable now: it depends on
    // neither the solver nor the bake. Left open, M2's dialect and whatever the bake worker invents
    // become two clip dialects BELOW the supposedly canonical entry.
    const { compileMotionProgram } = await loadEntry();
    const clip = compileMotionProgram({ program: program(), skeletonProfile: structuredClone(PROFILE), primitives: recordingPrimitives([]) });

    expect(violationsInTracks(clip.tracks), "the compiled tracks violate the canonical clip contract").toEqual([]);

    // Deterministic ordering, so two identical compiles serialise identically.
    const order = trackOrderKeys(clip.tracks);
    expect(order, "tracks must be ordered by boneName then property").toEqual([...order].sort());

    // durationSeconds is not an independent number that can drift from the tracks it describes.
    const maxFinal = Math.max(0, ...clip.tracks.map((t) => t.times[t.times.length - 1] ?? 0));
    expect(Number.isFinite(clip.durationSeconds) && clip.durationSeconds > 0).toBe(true);
    expect(clip.durationSeconds, "durationSeconds must equal the maximum final track time").toBeCloseTo(maxFinal, 6);
  });

  it("(5b) LIVE: the shared validator REJECTS each known-bad track — a weakened rule turns this red", () => {
    // THE DESTRUCTIVE PROBE, MADE PERMANENT. Every rule in `violationsInTracks` was previously
    // verified by hand — stub in a violation, watch the message, delete the stub. That verifies the
    // rule on the day and protects nothing afterwards: the validator now lives in a source file a
    // worker may edit, and a rule quietly relaxed there would turn clause (5) green rather than red.
    //
    // This clause is LIVE on purpose. It passes on arrival, fails independently of the RED clauses,
    // and each row asserts a DIFFERENT message, so deleting one rule cannot be masked by another
    // still firing.
    // Unit to double precision. `[0.1, 0, 0, 0.995]` reads as a small rotation and is 1.25e-5 off
    // unit, which the validator correctly refuses — a fixture that fails the rule it is the control
    // for makes every row below it unreadable.
    const rot = (radians: number): number[] => [Math.sin(radians / 2), 0, 0, Math.cos(radians / 2)];
    const ok = (over: Partial<Record<string, unknown>> = {}) => ({
      property: "rotationAbsoluteNodeLocal",
      boneName: "upper_armR",
      canonicalLandmark: "shoulder_R",
      interpolation: "LINEAR",
      times: [0, 0.5],
      values: [[0, 0, 0, 1], rot(0.2)],
      ...over,
    });
    const rows: [string, unknown[], RegExp][] = [
      ["a clean track is accepted", [ok()], /^$/],
      ["unknown property", [ok({ property: "scale" })], /unknown track property "scale"/],
      ["negative time", [ok({ times: [-0.5, 0.5] })], /negative timestamp -0\.5/],
      ["times not increasing", [ok({ times: [0.5, 0.5] })], /times not strictly increasing/],
      ["five-component quaternion", [ok({ values: [[0, 0, 0, 1, 0], rot(0.2)] })], /exactly 4 components/],
      ["non-unit quaternion", [ok({ values: [[0, 0, 0, 2], rot(0.2)] })], /not unit/],
      ["whole track negated", [ok({ values: [[0, 0, 0, -1], rot(0.2).map((c) => -c)] })], /not sign-canonical/],
      ["sign flip mid-track", [ok({ values: [[0, 0, 0, 1], rot(0.2).map((c) => -c)] })], /sign flips between samples/],
      ["object quaternion, not a tuple", [ok({ values: [{ x: 0, y: 0, z: 0, w: 1 }, rot(0.2)] })], /not a tuple/],
      ["implicit interpolation", [ok({ interpolation: undefined })], /interpolation must be explicit/],
      ["no canonical landmark", [ok({ canonicalLandmark: "" })], /missing canonicalLandmark/],
      ["times and values disagree", [ok({ times: [0] })], /1 times against 2 values/],
      ["duplicate bone and property", [ok(), ok()], /two tracks address the same bone/],
      ["a self-attested verdict smuggled onto a track", [ok({ reachedPoint: [0.1, 1.0, 0.02] })], /unknown field "reachedPoint"/],
      ["translation of arity 4", [ok({ property: "translationAbsoluteNodeLocal", values: [[0, 0, 0, 1], [0, 1, 0, 0]] })], /exactly 3 components/],
    ];
    for (const [label, tracks, pattern] of rows) {
      const violations = violationsInTracks(tracks);
      expect(violations.join(" | "), label).toMatch(pattern);
    }
  });
});
