import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

/**
 * OBSERVABLE: the bake-off could not run the designed backends, and the reason is this package's
 * public surface plus two primitives that ignore the inputs they are given.
 *
 * MEASURED at main c154bcc8 on 2026-09-03, by the orchestrator, after tsk_37785faf55d16dc6 closed
 * `inconclusive_blocked`. Its report says the harness used "homemade twoBoneToward plus baked
 * eulers, not CCDIKSolver after mixer". That was not a shortcut. `src/index.ts` exports six modules
 * and NONE of them is a primitive, a registry, or a skeleton deriver:
 *
 *     import * as m from "./src/index.ts"
 *     resolvePrimitive: undefined   PRIMITIVE_IDS: undefined   compileMotionProgram: function
 *
 * A harness cannot reach `clutch_body_region` through the package root, so hand-rolling was the only
 * path open to it. Repairing this is therefore a PRECONDITION for a bake-off that can run, not work
 * that waits behind one.
 *
 * IMMUTABLE diagnosis. Flip planted() -> it and append a `## FIXED` block. Remove each flipped
 * clause from planted-red-manifest.ts in the same change; probe:reds enforces exact coverage and
 * will fail on a stale entry as loudly as on an unregistered clause.
 *
 * ## WHAT IS BROKEN, EACH WRONG IN BOTH CANDIDATE ARCHITECTURES
 *
 * (1) The public surface cannot compile a clutch.
 * (2) `clutch_body_region` ignores `site`: it applies one fixed delta and keeps the region only as a
 *     `canonicalLandmark` label, so every body region compiles to the same arm motion.
 * (3) It reads a scalar `skeletonProfile.effectorBone` rather than `action.effector`, as does
 *     `guard_body_region`. A left-hand and a right-hand response cannot differ.
 * (4) Primitives emit track times in MILLISECONDS while the composer copies their maximum into a
 *     field named `durationSeconds`, so a 900 ms clutch reports as 900 seconds.
 * (5) `RESPONSE_KIND_TO_PRIMITIVE` maps `passive_rom` to `brace` and `positioning` to
 *     `posture_shift`. Neither is in `PRIMITIVE_IDS`. Every shipped touch row is `guarding`, which
 *     is the only reason nothing has failed yet.
 *
 * ## THE FIX THAT MUST NOT BE TAKEN
 *
 * Do NOT satisfy clause (3) by populating `skeletonProfile.effectorBone` per request.
 * `compileMotionProgram` hashes the WHOLE profile into `skeletonProfileHash`, so a rig would acquire
 * a different identity depending on which hand the case asks to move, and every downstream binding
 * keyed on that hash would silently split. Clause (3) asserts the hash is IDENTICAL across the two
 * effectors for exactly this reason. Resolve `action.effector` against a canonical-to-actual landmark
 * map instead; `asset-registry`'s `resolvePoseBone` already does this across rig families.
 *
 * claimScope: whether a consumer outside this package can compile a region-anchored, effector-correct
 *   clutch whose durations are seconds.
 * notEvidenceFor: that the compiled motion looks right; that either candidate backend wins the
 *   bake-off; runtime IK, contact, or anything in apps/ui-xr.
 *
 * ## FIXED (compiler-repair card, issue #0) — all five clauses are now live `it` tests.
 *
 * The compiler-surface repair landed in src/:
 *
 *   - src/index.ts                    now exports the primitive registry (resolvePrimitive /
 *                                     PRIMITIVE_IDS / createPrimitiveRegistry) and the two profile
 *                                     derivers (deriveSkeletonProfileFromRigAsset and the anchor
 *                                     producer deriveSkeletonProfile), so a consumer outside this
 *                                     package can reach a primitive AND build the profile every
 *                                     body primitive requires. (1)
 *   - src/clutch-body-region.ts       compiles each SITE to its own region-anchored travel (a
 *                                     closed per-region table keyed on the MotionBodyRegion
 *                                     vocabulary; compliance-region ids go through the one declared
 *                                     mapper) and reads action.effector, resolved against the rig's
 *                                     own joint table. (2) (3)
 *   - src/requested-effector.ts       the shared action-first effector resolution (action.effector
 *                                     -> profile.effectorBone legacy -> default), used by both body
 *                                     primitives; nothing is written to the profile, so the rig's
 *                                     skeletonProfileHash cannot split per hand. (3)
 *   - src/primitives/guard-body-region.ts reads action.effector too, and its chain resolution is
 *                                     side-aware (left effector drives the left arm). (3)
 *   - all motion-emitting primitives  emit TRACK TIMES IN SECONDS (durationMs / 1000), so the
 *                                     composer's durationSeconds is seconds for every primitive. (4)
 *   - src/program/compile-scenario-motion.ts remaps passive_rom -> guard_body_region and
 *                                     positioning -> reach_target, both members of PRIMITIVE_IDS. (5)
 *
 * MEASURED 2026-09-02: clause (2) digests differ between abdomen_epigastric and chest_L while a
 * single site is byte-stable; clause (3) handL writes handL and handR writes handR under one
 * skeletonProfileHash; clause (4) a 900 ms clutch reports durationSeconds 0.9; clause (5) every
 * RESPONSE_KIND_TO_PRIMITIVE value resolves through the registry.
 */

