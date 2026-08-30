import { describe, expect, it } from "vitest";

// Relative, matching `the-llm-planner-cannot-emit-bone-tracks.test.ts`. This package does not depend
// on scenario-fixtures and should not start doing so for a test: the plants read the shipped bank,
// the compiler must not.
import { scenarioBank } from "../../scenario-fixtures/src/scenario-bank.js";

import type { CompiledMotionTrack, QuatTuple } from "./canonical-motion-contract.js";

/**
 * **OBSERVABLE: nothing connects the clip a case ASKS FOR to the clip the factory can PRODUCE.**
 *
 * Found by external review of the routing plant (f4e94b1a) and it is the sharper half of that card.
 * `the-touch-response-clip-follows-the-region.test.ts` proves the case data routes region to clip
 * NAME. Every one of its clauses is satisfied by a resolver returning ten distinct strings that name
 * nothing — invent the strings, rewrite the 24 rows to match, keep the RLQ string, done. The bake
 * worker then still has to invent the missing hop from a resolved name to a compiled clip identity,
 * which is the adapter this whole plant set exists to refuse.
 *
 * Two different routings, and only the first was closed:
 *
 *     data level      region -> requested clip NAME          closed by f4e94b1a
 *     factory level   action -> primitive -> clipId          THIS FILE
 *
 * ## WHAT THIS DOES NOT REQUIRE — read before assuming it is blocked
 *
 * No IK, no solver, no rig, no Blender, no GLB, no baked artifact. The primitive is INJECTED and
 * supplies its own tracks, exactly as the keystone does. What is under test is identity plumbing:
 * the clip a compile produces must be addressable by the name the case already uses.
 *
 * Artifact producibility — a GLB on disk the runtime loads — stays with tsk_9faa82d3f77d8a6a and is
 * deliberately NOT asserted here. A clipId that agrees with the case and has no bytes behind it
 * satisfies every clause below, and saying so is the point: this clause buys identity, not existence.
 *
 * ## THE DRIFT THIS EXISTS TO PREVENT
 *
 * Three places name a clip: the bank row, the resolver, and the compiler's output. Any two agreeing
 * while the third drifts is a learner being played the wrong flinch, or nothing at all. The
 * implementer should make ONE of them the source — most likely the compiler calling the resolver —
 * rather than teaching the compiler the naming rule a second time. Clause (2) fails on any pair that
 * disagrees, whichever way the dependency ends up pointing.
 */

const PROGRAM_SCHEMA = "openclinxr.motion-program.v1";
const ENTRY_MODULE = "./compile-motion-program.js";
/**
 * The resolver is read through the package INDEX, as a plain literal import.
 *
 * Not `@vite-ignore` with a path variable, which is what the two same-package loaders above use: that
 * form is resolved natively, and a native resolve of `../../scenario-fixtures/...` from this file
 * mangles to `/scenario-fixtures/...` and fails with an error the loader's catch would report as
 * "the export does not exist". Measured — it swallowed a path bug and read as a legitimate RED for
 * two runs.
 *
 * Reading the index also states the requirement correctly: this is the package's PUBLIC surface, and
 * a resolver a consumer cannot import is not wired.
 */
const RESOLVER_MODULE = "../../scenario-fixtures/src/index.js";

/** The region the one clip that has actually been produced was authored for. */
const SHIPPED_REGION = "abdomen_rlq";
/** A second authored region, so agreement cannot be met by a constant. */
const CONTRAST_REGION = "chest_L";

type PrimitiveRequest = { action: unknown; skeletonProfile: unknown; seed: string };

type CompiledClip = { clipId: string; tracks: CompiledMotionTrack[] };

async function loadEntry(): Promise<
  | ((input: {
      program: unknown;
      skeletonProfile: unknown;
      primitives?: Record<string, (r: PrimitiveRequest) => { actionId: string; tracks: CompiledMotionTrack[] }>;
    }) => CompiledClip)
  | undefined
> {
  try {
    const mod = (await import(/* @vite-ignore */ ENTRY_MODULE)) as Record<string, unknown>;
    return mod["compileMotionProgram"] as never;
  } catch {
    return undefined;
  }
}

async function loadResolver(): Promise<((region: string) => string) | undefined> {
  const mod = (await import("../../scenario-fixtures/src/index.js")) as Record<string, unknown>;
  return mod["responseClipForBodyRegion"] as ((region: string) => string) | undefined;
}

/** What the shipped case data names for a region, read from the bank rather than restated. */
function bankClipForRegion(region: string): string[] {
  const clips = new Set<string>();
  for (const scenario of scenarioBank as unknown as Array<Record<string, unknown>>) {
    for (const actor of (scenario["actors"] as Array<Record<string, unknown>>) ?? []) {
      const mechanics = actor["bodyMechanics"] as Record<string, unknown> | undefined;
      for (const row of (mechanics?.["touchResponses"] as Array<Record<string, unknown>>) ?? []) {
        if (String(row["region"]) === region) clips.add(String(row["responseClip"]));
      }
    }
  }
  return [...clips];
}

const PROFILE = {
  rigFingerprint: "rig-fp-seam",
  effectorBone: "handR",
  joints: [
    { boneName: "upper_armR", bindLocalPosition: { x: 0.18, y: 1.38, z: 0 }, bindLocalQuaternion: { x: 0, y: 0, z: 0, w: 1 } },
    { boneName: "forearmR", parentBoneName: "upper_armR", bindLocalPosition: { x: 0, y: -0.28, z: 0 }, bindLocalQuaternion: { x: 0, y: 0, z: 0, w: 1 } },
    { boneName: "handR", parentBoneName: "forearmR", bindLocalPosition: { x: 0, y: -0.26, z: 0 }, bindLocalQuaternion: { x: 0, y: 0, z: 0, w: 1 } },
  ],
};

