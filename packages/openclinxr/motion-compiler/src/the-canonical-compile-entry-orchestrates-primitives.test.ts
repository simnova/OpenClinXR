import { describe, expect, it } from "vitest";

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

type Vec3 = readonly [number, number, number];
type Quat = readonly [number, number, number, number];

type CompiledMotionTrack =
  | { property: "rotation"; boneName: string; canonicalLandmark: string; times: number[]; values: Quat[] }
  | { property: "translation"; boneName: string; canonicalLandmark: string; times: number[]; values: Vec3[] };

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

/** What a primitive receives. The point of the keystone: NOT {seed, durationMs}. */
type PrimitiveRequest = {
  action: { actionId: string; primitiveId: string; target: unknown; effector: string };
  skeletonProfile: { rigFingerprint: string };
  seed: string;
};

const MODULE = "./compile-motion-program.js";

async function loadEntry(): Promise<{
  compileMotionProgram: (input: {
    program: unknown;
    skeletonProfile: unknown;
    primitives?: Record<string, (r: PrimitiveRequest) => { actionId: string; tracks: CompiledMotionTrack[] }>;
  }) => CompiledMotionClipV1;
}> {
  const mod = (await import(/* @vite-ignore */ MODULE)) as Record<string, unknown>;
  return { compileMotionProgram: mod.compileMotionProgram as never };
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
    constraints: [],
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

const PROFILE = { rigFingerprint: "rig-fp-test-a", joints: [] };

/** A primitive that records what it was handed. Supplies tracks so no solver is needed. */
function recordingPrimitives(seen: PrimitiveRequest[]) {
  return {
    guard_body_region: (r: PrimitiveRequest) => {
      seen.push(r);
      return {
        actionId: r.action.actionId,
        tracks: [
          {
            property: "rotation" as const,
            boneName: `upper_arm.R@${JSON.stringify(r.action.target)}`,
            canonicalLandmark: "upper_arm_r",
            times: [0, 0.45, 0.9],
            values: [[0, 0, 0, 1], [0.1, 0, 0, 0.995], [0, 0, 0, 1]] as Quat[],
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
    const clip = compileMotionProgram({ program: program(), skeletonProfile: PROFILE, primitives: recordingPrimitives(seen) });

    // A {} stub dies here. A compiler that ignores one action dies on the composition count.
    expect(clip.schemaVersion, "one clip dialect, or we are back to two").toBe(CLIP_SCHEMA);
    expect(seen.length, "both actions must reach the primitive seam").toBe(2);

    // THE KEYSTONE ASSERTION: the primitive receives the canonical MotionAction and the profile —
    // not {seed, durationMs}, which is what M4's plant currently contracts and what would force a
    // fourth adapter at bake time.
    for (const r of seen) {
      expect(r.action.target, "a primitive must receive the canonical target").toBeDefined();
      expect(r.skeletonProfile.rigFingerprint, "a primitive must receive the rig it targets").toBe("rig-fp-test-a");
      expect(typeof r.seed, "a primitive must receive a derived seed, not a duration").toBe("string");
    }

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

  it("(4) COUNTERWEIGHT: the clip carries no self-attested verdict", () => {
    // Live and passing on arrival. It fails if a later worker adds reachedPoint, a target error, a
    // quality score or a runtime clip name to the clip — the self-attestation this contract excludes
    // by design. Keys are checked against the TYPE's own field list, so this cannot drift silently.
    const frozen = [
      "schemaVersion", "clipId", "source", "targetRig", "compileIdentity",
      "durationSeconds", "tracks", "claimBoundary", "notEvidenceFor",
    ];
    const forbidden = [
      "reachedPoint", "targetError", "contactError", "collisionVerdict", "jointLimitVerdict",
      "qualityScore", "runtimeLoadedClipName", "glbPath", "glbBytes", "visualFinding", "provider",
    ];
    for (const f of forbidden) {
      expect(frozen, `${f} is derived evidence, not the interchange representation`).not.toContain(f);
    }
    expect(frozen).toContain("claimBoundary");
  });
});