const HAND_L = "handL";
const HAND_R = "handR";

/** Stable digest of a track set, so "different" means different SAMPLES, not different key order. */
const trackDigest = (tracks: readonly unknown[]): string =>
  createHash("sha256").update(JSON.stringify(tracks)).digest("hex");

const rootModule = async (): Promise<Record<string, unknown>> =>
  (await import("./index.js")) as Record<string, unknown>;

describe("the compiler surface carries region and effector", () => {
  it("(1) a consumer outside this package can reach the primitive registry from the root", async () => {
    const m = await rootModule();
    expect(typeof m["resolvePrimitive"], "src/index.ts does not export resolvePrimitive").toBe("function");
    expect(m["PRIMITIVE_IDS"], "src/index.ts does not export PRIMITIVE_IDS").toBeDefined();
    // COUNTERWEIGHT: a deriver too. Exporting the registry alone still leaves a harness unable to
    // build the SkeletonProfile every primitive requires, which is the other half of why the
    // bake-off hand-rolled.
    expect(
      typeof m["deriveSkeletonProfileFromRigAsset"],
      "src/index.ts does not export a skeleton deriver, so a consumer cannot build a profile",
    ).toBe("function");
  });

  it("(2) two different sites compile to different tracks, each anchored to its own region", async () => {
    const m = await rootModule();
    const resolve = m["resolvePrimitive"] as ((id: string) => { compile: (r: unknown) => { tracks: unknown[] } }) | undefined;
    expect(typeof resolve, "resolvePrimitive is not exported; clause (1) owns that").toBe("function");
    if (!resolve) return;
    const clutch = resolve("clutch_body_region");
    const at = (site: string) => clutch.compile({
      action: { actionId: `a_${site}`, primitiveId: "clutch_body_region", effector: HAND_R,
        target: { kind: "body_region", id: site }, timing: { startMs: 0, durationMs: 900 }, constraints: [] },
      skeletonProfile: { rigFingerprint: "fixture", joints: {} },
      seed: "fixed-seed",
    });
    const a = trackDigest(at("abdomen_epigastric").tracks);
    const b = trackDigest(at("chest_L").tracks);
    expect(a, "abdomen and chest compile to identical tracks — the site is ignored").not.toBe(b);
    // COUNTERWEIGHT: merely differing is satisfiable by hashing the site string into an offset. The
    // same site must be STABLE across calls, so the difference is the region and not noise.
    expect(trackDigest(at("abdomen_epigastric").tracks), "the same site is not deterministic").toBe(a);
  });

  it("(3) left and right effectors differ, and the rig's identity does NOT", async () => {
    const m = await rootModule();
    const compile = m["compileMotionProgram"] as ((i: unknown) => { tracks: unknown[]; targetRig: { skeletonProfileHash: string } });
    const profile = { rigFingerprint: "fixture", joints: {} };
    // actionId is CONSTANT on purpose. My first version varied it with the effector, and the clause
    // passed on that difference alone — the tracks differed because the id did, not because the hand
    // did. Only `effector` may vary between these two programs.
    const program = (effector: string) => ({
      schemaVersion: "openclinxr.motion-program.v1",
      actions: [{ actionId: "a", primitiveId: "clutch_body_region", effector,
        target: { kind: "body_region", id: "abdomen_epigastric" },
        timing: { startMs: 0, durationMs: 900 }, constraints: [] }],
    });
    const left = compile({ program: program(HAND_L), skeletonProfile: structuredClone(profile) });
    const right = compile({ program: program(HAND_R), skeletonProfile: structuredClone(profile) });

    // ASSERT THE BONE, NOT A DIGEST. My first version compared sha256 of the track arrays and it
    // PASSED — the two programs differ by seed jitter while BOTH write the same bone. Measured:
    //   handL -> bones: handR      handR -> bones: handR
    // `clutch_body_region` calls readEffectorBone(request, "handR") and never reads action.effector,
    // so a left-hand response moves the right hand with slightly different numbers. Bounding
    // "different" instead of "which bone" is how this clause would have gone green about nothing.
    const bones = (c: { tracks: unknown[] }) =>
      [...new Set((c.tracks as { boneName?: string }[]).map((t) => t.boneName ?? ""))].sort();
    expect(bones(left), "a handL response writes the right hand — action.effector is ignored")
      .not.toEqual(bones(right));
    expect(bones(left).join(","), "the handL program addresses no left-side bone").toMatch(/L\b|Left|_l$/u);

    // THE COUNTERWEIGHT THAT REFUSES THE WRONG FIX. Putting effectorBone on the profile would make
    // these differ AND split the rig's identity. One rig is one rig whichever hand it moves.
    expect(right.targetRig.skeletonProfileHash,
      "the rig's identity changed with the requested hand — effectorBone was put on the profile")
      .toBe(left.targetRig.skeletonProfileHash);
  });

  it("(4) durationSeconds is seconds", async () => {
    const m = await rootModule();
    const compile = m["compileMotionProgram"] as ((i: unknown) => { durationSeconds: number });
    const clip = compile({
      program: { schemaVersion: "openclinxr.motion-program.v1", actions: [{
        actionId: "a", primitiveId: "clutch_body_region", effector: HAND_R,
        target: { kind: "body_region", id: "abdomen_epigastric" },
        timing: { startMs: 0, durationMs: 900 }, constraints: [] }] },
      skeletonProfile: { rigFingerprint: "fixture", joints: {} },
    });
    // 900 ms of authored timing. A packer that trusts the field name makes this a 900-second clip.
    expect(clip.durationSeconds, "durationSeconds carries milliseconds").toBeLessThan(10);
    expect(clip.durationSeconds, "a 900 ms action compiled to no duration at all").toBeGreaterThan(0);
  });

  it("(5) every responseKind maps to a primitive the registry can supply", async () => {
    const m = await rootModule();
    const map = m["RESPONSE_KIND_TO_PRIMITIVE"] as Record<string, string>;
    const ids = m["PRIMITIVE_IDS"] as readonly string[] | undefined;
    expect(ids, "PRIMITIVE_IDS is not exported; clause (1) owns that").toBeDefined();
    const unresolvable = Object.entries(map ?? {})
      .filter(([, primitiveId]) => !(ids ?? []).includes(primitiveId))
      .map(([kind, primitiveId]) => `${kind}->${primitiveId}`);
    expect(unresolvable, "responseKinds map to primitives the registry cannot supply").toEqual([]);
  });
});