function guardAction(region: string) {
  return {
    actionId: `guard_${region}`,
    primitiveId: "guard_body_region",
    trigger: { kind: "clinical_touch", ref: `clinical_touch_${region}` },
    timing: { durationMs: 900 },
    intensity: 0.6,
    target: { kind: "body_region", id: region },
    effector: "handR",
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

function programFor(region: string) {
  return {
    schemaVersion: PROGRAM_SCHEMA,
    scenarioId: "ed_chest_pain_priority_v1",
    actorId: "patient_robert_hayes_v1",
    baseline: { posture: "seated" },
    actions: [guardAction(region)],
    provenance: { sourceKind: "deterministic_plan", sourceRefs: [`touch:${region}`] },
  };
}

/** Injected. Supplies tracks so no solver is needed, and records what it was handed. */
function recordingPrimitives(seen: PrimitiveRequest[]) {
  return {
    guard_body_region: (r: PrimitiveRequest) => {
      seen.push(r);
      return {
        actionId: (r.action as { actionId: string }).actionId,
        tracks: [
          {
            property: "rotationAbsoluteNodeLocal" as const,
            boneName: "upper_armR",
            canonicalLandmark: "upper_arm_r",
            interpolation: "LINEAR" as const,
            times: [0, 0.45, 0.9],
            values: [[0, 0, 0, 1], [Math.sin(0.1), 0, 0, Math.cos(0.1)], [0, 0, 0, 1]] as QuatTuple[],
          },
        ],
      };
    },
  };
}

describe("the resolved clip id is what the compiler produces", () => {
  it.fails("(1) RED: the canonical action reaches the primitive unchanged, through the canonical entry", async () => {
    const compileMotionProgram = await loadEntry();
    expect(typeof compileMotionProgram, `${ENTRY_MODULE} must export compileMotionProgram`).toBe("function");

    const seen: PrimitiveRequest[] = [];
    const input = programFor(SHIPPED_REGION);
    const expectedAction = structuredClone(input.actions[0]);
    const clip = compileMotionProgram!({
      program: input,
      skeletonProfile: structuredClone(PROFILE),
      primitives: recordingPrimitives(seen),
    });

    expect(seen.length, "the guard action never reached a primitive").toBe(1);
    // DEEP EQUALITY, not "target is defined". A compiler that projects the action down to the two
    // fields it happens to use loses the contacts and timing while satisfying a shallower check.
    expect(seen[0]!.action, "the action was projected or rewritten on the way to the primitive").toEqual(expectedAction);
    expect(clip.tracks.length, "the primitive's tracks did not reach the clip").toBeGreaterThan(0);
  });

  it.fails("(2) RED: the compiled clipId IS the clip the case asks for — bank, resolver and compiler agree", async () => {
    // THE SEAM. Without this, a resolver may return ten invented strings that name nothing the
    // factory can produce, and every clause of the routing plant still passes.
    const compileMotionProgram = await loadEntry();
    const resolve = await loadResolver();
    expect(typeof compileMotionProgram, `${ENTRY_MODULE} must export compileMotionProgram`).toBe("function");
    expect(
      typeof resolve,
      `${RESOLVER_MODULE} must export responseClipForBodyRegion (card tsk_ae6a9530ba63a68b) — it does not exist yet`,
    ).toBe("function");

    const compiled = (region: string): string =>
      compileMotionProgram!({
        program: programFor(region),
        skeletonProfile: structuredClone(PROFILE),
        primitives: recordingPrimitives([]),
      }).clipId;

    for (const region of [SHIPPED_REGION, CONTRAST_REGION]) {
      // (a) The bank must still author exactly one clip for the region — the routing card's own
      // guarantee, restated here because this clause is meaningless if the bank is ambiguous.
      const fromBank = bankClipForRegion(region);
      expect(fromBank, `the bank binds ${region} to ${fromBank.length} clips`).toHaveLength(1);

      // (b) Resolver agrees with the case data.
      expect(resolve!(region), `the resolver and the bank disagree about ${region}`).toBe(fromBank[0]);

      // (c) THE HOP THAT WAS MISSING: the compiled clip carries that identity, so a bake has
      // something to write and a runtime has something to find.
      expect(
        compiled(region),
        `compiling the ${region} guard produced a clipId the case never asks for — the resolver names a clip the factory cannot produce`,
      ).toBe(fromBank[0]);
    }

    // COUNTERWEIGHT: agreement must not be reachable by making every compile answer the same thing.
    // A compiler returning a constant clipId satisfies (c) for one region and dies here.
    expect(
      compiled(SHIPPED_REGION),
      "two anatomically distinct regions compiled to one clipId — the compiler is not carrying the region",
    ).not.toBe(compiled(CONTRAST_REGION));

    // The shipped clip keeps its name. §6p: replacing a mapping must not delete the one asset that
    // has actually been produced.
    expect(
      compiled(SHIPPED_REGION),
      "the one clip that exists on disk is no longer what the RLQ guard compiles to",
    ).toBe("openclinxr_role_patient_guard_withdraw_rlq");
  });
});
